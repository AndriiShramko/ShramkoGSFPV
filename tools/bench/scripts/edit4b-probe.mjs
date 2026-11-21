// Lane edit4b, stage B3 (docs/wip/edit4b.md, design C:/dev/.gsfpv-lanes/designs/edit4.md section 3): the course's life in
// the editor, walked with the MOUSE as the pilot does it. Load the scan, close the Controls screen by a click, click into the
// scene (the pointer lock), take off, Shift+G, wait for the course, Shift+B; then in the edit view:
//   1 open: gate numbers 1..N in the hook and the same numbers on screen
//   2 Course > Delete all gates: the question first, No keeps N gates
//   3 the same, Yes: 0 gates
//   4 Undo: N gates again
//   5 Course > New empty course: the question, Yes: 0 gates, Add gate is on
//   6 two clicks on the floor (Add gate again between them when it went off): 2 gates, labels 1 and 2
//   7 Fly the course: mode fly within 1 s
//   8 Back to editing (the same button): mode edit, the top bar there
//   9 Course > Generate a new course: the question first, No: the gates unchanged
//  10 a sentence naming a gate (a gate put on top of gate 2: the check refuses it): that gate selected, its number flashing,
//     the eye unchanged
//  11 at 844x390: the Course menu and the question inside the view, their crosses 44 px
//   node tools/bench/scripts/edit4b-probe.mjs <address with /en> <scan> <WxH> <device scale> <name> <out.json>
// env: COURSE_MS (wait for the course, default 480000), QUERY (more query, e.g. &render=off), SHOTS (picture folder, default
// U:/Temp/gsfpv-train4/shots; SHOT=0 none). Never presses Save, send, vote or create; on an address that is not localhost
// nothing is stored (the steps only change the course in the page). Headless (tools/bench/src/chrome.mjs pickBrowser); takes
// no GPU lock itself (wrap it). Prints one JSON verdict; exit 1 when a step fails.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pickBrowser } from '../src/chrome.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [base, scan, size, dsfArg, name, outPath] = process.argv.slice(2);
if (!base || !scan || !size || !name || !outPath) {
    console.error('usage: edit4b-probe.mjs <address /en> <scan> <WxH> <dsf> <name> <out.json>');
    process.exit(2);
}
const env = process.env;
const [W, H] = size.split('x').map(Number);
const DSF = Number(dsfArg || 1);
const QUERY = env.QUERY || '';
const SHOTS = env.SHOTS || 'U:/Temp/gsfpv-train4/shots';
const LIVE = !/localhost|127\.0\.0\.1/.test(base);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dist = (a, b) => (a && b ? Math.hypot(...a.map((v, i) => v - (b[i] ?? 0))) : -1);

const SNAP = `(() => {
    const h = window.__gsfpv || {}; const c = h.course || {}; const e = c.editor || {};
    let v = null; try { v = window.__gsfpvEditView ? window.__gsfpvEditView() : null; } catch (x) { v = { err: String(x) }; }
    const b = v && v.edit4 ? v.edit4.b || null : null;
    const shown = (q) => [...document.querySelectorAll(q)].filter((x) => x.getClientRects().length && getComputedStyle(x).visibility !== 'hidden' && getComputedStyle(x).display !== 'none');
    const tb = document.querySelector('.ce-topbar');
    return { open: !!e.open, selected: e.selected ?? null, said: String(e.said || '').slice(0, 200), mode: v && v.mode,
        ids: v && v.course && v.course.gates ? v.course.gates.map((g) => g.id) : null, courseGates: c.gates ?? null, courseOn: !!c.on,
        eye: e.view ? [...e.view.eye, ...e.view.at] : null, wrong: v ? v.wrong : null, b, problems: v && v.course && v.course.problems ? v.course.problems.length : 0,
        windows: shown('.panel, .screen, [aria-modal="true"]').length,
        nums: shown('.cl-num').map((x) => x.textContent.trim()), flash: shown('.cl-num.flash, .cl-edge.flash').map((x) => x.textContent.trim()),
        ask: shown('.life-ask').length, menu: shown('.ce-menu').length, topShown: !!tb && shown('.ce-topbar').length > 0,
        add: (document.querySelector('[data-top="add"]') || { getAttribute: () => null }).getAttribute('aria-pressed'),
        fly: (document.querySelector('[data-top="fly"]') || {}).textContent || null, lock: !!document.pointerLockElement };
})()`;

