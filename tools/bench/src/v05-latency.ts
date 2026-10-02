// v0.5 latency probe: stick -> screen in the real page, render on, system Chrome, visible window.
// Keyboard F13 presses (?lat=1: each press is one numbered input sample on the normal path) at
// random phase. Per press, from the page's own clocks:
//   - tick lag: the 1 ms tick that applied the sample minus the first tick at or after its time
//     (0 = applied on time; a clock offset, a queue or a late hand-over shows up here)
//   - event -> rAF: from the event's OS time to the frame that first shows it (the frame wait)
//   - event -> presentation: Chrome Event Timing (8 ms resolution), the frame's presentation
//   - the guard's rAF -> presentation and the HUD's stick -> screen estimate
// Also the flight model's step response in that page (session.params): the same numbers as
// step-response.ts, so the browser runs the model the Node check measured.
// Run (Git Bash): cd apps/fly && npx vite --port 5351 --strictPort --host 127.0.0.1
//   LOCAL_FLY=1 SITE=http://127.0.0.1:5351 npx tsx tools/bench/src/v05-latency.ts <label> [presses]
import { launch, launchChrome, waitReady, visibility } from './browser';
import { writeEvidence } from './evidence';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { REPO } from './evidence';

const SITE = (process.env.SITE ?? 'http://127.0.0.1:5351').replace(/\/$/, '');
const SCENE = process.env.SCENE ?? '39e63ce9';
const label = process.argv[2] ?? 'run';
const N = Number(process.argv[3] ?? 40);
const fly = (qs: string) => (process.env.LOCAL_FLY ? `${SITE}/fly/?${qs}` : `${SITE}/en/fly/?${qs}`);

const pct = (a: number[], q: number) => {
    const s = a.filter(Number.isFinite).sort((x, y) => x - y);
    return s.length ? Math.round(s[Math.min(s.length - 1, Math.floor(q * (s.length - 1) + 0.5))] * 10) / 10 : NaN;
};
const sum = (a: number[]) => ({ n: a.filter(Number.isFinite).length, p50: pct(a, 0.5), p95: pct(a, 0.95), min: pct(a, 0), max: pct(a, 1) });

// HOG_MS=n: another GPU user, like a DaVinci Resolve render: a separate Chrome process keeps the
// GPU busy with compute dispatches of about n ms, 2 in flight (positive control for the GPU queue)
const HOG_MS = Number(process.env.HOG_MS ?? 0);
let hogInfo: unknown = null;
const hog = HOG_MS > 0 ? (await launchChrome({ headless: false, args: ['--window-position=1400,40', '--window-size=300,200'] })).browser : null;
if (hog) {
    const hp = await hog.newPage();
    await hp.goto(`${SITE}/`); // any page of the dev server: a secure origin for WebGPU
    // plain JS in a string: tsx would wrap named functions in __name(), which the page does not have
    hogInfo = await hp.evaluate(`(async (target) => {
        const ad = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
        const dev = await ad.requestDevice();
        const n = 1 << 20;
        const buf = dev.createBuffer({ size: n * 4, usage: 128 });
        const mk = (iter) => {
            const m = dev.createShaderModule({ code: \`@group(0) @binding(0) var<storage, read_write> b: array<f32>;
@compute @workgroup_size(256) fn main(@builtin(global_invocation_id) id: vec3u) {
  var x = b[id.x]; for (var i = 0u; i < \${iter}u; i++) { x = fma(x, 1.0000001, 0.0000001); } b[id.x] = x; }\` });
            const pl = dev.createComputePipeline({ layout: 'auto', compute: { module: m, entryPoint: 'main' } });
            const bg = dev.createBindGroup({ layout: pl.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: buf } }] });
            return () => { const e = dev.createCommandEncoder(); const c = e.beginComputePass(); c.setPipeline(pl); c.setBindGroup(0, bg); c.dispatchWorkgroups(n / 256); c.end(); dev.queue.submit([e.finish()]); };
        };
        // calibrate the loop count to about \`target\` ms per dispatch (never near the 2 s driver timeout)
        let iter = 256, ms = 0;
        for (let k = 0; k < 16; k++) {
            const go = mk(iter); go(); await dev.queue.onSubmittedWorkDone(); ms = Infinity;
            for (let j = 0; j < 3; j++) { const t = performance.now(); go(); await dev.queue.onSubmittedWorkDone(); ms = Math.min(ms, performance.now() - t); } // the fastest of 3: a stall elsewhere is not the dispatch
            if (ms > target * 0.8) break;
            iter = Math.min(iter * Math.max(1.2, Math.min(4, target / Math.max(ms, 0.5))), 1 << 22) | 0;
        }
        const go = mk(iter);
        const w = window; w.__hog = true;
        (async () => { while (w.__hog) { go(); go(); await dev.queue.onSubmittedWorkDone(); } })();
        return { iter, ms: Math.round(ms) };
    })(${HOG_MS})`);
}
const L = await launch({ width: 1280, height: 800 });
const { page } = L;
await page.route('**/api/e', (r) => r.fulfill({ status: 204, body: '' }));
// INFLIGHT=n: the renderer's frame cap (?inflight; 0 = no limit, the negative control)
const INFLIGHT = process.env.INFLIGHT;
await page.goto(fly(`scene=${SCENE}&lat=1&nowarn=1${INFLIGHT !== undefined ? `&inflight=${INFLIGHT}` : ''}`));
const ready = await waitReady(page, 180000);
if (ready.status !== 'ready') throw new Error(`page: ${JSON.stringify(ready)}`);
// the scan on screen and the guard settled
await page.waitForTimeout(8000);

