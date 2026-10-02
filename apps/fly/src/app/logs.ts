// Flight logs and trajectories (log format /2, docs/architecture-v03.md C.9): save the kept lives
// (download + localStorage, for B15's replay in a new tab), check a saved flight by replaying it,
// and the trajectory as CSV / JSON, recomputed from the log (phase D; no live trajectory any more).
//
// A saved flight is its lives: each with its header (the preset JSON embedded, so it survives a
// later preset edit), its records, the tick it ends at and its trace hash. The current life is
// saved with its hash so far (Runner.liveLifeHash), so the flight goes on after a save. Logs of
// v0.2 (format /1) are refused with a clear message.
import { LOG_FORMAT_V2, REC_BYTES, REC_INPUT, recordKind, recordSlot } from '@gsfpv/sim-core';
import type { Life, LifeHeader, LifeSnapshot } from '@gsfpv/sim-core';
import type { FlightSession } from '../session';
import { lifeProblem, presetBySha, replayLivesTrack, sessionHash, trajectoryOf } from '../session/replay';
import { q } from './env';
import { hook } from './test-hook';
import type { SavedLog, TestHook } from './test-hook';

/** localStorage key of the last saved flight (v0.2's key, now holding format /2: a v0.2 log there is refused cleanly). */
export const LAST_LOG_KEY = 'gsfpv.lastLog';
export const SAVED_FORMAT = 'gsfpv-flight/2';

export interface SavedLife {
    header: LifeHeader;
    /** the records, base64 */
    b64: string;
    endTick: number;
    /** the life's trace hash over the ticks after hashFrom (Life.traceHash; the current life's: so far) */
    hash: string;
    hashFrom: number;
    snapshot?: LifeSnapshot;
}

export interface SavedFlight {
    format: typeof SAVED_FORMAT;
    label: string;
    savedAt: string;
    lives: SavedLife[];
    endTick: number;
    /** sessionHash of the lives' hashes */
    hash: string;
    /** records over all the lives */
    records: number;
}

function b64(bytes: Uint8Array): string {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
}

function unb64(s: string): Uint8Array {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

/**
 * The kept lives as a saved flight: closed lives with their hash, the current one with its hash so far.
 * `currentOnly`: the current life alone (a bug report: the life the pilot was in when it happened).
 */
export function savedFlight(s: FlightSession, label: string, o: { currentOnly?: boolean } = {}): SavedFlight {
    const all = s.lives();
    const cur = all[all.length - 1];
    const lives = o.currentOnly && cur ? [cur] : all;
    const live = s.runner.liveLifeHash();
    const out: SavedLife[] = [];
    let records = 0;
    for (const l of lives) {
        const isCur = l === cur;
        const hash = isCur ? live?.hash : l.traceHash;
        const from = isCur ? live?.from : l.hashFrom;
        if (hash === undefined || from === undefined) continue; // a life without a hash cannot be checked: not saved
        const header = JSON.parse(JSON.stringify(l.header)) as LifeHeader;
        header.presetJson ??= presetBySha(header.presetSha256) ?? undefined;
        const bytes = l.bytes();
        records += Math.floor(bytes.length / REC_BYTES);
        out.push({ header, b64: b64(bytes), endTick: l.endTick, hash, hashFrom: from, ...(l.snapshot ? { snapshot: l.snapshot } : {}) });
    }
    return { format: SAVED_FORMAT, label, savedAt: new Date().toISOString(), lives: out, endTick: s.sim.tick, hash: sessionHash(out.map((l) => l.hash)), records };
}

/** A saved life as a Life to replay (records copied, so a tamper does not touch the saved text). */
export function lifeOf(l: SavedLife, bytes: Uint8Array = unb64(l.b64)): Life {
    return { header: l.header, bytes: () => bytes, endTick: l.endTick, traceHash: l.hash, hashFrom: l.hashFrom, ...(l.snapshot ? { snapshot: l.snapshot } : {}) };
}

export function saveLog(s: FlightSession, label: string): SavedLog {
    const f = savedFlight(s, label);
    const entry: SavedLog = { label, flight: f, endTick: f.endTick, hash: f.hash, records: f.records };
    hook.savedLogs.push(entry);
    const text = JSON.stringify(f);
    try {
        // the latest saved flight survives a reload / a new tab (it is small unless the session is hours long)
        localStorage.setItem(LAST_LOG_KEY, text);
    } catch { /* quota: keep it in memory and in the download */ }
    if (!q.get('simradio')) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
        a.download = `gsfpv-flight-${Date.now()}.gsfpvlog`;
        a.click();
    }
    return entry;
}

