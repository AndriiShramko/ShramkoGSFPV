// Lane w1-anchor (train 5), stage S3: the acceptance by the MOUSE at 1536x730, device scale 1.25. A generated course grows
// from the pilot's place (design C:/dev/.gsfpv-lanes/designs/w1-diag.md, R1): the spawn (the author's camera) when the drone is
// parked there, else the drone; and its link lays the same course in a fresh browser.
// Steps (each {step, name, pass, detail}; distances are flat, on x and z, y is up):
//   1 atCamera   scan eb5f51dc just loaded: a click into the scene (the pointer lock), key Shift+G, the dialog's Build by the
//                mouse: the course comes, gate 1 lies within NEAR_M (15 m) of the spawn
//   2 atDrone    a click into the scene, Space (up) then W (forward) until the drone is 30 m from where it took off, Escape (the
//                pause menu: the drone stops in the air), the menu's course item, Build: gate 1 lies within NEAR_M of the drone
//                and nearer it than the spawn, and the drone is at least 25 m from the spawn
//   3 linkHas    Escape, the pause menu's Share: the copied address names the course with its anchor (g2.<seed>.<ls>.<x>.<y>.<z>)
//   4 sameCourse a fresh browser context opens that address: the same gates (positions to 1 cm)
// Usage: node tools/bench/scripts/w1-anchor-accept.mjs <base with /en> <out.json> [scene eb5f51dc]
// env: RENDER=on draws (hold the GPU lock C:/dev/.gpu-lock around the run), SHOT=<png> one picture after step 1, COURSE_MS.
// Read only: every request that is not a GET, HEAD or OPTIONS, and analytics, are aborted (listed in the JSON); no save button is pressed; a
// generated course lives only in the tab. Against the live site step 1 must FAIL (the negative control). Exit 1 on a failure.
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { pickBrowser } from '../src/chrome.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [base, outFile, scene = 'eb5f51dc'] = process.argv.slice(2);
if (!base || !outFile) { console.error('usage: w1-anchor-accept.mjs <base with /en> <out.json> [scene]'); process.exit(2); }
const RENDER = process.env.RENDER === 'on';
const COURSE_MS = Number(process.env.COURSE_MS ?? 240000);
const pick = pickBrowser({ expected: chromium.executablePath() });
const browser = await chromium.launch({ ...pick.launch, headless: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = { probe: 'w1-anchor-accept', base, scene, render: RENDER, viewport: '1536x730@1.25', steps: [], blocked: [], errors: [] };
const save = () => writeFileSync(outFile, JSON.stringify(out, null, 1));
const check = (step, name, pass, detail) => {
    out.steps.push({ step, name, pass, detail });
    console.log(`${step} ${name} ${pass ? 'PASS' : 'FAIL'} ${JSON.stringify(detail).slice(0, 400)}`);
    save();
};
const PARAMS = `nowarn=1&set.input.howToFly=false&set.input.play=easy${RENDER ? '' : '&render=off'}`;

/** In the page: the course's gates, its request, the spawn, the drone, the dialog and the pause menu, as they are now. */
const READ = () => {
    const g = window.__gsfpv || {};
    const c = g.course;
    const ses = g.session;
    let poses = [];
    try { poses = c && c.gatePoses ? c.gatePoses() : []; } catch { poses = []; }
    const sim = ses && ses.sim ? ses.sim.s : null;
    return {
        status: g.status, lock: !!document.pointerLockElement, gates: c ? c.gates : 0, drawn: c ? c.drawn : 0,
        poses: poses.map((p) => p.pos.map((v) => Math.round(v * 100) / 100)),
        request: c ? c.request ?? null : null,
        spawn: ses && ses.spawn ? [ses.spawn[0], ses.spawn[1], ses.spawn[2]] : null,
        drone: sim ? [sim[0], sim[1], sim[2]] : null,
        dialog: !!document.querySelector('[data-testid=gen-dialog]'),
        pause: !!document.querySelector('.pause-menu')
    };
};
const flat = (a, b) => (a && b ? Math.round(Math.hypot(a[0] - b[0], a[2] - b[2]) * 10) / 10 : null);
/** gate 1 counts as 'round the pilot' within this many flat metres of the anchor. Integration car 6: the design's 10 m is the
 *  measuring gate's MEDIAN; each press takes a random seed, and single seeds lay gate 1 farther (the review: 12.3 and 12.5 m;
 *  car 6's build: 10.7 m from the paused drone). 15 m keeps every seed seen so far and still fails the live site (492.6 m);
 *  step 2 also asks gate 1 to lie nearer the drone than the spawn, so the course must have moved with the pilot. */
const NEAR_M = 15;
const digest = (s) => s.poses.map((p) => p.join(',')).join(';');
const courseUp = (s) => s.gates > 0 && s.drawn > 0;

async function poll(page, ms, ok) {
    const t0 = Date.now();
    for (;;) {
        const s = await page.evaluate(READ);
        if (ok(s) || Date.now() - t0 > ms) return { ...s, ms: Date.now() - t0 };
        await sleep(150);
    }
}

async function newContext() {
    const ctx = await browser.newContext({ viewport: { width: 1536, height: 730 }, deviceScaleFactor: 1.25, permissions: ['clipboard-read', 'clipboard-write'] });
    await ctx.route('**/*', (route) => {
        const r = route.request();
        const u = r.url();
        if (!['GET', 'HEAD', 'OPTIONS'].includes(r.method()) || /google-analytics|googletagmanager|doubleclick/.test(u)) {
            out.blocked.push(`${r.method()} ${u.slice(0, 120)}`);
            return route.abort();
        }
        return route.continue();
    });
    return ctx;
}

async function openPage(ctx, url) {
    const page = await ctx.newPage();
    page.on('pageerror', (e) => out.errors.push(String(e.message).slice(0, 160)));
    await page.goto(url, { waitUntil: 'load', timeout: 120000 });
    await page.waitForFunction(() => ['ready', 'error'].includes(window.__gsfpv && window.__gsfpv.status), null, { timeout: 300000 });
    const kb = await page.waitForSelector('.screen.radio [data-action=radio-keyboard]', { timeout: 6000 }).then(() => true, () => false);
    if (kb) await page.locator('[data-action=radio-keyboard]').click();
    else { const x = page.locator('.screen.radio [data-action=radio-close]'); if (await x.count()) await x.first().click(); }
    await page.waitForFunction(() => !document.querySelector('.screen.radio'), null, { timeout: 15000 }).catch(() => 0);
    await page.waitForFunction(() => { const w = window.__gsfpv && window.__gsfpv.walls; return !w || w.state !== 'checking'; }, null, { timeout: 120000 }).catch(() => 0);
    await page.waitForFunction(() => !!(window.__gsfpv && window.__gsfpv.session && window.__gsfpv.session.baseCollision), null, { timeout: 180000 }).catch(() => 0);
    await sleep(1000);
    out.landings = [...(out.landings ?? []), await page.evaluate(() => ({
        url: location.href.slice(0, 160), status: window.__gsfpv && window.__gsfpv.status, session: !!(window.__gsfpv && window.__gsfpv.session),
        buttons: [...document.querySelectorAll('button')].filter((b) => b.offsetParent !== null).map((b) => b.getAttribute('data-action') || (b.textContent || '').trim().slice(0, 30)).slice(0, 20)
    }))];
    save();
    return page;
}

const clickScene = (page) => page.mouse.click(768, 438);

async function build(page) {
    const b = page.locator('[data-testid=gen-dialog] [data-action="gen-build"]');
    if (!(await b.count())) return false;
    await b.first().click();
    return true;
}

let failed = false;
try {
    const ctx = await newContext();
    const page = await openPage(ctx, `${base}/fly/?scene=${scene}&${PARAMS}`);

    // 1 at the camera: Shift+G, Build
    await clickScene(page);
    await sleep(500);
    const lock1 = await page.evaluate(() => !!document.pointerLockElement);
    await page.keyboard.press('Shift+KeyG');
    const dlg1 = await page.waitForSelector('[data-testid=gen-dialog]', { timeout: 5000 }).then(() => true, () => false);
    const b1 = await page.evaluate(READ);
    const built1 = await build(page);
    const s1 = await poll(page, COURSE_MS, courseUp);
    const g1 = s1.poses[0] ?? null;
    check(1, `atCamera: Shift+G at the load, gate 1 within ${NEAR_M} m of the spawn`, courseUp(s1) && flat(g1, s1.spawn) <= NEAR_M,
        { lock: lock1, dialog: dlg1, built: built1, ms: s1.ms, gates: s1.gates, spawn: s1.spawn, droneAtBuild: b1.drone, gate1: g1,
          gate1ToSpawnM: flat(g1, s1.spawn), meanGateToSpawnM: s1.poses.length ? Math.round(s1.poses.reduce((a, p) => a + flat(p, s1.spawn), 0) / s1.poses.length) : null,
          request: s1.request });
    if (process.env.SHOT) { await sleep(1500); await page.screenshot({ path: process.env.SHOT }); }
    const d1 = digest(s1);

    // 2 fly 30 m, pause in the air, the menu's course item, Build
    await sleep(2000);
    await clickScene(page);
    await sleep(400);
    const t0 = await page.evaluate(READ);
    await page.keyboard.down('Space');
    await sleep(1500);
    await page.keyboard.down('KeyW');
    await sleep(300);
    await page.keyboard.up('Space');
    let fl = t0;
    const tf = Date.now();
    while (Date.now() - tf < 30000) {
        fl = await page.evaluate(READ);
        if (flat(fl.drone, t0.drone) >= 30 && flat(fl.drone, fl.spawn) >= 25) break;
        await sleep(100);
    }
    await page.keyboard.up('KeyW');
    await page.keyboard.press('Escape');
    const menu = await page.waitForSelector('.pause-menu', { timeout: 6000 }).then(() => true, () => false);
    const p0 = await page.evaluate(READ);
    await sleep(800);
    const p1 = await page.evaluate(READ);
    const item = page.locator('.pause-menu [data-action="pause.course"]');
    const hasItem = (await item.count()) > 0;
    if (hasItem) await item.first().click();
    const dlg2 = await page.waitForSelector('[data-testid=gen-dialog]', { timeout: 5000 }).then(() => true, () => false);
    const b2 = await page.evaluate(READ);
    const built2 = await build(page);
    const s2 = await poll(page, COURSE_MS, (q) => courseUp(q) && digest(q) !== d1);
    const g2 = s2.poses[0] ?? null;
    const here = b2.drone;
    check(2, `atDrone: 30 m away, paused, course item, gate 1 within ${NEAR_M} m of the drone and nearer it than the spawn`,
        courseUp(s2) && digest(s2) !== d1 && flat(here, s2.spawn) >= 25 && flat(g2, here) <= NEAR_M && flat(g2, here) < flat(g2, s2.spawn),
        { takeoffAt: t0.drone, flownAt: fl.drone, flownM: flat(fl.drone, t0.drone), rose: fl.drone && t0.drone ? Math.round((fl.drone[1] - t0.drone[1]) * 10) / 10 : null,
          menu, stillInPause: flat(p0.drone, p1.drone) === 0 && p0.drone[1] === p1.drone[1], courseItem: hasItem, dialog: dlg2, built: built2,
          droneAtBuild: here, droneToSpawnM: flat(here, s2.spawn), gate1: g2, gate1ToDroneM: flat(g2, here), gate1ToSpawnM: flat(g2, s2.spawn),
          gates: s2.gates, ms: s2.ms, request: s2.request });
    const d2 = digest(s2);

    // 3 the link: Escape, Share
    await sleep(1500);
    await page.evaluate(() => navigator.clipboard.writeText('-')).catch(() => undefined);
    if (!(await page.evaluate(() => !!document.querySelector('.pause-menu')))) {
        await clickScene(page);
        await sleep(400);
        await page.keyboard.press('Escape');
        await page.waitForSelector('.pause-menu', { timeout: 6000 }).catch(() => 0);
    }
    const share = page.locator('[data-action="pause.share"]');
    const hasShare = (await share.count()) > 0;
    if (hasShare) await share.first().click();
    let field = null;
    for (let i = 0; i < 40 && !field; i++) {
        field = await page.evaluate(() => { const f = document.querySelector('[data-testid="share-url"]:not([hidden])'); return f && f.value ? f.value : null; });
        if (!field) await sleep(250);
    }
    const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
    const url = /^https?:\/\//.test(clip) ? clip : field;
    const course = url ? new URL(url).searchParams.get('course') : null;
    check(3, 'linkHas: the shared address names the course with its anchor', !!course && /^g2\.[0-9a-z]+\.[a-z]{2}\.-?\d+\.-?\d+\.-?\d+$/.test(course),
        { share: hasShare, clipboard: clip, field, course });
    await ctx.close();

    // 4 a fresh browser context opens the address
    const ctx2 = await newContext();
    const fresh = url ? await openPage(ctx2, `${url}${url.includes('?') ? '&' : '?'}${PARAMS}`) : null;
    const s4 = fresh ? await poll(fresh, COURSE_MS, courseUp) : null;
    check(4, 'sameCourse: a fresh context lays the same gates', !!s4 && courseUp(s4) && digest(s4) === d2,
        { opened: !!fresh, gates: s4 ? s4.gates : 0, same: !!s4 && digest(s4) === d2, gate1: s4 ? s4.poses[0] : null, ms: s4 ? s4.ms : null, request: s4 ? s4.request : null });
    await ctx2.close();
} catch (e) { out.fail = String(e).slice(0, 300); console.log('FAIL', out.fail); failed = true; }
const bad = out.steps.filter((q) => !q.pass).map((q) => q.step);
out.verdict = { pass: !failed && bad.length === 0 && out.steps.length === 4, failed: bad };
save();
console.log(JSON.stringify(out.verdict));
await browser.close();
process.exit(out.verdict.pass ? 0 : 1);
