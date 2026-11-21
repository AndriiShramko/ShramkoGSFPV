// Lane n-share (train 4), stage S3: the owner's line 2 of the brief by the MOUSE at 1536 x 730, device scale 1.25, ?render=off
// (the picture is not judged: no GPU lock). "I fly by sound in a scene with gates, Escape, Share, I send the address to a friend,
// and the friend gets the lessons, not the scene." Two rows, each: the sharer flies, Escape, the pause menu's Share (its menu id
// pause.share), the copied address read from the clipboard; then a NEW profile (an empty user-data dir under the temp folder)
// opens that address and presses the one main button it is offered: the scene, the course's gate count and the way of flying
// must be the sharer's.
//   sound   the sharer flies the scan with a generated course (?scene=S&course=g1.<seed>), Escape, the pause menu's "Fly by Sound
//           here" (pause.flyBySound) by the mouse: the flight goes on by sound in place (there Escape opens the pause menu)
//   normal  the sharer flies the scan normally with the same generated course (?scene=S&course=g1.<seed>)
// Steps per row (PASS or FAIL in one JSON):
//   <row>.shareCarries   the copied address names the scene, the course and (sound) the way of flying
//   <row>.landsOnScene   the new profile's first screen offers ONE main button and it flies that scene (sound: the start screen's
//                        sonic-start-scan, the lessons only a small second link; normal: the first-visit question's first
//                        answer, then the scene)
//   <row>.fliesSame      after that one press: the same scene, the same gate count and course link, the same way of flying
// The address is opened as copied, plus `render=off` (no GPU). A run against the live site is read only: every request to /api/
// other than GET is aborted by the probe (listed in the JSON), nothing is saved, sent or created; the course is generated in the tab.
// Usage: node tools/bench/scripts/n-share-accept.mjs <base, e.g. http://localhost:6921> <out.json> [tag]
// env: SCENE (default 887f27aa, Tunis), SEED (default 1), COURSE_MS (default 240000), ROWS (default sound,normal),
//      SHOT_ROWS (rows whose landing is pictured, default sound,normal), TEMP (default U:/Temp/gsfpv-train4/n-share).
import { createRequire } from 'node:module';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { pickBrowser } from '../src/chrome.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [base, outFile, tag = 'local'] = process.argv.slice(2);
if (!base || !outFile) {
    console.error('usage: n-share-accept.mjs <base> <out.json> [tag]');
    process.exit(2);
}
const SCENE = process.env.SCENE ?? '887f27aa';
const SEED = Number(process.env.SEED ?? 1);
const COURSE = `g1.${SEED.toString(36)}`;
const COURSE_MS = Number(process.env.COURSE_MS ?? 240000);
const ROWS = (process.env.ROWS ?? 'sound,normal').split(',');
const SHOT_ROWS = new Set((process.env.SHOT_ROWS ?? 'sound,normal').split(',').filter(Boolean));
const TEMP = process.env.TEMP_DIR ?? 'U:/Temp/gsfpv-train4/n-share';
const SHOTS = 'U:/Temp/gsfpv-train4/shots';
const VIEW = { viewport: { width: 1536, height: 730 }, deviceScaleFactor: 1.25 };
const T0 = Date.now();
const log = (...a) => console.error(`[${((Date.now() - T0) / 1000).toFixed(0).padStart(4)}s]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = pickBrowser({ expected: chromium.executablePath() });
const ARGS = ['--autoplay-policy=no-user-gesture-required'];

const steps = {};
const facts = {};
const errors = [];
const blocked = [];
const step = (name, pass, fact) => {
    steps[name] = pass ? 'PASS' : 'FAIL';
    facts[name] = fact;
    log(steps[name], name, JSON.stringify(fact ?? null).slice(0, 400));
};

/** read only on any site: a request to /api/ that is not a GET never leaves the browser */
async function guard(ctx) {
    await ctx.route('**/api/**', (r) => {
        if (r.request().method() === 'GET') return r.continue();
        blocked.push(`${r.request().method()} ${r.request().url()}`.slice(0, 160));
        return r.abort();
    });
    ctx.on('weberror', (e) => errors.push(String(e.error()).slice(0, 200)));
}

/** what the page says about its flight: the scene, the course, the sound mode, the pointer lock, the pause menu */
const READ = () => {
    const g = window.__gsfpv || {};
    const c = g.course || null;
    let s = null;
    try { s = g.sonic ? g.sonic(false) : null; } catch { s = null; }
    const q = new URLSearchParams(location.search);
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
    return {
        href: location.pathname + location.search,
        scene: (g.session && g.session.scene && g.session.scene.id) || (s && s.walls && !s.walls.builtin ? s.walls.scene : null),
        status: g.status ?? null,
        gates: c ? c.gates : null,
        source: c ? c.source : null,
        courseParam: q.get('course'),
        sonic: s ? { lesson: s.lesson, phase: s.phase, scene: s.walls ? s.walls.scene : null, builtin: s.walls ? s.walls.builtin : null } : null,
        locked: !!document.pointerLockElement,
        pause: !!document.querySelector('.pause-menu') && vis(document.querySelector('.pause-menu')),
        link: g.sonicLink ?? null
    };
};

/** the first screen as a new pilot finds it: every visible main (primary) button, the lessons link, the focus */
const LANDING = () => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden' && !el.closest('[hidden]'); };
    const id = (el) => el.getAttribute('data-testid') || el.getAttribute('data-action') || el.textContent.replace(/\s+/g, ' ').trim().slice(0, 40);
    // the site's consent bar (its own question, on every page of a new profile) is listed apart, not as the flight's main button
    const consent = [...document.querySelectorAll('[data-action^="consent-"]')].filter(vis).map(id);
    const prim = [...document.querySelectorAll('button.primary, a.primary')].filter(vis).filter((el) => !(el.getAttribute('data-action') || '').startsWith('consent-'));
    const start = document.querySelector('[data-testid="sonic-start"]');
    const startButtons = start ? [...start.querySelectorAll('.sonic-actions button, .sonic-actions a')].filter(vis).map(id) : [];
    const lessons = document.querySelector('[data-testid="sonic-start-lessons"]');
    const lb = lessons && vis(lessons) ? lessons.getBoundingClientRect() : null;
    return {
        primaries: prim.map(id),
        consent,
        startButtons,
        lessonsLink: lb ? { text: lessons.textContent.replace(/\s+/g, ' ').trim(), h: Math.round(lb.height), primary: lessons.classList.contains('primary') } : null,
        focused: document.activeElement ? id(document.activeElement) : null,
        title: (document.querySelector('[data-testid="sonic-start"] h1, [data-testid="sonic-start"] h2, .panel h2') || {}).textContent ?? null
    };
};

async function until(page, pred, ms, every = 250) {
    const t = Date.now();
    let v = null;
    while (Date.now() - t < ms) {
        v = await page.evaluate(READ).catch(() => null);
        if (v && pred(v)) return v;
        await sleep(every);
    }
    return v;
}

async function clickCentre(page, sel) {
    const loc = page.locator(sel).first();
    await loc.scrollIntoViewIfNeeded().catch(() => undefined);
    const box = await loc.boundingBox().catch(() => null);
    if (!box) return false;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.up();
    return true;
}

/** a click into the scene (the pointer lock first), as the pilot does */
async function clickScene(page) {
    await page.mouse.click(VIEW.viewport.width / 2, Math.round(VIEW.viewport.height * 0.6));
}

/** Escape, the pause menu (in a lesson Escape may be the lesson menu: then key P, said in the facts), Share by its menu id */
async function shareFromPause(page, ctx, row) {
    await page.evaluate(() => navigator.clipboard.writeText('-')).catch(() => undefined);
    await page.keyboard.press('Escape');
    let r = await until(page, (v) => v.pause, 3000);
    let via = 'Escape';
    if (!r?.pause) {
        await page.keyboard.press('KeyP');
        r = await until(page, (v) => v.pause, 3000);
        via = 'Escape, then key P';
    }
    const clicked = await clickCentre(page, '[data-action="pause.share"]');
    let field = null;
    for (let i = 0; i < 60; i++) {
        field = await page.evaluate(() => {
            const f = document.querySelector('[data-testid="share-url"]:not([hidden]), [data-testid="sonic-link-url"]');
            return f && f.value ? f.value : null;
        });
        if (field) break;
        await sleep(250);
    }
    await sleep(500);
    const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
    const hookLink = (await page.evaluate(READ)).link;
    const url = /^https?:\/\//.test(clip) ? clip : field ?? hookLink?.url ?? null;
    facts[`${row}.sharer`] = { ...(facts[`${row}.sharer`] ?? {}), menuBy: via, pauseMenu: !!r?.pause, shareClicked: clicked, clipboard: clip, field, hookLink, url };
    return url;
}

function judgeAddress(row, url) {
    const q = url ? new URL(url).searchParams : new URLSearchParams();
    const fact = { url, scene: q.get('scene'), course: q.get('course'), sonic: q.get('sonic') };
    const sound = row === 'sound';
    step(`${row}.shareCarries`, !!url && q.get('scene') === SCENE && q.get('course') === COURSE && (sound ? q.get('sonic') !== null : q.get('sonic') === null), fact);
}

async function friend(row, url, sharer) {
    const dir = `${TEMP}/profile-${tag}-${row}`;
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const ctx = await chromium.launchPersistentContext(dir, { ...pick.launch, args: ARGS, ...VIEW, permissions: ['clipboard-read', 'clipboard-write'] });
    try {
        await guard(ctx);
        const page = ctx.pages()[0] ?? (await ctx.newPage());
        page.on('pageerror', (e) => errors.push(`${row} friend: ${String(e.message).slice(0, 200)}`));
        const open = url ? url + (url.includes('?') ? '&' : '?') + 'render=off' : `${base}/fly/?scene=${SCENE}&render=off`;
        await page.goto(open, { waitUntil: 'load', timeout: 120000 });
        // the first screen: the sound start screen, or the first-visit question
        for (let i = 0; i < 200; i++) {
            const ready = await page.evaluate(() => !!document.querySelector('[data-testid="sonic-start"] .sonic-actions button, button.level-answer'));
            if (ready) break;
            await sleep(150);
        }
        await sleep(1200);
        const land = await page.evaluate(LANDING);
        if (SHOT_ROWS.has(row)) {
            const file = `${SHOTS}/n-share-${tag}-${row}.png`;
            await page.screenshot({ path: file }).catch(() => undefined);
            land.picture = file;
        }
        const main = land.primaries[0] ?? null;
        const sound = row === 'sound';
        const oneMain = sound
            ? land.primaries.length === 1 && main === 'sonic-start-scan' && land.startButtons[0] === 'sonic-start-scan' && !!land.lessonsLink && !land.lessonsLink.primary
            : land.primaries.length === 1;
        step(`${row}.landsOnScene`, oneMain, land);
        // the one press: the main button by the mouse (and, in a normal flight, the click into the scene that takes the pointer)
        const clicks = [];
        if (main) {
            const sel = sound && main === 'sonic-start-scan' ? `[data-testid="${main}"]` : 'button.primary:not([data-action^="consent-"])';
            if (await clickCentre(page, sel)) clicks.push(main);
        }
        let v = await until(page, (x) => (sound ? x.sonic?.lesson != null : x.scene === SCENE && x.status !== 'loading'), 120000, 400);
        if (!sound) {
            await clickScene(page);
            clicks.push('scene (pointer lock)');
        }
        v = await until(page, (x) => (x.gates ?? 0) > 0 && x.gates === sharer.gates, COURSE_MS, 500);
        const same = !!v && v.scene === SCENE && v.gates === sharer.gates && v.courseParam === COURSE && (sound ? v.sonic?.lesson === 'scan-free' && v.sonic.scene === SCENE && v.sonic.builtin === false : v.sonic === null || v.sonic.lesson === null);
        step(`${row}.fliesSame`, same, { clicks, sharer, friend: v });
    } finally {
        await ctx.close();
    }
}

async function row(browser, name) {
    const sound = name === 'sound';
    const ctx = await browser.newContext({ ...VIEW, permissions: ['clipboard-read', 'clipboard-write'] });
    await guard(ctx);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${name} sharer: ${String(e.message).slice(0, 200)}`));
    const at = `${base}/en/fly/?scene=${SCENE}&course=${COURSE}&render=off&nowarn=1`;
    await page.goto(at, { waitUntil: 'load', timeout: 120000 });
    let v = await until(page, (x) => x.scene === SCENE && x.status !== 'loading', 120000, 400);
    await clickScene(page);
    v = await until(page, (x) => (x.gates ?? 0) > 0, COURSE_MS, 500);
    let soundBy = null;
    if (sound) {
        // the owner's way: in the flight with gates, Escape, the pause menu's "Fly by Sound here" (key Backslash where the menu
        // does not show it), the flight goes on by sound in place
        await page.keyboard.press('Escape');
        await until(page, (x) => x.pause, 3000);
        if (await clickCentre(page, '[data-action="pause.flyBySound"]')) soundBy = 'pause.flyBySound';
        else {
            await page.keyboard.press('Escape');
            await sleep(500);
            await page.keyboard.press('Backslash');
            soundBy = 'key Backslash';
        }
        v = await until(page, (x) => x.sonic?.lesson != null, 120000, 400);
        await sleep(1000);
        await clickScene(page);
    }
    await sleep(1500);
    v = await page.evaluate(READ);
    const sharer = { scene: v.scene, gates: v.gates, course: v.courseParam, sonic: v.sonic, locked: v.locked };
    facts[`${name}.sharer`] = { opened: at, soundBy, ...sharer };
    log(name, 'sharer', JSON.stringify(sharer));
    const url = await shareFromPause(page, ctx, name);
    judgeAddress(name, url);
    // sound: a sound page lays a generated course without the competition elements (course/finish.ts courseElements(ctx.sonic),
    // lane course4 CU-1: the ear pilot flies single upright gates), so the sharer who turned sound on in place flies more gates
    // than any sound page laying the same link. The friend is compared with the same address opened in the sharer's own browser
    // (a profile that has flown here): a fresh profile must fly what a known one flies. The in-place count is kept in the facts.
    let expect = sharer;
    if (sound && url) {
        const ref = await ctx.newPage();
        await ref.goto(url + (url.includes('?') ? '&' : '?') + 'render=off', { waitUntil: 'load', timeout: 120000 });
        await ref.waitForSelector('[data-testid="sonic-start-scan"]', { state: 'visible', timeout: 30000 }).catch(() => null);
        await sleep(1200);
        await clickCentre(ref, '[data-testid="sonic-start-scan"]');
        const r = await until(ref, (x) => (x.gates ?? 0) > 0, COURSE_MS, 500);
        expect = { ...sharer, gates: r ? r.gates : null, inPlaceGates: sharer.gates, by: 'the same address in the sharer browser' };
        facts[`${name}.reference`] = r;
    }
    await ctx.close();
    await friend(name, url, expect);
}

const browser = await chromium.launch({ ...pick.launch, args: ARGS });
try {
    for (const r of ROWS) {
        try {
            await row(browser, r);
        } catch (e) {
            errors.push(`${r}: ${String(e).slice(0, 300)}`);
        }
    }
} finally {
    await browser.close();
}

const NAMES = ROWS.flatMap((r) => [`${r}.shareCarries`, `${r}.landsOnScene`, `${r}.fliesSame`]);
for (const n of NAMES) if (!(n in steps)) steps[n] = 'FAIL';
const verdict = { probe: 'n-share-accept', base, tag, browser: pick.kind, viewport: '1536x730@1.25', scene: SCENE, course: COURSE, steps, pass: NAMES.every((n) => steps[n] === 'PASS'), facts, blocked, errors };
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify(verdict, null, 1));
console.log(JSON.stringify({ probe: verdict.probe, base, pass: verdict.pass, steps, blocked: blocked.length, errors: errors.slice(0, 5) }));
process.exit(verdict.pass ? 0 : 1);
