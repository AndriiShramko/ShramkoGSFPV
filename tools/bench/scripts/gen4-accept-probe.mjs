// Lane gen4b, stage B3 (design gen4.md section 6): the pilot's own path to a generated course, with the MOUSE, at 1536x730
// with device scale 1.25. The pointer lock first (a click into the scene), then Escape, the pause menu's 'Course: a new random
// course', the 'Generate a course' dialog (Beginner, Compact, Build), the progress box until the course is there, the line
// where the start gate is, the dialog again (Cancel keeps the course, Replace makes a new one), the same dialog at 844x390,
// and the scan of Lublin (2f1ddf5f) for the ground rule.
// Steps (each {step, name, pass, detail}):
//   1 open the scene at Scene size x1      2 menu -> dialog visible, inside the viewport, its cross 44 px, no course built
//   3 click Beginner, Compact, Build       4 progress box: font >= 16 px, in view, percent never back, there until the answer
//   5 course shown: gates >= 1, the plan's stats outside 0, closed   6 the start line visible >= 8 s (or the craft at gate 1)
//   7 dialog again: 'Replaces' line; Cancel -> same course            8 again -> Replace -> a new course
//   9 Lublin: stats underGround 0, nearGroundShare <= 0.2 (pass null when the stats are not measured: planCourse stub)
//  10 the dialog at 844x390: no two of its parts overlap, all inside the viewport, every button >= 44 px
//  11 (the review's step, run between 8 and 10) in flight Shift+G, Tab to Cancel, Enter: the dialog closes, nothing is built
// Usage: node tools/bench/scripts/gen4-accept-probe.mjs <base with /en> <out.json> [scene 5dfeb49b] [lublin 2f1ddf5f]
// env: RENDER=on draws (hold the GPU lock C:/dev/.gpu-lock around the run), STEPS=6 stops after that step, SHOT=<png> one
// picture after step 6. Nothing is saved or sent: no save button is pressed; a generated course lives only in the tab.
// Exit 1 when a step fails.
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { pickBrowser } from '../src/chrome.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [base, outFile, scene = '5dfeb49b', lublin = '2f1ddf5f'] = process.argv.slice(2);
if (!base || !outFile) { console.error('usage: gen4-accept-probe.mjs <base with /en> <out.json> [scene] [lublin]'); process.exit(2); }
const RENDER = process.env.RENDER === 'on';
const LAST = Number(process.env.STEPS ?? 10);
const COURSE_MS = Number(process.env.COURSE_MS ?? 240000);
const pick = pickBrowser({ expected: chromium.executablePath() });
const browser = await chromium.launch({ ...pick.launch, headless: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = { base, scene, lublin, render: RENDER, viewport: '1536x730@1.25', steps: [], errors: [] };
const save = () => writeFileSync(outFile, JSON.stringify(out, null, 1));
const check = (step, name, pass, detail) => {
    out.steps.push({ step, name, pass, detail });
    console.log(`${step} ${name} ${pass === null ? 'PENDING' : pass ? 'PASS' : 'FAIL'} ${JSON.stringify(detail).slice(0, 300)}`);
    save();
};

/** In the page: the course, the dialog, the box, the note, the pointer lock, as they are now. */
const READ = () => {
    const g = window.__gsfpv || {};
    const c = g.course;
    const r = (el) => { if (!el || el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
    const dlg = document.querySelector('[data-testid=gen-dialog]');
    const box = document.querySelector('[data-testid=gen-progress]');
    const note = document.querySelector('.hud-note');
    let poses = [];
    try { poses = c && c.gatePoses ? c.gatePoses() : []; } catch { poses = []; }
    let bm = null;
    try { bm = c && c.box ? c.box() : null; } catch { bm = null; }
    return {
        W: innerWidth, H: innerHeight, lock: !!document.pointerLockElement,
        gates: c ? c.gates : 0, drawn: c ? c.drawn : 0, seed: c ? c.seed : null,
        digest: (c ? c.seed : '') + ':' + poses.map((p) => p.pos.map((v) => v.toFixed(2)).join(',')).join(';'),
        plan: c ? c.plan ?? null : null, startLine: c ? c.startLine ?? null : null, request: c ? c.request ?? null : null,
        dialog: dlg ? { rect: r(dlg), x: r(dlg.querySelector('.panel-x')), replaces: (dlg.querySelector('[data-testid=gen-replaces]') || {}).textContent || null } : null,
        box: box ? { rect: r(box), font: parseFloat(getComputedStyle(box).fontSize), model: bm } : null,
        note: note && !note.hidden && note.offsetParent !== null ? (note.textContent || '').trim().slice(0, 160) : null,
        scale: g.scale ? (typeof g.scale.size === 'function' ? g.scale.size() : g.scale.size) : null
    };
};

/** In the page: every leaf part of the dialog (texts and buttons) with its rect, for the overlap rule of step 10. */
const PARTS = () => {
    const dlg = document.querySelector('[data-testid=gen-dialog]');
    if (!dlg) return null;
    const rect = (el) => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; };
    const parts = Array.from(dlg.querySelectorAll('button, h2, p')).filter((el) => el.offsetParent !== null).map((el) => ({ tag: el.tagName.toLowerCase(), act: el.getAttribute('data-action'), text: (el.textContent || '').trim().slice(0, 40), ...rect(el) }));
    return { W: innerWidth, H: innerHeight, dialog: rect(dlg), scrolls: dlg.scrollHeight > dlg.clientHeight + 1, parts };
};

const inView = (b, W, H) => !!b && b.x >= 0 && b.y >= 0 && b.x + b.w <= W + 0.5 && b.y + b.h <= H + 0.5;
const overlap = (a, b) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 0.5 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 0.5;

async function openPage(id, width = 1536, height = 730) {
    const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1.25 });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => out.errors.push(`${id}: ${String(e.message).slice(0, 160)}`));
    await page.goto(`${base}/fly/?scene=${id}&nowarn=1&set.input.howToFly=false&set.input.play=easy${RENDER ? '' : '&render=off'}`, { waitUntil: 'load', timeout: 120000 });
    await page.waitForFunction(() => ['ready', 'error'].includes(window.__gsfpv && window.__gsfpv.status), null, { timeout: 300000 });
    // the Controls screen: closed by a click, as a person does
    const kb = await page.waitForSelector('.screen.radio [data-action=radio-keyboard]', { timeout: 6000 }).then(() => true, () => false);
    if (kb) await page.locator('[data-action=radio-keyboard]').click();
    else { const x = page.locator('.screen.radio [data-action=radio-close]'); if (await x.count()) await x.first().click(); }
    await page.waitForFunction(() => !document.querySelector('.screen.radio'), null, { timeout: 15000 }).catch(() => 0);
    await page.waitForFunction(() => { const w = window.__gsfpv && window.__gsfpv.walls; return !w || w.state !== 'checking'; }, null, { timeout: 120000 }).catch(() => 0);
    await page.waitForFunction(() => !!(window.__gsfpv && window.__gsfpv.session && window.__gsfpv.session.baseCollision), null, { timeout: 180000 }).catch(() => 0);
    await sleep(1000);
    return { ctx, page };
}

