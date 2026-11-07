// The scripted keyboard pilot of the Winter Garden lesson and what a page run of it needs (v0.12 Fly by Sound, lane v12-flight step 10),
// shared by tools/bench/src/sonic-garden-page.ts (the lesson through both entries) and sonic-garden-refine.ts (the walls refine to 1.6 cm):
// the GPU lock, the prefs the page starts from, a tap in front of the page's AudioContext destination (what the engine produced), the
// page's test hook (window.__gsfpv.sonic) as a typed probe, and the pilot: it reads the craft and the next ring from the hook and presses
// the keys of the game scheme (W forward, E and Q turn, Space and Shift for height) like a person, until the lesson's own 'passed' event.
import { mkdirSync, rmdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { SCHEMA_VERSION } from '../../../packages/prefs/src';
import { defaultPrefs } from '../../../packages/sonic-fpv/src';

export const LOCK = 'C:/dev/.gpu-lock';
export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function lock(): Promise<void> {
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
            if (!waited++ || waited % 600 === 0) console.log('waiting for the GPU lock');
            await sleep(100);
        }
    }
}

export const unlock = (): void => {
    try {
        rmdirSync(LOCK);
    } catch {
        /* not ours */
    }
};

// the engine says nothing itself (a screen reader would): it waits the time a line takes, at double speed, so the run is not dominated by speech
export const DOC = {
    format: 'gsfpv-prefs',
    version: SCHEMA_VERSION,
    app: '0.3.0',
    savedAt: '2026-11-07T00:00:00.000Z',
    settings: { global: {}, drone: {}, scene: {} },
    collections: { sonic: { v: 1, prefs: { ...defaultPrefs(), selfVoice: false, speechRate: 2 }, progress: {}, current: null }, ui: { v: 1, warned: true } }
};

/** The page's init script: the prefs above, and a tap on the AudioContext's destination (window.__tap: RMS and peak of what the engine produced). */
export const INIT = `(() => {
  window.__name = (f) => f;
  try { if (!localStorage.getItem('gsfpv.prefs.v1')) localStorage.setItem('gsfpv.prefs.v1', ${JSON.stringify(JSON.stringify(DOC))}); } catch (e) {}
  const Orig = window.AudioContext;
  window.__acCount = 0;
  window.__tap = { maxRms: 0, maxPeak: 0, polls: 0, loud: 0, last: 0 };
  class TapContext extends Orig {
    constructor(o) { super(o); window.__acCount++; }
    get destination() {
      if (!this.__tapIn) {
        const real = super.destination;
        const g = this.createGain();
        const an = this.createAnalyser();
        an.fftSize = 2048;
        g.connect(an);
        g.connect(real);
        this.__tapIn = g;
        const buf = new Float32Array(2048);
        setInterval(() => {
          an.getFloatTimeDomainData(buf);
          let s = 0, p = 0;
          for (let i = 0; i < buf.length; i++) { const x = buf[i]; s += x * x; const a = Math.abs(x); if (a > p) p = a; }
          const rms = Math.sqrt(s / buf.length);
          const t = window.__tap;
          t.polls++; t.last = rms;
          if (rms > t.maxRms) t.maxRms = rms;
          if (p > t.maxPeak) t.maxPeak = p;
          if (rms > 1e-3) t.loud++;
        }, 50);
      }
      return this.__tapIn;
    }
  }
  window.AudioContext = TapContext;
})();`;

export interface Probe {
    lesson: string | null;
    phase: string | null;
    attempt: number;
    touches: number;
    passed: boolean;
    engine: string;
    target: { id: string; pos: [number, number, number] } | null;
    cost: { n: number; p50: number; p95: number; p99: number; max: number };
    walls: { voxelM: number | null; builtin: boolean; scene: string; scale: number };
    pos: [number, number, number];
    yaw: number;
    speed: number;
    armed: boolean;
    speechQueue: number;
    stagePrims: number;
    progress: Record<string, { passed: boolean; attempts: number; successes: number; bestTimeMs: number | null }>;
    events: { kind: string; what?: string; lessonId?: string; t: number; gateId?: string; missM?: number; key?: string; text?: string; material?: string }[];
}