/** The saved flight in localStorage, or null; a v0.2 log (format /1) says so instead of replaying wrong. */
export function lastSaved(): SavedFlight | { refused: string } | null {
    let raw: string | null = null;
    try { raw = localStorage.getItem(LAST_LOG_KEY); } catch { raw = null; }
    if (!raw) return null;
    const j = JSON.parse(raw) as Partial<SavedFlight> & { header?: { format?: string } };
    if (j.format !== SAVED_FORMAT || !Array.isArray(j.lives)) {
        const f = j.header?.format ?? j.format ?? 'unknown';
        return { refused: `log format ${String(f)} is not ${LOG_FORMAT_V2}: logs saved by v0.2 (format /1) cannot be replayed by this version` };
    }
    return j as SavedFlight;
}

/**
 * A change planted in one input record, for B15's controls: `atTick` picks the first input record
 * at or after that tick (`record` an index over all the saved records instead); `delta` adds to the
 * channel (a stick twitch), without it the least significant bit of the Float32 flips.
 */
export interface Tamper { record?: number; atTick?: number; channel: number; delta?: number }

function plant(lives: Uint8Array[], t: Tamper): number | null {
    let index = 0;
    for (const bytes of lives) {
        const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const n = Math.floor(bytes.length / REC_BYTES);
        for (let i = 0; i < n; i++, index++) {
            const code = v.getInt32(i * REC_BYTES, true);
            const hit = t.record !== undefined ? index === t.record : recordKind(code) === REC_INPUT && recordSlot(code) >= (t.atTick ?? 0);
            if (!hit) continue;
            const off = i * REC_BYTES + 4 + t.channel * 4;
            const was = v.getFloat32(off, true);
            if (t.delta !== undefined) v.setFloat32(off, was + t.delta, true);
            else bytes[off] ^= 1; // least significant byte of a little-endian float32: 1 LSB of the mantissa
            return was;
        }
    }
    return null;
}

export function verifyLastLog(s: FlightSession, tamper?: Tamper): ReturnType<NonNullable<TestHook['verifyLastLog']>> {
    const f = lastSaved();
    if (!f) return null;
    if ('refused' in f) return { saved: '', endTick: 0, hash: '', track: [], tampered: null, refused: f.refused };
    const problem = f.lives.map((l) => lifeProblem(l.header, s.wallsSource)).find((p) => p !== null);
    if (problem) return { saved: f.hash, endTick: f.endTick, hash: '', track: [], tampered: null, refused: problem };
    const bytes = f.lives.map((l) => unb64(l.b64));
    const tampered = tamper ? plant(bytes, tamper) : null;
    const r = replayLivesTrack(f.lives.map((l, i) => lifeOf(l, bytes[i])), s.wallsSource, f.endTick);
    return { saved: f.hash, endTick: f.endTick, hash: r.hash, track: r.track, tampered, lives: f.lives.length };
}

/** The kept lives' trajectory: 100 samples per sim second, recomputed from the log. */
export function trajectoryText(s: FlightSession, kind: 'csv' | 'json'): string {
    const lives = s.lives();
    const tr = trajectoryOf(lives, s.wallsSource, s.sim.tick);
    if (kind === 'json') return JSON.stringify({ headers: lives.map((l) => l.header), samplesHz: 100, points: tr }, null, 1);
    return 't,px,py,pz,qw,qx,qy,qz,vx,vy,vz,m1,m2,m3,m4,throttle,armed,crashed\n' + tr.map((p) => [p.t, ...p.p, ...p.q, ...p.v, ...p.motors, p.throttle, p.armed ? 1 : 0, p.crashed ? 1 : 0].join(',')).join('\n');
}

export function exportTrajectory(s: FlightSession, kind: 'csv' | 'json'): void {
    const text = trajectoryText(s, kind);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: kind === 'json' ? 'application/json' : 'text/csv' }));
    a.download = `gsfpv-trajectory-${Date.now()}.${kind}`;
    a.click();
}

/** Play a saved flight back on screen from its start. */
export function playSaved(s: FlightSession, l: SavedLog): boolean {
    const lives = l.flight.lives.map((x) => lifeOf(x));
    return lives.length > 0 && s.startReplay(lives, lives[0].header.life.startTick, l.endTick);
}
