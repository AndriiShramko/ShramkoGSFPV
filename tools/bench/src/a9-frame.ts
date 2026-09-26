// A9, latency method step 6: frame cost. Informational, not a gate.
// Drives apps/fly/lab/frame.html from the LAB PREVIEW build (release PlayCanvas engine, like the
// shipped app and tools/latency/lat.py) in system Chrome with a visible window and stock flags,
// then judges the page's raw numbers:
//   - GPU time = WebGPU timestamp queries around every pass (see packages/render-pc/src/frame-timing.ts)
//   - negative control: 2x and 4x pixels (render scale sqrt(2), 2) must raise the median GPU time
//     monotonically; a constant timer (like the engine profiler's 58.182 ms every frame in the
//     2026-09-22 probe) or a control that does not fire discards the GPU numbers
//   - the 144 Hz budget (6.94 ms) is only compared, never claimed: this display outputs ~30 Hz
//   - the engine must be the release build: the dev server (port 5190) loads playcanvas.dbg, which
//     opens a WebGPU 'validation' error scope in every frame and pass (the page counts them); such a
//     run is recorded but marked invalid and its frame cost is not published
// Run (Git Bash, repo root):
//   GSFPV_LAB=1 pnpm --filter @gsfpv/fly build && GSFPV_LAB=1 pnpm --filter @gsfpv/fly preview   (port 5191)
//   npx tsx tools/bench/src/a9-frame.ts
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { launch, visibility } from './browser';
import { writeEvidence, REPO } from './evidence';

const BASE = process.env.FLY_BASE ?? 'http://localhost:5191/fly/lab/'; // vite preview of apps/fly/dist-lab
const QUERY = process.env.A9_FRAME_QUERY ?? ''; // e.g. "yaw=kin" or "n=120"
const BUDGET_144_MS = 1000 / 144;

interface Stats { n: number; median: number; p95: number; mean: number; sd: number; min: number; max: number; distinct: number }
interface Win {
    label: string;
    renderScale: number;
    pixels: number;
    canvasPx: number[];
    frames: number;
    streamingFrames: number;
    crashedDuring: boolean;
    gpu: { samples: number; emptyReports: number; busyMs: Stats | null; spanMs: Stats | null; passMedianMs: Record<string, number | null> };
    cpu: { totalMs: Stats | null; updateMs: Stats | null; renderMs: Stats | null };
    frameIntervalMs: Stats | null;
    scenario: Record<string, unknown>;
}

/** Output rate of this display from the newest a9-latency.json, if one exists. */
function displayHz(): { hz: number | null; source: string | null } {
    const root = join(REPO, 'evidence');
    const dirs = existsSync(root) ? readdirSync(root).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse() : [];
    for (const d of dirs) {
        const f = join(root, d, 'a9-latency.json');
        if (!existsSync(f)) continue;
        try {
            const j = JSON.parse(readFileSync(f, 'utf8')) as { verdict?: { outputHz?: number } };
            if (typeof j.verdict?.outputHz === 'number') return { hz: j.verdict.outputHz, source: `evidence/${d}/a9-latency.json verdict.outputHz` };
        } catch { /* try the next date */ }
    }
    return { hz: null, source: null };
}

const HOLD_M = 0.5; // yaw600: the craft must stay this close to its hover point in every window
const constant = (s: Stats | null): boolean => !s || s.distinct < 5 || s.sd === 0; // a real timer varies frame to frame

