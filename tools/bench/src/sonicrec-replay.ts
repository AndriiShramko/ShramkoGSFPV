// Fly by Sound, step 5: the replay of a recording in a real browser (headless Chrome, real OPFS, MediaRecorder, DOM, AudioContext and decodeAudioData, the live
// headers through serve-csp.mjs, no scan drawn: --disable-gpu, no GPU lock needed). The recorder, the helper's panel and the replay are the code the simulator
// runs; the flight lane's runtime is a stand-in (see test/sonicrec-replay-page.ts): a model host flies a lesson in real time and the microphone is tone bursts
// at known recording times. What is measured, each with a control that must fail the way the claim says it would:
//   R1 record   a flight is recorded through the real recorder (T, T, T) with the bursts as the voice; the package reads strictly
//   R2 panel    the helper's panel offers Replay on the finished recording; opening it checks the recording against the lesson with the sound package's comparer
//               and says so in a sentence; Play, the position, Pause and Close are the page's own buttons
//   R3 sync     the whole replay on the AudioContext clock: every recorded frame fed to the engine once, in order, within a display frame of its time; the
//               lesson's own lines and cues made again; the camera on the recorded track; and the voice: the tone bursts rendered by the real AudioContext
//               are found again at the time the package says (the replay's own error, in ms), and against the moment they were made on the recording clock
//   R4 clock    the same after a pause and a resume, and after a seek, so a stop does not shift the voice against the flight
//   R5 controls a voice offset shifted by 200 ms in the package is seen as about 200 ms of error by the same measurement; a package whose events were
//               changed is reported as differing; closing the replay gives the page back
//   R6 file     the saved .zip opened through the file picker's input gives the same check
//   R7 texts    the replay's texts in English, Spanish, Polish and Russian: no key shows as text
//   npx tsx tools/bench/src/sonicrec-replay.ts        evidence/<date>/sonicrec-replay.json and sonicrec-replay.png
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'esbuild';
import type { BrowserContext, Page } from 'playwright';
import { launchChrome } from './browser';
import { REPO as EVIDENCE_REPO, today, writeEvidence } from './evidence';
import { REPO, makeDist, serveDist, i18nShim } from './sonicrec-serve';
import { readPackage, Replayer, rebuildSession } from '../../../packages/sonic-fpv/src';
import type { FlightFrame } from '../../../packages/sonic-fpv/src';

