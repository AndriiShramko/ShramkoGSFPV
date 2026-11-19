// Lane sound6 (train 4) acceptance: a new pilot's quick first lesson in the real page, with the MOUSE (design
// C:/dev/.gsfpv-lanes/designs/sound6.md, stage 3). The release build of this tree behind tools/bench/scripts/serve-csp.mjs,
// ?render=off (no picture is judged, so no GPU lock), headless Chromium at 1536x730 with device scale 1.25. Steps, each
// PASS or FAIL in one JSON:
//   1 the start screen fits (no horizontal overflow, every button at least 44 px high and inside the width, no two
//     buttons lying over each other);
//   2 "Quick start" is the first button of Start and visible without scrolling;
//   3 a mouse click on it: an AudioContext running within 2 s, no sound problem shown;
//   4 the first wall cue (safety.wall in the engine's plan or one-shots) within 12 s of the click;
//   5 the headphone check's three questions answered (the lesson takes digits: 1 left, 2 right) -> the lesson passes;
//   6 ears-walls names left, right, up and down and never front or behind (dir.front, dir.back, headphones.q-front-back);
//   7 walls-hall opens after it;
//   8 back at the start screen: Continue first, then Quick start, then Full course;
//   9 the same screen at 844x390 fits (step 1's test) and keeps that order.
// Then steps 1 to 4 again in Playwright's Firefox (BROWSER=firefox runs only that part).
// SITE=https://gsfpv.flyreelstudio.eu runs it against that site (read only: the page keeps its prefs in the browser;
// nothing is saved, sent or created on the site): the negative control of the lane.
//   node scripts/build-release.mjs  (walls copied into dist/walls)
//   cd tools/bench && PORT=6161 npx tsx src/sonic-quick-walk.ts [out.json]
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { firefox } from 'playwright';
import type { Browser, Page } from 'playwright';
import { launchChrome } from './browser';
import { REPO } from './evidence';
import { serveDist } from './sonicrec-serve';
import type { Served } from './sonicrec-serve';

const PORT = Number(process.env.PORT ?? '') > 0 ? Number(process.env.PORT) : 6161;
const SITE = (process.env.SITE ?? '').replace(/\/$/, '');
const ONLY = process.env.BROWSER ?? 'both';
const OUT = process.argv[2] ?? `${REPO}/evidence/2026-11-19/sound6/sound6-walk${SITE ? '-live' : ''}.json`;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const T0 = Date.now();
const log = (...a: unknown[]): void => console.log(`[${((Date.now() - T0) / 1000).toFixed(0).padStart(4)}s]`, ...a);

