// The independent check of lane tutor-air (train 4): ONE step the lane's own probe (tutor-air-accept.mjs) does not run.
//   know      on a NEW profile: Start flying (mouse), the headphone check by keys, fly at the wall; in the first moment met in the
//             air, Shift+K (action sonic.know): the card goes within 4 s, the session has the moment event 'known', the saved
//             collection keeps the sound in sonic.known, and the flight goes on (speed above 0.3 m/s within 15 s, key W held)
//   kept      the same profile, the page loaded again on walls-hall: the saved sound is still known, and flown at the wall for 45 s
//             its moment never comes again (no card with that sound's name)
// Usage: node tools/bench/scripts/tutor-air-review.mjs <base url> <out.json>. Prints one JSON verdict, exits 1 on a failure.
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { pickHarnessBrowser } from './visual-browser.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '');
const require = createRequire(ROOT + '/tools/bench/package.json');
const { chromium } = require('playwright');
const [base = 'http://localhost:7062', outFile = 'U:/Temp/gsfpv-train4/tutor-air/review.json'] = process.argv.slice(2);
const TEMP = 'U:/Temp/gsfpv-train4/tutor-air';
const VIEW = { viewport: { width: 1536, height: 730 }, deviceScaleFactor: 1.25 };
const Q = '&render=off&nowarn=1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const steps = {};
const step = (id, pass, facts) => {
    steps[id] = { pass: !!pass, ...facts };
    console.error(id, pass ? 'PASS' : 'FAIL', JSON.stringify(facts).slice(0, 400));
};

const look = (page) =>
    page
        .evaluate(() => {
            const h = window.__gsfpv?.sonic?.(false) ?? null;
            const el = document.querySelector('[data-testid="sonic-moment"]');
            const shown = !!el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().height > 0;
            const name = (el?.querySelector('[data-testid="sonic-moment-sound"]')?.textContent ?? '').trim();
            return { lesson: h?.lesson ?? null, phase: h?.phase ?? null, asking: h?.asking ?? false, question: h?.question ?? null, speechQueue: h?.speechQueue ?? 0, speed: h?.speed ?? 0, armed: h?.armed ?? false, card: shown ? name : null };
        })
        .catch(() => null);
/** the cue ids the saved prefs document keeps as known (whatever localStorage key holds it) */
const savedKnown = (page) =>
    page
        .evaluate(() => {
            for (let i = 0; i < localStorage.length; i++) {
                const v = localStorage.getItem(localStorage.key(i) ?? '') ?? '';
                const m = /"known":(\[[^\]]*\])/.exec(v);
                if (m) return JSON.parse(m[1]);
            }
            return [];
        })
        .catch(() => []);
const knownEvents = (page) => page.evaluate(() => (window.__gsfpv?.sonic?.(true)?.events ?? []).filter((e) => e.kind === 'moment' && e.what === 'known').map((e) => e.id)).catch(() => []);
async function clickCentre(page, sel) {
    const loc = page.locator(sel).first();
    if (!(await loc.isVisible().catch(() => false))) return false;
    const box = await loc.boundingBox();
    if (!box) return false;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    return true;
}
const clickScene = (page) => page.mouse.click(VIEW.viewport.width / 2, Math.round(VIEW.viewport.height * 0.6)).catch(() => undefined);
let wHeld = false;
async function fly(page, s) {
    if (!s.armed) {
        await page.keyboard.press('Space');
        await sleep(300);
    }
    if (!wHeld) {
        wHeld = true;
        await page.keyboard.down('KeyW');
    }
}
async function letGo(page) {
    if (wHeld) await page.keyboard.up('KeyW');
    wHeld = false;
}
/** a card on the ground (a start moment): N until it goes */
async function passWithN(page) {
    for (let i = 0; i < 60; i++) {
        const s = await look(page);
        if (!s?.card) return;
        if (s.speechQueue === 0) await page.keyboard.press('KeyN');
        await sleep(250);
    }
}

