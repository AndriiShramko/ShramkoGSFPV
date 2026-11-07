// v0.12 Fly by Sound, lane v12-flight step 8 (docs/wip/v12-plan.md 4.2): the start screen driven by the keyboard alone in a
// real page, headless Chrome. Opens /fly/?sonic=start on the Vite dev server and never touches the mouse (the page counts
// pointer events: there must be none), then records and checks:
//   structure   the landmarks (banner, navigation, main, contentinfo), one h1, four h2, the modules' h3, the title, a
//               viewport that allows zoom, every control a real element with a name, no raw dictionary key on screen
//               (en, es, pl, ru), contrast of the text colours, no sideways scroll at 1280, 640 and 360 px wide;
//   Tab order   every stop in the start layer in document order (nav, start, headphones, lessons, settings, footer), each
//               with a name, all 21 lessons reachable, no stop outside the layer, the radio group one stop, the details
//               control opening with Space and giving 14 sliders; Shift+Tab goes back the same way;
//   operation   Space and arrows set the path, calm mode and "my screen reader speaks" (saved in the prefs collection,
//               the captions region turns live); Enter on the headphone buttons makes the AudioContext (the first press)
//               and the hum is louder in the left channel for left, in the right for right, and level for behind (a tap in
//               front of the destination, per channel); Enter on a lesson hides the screen (out of the accessibility tree)
//               and opens the flight on that lesson's world (the page's own fly()).
// Evidence: evidence/<date>/sonic-start-keyboard.json (with the accessibility snapshot) and screenshots next to it. The
// page draws the lesson world, so the run holds the GPU lock. How anything sounds is not judged here.
//   cd apps/fly && npx vite --port 5342 --strictPort            (another shell)
//   cd tools/bench && LAB=http://localhost:5342 npx tsx src/sonic-start-keyboard.ts
import { mkdirSync, rmdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { launch } from './browser';
import { REPO, today, writeEvidence } from './evidence';

const LAB = (process.env.LAB ?? '').replace(/\/$/, '');
if (!LAB) throw new Error('LAB=http://localhost:<vite port> is needed');
const LOCK = 'C:/dev/.gpu-lock';
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const OUT = join(REPO, 'evidence', today(), 'sonic-start');
mkdirSync(OUT, { recursive: true });

async function lock(): Promise<void> {
    let waited = 0;
    for (;;) {
        try {
            mkdirSync(LOCK);
            return;
        } catch {
            try {
                if (Date.now() - statSync(LOCK).mtimeMs > 20 * 60 * 1000) {
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
const unlock = (): void => {
    try {
        rmdirSync(LOCK);
    } catch {
        /* not ours */
    }
};
process.on('SIGINT', () => {
    unlock();
    process.exit(130);
});

/** Before the page: counts AudioContexts and pointer events, taps the destination per channel. */
// (window.__name: tsx wraps named functions of a page.evaluate callback in __name(), which the page does not have)
const INIT = `(() => {
  window.__name = (f) => f;
  window.__pointer = 0;
  for (const t of ['pointerdown', 'mousedown', 'mouseup', 'click']) addEventListener(t, (e) => { if (e.detail !== 0 || e.pointerType) window.__pointer++; }, true);
  const Orig = window.AudioContext;
  window.__acCount = 0;
  window.__tapRead = null;
  // the cross-correlation of the two channels, summed over every poll with sound: its peak lag is the interaural delay
  window.__xc = new Float64Array(201);
  window.__sr = 48000;
  class TapContext extends Orig {
    constructor(o) { super(o); window.__acCount++; window.__sr = this.sampleRate; }
    get destination() {
      if (!this.__tapIn) {
        const real = super.destination;
        const g = this.createGain();
        const sp = this.createChannelSplitter(2);
        const aL = this.createAnalyser(), aR = this.createAnalyser();
        aL.fftSize = aR.fftSize = 2048;
        g.connect(sp);
        sp.connect(aL, 0);
        sp.connect(aR, 1);
        g.connect(real);
        this.__tapIn = g;
        const bl = new Float32Array(2048), br = new Float32Array(2048);
        window.__tapRead = () => {
          aL.getFloatTimeDomainData(bl);
          aR.getFloatTimeDomainData(br);
          let l = 0, r = 0;
          for (let i = 0; i < bl.length; i++) { l += bl[i] * bl[i]; r += br[i] * br[i]; }
          if (l + r > 1e-4) {
            for (let k = -100; k <= 100; k++) {
              let s = 0;
              const lo = Math.max(0, -k), hi = Math.min(bl.length, br.length - k);
              for (let i = lo; i < hi; i++) s += bl[i] * br[i + k];
              window.__xc[k + 100] += s;
            }
          }
          return { l, r, n: bl.length };
        };
      }
      return this.__tapIn;
    }
  }
  window.AudioContext = TapContext;
})();`;

interface Stop {
    i: number;
    region: string;
    tag: string;
    type: string | null;
    name: string;
    testid: string | null;
    inside: boolean;
}

const checks: { name: string; pass: boolean; value?: unknown }[] = [];
const check = (name: string, pass: boolean, value?: unknown): void => {
    checks.push({ name, pass, value });
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${value === undefined ? '' : '  ' + JSON.stringify(value).slice(0, 240)}`);
};

/** Where the focus is: the element, its region, and the name a screen reader would give it. */
const FOCUS = `(() => {
  const e = document.activeElement;
  if (!e || e === document.body) return null;
  const name = (el) => {
    const lb = el.getAttribute('aria-labelledby');
    if (lb) return lb.split(/\\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ').trim();
    if (el.getAttribute('aria-label')) return el.getAttribute('aria-label');
    if (el.labels && el.labels.length) return [...el.labels].map((l) => l.textContent).join(' ').trim();
    if (el.tagName === 'INPUT' && el.type === 'radio') return (el.closest('fieldset')?.querySelector('legend')?.textContent ?? '') + ': ' + (document.querySelector('label[for="' + el.id + '"]')?.textContent ?? '');
    return (el.textContent ?? '').trim().replace(/\\s+/g, ' ');
  };
  const region = e.closest('nav') ? 'nav' : e.closest('header') ? 'header' : e.closest('footer') ? 'footer' : e.closest('section[id]') ? e.closest('section[id]').id.replace('sonic-sec-', '') : e.closest('#sonic-start') ? 'start' : 'outside';
  return { tag: e.tagName.toLowerCase(), type: e.getAttribute('type'), name: name(e), region, testid: e.getAttribute('data-testid'), inside: !!e.closest('#sonic-start'), id: e.id };
})()`;

async function focus(page: Page): Promise<(Omit<Stop, 'i'> & { id: string }) | null> {
    return page.evaluate(FOCUS) as Promise<(Omit<Stop, 'i'> & { id: string }) | null>;
}

async function tabs(page: Page, max: number, key = 'Tab'): Promise<Stop[]> {
    const stops: Stop[] = [];
    let first: string | null = null;
    for (let i = 0; i < max; i++) {
        await page.keyboard.press(key);
        const f = await focus(page);
        if (!f) break; // the focus left the page's elements
        const id = `${f.tag}:${f.id}:${f.testid}:${f.name}`;
        if (first === null) first = id;
        else if (id === first && i > 2) break; // wrapped round
        stops.push({ i, region: f.region, tag: f.tag, type: f.type, name: f.name, testid: f.testid, inside: f.inside });
    }
    return stops;
}

/**
 * Energy in each channel over `ms`, from the tap, and the lag in samples at which the channels agree best (positive: the
 * right channel is the left one delayed, so the sound came from the left), with the sample rate.
 */
async function energy(page: Page, ms: number): Promise<{ l: number; r: number; polls: number; lag: number; sampleRate: number }> {
    return page.evaluate(
        (span) =>
            new Promise<{ l: number; r: number; polls: number; lag: number; sampleRate: number }>((resolve) => {
                const w = window as unknown as { __tapRead: (() => { l: number; r: number }) | null; __xc: Float64Array; __sr: number };
                w.__xc.fill(0);
                let l = 0, r = 0, polls = 0;
                const id = setInterval(() => {
                    if (!w.__tapRead) return;
                    const v = w.__tapRead();
                    l += v.l;
                    r += v.r;
                    polls++;
                }, 20);
                setTimeout(() => {
                    clearInterval(id);
                    let best = 0;
                    for (let k = 0; k < w.__xc.length; k++) if (w.__xc[k]! > w.__xc[best]!) best = k;
                    resolve({ l, r, polls, lag: best - 100, sampleRate: w.__sr });
                }, span);
            }),
        ms
    );
}

/** Polls `cond` until it holds or `ms` pass: the prefs store writes 250 ms after a change. */
async function until(cond: () => Promise<boolean>, ms = 2000): Promise<boolean> {
    const t0 = Date.now();
    for (;;) {
        if (await cond()) return true;
        if (Date.now() - t0 > ms) return false;
        await sleep(50);
    }
}

const db = (a: number, b: number): number => 10 * Math.log10((a + 1e-20) / (b + 1e-20));

/** The WCAG contrast ratio of a text colour on its background, computed in the page for some elements. */
const CONTRAST = `(() => {
  const lum = (c) => { const [r, g, b] = c.match(/[\\d.]+/g).slice(0, 3).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const c = getComputedStyle(e).backgroundColor; if (c && !/rgba\\(0, 0, 0, 0\\)|transparent/.test(c)) return c; } return 'rgb(7, 8, 10)'; };
  const ratio = (el) => { const f = lum(getComputedStyle(el).color), b = lum(bgOf(el)); const hi = Math.max(f, b), lo = Math.min(f, b); return (hi + 0.05) / (lo + 0.05); };
  const q = (s) => document.querySelector(s);
  const out = {};
  for (const [k, s] of Object.entries({ intro: '.sonic-intro', h2: '#sonic-h-start', link: 'nav a', primary: '.btn.primary', primarySub: '.btn.primary .sonic-sub', lesson: '.sonic-lesson', lessonSub: '.sonic-lesson .sonic-sub', note: '.sonic-notes li', label: '.sonic-field label' })) { const el = q(s); if (el) out[k] = Math.round(ratio(el) * 100) / 100; }
  return out;
})()`;

await lock();
try {
    const L = await launch({ width: 1280, height: 800 });
    await L.context.addInitScript(INIT);
    await L.context.addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: LAB }]);
    const page = L.page;
    const notFound: string[] = [];
    page.on('response', (r) => { if (r.status() === 404) notFound.push(r.url()); });
    const url = `${LAB}/fly/?sonic=start&nowarn=1`;
    await page.goto(url);
    await page.waitForSelector('#sonic-start [data-testid="sonic-h1"]', { timeout: 60000 });
    await sleep(500);

    // ---------------------------------------------------------------- structure
    const s = await page.evaluate(() => {
        const q = (sel: string) => [...document.querySelectorAll(sel)];
        const root = document.getElementById('sonic-start')!;
        return {
            title: document.title,
            viewport: document.querySelector('meta[name="viewport"]')?.getAttribute('content') ?? null,
            banner: root.querySelectorAll(':scope > header').length,
            nav: root.querySelectorAll(':scope > nav[aria-label]').length,
            main: root.querySelectorAll(':scope > main').length,
            footer: root.querySelectorAll(':scope > footer').length,
            h1: q('#sonic-start h1').map((e) => e.textContent),
            h2: q('#sonic-start h2').map((e) => e.textContent),
            h3: q('#sonic-start h3').map((e) => e.textContent),
            lessons: q('#sonic-start [data-testid="sonic-lesson"]').map((e) => ({ tag: e.tagName, id: e.getAttribute('data-lesson'), type: e.getAttribute('type'), text: (e.textContent ?? '').trim() })),
            divButtons: q('#sonic-start div[onclick], #sonic-start span[onclick], #sonic-start [role="button"]').length,
            focused: document.activeElement?.id,
            hasUiLive: document.getElementById('ui')?.getAttribute('aria-live'),
            uiInsideStart: !!document.getElementById('sonic-start')?.querySelector('#ui'),
            startOutsideUi: !document.getElementById('ui')?.contains(document.getElementById('sonic-start'))
        };
    });
    check('the page title is the product\'s', s.title === 'Fly by Sound', s.title);
    check('the viewport allows zoom (no user-scalable=no, no maximum-scale)', !!s.viewport && !/user-scalable\s*=\s*no|maximum-scale/.test(s.viewport), s.viewport);
    check('landmarks: one header, one labelled navigation, one main, one footer in the start layer', s.banner === 1 && s.nav === 1 && s.main === 1 && s.footer === 1, { banner: s.banner, nav: s.nav, main: s.main, footer: s.footer });
    check('one h1 (the product), four h2 (start, headphones, lessons, settings)', s.h1.length === 1 && s.h2.length === 4, { h1: s.h1, h2: s.h2 });
    check('the h1 has the focus when the screen opens', s.focused === 'sonic-h1', s.focused);
    check('eight module headings and the loudness heading are h3', s.h3.length === 9, s.h3);
    check('21 lessons, each a real button with a name', s.lessons.length === 21 && s.lessons.every((l) => l.tag === 'BUTTON' && l.type === 'button' && l.text.length > 3), s.lessons.length);
    check('no div or span made into a button', s.divButtons === 0);
    const dupes = await page.evaluate(() => { const seen = new Map<string, number>(); for (const e of document.querySelectorAll('[id]')) seen.set(e.id, (seen.get(e.id) ?? 0) + 1); return [...seen].filter(([, n]) => n > 1).map(([id]) => id); });
    check('no id is used twice on the page', dupes.length === 0, dupes);
    check('the start layer is not inside #ui (an aria-live region): its changes are not read out', s.hasUiLive === 'polite' && s.startOutsideUi && !s.uiInsideStart, { uiLive: s.hasUiLive });
    const contrast = await page.evaluate(CONTRAST) as Record<string, number>;
    check('the text colours have a contrast of at least 4.5:1 on their background', Object.values(contrast).length >= 8 && Object.values(contrast).every((v) => v >= 4.5), contrast);

    let snapshot = '';
    try {
        snapshot = await page.locator('#sonic-start').ariaSnapshot();
    } catch (e) {
        snapshot = `(ariaSnapshot not available: ${String((e as Error).message).slice(0, 80)})`;
    }
    check('the accessibility snapshot names the landmarks and headings', /banner|heading/.test(snapshot) && /navigation/.test(snapshot) && /main/.test(snapshot) && /contentinfo/.test(snapshot) && /heading "Fly by Sound" \[level=1\]/.test(snapshot), snapshot.split('\n').slice(0, 6));

    // no raw key on the screen, in any of the four languages
    const rawKeys: Record<string, string[]> = {};
    for (const lang of ['en', 'es', 'pl', 'ru']) {
        await L.context.addCookies([{ name: 'NEXT_LOCALE', value: lang, url: LAB }]);
        await page.goto(url);
        await page.waitForSelector('#sonic-start [data-testid="sonic-h1"]', { timeout: 60000 });
        const text = await page.evaluate(() => (document.getElementById('sonic-start')!.innerText ?? '') + ' ' + [...document.querySelectorAll('#sonic-start [aria-label]')].map((e) => e.getAttribute('aria-label')).join(' '));
        rawKeys[lang] = (text.match(/\b(?:sonic|menu|lesson|module|layer|theme|headphones|fly|cue|status)\.[a-z0-9.-]+/g) ?? []);
        const first = await page.evaluate(() => document.getElementById('sonic-h1')?.textContent ?? '');
        console.log(`    ${lang}: h1 "${first}", ${text.length} characters`);
    }
    check('no dictionary key shows as text in en, es, pl or ru', Object.values(rawKeys).every((k) => k.length === 0), rawKeys);
    await L.context.addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: LAB }]);
    await page.goto(url);
    await page.waitForSelector('#sonic-start [data-testid="sonic-h1"]', { timeout: 60000 });
    await sleep(300);

    // widths: no sideways scroll, a screenshot of each
    const widths = [1280, 640, 360];
    const reflow: Record<string, unknown>[] = [];
    for (const w of widths) {
        await page.setViewportSize({ width: w, height: 800 });
        await sleep(200);
        const r = await page.evaluate(() => { const e = document.getElementById('sonic-start')!; return { client: e.clientWidth, scroll: e.scrollWidth }; });
        writeFileSync(join(OUT, `start-${w}.png`), await page.screenshot({ type: 'png' }));
        reflow.push({ width: w, ...r });
    }
    check('no sideways scroll at 1280, 640 and 360 px wide', reflow.every((r) => (r.scroll as number) <= (r.client as number) + 1), reflow);
    await page.setViewportSize({ width: 1280, height: 800 });

    // ---------------------------------------------------------------- Tab order
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.evaluate(() => document.getElementById('sonic-h1')!.focus());
    const stops = await tabs(page, 120);
    const lessonStops = stops.filter((x) => x.testid === 'sonic-lesson');
    check('every stop of Tab is inside the start layer', stops.length > 40 && stops.every((x) => x.inside), { stops: stops.length, outside: stops.filter((x) => !x.inside).map((x) => x.name) });
    check('every stop has a name', stops.every((x) => x.name.trim().length > 0), stops.filter((x) => !x.name.trim()).length);
    const order = ['nav', 'start', 'headphones', 'lessons', 'settings', 'footer'];
    const regionIdx = stops.map((x) => order.indexOf(x.region));
    check('the stops follow the document: navigation, start, headphones, lessons, settings, footer', regionIdx.every((v, i) => v >= 0 && (i === 0 || v >= regionIdx[i - 1]!)), [...new Set(stops.map((x) => x.region))]);
    check('all 21 lessons are reached by Tab, once each', lessonStops.length === 21 && new Set(lessonStops.map((x) => x.name)).size === 21, lessonStops.length);
    check('the radio group is one stop (the arrow keys move inside it)', stops.filter((x) => x.type === 'radio').length === 1, stops.filter((x) => x.type === 'radio').length);
    check('the headphone check has three buttons in the order left, right, behind', JSON.stringify(stops.filter((x) => x.region === 'headphones' && x.tag === 'button').map((x) => x.testid)) === JSON.stringify(['sonic-hp-left', 'sonic-hp-right', 'sonic-hp-behind']), stops.filter((x) => x.region === 'headphones').map((x) => x.testid));
    const last = stops[stops.length - 1];
    check('the last stop is the footer\'s last link (no trap: Tab goes on to the browser)', last?.region === 'footer' && last.tag === 'a', last);

    // Shift+Tab goes back the same way
    const back = await tabs(page, 10, 'Shift+Tab');
    check('Shift+Tab walks back through the same stops, last first', back.length >= 5 && back[0]!.name === stops[stops.length - 1]!.name && back[1]!.name === stops[stops.length - 2]!.name && back[2]!.name === stops[stops.length - 3]!.name, back.slice(0, 3).map((x) => x.name));

    // the details control: Space opens it, 14 sliders follow
    await page.evaluate(() => document.querySelector<HTMLElement>('#sonic-start summary')!.focus());
    await page.keyboard.press('Space');
    await sleep(100);
    const open = await page.evaluate(() => (document.querySelector('#sonic-start details') as HTMLDetailsElement).open);
    let sliders = 0;
    for (let i = 0; i < 20; i++) {
        await page.keyboard.press('Tab');
        const f = await focus(page);
        if (f?.type === 'range') sliders++;
        else if (sliders > 0) break;
    }
    check('Space opens the volume and pitch details and 14 sliders follow (7 sounds, a volume and a pitch each)', open && sliders === 14, { open, sliders });

    // ---------------------------------------------------------------- operation by keyboard
    const prefsOf = async (): Promise<Record<string, unknown>> => page.evaluate(() => {
        const raw = localStorage.getItem('gsfpv.prefs.v1');
        const j = raw ? JSON.parse(raw) : null;
        return j?.collections?.sonic?.prefs ?? {};
    });
    // the path: focus the radio, an arrow key moves it to the other one (and the Start buttons follow)
    await page.evaluate(() => document.getElementById('sonic-path-full')!.focus());
    await page.keyboard.press('ArrowDown');
    const fastSaved = await until(async () => (await prefsOf()).path === 'fast');
    check('an arrow key moves the path to "fast" and it is saved', fastSaved, (await prefsOf()).path);
    const startSub = await page.evaluate(() => document.querySelector('[data-testid="sonic-start-beginning"] .sonic-sub')?.textContent);
    await page.keyboard.press('ArrowUp');
    const fullSaved = await until(async () => (await prefsOf()).path === 'full');
    check('and back to "full"', fullSaved);
    check('the Start button names the first lesson of the path', typeof startSub === 'string' && startSub.length > 5, startSub);
    // calm mode: Space
    await page.evaluate(() => document.getElementById('sonic-calm')!.focus());
    await page.keyboard.press('Space');
    check('Space on "Calm mode" turns it on and it is saved', await until(async () => (await prefsOf()).calm === true), (await prefsOf()).calm);
    // my screen reader speaks: the captions region turns live
    await page.evaluate(() => document.getElementById('sonic-sr')!.focus());
    await page.keyboard.press('Space');
    await until(async () => (await prefsOf()).selfVoice === false);
    const cap = await page.evaluate(() => { const c = document.querySelector('[data-testid="sonic-captions"]'); return { live: c?.getAttribute('aria-live'), role: c?.getAttribute('role') }; });
    check('Space on "My screen reader speaks" saves selfVoice off and makes the captions a live region', (await prefsOf()).selfVoice === false && cap.live === 'polite', cap);
    await page.keyboard.press('Space');
    const spoke = await until(async () => (await prefsOf()).selfVoice === true);
    check('and off again: the engine speaks, the captions are not live', spoke && (await page.evaluate(() => document.querySelector('[data-testid="sonic-captions"]')?.getAttribute('aria-live'))) === 'off');
    // calm mode off again: the rest of the run starts from the plain settings
    await page.evaluate(() => document.getElementById('sonic-calm')!.focus());
    await page.keyboard.press('Space');
    check('Space on "Calm mode" again turns it off', await until(async () => (await prefsOf()).calm === false));

    // the headphone check by Enter: the first press makes the AudioContext, the hum is on the side asked
    check('no AudioContext before the first sound button', (await page.evaluate(() => (window as unknown as { __acCount: number }).__acCount)) === 0);
    const sides: Record<string, { l: number; r: number; dB: number; lagSamples: number; itdMs: number }> = {};
    for (const side of ['left', 'right', 'behind'] as const) {
        await page.evaluate((id) => document.querySelector<HTMLElement>(`[data-testid="sonic-hp-${id}"]`)!.focus(), side);
        await page.keyboard.press('Enter');
        await sleep(side === 'left' ? 1500 : 700);
        const e = await energy(page, 2500);
        sides[side] = { l: e.l, r: e.r, dB: db(e.l, e.r), lagSamples: e.lag, itdMs: Math.round((e.lag / e.sampleRate) * 1e5) / 100 };
        const status = await page.evaluate(() => document.querySelector('[data-testid="sonic-status"]')?.textContent);
        console.log(`    ${side}: L ${e.l.toExponential(2)} R ${e.r.toExponential(2)}  ${db(e.l, e.r).toFixed(1)} dB  lag ${e.lag} samples  status "${status}"`);
        await sleep(1500); // the preview ends
    }
    check('one AudioContext after the headphone buttons', (await page.evaluate(() => (window as unknown as { __acCount: number }).__acCount)) === 1);
    // a low hum is placed by the arrival time more than by the level: both are measured, left and right must agree in sign
    check('sound on the left: the left channel is louder (at least 1 dB) and leads (the right channel lags by at least 3 samples)', sides.left!.l > 1e-6 && sides.left!.dB >= 1 && sides.left!.lagSamples >= 3, sides.left);
    check('sound on the right: the right channel is louder (at least 1 dB) and leads (the left channel lags by at least 3 samples)', sides.right!.r > 1e-6 && sides.right!.dB <= -1 && sides.right!.lagSamples <= -3, sides.right);
    check('sound behind: the two channels are level (within 1 dB) and arrive together (within 2 samples)', sides.behind!.l > 1e-6 && Math.abs(sides.behind!.dB) <= 1 && Math.abs(sides.behind!.lagSamples) <= 2, sides.behind);
    check('control: left and right are opposite pictures (balance differs by at least 3 dB, the delays have opposite signs)', Math.abs(sides.left!.dB - sides.right!.dB) >= 3 && Math.sign(sides.left!.lagSamples) === -Math.sign(sides.right!.lagSamples), { left: sides.left, right: sides.right });

    // ---------------------------------------------------------------- Enter on a lesson opens the flight
    await page.evaluate(() => document.querySelector<HTMLElement>('[data-testid="sonic-lesson"][data-lesson="hover-height"]')!.focus());
    writeFileSync(join(OUT, 'start-before-lesson.png'), await page.screenshot({ type: 'png' }));
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => { const h = (window as unknown as { __gsfpv?: { status?: string } }).__gsfpv; return h?.status === 'ready' || h?.status === 'error'; }, undefined, { timeout: 60000 });
    await sleep(800);
    const flight = await page.evaluate(() => {
        const h = (window as unknown as { __gsfpv: { status?: string; error?: string; info?: Record<string, unknown>; session?: { scene: { id: string }; builtin: unknown; sim?: { armed: boolean } } } }).__gsfpv;
        const root = document.getElementById('sonic-start')!;
        return {
            status: h.status, error: h.error ?? null,
            scene: h.session?.scene.id ?? null,
            builtin: !!h.session?.builtin,
            sha: (h.info?.collisionSha256 as string | undefined)?.length ?? 0,
            hidden: root.hidden, inert: root.hasAttribute('inert'),
            flying: document.body.classList.contains('flying'),
            controlsScreen: !!document.querySelector('.screen.radio'),
            loadingCard: !!document.querySelector('.loading'),
            ac: (window as unknown as { __acCount: number }).__acCount,
            pointers: (window as unknown as { __pointer: number }).__pointer
        };
    });
    check('Enter on the hover lesson: the page flies that lesson\'s built-in world (scene lesson-hover-height, the world\'s digest as its walls)', flight.status === 'ready' && flight.scene === 'lesson-hover-height' && flight.builtin && flight.sha === 64, flight);
    check('the start screen is gone from the page and the accessibility tree (hidden and inert)', flight.hidden && flight.inert);
    check('no Controls screen and no loading card in the way: the keyboard flies at once', !flight.controlsScreen && !flight.loadingCard && flight.flying);
    check('still one AudioContext for the whole mode', flight.ac === 1, flight.ac);
    check('no pointer event in the whole run: the keyboard did everything', flight.pointers === 0, flight.pointers);
    writeFileSync(join(OUT, 'flight-after-enter.png'), await page.screenshot({ type: 'png' }));

    // a lesson that does not exist is said, not crashed on
    await page.goto(`${LAB}/fly/?sonic=no-such-lesson&nowarn=1`);
    await page.waitForSelector('[data-testid="sonic-unknown"]', { timeout: 30000 });
    check('?sonic=<unknown> shows the start screen with a note', true, await page.evaluate(() => document.querySelector('[data-testid="sonic-unknown"]')?.textContent));
    await page.goto(`${LAB}/fly/?sonic=walls-hall&nowarn=1`);
    await page.waitForSelector('[data-testid="sonic-start-asked"]', { timeout: 30000 });
    const asked = await page.evaluate(() => { const b = document.querySelector('[data-testid="sonic-start-asked"]'); return { text: b?.textContent, lesson: b?.getAttribute('data-lesson'), primary: b?.classList.contains('primary') }; });
    check('?sonic=walls-hall offers that lesson first, as the primary button', asked.lesson === 'walls-hall' && asked.primary === true, asked);

    // a refresh keeps what the pilot chose (the saved settings and path)
    const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('gsfpv.prefs.v1') ?? '{}').collections?.sonic ?? null);
    check('the pilot\'s choices and the current lesson are saved in the prefs collection', kept !== null && kept.current === 'hover-height' && typeof kept.prefs === 'object', { current: kept?.current, prefs: kept?.prefs });

    // the Vite dev server has no API: /api/catalog and the /api/e beacons answer 404 there, and a browser asks for /favicon.ico
    const missing = notFound.filter((u) => !/\/favicon\.ico$/.test(u) && !/\/api\//.test(u));
    const errors = L.console.filter((l) => /^(error|pageerror)/i.test(l) && !/Failed to load resource.*404/.test(l));
    check('no console errors and no missing file (but the favicon and the API the dev server does not have)', errors.length === 0 && missing.length === 0, { errors: errors.slice(0, 5), missing, notFound });

    const file = writeEvidence('sonic-start-keyboard', {
        step: 'v12-flight 8: the accessible start screen, driven by the keyboard alone in headless Chrome',
        page: `${LAB}/fly/?sonic=start (Vite dev server)`,
        note: 'headless Chrome runs muted (--mute-audio): the audio graph is rendered and measured per channel, nothing is played; how it sounds is not judged here',
        contrast,
        reflow,
        tabStops: stops,
        ariaSnapshot: snapshot,
        sides,
        notFound,
        flight,
        checks,
        pass: checks.every((c) => c.pass)
    });
    console.log(`evidence ${file}; ${checks.filter((c) => c.pass).length}/${checks.length} checks pass`);
    await L.browser.close();
} finally {
    unlock();
}
