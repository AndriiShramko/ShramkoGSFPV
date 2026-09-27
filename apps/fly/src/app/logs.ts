// Flight logs and trajectories: save (download + the latest one in localStorage), verify a saved
// log by replaying it in this tab (B15), and the trajectory as CSV / JSON.
import { InputLog } from '@gsfpv/sim-core';
import type { FlightSession } from '../session';
import { q } from './env';
import { hook } from './test-hook';
import type { SavedLog, TestHook } from './test-hook';

export function saveLog(s: FlightSession, label: string): SavedLog {
    const bytes = new Uint8Array(s.log.bytes());
    const entry: SavedLog = { label, header: s.log.header, bytes, endTick: s.sim.tick, hash: s.runner.traceHash() };
    hook.savedLogs.push(entry);
    try {
        // the latest saved log survives a reload / a new tab
        let bin = '';
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        localStorage.setItem('gsfpv.lastLog', JSON.stringify({ label, header: entry.header, endTick: entry.endTick, hash: entry.hash, b64: btoa(bin) }));
    } catch { /* quota: keep it in memory */ }
    if (!q.get('simradio')) {
        const blob = new Blob([JSON.stringify(entry.header), '\n', bytes], { type: 'application/octet-stream' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `gsfpv-flight-${Date.now()}.gsfpvlog`;
        a.click();
    }
    return entry;
}

export function verifyLastLog(s: FlightSession, tamper?: { record: number; channel: number }): ReturnType<NonNullable<TestHook['verifyLastLog']>> {
    let raw: string | null = null;
    try { raw = localStorage.getItem('gsfpv.lastLog'); } catch { raw = null; }
    if (!raw) return null;
    const j = JSON.parse(raw) as { header: InputLog['header']; endTick: number; hash: string; b64: string };
    const bin = atob(j.b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    let tampered: number | null = null;
    if (tamper) {
        // least significant byte of a little-endian float32 channel value: 1 LSB of the mantissa
        const off = tamper.record * InputLog.REC + 4 + tamper.channel * 4;
        tampered = new DataView(bytes.buffer).getFloat32(off, true);
        bytes[off] ^= 1;
    }
    const r = s.replayTrack(InputLog.fromBytes(j.header, bytes), j.endTick);
    return { saved: j.hash, endTick: j.endTick, hash: r.hash, track: r.track, tampered };
}

/** Trajectory as text: 100 samples per sim second, straight from the flight model's state. */
export function trajectoryText(s: FlightSession, kind: 'csv' | 'json'): string {
    const tr = s.runner.trajectory ?? [];
    if (kind === 'json') return JSON.stringify({ header: s.log.header, samplesHz: 100, points: tr }, null, 1);
    return 't,px,py,pz,qw,qx,qy,qz,vx,vy,vz,m1,m2,m3,m4,throttle,armed,crashed\n' + tr.map((p) => [p.t, ...p.p, ...p.q, ...p.v, ...p.motors, p.throttle, p.armed ? 1 : 0, p.crashed ? 1 : 0].join(',')).join('\n');
}

export function exportTrajectory(s: FlightSession, kind: 'csv' | 'json'): void {
    const text = trajectoryText(s, kind);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: kind === 'json' ? 'application/json' : 'text/csv' }));
    a.download = `gsfpv-trajectory-${Date.now()}.${kind}`;
    a.click();
}
