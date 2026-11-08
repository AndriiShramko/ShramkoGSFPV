// v0.12 v12-int step 7 (docs/wip/v12-int.md): Fly by Sound END TO END in the real page, nothing stood in for ctx.sonic. One release build of
// this tree is served by tools/bench/scripts/serve-csp.mjs (nginx's enforced CSP and headers) with API_PROXY to a LOCAL copy of the real
// recordings' API (apps/api/tests/rig_server.py: the real handler, store and delivery workers; only Telegram and SMTP are fakes on this
// machine). Headless Chrome with a FAKE MICROPHONE that plays a WAV of tone bursts (--use-fake-device-for-media-stream and
// --use-file-for-fake-audio-capture: a 1 kHz tone, 80 ms every 1.5 s, the ground truth of the voice's timing), the keyboard only.
//
//   A  an adult, the first flight
//      ?sonic=ears-headphones; T asks and T agrees; the recording starts and the running lesson opens again from its beginning; the lesson
//      pilot passes it (N for the intro, a digit for each question) and the path moves on to ears-glossary while recording, N goes
//      through its previews; T stops; survey.mic-on then survey.offer, the first flight's questions answered by keys (one open answer by
//      voice, one skipped); saved; the panel's Save gives the package (read strictly here); the REPLAY of that recording from the panel,
//      lesson by lesson (every event re-derived, the sounds, each world drawn in turn, the voice within 0.2 s of its place on the package's
//      clock); U, U sends it: the rig's stored file, its Telegram document and its mail attachment all have the local package's SHA-256.
//   B  a child, the guardian's consent confirmed
//      the same profile with `minor` set; T says rec.minor and asks; a flown lesson (hover-height) records; the survey is the child variant
//      answered by keys; the recording replays as checked; U, U sends it; the same three SHA-256 at the rig.
//
// Every check that fails makes the run exit 1; the evidence is evidence/<date>/sonic-e2e.json. Run it from tools/bench after
//   node scripts/build-release.mjs                                   (the release build of the tree; dist/ is untracked)
//   npx tsx src/sonic-e2e.ts
// Ports 5410 (the site), 5411 (the API copy), 5412 (its control). The run holds the GPU lock (the helper's view is drawn), writes a worklet
// file into dist/fly/assets for its replay measure and removes it, and puts a WAV and the saved packages (a voice is never committed)
// into the system's temporary folder.
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, rmdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BrowserContext, Page, Request } from 'playwright';
import { SCHEMA_VERSION } from '../../../packages/prefs/src';
import { defaultPrefs, readPackage } from '../../../packages/sonic-fpv/src';
import type { SessionPackage } from '../../../packages/sonic-fpv/src';
import { checkPackage } from '../../../apps/fly/src/sonic-session/replay-check';
import { launchChrome } from './browser';
import { gitSha, REPO, writeEvidence } from './evidence';
import { startRig } from './sonicrec-rig';
import type { Rig } from './sonicrec-rig';
import { serveDist } from './sonicrec-serve';
import type { Served } from './sonicrec-serve';

const PORT_SITE = 5410;
const PORT_API = 5411;
const PORT_CONTROL = 5412;
const DIST = join(REPO, 'dist');
const LOCK = 'C:/dev/.gpu-lock';
const TAP_FILE = join(DIST, 'fly', 'assets', 'e2e-tap.js');
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const T0 = Date.now();
const log = (...a: unknown[]): void => console.log(`[${((Date.now() - T0) / 1000).toFixed(0).padStart(4)}s]`, ...a);

// ------------------------------------------------------------------------------------------------ the checks