const res = { address: base, scan, size: [W, H], dsf: DSF, name, query: QUERY, live: LIVE, date: new Date().toISOString(), steps: {}, log: [] };
const fails = [];
function judge(step, ok, why) {
    res.steps[step] = { ok: !!ok, ...why };
    if (!ok) fails.push(step);
}

const pick = pickBrowser({ expected: chromium.executablePath() });
const browser = await chromium.launch({ ...pick.launch, headless: true });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DSF, isMobile: false });
const page = await ctx.newPage();
page.on('pageerror', (e) => res.log.push(`pageerror: ${e.message}`.slice(0, 300)));
const cdp = await ctx.newCDPSession(page);
const snap = () => page.evaluate(SNAP);
async function until(fn, ok, ms, step = 250) {
    const t0 = Date.now();
    let v = await fn();
    while (!ok(v) && Date.now() - t0 < ms) { await sleep(step); v = await fn(); }
    return { ok: ok(v), v, ms: Date.now() - t0 };
}
async function key(code, keyName, { shift = false, hold = 60 } = {}) {
    const vk = code === 'Space' ? 32 : code.slice(3).charCodeAt(0);
    const text = code === 'Space' ? ' ' : shift ? keyName.toUpperCase() : keyName;
    if (shift) await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', code: 'ShiftLeft', key: 'Shift', windowsVirtualKeyCode: 16, modifiers: 8 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', code, key: text, text, unmodifiedText: text, windowsVirtualKeyCode: vk, modifiers: shift ? 8 : 0 });
    await sleep(hold);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code, key: text, windowsVirtualKeyCode: vk, modifiers: shift ? 8 : 0 });
    if (shift) await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'ShiftLeft', key: 'Shift', windowsVirtualKeyCode: 16, modifiers: 0 });
}
const boxOf = (sel) => page.evaluate((s) => {
    const e = document.querySelector(s);
    if (!e || !e.getClientRects().length) return null;
    const b = e.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2, l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height };
}, sel);
/** a click on an element as a person does it (the pointer moves there first); null when it is not on the page */
async function press(sel, after = 500) {
    const b = await boxOf(sel);
    if (!b) return null;
    await page.mouse.move(b.x, b.y, { steps: 4 });
    await page.mouse.click(b.x, b.y);
    await sleep(after);
    return b;
}
async function clickAt(x, y, after = 900) {
    await page.mouse.move(x, y, { steps: 4 });
    await page.mouse.click(x, y);
    await sleep(after);
}
/** Course > item, then the question's answer ('yes' | 'no'); what was seen on the way */
async function courseItem(item, answer) {
    const menu = await press('[data-top="course"]', 400);
    const it = menu ? await press(`.ce-menu [data-item="${item}"]`, 500) : null;
    const asked = await until(snap, (s) => s.ask > 0, 1500);
    const ans = asked.ok ? await press(`.life-ask [data-ask="${answer}"]`, 900) : null;
    return { menu: !!menu, item: !!it, asked: asked.ok, answered: !!ans };
}
const inView = (b) => !!b && b.l >= 0 && b.t >= 0 && b.r <= W2 && b.b <= H2;
let W2 = W;
let H2 = H;

