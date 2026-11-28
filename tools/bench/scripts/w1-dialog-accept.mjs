// Lane w1-dialog (train 5), stage S3: the acceptance by the MOUSE at 1536x730, device scale 1.25. The generate dialog asks
// WHERE (design C:/dev/.gsfpv-lanes/designs/w1-diag.md, R2; the owner's brief line 667, ideas b, c, d): Here (the default),
// Whole scan, and Add here over a course; a link made after Add here lays the whole course in a fresh browser.
// Steps (each {step, name, pass, detail}; distances are flat, on x and z, y is up):
//   1 here      scan eb5f51dc in English: a click into the scene (the pointer lock), key Shift+G: the dialog offers Here (pressed)
//               and Whole scan, no Add here, the line 'laid where the drone is'; it fits (in view, no overlap, buttons 44 px);
//               the mouse clicks Here and Build: the course comes, gate 1 within 10 m of the drone
//   2 addHere   a click into the scene, Space then W until the drone is 30 m away, Escape (the pause), the menu's course item:
//               Add here is offered, the line says Here and Whole scan replace the course; the mouse clicks Add here and the
//               main button: every old gate stands where it stood, new gates stand round the drone (one within 10 m), closed
//   3 link      the pause menu's Share: the address names both parts (g2.<first>_<added>); a fresh context opens it and lays
//               the same gates (positions to 1 cm)
//   4 wholeScan back in the first tab, the course item, Whole scan, the main button: the course is replaced (not all old gates
//               kept), the ask is wide, and its gates reach farther from the drone than the Here ring Add here laid there
//   5 keys      keys alone: Shift+G in flight, Tab reaches Here, Whole scan, Add here, Cancel and the main button; Space on Add
//               here presses it; Tab to Cancel, Enter: the dialog closes and the course is the same; the dialog is a named
//               dialog (read out by a screen reader) with its title
//   6 polish    the same scan in Polish: Shift+G shows the Polish title, Here, Whole scan and the line; it fits; key Enter alone
//               builds; Shift+G again offers 'Dodaj tutaj' with the Polish replace line
// Usage: node tools/bench/scripts/w1-dialog-accept.mjs <base with /en> <out.json> [scene eb5f51dc]
// env: RENDER=on draws (hold the GPU lock C:/dev/.gpu-lock around the run), SHOT=<png> one picture after step 2, COURSE_MS.
// Read only: every request that is not a GET, HEAD or OPTIONS, and analytics, are aborted (listed in the JSON); no save button is
// pressed; a generated course lives only in the tab. Against the live site (before train 5) steps 1 to 6 FAIL (the negative
// control: no where row). Exit 1 on a failure.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { pickBrowser } from '../src/chrome.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [base, outFile, scene = 'eb5f51dc'] = process.argv.slice(2);
if (!base || !outFile) { console.error('usage: w1-dialog-accept.mjs <base with /en> <out.json> [scene]'); process.exit(2); }
const RENDER = process.env.RENDER === 'on';
const COURSE_MS = Number(process.env.COURSE_MS ?? 240000);
const words = (lang) => JSON.parse(readFileSync(new URL(`../../../packages/i18n/locales/fly/course/${lang}.json`, import.meta.url), 'utf8'));
const EN = words('en');
const PL = words('pl');
const pick = pickBrowser({ expected: chromium.executablePath() });
const browser = await chromium.launch({ ...pick.launch, headless: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = { probe: 'w1-dialog-accept', base, scene, render: RENDER, viewport: '1536x730@1.25', steps: [], blocked: [], errors: [] };
const save = () => writeFileSync(outFile, JSON.stringify(out, null, 1));
const check = (step, name, pass, detail) => {
    out.steps.push({ step, name, pass, detail });
    console.log(`${step} ${name} ${pass ? 'PASS' : 'FAIL'} ${JSON.stringify(detail).slice(0, 400)}`);
    save();
};
const PARAMS = `nowarn=1&set.input.howToFly=false&set.input.play=easy${RENDER ? '' : '&render=off'}`;

/** In the page: the course, its request and plan, the spawn, the drone, the dialog's texts and buttons. */
const READ = () => {
    const g = window.__gsfpv || {};
    const c = g.course;
    const ses = g.session;
    let poses = [];
    try { poses = c && c.gatePoses ? c.gatePoses() : []; } catch { poses = []; }
    const sim = ses && ses.sim ? ses.sim.s : null;
    const dlg = document.querySelector('[data-testid=gen-dialog]');
    const txt = (sel) => { const el = dlg && dlg.querySelector(sel); return el ? (el.textContent || '').trim() : null; };
    return {
        status: g.status, lock: !!document.pointerLockElement, gates: c ? c.gates : 0, drawn: c ? c.drawn : 0,
        poses: poses.map((p) => p.pos.map((v) => Math.round(v * 100) / 100)),
        request: c ? c.request ?? null : null, plan: c && c.plan ? { ok: c.plan.ok, stats: c.plan.stats ?? null, eased: c.plan.eased ?? null } : null,
        spawn: ses && ses.spawn ? [ses.spawn[0], ses.spawn[1], ses.spawn[2]] : null,
        drone: sim ? [sim[0], sim[1], sim[2]] : null,
        pause: !!document.querySelector('.pause-menu'),
        dialog: dlg ? {
            role: dlg.getAttribute('role'), label: dlg.getAttribute('aria-label'), title: txt('h2'),
            wheres: [...dlg.querySelectorAll('[data-action^="gen-where-"]')].map((b) => ({ id: b.getAttribute('data-action').slice(10), label: (b.textContent || '').trim(), pressed: b.getAttribute('aria-pressed') === 'true' })),
            whereLine: txt('[data-testid=gen-where-line]'), hint: txt('[data-testid=gen-where-hint]'), replaces: txt('[data-testid=gen-replaces]'),
            main: txt('[data-action=gen-build]')
        } : null
    };
};

/** In the page: every leaf part of the dialog with its rect (the overlap rule of gen4-accept-probe step 10). */
const PARTS = () => {
    const dlg = document.querySelector('[data-testid=gen-dialog]');
    if (!dlg) return null;
    const rect = (el) => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; };
    const parts = Array.from(dlg.querySelectorAll('button, h2, p')).filter((el) => el.offsetParent !== null).map((el) => ({ tag: el.tagName.toLowerCase(), act: el.getAttribute('data-action'), text: (el.textContent || '').trim().slice(0, 30), ...rect(el) }));
    return { W: innerWidth, H: innerHeight, parts };
};
const inView = (b, W, H) => !!b && b.x >= 0 && b.y >= 0 && b.x + b.w <= W + 0.5 && b.y + b.h <= H + 0.5;
const overlap = (a, b) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 0.5 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 0.5;
async function fits(page) {
    const pp = await page.evaluate(PARTS);
    if (!pp) return { ok: false, parts: 0 };
    const bad = [];
    for (let i = 0; i < pp.parts.length; i++) for (let j = i + 1; j < pp.parts.length; j++) if (overlap(pp.parts[i], pp.parts[j])) bad.push([pp.parts[i].act || pp.parts[i].text, pp.parts[j].act || pp.parts[j].text]);
    const outside = pp.parts.filter((q) => !inView(q, pp.W, pp.H)).map((q) => q.act || q.text);
    const small = pp.parts.filter((q) => q.tag === 'button' && (q.w < 44 || q.h < 44)).map((q) => `${q.act} ${Math.round(q.w)}x${Math.round(q.h)}`);
    return { ok: bad.length === 0 && outside.length === 0 && small.length === 0, parts: pp.parts.length, overlaps: bad.slice(0, 4), outside, small };
}

const flat = (a, b) => (a && b ? Math.round(Math.hypot(a[0] - b[0], a[2] - b[2]) * 10) / 10 : null);
const digest = (s) => s.poses.map((p) => p.join(',')).join(';');
const courseUp = (s) => s.gates > 0 && s.drawn > 0;
const same = (a, b) => Math.abs(a[0] - b[0]) <= 0.011 && Math.abs(a[1] - b[1]) <= 0.011 && Math.abs(a[2] - b[2]) <= 0.011;
const keptOf = (old, now) => old.filter((p) => now.some((q) => same(p, q))).length;
const span = (poses) => { let m = 0; for (const a of poses) for (const b of poses) m = Math.max(m, flat(a, b)); return m; };
const reach = (poses, at) => poses.reduce((m, p) => Math.max(m, flat(p, at)), 0);
const fill = (s, n) => s.replace('{n}', String(n));

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
    return page;
}