interface Step {
    browser: string;
    n: number;
    name: string;
    pass: boolean;
    value?: unknown;
}
const steps: Step[] = [];
const step = (browser: string, n: number, name: string, pass: boolean, value?: unknown): boolean => {
    steps.push({ browser, n, name, pass, value });
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${browser} ${n} ${name}${value === undefined ? '' : '  ' + JSON.stringify(value).slice(0, 300)}`);
    return pass;
};

/** Before the page: every AudioContext made, the time of the last click, and a 30 ms watch of the mode's hook. */
const INIT = `(() => {
  window.__name = (f) => f;
  window.__qw = { acs: [], click: null, wall: null, hook: false, errors: [] };
  const Orig = window.AudioContext;
  if (Orig) {
    class Spy extends Orig { constructor(o) { super(o); window.__qw.acs.push(this); } }
    window.AudioContext = Spy;
  }
  addEventListener('click', () => { window.__qw.click = performance.now(); }, true);
  window.__qw.utt = [];
  try {
    const synth = window.speechSynthesis;
    const speak = synth.speak.bind(synth);
    synth.speak = (u) => {
      const row = { text: String(u.text).slice(0, 40), called: performance.now(), started: null, ended: null, voice: u.voice ? u.voice.name : null };
      if (window.__qw.utt.length < 40) window.__qw.utt.push(row);
      u.addEventListener('start', () => { row.started = performance.now(); });
      u.addEventListener('end', () => { row.ended = performance.now(); });
      return speak(u);
    };
  } catch (e) {}
  setInterval(() => {
    const h = window.__gsfpv && window.__gsfpv.sonic;
    if (!h) return;
    window.__qw.hook = true;
    if (window.__qw.wall !== null) return;
    try {
      const s = h(false);
      if ((s.cues || []).includes('safety.wall') || (s.oneShots || []).some((o) => String(o.cue).includes('safety.wall'))) window.__qw.wall = performance.now();
    } catch (e) { window.__qw.errors.push(String(e).slice(0, 200)); }
  }, 30);
})();`;

interface Look {
    overflowX: number;
    buttons: { id: string | null; text: string; x: number; y: number; w: number; h: number }[];
    small: string[];
    outside: string[];
    overlaps: string[];
    startOrder: string[];
    quickVisible: boolean;
    problem: string | null;
}

/** In the page: the start screen's buttons, their sizes and overlaps, the order of Start's buttons. */
const look = (page: Page): Promise<Look> =>
    page.evaluate(() => {
        const vis = (el: Element): boolean => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
        };
        const root = document.querySelector('[data-testid="sonic-start"]');
        const els = root ? [...root.querySelectorAll('button, a[href]')].filter(vis) : [];
        const W = document.documentElement.clientWidth;
        const buttons = els.map((b) => {
            const r = b.getBoundingClientRect();
            return { id: b.getAttribute('data-testid'), text: (b.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 50), x: Math.round(r.left), y: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height) };
        });
        const name = (b: { id: string | null; text: string }): string => b.id ?? b.text;
        const overlaps: string[] = [];
        for (let i = 0; i < buttons.length; i++)
            for (let j = i + 1; j < buttons.length; j++) {
                const a = buttons[i]!, c = buttons[j]!;
                const ix = Math.min(a.x + a.w, c.x + c.w) - Math.max(a.x, c.x), iy = Math.min(a.y + a.h, c.y + c.h) - Math.max(a.y, c.y);
                if (ix > 1 && iy > 1) overlaps.push(`${name(a)} / ${name(c)}`);
            }
        const actions = root?.querySelector('.sonic-actions');
        const startOrder = actions ? [...actions.querySelectorAll('button')].filter(vis).map((b) => b.getAttribute('data-testid') ?? '') : [];
        const q = document.querySelector('[data-testid="sonic-start-quick"]');
        const qr = q?.getBoundingClientRect();
        const p = document.querySelector('[data-testid="sonic-audio-problem"]');
        return {
            overflowX: document.documentElement.scrollWidth - W,
            buttons,
            small: buttons.filter((b) => b.h < 44).map(name),
            outside: buttons.filter((b) => b.x < 0 || b.x + b.w > W + 1).map(name),
            overlaps,
            startOrder,
            quickVisible: !!qr && qr.top >= 0 && qr.bottom <= innerHeight && qr.width > 0,
            problem: p && vis(p) ? (p.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 200) : null
        };
    });

const fits = (l: Look): boolean => l.overflowX <= 0 && l.small.length === 0 && l.outside.length === 0 && l.overlaps.length === 0 && l.buttons.length > 0;
const fitValue = (l: Look): unknown => ({ overflowX: l.overflowX, buttons: l.buttons.length, small: l.small, outside: l.outside, overlaps: l.overlaps });

type Hook = { __gsfpv?: { sonic?: (e?: boolean) => { lesson: string | null; phase: string | null; asking: boolean; question: { id: string; options: number } | null; speechQueue: number; engine: string; events: { kind: string; what?: string; lessonId?: string; key?: string }[] } } };
const hook = (page: Page) => page.evaluate(() => (window as unknown as Hook).__gsfpv?.sonic?.(true) ?? null);

async function openStart(page: Page, origin: string): Promise<void> {
    await page.goto(`${origin}/en/fly/?sonic=start&render=off&nowarn=1`);
    for (let i = 0; i < 300 && !(await page.evaluate(() => !!document.querySelector('[data-testid="sonic-start"] .sonic-actions button'))); i++) await sleep(100);
    await sleep(500);
}

/** Steps 1 to 4: the screen, the button, the click, the engine and the first wall cue. Returns false when the walk cannot go on. */
async function firstSteps(page: Page, origin: string, who: string): Promise<boolean> {
    await openStart(page, origin);
    const l = await look(page);
    step(who, 1, 'the start screen fits at 1536x730 (scale 1.25)', fits(l), fitValue(l));
    step(who, 2, '"Quick start" is the first button of Start and visible', l.startOrder[0] === 'sonic-start-quick' && l.quickVisible, { order: l.startOrder, visible: l.quickVisible });
    // on a page without the button (the site before this lane) the walk clicks Start's first button, so the engine's start is still seen
    const target = l.startOrder.includes('sonic-start-quick') ? '[data-testid="sonic-start-quick"]' : '[data-testid="sonic-start"] .sonic-actions button';
    const box = await page.locator(target).first().boundingBox();
    if (!box) return step(who, 3, 'a button to click', false);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.up();
    let running = false;
    let states: string[] = [];
    const tClick = Date.now();
    while (Date.now() - tClick < 2000) {
        states = await page.evaluate(() => (window as unknown as { __qw: { acs: AudioContext[] } }).__qw.acs.map((a) => a.state));
        if (states.includes('running')) {
            running = true;
            break;
        }
        await sleep(50);
    }
    await sleep(Math.max(0, 2000 - (Date.now() - tClick)));
    const after = await look(page).catch(() => null);
    step(who, 3, 'a mouse click on it: sound running within 2 s, no sound problem shown', running && !after?.problem, { states, problem: after?.problem ?? null, clicked: target });
    type Qw = { click: number | null; wall: number | null; hook: boolean; utt: { text: string; called: number; started: number | null; ended: number | null; voice: string | null }[] };
    let wall: Qw = { click: null, wall: null, hook: false, utt: [] };
    while (Date.now() - tClick < 60000) {
        wall = await page.evaluate(() => (window as unknown as { __qw: Qw }).__qw);
        if (wall.wall !== null) break;
        await sleep(100);
    }
    const sec = wall.wall !== null && wall.click !== null ? Math.round((wall.wall - wall.click) / 100) / 10 : null;
    step(who, 4, 'the first wall cue within 12 s of the click', sec !== null && sec <= 12, { seconds: sec, hook: wall.hook, speech: wall.utt.slice(0, 6).map((u) => ({ text: u.text, voice: u.voice, called: wall.click === null ? null : Math.round(u.called - wall.click), started: u.started === null || wall.click === null ? null : Math.round(u.started - wall.click), ended: u.ended === null || wall.click === null ? null : Math.round(u.ended - wall.click) })) });
    return running;
}

/** Answers every question the headphone check asks (trial n: odd left = 1, even right = 2) until the lesson passes. */
async function headphones(page: Page): Promise<boolean> {
    let answered = '';
    const t0 = Date.now();
    while (Date.now() - t0 < 240000) {
        const s = await hook(page);
        if (s?.events.some((e) => e.kind === 'lesson' && e.what === 'passed' && e.lessonId === 'ears-headphones')) return true;
        if (s?.asking && s.question && s.speechQueue === 0 && answered !== s.question.id) {
            answered = s.question.id;
            const n = Number(s.question.id.split(':')[2]);
            await page.keyboard.press(`Digit${n % 2 === 1 ? 1 : 2}`);
        }
        await sleep(80);
    }
    return false;
}

async function chromeWalk(browser: Browser, origin: string): Promise<void> {
    const who = 'chromium';
    const ctx = await browser.newContext({ viewport: { width: 1536, height: 730 }, deviceScaleFactor: 1.25 });
    await ctx.addInitScript({ content: INIT });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
    if (!(await firstSteps(page, origin, who))) return;
    // the pointer lock first, by a click into the flight
    await page.mouse.click(768, 500).catch(() => undefined);
    const hp = await headphones(page);
    step(who, 5, 'the headphone check answered on its three questions -> passed', hp, { lesson: (await hook(page))?.lesson ?? null });
    const t0 = Date.now();
    let s = await hook(page);
    while (Date.now() - t0 < 240000 && s?.lesson !== 'walls-hall') {
        await sleep(250);
        s = await hook(page);
    }
    const spoken = (s?.events ?? []).filter((e) => e.kind === 'speech').map((e) => e.key ?? '');
    const dirs = spoken.filter((k) => k.startsWith('dir.'));
    const banned = spoken.filter((k) => k === 'dir.front' || k === 'dir.back' || k === 'headphones.q-front-back');
    const walls = (s?.events ?? []).some((e) => e.kind === 'lesson' && e.what === 'passed' && e.lessonId === 'ears-walls');
    step(who, 6, 'ears-walls names left, right, up, down and never front or behind', walls && ['dir.left', 'dir.right', 'dir.up', 'dir.down'].every((d) => dirs.includes(d)) && banned.length === 0, { passed: walls, dirs, banned });
    step(who, 7, 'walls-hall opens after it', s?.lesson === 'walls-hall', { lesson: s?.lesson ?? null, phase: s?.phase ?? null, seconds: Math.round((Date.now() - t0) / 1000) });
    await openStart(page, origin);
    const back = await look(page);
    const order = ['sonic-start-continue', 'sonic-start-quick', 'sonic-start-full'];
    step(who, 8, 'back at Start: Continue, Quick start, Full course', order.every((id, i) => back.startOrder[i] === id), { order: back.startOrder });
    await page.setViewportSize({ width: 844, height: 390 });
    await sleep(500);
    const small = await look(page);
    step(who, 9, 'at 844x390 the start screen fits and keeps that order', fits(small) && order.every((id, i) => small.startOrder[i] === id), { ...(fitValue(small) as object), order: small.startOrder });
    if (errors.length) step(who, 10, 'no page error', false, errors);
    await ctx.close();
}

async function firefoxWalk(origin: string): Promise<void> {
    const who = 'firefox';
    const b = await firefox.launch({ headless: true, firefoxUserPrefs: { 'media.autoplay.default': 0, 'media.autoplay.blocking_policy': 0 } });
    try {
        const ctx = await b.newContext({ viewport: { width: 1536, height: 730 }, deviceScaleFactor: 1.25 });
        await ctx.addInitScript({ content: INIT });
        const page = await ctx.newPage();
        const errors: string[] = [];
        page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
        page.on('console', (m) => {
            if (m.type() === 'error') errors.push(m.text().slice(0, 200));
        });
        await firstSteps(page, origin, who);
        const engine = await hook(page).then((s) => s?.engine ?? null).catch(() => null);
        steps.push({ browser: who, n: 0, name: 'engine state and errors (information)', pass: true, value: { engine, errors: errors.slice(0, 6) } });
        console.log(`INFO  firefox engine ${engine} errors ${JSON.stringify(errors.slice(0, 3))}`);
    } finally {
        await b.close();
    }
}

async function main(): Promise<void> {
    let served: Served | null = null;
    let browser: Browser | null = null;
    try {
        served = SITE ? { port: 0, origin: SITE, stop: async () => undefined } : await serveDist(`${REPO}/dist`, {}, PORT);
        console.log(`sonic-quick-walk target: ${served.origin}`);
        if (ONLY !== 'firefox') {
            browser = (await launchChrome({ args: ['--autoplay-policy=no-user-gesture-required'] })).browser;
            await chromeWalk(browser, served.origin);
        }
        if (ONLY !== 'chromium') await firefoxWalk(served.origin);
    } finally {
        await browser?.close();
        await served?.stop();
    }
    const failed = steps.filter((s) => !s.pass);
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, JSON.stringify({ probe: 'sonic-quick-walk', target: served?.origin ?? null, at: new Date().toISOString(), pass: failed.length === 0, failed: failed.map((s) => `${s.browser} ${s.n}`), steps }, null, 2) + '\n');
    log(JSON.stringify({ pass: failed.length === 0, failed: failed.map((s) => `${s.browser} ${s.n}`), out: OUT }));
    process.exit(failed.length === 0 ? 0 : 1);
}
void main();