interface Check {
    name: string;
    pass: boolean;
    value?: unknown;
}
const checks: Check[] = [];
const check = (name: string, pass: boolean, value?: unknown): boolean => {
    checks.push({ name, pass, value });
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${value === undefined ? '' : '  ' + JSON.stringify(value).slice(0, 360)}`);
    return pass;
};

// ------------------------------------------------------------------------------------------------ the GPU lock

async function lock(): Promise<void> {
    let waited = 0;
    for (;;) {
        try {
            mkdirSync(LOCK);
            return;
        } catch {
            try {
                if (Date.now() - statSync(LOCK).mtimeMs > 30 * 60 * 1000) {
                    rmdirSync(LOCK);
                    continue;
                }
            } catch {
                /* gone */
            }
            if (!waited++ || waited % 600 === 0) log('waiting for the GPU lock');
            await sleep(100);
        }
    }
}
let locked = false;
const unlock = (): void => {
    if (!locked) return;
    locked = false;
    try {
        rmdirSync(LOCK);
    } catch {
        /* not ours */
    }
};

// ------------------------------------------------------------------------------------------------ the fake microphone

const MIC_PERIOD_S = 12;
/** 16-bit mono PCM, 48 kHz: a 1 kHz tone of 80 ms every 1.5 s from 0.5 s on, `MIC_PERIOD_S` long (it loops: eight bursts to the period). */
function toneBurstWav(): Buffer {
    const rate = 48000;
    const n = MIC_PERIOD_S * rate;
    const pcm = Buffer.alloc(n * 2);
    for (let i = 0; i < n; i++) {
        const t = i / rate;
        const into = (t - 0.5) % 1.5;
        const v = t >= 0.5 && into < 0.08 ? Math.sin(2 * Math.PI * 1000 * t) * 0.8 : 0;
        pcm.writeInt16LE(Math.round(v * 32767), i * 2);
    }
    const h = Buffer.alloc(44);
    h.write('RIFF', 0);
    h.writeUInt32LE(36 + pcm.length, 4);
    h.write('WAVEfmt ', 8);
    h.writeUInt32LE(16, 16);
    h.writeUInt16LE(1, 20);
    h.writeUInt16LE(1, 22);
    h.writeUInt32LE(rate, 24);
    h.writeUInt32LE(rate * 2, 28);
    h.writeUInt16LE(2, 32);
    h.writeUInt16LE(16, 34);
    h.write('data', 36);
    h.writeUInt32LE(pcm.length, 40);
    return Buffer.concat([h, pcm]);
}

/** The worklet that finds a burst's onset on the audio clock (the replay's voice goes through it): the exact time of the first sample over 0.2 after 0.3 s of quiet. */
const TAP = `class E2eTap extends AudioWorkletProcessor {
  constructor() { super(); this.quietUntil = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) for (let i = 0; i < ch.length; i++) if (Math.abs(ch[i]) > 0.2) { const at = currentTime + i / sampleRate; if (at > this.quietUntil) this.port.postMessage({ onset: at }); this.quietUntil = at + 0.3; }
    return true;
  }
}
registerProcessor('e2e-tap', E2eTap);
`;

// ------------------------------------------------------------------------------------------------ what the page gets before it runs

/** The prefs document: the engine silent (a screen reader would speak) at double speed, so the run is not made of speech; the warning seen. */
function prefsDoc(): object {
    return {
        format: 'gsfpv-prefs',
        version: SCHEMA_VERSION,
        app: '0.3.0',
        savedAt: '2026-11-07T00:00:00.000Z',
        settings: { global: {}, drone: {}, scene: {} },
        collections: { sonic: { v: 1, prefs: { ...defaultPrefs(), selfVoice: false, speechRate: 2 }, progress: {}, current: null }, ui: { v: 1, warned: true } }
    };
}

/**
 * Before the page's own scripts: the prefs, optionally a pilot profile; an accumulator of the mode's events (the page's log keeps the
 * last 600 and a run is longer: this reads it every 40 ms and keeps what is new); the replay's voice watched (the decoded buffer's onsets, where
 * the source starts, where each burst comes out of the AudioContext); no native save dialog (the panel's Save is a download).
 */
const initScript = (profile: object | null): string => `(() => {
  window.__name = (f) => f;
  try {
    if (!localStorage.getItem('gsfpv.prefs.v1')) localStorage.setItem('gsfpv.prefs.v1', ${JSON.stringify(JSON.stringify(prefsDoc()))});
    ${profile === null ? '' : `if (!localStorage.getItem('gsfpv.sonicrec.profile')) localStorage.setItem('gsfpv.sonicrec.profile', ${JSON.stringify(JSON.stringify(profile))});`}
  } catch (e) {}
  try { delete window.showSaveFilePicker; } catch (e) {}
  window.__e2e = { events: [], seen: 0, last: null };
  setInterval(() => {
    const h = window.__gsfpv && window.__gsfpv.sonic;
    if (!h) return;
    const ev = h(true).events;
    if (ev.length === 0) return;
    const e2e = window.__e2e;
    let from = 0;
    if (e2e.last !== null) {
      from = ev.length;
      for (let i = ev.length - 1; i >= 0; i--) if (JSON.stringify(ev[i]) === e2e.last) { from = i + 1; break; }
      if (from === ev.length && JSON.stringify(ev[ev.length - 1]) !== e2e.last) from = 0;
    }
    for (let i = from; i < ev.length; i++) e2e.events.push(ev[i]);
    e2e.last = JSON.stringify(ev[ev.length - 1]);
  }, 40);
  window.__voice = { decoded: null, duration: 0, fileOnsets: [], starts: [], onsets: [], tap: null };
  const dec = BaseAudioContext.prototype.decodeAudioData;
  BaseAudioContext.prototype.decodeAudioData = function (data, ...rest) {
    const ctx = this;
    return dec.call(this, data, ...rest).then((buf) => {
      if (buf.duration > 2) {
        window.__voice.decoded = buf;
        window.__voice.duration = buf.duration;
        const ch = buf.getChannelData(0), sr = buf.sampleRate, on = [];
        let quiet = -1e9;
        for (let i = 0; i < ch.length; i++) if (Math.abs(ch[i]) > 0.2) { const t = i / sr; if (t > quiet) on.push(t); quiet = t + 0.3; }
        window.__voice.fileOnsets = on;
        ctx.audioWorklet.addModule('/fly/assets/e2e-tap.js').then(() => {
          const node = new AudioWorkletNode(ctx, 'e2e-tap', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
          const mute = ctx.createGain();
          mute.gain.value = 0;
          node.connect(mute);
          mute.connect(ctx.destination);
          node.port.onmessage = (e) => window.__voice.onsets.push(e.data.onset);
          window.__voice.tap = node;
        });
      }
      return buf;
    });
  };
  const start = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (when, offset, duration) {
    if (this.buffer && this.buffer === window.__voice.decoded) {
      window.__voice.starts.push({ when, offset, now: this.context.currentTime });
      if (window.__voice.tap) this.connect(window.__voice.tap);
    }
    return start.call(this, when, offset, duration);
  };
})();`;

// ------------------------------------------------------------------------------------------------ talking to the page

interface Ev {
    kind: string;
    t: number;
    key?: string;
    text?: string;
    what?: string;
    lessonId?: string;
    via?: string;
    value?: number | null;
}
interface Probe {
    lesson: string | null;
    phase: string | null;
    attempt: number;
    asking: boolean;
    question: { id: string; options: number } | null;
    engine: string;
    pos: [number, number, number];
    armed: boolean;
    speechQueue: number;
    stagePrims: number;
}
type Hook = { __gsfpv: { sonic: (e?: boolean) => unknown; sonicReplay?: () => unknown; status?: string } };

const probe = (page: Page): Promise<Probe> => page.evaluate(() => (window as unknown as Hook).__gsfpv.sonic(false)) as Promise<Probe>;
/** Everything the mode has said and done since the page began (the accumulator of the init script). */
const events = (page: Page): Promise<Ev[]> => page.evaluate(() => (window as unknown as { __e2e: { events: unknown[] } }).__e2e.events) as Promise<Ev[]>;
const countOf = async (page: Page): Promise<number> => (await events(page)).length;
const spokenAfter = (all: readonly Ev[], from: number): string[] => all.slice(from).filter((e) => e.kind === 'speech' && e.key !== 'speech.end').map((e) => e.key ?? '');

/** Polls in the page (no waitForFunction: the release's CSP refuses a predicate made with new Function). */
async function until<T>(what: string, read: () => Promise<T>, pred: (v: T) => boolean, ms = 30000, every = 100): Promise<T> {
    const t0 = Date.now();
    for (;;) {
        const v = await read();
        if (pred(v)) return v;
        if (Date.now() - t0 > ms) throw new Error(`timed out (${Math.round(ms / 1000)} s) waiting for ${what}: ${JSON.stringify(v).slice(0, 500)}`);
        await sleep(every);
    }
}

const problems: string[] = [];
const requests: { method: string; path: string; headers: Record<string, string>; body: unknown }[] = [];

async function newContext(browserCtx: () => Promise<BrowserContext>, served: Served, profile: object | null): Promise<BrowserContext> {
    const ctx = await browserCtx();
    await ctx.grantPermissions(['microphone'], { origin: served.origin });
    await ctx.addInitScript({ content: initScript(profile) });
    ctx.on('request', (r: Request) => {
        const u = new URL(r.url());
        if (!u.pathname.startsWith('/api/session')) return;
        let body: unknown = null;
        try {
            body = r.postDataJSON();
        } catch {
            body = null;
        }
        requests.push({ method: r.method(), path: u.pathname.replace(/S-\d{8}-[0-9a-f]{12}/, '<id>'), headers: r.headers(), body });
    });
    return ctx;
}

/** /en/fly/?sonic=<lesson>, Enter on the start screen's button (the user activation); the lesson runs and the recorder's panel is there. */
async function openLesson(ctx: BrowserContext, served: Served, lesson: string, label: string): Promise<Page> {
    const page = await ctx.newPage();
    page.on('pageerror', (e) => problems.push(`${label}: pageerror ${e.message.slice(0, 300)}`));
    page.on('console', (m) => {
        // a failed request is logged as a console error without its address: the response handler below names it
        if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) problems.push(`${label}: console ${m.text().slice(0, 300)}`);
    });
    page.on('response', (r) => {
        if (r.status() >= 400 && !/\/favicon\.ico$/.test(r.url())) problems.push(`${label}: ${r.status()} ${new URL(r.url()).pathname}`);
    });
    await page.goto(`${served.origin}/en/fly/?sonic=${lesson}&nowarn=1`);
    await until('the start screen', () => page.evaluate(() => !!document.querySelector('[data-testid="sonic-start-asked"]')), (v) => v, 60000);
    await page.focus('[data-testid="sonic-start-asked"]');
    await page.keyboard.press('Enter');
    await until(`lesson ${lesson}`, async () => ((await page.evaluate(() => (window as unknown as Hook).__gsfpv?.status ?? null)) === 'ready' ? (await probe(page)).lesson : null), (v) => v === lesson, 90000);
    await until('the recordings panel', () => page.evaluate(() => !!document.querySelector('.sonicrec-toggle')), (v) => v, 30000);
    return page;
}

const recordingOn = (page: Page): Promise<boolean> => page.evaluate(() => document.querySelector('.sonicrec-toggle')?.classList.contains('recording') === true);

/** T asks, T agrees (a press before the question has been read out is ignored: press until the recording runs). Returns the index of the events at the first press. */
async function startRecording(page: Page, asks: string[]): Promise<{ from: number; said: string[] }> {
    const from = await countOf(page);
    await page.keyboard.press('KeyT');
    await until('the question', () => events(page), (all) => asks.every((k) => spokenAfter(all, from).includes(k)), 20000);
    for (let t0 = Date.now(); !(await recordingOn(page)) && Date.now() - t0 < 60000; ) {
        await sleep(2500);
        if (await recordingOn(page)) break;
        if (spokenAfter(await events(page), from).includes('rec.started')) break;
        await page.keyboard.press('KeyT');
    }
    await until('the recording', () => recordingOn(page), (v) => v, 20000);
    return { from, said: spokenAfter(await events(page), from) };
}

/** The lesson pilot of ears-headphones (the lane's, sonic-lessons-page.ts): N for the intro, a digit for each question from the sound that was played. */
async function passEarsHeadphones(page: Page): Promise<void> {
    let skipped = false;
    let answered = '';
    const t0 = Date.now();
    for (;;) {
        const p = await probe(page);
        if ((await events(page)).some((e) => e.kind === 'lesson' && e.what === 'passed' && e.lessonId === 'ears-headphones')) return;
        if (Date.now() - t0 > 240000) throw new Error(`ears-headphones was not passed in 4 minutes: ${JSON.stringify(p)}`);
        if (p.lesson !== 'ears-headphones') throw new Error(`the page left ears-headphones before it was passed: ${JSON.stringify(p)}`);
        if (!skipped && p.phase === 'intro') {
            skipped = true;
            await page.keyboard.press('KeyN');
        } else if (p.asking && p.speechQueue === 0 && p.question && answered !== p.question.id) {
            answered = p.question.id;
            // the runner plays left, right, behind: 1, 2, 2
            await page.keyboard.press(`Digit${Number(p.question.id.split(':')[2]) === 1 ? 1 : 2}`);
        }
        await sleep(60);
    }
}

// ------------------------------------------------------------------------------------------------ the survey

interface Asked {
    n: number;
    total: number;
    kind: 'scale' | 'choice' | 'open';
    digits: number[];
    pressed: string;
    at: number;
}
/**
 * Answers the survey by keys, as a pilot does: the offer with 1, a scale in its middle, a choice with 1, the first open answer by voice and
 * Enter (the microphone is on: the bursts go into the recording), the next open one skipped with Escape. Reads the dialog, which the
 * recorder draws for the helper (the digits as buttons, Done for an open answer).
 */
async function answerSurvey(page: Page, label: string, from: number): Promise<{ asked: Asked[] }> {
    await until('survey.offer spoken', () => events(page), (all) => spokenAfter(all, from).includes('survey.offer'), 30000);
    await sleep(500);
    await page.keyboard.press('Digit1');
    const asked: Asked[] = [];
    let opens = 0;
    let last = 0;
    const t0 = Date.now();
    for (;;) {
        const s = await page.evaluate(() => {
            const root = document.querySelector('.sonicrec-survey') as HTMLElement | null;
            if (!root || root.hidden) return { open: false, progress: '', digits: [] as number[], done: false };
            return { open: true, progress: root.querySelector('.sonicrec-progress')?.textContent ?? '', digits: [...root.querySelectorAll('[data-digit]')].map((b) => Number(b.getAttribute('data-digit'))), done: !!root.querySelector('[data-action="done"]') };
        });
        if (!s.open && asked.length > 0) break;
        if (Date.now() - t0 > 240000) throw new Error(`${label}: the survey did not end in 4 minutes: ${JSON.stringify({ s, asked: asked.length })}`);
        const m = /(\d+) of (\d+)/.exec(s.progress);
        if (s.open && m && Number(m[1]) > last) {
            const n = Number(m[1]);
            last = n;
            await sleep(450);
            let key: string;
            let kind: Asked['kind'];
            if (s.done) {
                kind = 'open';
                key = opens++ === 0 ? 'Enter' : 'Escape';
                if (key === 'Enter') await sleep(1800);
            } else if (s.digits.length >= 5) {
                kind = 'scale';
                key = `Digit${s.digits[Math.floor(s.digits.length / 2)]}`;
            } else {
                kind = 'choice';
                key = 'Digit1';
            }
            await page.keyboard.press(key);
            asked.push({ n, total: Number(m[2]), kind, digits: s.digits, pressed: key, at: Date.now() - t0 });
        }
        await sleep(80);
    }
    return { asked };
}

// ------------------------------------------------------------------------------------------------ the package, the replay, the sending

const sha256 = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

/** The panel's Save (a download here: the native picker is removed): the bytes of the package as the panel gives them. */
async function savePackage(page: Page, name: string, dir: string): Promise<{ file: string; bytes: Uint8Array }> {
    await page.evaluate(() => {
        const b = document.querySelector('.sonicrec-toggle') as HTMLElement | null;
        if (b && document.querySelector('.sonicrec-panel')?.hasAttribute('hidden')) b.click();
    });
    await until('the recording listed as finished', () => page.evaluate(() => !!document.querySelector('.sonicrec-session [data-action="save"]')), (v) => v, 30000);
    const dl = page.waitForEvent('download', { timeout: 30000 });
    await page.focus('.sonicrec-session [data-action="save"]');
    await page.keyboard.press('Enter');
    const file = join(dir, `${name}.zip`);
    await (await dl).saveAs(file);
    return { file, bytes: new Uint8Array(readFileSync(file)) };
}

interface ReplayHook {
    state: { stage: string; title: string; check: { ok: boolean; summary: string } | null; notes: string[]; details: string; player: { phase: string; tMs: number; durationMs: number; lesson: string | null; part: number; parts: number; frame: number; frames: number } | null };
    trace: { fed: { t: number; ac: number; part: number }[]; switches: { t: number; ac: number; part: number; lesson: string | null; world: string | null; shown: boolean }[]; voiceStarts: { t: number; ac: number }[] } | null;
    checks: { lesson: string | null; frames: number; compared: boolean; ok: boolean | null; recorded: number; matched: number; diffs: number; cueShare: number | null; cueClassShare: number | null }[];
}
const replayHook = (page: Page): Promise<ReplayHook | null> => page.evaluate(() => (window as unknown as Hook).__gsfpv.sonicReplay?.() ?? null) as Promise<ReplayHook | null>;

/** The panel's Replay on the recording, checked: the rows of the check, one per lesson. */
async function openReplay(page: Page): Promise<ReplayHook> {
    await page.evaluate(() => {
        const b = document.querySelector('.sonicrec-toggle') as HTMLElement | null;
        if (b && document.querySelector('.sonicrec-panel')?.hasAttribute('hidden')) b.click();
    });
    await until('the replay button', () => page.evaluate(() => !!document.querySelector('.sonicrec-session [data-action="replay"]')), (v) => v, 30000);
    await page.focus('.sonicrec-session [data-action="replay"]');
    await page.keyboard.press('Enter');
    return (await until('the replay checked', () => replayHook(page), (h) => h?.state.stage === 'ready' || h?.state.stage === 'error', 90000)) as ReplayHook;
}

/** The sending: U asks, a second U (after the question has been read out) is the pilot's separate yes; waits for what the pilot hears and for the server. */
async function sendByU(page: Page, rig: Rig, sha: string): Promise<{ said: string[]; from: number }> {
    const from = await countOf(page);
    await page.keyboard.press('KeyU');
    await until('the send question', () => events(page), (all) => spokenAfter(all, from).includes('send.confirm'), 20000);
    for (let t0 = Date.now(); Date.now() - t0 < 60000; ) {
        await sleep(2000);
        const said = spokenAfter(await events(page), from);
        if (said.includes('send.sending') || (await rig.state()).sessions.some((s: { sha256: string }) => s.sha256 === sha)) break;
        await page.keyboard.press('KeyU');
    }
    await until('delivered', () => events(page), (all) => spokenAfter(all, from).includes('send.delivered'), 60000);
    return { said: spokenAfter(await events(page), from), from };
}

interface RigSession {
    id: string;
    bytes: number;
    sha256: string;
    delivered: boolean;
    channels: { telegram: string; email: string };
}
/** What the rig holds for this package: its record, the stored file hashed here, the Telegram documents and the mail attachments with this SHA-256. */
async function atTheRig(rig: Rig, sha: string): Promise<{ record: RigSession | undefined; storedFileSha: string | null; telegram: number; mail: number; documents: number; messages: number }> {
    const st = await rig.state();
    const record = (st.sessions as RigSession[]).find((s) => s.sha256 === sha);
    let storedFileSha: string | null = null;
    if (record) {
        try {
            storedFileSha = sha256(new Uint8Array(readFileSync(join(rig.data, 'sessions', record.id, 'package.zip'))));
        } catch {
            storedFileSha = null;
        }
    }
    return {
        record,
        storedFileSha,
        telegram: (st.telegram.documents as { sha256: string }[]).filter((d) => d.sha256 === sha).length,
        mail: (st.mail.messages as { attachment: { sha256: string } | null }[]).filter((m) => m.attachment?.sha256 === sha).length,
        documents: st.telegram.documents.length,
        messages: st.mail.messages.length
    };
}

const counts = (xs: readonly { kind: string }[]): Record<string, number> => {
    const c: Record<string, number> = {};
    for (const x of xs) c[x.kind] = (c[x.kind] ?? 0) + 1;
    return c;
};
const indexOfKey = (evs: readonly { kind: string; key?: string }[], key: string): number => evs.findIndex((e) => e.kind === 'speech' && e.key === key);

// ------------------------------------------------------------------------------------------------ the scenarios

const result: Record<string, unknown> = {};

async function scenarioAdult(ctx: BrowserContext, served: Served, rig: Rig, tmp: string): Promise<void> {
    log('A: an adult, the first flight');
    const page = await openLesson(ctx, served, 'ears-headphones', 'A');
    await sleep(1000);
    check('A: the real runtime: the page flies ears-headphones, the engine runs, the recorder\'s panel is there (ctx.sonic is set)', (await probe(page)).engine === 'running', await probe(page));
    // 1. T asks, T agrees: the recording runs; the running lesson opens again from its beginning
    const started = await startRecording(page, ['rec.ask']);
    const reopened = await until('the lesson opened again', () => events(page), (all) => all.slice(started.from).some((e) => e.kind === 'lesson' && e.what === 'open' && e.lessonId === 'ears-headphones'), 15000).catch(() => null);
    check('A: T asks (rec.ask) and the second T records (rec.started); the running lesson opened again from its beginning inside the recording', started.said.includes('rec.ask') && started.said.includes('rec.started') && reopened !== null, started.said);
    // 2. the lesson pilot passes it; the path moves on while recording
    log('A: passing ears-headphones');
    await passEarsHeadphones(page);
    const glossary = await until('ears-glossary', () => events(page), (all) => all.slice(started.from).some((e) => e.kind === 'lesson' && e.what === 'open' && e.lessonId === 'ears-glossary'), 60000);
    const opensA = glossary.slice(started.from).filter((e) => e.kind === 'lesson' && e.what === 'open').map((e) => e.lessonId);
    check('A: the pass moved the path on to ears-glossary while recording (lesson opens: ears-headphones, ears-glossary)', opensA.join(',') === 'ears-headphones,ears-glossary', opensA);
    // 3. N through the glossary's previews, then T stops
    for (let i = 0; i < 8; i++) {
        await sleep(1300);
        await page.keyboard.press('KeyN');
    }
    const survey0 = await countOf(page);
    await page.keyboard.press('KeyT');
    log('A: stopped; the survey');
    const { asked } = await answerSurvey(page, 'A', survey0);
    await until('the recording saved', () => events(page), (all) => spokenAfter(all, survey0).includes('rec.saved'), 60000);
    await until('the recorder idle', () => recordingOn(page), (v) => !v, 30000);
    const heard = spokenAfter(await events(page), survey0);
    const iOn = heard.indexOf('survey.mic-on');
    const iOffer = heard.indexOf('survey.offer');
    const iThanks = heard.indexOf('survey.thanks');
    const iStopped = heard.indexOf('rec.stopped');
    const iSaved = heard.indexOf('rec.saved');
    check('A: the survey: survey.mic-on, then survey.offer; at the end survey.thanks, then rec.stopped (the microphone let go), then rec.saved', iOn >= 0 && iOn < iOffer && iOffer < iThanks && iThanks < iStopped && iStopped < iSaved, heard.filter((k) => /^(survey\.(mic-on|offer|thanks|intro|howto)|rec\.)/.test(k)));
    check('A: the first flight\'s survey asked 9 questions in the dialog, answered by keys (scales in the middle, a choice with 1, one open answer by voice, one skipped)', asked.length === 9 && asked.every((q) => q.total === 9) && asked.filter((q) => q.kind === 'open').length === 2, asked.map((q) => `${q.n}:${q.kind}:${q.pressed}`));
    result.surveyA = asked;
    // 4. the package, as the panel's Save gives it, read strictly here
    const saved = await savePackage(page, 'adult', tmp);
    const sha = sha256(saved.bytes);
    let pkg: SessionPackage | null = null;
    let readError: string | null = null;
    try {
        pkg = readPackage(saved.bytes);
    } catch (e) {
        readError = (e as Error).message;
    }
    if (!pkg) {
        check('A: the saved package reads strictly', false, readError);
        throw new Error('no package to go on with');
    }
    const evs = pkg.events as readonly (Ev & { attempt?: number })[];
    const opensPkg = evs.filter((e) => e.kind === 'lesson' && e.what === 'open').map((e) => e.lessonId);
    const answersPkg = evs.filter((e) => e.kind === 'answer');
    check('A: the saved package reads strictly (every listed file\'s size and SHA-256), complete, consent recording and voice and not send, a voice, a survey', pkg.problems.length === 0 && pkg.manifest.consent.recording === true && pkg.manifest.consent.voice === true && pkg.manifest.consent.send === false && pkg.voice !== null && pkg.voice.length > 10000 && pkg.survey !== null, { frames: pkg.frames.length, events: counts(evs), voiceBytes: pkg.voice?.length, bytes: saved.bytes.length, consent: pkg.manifest.consent });
    check('A: the package holds both lessons, in order, the pass, the three answers by key, the N presses', opensPkg.join(',') === 'ears-headphones,ears-glossary' && evs.some((e) => e.kind === 'lesson' && e.what === 'passed' && e.lessonId === 'ears-headphones') && answersPkg.length >= 3 && answersPkg.every((a) => a.via === 'key') && evs.filter((e) => e.kind === 'key').length >= 3, { opens: opensPkg, answers: answersPkg.map((a) => [a.value, a.via]), keys: evs.filter((e) => e.kind === 'key').length });
    const speechPkg = evs.filter((e) => e.kind === 'speech');
    const iPkgOn = indexOfKey(speechPkg, 'survey.mic-on');
    const iPkgOffer = indexOfKey(speechPkg, 'survey.offer');
    check('A: the recorder\'s own lines are in the package in order: rec.started (the question rec.ask came before the recording began), survey.mic-on, survey.offer, survey.thanks', ['rec.started', 'survey.mic-on', 'survey.offer', 'survey.thanks'].every((k, i, a) => indexOfKey(speechPkg, k) >= 0 && (i === 0 || indexOfKey(speechPkg, k) > indexOfKey(speechPkg, a[i - 1] as string))) && iPkgOn < iPkgOffer, speechPkg.map((e) => e.key).filter((k) => /^(rec|survey\.(mic-on|offer|thanks))/.test(k ?? '')));
    const sv = pkg.survey;
    check('A: survey.json: the first flight\'s survey, not skipped, 9 answers equal to the keys pressed (value and way), the open one by voice and one skipped', sv !== null && sv.skipped === false && sv.answers.length === 9 && sv.answers.every((a, i) => {
        const q = asked[i];
        if (!q) return false;
        if (q.kind === 'open') return a.value === null && a.via === (q.pressed === 'Enter' ? 'voice' : 'skip');
        return a.via === 'key' && a.value === Number(q.pressed.replace('Digit', ''));
    }), sv && { id: sv.surveyId, skipped: sv.skipped, answers: sv.answers.map((a) => [a.item, a.value, a.via]) });
    result.packageA = { sha256: sha, bytes: saved.bytes.length, frames: pkg.frames.length, events: counts(evs), voiceBytes: pkg.voice?.length ?? 0, voiceOffsetMs: pkg.manifest.clock.voiceOffsetMs, manifestLesson: pkg.manifest.lesson, scene: pkg.manifest.scene };
    // the same check in Node, lesson by lesson, for the evidence
    const node = await checkPackage(pkg);
    result.nodeCheckA = { ok: node.check?.ok, segments: node.segments.map((s) => ({ lesson: s.segment.lessonId, lead: s.segment.lead, frames: s.segment.frames.length, ok: s.check?.ok, diffs: s.check?.events.diffs.length, cueShare: s.check?.cues.share })) };

    // 5. the replay, from the panel, lesson by lesson
    log('A: the replay');
    const ready = await openReplay(page);
    const rows = ready.checks;
    result.replayCheckA = { summary: ready.state.check, notes: ready.state.notes, checks: rows, title: ready.state.title };
    check('A: the replay is checked lesson by lesson: ears-headphones, ears-glossary, each compared, every recorded event re-derived (0 differences)', rows.map((r) => r.lesson).join(',') === 'ears-headphones,ears-glossary' && rows.every((r) => r.compared && r.diffs === 0 && r.matched === r.recorded && r.recorded > 0), rows);
    check('A: 100 % of the sounds in each lesson (the cue ids of every frame) and the panel says the replay agrees', rows.length === 2 && rows.every((r) => r.cueShare === 1) && ready.state.check?.ok === true, { rows: rows.map((r) => [r.lesson, r.cueShare, r.cueClassShare]), summary: ready.state.check });
    check('A: the lesson-by-lesson check in Node agrees with the page\'s', node.check?.ok === ready.state.check?.ok, result.nodeCheckA);
    // controls: the same checks, on the same package made wrong, must say so (a check that cannot fail proves nothing)
    const firstAnswer = pkg.events.findIndex((e) => e.kind === 'answer');
    const noAnswer = await checkPackage({ ...pkg, events: pkg.events.filter((_, i) => i !== firstAnswer) });
    check('A: control: with one recorded answer taken out the events no longer agree (the replay takes answers as input, so what it derives changes)', noAnswer.check?.ok === false && (noAnswer.check?.events.diffs.length ?? 0) > 0, { diffs: noAnswer.check?.events.diffs.length });
    const gloss = node.segments[1]?.segment;
    const muted = await checkPackage({ ...pkg, frames: pkg.frames.map((f) => (gloss && f.t >= gloss.fromT + 2000 && f.t < gloss.fromT + 6000 ? { ...f, c: [] } : f)) });
    check('A: control: with the sounds of four seconds of the glossary taken out of the recording the sounds no longer agree', muted.check?.ok === false && (muted.check?.cues.share ?? 1) < 0.95, { share: muted.check?.cues.share });
    await page.focus('[data-action="replay-toggle"]');
    await page.keyboard.press('Enter');
    const prims: Record<string, number> = {};
    let lastLesson: string | null = null;
    const tp = Date.now();
    for (;;) {
        const h = await replayHook(page);
        const pl = h?.state.player;
        if (pl && pl.lesson !== lastLesson && pl.phase === 'playing') {
            lastLesson = pl.lesson;
            await sleep(1200);
            prims[pl.lesson ?? '-'] = (await probe(page)).stagePrims;
        }
        if (!pl || pl.phase === 'ended' || Date.now() - tp > 420000) break;
        await sleep(200);
    }
    const end = await replayHook(page);
    const tr = end?.trace;
    const voice = await page.evaluate(() => {
        const v = (window as unknown as { __voice: { duration: number; fileOnsets: number[]; starts: unknown[]; onsets: number[] } }).__voice;
        return { duration: v.duration, fileOnsets: v.fileOnsets, starts: v.starts, onsets: v.onsets };
    });
    check('A: the replay played to its end', end?.state.player?.phase === 'ended', end?.state.player);
    const sw = tr?.switches ?? [];
    check('A: each lesson\'s world drawn in turn when its first frame was due: ears-headphones, then ears-glossary, both shown by the page\'s view', sw.map((s) => `${s.lesson}:${s.shown}`).join(',') === 'ears-headphones:true,ears-glossary:true', { switches: sw.map((s) => [s.lesson, s.world, s.shown, s.t]), prims });
    const ref = tr?.voiceStarts[0];
    const fedLag = ref && tr ? tr.fed.map((f) => ref.t + (f.ac - ref.ac) * 1000 - f.t) : [];
    const sorted = [...fedLag].sort((a, b) => a - b);
    const lag = { n: fedLag.length, min: sorted[0], p50: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.floor(sorted.length * 0.95)], max: sorted.at(-1) };
    check('A: every frame of both lessons fed once, in order, never before its package time and within 200 ms after it on the audio clock', !!tr && tr.fed.length === (end?.state.player?.frames ?? -1) && fedLag.length > 0 && Math.min(...fedLag) >= -1 && Math.max(...fedLag) <= 200, lag);
    // the voice: every burst where the package's clock puts it
    const vo = pkg.manifest.clock.voiceOffsetMs ?? 0;
    const expected = voice.fileOnsets.map((f) => vo + f * 1000);
    const heardBursts = ref ? voice.onsets.map((a) => ref.t + (a - ref.ac) * 1000) : [];
    const errs = heardBursts.map((h) => expected.reduce((best, e) => (Math.abs(h - e) < Math.abs(best) ? h - e : best), Infinity));
    const gaps = voice.fileOnsets.slice(1).map((f, i) => f - (voice.fileOnsets[i] as number));
    const switchB = sw[1]?.t ?? Infinity;
    const lastA = pkg.frames.filter((f) => f.t < switchB).at(-1)?.t ?? 0;
    const voiceSync = { bursts: expected.length, heard: heardBursts.length, inSecondLesson: heardBursts.filter((h) => h > lastA).length, maxAbsErrMs: Math.max(...errs.map(Math.abs)), errorsMs: errs.map((e) => Math.round(e * 10) / 10), voiceSeconds: voice.duration, burstGapsS: [Math.min(...gaps), Math.max(...gaps)] };
    result.voiceSyncA = voiceSync;
    check('A: the voice track holds every burst of the microphone across the recording (no gap: 1.5 s apart all along) and runs through the survey (to the last answer)', expected.length >= 10 && Math.min(...gaps) > 1.45 && Math.max(...gaps) < 1.55 && (sv?.answers.at(-1)?.t ?? 0) <= vo + (voice.duration + 0.2) * 1000, { bursts: expected.length, gaps: voiceSync.burstGapsS, lastAnswerT: sv?.answers.at(-1)?.t, voiceEndT: Math.round(vo + voice.duration * 1000) });
    check('A: the voice in the replay: every burst heard within 200 ms of its place on the package clock, over both lessons', heardBursts.length >= 10 && heardBursts.length >= expected.length - 2 && Math.max(...errs.map(Math.abs)) <= 200 && heardBursts.some((h) => h > lastA), voiceSync);
    await page.focus('[data-action="replay-close"]');
    await page.keyboard.press('Enter');
    await sleep(800);
    check('A: closing the replay gives the page back (the live lesson runs again, the engine runs)', (await probe(page)).engine === 'running' && !(await replayHook(page).then((h) => h?.state.player ?? null)), await probe(page));

    // 6. U, U: the recording goes to the author
    log('A: sending');
    const before = requests.length;
    const sent = await sendByU(page, rig, sha);
    const at = await atTheRig(rig, sha);
    const seq = requests.slice(before).map((r) => `${r.method} ${r.path.replace('/api/session', '')}`);
    const start = requests.slice(before).find((r) => r.path === '/api/session/start');
    result.sendA = { said: sent.said, seq: seq.slice(0, 12), rig: at };
    check('A: the pilot hears the question, sending, stored, delivered, in that order', JSON.stringify(sent.said.filter((k) => k.startsWith('send.'))) === '["send.confirm","send.sending","send.stored","send.delivered"]', sent.said.filter((k) => k.startsWith('send.')));
    check('A: the start said the pilot confirmed sending (consentSend), and the package\'s size and SHA-256', (start?.body as { consentSend?: boolean; sha256?: string; size?: number } | undefined)?.consentSend === true && (start?.body as { sha256?: string }).sha256 === sha && (start?.body as { size?: number }).size === saved.bytes.length, start?.body);
    check('A: the rig\'s stored file has the local package\'s SHA-256 (the file on its disk hashed here, and its record)', at.record?.sha256 === sha && at.storedFileSha === sha && at.record?.bytes === saved.bytes.length, { record: at.record?.sha256 === sha, file: at.storedFileSha === sha });
    check('A: its Telegram document and its mail attachment have the same SHA-256, and both channels are sent', at.telegram === 1 && at.mail === 1 && at.record?.delivered === true && at.record?.channels.telegram === 'sent' && at.record?.channels.email === 'sent', { telegram: at.telegram, mail: at.mail, channels: at.record?.channels });
    const again = await savePackage(page, 'adult-after-send', tmp);
    check('A: the recording on the device is untouched by the sending (the panel\'s Save gives the same bytes)', sha256(again.bytes) === sha, { before: sha.slice(0, 12), after: sha256(again.bytes).slice(0, 12) });
    await page.close();
}

async function scenarioChild(ctx: BrowserContext, served: Served, rig: Rig, tmp: string): Promise<void> {
    log('B: a child, the guardian\'s consent confirmed');
    const page = await openLesson(ctx, served, 'hover-height', 'B');
    await sleep(1000);
    const started = await startRecording(page, ['rec.minor', 'rec.ask']);
    const said = started.said;
    check('B: for a minor T says rec.minor (the guardian line) and then asks (rec.ask), the second T records', said.indexOf('rec.minor') >= 0 && said.indexOf('rec.minor') < said.indexOf('rec.ask') && said.includes('rec.started'), said);
    // a flown lesson: N for the intro, then up into the band and held (Space until 2.3 m, then nothing: the height is held); about 25 s of flight
    await until('the lesson restarted by the recording', () => events(page), (all) => all.slice(started.from).some((e) => e.kind === 'lesson' && e.what === 'open' && e.lessonId === 'hover-height'), 15000);
    let skipped = false;
    let spaceDown = false;
    const tf = Date.now();
    let flyingSince = 0;
    for (;;) {
        const p = await probe(page);
        if (!skipped && p.phase === 'intro') {
            skipped = true;
            await page.keyboard.press('KeyN');
        }
        const want = p.pos[1] < 2.3;
        if (want !== spaceDown) {
            spaceDown = want;
            await (want ? page.keyboard.down('Space') : page.keyboard.up('Space'));
        }
        if (p.phase === 'flying' && flyingSince === 0) flyingSince = Date.now();
        if (flyingSince > 0 && Date.now() - flyingSince > 25000) break;
        if (Date.now() - tf > 180000) throw new Error(`hover-height did not fly in 3 minutes: ${JSON.stringify(p)}`);
        await sleep(50);
    }
    if (spaceDown) await page.keyboard.up('Space');
    const survey0 = await countOf(page);
    await page.keyboard.press('KeyT');
    log('B: stopped; the survey');
    const { asked } = await answerSurvey(page, 'B', survey0);
    await until('the recording saved', () => events(page), (all) => spokenAfter(all, survey0).includes('rec.saved'), 60000);
    await until('the recorder idle', () => recordingOn(page), (v) => !v, 30000);
    check('B: the child variant: 6 questions in the dialog, answered by keys', asked.length === 6 && asked.every((q) => q.total === 6), asked.map((q) => `${q.n}:${q.kind}:${q.pressed}`));
    result.surveyB = asked;
    const saved = await savePackage(page, 'child', tmp);
    const sha = sha256(saved.bytes);
    const pkg = readPackage(saved.bytes);
    const sv = pkg.survey;
    check('B: the package reads strictly; a minor: consent minor and guardianConfirmed, recording and voice, never send; a flown lesson (frames moved)', pkg.problems.length === 0 && pkg.manifest.consent.minor === true && pkg.manifest.consent.guardianConfirmed === true && pkg.manifest.consent.recording === true && pkg.manifest.consent.voice === true && pkg.manifest.consent.send === false && pkg.frames.length > 300 && new Set(pkg.frames.map((f) => Math.round(f.p[1] * 10))).size > 3, { consent: pkg.manifest.consent, frames: pkg.frames.length, events: counts(pkg.events) });
    check('B: survey.json is the child variant, not skipped, 6 answers equal to the keys pressed', sv !== null && /child/i.test(sv.surveyId) && sv.skipped === false && sv.answers.length === 6 && sv.answers.every((a, i) => {
        const q = asked[i];
        if (!q) return false;
        if (q.kind === 'open') return a.value === null && a.via === (q.pressed === 'Enter' ? 'voice' : 'skip');
        return a.via === 'key' && a.value === Number(q.pressed.replace('Digit', ''));
    }), sv && { id: sv.surveyId, skipped: sv.skipped, answers: sv.answers.map((a) => [a.item, a.value, a.via]) });
    result.packageB = { sha256: sha, bytes: saved.bytes.length, frames: pkg.frames.length, events: counts(pkg.events), voiceBytes: pkg.voice?.length ?? 0, surveyId: sv?.surveyId };
    const node = await checkPackage(pkg);
    result.nodeCheckB = { ok: node.check?.ok, segments: node.segments.map((s) => ({ lesson: s.segment.lessonId, lead: s.segment.lead, frames: s.segment.frames.length, ok: s.check?.ok, diffs: s.check?.events.diffs.length, cueShare: s.check?.cues.share })) };
    const ready = await openReplay(page);
    const rows = ready.checks;
    result.replayCheckB = { summary: ready.state.check, notes: ready.state.notes, checks: rows };
    check('B: the recording of the flown lesson is checked as it was flown: hover-height compared, every recorded event re-derived, the sounds', rows.length >= 1 && rows.every((r) => r.lesson === 'hover-height' && r.compared && r.diffs === 0 && r.matched === r.recorded) && ready.state.check?.ok === true, { rows, summary: ready.state.check, node: result.nodeCheckB });
    await page.focus('[data-action="replay-close"]');
    await page.keyboard.press('Enter');
    await sleep(800);
    const before = requests.length;
    const sent = await sendByU(page, rig, sha);
    const at = await atTheRig(rig, sha);
    const start = requests.slice(before).find((r) => r.path === '/api/session/start');
    result.sendB = { said: sent.said, rig: at };
    check('B: with the guardian confirmed U sends it: question, sending, stored, delivered; the start carried consentSend and the package\'s SHA-256', JSON.stringify(sent.said.filter((k) => k.startsWith('send.'))) === '["send.confirm","send.sending","send.stored","send.delivered"]' && (start?.body as { consentSend?: boolean; sha256?: string } | undefined)?.consentSend === true && (start?.body as { sha256?: string }).sha256 === sha, { said: sent.said, body: start?.body });
    check('B: the rig\'s stored file, its Telegram document and its mail attachment have the local package\'s SHA-256; both channels sent', at.record?.sha256 === sha && at.storedFileSha === sha && at.telegram === 1 && at.mail === 1 && at.record?.delivered === true, { stored: at.storedFileSha === sha, telegram: at.telegram, mail: at.mail, channels: at.record?.channels });
    await page.close();
}

// ------------------------------------------------------------------------------------------------ main

async function main(): Promise<void> {
    let release: unknown = null;
    try {
        release = JSON.parse(readFileSync(join(DIST, 'release.json'), 'utf8'));
    } catch {
        throw new Error('dist/release.json is missing: run `node scripts/build-release.mjs` first (the release build of this tree)');
    }
    const head = gitSha();
    if ((release as { sha?: string }).sha !== head) console.log(`NOTE: dist was built at ${(release as { sha?: string }).sha}, the tree is at ${head}`);
    const tmp = mkdtempSync(join(tmpdir(), 'sonic-e2e-'));
    const wav = join(tmp, 'mic.wav');
    writeFileSync(wav, toneBurstWav());
    const cache = join(REPO, '.cache', 'sonic-e2e');
    rmSync(cache, { recursive: true, force: true });
    mkdirSync(cache, { recursive: true });
    await lock();
    locked = true;
    let rig: Rig | null = null;
    let served: Served | null = null;
    let browser: Awaited<ReturnType<typeof launchChrome>>['browser'] | null = null;
    let failure: string | null = null;
    try {
        writeFileSync(TAP_FILE, TAP);
        rig = await startRig(join(cache, 'data'), { apiPort: PORT_API, controlPort: PORT_CONTROL });
        served = await serveDist(DIST, { API_PROXY: `http://127.0.0.1:${PORT_API}` }, PORT_SITE);
        await rig.ctl('/reset');
        const launched = await launchChrome({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`, '--autoplay-policy=no-user-gesture-required'] });
        browser = launched.browser;
        log('up:', launched.which.version, 'site', served.origin, 'api', rig.api, 'control', rig.control, 'release', JSON.stringify(release));
        const b = browser;
        const fresh = (): Promise<BrowserContext> => b.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, acceptDownloads: true });
        const a = await newContext(fresh, served, null);
        await scenarioAdult(a, served, rig, tmp);
        await a.close();
        const child = await newContext(fresh, served, { id: 'e2eChildPilot0001', nickname: null, minor: true, guardianConfirmed: true, headphones: 'wired', surveysSeen: [], speechRecognition: false });
        await scenarioChild(child, served, rig, tmp);
        await child.close();
        const st = await rig.state();
        check('both recordings are on the rig, delivered, and nothing else was sent (2 documents, 2 mails)', st.sessions.length === 2 && st.sessions.every((s: RigSession) => s.delivered) && st.telegram.documents.length === 2 && st.mail.messages.length === 2, { sessions: st.sessions.length, documents: st.telegram.documents.length, mails: st.mail.messages.length });
        const wire = requests.filter((r) => r.path.startsWith('/api/session'));
        check('the wire: every start named consentSend true; no request carried a token in its address', wire.filter((r) => r.path === '/api/session/start').every((r) => (r.body as { consentSend?: boolean } | null)?.consentSend === true) && wire.every((r) => !/[A-Za-z0-9_-]{32,}/.test(r.path)), { requests: wire.length });
        check('no page error, no console error, no failed request in either page', problems.length === 0, problems);
    } catch (e) {
        failure = e instanceof Error ? (e.stack ?? e.message) : String(e);
        check(`the run reached its end without an exception`, false, failure.slice(0, 700));
    } finally {
        await browser?.close().catch(() => undefined);
        await served?.stop().catch(() => undefined);
        await rig?.stop().catch(() => undefined);
        rmSync(TAP_FILE, { force: true });
        rmSync(cache, { recursive: true, force: true });
        unlock();
    }
    const passed = checks.filter((c) => c.pass).length;
    // the saved packages (a synthetic tone for a voice) stay in the temporary folder when a check failed, or when SONIC_E2E_KEEP=1, to be looked at
    if (failure === null && passed === checks.length && process.env.SONIC_E2E_KEEP !== '1') rmSync(tmp, { recursive: true, force: true });
    else console.log(`the saved packages are kept in ${tmp}`);
    // the lane's evidence folder is the day it was made in (the file itself records the real date and the git head)
    const file = writeEvidence('sonic-e2e', { site: `http://127.0.0.1:${PORT_SITE}`, release, seconds: Math.round((Date.now() - T0) / 1000), passed, total: checks.length, pass: failure === null && passed === checks.length, checks, result, problems }, '2026-11-07');
    console.log(`${passed} of ${checks.length} checks passed in ${Math.round((Date.now() - T0) / 1000)} s; ${file}`);
    process.exit(failure === null && passed === checks.length ? 0 : 1);
}

process.on('SIGINT', () => {
    rmSync(TAP_FILE, { force: true });
    unlock();
    process.exit(130);
});
main().catch((e) => {
    rmSync(TAP_FILE, { force: true });
    unlock();
    console.error(e);
    process.exit(2);
});