const clickScene = (page) => page.mouse.click(768, 438);
async function press(page, act) {
    const b = page.locator(`[data-testid=gen-dialog] [data-action="${act}"]`);
    if (!(await b.count())) return false;
    await b.first().click();
    await sleep(250);
    return true;
}
/** the mouse path to the dialog in a pause: a click into the scene when no pause menu is up, Escape, the course item */
async function menuDialog(page) {
    if (!(await page.evaluate(() => !!document.querySelector('.pause-menu')))) {
        await clickScene(page);
        await sleep(400);
        await page.keyboard.press('Escape');
        await page.waitForSelector('.pause-menu', { timeout: 6000 }).catch(() => 0);
    }
    const item = page.locator('.pause-menu [data-action="pause.course"]');
    const has = (await item.count()) > 0;
    if (has) await item.first().click();
    const dlg = await page.waitForSelector('[data-testid=gen-dialog]', { timeout: 5000 }).then(() => true, () => false);
    await sleep(300);
    return { item: has, dialog: dlg };
}
const wheres = (s) => (s.dialog ? s.dialog.wheres.map((w) => w.id).join(',') : null);
const pressedWhere = (s) => (s.dialog ? (s.dialog.wheres.find((w) => w.pressed) || {}).id ?? null : null);

let failed = false;
try {
    const ctx = await newContext();
    const page = await openPage(ctx, `${base}/fly/?scene=${scene}&${PARAMS}`);

    // 1 Here: Shift+G, the where row, the hint, the fit; Here and Build by the mouse
    await clickScene(page);
    await sleep(500);
    const lock1 = await page.evaluate(() => !!document.pointerLockElement);
    await page.keyboard.press('Shift+KeyG');
    await page.waitForSelector('[data-testid=gen-dialog]', { timeout: 5000 }).catch(() => 0);
    await sleep(300);
    const q1 = await page.evaluate(READ);
    const fit1 = await fits(page);
    const p1 = [await press(page, 'gen-where-here'), await press(page, 'gen-build')];
    const s1 = await poll(page, COURSE_MS, courseUp);
    const here1 = q1.drone;
    check(1, 'here: Shift+G offers Here (pressed) and Whole scan, the hint, it fits; Here + Build: gate 1 within 10 m of the drone',
        wheres(q1) === 'here,scan' && pressedWhere(q1) === 'here' && q1.dialog.hint === EN['course.gen.whereHint'] && fit1.ok && p1.every(Boolean) && courseUp(s1) && flat(s1.poses[0], here1) <= 10,
        { lock: lock1, wheres: q1.dialog && q1.dialog.wheres, hint: q1.dialog && q1.dialog.hint, fit: fit1, pressed: p1, gates: s1.gates, ms: s1.ms, gate1ToDroneM: flat(s1.poses[0], here1), spanM: span(s1.poses), request: s1.request });
    const span1 = span(s1.poses);
    const old = s1.poses;

    // 2 fly 30 m, pause, the course item, Add here
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
    await page.waitForSelector('.pause-menu', { timeout: 6000 }).catch(() => 0);
    await sleep(800);
    const how2 = await menuDialog(page);
    const q2 = await page.evaluate(READ);
    const pAdd = await press(page, 'gen-where-add');
    const q2b = await page.evaluate(READ);
    const pMain = await press(page, 'gen-build');
    const s2 = await poll(page, COURSE_MS, (q) => courseUp(q) && q.gates > old.length);
    const there = q2.drone;
    const added = s2.poses.filter((p) => !old.some((o) => same(o, p)));
    const nearest = added.length ? Math.min(...added.map((p) => flat(p, there))) : null;
    const st2 = s2.plan && s2.plan.ok ? s2.plan.stats : null;
    check(2, 'addHere: 30 m away, paused, Add here: every old gate stands, new gates round the drone, the ring closed',
        how2.dialog && wheres(q2) === 'here,scan,add' && pressedWhere(q2) === 'here' && q2.dialog.replaces === fill(EN['course.gen.replaces'], old.length) &&
        pAdd && pressedWhere(q2b) === 'add' && q2b.dialog.replaces === fill(EN['course.gen.keeps'], old.length) && q2b.dialog.main === EN['course.gen.add'] && pMain &&
        flat(there, s2.spawn) >= 25 && keptOf(old, s2.poses) === old.length && added.length >= 1 && nearest <= 10 && !!st2 && st2.closed === true && st2.outside === 0,
        { flownM: flat(fl.drone, t0.drone), droneToSpawnM: flat(there, s2.spawn), how: how2, wheres: q2.dialog && q2.dialog.wheres, replaces: q2.dialog && q2.dialog.replaces,
          afterAdd: q2b.dialog && { pressed: pressedWhere(q2b), keeps: q2b.dialog.replaces, main: q2b.dialog.main }, oldGates: old.length, gates: s2.gates,
          kept: keptOf(old, s2.poses), added: added.length, nearestNewToDroneM: nearest, stats: st2 && { closed: st2.closed, outside: st2.outside }, ms: s2.ms, request: s2.request });
    if (process.env.SHOT) { await sleep(1500); await page.screenshot({ path: process.env.SHOT }); }
    const d2 = digest(s2);
    const both = s2.poses;

    // 3 the link: Escape, Share; a fresh context opens it
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
    const ctx2 = await newContext();
    const fresh = url ? await openPage(ctx2, `${url}${url.includes('?') ? '&' : '?'}${PARAMS}`) : null;
    const s3 = fresh ? await poll(fresh, COURSE_MS, (q) => courseUp(q) && q.gates >= both.length) : null;
    check(3, 'link: the address names both parts; a fresh context lays the same gates',
        !!course && /^g2\.[^_]+_[0-9a-z]+\.[a-z]{2}\.-?\d+\.-?\d+\.-?\d+$/.test(course) && !!s3 && digest(s3) === d2,
        { share: hasShare, course, gates: s3 ? s3.gates : 0, same: !!s3 && digest(s3) === d2, ms: s3 ? s3.ms : null });
    await ctx2.close();
    // back to the first tab: the share panel and the pause menu are closed by Escape
    for (let i = 0; i < 3 && (await page.evaluate(() => !!document.querySelector('.pause-menu, [data-testid="share-url"]:not([hidden])'))); i++) { await page.keyboard.press('Escape'); await sleep(400); }

    // 4 Whole scan replaces the course and spreads
    const how4 = await menuDialog(page);
    const pScan = await press(page, 'gen-where-scan');
    const q4 = await page.evaluate(READ);
    const pMain4 = await press(page, 'gen-build');
    const s4 = await poll(page, COURSE_MS, (q) => courseUp(q) && digest(q) !== d2);
    check(4, 'wholeScan: the course is replaced, the ask is wide, it spreads farther than Here',
        how4.dialog && pScan && pressedWhere(q4) === 'scan' && q4.dialog.whereLine === EN['course.gen.whereLine.scan'] && pMain4 && courseUp(s4) && digest(s4) !== d2 &&
        keptOf(both, s4.poses) < both.length && !!s4.request && s4.request.spread === 'wide' && reach(s4.poses, there) > reach(added, there),
        { how: how4, pressed: pressedWhere(q4), whereLine: q4.dialog && q4.dialog.whereLine, gates: s4.gates, keptOfOld: keptOf(both, s4.poses), oldGates: both.length,
          reachM: reach(s4.poses, there), hereReachM: reach(added, there), spanM: span(s4.poses), hereSpanM: span1, eased: s4.plan && s4.plan.eased, request: s4.request, ms: s4.ms });
    const d4 = digest(s4);

    // 5 keys alone
    await sleep(9000);
    await clickScene(page);
    await sleep(500);
    await page.keyboard.press('Shift+KeyG');
    const opened = await page.waitForSelector('[data-testid=gen-dialog]', { timeout: 5000 }).then(() => true, () => false);
    const q5 = await page.evaluate(READ);
    const order = [];
    for (let i = 0; opened && i < 30; i++) {
        await page.keyboard.press('Tab');
        const f = await page.evaluate(() => (document.activeElement && document.activeElement.getAttribute('data-action')) || null);
        if (f && !order.includes(f)) order.push(f);
        if (f === 'gen-where-add') { await page.keyboard.press('Space'); await sleep(250); }
        if (order.includes('gen-build') && order.includes('gen-cancel') && order.includes('gen-where-add')) break;
    }
    const q5b = await page.evaluate(READ);
    let focused = null;
    for (let i = 0; opened && i < 30; i++) {
        focused = await page.evaluate(() => (document.activeElement && document.activeElement.getAttribute('data-action')) || null);
        if (focused === 'gen-cancel') break;
        await page.keyboard.press('Tab');
    }
    if (focused === 'gen-cancel') await page.keyboard.press('Enter');
    await sleep(2500);
    const a5 = await page.evaluate(READ);
    const need = ['gen-where-here', 'gen-where-scan', 'gen-where-add', 'gen-cancel', 'gen-build'];
    check(5, 'keys: Tab reaches every choice, Space picks Add here, Tab to Cancel and Enter keep the course; a named dialog',
        opened && need.every((a) => order.includes(a)) && pressedWhere(q5b) === 'add' && focused === 'gen-cancel' && !a5.dialog && digest(a5) === d4 &&
        q5.dialog.role === 'dialog' && q5.dialog.label === EN['course.gen.title'],
        { opened, order, pressedAfterSpace: pressedWhere(q5b), focused, closed: !a5.dialog, same: digest(a5) === d4, role: q5.dialog && q5.dialog.role, label: q5.dialog && q5.dialog.label });
    await ctx.close();

    // 6 Polish: the texts, the fit, Enter alone builds, Add here offered
    const ctx3 = await newContext();
    const pl = await openPage(ctx3, `${base.replace(/\/en\/?$/, '/pl')}/fly/?scene=${scene}&${PARAMS}`);
    await clickScene(pl);
    await sleep(500);
    await pl.keyboard.press('Shift+KeyG');
    await pl.waitForSelector('[data-testid=gen-dialog]', { timeout: 5000 }).catch(() => 0);
    await sleep(300);
    const q6 = await pl.evaluate(READ);
    const fit6 = await fits(pl);
    await pl.keyboard.press('Enter');
    const s6 = await poll(pl, COURSE_MS, courseUp);
    await sleep(9000);
    await clickScene(pl);
    await sleep(500);
    await pl.keyboard.press('Shift+KeyG');
    await pl.waitForSelector('[data-testid=gen-dialog]', { timeout: 5000 }).catch(() => 0);
    await sleep(300);
    const q6b = await pl.evaluate(READ);
    const plLabels = (s) => (s.dialog ? s.dialog.wheres.map((w) => w.label).join('|') : null);
    check(6, 'polish: Polish title, Here, Whole scan, the hint; it fits; Enter builds; Dodaj tutaj and the replace line over the course',
        !!q6.dialog && q6.dialog.title === PL['course.gen.title'] && plLabels(q6) === `${PL['course.gen.where.here']}|${PL['course.gen.where.scan']}` && q6.dialog.hint === PL['course.gen.whereHint'] &&
        fit6.ok && courseUp(s6) && !!q6b.dialog && plLabels(q6b) === `${PL['course.gen.where.here']}|${PL['course.gen.where.scan']}|${PL['course.gen.where.add']}` &&
        q6b.dialog.replaces === fill(PL['course.gen.replaces'], s6.gates),
        { title: q6.dialog && q6.dialog.title, labels: plLabels(q6), hint: q6.dialog && q6.dialog.hint, fit: fit6, gates: s6.gates, ms: s6.ms, labelsOver: plLabels(q6b), replaces: q6b.dialog && q6b.dialog.replaces });
    await ctx3.close();
} catch (e) { out.fail = String(e).slice(0, 300); console.log('FAIL', out.fail); failed = true; }
const bad = out.steps.filter((q) => !q.pass).map((q) => q.step);
out.verdict = { pass: !failed && bad.length === 0 && out.steps.length === 6, failed: bad };
save();
console.log(JSON.stringify(out.verdict));
await browser.close();
process.exit(out.verdict.pass ? 0 : 1);