/** the mouse path to the dialog: a click into the scene (pointer lock), Escape, the menu's course item */
async function openDialog(page) {
    const v = page.viewportSize();
    await page.mouse.click(Math.round(v.width / 2), Math.round(v.height * 0.6));
    await sleep(500);
    const lock = await page.evaluate(() => !!document.pointerLockElement);
    await page.keyboard.press('Escape');
    const menu = await page.waitForSelector('.pause-menu', { timeout: 8000 }).then(() => true, () => false);
    if (!menu) return { lock, menu, item: false };
    const item = page.locator('.pause-menu [data-action="pause.course"]');
    const has = (await item.count()) > 0;
    if (has) await item.first().click();
    await page.waitForSelector('[data-testid=gen-dialog]', { timeout: 4000 }).catch(() => 0);
    await sleep(300);
    return { lock, menu, item: has };
}

/** clicks a dialog button by its data-action; false when the dialog or the button is not there */
async function press(page, act) {
    const b = page.locator(`[data-testid=gen-dialog] [data-action="${act}"]`);
    if (!(await b.count())) return false;
    await b.first().click();
    await sleep(250);
    return true;
}

/** polls every 100 ms until `ok`, returns the samples */
async function poll(page, ms, ok) {
    const t0 = Date.now(), samples = [];
    for (;;) {
        const s = await page.evaluate(READ);
        samples.push({ t: Date.now() - t0, at: Date.now(), ...s });
        if (ok(s) || Date.now() - t0 > ms) return samples;
        await sleep(100);
    }
}

const courseUp = (s) => s.gates > 0 && s.drawn > 0;