await page.evaluate(() => {
    const w = window as unknown as Record<string, any>;
    const ses = w.__gsfpv.session;
    const R: any = (w.__lat = { keys: [], applied: [], frames: [], et: [] });
    addEventListener('keydown', (e) => { if (e.code === 'F13') R.keys.push(e.timeStamp); }, { capture: true });
    const proto = Object.getPrototypeOf(ses.sim);
    const orig = proto.setChannels;
    let lastId = ses.runner.lastAppliedId;
    proto.setChannels = function (ch: ArrayLike<number>) {
        const id = ses.runner.lastAppliedId;
        // runs inside stepOnce before the step: this tick applies the sample
        if (id !== lastId) { R.applied.push({ id, tick: this.tick, t0: ses.toSimUs(0) }); lastId = id; }
        return orig.call(this, ch);
    };
    // every drawn frame: its rAF, the newest sample in it, and when the GPU finished it
    R.drawn = [];
    ses.renderer.app.on('frameend', () => {
        const r = ses.renderer;
        if (r.drawing === false || !r.gpuQueue) return;
        const ct = document.timeline?.currentTime;
        const d = { raf: typeof ct === 'number' ? ct : performance.now(), id: ses.runner.lastAppliedId, done: NaN };
        R.drawn.push(d);
        r.gpuQueue.onSubmittedWorkDone().then(() => { d.done = performance.now(); });
    });
    ses.renderer.app.on('update', () => {
        const ct = document.timeline?.currentTime;
        R.frames.push({ raf: typeof ct === 'number' ? ct : performance.now(), id: ses.runner.lastAppliedId });
    });
    new PerformanceObserver((l) => {
        for (const e of l.getEntries() as any[]) if (e.name === 'keydown') R.et.push({ start: e.startTime, dur: e.duration, proc: e.processingStart });
    }).observe({ type: 'event', durationThreshold: 16, buffered: false } as PerformanceObserverInit);
    R.id0 = ses.runner.lastAppliedId;
    R.held0 = ses.renderer.framesHeld ?? 0;
});

// Playwright has no F13: CDP key events, like the A9 probe
const cdp = await L.context.newCDPSession(page);
const key = { code: 'F13', key: 'F13', windowsVirtualKeyCode: 124, nativeVirtualKeyCode: 124 };
for (let i = 0; i < N; i++) {
    await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...key });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
    await page.waitForTimeout(180 + Math.random() * 220);
}
await page.waitForTimeout(800);

