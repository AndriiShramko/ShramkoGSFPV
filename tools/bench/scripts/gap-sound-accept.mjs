// Lane gap-sound (train 4), stage S3: the acceptance of the owner's line 531 on a served release, the pilot's own path with the
// MOUSE at 1536 x 730, device scale 1.25, ?render=off (no picture is judged: no GPU lock). Headless Chrome has no voice, so the
// page's speechSynthesis is replaced before its scripts by a queue that says each line for as long as the measured Windows voice
// of en (David, packages/sonic-fpv/test/fixtures/tts-en-david.json) says it, at the page's speech rate; a line without a
// measurement takes the package's own estimate (estimateSpeechS). No audio is judged.
//
// Steps, each PASS or FAIL in one JSON:
//   firstQuickFocused      a first visit: the Start group's first button is Quick start and it has the focus
//   firstNoBehind          a first visit: the headphone check offers left and right only (no button says 'behind')
//   settingsShort          the sound settings show a short list and a 'Show all settings' button; its click (mouse) shows more
//   moveWithin120          a mouse click on Quick start, the headphone check answered (digits, as the lesson asks), and the
//                          small room's flight (walls-hall, runner phase 'flying': the pilot is asked to move) starts within
//                          120 s of the click; the lessons before it are the headphone check and the room only
//   wallsInRoom            the room says the four wall sounds (wall, right, ceiling, floor) before its flight
//   noBehindOnTheWay       no line on the way names or asks front or behind (keys dir.front, dir.back, headphones.q-front-back)
//   returningQuickFocused  the same browser opened again (a returning pilot, the progress the walk saved): Quick start first and
//                          focused, Continue second and saying what it resumes
//   returningNoBehind      the returning pilot's headphone check: left and right only
//   returningContinueResumes  (the independent check's step) key Tab from the focused Quick start reaches Continue, and a mouse
//                          click on Continue opens the lesson it named (the small room), not the headphone check again
//
// Usage: node tools/bench/scripts/gap-sound-accept.mjs <base, e.g. http://localhost:6781> <out.json>
// The base serves a release (node tools/bench/scripts/serve-csp.mjs dist <port>) or is the live site (read-only: the progress
// stays in this browser's own storage; nothing is saved, sent or created on the site): the lane's negative control.
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { pickHarnessBrowser } from './visual-browser.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '');
const require = createRequire(ROOT + '/tools/bench/package.json');
const { chromium } = require('playwright');
const [base = 'http://localhost:6781', outFile = 'U:/Temp/gsfpv-train4/gap-sound/accept.json'] = process.argv.slice(2);
const PKG_EN = JSON.parse(readFileSync(`${ROOT}/packages/sonic-fpv/locales/en.json`, 'utf8'));
const DAVID = JSON.parse(readFileSync(`${ROOT}/packages/sonic-fpv/test/fixtures/tts-en-david.json`, 'utf8')).seconds;
/** the spoken text of every measured line without parameters -> its seconds */
const MEASURED = {};
for (const [k, s] of Object.entries(DAVID)) if (typeof PKG_EN[k] === 'string' && !PKG_EN[k].includes('{')) MEASURED[PKG_EN[k]] = s;
const MOVE_MAX_S = 120;
const FRONT_BACK_KEYS = /^(dir\.front|dir\.back|headphones\.q-front-back)/;
const WALL_KEYS = ['cue.safety.wall.name', 'dir.right', 'cue.safety.ceiling.name', 'cue.safety.floor.name'];
const T0 = Date.now();
const log = (...a) => console.error(`[${((Date.now() - T0) / 1000).toFixed(0).padStart(4)}s]`, ...a);