function judge(name: string, sc: Record<string, unknown> | undefined, gpuSupported: boolean, hz: number | null, engineReason: string | null): Record<string, unknown> {
    const pre = engineReason ? [engineReason] : [];
    if (!sc) return { scenario: name, valid: false, reasons: [...pre, 'scenario did not run'] };
    if (sc.error) return { scenario: name, valid: false, reasons: [...pre, String(sc.error)] };
    const w = (sc.windows ?? []) as Win[];
    const reasons: string[] = [...pre];
    const warnings: string[] = [];
    if (w.length < 3) return { scenario: name, valid: false, reasons: [...pre, 'fewer than 3 windows'] };
    const [x1, x2, x4] = w;
    const x1again = w[3];
    const med = (x: Win) => x.gpu.busyMs?.median ?? NaN;

    if (!gpuSupported) reasons.push('timestamp-query not available on this device: no GPU numbers');
    for (const x of w) {
        const b = x.gpu.busyMs;
        if (!b || x.gpu.samples < 0.5 * x.frames) reasons.push(`${x.label}: only ${x.gpu.samples} GPU samples for ${x.frames} frames`);
        // a constant is a stale or broken readback (both totals come from the same timestamps)
        else if (constant(b)) reasons.push(`${x.label}: GPU busy time is constant (${b.median} ms, ${b.distinct} distinct values) - discarded`);
        else if (constant(x.gpu.spanMs)) reasons.push(`${x.label}: GPU span time is constant (${x.gpu.spanMs?.median ?? 'none'} ms, ${x.gpu.spanMs?.distinct ?? 0} distinct values) - discarded`);
        if (x.crashedDuring) reasons.push(`${x.label}: the craft crashed during the window`);
        if (x.streamingFrames > 0.1 * x.frames) warnings.push(`${x.label}: splats were streaming in ${x.streamingFrames} of ${x.frames} frames`);
    }
    // the extra load must really be there: 2x and 4x the pixels of x1
    const pr2 = x2.pixels / x1.pixels, pr4 = x4.pixels / x1.pixels;
    if (Math.abs(pr2 - 2) > 0.2 || Math.abs(pr4 - 4) > 0.4) reasons.push(`render scale did not give 2x/4x pixels (got ${pr2.toFixed(2)}x / ${pr4.toFixed(2)}x)`);
    const m1 = med(x1), m2 = med(x2), m4 = med(x4);
    const monotonic = m1 < m2 && m2 < m4;
    if (!monotonic) reasons.push(`control did not fire: GPU median x1 ${m1} ms, x2 ${m2} ms, x4 ${m4} ms is not rising`);
    let drift: number | null = null;
    if (x1again) {
        drift = med(x1again) / m1 - 1;
        if (Math.abs(drift) > 0.25) warnings.push(`x1 repeated at the end differs by ${(drift * 100).toFixed(0)} %: conditions changed during the run`);
    }
    // the scenario must hold in EVERY window, not only at 1x: the extra pixels may slow the sim loop
    if (name === 'yaw600') {
        const target = Number(sc.targetRateDegS);
        for (const x of w) {
            const rate = (x.scenario.yawRateDegS as Stats | null)?.median ?? NaN;
            if (!(Math.abs(rate - target) <= 0.1 * target)) reasons.push(`${x.label}: yaw rate was ${rate} deg/s, not ${target}`);
            const away = (x.scenario.driftFromHomeM as Stats | null)?.max ?? NaN;
            if (!(away <= HOLD_M)) reasons.push(`${x.label}: the craft drifted up to ${away} m from its hover point (limit ${HOLD_M} m)`);
        }
    }
    if (name === 'wall03') {
        const want = Number(sc.holdStandoffM);
        const asked = Number(sc.requestedStandoffM);
        // the page backs off in 2 cm steps when the craft's sphere would touch the wall: then it is not the asked scenario
        if (!(want - asked <= 0.02)) reasons.push(`held ${want} m from the wall, not the requested ${asked} m (the craft's collision sphere would touch the wall closer)`);
        const ap = (sc.approach ?? {}) as { reached?: boolean; crashed?: boolean };
        if (ap.crashed) reasons.push('the craft crashed on the approach to the wall');
        if (ap.reached !== true) reasons.push('the approach did not finish within 20 s');
        for (const x of w) {
            const d = (x.scenario.distToWallM as Stats | null)?.median ?? NaN;
            if (!(Math.abs(d - want) <= 0.1)) reasons.push(`${x.label}: distance to the wall was ${d} m, not ${want}`);
        }
        if (Number(sc.contactsDuringWindows) > 0) warnings.push(`${sc.contactsDuringWindows} contacts with the wall during the windows`);
    }
    const gpuValid = !reasons.some((r) => /GPU|timestamp|control|render scale|engine/.test(r));
    const valid = reasons.length === 0;
    const gpu = gpuValid ? x1.gpu.busyMs : null;
    // CPU numbers of the debug engine are not the app's either
    const cpuOf = (s: Stats | null) => (!engineReason && s ? { median: s.median, p95: s.p95 } : null);
    const cpu = engineReason ? null : x1.cpu.totalMs;
    return {
        scenario: name,
        valid,
        gpuValid,
        reasons,
        warnings,
        control: {
            name: 'extra GPU load 2x / 4x pixels must raise the GPU time monotonically',
            pixelsRatio: [1, +pr2.toFixed(3), +pr4.toFixed(3)],
            gpuBusyMedianMs: [m1, m2, m4],
            fired: monotonic,
            x1RepeatDrift: drift === null ? null : +drift.toFixed(3)
        },
        frameCost: {
            gpuBusyMs: gpu ? { median: gpu.median, p95: gpu.p95 } : null,
            gpuSpanMs: gpuValid && x1.gpu.spanMs ? { median: x1.gpu.spanMs.median, p95: x1.gpu.spanMs.p95 } : null,
            gpuPassMedianMs: gpuValid ? x1.gpu.passMedianMs : null,
            cpuTickMs: cpuOf(cpu),
            cpuUpdateMs: cpuOf(x1.cpu.updateMs),
            cpuRenderMs: cpuOf(x1.cpu.renderMs),
            presentedIntervalMs: x1.frameIntervalMs ? { median: x1.frameIntervalMs.median, note: 'rAF cadence = display pacing, not the frame cost' } : null
        },
        budget144Hz: {
            budgetMs: +BUDGET_144_MS.toFixed(2),
            gpuP95Within: gpu ? gpu.p95 <= BUDGET_144_MS : null,
            cpuP95Within: cpu ? cpu.p95 <= BUDGET_144_MS : null,
            status: `NOT VERIFIED up to 144 Hz: this display outputs ${hz ?? '~30'} Hz, so a 6.94 ms frame was never presented; the comparison is informational`
        }
    };
}

