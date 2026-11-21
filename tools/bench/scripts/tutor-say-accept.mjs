// Lane tutor-say (train 4), S4: the acceptance by the MOUSE (decisions 1, 7, 8, 9 of the tutor brief; the low-vision pilot's point 1:
// "the menu buttons should not be read at every step"). ?render=off (no picture is judged by the GPU: no GPU lock), headless Chrome
// through visual-browser.mjs pickHarnessBrowser, 1536 x 730 at device scale 1.25, a NEW profile (an empty user-data dir).
//
// Steps, each PASS or FAIL in one JSON:
//   open        the first key of a fresh page (ArrowDown, a list key: it starts the sound) -> the voice says ONE opening line, the
//               title and the main button (no welcome list, no "Item n of N", no list of keys), then only the stop the key moved to
//   tab         Shift+Tab back to Start flying, then Tab -> the voice says "All lessons" and nothing else
//   start       a click on Start flying (data-testid sonic-start-quick) starts a lesson; a click into the scene (the pointer lock)
//   steps       key N three times: between two steps the spoken lines and the live-region announcements are the instruction only
//               (no list of keys, no counter, no button in a live region, the focus kept); the screen shows ONE line
//               (data-testid sonic-instruction) with no counter, equal to the hook's panel text
//   once        over the whole lesson part the line of keys is said at most once, and no Start button's name is said
//   askK        key K (action help.keys) says the keys when asked
//   guide       the sound start screen's Guide row (first level): a change keeps the Start buttons (not redrawn) and the focus on the
//               row; after a reload the value is remembered
// Two pictures: the start screen at open, the one instruction line in a lesson.
//
// Usage: node tools/bench/scripts/tutor-say-accept.mjs <base, e.g. http://localhost:7021> <out.json> [<shot prefix>]
// Against the live site it only reads: the profile is a throwaway folder; nothing is saved, sent or created on the site.
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { pickHarnessBrowser } from './visual-browser.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '');
const require = createRequire(ROOT + '/tools/bench/package.json');
const { chromium } = require('playwright');
const [base = 'http://localhost:7021', outFile = 'U:/Temp/gsfpv-train4/tutor-say/accept.json', shots = ''] = process.argv.slice(2);
const TEMP = 'U:/Temp/gsfpv-train4/tutor-say';
const VIEW = { viewport: { width: 1536, height: 730 }, deviceScaleFactor: 1.25 };
const URL_START = `${base}/en/fly/?sonic=start&render=off&nowarn=1`;
const T0 = Date.now();
const log = (...a) => console.error(`[${((Date.now() - T0) / 1000).toFixed(0).padStart(4)}s]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** a text that is not an instruction: a list of keys, a counter, a Start button's name */
const KEYLIST = /\bkey [A-Z]\b.*\bkey [A-Z]\b/i;
const COUNTER = /\b\d+ (of|\/) \d+\b|\bStep \d|\bItem \d/i;
const BUTTONS = /Start flying|All lessons|Quick start|Full course/i;

// in the page, before its scripts: speech said at an estimated length (so the queue behaves), and the live-region log
function spy() {
    const w = window;
    w.__ax = { said: [], live: [], idle: () => true };
    const synth = w.speechSynthesis;
    if (synth) {
        let queue = [];
        let current = null;
        let timer = 0;
        const next = () => {
            if (current !== null || queue.length === 0) return;
            const u = (current = queue.shift());
            const text = String(u.text ?? '');
            const sec = text.trim() === '' ? 0 : 0.4 + (text.length * 0.065) / Math.max(u.rate || 1, 0.25);
            w.__ax.said.push({ t: performance.now(), text });
            u.dispatchEvent(new Event('start'));
            timer = setTimeout(() => {
                current = null;
                u.dispatchEvent(new Event('end'));
                next();
            }, sec * 1000);
        };
        synth.speak = (u) => {
            queue.push(u);
            next();
        };
        synth.cancel = () => {
            const all = [current, ...queue].filter((x) => x !== null);
            queue = [];
            clearTimeout(timer);
            current = null;
            for (const u of all) u.dispatchEvent(new Event('end'));
        };
        Object.defineProperty(synth, 'speaking', { get: () => current !== null });
        Object.defineProperty(synth, 'pending', { get: () => queue.length > 0 });
        w.__ax.idle = () => current === null && queue.length === 0;
    }
    const liveRoot = (n) => {
        for (let el = n && n.nodeType === 1 ? n : n?.parentElement; el; el = el.parentElement) {
            const live = el.getAttribute('aria-live');
            const role = el.getAttribute('role');
            if (live === 'off') return null;
            if (live || role === 'log' || role === 'status' || role === 'alert') return el;
        }
        return null;
    };
    const name = (el) => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.getAttribute('data-testid') ? '[' + el.getAttribute('data-testid') + ']' : ''}`;
    const text = (n) => (n.textContent ?? '').replace(/\s+/g, ' ').trim();
    const start = () => {
        new MutationObserver((list) => {
            for (const m of list) {
                const root = liveRoot(m.target);
                if (!root) continue;
                const added = m.type === 'characterData' ? [text(m.target)] : [...m.addedNodes].map(text).filter((x) => x !== '');
                const buttons = m.type === 'childList' ? [...m.addedNodes].filter((n) => n.nodeType === 1).flatMap((n) => [...(n.matches('button') ? [n] : []), ...n.querySelectorAll('button')]).length : 0;
                if (added.length === 0 && buttons === 0) continue;
                if (w.__ax.live.length < 3000) w.__ax.live.push({ t: performance.now(), region: name(root), added: added.map((x) => x.slice(0, 200)), buttons });
            }
        }).observe(document.documentElement, { subtree: true, childList: true, characterData: true });
    };
    if (document.documentElement) start();
    else document.addEventListener('DOMContentLoaded', start);
}