try {
    await page.goto(`${base}/fly/?scene=${scan}&nowarn=1${QUERY}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    const ready = await until(() => page.evaluate(() => window.__gsfpv?.status ?? null), (v) => v === 'ready' || v === 'error', 300000, 1000);
    res.ready = { status: ready.v, ms: ready.ms };
    if (ready.v !== 'ready') throw new Error(`page status ${ready.v}`);
    const KB = '.screen.radio [data-action="radio-keyboard"]';
    await page.waitForSelector(KB, { timeout: 20000 }).catch(() => null);
    await press(KB, 1500);
    await clickAt(W / 2, H / 2, 900);
    res.lock = (await snap()).lock;
    await key('Space', ' ', { hold: 1500 });
    await key('KeyW', 'w', { hold: 600 });
    await key('KeyG', 'g', { shift: true });
    const gen = await until(snap, (s) => (s.courseGates ?? 0) > 0 && s.courseOn, Number(env.COURSE_MS || 480000), 1000);
    res.course = { ok: gen.ok, ms: gen.ms, gates: gen.v.courseGates };
    if (!gen.ok) throw new Error('no course');
    await sleep(1500);
    await key('KeyB', 'b', { shift: true });
    const op = await until(snap, (s) => s.open && s.mode === 'edit', 30000, 400);
    await sleep(1500);
    // the test flight ends by itself only on the pilot's word: a drone still armed is put back by Back to editing
    if (op.v.open && op.v.mode === 'fly') await press('[data-top="fly"]', 1200);

    // 1 open: numbers in the hook and the same on screen
    let s = await until(snap, (x) => x.open && x.mode === 'edit' && (x.b?.numbers?.labels?.length ?? 0) > 0, 4000);
    const N = s.v.ids ? s.v.ids.length : 0;
    const labels = s.v.b?.numbers?.labels ?? [];
    const onScreen = s.v.nums.map(Number).sort((a, b) => a - b);
    judge('1-open-numbers', s.ok && N > 0 && labels.every((n) => n >= 1 && n <= N) && JSON.stringify([...labels].sort((a, b) => a - b)) === JSON.stringify(onScreen),
        { gates: N, labels, onScreen, mode: s.v.mode });
    if (!s.v.open) throw new Error('edit view did not open');
    if (env.SHOT !== '0') {
        mkdirSync(SHOTS, { recursive: true });
        await page.screenshot({ path: join(SHOTS, `edit4b-${name}-numbers.png`) });
    }
    const ids0 = s.v.ids;

    // 2 Delete all, No
    let r = await courseItem('clear', 'no');
    s = await until(snap, (x) => x.ask === 0, 1500);
    judge('2-clear-no', r.asked && s.v.ids?.length === N, { ...r, gates: s.v.ids?.length });
    // 3 Delete all, Yes
    r = await courseItem('clear', 'yes');
    s = await until(snap, (x) => x.ids?.length === 0, 1500);
    judge('3-clear-yes', r.asked && s.ok, { ...r, gates: s.v.ids?.length, said: s.v.said });
    // 4 Undo
    await press('[data-top="undo"]', 600);
    s = await until(snap, (x) => x.ids?.length === N, 1500);
    judge('4-undo', s.ok && JSON.stringify(s.v.ids) === JSON.stringify(ids0), { gates: s.v.ids?.length });
    // 5 New empty course
    r = await courseItem('new', 'yes');
    s = await until(snap, (x) => x.ids?.length === 0 && x.add === 'true', 2000);
    judge('5-new-empty', r.asked && s.ok, { ...r, gates: s.v.ids?.length, addOn: s.v.add, said: s.v.said });
    // 6 two clicks on the floor
    const floor = [[W * 0.42, H * 0.72], [W * 0.58, H * 0.72], [W * 0.5, H * 0.62], [W * 0.5, H * 0.82]];
    const tried = [];
    for (const [x, y] of floor) {
        const n0 = (await snap()).ids?.length ?? 0;
        if (n0 >= 2) break;
        if ((await snap()).add !== 'true') await press('[data-top="add"]', 300);
        await clickAt(x, y, 1500);
        const n1 = (await snap()).ids?.length ?? 0;
        tried.push([Math.round(x), Math.round(y), n1 > n0]);
    }
    s = await until(snap, (x) => x.ids?.length === 2 && JSON.stringify(x.b?.numbers?.labels?.slice().sort()) === '[1,2]', 3000);
    judge('6-two-gates', s.ok, { gates: s.v.ids?.length, labels: s.v.b?.numbers?.labels, onScreen: s.v.nums, tried });
    const gate2At = tried.filter((x) => x[2])[1] ?? null;
    // 7 Fly the course
    await press('[data-top="fly"]', 0);
    s = await until(snap, (x) => x.mode === 'fly', 1000, 100);
    judge('7-fly', s.ok, { ms: s.ms, mode: s.v.mode, button: s.v.fly });
    await sleep(800);
    // 8 Back to editing
    await press('[data-top="fly"]', 0);
    s = await until(snap, (x) => x.mode === 'edit' && x.topShown, 2000, 100);
    judge('8-back', s.ok, { ms: s.ms, mode: s.v.mode, top: s.v.topShown, button: s.v.fly });
    await sleep(600);
    // 9 Generate: the question first, No keeps the gates
    const ids9 = (await snap()).ids;
    r = await courseItem('generate', 'no');
    await sleep(800);
    s = await snap();
    judge('9-generate-no', r.asked && JSON.stringify(s.ids) === JSON.stringify(ids9), { ...r, gates: s.ids?.length });
    // 10 a sentence naming a gate: that gate is pointed at. The eye first comes to rest (the view eases back after the flight).
    // On localhost: Save, refused while a gate has a problem (a floor gate in a wall: the check's gateWall), sends nothing
    // then; on another address Save is never pressed: a gate put on top of gate 2 instead (the check may refuse it).
    const eyeRest = () => {
        let prevEye = null;
        return until(async () => { const a = (await snap()).eye; const d = dist(a, prevEye); prevEye = a; return d; }, (d) => d >= 0 && d < 0.001, 6000, 400);
    };
    let rest = await eyeRest();
    // int4 (car 1's live run failed here): on the live site Save is never pressed, so a course that already has a problem
    // (gate 1 of step 6 in a wall) left this step nothing to judge. There Undo takes gates back until no gate has a problem,
    // then the add below makes the sentence that names a gate.
    const undone = [];
    for (let i = 0; LIVE && i < 4 && (await snap()).problems > 0; i++) {
        await press('[data-top="undo"]', 300);
        rest = await eyeRest();
        const u = await snap();
        undone.push({ gates: u.ids?.length ?? null, problems: u.problems });
    }
    if (undone.length > 0) res.log.push(`live: ${undone.length} undo before step 10 (a gate in a wall)`);
    const before = await snap();
    const e10 = before.eye;
    // a floor gate the check refuses (gate 1 of step 6 stood in a wall there); an accepted one is undone and the next spot tried
    const spots = [...tried.map((x) => [x[0], x[1]]), [W * 0.15, H * 0.85], [W * 0.85, H * 0.85], [W * 0.3, H * 0.55], [W * 0.7, H * 0.55], [W * 0.5, H * 0.5], [W * 0.1, H * 0.6], [W * 0.9, H * 0.6]];
    let seen = { ok: false, v: before };
    const how = [];
    // a course that already has a problem (gate 1 of step 6 often stands in a wall) goes straight to Save
    for (const [x, y] of before.problems > 0 ? [] : spots) {
        const s0 = await snap();
        if (s0.add !== 'true') await press('[data-top="add"]', 300);
        const wrongBefore = JSON.stringify(s0.wrong);
        await clickAt(x, y, 0);
        seen = await until(snap, (v) => JSON.stringify(v.wrong) !== wrongBefore && !!v.b?.pointed && v.flash.length > 0, 3000, 100);
        const eyeAdd = dist(seen.v.eye, s0.eye);
        if (seen.ok) {
            await sleep(1500);
            how.push({ at: [Math.round(x), Math.round(y)], pointed: true, eyeAdd: Math.round(eyeAdd * 1000) / 1000, eyeLater: Math.round(dist((await snap()).eye, seen.v.eye) * 1000) / 1000 });
            break;
        }
        const undo = (await snap()).ids.length > s0.ids.length;
        // Undo frames the gate it selects (review ED-1, a glide): the next add waits for the eye to come to rest
        if (undo) { await press('[data-top="undo"]', 300); await eyeRest(); }
        how.push({ at: [Math.round(x), Math.round(y)], pointed: false, eyeAdd: Math.round(eyeAdd * 1000) / 1000, undo, eyeUndo: Math.round(dist((await snap()).eye, seen.v.eye) * 1000) / 1000 });
    }
    const p = seen.v;
    const w = p.wrong;
    const n = w ? String(w.index + 1) : '?';
    // a gate just added is framed by the hub itself (train 3 I1, D1: a new selection frames it), so the eye is judged on the
    // second sentence: the eye at rest, then Save, refused while that gate stands in a wall (nothing is sent then)
    const refused = seen.ok && p.b.pointed.index === w.index && p.selected === w.index && p.flash.some((f) => f.includes(n));
    let save = null;
    if ((refused || before.problems > 0) && !LIVE && (await snap()).problems > 0) {
        if ((await boxOf('.cl-num, .cl-edge')) === null) res.log.push('no label before Save');
        // the top bar's Save opens the window's save part at the name; Save mine there asks first (course.ts saveMine:
        // a gate in a wall is a warning -> the Save dialog, lane n-save) and sends nothing until it is answered
        await press('[data-top="save"]', 600);
        const nameBox = await press('.ce-name', 200);
        if (nameBox) await page.keyboard.type('probe', { delay: 30 });
        await eyeRest();
        const b = await snap();
        await press('.ce-save-mine', 0);
        let got = await until(async () => ({ v: await snap(), offer: await boxOf('.course-editor [data-testid="save-show-me"]') }), (x) => (x.v.said !== b.said && x.v.flash.length > 0) || !!x.offer, 8000, 100);
        // lane n-save: a Save with warnings opens the dialog (save-warnings); its Show me (save-show-me) is the
        // pilot's way to the named gate (course.ts showMe -> showWrong), so the probe presses it by its id
        const offered = !!got.v.offer && got.v.v.flash.length === 0;
        if (offered) await press('.course-editor [data-testid="save-show-me"]', 0);
        got = await until(snap, (v) => v.said !== b.said && v.flash.length > 0, 3000, 100);
        if (offered) res.log.push('save dialog: Show me pressed');
        await sleep(1500);
        const later = await snap();
        save = { said: got.v.said, flash: got.v.flash, pointed: got.v.b?.pointed ?? null, selected: got.v.selected, wrong: got.v.wrong, eyeMoved: Math.round(dist(later.eye, b.eye) * 1000) / 1000, nameAsked: later.windows };
        const wi = save.wrong ? save.wrong.index : -2;
        save.ok = got.ok && save.pointed?.index === wi && save.selected === wi && save.flash.some((f) => f.includes(String(wi + 1))) && save.eyeMoved < 0.01;
    }
    // on the live site Save is never pressed: the refused floor gate's pointing is judged there
    judge('10-pointed', LIVE ? refused : !!save?.ok,
        { how, eyeRest: rest.ok, wrong: w ?? null, pointed: p.b?.pointed ?? null, selected: p.selected, flash: p.flash, problems: p.problems, said: p.said, save });

    // 12 (the independent check's step): Esc closes the thing that is open first. Esc on the open Course menu closes the
    // menu only; on the question Delete changes nothing and Esc answers No; the edit view stays open with every gate (the
    // editor's own Esc would leave it, or after a warning drop the unsaved gates)
    {
        const a = await snap();
        await press('[data-top="course"]', 400);
        const menuOpen = (await snap()).menu > 0;
        await page.keyboard.press('Escape');
        await sleep(500);
        const m = await snap();
        await press('[data-top="course"]', 400);
        await press('.ce-menu [data-item="clear"]', 500);
        const asked = await until(snap, (x) => x.ask > 0, 1500);
        await page.keyboard.press('Delete');
        await sleep(300);
        await page.keyboard.press('Escape');
        await sleep(600);
        const q = await snap();
        judge('12-esc-closes-first', menuOpen && m.menu === 0 && m.open && m.mode === 'edit' && asked.ok && q.ask === 0 && q.open
            && JSON.stringify(q.ids) === JSON.stringify(a.ids),
            { menuOpen, menuEsc: { menu: m.menu, open: m.open, said: m.said }, asked: asked.ok, askEsc: { ask: q.ask, open: q.open, gates: q.ids?.length ?? null, said: q.said }, gates0: a.ids?.length ?? null });
    }

    // 11 at 844x390: the menu and the question inside the view, crosses 44 px
    W2 = 844; H2 = 390;
    await page.setViewportSize({ width: W2, height: H2 });
    await sleep(1200);
    await press('[data-top="course"]', 400);
    const menuBox = await boxOf('.ce-menu');
    const menuX = await boxOf('.ce-menu .ce-menu-x');
    await press('.ce-menu [data-item="generate"]', 500);
    const askBox = await boxOf('.life-ask');
    const askX = await boxOf('.life-ask [data-ask="close"]');
    await press('.life-ask [data-ask="close"]', 500);
    const after = await snap();
    const big = (b) => !!b && b.w >= 44 && b.h >= 44;
    judge('11-small-view', inView(menuBox) && inView(askBox) && big(menuX) && big(askX) && after.ask === 0,
        { menuBox, menuX, askBox, askX, closed: after.ask === 0 });
} catch (e) {
    res.error = String(e && e.message ? e.message : e).slice(0, 300);
    fails.push('run');
}
await browser.close();
res.fails = fails;
res.verdict = fails.length ? 'FAIL' : 'PASS';
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(res, null, 1));
console.log(JSON.stringify({ name, address: base, verdict: res.verdict, steps: Object.fromEntries(Object.entries(res.steps).map(([k, v]) => [k, v.ok ? 'PASS' : 'FAIL'])), error: res.error ?? null }));
process.exit(fails.length ? 1 : 0);
