// Fly by Sound, step 2: the recorder in a real browser (headless Chrome, a fake microphone, real OPFS and MediaRecorder,
// the live headers from deploy/nginx.conf through serve-csp.mjs, no scan drawn: --disable-gpu, no GPU lock needed).
// The sound mode's runtime and the flight's samples are stand-ins (the flight lane has not built them yet); everything
// else is the code the simulator runs. Checks, each with a control that must fire:
//   A  length    a flight recorded with T, T, ..., T: the package reads strictly, the voice decoded is as long as the flight
//                within 0.2 s (plan 4.3 step 2); control: a voice that stopped 1 s early would fail the same bound
//   B  crash     the tab is killed mid-recording (CDP Page.crash: no unload handlers, no flush on the way out) at five
//                different moments of the one-second flush cycle; a new tab recovers the session each time and the loss
//                is under 3 s of flight; control: a recorder that never flushes loses everything
//   C  sync      a microphone made of tone bursts at known recording times: where the bursts land in voice.webm against
//                voiceOffsetMs, i.e. how well the voice and the flight share a clock (measured, not claimed)
//   D  cost      what one onSample call costs while a recording runs (it sits in the render loop)
//   npx tsx tools/bench/src/sonicrec-recorder.ts        evidence/<date>/sonicrec-recorder.json
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'esbuild';
import type { BrowserContext, Page } from 'playwright';
import { launchChrome } from './browser';
import { writeEvidence } from './evidence';
import { REPO, makeDist, serveDist } from './sonicrec-serve';