export const probe = (page: Page, events = false): Promise<Probe> => page.evaluate((e) => (window as unknown as { __gsfpv: { sonic: (e?: boolean) => unknown } }).__gsfpv.sonic(e), events) as Promise<Probe>;
export const wrap = (d: number): number => ((((d + 180) % 360) + 360) % 360) - 180;

export async function hold(page: Page, state: Record<string, boolean>, key: string, want: boolean): Promise<void> {
    if ((state[key] === true) === want) return;
    state[key] = want;
    if (want) await page.keyboard.down(key);
    else await page.keyboard.up(key);
}

/** A person's flying by the keys: turn toward the next ring (E right, Q left), forward when the nose is on it, Space and Shift for height. */
export async function fly(page: Page, p: Probe, state: Record<string, boolean>): Promise<void> {
    const t = p.target;
    if (!t || p.phase !== 'flying') {
        for (const k of ['KeyW', 'KeyE', 'KeyQ', 'Space', 'ShiftLeft']) await hold(page, state, k, false);
        return;
    }
    const dx = t.pos[0] - p.pos[0];
    const dz = t.pos[2] - p.pos[2];
    const dist = Math.hypot(dx, dz);
    const err = wrap((Math.atan2(dx, -dz) * 180) / Math.PI - p.yaw);
    await hold(page, state, 'KeyE', err > 7);
    await hold(page, state, 'KeyQ', err < -7);
    // speed: toward 4 m/s on the straights, 2 m/s near a ring or in a sharp turn; never forward with the nose far off
    const want = Math.abs(err) > 55 ? 0 : Math.min(4, Math.max(1.8, dist * 0.7));
    await hold(page, state, 'KeyW', want > 0 && p.speed < want);
    const dy = t.pos[1] - p.pos[1];
    await hold(page, state, 'Space', dy > 0.5);
    await hold(page, state, 'ShiftLeft', dy < -0.5);
}

export async function waitFlying(page: Page, lesson: string, timeoutMs: number): Promise<void> {
    await page.waitForFunction((id) => { const h = (window as unknown as { __gsfpv?: { status?: string; sonic?: () => { lesson: string | null } } }).__gsfpv; return h?.status === 'ready' && h.sonic?.().lesson === id; }, lesson, { timeout: timeoutMs });
}

export interface Lap {
    passed: boolean;
    seconds: number;
    last: Probe;
    end: Probe;
}

/** Flies the course until the lesson's own 'passed' event; screenshots (into `dir`, named `<tag>-target-<ring>.jpg`) when the target is ring 1, 3 and 6. */
export async function lap(page: Page, dir: string, tag: string, limitMs: number): Promise<Lap> {
    const state: Record<string, boolean> = {};
    const t0 = Date.now();
    let last = await probe(page);
    // the page's event log keeps earlier laps: this lap is passed when there is one more 'passed' than at its start
    const passes = (p: Probe): number => p.events.filter((e) => e.kind === 'lesson' && e.what === 'passed' && e.lessonId === 'free-garden').length;
    const before = passes(await probe(page, true));
    const shot = new Set<string>();
    while (Date.now() - t0 < limitMs) {
        last = await probe(page, false);
        await fly(page, last, state);
        const id = last.target?.id;
        if (last.phase === 'flying' && id && ['ring-1', 'ring-3', 'ring-6'].includes(id) && !shot.has(id)) {
            shot.add(id);
            await sleep(150);
            writeFileSync(join(dir, `${tag}-target-${id}.jpg`), await page.screenshot({ type: 'jpeg', quality: 78 }));
        }
        const withEvents = await probe(page, true);
        if (passes(withEvents) > before) {
            for (const k of Object.keys(state)) if (state[k]) await page.keyboard.up(k);
            return { passed: true, seconds: Math.round((Date.now() - t0) / 1000), last: withEvents, end: withEvents };
        }
        await sleep(40);
    }
    for (const k of Object.keys(state)) if (state[k]) await page.keyboard.up(k);
    return { passed: false, seconds: Math.round((Date.now() - t0) / 1000), last, end: await probe(page, true) };
}
