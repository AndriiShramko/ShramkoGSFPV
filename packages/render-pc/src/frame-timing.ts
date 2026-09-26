// Frame cost instrumentation for the lab (spec-verify, latency method step 6). Never enabled by
// the app itself.
//
// GPU: PlayCanvas 2.22.4 requests the 'timestamp-query' device feature whenever the adapter
// exposes it, and while its GPU profiler is enabled it writes a WebGPU begin/end timestamp
// around EVERY render and compute pass (WebgpuGraphicsDevice.setupTimeStampWrites), resolves
// them at frameEnd and maps them back asynchronously. That is real per-pass timing, so we use
// it, but we tap the raw per-frame timings handed to GpuProfiler.report() instead of reading
// the profiler's _frameTime: that value is only a span (earliest begin -> latest end, idle gaps
// included) of whichever frame was reported last, and the probe that read it got a constant.
// CPU: wall time of the engine tick, frameupdate -> frameend (physics + scene update + encode
// + submit), split at framerender.

import type { AppBase, GraphicsDevice } from 'playcanvas';

export interface GpuPassTime {
    name: string;
    ms: number;
}

export interface GpuFrameSample {
    renderVersion: number;
    /** per pass, in submission order (a name can repeat) */
    passes: GpuPassTime[];
    /** sum of pass durations: time the GPU spent inside our passes */
    busyMs: number;
    /** earliest begin -> latest end over the frame's passes, gaps included (the engine's number) */
    spanMs: number;
}

type ReportFn = (renderVersion: number, timings: number[] | null, frameTime?: number) => void;

interface ProfilerLike {
    enabled: boolean;
    pastFrameAllocations: Map<number, string[]>;
    report: ReportFn;
}

export class GpuPassTimer {
    /** false on WebGL2 or when the adapter has no 'timestamp-query' */
    readonly supported: boolean;
    private readonly device: GraphicsDevice;
    private readonly prof: ProfilerLike | null;
    private readonly origReport: ReportFn | null = null;
    private recording = false;
    private fromVersion = 0;
    private buf: GpuFrameSample[] = [];
    /** frames the engine reported with no timings (map failed) while recording */
    dropped = 0;

    constructor(device: GraphicsDevice) {
        this.device = device;
        const dev = device as unknown as { isWebGPU: boolean; supportsTimestampQuery?: boolean; gpuProfiler?: ProfilerLike };
        this.supported = !!(dev.isWebGPU && dev.supportsTimestampQuery && dev.gpuProfiler);
        this.prof = this.supported ? dev.gpuProfiler! : null;
        if (!this.prof) return;
        const prof = this.prof;
        const orig = prof.report.bind(prof) as ReportFn;
        this.origReport = orig;
        prof.report = (renderVersion, timings, frameTime) => {
            // names must be read before the original deletes this frame's allocations
            const names = prof.pastFrameAllocations.get(renderVersion);
            if (this.recording && renderVersion >= this.fromVersion) {
                if (names && timings && timings.length) this.buf.push(sample(renderVersion, names, timings, frameTime));
                else this.dropped++;
            }
            orig(renderVersion, timings, frameTime);
        };
        prof.enabled = true; // takes effect at the next frameStart
    }

    /** Start keeping samples; frames rendered before this call are ignored even if reported later. */
    begin(): void {
        this.buf = [];
        this.dropped = 0;
        this.fromVersion = (this.device as unknown as { renderVersion: number }).renderVersion + 1;
        this.recording = true;
    }

    /** Stop and return the samples (call a few frames after the last measured frame: reports are async). */
    end(): GpuFrameSample[] {
        this.recording = false;
        const out = this.buf;
        this.buf = [];
        return out;
    }

    dispose(): void {
        this.recording = false;
        if (this.prof && this.origReport) {
            this.prof.report = this.origReport;
            this.prof.enabled = false;
        }
    }
}

function sample(renderVersion: number, names: string[], timings: number[], frameTime?: number): GpuFrameSample {
    const passes: GpuPassTime[] = [];
    let busy = 0;
    const n = Math.min(names.length, timings.length);
    for (let i = 0; i < n; i++) {
        const ms = timings[i];
        passes.push({ name: names[i], ms });
        busy += ms;
    }
    return { renderVersion, passes, busyMs: busy, spanMs: typeof frameTime === 'number' ? frameTime : busy };
}

export interface CpuFrameSample {
    /** frameupdate -> frameend, ms */
    totalMs: number;
    /** frameupdate -> framerender: physics, scripts, scene update */
    updateMs: number;
    /** framerender -> frameend: culling, command encoding, submit */
    renderMs: number;
    /** performance.now() at frameupdate */
    t: number;
}

export class CpuFrameTimer {
    private readonly app: AppBase;
    private recording = false;
    private tStart = 0;
    private tRender = 0;
    private buf: CpuFrameSample[] = [];
    private readonly onUpdate = () => { this.tStart = performance.now(); this.tRender = 0; };
    private readonly onRender = () => { this.tRender = performance.now(); };
    private readonly onEnd = () => {
        if (!this.recording || this.tStart === 0) return;
        const t = performance.now();
        const tr = this.tRender || t;
        this.buf.push({ totalMs: t - this.tStart, updateMs: tr - this.tStart, renderMs: t - tr, t: this.tStart });
    };

    constructor(app: AppBase) {
        this.app = app;
        app.on('frameupdate', this.onUpdate);
        app.on('framerender', this.onRender);
        app.on('frameend', this.onEnd);
    }

    begin(): void {
        this.buf = [];
        this.recording = true;
    }

    end(): CpuFrameSample[] {
        this.recording = false;
        const out = this.buf;
        this.buf = [];
        return out;
    }

    dispose(): void {
        this.recording = false;
        this.app.off('frameupdate', this.onUpdate);
        this.app.off('framerender', this.onRender);
        this.app.off('frameend', this.onEnd);
    }
}