const { browser, page, console: log } = await launch();
const url = `${BASE}frame.html?cb=${Math.random().toString(36).slice(2)}${QUERY ? '&' + QUERY : ''}`;
await page.goto(url);
const t0 = Date.now();
let res: Record<string, unknown> | null = null;
let lastPhase = '';
while (Date.now() - t0 < 12 * 60 * 1000) {
    res = await page.evaluate(() => (window as unknown as { __frame?: Record<string, unknown> }).__frame ?? null);
    const ph = String(res?.phase ?? '');
    if (ph !== lastPhase) { console.log(`[${Math.round((Date.now() - t0) / 1000)} s] ${ph}`); lastPhase = ph; }
    if (res && res.status !== 'running') break;
    await page.waitForTimeout(2000);
}
const vis = await visibility(page);
await browser.close();

const page0 = res ?? { status: 'timeout' };
const hz = displayHz();
const gpuSupported = !!(page0.gpuTimer as { supported?: boolean } | undefined)?.supported;
const sc = (page0.scenarios ?? {}) as Record<string, Record<string, unknown>>;
// which engine the page ran: its own report (import.meta.env) plus the error-scope count it measured
const env = (page0.env ?? {}) as { engineBuild?: string; viteMode?: string; validationScopesPer30Frames?: number | null };
const engineOk = env.engineBuild === 'release' && (env.validationScopesPer30Frames ?? 0) === 0;
const engineReason = engineOk ? null : `engine build is ${env.engineBuild ?? 'unknown'} (${env.validationScopesPer30Frames ?? '?'} WebGPU validation scopes in 30 frames): not the release engine the app ships, frame cost discarded`;
const build = {
    kind: engineOk ? 'lab preview build (vite preview of apps/fly/dist-lab), release engine' : `NOT the release engine: ${env.engineBuild ?? 'unknown'} (Vite mode ${env.viteMode ?? '?'})`,
    engineBuild: env.engineBuild ?? null,
    viteMode: env.viteMode ?? null,
    validationScopesPer30Frames: env.validationScopesPer30Frames ?? null,
    servedFrom: BASE
};
const verdicts = page0.status === 'done' ? [judge('yaw600', sc.yaw600, gpuSupported, hz.hz, engineReason), judge('wall03', sc.wall03, gpuSupported, hz.hz, engineReason)] : [];
const runValid = page0.status === 'done' && vis === 'visible' && engineOk;
const file = writeEvidence('a9-frame', {
    item: 'A9 latency method step 6 (frame cost)',
    gate: false,
    note: 'Informational, not a gate. Frame cost = GPU time inside our passes (WebGPU timestamp-query) and CPU time of the engine tick; the 144 Hz budget is compared, not verified.',
    build,
    url: url.replace(/cb=[^&]+/, 'cb=<random>'),
    display: hz,
    runValid,
    visibilityAtEnd: vis,
    verdicts,
    page: page0,
    consoleErrors: log.filter((l) => l.startsWith('error') || l.startsWith('pageerror')).slice(0, 20)
});
for (const v of verdicts) console.log(JSON.stringify({ scenario: v.scenario, valid: v.valid, gpuValid: v.gpuValid, control: v.control, frameCost: v.frameCost, reasons: v.reasons, warnings: v.warnings }));
console.log('A9 frame', runValid ? 'measured' : `INVALID (status ${String(page0.status)}, visibility ${vis}, engine ${env.engineBuild ?? '?'})`, '->', file);
if (page0.status === 'error') console.log(String(page0.error));