const shim = i18nShim;
const bundle = await build({ entryPoints: [join(REPO, 'tools', 'bench', 'test', 'sonicrec-replay-page.ts')], outdir: 'out', bundle: true, format: 'esm', platform: 'browser', target: 'es2022', write: false, logLevel: 'silent', plugins: [shim] });
const out = (ext: string): string => bundle.outputFiles.find((f) => f.path.endsWith(ext))?.text ?? '';
/** The tap: an AudioWorklet that posts the exact audio time at which a signal first rises above 0.2 after 0.3 s of quiet (a tone burst's onset). */
const TAP = `class Tap extends AudioWorkletProcessor {
    constructor() {
        super();
        this.on = false;
        this.quietUntil = 0;
        this.port.onmessage = (e) => { this.on = e.data.on === true; this.quietUntil = 0; };
    }
    process(inputs) {
        const ch = inputs[0] && inputs[0][0];
        if (this.on && ch) {
            for (let i = 0; i < ch.length; i++) {
                if (Math.abs(ch[i]) > 0.2) {
                    const at = currentTime + i / sampleRate;
                    if (at > this.quietUntil) this.port.postMessage({ onset: at });
                    this.quietUntil = at + 0.3;
                }
            }
        }
        return true;
    }
}
registerProcessor('sonicrec-tap', Tap);
`;
const dist = makeDist({
    'fly/assets/tap.js': TAP,
    'en/fly/index.html': '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>sonicrec replay</title><link rel="stylesheet" href="/fly/assets/rep.css"><style>body{background:#07080a;color:#e8eaed;font:15px system-ui}</style></head><body><main><p>The flight page stand-in.</p></main><script type="module" src="/fly/assets/rep.js"></script></body></html>',
    'fly/assets/rep.js': out('.js'),
    'fly/assets/rep.css': out('.css')
});
const served = await serveDist(dist);
const { browser, which } = await launchChrome({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--disable-gpu', '--autoplay-policy=no-user-gesture-required'] });

const call = <T>(page: Page, fn: string, ...args: unknown[]): Promise<T> =>
    page.evaluate(([f, a]) => (window as unknown as { __rep: Record<string, (...x: unknown[]) => unknown> }).__rep[f as string]?.(...(a as unknown[])) as unknown, [fn, args] as const) as Promise<T>;
type S = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const state = (page: Page): Promise<S> => call(page, 'state');
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const log = (...a: unknown[]): void => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
const r1 = (x: number): number => Math.round(x * 10) / 10;
const stats = (xs: number[]): { n: number; min: number; mean: number; p95: number; max: number } => {
    const s = [...xs].sort((a, b) => a - b);
    return { n: s.length, min: r1(s[0] ?? 0), mean: r1(s.reduce((a, b) => a + b, 0) / Math.max(1, s.length)), p95: r1(s[Math.floor(s.length * 0.95)] ?? 0), max: r1(s.at(-1) ?? 0) };
};
const tmp = join(EVIDENCE_REPO, '.cache', 'sonicrec-replay');
mkdirSync(tmp, { recursive: true });
mkdirSync(join(EVIDENCE_REPO, 'evidence', today()), { recursive: true });

async function until(page: Page, what: string, pred: (s: S) => boolean, ms = 20000): Promise<S> {
    const t0 = Date.now();
    for (;;) {
        const s = await state(page);
        if (pred(s)) return s;
        if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}: ${JSON.stringify({ phase: s.phase, replay: s.replay })}`);
        await sleep(50);
    }
}

async function newContext(): Promise<BrowserContext> {
    const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1100, height: 900 } });
    await ctx.grantPermissions(['microphone'], { origin: served.origin });
    // no file picker: the browser downloads, as every browser without the File System Access API does (no automation drives the native dialog)
    await ctx.addInitScript({ content: 'window.showSaveFilePicker = undefined;' });
    return ctx;
}

async function open(ctx: BrowserContext, query = ''): Promise<Page> {
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log('pageerror', e.message));
    page.on('console', (m) => { if (m.type() === 'error') console.log('console.error', m.text()); });
    await page.goto(`${served.origin}/en/fly/${query}`);
    await page.waitForFunction(() => (window as unknown as { __rep?: unknown }).__rep !== undefined);
    await page.bringToFront();
    return page;
}

const results: Record<string, unknown> = {};
const checks: Record<string, boolean> = {};
/** The instrument's own error in ms: where the tap found each calibration burst against where it was put (mean, with the spread of the six). */
function biasOf(c: { scheduled: number[]; observed: number[] }): { meanMs: number; minMs: number; maxMs: number; n: number } {
    const d = c.observed.map((o, i) => (o - (c.scheduled[i] as number)) * 1000);
    return { meanMs: d.reduce((a, b) => a + b, 0) / Math.max(1, d.length), minMs: Math.min(...d), maxMs: Math.max(...d), n: d.length };
}
const BURSTS = [3000, 6000, 9000, 12000];

/** What a replay of `frames` must show: the burst times of the voice in package time. */
interface Recorded { bytes: number[]; frames: FlightFrame[]; voiceOffsetMs: number; burstsPkgMs: number[]; durationMs: number }

try {
    log('browser up', which.version);
    const ctx = await newContext();

    // ---------------------------------------------------------------- R1: a flight recorded through the real recorder, tone bursts as the voice
    const page = await open(ctx);
    await call(page, 'init', { tonesMic: true });
    await call(page, 'deleteAll');
    await page.keyboard.press('KeyT');
    await until(page, 'the question', (s) => s.phase === 'asking');
    await page.keyboard.press('KeyT');
    await until(page, 'the recording', (s) => s.phase === 'recording');
    await call(page, 'startFlight', 'rings-first', BURSTS, 13500);
    {
        const t0 = Date.now();
        for (;;) {
            const f = await call<{ done: boolean; info: Record<string, unknown> }>(page, 'flightState');
            if (f.done) {
                results.flight = f.info;
                break;
            }
            if (Date.now() - t0 > 90000) throw new Error('the model flight did not finish');
            await sleep(100);
        }
    }
    await page.keyboard.press('KeyT');
    await until(page, 'the survey offer', (s) => s.surveyOpen === true);
    await page.keyboard.press('Digit2');
    const done = await until(page, 'the recording to finish', (s) => s.phase === 'idle' && s.rows.length === 1 && s.panelOpen === true, 25000);
    const id = (done.rows as { id: string }[])[0]?.id as string;
    const bytes = await call<number[]>(page, 'packageBytes', id);
    const pkg = readPackage(new Uint8Array(bytes)); // strict
    const voice = await call<{ onsetsMs: number[]; durationMs: number }>(page, 'voiceOnsets', bytes);
    const rec: Recorded = { bytes, frames: [...pkg.frames], voiceOffsetMs: pkg.manifest.clock.voiceOffsetMs ?? 0, burstsPkgMs: voice.onsetsMs.map((o) => (pkg.manifest.clock.voiceOffsetMs ?? 0) + o), durationMs: Math.max((pkg.frames.at(-1) as FlightFrame).t, (pkg.manifest.clock.voiceOffsetMs ?? 0) + voice.durationMs) };
    const recErr = rec.burstsPkgMs.map((t, i) => t - (BURSTS[i] ?? NaN));
    results.r1 = { zipBytes: bytes.length, frames: pkg.frames.length, events: pkg.events.length, lesson: pkg.manifest.lesson?.id, voiceBytes: pkg.voice?.length ?? 0, voiceOffsetMs: rec.voiceOffsetMs, voiceMs: r1(voice.durationMs), burstsFoundInVoice: voice.onsetsMs.length, burstsPackageMs: rec.burstsPkgMs.map(r1), recordingClockErrorMs: recErr.map(r1), problems: pkg.problems.length, eventKinds: [...new Set(pkg.events.map((e) => e.kind))] };
    checks['R1: a model host flew rings-first in real time; the real recorder wrote a package that reads strictly, with voice and the lesson events'] = pkg.problems.length === 0 && pkg.frames.length > 300 && (pkg.voice?.length ?? 0) > 5000 && pkg.events.some((e) => e.kind === 'lesson' && e.what === 'open') && pkg.events.some((e) => e.kind === 'speech' && e.key === 'speech.end') && pkg.manifest.lesson?.id === 'rings-first';
    checks['R1: all four tone bursts of the microphone are in the voice (so the voice can be followed through the replay)'] = voice.onsetsMs.length === 4 && recErr.every((e) => Math.abs(e) < 40);

    // ---------------------------------------------------------------- R2 and R3: the panel, the check, one whole replay through the page's own buttons
    const panelBtn = page.locator('.sonicrec-session .btn[data-action="replay"]').first();
    const rowButtons = (done.rows as { buttons: string[] }[])[0]?.buttons ?? [];
    checks['R2: the finished recording has a Replay button beside Save to disk and Delete'] = rowButtons.includes('Replay') && rowButtons.includes('Save to disk') && rowButtons.includes('Delete');
    await call(page, 'resetCalls');
    await panelBtn.click();
    const ready = await until(page, 'the replay to be checked', (s) => (s.replay as S).status !== '' && (s.replay as S).controlsHidden === false, 30000);
    const rp = ready.replay as S;
    log('R2: status:', rp.status);
    const checkCost = await call<{ tookMs: number; frames: number; ok: boolean | null }>(page, 'checkTime', bytes);
    results.r2 = { checkCost: { ms: r1(checkCost.tookMs), frames: checkCost.frames, msPerFrame: Math.round((checkCost.tookMs / checkCost.frames) * 1000) / 1000, ok: checkCost.ok }, title: rp.title, status: rp.status, notes: rp.notes, details: rp.details.split('\n'), toggle: rp.toggle, time: rp.time, logAfterOpen: (await call<{ log: string[] }>(page, 'calls')).log };
    checks['R2: opening a recording checks it against the lesson and says so: "The replay agrees with the recording: N of N events were worked out again, and 100 % of the sounds are the same."'] = /^The replay agrees with the recording: (\d+) of \1 events were worked out again, and (9[5-9]|100) % of the sounds are the same\.$/.test(rp.status);
    checks['R2: the check is the sound package comparer\'s own line, kept in the details'] = rp.details.startsWith('replay check PASS: events ');
    checks['R2: the title names the lesson; no note is shown for a recording with a voice made in the same lesson world'] = rp.title.startsWith('rings-first') && (rp.notes as string[]).length === 0;
    checks['R2: opening and checking took nothing from the page (no playback mode, no pause, no camera)'] = (await call<{ log: string[] }>(page, 'calls')).log.length === 0;

    const cal1 = await call<{ scheduled: number[]; observed: number[] }>(page, 'calibrate');
    const bias = biasOf(cal1);
    await call(page, 'resetCalls');
    await call(page, 'tap', true);
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    const playing = await until(page, 'the replay to play', (s) => (s.replay as S).toggle === 'Pause');
    const ref = (await call<{ acS: number; tMs: number } | null>(page, 'replay', 'ref')) as { acS: number; tMs: number };
    const playerLagMs = (await call<{ player: { viewLagMs: number } }>(page, 'replayState')).player.viewLagMs;   // the lag the view is given for this run
    await sleep(2500);
    const midway = await state(page);
    await page.screenshot({ path: join(EVIDENCE_REPO, 'evidence', today(), 'sonicrec-replay.png'), fullPage: false });
    const ended = await until(page, 'the replay to end', (s) => (s.replay as S).toggle === 'Play' && (s.replay as S).position >= (s.replay as S).max - 300, Math.ceil(rec.durationMs) + 15000);
    await sleep(400);
    await call(page, 'tap', false);
    const c = await call<{ update: { t: number; at: number; tickT: number }[]; say: { key: string; at: number }[]; cue: { kind: string; at: number }[]; layers: { on: number; at: number }[]; poses: unknown[]; log: string[] }>(page, 'calls');
    const tap = await call<{ onsets: number[]; sampleRate: number; outputLatency: number; baseLatency: number }>(page, 'taps');
    const trackErr = await call<{ shown: number; maxToTrackM: number; backwardsSteps: number }>(page, 'trackError', bytes);
    // the pose shown at each call against the recorded frames blended by hand at that call's time on the audio clock (the lag the page gave it taken off)
    const lagMs = playerLagMs;
    let poseWorst = 0;
    let clockWorst = 0;
    for (const p of c.poses as { pos: number[]; at: number; tMs: number }[]) {
        const t = p.tMs;
        clockWorst = Math.max(clockWorst, Math.abs(p.tMs + Math.min(150, lagMs) - ((p.at - ref.acS) * 1000 + ref.tMs)));
        let k = -1;
        for (let i = 0; i < rec.frames.length; i++) if ((rec.frames[i] as FlightFrame).t <= t) k = i;
        const a = rec.frames[Math.max(0, k)] as FlightFrame;
        const b = rec.frames[Math.min(rec.frames.length - 1, k + 1)] as FlightFrame;
        const u = k < 0 || b === a || b.t === a.t ? 0 : Math.min(1, (t - a.t) / (b.t - a.t));
        for (let j = 0; j < 3; j++) poseWorst = Math.max(poseWorst, Math.abs((p.pos[j] as number) - ((a.p[j] as number) + ((b.p[j] as number) - (a.p[j] as number)) * u)));
    }

    // frames: every recorded frame once, in order, within a display frame of its time
    // each frame against the tick that fed it (the clock read once for the tick), and against a second read of the audio clock (which moves in audio-callback steps)
    const lateMs = c.update.map((u) => u.tickT - u.t);
    const lateAudioMs = c.update.map((u) => (u.at - (ref.acS + (u.t - ref.tMs) / 1000)) * 1000);
    // the voice: the bursts rendered by the AudioContext against where the package says they are
    const expectAc = rec.burstsPkgMs.map((t) => ref.acS + (t - ref.tMs) / 1000);
    const voiceErrRaw = tap.onsets.map((a, i) => (a - (expectAc[i] ?? NaN)) * 1000);
    const voiceErrMs = voiceErrRaw;                                                                              // the worklet's audio time is exact: nothing is taken off
    const madeErrMs = tap.onsets.map((a, i) => (a - ref.acS) * 1000 - (BURSTS[i] ?? NaN));                       // against the moment each burst was made on the recording clock
    // the lesson's own lines and cues, against what the package says and an independent run of the replay core
    const recordedLines = pkg.events.filter((e) => e.kind === 'speech' && e.key !== 'speech.end').map((e) => (e as { key: string }).key);
    const core = new Replayer({ setup: rebuildSession(pkg.manifest), frames: pkg.frames, events: pkg.events });
    let coreCues = 0;
    for (let s = core.step(); s !== null; s = core.step()) coreCues += s.actions.filter((a) => a.kind === 'cue').length;
    results.r3 = {
        reference: ref,
        frames: { recorded: rec.frames.length, fed: c.update.length, inOrder: c.update.every((u, i) => u.t === rec.frames[i]?.t), lateMsAgainstTheTicksClock: stats(lateMs), lateMsAgainstASecondReadOfTheAudioClock: stats(lateAudioMs) },
        engine: { saidLines: c.say.map((s) => s.key), recordedLines, cues: c.cue.length, coreCues, layersCalls: c.layers.length, lastLayersOn: c.layers.at(-1)?.on },
        camera: { posesShown: trackErr.shown, maxDistanceToRecordedTrackM: trackErr.maxToTrackM, maxDifferenceFromTheBlendAtItsTimeM: poseWorst, packageTimeVsAudioClockMs: r1(clockWorst), viewLagMs: r1(lagMs), outputLatencyMsNow: r1((tap.outputLatency ?? 0) * 1000) },
        voice: { burstsRendered: tap.onsets.length, expectedBursts: rec.burstsPkgMs.length, instrumentOwnErrorMs: { mean: r1(bias.meanMs), min: r1(bias.minMs), max: r1(bias.maxMs), n: bias.n }, errorVsPackageMs: voiceErrMs.map(r1), errorVsMadeOnRecordingClockMs: madeErrMs.map(r1), recordingClockErrorMs: recErr.map(r1), sampleRate: tap.sampleRate },
        lifecycle: c.log,
        panelMidway: { toggle: (midway.replay as S).toggle, time: (midway.replay as S).time, position: (midway.replay as S).position, panelToggleButton: midway.toggleText },
        panelEnd: { toggle: (ended.replay as S).toggle, time: (ended.replay as S).time, position: (ended.replay as S).position },
        playingStateSeen: (playing.replay as S).toggle
    };
    checks['R3: every recorded frame is fed to the engine exactly once, in order'] = c.update.length === rec.frames.length && c.update.every((u, i) => u.t === rec.frames[i]?.t);
    checks['R3: each frame is fed in the first tick whose clock has reached its time, never before it, and less than 25 ms after it (the page\'s tick is 16 ms)'] = lateMs.length > 300 && Math.min(...lateMs) >= 0 && Math.max(...lateMs) < 25 && Math.min(...lateAudioMs) > -2;
    checks['R3: the lesson\'s own lines come again in the recorded order, and the cues the replay core makes are all fed to the engine'] = JSON.stringify(c.say.map((s) => s.key)) === JSON.stringify(recordedLines) && recordedLines.length > 3 && c.cue.length === coreCues && coreCues > 0;
    checks['R3: the camera was given only poses on the recorded track (within 1 micrometre), and each is the recorded frames blended at the package time the player gave it (within 1 micrometre)'] = trackErr.shown > 300 && trackErr.maxToTrackM < 1e-6 && poseWorst < 1e-6;
    checks['R3: the player\'s package time for each pose is the audio clock\'s within 12 ms (one audio callback: the clock moves in steps between reads)'] = clockWorst < 12;
    checks['R3 control: the instrument finds six known tone bursts put into the same node within 3 ms of where they were put (one render quantum is 2.7 ms)'] = bias.n === 6 && Math.abs(bias.minMs) < 3 && Math.abs(bias.maxMs) < 3;
    checks['R3: all four tone bursts of the voice come out of the real AudioContext at the time the package says, within 3 ms'] = tap.onsets.length === 4 && voiceErrMs.every((e) => Math.abs(e) < 3);
    checks['R3: followed on the recording\'s own clock, each burst is heard within 30 ms of the moment it was made (the replay\'s error above plus the recording\'s own measured offset error)'] = madeErrMs.length === 4 && madeErrMs.every((e) => Math.abs(e) < 30);
    checks['R3: the page was paused with the panel reason and the mode in playback only while the replay was open and playing'] = c.log.filter((l) => !l.startsWith('engine.')).join(',') === 'playback.true,pause:panel' && c.log.filter((l) => l === 'engine.setPrefs').length === 1;
    checks['R3: the engine ends silent (layers off) and the helper\'s controls say Play with the position at the end'] = c.layers.at(-1)?.on === 0 && (ended.replay as S).toggle === 'Play';
    checks['R3: while it plays the panel\'s toggle button says Replay with the position'] = /^Replay \d+:\d\d$/.test(midway.toggleText as string) && (midway.replay as S).toggle === 'Pause';

    // close: the page is given back
    await page.getByRole('button', { name: 'Close the replay' }).click();
    const closed = await until(page, 'the replay to close', (s) => (s.replay as S).hidden === true);
    const afterClose = (await call<{ log: string[]; layers: { on: number }[] }>(page, 'calls'));
    checks['R5: closing the replay gives the page back: the camera and the flight released, the mode out of playback, the pilot\'s own prefs and theme to the engine again, the panel button as before'] = afterClose.log.filter((l) => !l.startsWith('engine.')).join(',') === 'playback.true,pause:panel,resume:panel,playback.false' && afterClose.log.filter((l) => l === 'engine.setPrefs').length === 2 && afterClose.log.filter((l) => l === 'engine.setTheme').length === 2 && closed.toggleText === 'Recording';

    // ---------------------------------------------------------------- R4: pause, resume and a seek, with the bursts as markers
    await call(page, 'resetCalls');
    await call(page, 'replayOpen', id);
    await until(page, 'the replay again', (s) => (s.replay as S).controlsHidden === false);
    await call(page, 'tap', true);
    await call(page, 'replay', 'seek', 1800);                  // before the first burst, while it has not played yet
    await call(page, 'replay', 'play');
    const refA = (await call<{ acS: number; tMs: number }>(page, 'replay', 'ref'));
    const atFirst = Math.ceil(rec.burstsPkgMs[0] as number - 1800) + 900;
    await sleep(atFirst);                                       // the first burst has sounded
    const aBurstsA = (await call<{ onsets: number[] }>(page, 'taps')).onsets.length;
    await call(page, 'replay', 'pause');
    const pausedT = (await call<{ player: { tMs: number } }>(page, 'replayState')).player.tMs;
    await sleep(1200);                                          // a silent second and more while paused
    const stillT = (await call<{ player: { tMs: number } }>(page, 'replayState')).player.tMs;
    const beforeResume = (await call<{ onsets: number[] }>(page, 'taps')).onsets.length;
    await call(page, 'replay', 'play');
    const refB = (await call<{ acS: number; tMs: number }>(page, 'replay', 'ref'));
    await sleep(Math.ceil((rec.burstsPkgMs[1] as number) - pausedT) + 900);        // the second burst, after the resume
    const aBurstsB = (await call<{ onsets: number[] }>(page, 'taps')).onsets.length;
    const refC = (await call<{ acS: number; tMs: number }>(page, 'replay', 'seek', 7800));
    await sleep(Math.ceil((rec.burstsPkgMs[2] as number) - 7800) + 900);                // the third, after a seek made while playing
    const tapC = await call<{ onsets: number[] }>(page, 'taps');
    await call(page, 'replay', 'pause');
    await call(page, 'tap', false);
    const calls4 = await call<{ update: { t: number; at: number }[]; layers: { on: number }[] }>(page, 'calls');
    const errA = ((tapC.onsets[0] as number) - (refA.acS + ((rec.burstsPkgMs[0] as number) - refA.tMs) / 1000)) * 1000;
    const errB = ((tapC.onsets[1] as number) - (refB.acS + ((rec.burstsPkgMs[1] as number) - refB.tMs) / 1000)) * 1000;
    const errC = ((tapC.onsets[2] as number) - (refC!.acS + ((rec.burstsPkgMs[2] as number) - refC!.tMs) / 1000)) * 1000;
    // frames after the seek are the frames from there: none before it, none repeated
    const afterSeekFrames = calls4.update.filter((u) => u.at > refC!.acS + 0.005).map((u) => u.t);
    results.r4 = { pausedAtMs: r1(pausedT), heldWhilePausedMs: r1(stillT - pausedT), burstsHeardBeforePauseResume: aBurstsA, burstsHeardWhilePaused: beforeResume - aBurstsA, burstsAfterResume: aBurstsB, burstErrorMs: { firstAfterSeekToBefore: r1(errA), afterPauseResume: r1(errB), afterSeekWhilePlaying: r1(errC) }, framesAfterSeek: { first: afterSeekFrames[0], last: afterSeekFrames.at(-1), n: afterSeekFrames.length } };
    checks['R4: a first burst sounds after a seek made before Play, at the time the package says (within 3 ms)'] = Math.abs(errA) < 3 && aBurstsA === 1;
    checks['R4: while paused nothing sounds and the position holds exactly'] = beforeResume === aBurstsA && stillT === pausedT;
    checks['R4: after Pause and Play the next burst comes where the package says (within 3 ms): a stop did not shift the voice against the flight'] = Math.abs(errB) < 3 && aBurstsB === 2;
    checks['R4: after a seek made while playing the voice jumps with the frames: the burst comes where the package says (within 3 ms)'] = Math.abs(errC) < 3 && tapC.onsets.length === 3;
    checks['R4: after the seek only frames from the seek on were fed, each once'] = afterSeekFrames.length > 20 && (afterSeekFrames[0] as number) >= 7800 - 40 && afterSeekFrames.every((t, i) => i === 0 || t > (afterSeekFrames[i - 1] as number));
    await call(page, 'replay', 'close');

    const cal2 = biasOf(await call<{ scheduled: number[]; observed: number[] }>(page, 'calibrate'));
    results.instrumentErrorAfterwardsMs = { mean: r1(cal2.meanMs), min: r1(cal2.minMs), max: r1(cal2.maxMs) };
    checks['R4 control: the instrument checked again after the replays still finds the known bursts within 3 ms'] = Math.abs(cal2.minMs) < 3 && Math.abs(cal2.maxMs) < 3;

    // ---------------------------------------------------------------- R5: controls, the same measurement made to fail
    await call(page, 'resetCalls');
    await call(page, 'replayOpenBytes', bytes, 200);            // the voice starts 200 ms later than the manifest said at recording
    await until(page, 'the shifted package to open', (s) => (s.replay as S).controlsHidden === false);
    await call(page, 'tap', true);
    await call(page, 'replay', 'play');
    const refS = (await call<{ acS: number; tMs: number }>(page, 'replay', 'ref'));
    await sleep(Math.ceil(rec.burstsPkgMs[0] as number) + 1200);
    const tapS = await call<{ onsets: number[] }>(page, 'taps');
    await call(page, 'replay', 'close');
    await call(page, 'tap', false);
    const shiftedErr = ((tapS.onsets[0] as number) - (refS.acS + ((rec.burstsPkgMs[0] as number) - refS.tMs) / 1000)) * 1000;
    results.r5 = { shiftedVoiceOffsetErrorMs: r1(shiftedErr) };
    checks['R5 control: a voice whose offset is changed by 200 ms in the package is heard 200 ms from where the original says (the measurement can see a misalignment, 197 to 203 ms)'] = tapS.onsets.length >= 1 && shiftedErr > 197 && shiftedErr < 203;

    // a package whose events were changed: the replay is reported as differing, in words, and it still plays as recorded
    await call(page, 'replayOpenTampered', bytes);
    const differing = await until(page, 'the changed package to open', (s) => (s.replay as S).status !== '' && (s.replay as S).controlsHidden === false, 30000);
    results.r5tampered = { status: (differing.replay as S).status, details: (differing.replay as S).details.split('\n')[0] };
    checks['R5 control: a package whose events were changed is reported as differing ("The replay differs from the recording ..."), and the comparer line says FAIL'] = /^The replay differs from the recording in \d+ event\(s\): /.test((differing.replay as S).status) && (differing.replay as S).details.startsWith('replay check FAIL');
    await call(page, 'replay', 'close');

    // ---------------------------------------------------------------- R6: the saved file through the file input
    {
        const [download] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.getByRole('button', { name: 'Save to disk' }).first().click()]);
        const path = join(tmp, `saved-${Date.now()}.zip`);
        await download.saveAs(path);
        const saved = readFileSync(path);
        await page.locator('input[data-testid="replay-file"]').setInputFiles(path);
        const viaFile = await until(page, 'the file to open', (s) => (s.replay as S).status !== '' && (s.replay as S).controlsHidden === false, 30000);
        results.r6 = { fileBytes: saved.length, status: (viaFile.replay as S).status, title: (viaFile.replay as S).title };
        checks['R6: the saved .zip opened through the "Open a recording file" input gives the same check as the session in the browser\'s storage'] = (viaFile.replay as S).status === rp.status && saved.length === bytes.length;
        await page.getByRole('button', { name: 'Close the replay' }).click();
    }
    await page.close();

    // ---------------------------------------------------------------- R7: the texts in four languages
    {
        const langs: Record<string, [string, string]> = {};
        for (const lang of ['en', 'es', 'pl', 'ru']) {
            const p = await open(ctx, `?lang=${lang}`);
            await call(p, 'init', {});
            await sleep(300);
            await call(p, 'replayOpenBytes', bytes);
            await until(p, 'the replay to open', (s) => (s.replay as S).status !== '', 30000);
            await p.evaluate(() => document.getElementById('sonicrec-toggle')?.click());
            await sleep(200);
            const st = await state(p);
            const all = [st.panelText as string, await p.evaluate(() => [...document.querySelectorAll('.sonicrec-panel [aria-label]')].map((x) => x.getAttribute('aria-label') ?? '').join(' '))].join(' ');
            langs[lang] = [all.includes('sonicrec.') ? 'MISSING KEY' : 'ok', (st.replay as S).status.slice(0, 70)];
            await p.close();
        }
        results.r7 = langs;
        checks['R7: the replay section in English, Spanish, Polish and Russian shows no missing key, and the check sentence is translated'] = Object.values(langs).every((v) => v[0] === 'ok') && new Set(Object.values(langs).map((v) => v[1])).size === 4;
    }
    await ctx.close();
} finally {
    await browser.close();
    await served.stop();
    rmSync(dist, { recursive: true, force: true });
    rmSync(tmp, { recursive: true, force: true });
}

const pass = Object.values(checks).every(Boolean);
writeEvidence('sonicrec-replay', {
    pass,
    checks,
    results,
    note: 'headless Chrome 156, real OPFS, MediaRecorder, AudioContext and decodeAudioData; the recorder, panel, check, player and voice are the simulator\'s code; the flight lane\'s runtime is a stand-in (a model host of the sound package flies the lesson in real time, the engine records its calls, the microphone is tone bursts at known times, a tap in front of the destination finds them again). How a replay sounds or looks is not judged here.'
});
console.log(JSON.stringify({ checks }, null, 1));
console.log(pass ? 'sonicrec-replay PASS' : 'sonicrec-replay FAIL');
process.exit(pass ? 0 : 1);
