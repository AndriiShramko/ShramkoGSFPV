// Lab page for lane head4's tracker probe (tools/bench/scripts/head4-tracker.mjs): the real tracking module (camera, face
// tracker worker, pose filter, listener turn) on a real AudioContext, with the camera that Chrome's flags fake from a file.
// It records numbers only, per camera picture: its time, the worker's work time, the raw pose, the ears' pose, when the
// listener was turned. Not shipped (lab pages exist only in dev and lab builds).
import { createFaceTracker } from '../src/sonic/head/face-tracker';
import type { FaceStat } from '../src/sonic/head/face-tracker';
import type { ListenerLike } from '../src/sonic/head/listener-turn';
import type { HeadPose } from '../src/sonic/head/pose';
import { HeadTracking } from '../src/sonic/head/tracking';
import type { HeadLineId } from '../src/sonic/head/types';

interface Row {
    tMs: number;
    workMs: number;
    face: boolean;
    /** performance.now() when the listener was turned for this picture */
    appliedMs: number;
    raw: HeadPose | null;
    ears: HeadPose;
}

interface LabResult {
    result: string;
    loadMs: number | null;
    said: { id: HeadLineId; atMs: number }[];
    rows: Row[];
    outputLatencyMs: number;
    baseLatencyMs: number;
}

const state = document.getElementById('state') as HTMLElement;

async function run(seconds: number): Promise<LabResult> {
    const ac = new AudioContext();
    await ac.resume().catch(() => undefined);
    const stats: FaceStat[] = [];
    const said: LabResult['said'] = [];
    const rows: Row[] = [];
    let loadMs: number | null = null;
    const real = createFaceTracker({ onStat: (s) => stats.push(s), onReady: (ms) => (loadMs = ms) });
    let tracking: HeadTracking | null = null;
    const tracker = {
        start: (stream: MediaStream, onFace: (raw: HeadPose | null, tMs: number) => void) =>
            real.start(stream, (raw, tMs) => {
                onFace(raw, tMs);
                const s = stats[stats.length - 1];
                rows.push({ tMs, workMs: s?.workMs ?? -1, face: raw !== null, appliedMs: performance.now(), raw, ears: tracking?.pose ?? { yawDeg: 0, pitchDeg: 0, rollDeg: 0 } });
            }),
        stop: () => real.stop()
    };
    tracking = new HeadTracking({
        media: () => navigator.mediaDevices,
        tracker: async () => tracker,
        listener: () => ({ listener: ac.listener as unknown as ListenerLike, now: ac.currentTime }),
        say: async (id) => {
            said.push({ id, atMs: performance.now() });
        },
        narrator: () => true
    });
    state.textContent = 'starting';
    const result = await tracking.start();
    state.textContent = `tracking: ${result}`;
    if (result === 'on') await new Promise((r) => setTimeout(r, seconds * 1000));
    tracking.stop();
    const out: LabResult = { result, loadMs, said, rows, outputLatencyMs: (ac.outputLatency ?? 0) * 1000, baseLatencyMs: ac.baseLatency * 1000 };
    await ac.close();
    state.textContent = `done: ${rows.length} pictures`;
    return out;
}

(window as unknown as { __headLab: { run: typeof run } }).__headLab = { run };
