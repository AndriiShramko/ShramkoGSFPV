// Lane tutor-air (train 4), S4: the acceptance by the MOUSE of "the first flight is the tutorial" (decisions 2, 4, 5, 9, 10 of the
// tutor brief; the low-vision pilot's point 2: "stop the game and say: this is the sound of this, it appears when that").
// ?render=off (no picture judged: no GPU lock), headless Chrome through visual-browser.mjs pickHarnessBrowser, 1536 x 730 at device
// scale 1.25, a NEW profile (an empty user-data dir). Targets by data-testid and by the keys of the keymap's actions.
//
// Steps, each PASS or FAIL in one JSON:
//   start     a mouse click on Start flying (data-testid sonic-start-quick), then a click into the scene (the pointer lock): a lesson runs
//   ears      the headphone check answered by keys (digits) passes and the flight lesson opens
//   move60    the craft moves (speed above 0.3 m/s) within 60 s of the click (Space, then key W held)
//   words60   fewer than 60 words spoken from the click to that movement (the page's speech, spied)
//   freeze    in the first moment met in flight (key W still held): the craft stands (moves under 5 cm) for 2 s while the engine's plan
//             holds exactly one cue (the moment's) at every sample
//   card      during that moment the card (data-testid sonic-moment) shows only the sound's name and one line, the line being a sentence
//             the voice says
//   onN       key N (scene.next) in the moment: the card goes and the flight goes on (no more than 3 presses)
//   tour      key G (sonic.whatSound) in the flight: "Sound n of m: name" for n = 1..m in order, the card naming each, the craft standing,
//             then the flight goes on
//   guideOff  a free flight over a scan with the sound on (key Backslash) and the narrator off (Shift+V): no moment card and no line
//             for 20 s of flight; the same profile's walls-hall lesson then runs no moment while the craft flies to the wall
// DRAW=<shot prefix>: render on, stops at the first moment in flight and takes the card at 1536x730 and at 844x390 (one drawn run).
//
// Usage: node tools/bench/scripts/tutor-air-accept.mjs <base, e.g. http://localhost:7061> <out.json>
// Against the live site it only reads: the profile is a throwaway folder; nothing is saved, sent or created on the site.
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { pickHarnessBrowser } from './visual-browser.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '');
const require = createRequire(ROOT + '/tools/bench/package.json');
const { chromium } = require('playwright');
const [base = 'http://localhost:7061', outFile = 'U:/Temp/gsfpv-train4/tutor-air/accept.json'] = process.argv.slice(2);
const DRAW = process.env.DRAW ?? '';
const TEMP = 'U:/Temp/gsfpv-train4/tutor-air';
const VIEW = { viewport: { width: 1536, height: 730 }, deviceScaleFactor: 1.25 };
const Q = DRAW ? '&nowarn=1' : '&render=off&nowarn=1';
const T0 = Date.now();
const log = (...a) => console.error(`[${((Date.now() - T0) / 1000).toFixed(0).padStart(4)}s]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TOUR = /^Sound (\d+) of (\d+): (.+)$/;

// in the page, before its scripts: speech said at an estimated length (so the queue behaves) and logged
function spy() {
    const w = window;
    w.__ax = { said: [], idle: () => true };
    const synth = w.speechSynthesis;
    if (!synth) return;
    let queue = [];
    let current = null;
    let timer = 0;
    const next = () => {
        if (current !== null || queue.length === 0) return;
        const u = (current = queue.shift());
        const text = String(u.text ?? '');
        const sec = text.trim() === '' ? 0 : 0.4 + (text.length * 0.065) / Math.max(u.rate || 1, 0.25);
        w.__ax.said.push({ t: Date.now(), text });
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

/** the lesson hook and the moment card, one read */
const look = (page) =>
    page
        .evaluate(() => {
            const h = window.__gsfpv?.sonic?.(false) ?? null;
            const el = document.querySelector('[data-testid="sonic-moment"]');
            const shown = !!el && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden' && el.getBoundingClientRect().height > 0;
            const txt = (s) => (el?.querySelector(`[data-testid="${s}"]`)?.textContent ?? '').replace(/\s+/g, ' ').trim();
            const kids = el ? [...el.querySelectorAll('*')].filter((n) => (n.textContent ?? '').trim() !== '' && n.children.length === 0).map((n) => n.getAttribute('data-testid') ?? n.tagName) : [];
            return {
                lesson: h?.lesson ?? null,
                phase: h?.phase ?? null,
                asking: h?.asking ?? false,
                question: h?.question ?? null,
                speechQueue: h?.speechQueue ?? 0,
                pos: h?.pos ?? null,
                speed: h?.speed ?? 0,
                armed: h?.armed ?? false,
                cues: h?.cues ?? [],
                card: shown ? { name: txt('sonic-moment-sound'), line: txt('sonic-moment-line'), kids } : null,
                lock: !!document.pointerLockElement
            };
        })
        .catch(() => null);
const momentEvents = (page) => page.evaluate(() => (window.__gsfpv?.sonic?.(true)?.events ?? []).filter((e) => e.kind === 'moment' || e.kind === 'lesson').map((e) => ({ kind: e.kind, id: e.id ?? e.lessonId, what: e.what }))).catch(() => []);
const saidSince = (page, t) => page.evaluate((k) => window.__ax.said.filter((x) => x.t >= k && x.text.trim() !== '').map((x) => ({ t: x.t, text: x.text })), t).catch(() => []);
/** the speech queue empty, at least `min` ms after the call */
async function quiet(page, min = 1000, max = 30000) {
    await sleep(min);
    for (let t = min; t < max; t += 150) {
        if (await page.evaluate(() => window.__ax.idle()).catch(() => true)) return;
        await sleep(150);
    }
}
const dist = (a, b) => (a && b ? Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) : Infinity);
const words = (s) => s.split(/\s+/).filter((x) => /[\p{L}\p{N}]/u.test(x)).length;

async function clickCentre(page, sel) {
    const loc = page.locator(sel).first();
    if (!(await loc.isVisible().catch(() => false))) return false;
    const box = await loc.boundingBox();
    if (!box) return false;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.up();
    return true;
}
const clickScene = (page) => page.mouse.click(VIEW.viewport.width / 2, Math.round(VIEW.viewport.height * 0.6)).catch(() => undefined);

const steps = {};
const step = (id, pass, facts) => {
    steps[id] = { pass: !!pass, ...facts };
    log(id, pass ? 'PASS' : 'FAIL', JSON.stringify(facts).slice(0, 400));
};
const held = new Set();
async function hold(page, key, want) {
    if (held.has(key) === want) return;
    if (want) {
        held.add(key);
        await page.keyboard.down(key);
    } else {
        held.delete(key);
        await page.keyboard.up(key);
    }
}

/** Space (arm) once, then key W held while the flight is free; returns when the craft moved or the time ran out */
async function takeOff(page, s) {
    if (!s.armed) {
        await page.keyboard.press('Space');
        await sleep(300);
    }
    await hold(page, 'KeyW', true);
}

/** a moment met: samples it for 2 s with W still held, the card read, then N until it goes */
async function moment(page, first, inFlight) {
    const t0 = Date.now();
    const pos0 = first.pos;
    let moved = 0;
    const cueSets = [];
    const cards = [];
    while (Date.now() - t0 < 2000) {
        const s = await look(page);
        if (!s) break;
        moved = Math.max(moved, dist(pos0, s.pos));
        cueSets.push(s.cues);
        if (s.card) cards.push(s.card);
        await sleep(100);
    }
    await hold(page, 'KeyW', false);
    if (DRAW) {
        // the card with its line, at 1536x730, then at 844x390
        for (let i = 0; i < 40 && !(await look(page))?.card?.line; i++) await sleep(100);
        await page.screenshot({ path: `${DRAW}-1536.png` }).catch(() => undefined);
        await page.setViewportSize({ width: 844, height: 390 });
        await sleep(600);
        await page.screenshot({ path: `${DRAW}-844.png` }).catch(() => undefined);
        await page.setViewportSize(VIEW.viewport);
    }
    // the moment's sentences: let the voice speak them (up to 20 s), the card read meanwhile
    for (let i = 0; i < 200; i++) {
        const s = await look(page);
        if (!s?.card) break;
        cards.push(s.card);
        if (s.speechQueue === 0 && (await page.evaluate(() => window.__ax.idle()).catch(() => true)) && Date.now() - t0 > 6000) break;
        await sleep(100);
    }
    // the package says a moment's first sentence just before it freezes the flight (moments.ts freeze: say, then the moment)
    const said = (await saidSince(page, t0 - 1500)).map((x) => x.text.trim());
    const tail = await page.evaluate(() => (window.__gsfpv?.sonic?.(true)?.events ?? []).slice(-30).map((e) => [e.t, e.kind, e.key ?? e.what ?? '', e.id ?? e.action ?? ''].join(' '))).catch(() => []);
    let presses = 0;
    let gone = false;
    for (; presses < 3 && !gone; ) {
        await page.keyboard.press('KeyN');
        presses++;
        for (let i = 0; i < 40; i++) {
            await sleep(100);
            if (!(await look(page))?.card) {
                gone = true;
                break;
            }
        }
    }
    // a cue's voices carry their sector ('safety.wall:front'): the cue is the id before the colon
    const all = new Set(cueSets.flat().map((c) => c.split(':')[0]));
    const lines = [...new Set(cards.map((c) => c.line).filter((x) => x !== ''))];
    const names = [...new Set(cards.map((c) => c.name).filter((x) => x !== ''))];
    const kids = [...new Set(cards.flatMap((c) => c.kids))];
    return { tail, inFlight, moved: Number(moved.toFixed(3)), cueIds: [...all], samples: cueSets.length, exact: all.size === 1 && cueSets.every((c) => c.length >= 1 && c.every((x) => x.split(':')[0] === [...all][0])), names, lines, kids, spokenLines: lines.filter((l) => said.some((x) => x === l || x.includes(l))), said: said.slice(0, 8), presses, gone };
}

async function firstFlight(page) {
    await page.goto(`${base}/en/fly/?sonic=start${Q}`, { waitUntil: 'load' });
    for (let i = 0; i < 300 && !(await page.locator('[data-testid="sonic-start-quick"]').isVisible().catch(() => false)); i++) await sleep(100);
    await sleep(800);
    const tClick = Date.now();
    const clicked = await clickCentre(page, '[data-testid="sonic-start-quick"]');
    await sleep(1500);
    await clickScene(page);
    let s = null;
    for (let i = 0; i < 150; i++) {
        s = await look(page);
        if (s?.lesson) break;
        await sleep(100);
    }
    step('start', clicked && !!s?.lesson, { clicked, lesson: s?.lesson ?? null, pointerLock: s?.lock ?? false });
    if (!s?.lesson) return;
    // the headphone check by keys (the runner plays left, right, ...: question 1 is left, the others right)
    const ears = s.lesson;
    let answered = '';
    let skipped = false;
    let moveAt = null;
    let first = null;
    const firstSeen = [];
    const tEnd = tClick + 150000;
    while (Date.now() < tEnd) {
        s = await look(page);
        if (!s) break;
        if (s.lesson === ears) {
            if (!skipped && s.phase === 'intro') {
                skipped = true;
                await page.keyboard.press('KeyN');
            } else if (s.asking && s.speechQueue === 0 && s.question && answered !== s.question.id) {
                answered = s.question.id;
                await page.keyboard.press(`Digit${Number(s.question.id.split(':')[2]) % 2 === 1 ? 1 : 2}`);
            }
        } else if (s.lesson) {
            if (!steps.ears) step('ears', true, { check: ears, next: s.lesson, atS: (Date.now() - tClick) / 1000 });
            if (s.card) {
                // a moment: the one met in flight is measured; one at the start (on the ground) is let run and gone on with N
                const inFlight = moveAt !== null;
                const m = await moment(page, s, inFlight);
                firstSeen.push({ lesson: s.lesson, ...m });
                if (inFlight || DRAW) {
                    first = m;
                    break;
                }
                continue;
            }
            if (s.phase === 'flying') await takeOff(page, s);
            if (moveAt === null && s.speed > 0.3) moveAt = Date.now();
        }
        await sleep(100);
    }
    if (!steps.ears) step('ears', false, { last: s });
    const said = await saidSince(page, tClick);
    const before = moveAt === null ? said : said.filter((x) => x.t <= moveAt);
    const n = before.reduce((a, x) => a + words(x.text), 0);
    step('move60', moveAt !== null && moveAt - tClick <= 60000, { moveS: moveAt === null ? null : (moveAt - tClick) / 1000 });
    step('words60', moveAt !== null && n < 60, { words: n, before: before.map((x) => x.text) });
    if (DRAW) return firstSeen;
    step('freeze', !!first && first.moved < 0.05 && first.exact, { moment: first, earlier: firstSeen.filter((x) => x !== first).map((x) => ({ names: x.names, cueIds: x.cueIds, gone: x.gone })) });
    step('card', !!first && first.names.length === 1 && first.lines.length >= 1 && first.spokenLines.length >= 1 && first.kids.every((k) => k === 'sonic-moment-sound' || k === 'sonic-moment-line'), { names: first?.names, lines: first?.lines, kids: first?.kids, spokenLines: first?.spokenLines });
    step('onN', !!first && first.gone && first.presses <= 3, { presses: first?.presses, gone: first?.gone });
    await tour(page);
    await hold(page, 'KeyW', false);
}

async function tour(page) {
    // back in the flight: wait until no card and the voice idle, then key G
    for (let i = 0; i < 150; i++) {
        const s = await look(page);
        if (s && !s.card && s.speechQueue === 0) break;
        await sleep(100);
    }
    const t0 = Date.now();
    const s0 = await look(page);
    await page.keyboard.press('KeyG');
    let moved = 0;
    const names = [];
    let started = false;
    let back = false;
    for (let i = 0; i < 600; i++) {
        await sleep(100);
        const s = await look(page);
        if (!s) break;
        if (s.card) {
            started = true;
            moved = Math.max(moved, dist(s0?.pos, s.pos));
            if (s.card.name && names.at(-1) !== s.card.name) names.push(s.card.name);
        } else if (started && s.speechQueue === 0 && (await page.evaluate(() => window.__ax.idle()).catch(() => true))) {
            back = true;
            break;
        }
    }
    const said = (await saidSince(page, t0)).map((x) => x.text.trim());
    const tours = said.map((x) => TOUR.exec(x)).filter((x) => x !== null);
    const m = tours.length > 0 ? Number(tours[0][2]) : 0;
    const ordered = m > 0 && tours.length === m && tours.every((x, i) => Number(x[1]) === i + 1 && Number(x[2]) === m);
    const named = tours.every((x) => names.includes(x[3].replace(/\.$/, '').trim()));
    step('tour', ordered && named && moved < 0.05 && back, { said: said.slice(0, 12), cardNames: names, moved: Number(moved.toFixed(3)), back });
}

async function guideOff(page) {
    await page.goto(`${base}/en/fly/?scene=39e63ce9${Q}`, { waitUntil: 'load' });
    for (let i = 0; i < 1200 && (await page.evaluate(() => window.__gsfpv?.status ?? null).catch(() => null)) !== 'ready'; i++) await sleep(100);
    // the Controls screen: the keyboard
    await page.waitForSelector('.screen.radio [data-action="radio-keyboard"]', { timeout: 20000 }).catch(() => undefined);
    await clickCentre(page, '.screen.radio [data-action="radio-keyboard"]');
    await sleep(1500);
    await clickScene(page);
    await sleep(500);
    await page.keyboard.press('Backslash');
    let on = null;
    for (let i = 0; i < 100 && !on?.lesson; i++) {
        await sleep(100);
        on = await look(page);
    }
    // the sound-on lines said to their end, then the narrator off (Shift+V) and its own answer said
    await quiet(page);
    await page.keyboard.press('Shift+KeyV');
    await quiet(page);
    const t0 = Date.now();
    let cards = 0;
    await page.keyboard.press('Space');
    await hold(page, 'KeyW', true);
    let maxSpeed = 0;
    while (Date.now() - t0 < 20000) {
        const s = await look(page);
        if (s?.card) cards++;
        maxSpeed = Math.max(maxSpeed, s?.speed ?? 0);
        await sleep(200);
    }
    await hold(page, 'KeyW', false);
    const said = (await saidSince(page, t0)).map((x) => x.text);
    const free = { soundOn: on?.lesson ?? null, cards, said, maxSpeed: Number(maxSpeed.toFixed(2)) };
    // the same profile (narrator off saved): walls-hall flown to its front wall
    await page.goto(`${base}/en/fly/?sonic=walls-hall${Q}`, { waitUntil: 'load' });
    await page.waitForSelector('[data-testid="sonic-start-asked"]', { timeout: 60000 }).catch(() => undefined);
    await clickCentre(page, '[data-testid="sonic-start-asked"]');
    await sleep(1500);
    await clickScene(page);
    let s = null;
    const t1 = Date.now();
    let lessonCards = 0;
    let flown = 0;
    while (Date.now() - t1 < 60000) {
        s = await look(page);
        if (s?.card) lessonCards++;
        if (s?.lesson && s.phase === 'flying') {
            if (!held.has('KeyW')) await clickScene(page);
            await takeOff(page, s);
        }
        flown = Math.max(flown, s?.speed ?? 0);
        await sleep(150);
    }
    await hold(page, 'KeyW', false);
    const ev = (await momentEvents(page)).filter((e) => e.kind === 'moment');
    const lesson = { lesson: s?.lesson ?? null, cards: lessonCards, momentEvents: ev.length, maxSpeed: Number(flown.toFixed(2)) };
    step('guideOff', free.soundOn !== null && free.cards === 0 && free.said.length === 0 && free.maxSpeed > 0.3 && lesson.lesson === 'walls-hall' && lesson.cards === 0 && lesson.momentEvents === 0 && lesson.maxSpeed > 0.3, { free, lesson });
}

const pick = pickHarnessBrowser({ expected: chromium.executablePath() }, !!DRAW);
mkdirSync(TEMP, { recursive: true });
const errors = [];
let ctx = null;
const dirs = [];
async function launch() {
    const dir = mkdtempSync(`${TEMP}/profile-`);
    dirs.push(dir);
    ctx = await chromium.launchPersistentContext(dir, { ...pick.launch, args: [...(pick.launch.args ?? []), '--autoplay-policy=no-user-gesture-required'], ...VIEW });
    await ctx.addInitScript(spy);
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)));
    return page;
}
try {
    let page = await launch();
    await firstFlight(page);
    if (!DRAW) {
        await ctx.close();
        page = await launch();
        await guideOff(page);
    }
} catch (e) {
    errors.push(String(e).slice(0, 300));
} finally {
    await ctx?.close().catch(() => undefined);
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
}
const ORDER = DRAW ? ['start', 'ears', 'move60', 'words60'] : ['start', 'ears', 'move60', 'words60', 'freeze', 'card', 'onN', 'tour', 'guideOff'];
const pass = ORDER.every((id) => steps[id]?.pass);
const verdict = { probe: 'tutor-air-accept', base, browser: pick.kind, view: '1536x730@1.25', draw: !!DRAW, pass, steps, errors };
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify(verdict, null, 1));
console.log(JSON.stringify({ probe: verdict.probe, base, pass, steps: Object.fromEntries(ORDER.map((id) => [id, steps[id] ? (steps[id].pass ? 'PASS' : 'FAIL') : 'NOT RUN'])), errors: errors.slice(0, 5) }));
process.exit(pass ? 0 : 1);