const hook = (page) => page.evaluate(() => window.__gsfpv?.sonic?.(false) ?? null).catch(() => null);
const mark = (page) => page.evaluate(() => ({ said: window.__ax.said.length, live: window.__ax.live.length }));
const since = (page, m) => page.evaluate((k) => ({ said: window.__ax.said.slice(k.said).map((x) => x.text), live: window.__ax.live.slice(k.live) }), m);
const focusOf = (page) => page.evaluate(() => {
    const a = document.activeElement;
    return a ? `${a.tagName.toLowerCase()}${a.id ? '#' + a.id : ''}${a.getAttribute('data-testid') ? '[' + a.getAttribute('data-testid') + ']' : ''}` : null;
});

/** the speech queue empty (at least `min` ms after the press) */
async function quiet(page, min = 600, max = 15000) {
    await sleep(min);
    for (let t = min; t < max; t += 150) {
        if (await page.evaluate(() => window.__ax.idle()).catch(() => true)) return;
        await sleep(150);
    }
}

async function clickCentre(page, sel) {
    const loc = page.locator(sel).first();
    if (!(await loc.isVisible().catch(() => false))) return false;
    await loc.scrollIntoViewIfNeeded().catch(() => undefined);
    const box = await loc.boundingBox();
    if (!box) return false;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.up();
    return true;
}

async function axTree(cdp) {
    const { nodes } = await cdp.send('Accessibility.getFullAXTree');
    const out = [];
    for (const n of nodes) {
        if (n.ignored) continue;
        const role = n.role?.value ?? '';
        const nm = String(n.name?.value ?? '').replace(/\s+/g, ' ').trim();
        if (!nm || role === 'StaticText' || role === 'InlineTextBox') continue;
        out.push(`${role}|${nm.slice(0, 160)}`);
    }
    return out;
}

const diff = (a, b) => {
    const left = new Map();
    for (const x of a) left.set(x, (left.get(x) ?? 0) + 1);
    const added = [];
    for (const x of b) {
        const n = left.get(x) ?? 0;
        if (n > 0) left.set(x, n - 1);
        else added.push(x);
    }
    return added;
};