try {
    // 1 the scene at Scene size x1
    const { ctx, page } = await openPage(scene);
    let s = await page.evaluate(READ);
    check(1, 'open the scene at x1', (await page.evaluate(() => window.__gsfpv.status)) === 'ready' && (s.scale === null || s.scale === 1), { scale: s.scale, gates: s.gates });

    // 2 the menu's item opens the dialog, nothing is built
    const how = await openDialog(page);
    await sleep(1500);
    s = await page.evaluate(READ);
    const x = s.dialog && s.dialog.x;
    check(2, 'menu -> dialog in view, cross 44 px, nothing built', !!s.dialog && inView(s.dialog.rect, s.W, s.H) && !!x && x.w >= 44 && x.h >= 44 && s.gates === 0, { how, dialog: s.dialog, gates: s.gates, W: s.W, H: s.H });

    // 3 Beginner, Compact, Build
    const p3 = [await press(page, 'gen-level-beginner'), await press(page, 'gen-spread-compact')];
    p3.push(await press(page, 'gen-build'));
    const after3 = await page.evaluate(READ);
    check(3, 'click Beginner, Compact, Build', p3.every(Boolean) && !after3.dialog, { pressed: p3, dialogGone: !after3.dialog, request: after3.request });

    // 4 the progress box until the course is there
    const noRoom = (q) => !!(q.box && q.box.model && q.box.model.kind === 'noRoom');
    const samples = await poll(page, COURSE_MS, (q) => courseUp(q) || noRoom(q));
    const pre = samples.filter((q) => !courseUp(q) && !noRoom(q));
    const withBox = pre.filter((q) => q.box && q.box.model && q.box.model.kind === 'progress');
    const pcts = withBox.map((q) => q.box.model.pct);
    const mono = pcts.every((p, i) => i === 0 || p >= pcts[i - 1]);
    const fonts = withBox.map((q) => q.box.font);
    const views = withBox.every((q) => inView(q.box.rect, q.W, q.H));
    const steps = [...new Set(withBox.map((q) => q.box.model.step))];
    const lastPre = pre[pre.length - 1];
    check(4, 'progress box: 16 px, in view, never back, until the answer', pre.length > 0 && withBox.length === pre.length && mono && fonts.every((f) => f >= 16) && views,
        { samples: pre.length, withBox: withBox.length, pcts: pcts.filter((p, i) => i === 0 || p !== pcts[i - 1]).slice(0, 30), minFont: Math.min(...fonts), inView: views, steps, lastText: lastPre && lastPre.box ? lastPre.box.model : null, ms: samples[samples.length - 1].t });

    // 5 the course is shown, inside, closed
    s = samples[samples.length - 1];
    const st = s.plan && s.plan.ok ? s.plan.stats : null;
    check(5, 'course shown: gates >= 1, outside 0, closed', courseUp(s) && !!st && st.outside === 0 && st.closed === true, { gates: s.gates, drawn: s.drawn, plan: s.plan });

    if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
    // 6 the start line stays >= 8 s (or the craft is at the start gate)
    const line = s.startLine;
    const seen = await poll(page, 9000, (q) => !q.note || !line || !q.note.includes(line.slice(0, 20)));
    const shown = seen.filter((q) => q.note && line && q.note.includes(line.slice(0, 20)));
    const upAt = samples[samples.length - 1].at; // the course (and its line) appeared at the last sample of step 4
    const shownMs = shown.length ? shown[shown.length - 1].at - upAt : 0;
    check(6, 'start line visible >= 8 s', !!line && shownMs >= 7900, { line, shownMs, lastNote: seen[seen.length - 1].note });

    if (LAST >= 7) {
        // 7 the dialog again: the replace line; Cancel keeps the course
        const d7 = s.digest;
        await openDialog(page);
        const q7 = await page.evaluate(READ);
        const cancelled = await press(page, 'gen-cancel');
        await sleep(2500);
        const a7 = await page.evaluate(READ);
        check(7, "dialog again: 'Replaces' line, Cancel keeps the course", !!q7.dialog && !!q7.dialog.replaces && cancelled && !a7.dialog && a7.digest === d7 && a7.gates > 0, { replaces: q7.dialog && q7.dialog.replaces, cancelled, same: a7.digest === d7, gates: a7.gates });

        // 8 again: Replace makes a new course
        await openDialog(page);
        const built = await press(page, 'gen-build');
        const s8 = await poll(page, COURSE_MS, (q) => q.digest !== d7 && courseUp(q));
        const a8 = s8[s8.length - 1];
        check(8, 'again: Replace -> a new course', built && a8.digest !== d7 && courseUp(a8), { built, seed: [s.seed, a8.seed], gates: a8.gates, ms: a8.t });

        // 11 (the review's step): in flight Shift+G, then the keyboard as a person without a mouse: Tab to Cancel, Enter.
        // Enter on the focused Cancel must cancel (the course stays), never build over it
        await sleep(9000); // the start line of step 8 goes
        const v11 = page.viewportSize();
        await page.mouse.click(Math.round(v11.width / 2), Math.round(v11.height * 0.6));
        await sleep(500);
        await page.keyboard.press('Shift+KeyG');
        const opened = await page.waitForSelector('[data-testid=gen-dialog]', { timeout: 4000 }).then(() => true, () => false);
        let focused = null;
        for (let i = 0; opened && i < 40; i++) {
            await page.keyboard.press('Tab');
            focused = await page.evaluate(() => (document.activeElement && document.activeElement.getAttribute('data-action')) || null);
            if (focused === 'gen-cancel') break;
        }
        if (focused === 'gen-cancel') await page.keyboard.press('Enter');
        await sleep(2500);
        const a11 = await page.evaluate(READ);
        check(11, 'Shift+G, Tab to Cancel, Enter: nothing replaced', opened && focused === 'gen-cancel' && !a11.dialog && a11.digest === a8.digest && !(a11.box && a11.box.model),
            { opened, focused, dialogGone: !a11.dialog, same: a11.digest === a8.digest, box: a11.box && a11.box.model ? a11.box.model.kind : null });
        if (a11.dialog) await press(page, 'gen-x');

        // 10 the dialog at 844x390 (a phone held across)
        await page.setViewportSize({ width: 844, height: 390 });
        await sleep(800);
        await openDialog(page);
        const pp = await page.evaluate(PARTS);
        let bad = [];
        if (pp) {
            for (let i = 0; i < pp.parts.length; i++) for (let j = i + 1; j < pp.parts.length; j++) if (overlap(pp.parts[i], pp.parts[j])) bad.push([pp.parts[i].act || pp.parts[i].text, pp.parts[j].act || pp.parts[j].text]);
        }
        const outside = pp ? pp.parts.filter((q) => !inView(q, pp.W, pp.H)).map((q) => q.act || q.text) : [];
        const small = pp ? pp.parts.filter((q) => q.tag === 'button' && (q.w < 44 || q.h < 44)).map((q) => `${q.act} ${Math.round(q.w)}x${Math.round(q.h)}`) : [];
        check(10, 'dialog at 844x390: no overlap, in view, buttons >= 44 px', !!pp && bad.length === 0 && outside.length === 0 && small.length === 0, { parts: pp ? pp.parts.length : 0, dialog: pp && pp.dialog, scrolls: pp && pp.scrolls, overlaps: bad.slice(0, 6), outside, small });
        await press(page, 'gen-x');
    }
    await ctx.close();

    if (LAST >= 9) {
        // 9 Lublin: the ground rule
        const l = await openPage(lublin);
        await openDialog(l.page);
        const built = await press(l.page, 'gen-build');
        const s9 = await poll(l.page, COURSE_MS, (q) => courseUp(q) || (q.box && q.box.model && q.box.model.kind === 'noRoom'));
        const a9 = s9[s9.length - 1];
        const st9 = a9.plan && a9.plan.ok ? a9.plan.stats : null;
        const measured = !!st9 && (st9.goodShare > 0 || st9.openingM > 0 || st9.kind !== 'unknown');
        check(9, 'Lublin: underGround 0, nearGroundShare <= 0.2', !built || !courseUp(a9) || !st9 ? false : measured ? st9.underGround === 0 && st9.nearGroundShare <= 0.2 : null,
            { built, gates: a9.gates, stats: st9, measured, note: measured ? null : 'planCourse answers zero stats (the gen4a stub on this tree): judged on the merged train' });
        await l.ctx.close();
    }
} catch (e) { out.fail = String(e).slice(0, 300); console.log('FAIL', out.fail); }
const failed = out.steps.filter((q) => q.pass === false).map((q) => q.step);
out.verdict = { pass: !out.fail && failed.length === 0, failed, pending: out.steps.filter((q) => q.pass === null).map((q) => q.step) };
save();
console.log(JSON.stringify(out.verdict));
await browser.close();
process.exit(out.verdict.pass ? 0 : 1);
