// Lane tutor-say (train 4), S1 (b) and S2: what a screen reader is told between step N and step N+1 of a flying lesson
// (decision 1 "say only what is new"; plan Part A1: which parts of the page change and are announced is not known from the
// code, so it is measured here). ?render=off (no picture is judged: no GPU lock), headless Chrome through chrome.mjs
// (visual-browser.mjs pickHarnessBrowser).
//
// For each of two pilots ("voice": the default, the page speaks; "sr": "my screen reader speaks" ticked on the start screen,
// so the captions are the live region): the lesson walls-hall is started from the start screen's lesson list by the mouse,
// the pointer lock taken by a click into the scene, then key N (next step) pressed three times. Before and after each step
// change: CDP Accessibility.getFullAXTree (role + name of every node, the live-region roots), a MutationObserver log of every
// change inside an [aria-live] (not "off") or role log/status/alert node (the text a screen reader announces), the lines the
// page's speechSynthesis was handed, and document.activeElement.
//
// Verdict per step change: `announced` (the live-region texts added), `spoken` (speech), `focus` (before -> after), `axAdded`
// (AX nodes new by role+name). PASS when every announced and spoken text of a step change is the step's instruction only:
// no text naming a key list ("key N", "key B"...), no button names, no counters ("of"), the focus unchanged.
//
// Usage: node tools/bench/scripts/tutor-say-ax.mjs <base, e.g. http://localhost:7021> <out.json>
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { pickHarnessBrowser } from './visual-browser.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '');
const require = createRequire(ROOT + '/tools/bench/package.json');
const { chromium } = require('playwright');
const [base = 'http://localhost:7021', outFile = 'U:/Temp/gsfpv-train4/tutor-say/ax.json'] = process.argv.slice(2);
const LESSON = 'walls-hall';
const T0 = Date.now();
const log = (...a) => console.error(`[${((Date.now() - T0) / 1000).toFixed(0).padStart(4)}s]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// in the page, before its scripts: speech said at an estimated length, and the live-region log
function spy() {
    const w = window;
    w.__ax = { said: [], live: [] };
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
    const name = (el) => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.getAttribute('data-testid') ? '[' + el.getAttribute('data-testid') + ']' : ''}${el.getAttribute('role') ? '{' + el.getAttribute('role') + '}' : ''}`;
    const text = (n) => (n.textContent ?? '').replace(/\s+/g, ' ').trim();
    const start = () => {
        new MutationObserver((list) => {
            for (const m of list) {
                const root = liveRoot(m.target);
                if (!root) continue;
                const added = m.type === 'characterData' ? [text(m.target)] : [...m.addedNodes].map(text).filter((x) => x !== '');
                const buttons = m.type === 'childList' ? [...m.addedNodes].filter((n) => n.nodeType === 1).flatMap((n) => [...(n.matches('button') ? [n] : []), ...n.querySelectorAll('button')]).length : 0;
                if (added.length === 0 && buttons === 0) continue;
                if (w.__ax.live.length < 3000) w.__ax.live.push({ t: performance.now(), region: name(root), polite: root.getAttribute('aria-live') ?? root.getAttribute('role'), added: added.map((x) => x.slice(0, 200)), buttons });
            }
        }).observe(document.documentElement, { subtree: true, childList: true, characterData: true });
    };
    if (document.documentElement) start();
    else document.addEventListener('DOMContentLoaded', start);
}

const hook = (page) => page.evaluate(() => window.__gsfpv?.sonic?.(false) ?? null).catch(() => null);