const bundle = await build({ entryPoints: [join(REPO, 'tools', 'bench', 'test', 'sonicrec-recorder-page.ts')], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', write: false, logLevel: 'silent' });
const dist = makeDist({
    'en/fly/index.html': '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>sonicrec</title></head><body><script type="module" src="/fly/assets/rec.js"></script></body></html>',
    'fly/assets/rec.js': bundle.outputFiles[0]?.text ?? ''
});
const served = await serveDist(dist);
const { browser, which } = await launchChrome({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--disable-gpu', '--autoplay-policy=no-user-gesture-required'] });

const call = <T>(page: Page, fn: string, ...args: unknown[]): Promise<T> =>
    page.evaluate(([f, a]) => (window as unknown as { __rec: Record<string, (...x: unknown[]) => unknown> }).__rec[f as string]?.(...(a as unknown[])) as unknown, [fn, args] as const) as Promise<T>;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const log = (...a: unknown[]): void => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
const r1 = (x: number): number => Math.round(x * 10) / 10;

async function open(context: BrowserContext, init: Record<string, unknown> | null): Promise<Page> {
    const page = await context.newPage();
    page.on('pageerror', (e) => console.log('pageerror', e.message));
    await page.goto(`${served.origin}/en/fly/`);
    await page.waitForFunction(() => (window as unknown as { __rec?: unknown }).__rec !== undefined);
    await page.bringToFront();
    if (init !== null) await call(page, 'init', init);
    return page;
}

const phase = (page: Page): Promise<string | undefined> => call<{ phase: string } | null>(page, 'status').then((s) => s?.phase);
async function waitFor(page: Page, want: string, ms = 15000): Promise<void> {
    const t0 = Date.now();
    while ((await phase(page)) !== want) {
        if (Date.now() - t0 > ms) throw new Error(`timed out waiting for phase ${want}, now ${await phase(page)}`);
        await sleep(40);
    }
}

/** T, T with real key presses (trusted events: the microphone is asked for inside the second one). */
async function recordWithKeys(page: Page): Promise<void> {
    await page.keyboard.press('KeyT');
    await waitFor(page, 'asking');
    await page.keyboard.press('KeyT');
    await waitFor(page, 'recording');
}

async function newContext(): Promise<BrowserContext> {
    const ctx = await browser.newContext();
    await ctx.grantPermissions(['microphone'], { origin: served.origin });
    return ctx;
}

const results: Record<string, unknown> = {};
const checks: Record<string, boolean> = {};

try {
    log('browser up', JSON.stringify(which));

    // ---------------------------------------------------------------- A: the voice is as long as the flight
    {
        const ctx = await newContext();
        const page = await open(ctx, {});
        await call(page, 'clearAll');
        await recordWithKeys(page);
        await call(page, 'startSamples', 60);
        await sleep(12000);
        await call(page, 'stopSamples');
        const cost = await call<{ calls: number; p50: number; p95: number; max: number }>(page, 'cost');
        await page.keyboard.press('KeyT');
        await waitFor(page, 'idle', 20000);
        const status = await call<{ lastSessionId: string; persisted: boolean | null; durable: boolean; error: string | null }>(page, 'status');
        const a = await call<Record<string, unknown>>(page, 'analyze', status.lastSessionId);
        const spoken = await call<string[]>(page, 'spoken');
        const storage = await call(page, 'storage');
        const flightLen = a.flightLenMs as number;
        const voiceMs = a.voiceMs as number;
        const diff = Math.abs(voiceMs - flightLen);
        results.length = { analysis: a, spoken, storage, persisted: status.persisted, durable: status.durable, error: status.error, voiceMs: r1(voiceMs), flightLenMs: r1(flightLen), diffMs: r1(diff) };
        log('A: voice', r1(voiceMs), 'ms, flight', r1(flightLen), 'ms, difference', r1(diff), 'ms');
        checks['A: the package reads strictly with the voice in it (frames, events, voice, no problems)'] = (a.problems as unknown[]).length === 0 && (a.voiceBytes as number) > 5000 && (a.frames as number) > 300 && status.error === null;
        checks['A: the voice is as long as the flight within 0.2 s'] = diff <= 200;
        checks['A: control, a voice that stopped 1 s early would fail the same bound'] = Math.abs(voiceMs - 1000 - flightLen) > 200;
        checks['A: the pilot was asked, told it started, told it stopped and told it was saved'] = JSON.stringify(spoken) === JSON.stringify(['rec.ask', 'rec.started', 'rec.stopped', 'rec.saved']);
        // D: the recorder sits in the render loop
        results.cost = cost;
        checks['D: one onSample call costs well under a millisecond at the 95th percentile'] = cost.calls > 600 && cost.p95 < 1;
        await call(page, 'clearAll');
        await ctx.close();
    }

    // ---------------------------------------------------------------- B: a killed tab loses under 3 s
    const crashRun = async (label: string, init: Record<string, unknown>, afterMs: number): Promise<Record<string, unknown>> => {
        const ctx = await newContext();
        const page = await open(ctx, init);
        await call(page, 'clearAll');
        await recordWithKeys(page);
        await call(page, 'startSamples', 60);
        await sleep(afterMs);
        const emittedT = await call<number>(page, 'lastEmitted');
        const cdp = await ctx.newCDPSession(page);
        void cdp.send('Page.crash').catch(() => undefined); // the renderer dies: no pagehide, no flush (and the call never answers)
        await sleep(400);
        await page.close().catch(() => undefined);
        // a new tab in the same profile finds the unfinished session
        const second = await open(ctx, {});
        const found = await call<{ id: string; files: string[] }[]>(second, 'sessions');
        const id = found[0]?.id;
        const a: Record<string, unknown> | null = id === undefined ? null : await call<Record<string, unknown>>(second, 'analyze', id, true).catch((e: unknown): Record<string, unknown> => ({ error: String(e) }));
        await call(second, 'clearAll');
        await ctx.close();
        const recoveredLastT = a !== null && typeof a.lastT === 'number' ? a.lastT : 0;
        return { label, afterMs, emittedT: Math.round(emittedT), recoveredLastT: Math.round(recoveredLastT), lostMs: Math.round(emittedT - recoveredLastT), sessions: found.length, analysis: a };
    };
    const runs: Record<string, unknown>[] = [];
    for (const afterMs of [3200, 3500, 3800, 4100, 4400]) {
        const r = await crashRun('flush every second', { flushMs: 1000 }, afterMs);
        runs.push(r);
        log('B: killed after', afterMs, 'ms of recording, lost', r.lostMs, 'ms of flight');
    }
    const control = await crashRun('control: a recorder that never flushes', { flushMs: 3_600_000, chunkFrames: 1_000_000, chunkMs: 1e9 }, 4000);
    log('B: control lost', control.lostMs, 'ms');
    const lost = runs.map((r) => r.lostMs as number);
    results.crash = { runs: runs.map((r) => ({ afterMs: r.afterMs, emittedT: r.emittedT, recoveredLastT: r.recoveredLastT, lostMs: r.lostMs, frames: (r.analysis as Record<string, unknown> | null)?.frames, voiceBytes: (r.analysis as Record<string, unknown> | null)?.voiceBytes })), worstLostMs: Math.max(...lost), control: { lostMs: control.lostMs, frames: (control.analysis as Record<string, unknown> | null)?.frames }, recoveryNotes: (runs[0]?.analysis as { recovered?: unknown } | null)?.recovered };
    const strict = runs.every((r) => {
        const a = r.analysis as Record<string, unknown> | null;
        return a !== null && !('error' in a) && (a.problems as unknown[]).length === 0 && a.complete === false && (a.frames as number) > 60;
    });
    checks['B: every killed tab\'s session is found, recovers and reads strictly (5 of 5)'] = strict && runs.every((r) => r.sessions === 1);
    checks['B: the loss is under 3 s of flight, at every moment of the flush cycle tried'] = lost.every((x) => x < 3000 && x >= -100);
    checks['B: the voice came back too'] = runs.every((r) => ((r.analysis as Record<string, unknown> | null)?.voiceBytes as number) > 3000);
    checks['B: control, a recorder that never flushes loses the whole flight (the bound above can fail)'] = (control.lostMs as number) > 3000;

    // ---------------------------------------------------------------- C: where the voice lies against the flight's clock
    {
        const bursts = [2000, 3500, 5000, 6500];
        const ctx = await newContext();
        const page = await open(ctx, { mic: 'tones', bursts });
        await call(page, 'clearAll');
        await recordWithKeys(page);
        await call(page, 'startSamples', 60);
        await sleep(8500);
        await call(page, 'stopSamples');
        await page.keyboard.press('KeyT');
        await waitFor(page, 'idle', 20000);
        const status = await call<{ lastSessionId: string }>(page, 'status');
        const a = await call<Record<string, unknown>>(page, 'analyze', status.lastSessionId);
        const onsets = a.burstOnsetsMs as number[];
        const offset = a.voiceOffsetMs as number;
        const errs = onsets.map((o, i) => r1(offset + o - (bursts[i] as number)));
        const mean = errs.length === 0 ? null : errs.reduce((x, y) => x + y, 0) / errs.length;
        const spread = errs.length === 0 ? null : Math.max(...errs) - Math.min(...errs);
        const start = (a.voiceStartMark as { start?: { called: number; event: number } } | null)?.start;
        results.sync = { bursts, voiceOffsetMs: r1(offset), startMark: start, onsetsInVoiceMs: onsets, errorMsPerBurst: errs, meanErrorMs: mean === null ? null : r1(mean), spreadMs: spread === null ? null : r1(spread), voiceMs: a.voiceMs, flightLenMs: a.flightLenMs, errorIfTheStartEventWereTheOffsetMs: start === undefined ? null : onsets.map((o, i) => r1(start.event + o - (bursts[i] as number))) };
        log('C: error per burst', JSON.stringify(errs), 'ms; start called at', start?.called, 'ms, event at', start?.event, 'ms');
        checks['C: all four tone bursts are found in the voice'] = onsets.length === bursts.length;
        checks['C: the bursts land within 0.2 s of their recording time (the voice offset included)'] = errs.length === bursts.length && errs.every((e) => Math.abs(e) <= 200);
        checks['C: the error does not grow over 4.5 s between the first burst and the last (spread under 30 ms)'] = spread !== null && spread < 30;
        // control: a voice 300 ms out of step with the flight (a wrong offset) breaks the 0.2 s bound, so the bound can fail
        checks['C: control, a voice 300 ms out of step breaks the 0.2 s bound'] = errs.length > 0 && errs.map((e) => e + 300).some((e) => Math.abs(e) > 200);
        await call(page, 'clearAll');
        await ctx.close();
    }
} finally {
    await browser.close();
    await served.stop();
    rmSync(dist, { recursive: true, force: true });
}

const pass = Object.values(checks).every(Boolean);
writeEvidence('sonicrec-recorder', {
    pass,
    checks,
    results,
    note: 'headless Chrome, --use-fake-device-for-media-stream (A, B) and a Web Audio tone-burst stream injected as the microphone (C); real OPFS, real MediaRecorder, the live headers; the sound runtime and the samples are stand-ins until the flight lane lands. How a recording sounds is not judged here.'
});
console.log(JSON.stringify({ checks, length: (results.length as { diffMs: number }).diffMs, crash: (results.crash as { worstLostMs: number }).worstLostMs, sync: results.sync, cost: results.cost }, null, 1));
console.log(pass ? 'sonicrec-recorder PASS' : 'sonicrec-recorder FAIL');
process.exit(pass ? 0 : 1);
