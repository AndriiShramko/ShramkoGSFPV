// ?lat=1 instrumentation (never enabled in production links): per input id, when the event was
// stamped, when the physics consumed it, when the frame that shows it ended on the CPU and when
// the GPU finished that frame's work. Called "internal pipeline" — the end-to-end latency is
// only what the external capture measures.

import type { FlightSession } from './session';

export interface StageRecord {
    id: number;
    tEvent: number; // KeyboardEvent.timeStamp
    tApplied: number; // performance.now() in the update where physics consumed it
    tFrameEnd: number; // frameend of that frame
    tGpuDone: number; // onSubmittedWorkDone resolved
}

export class LatencyProbe {
    records = new Map<number, StageRecord>();
    private lastSeen = 0;
    private session: FlightSession;
    private gpuQueue: { onSubmittedWorkDone(): Promise<void> } | null;

    constructor(session: FlightSession) {
        this.session = session;
        const dev = session.renderer.device as unknown as { wgpu?: { queue: { onSubmittedWorkDone(): Promise<void> } } };
        this.gpuQueue = dev.wgpu?.queue ?? null; // instrumentation only (not used by the app)
        addEventListener('keydown', (e) => {
            if (!/^F(1[3-9]|2[0-4])$/.test(e.code) && !/^F(1[3-9]|2[0-4])$/.test(e.key)) return;
            if (/^F2[04]$/.test(e.code) || /^F2[04]$/.test(e.key)) return; // harness control keys
            // the keyboard source numbers the same events; mirror its counter
            const id = this.records.size + 1;
            this.records.set(id, { id, tEvent: e.timeStamp, tApplied: NaN, tFrameEnd: NaN, tGpuDone: NaN });
        }, { capture: true });
        const app = session.renderer.app;
        app.on('update', () => {
            const now = performance.now();
            this.frameTimes.push(now);
            if (this.frameTimes.length > 2000) this.frameTimes.shift();
            const id = session.runner.lastAppliedId;
            if (id !== this.lastSeen) {
                for (let k = this.lastSeen + 1; k <= id; k++) {
                    const r = this.records.get(k);
                    if (r && Number.isNaN(r.tApplied)) r.tApplied = performance.now();
                }
                this.lastSeen = id;
                this.pending.push(id);
            }
        });
        app.on('frameend', () => {
            if (this.pending.length === 0) return;
            const ids = this.pending.splice(0);
            const t = performance.now();
            for (const id of ids) {
                const r = this.records.get(id);
                if (r) r.tFrameEnd = t;
            }
            this.gpuQueue?.onSubmittedWorkDone().then(() => {
                const tg = performance.now();
                for (const id of ids) {
                    const r = this.records.get(id);
                    if (r) r.tGpuDone = tg;
                }
            });
        });
    }

    private pending: number[] = [];
    frameTimes: number[] = [];

    summary(): StageRecord[] {
        return [...this.records.values()];
    }

    /** Median and p95 of the app's own frame interval over the last frames (ms). */
    framePeriod(): { medianMs: number; p95Ms: number; frames: number } {
        const f = this.frameTimes;
        const d = f.slice(1).map((t, i) => t - f[i]).sort((a, b) => a - b);
        return { medianMs: d[d.length >> 1] ?? NaN, p95Ms: d[Math.floor(0.95 * (d.length - 1))] ?? NaN, frames: f.length };
    }
}