async function axTree(cdp) {
    const { nodes } = await cdp.send('Accessibility.getFullAXTree');
    const out = [];
    for (const n of nodes) {
        if (n.ignored) continue;
        const role = n.role?.value ?? '';
        const nm = String(n.name?.value ?? '').replace(/\s+/g, ' ').trim();
        if (!nm || role === 'StaticText' || role === 'InlineTextBox') continue;
        const live = (n.properties ?? []).find((p) => p.name === 'live')?.value?.value ?? null;
        out.push(`${role}|${live ?? ''}|${nm.slice(0, 160)}`);
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

const focusOf = (page) => page.evaluate(() => {
    const a = document.activeElement;
    return a ? `${a.tagName.toLowerCase()}${a.id ? '#' + a.id : ''}${a.getAttribute('data-testid') ? '[' + a.getAttribute('data-testid') + ']' : ''}` : null;
});

const clickCentre = async (page, sel) => {
    const loc = page.locator(sel).first();
    await loc.scrollIntoViewIfNeeded().catch(() => undefined);
    const box = await loc.boundingBox();
    if (!box) return false;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.up();
    return true;
};

/** a text that is not an instruction: a list of keys, a counter, a button's name */
const KEYLIST = /\bkey [A-Z]\b.*\bkey [A-Z]\b/i;
const COUNTER = /\b\d+ (of|\/) \d+\b|\bStep \d/i;

async function pilot(browser, sr) {
    const ctx = await browser.newContext({ viewport: { width: 1536, height: 730 }, deviceScaleFactor: 1.25 });
    await ctx.addInitScript(spy);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)));
    await page.goto(`${base}/en/fly/?sonic=start&render=off&nowarn=1`, { waitUntil: 'load' });
    for (let i = 0; i < 300 && !(await page.evaluate(() => !!document.querySelector('[data-testid="sonic-start"] button'))); i++) await sleep(100);
    await sleep(800);
    if (sr) {
        if (!(await page.locator('[data-testid="sonic-sr"]').first().isVisible().catch(() => false))) await clickCentre(page, '[data-testid="sonic-settings-all"]');
        await sleep(300);
        await clickCentre(page, '[data-testid="sonic-sr"]');
        await sleep(500);
    }
    const lessonSel = `[data-testid="sonic-lesson"][data-lesson="${LESSON}"]`;
    if (!(await page.locator(lessonSel).first().isVisible().catch(() => false))) await clickCentre(page, '[data-testid="sonic-start-lessons"], [data-testid="sonic-start-all"]');
    await sleep(300);
    const clicked = await clickCentre(page, lessonSel);
    await sleep(1500);
    await page.mouse.click(768, 500).catch(() => undefined);
    // the lesson's first step said to its end
    let s = null;
    for (let i = 0; i < 300; i++) {
        s = await hook(page);
        if (s?.lesson === LESSON && s.speechQueue === 0 && s.panel) break;
        await sleep(100);
    }
    await sleep(1500);
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Accessibility.enable');
    const changes = [];
    for (let i = 0; i < 3; i++) {
        const before = await axTree(cdp);
        const f0 = await focusOf(page);
        const p0 = (await hook(page))?.panel ?? '';
        const mark = await page.evaluate(() => ({ said: window.__ax.said.length, live: window.__ax.live.length }));
        await page.keyboard.press('KeyN');
        for (let k = 0; k < 80; k++) {
            await sleep(100);
            const h = await hook(page);
            if (k > 15 && h?.speechQueue === 0) break;
        }
        await sleep(1200);
        const after = await axTree(cdp);
        const f1 = await focusOf(page);
        const h1 = await hook(page);
        const got = await page.evaluate((m) => ({ said: window.__ax.said.slice(m.said).map((x) => x.text), live: window.__ax.live.slice(m.live) }), mark);
        const announced = got.live.flatMap((x) => x.added.map((a) => `${x.region}: ${a}`));
        const liveButtons = got.live.reduce((a, x) => a + x.buttons, 0);
        const texts = [...got.live.flatMap((x) => x.added), ...got.said];
        const bad = texts.filter((x) => KEYLIST.test(x) || COUNTER.test(x));
        const pass = bad.length === 0 && liveButtons === 0 && f0 === f1;
        changes.push({ from: p0.split('\n').filter((x) => /Step/.test(x)).join(' '), to: (h1?.panel ?? '').split('\n').filter((x) => /Step/.test(x)).join(' '), pass, bad, liveButtons, focus: [f0, f1], spoken: got.said, announced: announced.slice(0, 40), axAdded: diff(before, after).slice(0, 40) });
        log(sr ? 'sr' : 'voice', i, pass ? 'PASS' : 'FAIL', JSON.stringify(bad).slice(0, 200));
    }
    await ctx.close();
    return { pilot: sr ? 'sr' : 'voice', clicked, lesson: s?.lesson ?? null, changes, errors };
}

const pick = pickHarnessBrowser({ expected: chromium.executablePath() }, false);
const browser = await chromium.launch({ ...pick.launch, args: [...(pick.launch.args ?? []), '--autoplay-policy=no-user-gesture-required'] });
const runs = [];
const errors = [];
try {
    runs.push(await pilot(browser, false));
    runs.push(await pilot(browser, true));
} catch (e) {
    errors.push(String(e).slice(0, 300));
} finally {
    await browser.close();
}
const pass = errors.length === 0 && runs.length === 2 && runs.every((r) => r.lesson === LESSON && r.changes.length === 3 && r.changes.every((c) => c.pass));
const verdict = { probe: 'tutor-say-ax', base, browser: pick.kind, lesson: LESSON, pass, runs, errors };
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify(verdict, null, 1));
console.log(JSON.stringify({ probe: verdict.probe, base, pass, steps: runs.map((r) => ({ pilot: r.pilot, lesson: r.lesson, changes: r.changes.map((c) => (c.pass ? 'PASS' : 'FAIL')) })), errors }));
process.exit(pass ? 0 : 1);