// in the page, before its own scripts: a speech queue with measured lengths, the time of the Quick start click, and a 50 ms
// watch of the mode's hook (the lesson and the runner's phase)
function spy(measured) {
    const w = window;
    // quickAt: set by the probe just before its mouse press on Quick start (a little early, so the seconds are not flattered)
    w.__ga = { said: [], quickAt: null, flyAt: null, trail: [], errors: [] };
    const synth = w.speechSynthesis;
    if (synth) {
        let queue = [];
        let current = null;
        let timer = 0;
        const next = () => {
            if (current !== null || queue.length === 0) return;
            const u = (current = queue.shift());
            const text = String(u.text ?? '');
            const rate = Math.max(u.rate || 1, 0.25);
            const sec = text.trim() === '' ? 0 : measured[text] !== undefined ? measured[text] / rate : 0.4 + (text.length * 0.065) / rate;
            w.__ga.said.push({ t: performance.now(), text, s: Math.round(sec * 1000) / 1000, measured: measured[text] !== undefined });
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
    let last = '';
    setInterval(() => {
        const h = w.__gsfpv && w.__gsfpv.sonic;
        if (!h) return;
        try {
            const s = h(false);
            const now = `${s.lesson}/${s.phase}`;
            if (now !== last) {
                last = now;
                if (w.__ga.trail.length < 60) w.__ga.trail.push({ t: performance.now(), lesson: s.lesson, phase: s.phase });
            }
            if (w.__ga.flyAt === null && s.lesson === 'walls-hall' && s.phase === 'flying') w.__ga.flyAt = performance.now();
        } catch (e) {
            if (w.__ga.errors.length < 5) w.__ga.errors.push(String(e).slice(0, 200));
        }
    }, 50);
}

const pick = pickHarnessBrowser({ expected: chromium.executablePath() }, false);
const browser = await chromium.launch({ ...pick.launch, args: [...(pick.launch.args ?? []), '--autoplay-policy=no-user-gesture-required'] });
const steps = {};
const facts = {};
const errors = [];
const step = (name, pass, fact) => {
    steps[name] = pass ? 'PASS' : 'FAIL';
    if (fact !== undefined) facts[name] = fact;
    log(steps[name], name, JSON.stringify(fact ?? null).slice(0, 300));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hook = (page) => page.evaluate(() => window.__gsfpv?.sonic?.(true) ?? null);

/** The start screen as the pilot finds it: the Start group's buttons, the focus, the headphone buttons, the settings. */
const look = (page) =>
    page.evaluate(() => {
        const vis = (el) => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
        };
        const root = document.querySelector('[data-testid="sonic-start"]');
        const group = root?.querySelector('[data-testid="sonic-start-quick"]')?.parentElement ?? root?.querySelector('.sonic-actions') ?? null;
        const startOrder = group ? [...group.querySelectorAll('button')].filter(vis).map((b) => b.getAttribute('data-testid') ?? '') : [];
        const cont = root?.querySelector('[data-testid="sonic-start-continue"]');
        const hp = root ? [...root.querySelectorAll('button[data-testid^="sonic-hp-"]')].map((b) => b.getAttribute('data-testid')) : [];
        const behind = root ? [...root.querySelectorAll('button')].map((b) => (b.textContent ?? '').replace(/\s+/g, ' ').trim()).filter((x) => /behind/i.test(x)) : [];
        const sec = document.querySelector('#sonic-sec-settings');
        const controls = sec ? [...sec.querySelectorAll('input[data-testid], select[data-testid]')].filter((x) => !/^sonic-(gain|pitch)-/.test(x.getAttribute('data-testid') ?? '')).map((x) => x.getAttribute('data-testid')) : [];
        const all = sec?.querySelector('[data-testid="sonic-settings-all"]');
        return {
            startOrder,
            focused: document.activeElement?.getAttribute('data-testid') ?? document.activeElement?.id ?? document.activeElement?.tagName ?? null,
            continueText: cont ? (cont.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 120) : null,
            hp,
            behind,
            controls,
            showAll: all ? (all.textContent ?? '').replace(/\s+/g, ' ').trim() : null
        };
    });

async function openStart(page) {
    await page.goto(`${base}/en/fly/?sonic=start&render=off&nowarn=1`, { waitUntil: 'load' });
    for (let i = 0; i < 300 && !(await page.evaluate(() => !!document.querySelector('[data-testid="sonic-start"] .sonic-actions button'))); i++) await sleep(100);
    await sleep(800);
}

const clickCentre = async (page, sel) => {
    await page.locator(sel).first().scrollIntoViewIfNeeded().catch(() => undefined);
    const box = await page.locator(sel).first().boundingBox();
    if (!box) return false;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.up();
    return true;
};

try {
    const ctx = await browser.newContext({ viewport: { width: 1536, height: 730 }, deviceScaleFactor: 1.25 });
    await ctx.addInitScript(spy, MEASURED);
    ctx.on('response', (r) => r.status() >= 400 && errors.push(`${r.status()} ${r.url()}`.slice(0, 200)));
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)));

    // 1. a first visit
    await openStart(page);
    const first = await look(page);
    step('firstQuickFocused', first.startOrder[0] === 'sonic-start-quick' && first.focused === 'sonic-start-quick', { order: first.startOrder, focused: first.focused });
    step('firstNoBehind', JSON.stringify(first.hp) === '["sonic-hp-left","sonic-hp-right"]' && first.behind.length === 0, { headphoneButtons: first.hp, behindButtons: first.behind });
    let more = null;
    if (first.showAll !== null && (await clickCentre(page, '[data-testid="sonic-settings-all"]'))) {
        await sleep(400);
        more = (await look(page)).controls;
    }
    step('settingsShort', first.showAll !== null && more !== null && first.controls.length <= 7 && more.length > first.controls.length, { shownFirst: first.controls, showAll: first.showAll, shownAfter: more?.length ?? null });

    // 2. Quick start by the mouse (a page without it: Start's first button, so the walk still runs), the pointer lock, the
    //    headphone check answered by digits (trial n odd: left = 1, even: right = 2), until the room's flight
    const target = first.startOrder.includes('sonic-start-quick') ? '[data-testid="sonic-start-quick"]' : '[data-testid="sonic-start"] .sonic-actions button';
    await page.locator(target).first().scrollIntoViewIfNeeded();
    await page.evaluate(() => { window.__ga.quickAt = performance.now(); });
    await clickCentre(page, target);
    await sleep(1500);
    await page.mouse.click(768, 500).catch(() => undefined);
    let answered = '';
    const answers = [];
    const tWalk = Date.now();
    let s = null;
    while (Date.now() - tWalk < (MOVE_MAX_S + 30) * 1000) {
        s = await hook(page);
        const ga = await page.evaluate(() => ({ flyAt: window.__ga.flyAt }));
        if (ga.flyAt !== null) break;
        if (s?.asking && s.question && s.speechQueue === 0 && answered !== s.question.id) {
            answered = s.question.id;
            const n = Number(s.question.id.split(':')[2]);
            const key = `Digit${s.question.id.endsWith(':side') && n % 2 === 0 ? 2 : 1}`;
            answers.push(`${s.question.id}=${key}`);
            await page.keyboard.press(key);
        }
        await sleep(80);
    }
    s = await hook(page);
    const ga = await page.evaluate(() => window.__ga);
    const events = s?.events ?? [];
    const opened = events.filter((e) => e.kind === 'lesson' && e.what === 'open').map((e) => e.lessonId);
    const spokenKeys = events.filter((e) => e.kind === 'speech').map((e) => e.key);
    const seconds = ga.flyAt !== null && ga.quickAt !== null ? Math.round((ga.flyAt - ga.quickAt) / 100) / 10 : null;
    const said = ga.said.filter((x) => x.text.trim() !== '');
    step('moveWithin120', seconds !== null && seconds <= MOVE_MAX_S && JSON.stringify([...new Set(opened)]) === '["ears-headphones","walls-hall"]', {
        seconds,
        clicked: target,
        lessonsOpened: opened,
        answers,
        lines: said.length,
        linesMeasured: said.filter((x) => x.measured).length,
        speechSeconds: Math.round(said.reduce((a, x) => a + x.s, 0) * 10) / 10,
        trail: ga.trail.map((x) => ({ t: ga.quickAt === null ? null : Math.round((x.t - ga.quickAt) / 100) / 10, lesson: x.lesson, phase: x.phase }))
    });
    const roomOpen = events.findIndex((e) => e.kind === 'lesson' && e.what === 'open' && e.lessonId === 'walls-hall');
    const roomKeys = roomOpen < 0 ? [] : events.slice(roomOpen).filter((e) => e.kind === 'speech').map((e) => e.key);
    const at = WALL_KEYS.map((k) => roomKeys.indexOf(k));
    const listed = at.every((i) => i >= 0) && at.every((i, j) => j === 0 || i > (at[j - 1] ?? -1));
    // int4 car 5: a page that teaches by moments (tutor-moment, the package's walls-hall v5; the lead's decision 3 of 2026-11-20:
    // ceiling and floor are not in the first set's moments) lists no wall sounds before the room's flight: the room stops and
    // introduces its sounds in the air. Then the room is right when its flight brings a moment (tutor-air-accept walks one through)
    let roomMoments = [];
    if (!listed && ga.flyAt !== null) {
        for (let i = 0; i < 150 && roomMoments.length === 0; i++) {
            const ev = (await hook(page).catch(() => null))?.events ?? [];
            const ro = ev.findIndex((e) => e.kind === 'lesson' && e.what === 'open' && e.lessonId === 'walls-hall');
            roomMoments = ro < 0 ? [] : ev.slice(ro).filter((e) => e.kind === 'moment' && e.id).map((e) => e.id);
            if (roomMoments.length === 0) await sleep(100);
        }
    }
    step('wallsInRoom', ga.flyAt !== null && (listed || roomMoments.length > 0), { by: listed ? 'list' : 'moments', roomKeys: roomKeys.slice(0, 12), roomMoments });
    const fb = spokenKeys.filter((k) => FRONT_BACK_KEYS.test(k ?? ''));
    step('noBehindOnTheWay', spokenKeys.length > 0 && fb.length === 0, { frontBackKeys: fb, keysSaid: spokenKeys.length });
    facts.said = said.slice(0, 40).map((x) => ({ t: ga.quickAt === null ? null : Math.round((x.t - ga.quickAt) / 100) / 10, s: x.s, text: x.text.slice(0, 70) }));
    facts.hookErrors = ga.errors;

    // 3. a returning pilot: the same browser, the start screen again (the progress the walk saved)
    await page.close();
    const back = await ctx.newPage();
    await openStart(back);
    const ret = await look(back);
    // int4 car 5: tutor-say's Start group is Start flying, All lessons, then Continue (gap-sound had Continue second)
    step('returningQuickFocused', ret.startOrder[0] === 'sonic-start-quick' && ret.focused === 'sonic-start-quick' && ret.startOrder.includes('sonic-start-continue') && /^Continue: \S/.test(ret.continueText ?? ''), { order: ret.startOrder, focused: ret.focused, continueText: ret.continueText });
    step('returningNoBehind', JSON.stringify(ret.hp) === '["sonic-hp-left","sonic-hp-right"]' && ret.behind.length === 0, { headphoneButtons: ret.hp, behindButtons: ret.behind });

    // 4. the independent check's step: the returning pilot who wants to go on, not start again, presses key Tab once from the
    //    focused Quick start (the keyboard reaches Continue next) and clicks Continue with the mouse: the lesson it named opens,
    //    not the headphone check again
    //    int4 car 5: Continue is the third stop of Start now (after All lessons): key Tab at most twice
    let tabbed = null;
    for (let i = 0; i < 2 && tabbed !== 'sonic-start-continue'; i++) {
        await back.keyboard.press('Tab');
        tabbed = await back.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? null);
    }
    const roomTitle = PKG_EN['lesson.walls-hall.title'];
    await clickCentre(back, '[data-testid="sonic-start-continue"]');
    let resumed = null;
    for (let i = 0; i < 150 && resumed === null; i++) {
        const hs = await hook(back).catch(() => null);
        if (hs?.lesson) resumed = hs.lesson;
        else await sleep(100);
    }
    step('returningContinueResumes', tabbed === 'sonic-start-continue' && resumed === 'walls-hall' && (ret.continueText ?? '').includes(roomTitle), { tabbed, resumed, continueText: ret.continueText, roomTitle });
} catch (e) {
    errors.push(String(e).slice(0, 300));
} finally {
    await browser.close();
}

const NAMES = ['firstQuickFocused', 'firstNoBehind', 'settingsShort', 'moveWithin120', 'wallsInRoom', 'noBehindOnTheWay', 'returningQuickFocused', 'returningNoBehind', 'returningContinueResumes'];
for (const n of NAMES) if (!(n in steps)) steps[n] = 'FAIL';
const verdict = { probe: 'gap-sound-accept', base, browser: pick.kind, viewport: '1536x730@1.25', speech: 'measured en (David) lengths, else the package estimate', steps, pass: NAMES.every((n) => steps[n] === 'PASS'), facts, errors };
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify(verdict, null, 1));
console.log(JSON.stringify({ probe: verdict.probe, base, pass: verdict.pass, steps, errors: errors.slice(0, 5) }));
process.exit(verdict.pass ? 0 : 1);