const steps = {};
const step = (id, pass, facts) => {
    steps[id] = { pass: !!pass, ...facts };
    log(id, pass ? 'PASS' : 'FAIL', JSON.stringify(facts).slice(0, 300));
};

async function waitStart(page) {
    for (let i = 0; i < 300 && !(await page.evaluate(() => !!document.querySelector('[data-testid="sonic-start"] button')).catch(() => false)); i++) await sleep(100);
    await sleep(800);
}

async function startScreen(page) {
    await page.goto(URL_START, { waitUntil: 'load' });
    await waitStart(page);
    if (shots) await page.screenshot({ path: `${shots}-start.png` }).catch(() => undefined);
    // open: the first key of a fresh page (a list key, so the screen's voice starts with it)
    let m = await mark(page);
    await page.keyboard.press('ArrowDown');
    await quiet(page, 800);
    const open = (await since(page, m)).said;
    const first = open[0] ?? '';
    const rest = open.slice(1);
    step('open', /^Fly by Sound\b/.test(first) && /Start flying/.test(first) && !COUNTER.test(first) && !KEYLIST.test(first) && first.split(/[.!?]\s/).length <= 3 && rest.length <= 1 && rest.every((x) => /All lessons/.test(x) && !COUNTER.test(x) && !KEYLIST.test(x)), { spoken: open, focus: await focusOf(page) });
    // tab: back to Start flying, then Tab to All lessons
    await page.keyboard.press('Shift+Tab');
    await quiet(page, 500);
    m = await mark(page);
    await page.keyboard.press('Tab');
    await quiet(page, 500);
    const tab = (await since(page, m)).said;
    const f = await focusOf(page);
    step('tab', tab.length === 1 && /All lessons/.test(tab[0]) && !COUNTER.test(tab[0]) && !KEYLIST.test(tab[0]) && /sonic-start-all/.test(f ?? ''), { spoken: tab, focus: f });
}