async function first(page) {
    await page.goto(`${base}/en/fly/?sonic=start${Q}`, { waitUntil: 'load' });
    for (let i = 0; i < 300 && !(await page.locator('[data-testid="sonic-start-quick"]').isVisible().catch(() => false)); i++) await sleep(100);
    await sleep(800);
    await clickCentre(page, '[data-testid="sonic-start-quick"]');
    await sleep(1500);
    await clickScene(page);
    let ears = null;
    let answered = '';
    let skipped = false;
    let moving = false;
    const tEnd = Date.now() + 150000;
    while (Date.now() < tEnd) {
        const s = await look(page);
        if (!s) break;
        if (ears === null && s.lesson) ears = s.lesson;
        if (s.lesson === ears) {
            if (!skipped && s.phase === 'intro') {
                skipped = true;
                await page.keyboard.press('KeyN');
            } else if (s.asking && s.speechQueue === 0 && s.question && answered !== s.question.id) {
                answered = s.question.id;
                await page.keyboard.press(`Digit${Number(s.question.id.split(':')[2]) % 2 === 1 ? 1 : 2}`);
            }
        } else if (s.lesson) {
            if (s.card && !moving) {
                await passWithN(page);
                continue;
            }
            if (s.card && moving) {
                const name = s.card;
                await sleep(1500);
                await page.keyboard.press('Shift+KeyK');
                let gone = false;
                const after = [];
                for (let i = 0; i < 40 && !gone; i++) {
                    await sleep(100);
                    const c = (await look(page))?.card ?? null;
                    if (c !== null && c !== name) after.push(c);
                    gone = c !== name;
                }
                const known = await knownEvents(page);
                // the flight goes on (W still held; the next moment, when one comes at once, gone on with N)
                let speed = 0;
                const t0 = Date.now();
                while (Date.now() - t0 < 30000 && speed <= 0.3) {
                    const x = await look(page);
                    if (x?.card) await passWithN(page);
                    else if (x?.phase === 'flying') await fly(page, x);
                    speed = Math.max(speed, x?.speed ?? 0);
                    await sleep(150);
                }
                // the prefs document is written a little later than the event (its store batches writes)
                let saved = [];
                for (let i = 0; i < 30 && saved.length === 0; i++) {
                    saved = await savedKnown(page);
                    if (saved.length === 0) await sleep(200);
                }
                await letGo(page);
                step('know', gone && known.length >= 1 && saved.length >= 1 && speed > 0.3, { lesson: s.lesson, name, gone, nextCard: after[0] ?? null, events: await page.evaluate(() => (window.__gsfpv?.sonic?.(true)?.events ?? []).filter((e) => e.kind === "moment").map((e) => e.id + ":" + e.what)).catch(() => []), known, saved, speedAfter: Number(speed.toFixed(2)) });
                return { name, saved };
            }
            if (s.phase === 'flying') await fly(page, s);
            if (s.speed > 0.3) moving = true;
        }
        await sleep(100);
    }
    await letGo(page);
    step('know', false, { reason: 'no moment met in the air within 150 s' });
    return null;
}

async function kept(page, got) {
    await page.goto(`${base}/en/fly/?sonic=walls-hall${Q}`, { waitUntil: 'load' });
    await page.waitForSelector('[data-testid="sonic-start-asked"]', { timeout: 60000 }).catch(() => undefined);
    const savedAtLoad = await savedKnown(page);
    await clickCentre(page, '[data-testid="sonic-start-asked"]');
    await sleep(1500);
    await clickScene(page);
    const names = new Set();
    let maxSpeed = 0;
    const t0 = Date.now();
    while (Date.now() - t0 < 45000) {
        const s = await look(page);
        if (s?.card) {
            names.add(s.card);
            await letGo(page);
            await passWithN(page);
            continue;
        }
        if (s?.phase === 'flying') await fly(page, s);
        maxSpeed = Math.max(maxSpeed, s?.speed ?? 0);
        await sleep(150);
    }
    await letGo(page);
    step('kept', got.saved.every((c) => savedAtLoad.includes(c)) && !names.has(got.name) && maxSpeed > 0.3, { savedAtLoad, cardsSeen: [...names], maxSpeed: Number(maxSpeed.toFixed(2)) });
}

const pick = pickHarnessBrowser({ expected: chromium.executablePath() }, false);
mkdirSync(TEMP, { recursive: true });
const dir = mkdtempSync(`${TEMP}/review-profile-`);
const errors = [];
let ctx = null;
try {
    ctx = await chromium.launchPersistentContext(dir, { ...pick.launch, args: [...(pick.launch.args ?? []), '--autoplay-policy=no-user-gesture-required'], ...VIEW });
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)));
    const got = await first(page);
    if (got) await kept(page, got);
} catch (e) {
    errors.push(String(e).slice(0, 300));
} finally {
    await ctx?.close().catch(() => undefined);
    rmSync(dir, { recursive: true, force: true });
}
const ORDER = ['know', 'kept'];
const pass = ORDER.every((id) => steps[id]?.pass);
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify({ probe: 'tutor-air-review', base, pass, steps, errors }, null, 1));
console.log(JSON.stringify({ probe: 'tutor-air-review', base, pass, steps: Object.fromEntries(ORDER.map((id) => [id, steps[id] ? (steps[id].pass ? 'PASS' : 'FAIL') : 'NOT RUN'])), errors: errors.slice(0, 5) }));
process.exit(pass ? 0 : 1);