const raw = await page.evaluate(() => {
    const w = window as unknown as Record<string, any>;
    const ses = w.__gsfpv.session;
    const r = ses.renderer;
    return { lat: w.__lat, submitDone: [...r.submitDone], held: r.framesHeld ?? null, webgpu: !!r.gpuQueue, lost: !!r.device?.contextLost || r.device?.isLost === true, cap: r.maxFramesInFlight ?? null, stats: r.latencyStats(), guard: r.latencyGuard.log.slice(-40), render: w.__gsfpv.info?.render, splat: r.splatFrame, canvas: [document.querySelector('canvas')!.width, document.querySelector('canvas')!.height] };
});
const vis = await visibility(page);
const R = raw.lat;
const rows: Record<string, number>[] = [];
R.keys.forEach((ts: number, k: number) => {
    const id = R.id0 + 1 + k;
    const ap = R.applied.find((a: any) => a.id === id);
    const fr = R.frames.find((f: any) => f.id >= id);
    const et = R.et.find((e: any) => Math.abs(e.start - ts) < 0.01);
    // sim time of the event; the runner applies it in the step that ends at the first ms at or after it
    const simUs = ap ? Math.round(ts * 1000 + ap.t0) : NaN;
    const ideal = Math.ceil(simUs / 1000) - 1;
    // the first drawn frame with this sample: presented at the first vsync (rAF times are on the
    // vsync grid) at least one period after its rAF and after the GPU finished it; + 1 period of
    // desktop composition and scan-out = on screen (the HUD's model)
    const dr = R.drawn.find((f: any) => f.id >= id);
    const P = raw.stats.periodMs;
    const present = dr && Number.isFinite(dr.done) ? dr.raf + P * Math.max(1, Math.ceil((dr.done - dr.raf) / P - 0.05)) : NaN;
    rows.push({ id, ts, evToDrawnRaf: dr ? dr.raf - ts : NaN, evToGpuDone: dr ? dr.done - ts : NaN, evToScreenEst: present + P - ts, tickLag: ap ? ap.tick - ideal : NaN, evToRaf: fr ? fr.raf - ts : NaN, evToPresent: et ? et.dur : NaN, handlerDelay: et ? et.proc - et.start : NaN });
});
const periodMs = raw.stats.periodMs;
const out = {
    label,
    site: SITE,
    scene: SCENE,
    visibility: vis,
    render: raw.render ?? 'on',
    canvas: raw.canvas,
    presses: N,
    periodMs,
    tickLagMs: sum(rows.map((r) => r.tickLag)),
    eventToFrameMs: sum(rows.map((r) => r.evToRaf)),
    eventToDrawnFrameMs: sum(rows.map((r) => r.evToDrawnRaf)),
    eventToGpuDoneMs: sum(rows.map((r) => r.evToGpuDone)),
    /** stick -> screen of the canvas: first drawn frame with the sample, vsync after GPU done, + 1 period scan-out */
    eventToScreenEstMs: sum(rows.map((r) => r.evToScreenEst)),
    /** Chrome Event Timing: the next presented compositor frame; with a held canvas frame it shows the old picture */
    eventToPresentationMs: sum(rows.map((r) => r.evToPresent)),
    handlerDelayMs: sum(rows.map((r) => r.handlerDelay)),
    hog: hogInfo,
    maxFramesInFlight: raw.cap,
    webgpu: raw.webgpu,
    deviceLost: raw.lost,
    // animation frames in the press window that were not drawn (GPU queue full)
    heldShare: raw.held !== null ? Math.round(((raw.held - R.held0) / Math.max(1, R.frames.length)) * 1000) / 1000 : NaN,
    rafHz: R.frames.length > 1 ? Math.round(((R.frames.length - 1) * 10000) / (R.frames[R.frames.length - 1].raf - R.frames[0].raf)) / 10 : NaN,
    submitToDoneLast30Ms: sum(raw.submitDone),
    hud: { inputToScreenMs: raw.stats.inputToScreenMs, rafToPresentMs: raw.stats.rafToPresentMs, submitToDoneMs: raw.stats.submitToDoneMs, skips: raw.stats.skips },
    guardTail: raw.guard,
    rows
};
console.log(JSON.stringify({ ...out, rows: undefined, guardTail: undefined }, null, 1));
const prev = join(REPO, 'evidence', new Date().toISOString().slice(0, 10), 'v05-latency.json');
const all: Record<string, unknown> = existsSync(prev) ? JSON.parse(readFileSync(prev, 'utf8')).runs ?? {} : {};
all[label] = out;
console.log(writeEvidence('v05-latency', { runs: all }));
await L.browser.close();
await hog?.close();