async function lesson(page, cdp) {
    const m0 = await mark(page);
    const clicked = await clickCentre(page, '[data-testid="sonic-start-quick"]');
    await sleep(1500);
    await page.mouse.click(VIEW.viewport.width / 2, Math.round(VIEW.viewport.height * 0.6)).catch(() => undefined);
    let s = null;
    for (let i = 0; i < 400; i++) {
        s = await hook(page);
        if (s?.lesson && s.speechQueue === 0 && s.panel) break;
        await sleep(100);
    }
    await sleep(1500);
    const locked = await page.evaluate(() => !!document.pointerLockElement).catch(() => false);
    step('start', clicked && !!s?.lesson, { clicked, lesson: s?.lesson ?? null, pointerLock: locked });
    const changes = [];
    for (let i = 0; i < 3; i++) {
        const before = await axTree(cdp);
        const f0 = await focusOf(page);
        const m = await mark(page);
        await page.keyboard.press('KeyN');
        for (let k = 0; k < 80; k++) {
            await sleep(100);
            if (k > 15 && (await hook(page))?.speechQueue === 0) break;
        }
        await sleep(1200);
        const after = await axTree(cdp);
        const f1 = await focusOf(page);
        const h1 = await hook(page);
        const got = await since(page, m);
        const announced = got.live.flatMap((x) => x.added.map((a) => `${x.region}: ${a}`));
        const liveButtons = got.live.reduce((a, x) => a + x.buttons, 0);
        const texts = [...got.live.flatMap((x) => x.added), ...got.said];
        const bad = texts.filter((x) => KEYLIST.test(x) || COUNTER.test(x) || BUTTONS.test(x));
        const shown = await page.evaluate(() => ({
            line: (document.querySelector('[data-testid="sonic-instruction"]')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
            panel: (document.querySelector('[data-testid="sonic-progress"]')?.textContent ?? '').replace(/\s+/g, ' ').trim()
        }));
        // feature.ts R5: when the flight goes on and nothing holds the focus (body), the flight's role=application region takes it
        const focusOk = f0 === f1 || (f0 === 'body' && f1 === 'div[sonic-flight]');
        const screenOk = shown.line !== '' && !COUNTER.test(shown.panel) && (h1?.panel ?? '') === shown.line;
        const pass = bad.length === 0 && liveButtons === 0 && focusOk && screenOk;
        changes.push({ to: h1?.panel ?? '', pass, bad, liveButtons, focus: [f0, f1], screen: shown, spoken: got.said, announced: announced.slice(0, 30), axAdded: diff(before, after).slice(0, 30) });
        log('step', i, pass ? 'PASS' : 'FAIL', JSON.stringify({ bad, shown }).slice(0, 300));
    }
    if (shots) await page.screenshot({ path: `${shots}-instruction.png` }).catch(() => undefined);
    step('steps', changes.length === 3 && changes.every((c) => c.pass), { lesson: (await hook(page))?.lesson ?? null, changes });
    const all = (await since(page, m0)).said;
    const keyLines = all.filter((x) => KEYLIST.test(x));
    const buttons = all.filter((x) => BUTTONS.test(x));
    step('once', keyLines.length <= 1 && buttons.length === 0, { keyLines, buttons, spokenCount: all.length });
    const mk = await mark(page);
    await page.keyboard.press('KeyK');
    await quiet(page, 800, 30000);
    const k = (await since(page, mk)).said;
    step('askK', k.some((x) => /\bkey [A-Z]\b/i.test(x)), { spoken: k.slice(0, 8) });
}

async function guide(page) {
    await page.goto(URL_START, { waitUntil: 'load' });
    await waitStart(page);
    const sel = '[data-testid="sonic-guide"], #sonic-guide';
    const clicked = await clickCentre(page, sel);
    await page.evaluate(() => {
        const q = document.querySelector('[data-testid="sonic-start-quick"]');
        if (q) q.dataset.probeMark = '1';
    });
    let value = null;
    if (clicked) {
        await page.locator(sel).first().selectOption('new').catch(() => undefined);
        await sleep(600);
        value = await page.locator(sel).first().inputValue().catch(() => null);
    }
    const kept = await page.evaluate(() => document.querySelector('[data-testid="sonic-start-quick"]')?.dataset.probeMark === '1');
    const f = await focusOf(page);
    await page.reload({ waitUntil: 'load' });
    await waitStart(page);
    const after = await page.locator(sel).first().inputValue().catch(() => null);
    step('guide', clicked && value === 'new' && kept && /sonic-guide/.test(f ?? '') && after === 'new', { clicked, value, startButtonsKept: kept, focus: f, afterReload: after });
}

const pick = pickHarnessBrowser({ expected: chromium.executablePath() }, false);
mkdirSync(TEMP, { recursive: true });
const dir = mkdtempSync(`${TEMP}/profile-`);
const errors = [];
let ctx = null;
try {
    ctx = await chromium.launchPersistentContext(dir, { ...pick.launch, args: [...(pick.launch.args ?? []), '--autoplay-policy=no-user-gesture-required'], ...VIEW });
    await ctx.addInitScript(spy);
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)));
    await startScreen(page);
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Accessibility.enable');
    await lesson(page, cdp);
    await guide(page);
} catch (e) {
    errors.push(String(e).slice(0, 300));
} finally {
    await ctx?.close().catch(() => undefined);
    rmSync(dir, { recursive: true, force: true });
}
const ORDER = ['open', 'tab', 'start', 'steps', 'once', 'askK', 'guide'];
const pass = ORDER.every((id) => steps[id]?.pass);
const verdict = { probe: 'tutor-say-accept', base, browser: pick.kind, view: '1536x730@1.25', pass, steps, errors };
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify(verdict, null, 1));
console.log(JSON.stringify({ probe: verdict.probe, base, pass, steps: Object.fromEntries(ORDER.map((id) => [id, steps[id] ? (steps[id].pass ? 'PASS' : 'FAIL') : 'NOT RUN'])), errors: errors.slice(0, 5) }));
process.exit(pass ? 0 : 1);
