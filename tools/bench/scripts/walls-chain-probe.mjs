// Walls W3 page probe: on a scan without walls one press of Shift+G brings the walls (published at once, else the
// build here with its progress line), then the course, then a gate is drawn. Measures the time from the key to the
// first drawn gate and keeps every line the pilot saw on the way (the walls box and the HUD note).
//   node tools/bench/scripts/walls-chain-probe.mjs http://localhost:5800/en <out.json> <id>:<w>x<h>:<shot name>[,...]
// Headless; takes no GPU lock itself (wrap it). Presses only Shift+G: nothing is sent or saved.
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { pickBrowser } from '../src/chrome.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [base, outFile, casesArg] = process.argv.slice(2);
if (!base || !outFile || !casesArg) { console.error('usage: walls-chain-probe.mjs <base with /en> <out.json> <id>:<w>x<h>:<shot>[,...]'); process.exit(2); }
const cases = casesArg.split(',').map((s) => {
    const [id, size, shot] = s.split(':');
    const [w, h] = size.split('x').map(Number);
    return { id, w, h, shot };
});
const SHOTS = 'U:/Temp/gsfpv-train2/shots';
const LIMIT_MS = 300_000;
const pick = pickBrowser({ expected: chromium.executablePath() });
const browser = await chromium.launch({ ...pick.launch, headless: true });

// in-page code as plain functions of this .mjs (the page's CSP forbids strings to eval)
const READ = () => {
    const g = window.__gsfpv || {};
    const w = g.walls;
    const c = g.course;
    const box = document.querySelector('[data-testid=walls-box]');
    const q = (s) => { const e = document.querySelector(s); return e ? (e.textContent || '').trim().slice(0, 200) : null; };
    const note = document.querySelector('.hud-note');
    return {
        status: g.status,
        walls: w ? { state: w.state, source: w.source, voxelM: w.voxelM, lastBake: w.lastBake || null } : null,
        course: c ? { gates: c.gates, drawn: c.drawn, source: c.source, problem: c.problem, on: c.on } : null,
        boxShown: !!box && getComputedStyle(box).display !== 'none' && getComputedStyle(box).visibility !== 'hidden',
        boxKeep: !!box && box.classList.contains('keep'),
        flying: document.getElementById('ui')?.classList.contains('hud-flying') ?? null,
        line: q('[data-testid=bake-status]'), action: q('[data-testid=walls-box] button'),
        note: note && !note.hidden ? (note.textContent || '').trim().slice(0, 200) : null
    };
};

const out = [];
let failed = 0;
for (const c of cases) {
    const ctx = await browser.newContext({ viewport: { width: c.w, height: c.h } });
    const page = await ctx.newPage();
    const r = { id: c.id, viewport: `${c.w}x${c.h}`, errors: [], lines: [], notes: [], wallsFiles: [] };
    page.on('pageerror', (e) => r.errors.push(String(e.message).slice(0, 160)));
    page.on('response', (res) => {
        const u = new URL(res.url());
        if (u.pathname.startsWith('/walls/')) r.wallsFiles.push(`${u.pathname} ${res.status()}`);
    });
    try {
        await page.goto(`${base}/fly/?scene=${c.id}&nowarn=1&set.input.howToFly=false`, { waitUntil: 'load', timeout: 120000 });
        await page.waitForFunction(() => ['ready', 'error'].includes(window.__gsfpv && window.__gsfpv.status), null, { timeout: 240000 });
        await page.waitForFunction(() => { const w = window.__gsfpv && window.__gsfpv.walls; return w && w.state !== 'checking'; }, null, { timeout: 60000 }).catch(() => 0);
        await page.waitForTimeout(2000);
        // the Controls screen holds the keys: close it with its x, as a pilot does; the walls box must show then
        const x = page.locator('.screen.radio [data-action=radio-close]');
        if (await x.count()) { await x.first().click(); await page.waitForTimeout(800); }
        r.before = await page.evaluate(READ);
        r.controlsOpenAfter = await page.evaluate(() => !!document.querySelector('.screen.radio'));
        if (r.before.walls?.state === 'offer') await page.screenshot({ path: `${SHOTS}/${c.shot.replace('.png', '-offer.png')}` });
        const t0 = Date.now();
        await page.keyboard.press('Shift+KeyG');
        let shotBuild = false;
        for (;;) {
            const s = await page.evaluate(READ);
            const at = (Date.now() - t0) / 1000;
            if (s.line && r.lines.at(-1)?.text !== s.line) r.lines.push({ at, text: s.line });
            if (s.note && r.notes.at(-1)?.text !== s.note) r.notes.push({ at, text: s.note });
            if (s.walls?.state === 'baking' && !shotBuild) {
                shotBuild = true;
                r.duringBuild = s;
                await page.screenshot({ path: `${SHOTS}/${c.shot.replace('.png', '-build.png')}` });
            }
            if (r.wallsInS === undefined && s.walls?.state === 'in-use') r.wallsInS = at;
            if (s.course && s.course.gates > 0 && s.course.drawn > 0) { r.firstGateS = at; break; }
            if (s.course?.problem && s.course.problem !== 'none' && at > 1 && s.walls?.state !== 'baking') { r.problemSeen = s.course.problem; }
            if (Date.now() - t0 > LIMIT_MS) { r.fail = 'timeout'; break; }
            await page.waitForTimeout(250);
        }
        await page.waitForTimeout(1500);
        r.after = await page.evaluate(READ);
        await page.screenshot({ path: `${SHOTS}/${c.shot}` });
    } catch (e) { r.fail = String(e).slice(0, 200); try { r.after = await page.evaluate(READ); } catch { /* page gone */ } }
    const all = [...r.lines, ...r.notes].map((x) => x.text).join(' | ');
    r.saidMissing = /no walls|without walls|cannot|could not/i.test(all);
    r.pass = !r.fail && r.firstGateS > 0 && r.after?.walls?.state === 'in-use' && !r.saidMissing && r.errors.length === 0;
    if (!r.pass) failed++;
    out.push(r);
    await ctx.close();
}
await browser.close();
writeFileSync(outFile, JSON.stringify(out, null, 1));
for (const r of out) console.log(JSON.stringify({ id: r.id, vp: r.viewport, pass: r.pass, firstGateS: r.firstGateS, wallsInS: r.wallsInS, source: r.after?.walls?.source, gates: r.after?.course?.gates, drawn: r.after?.course?.drawn, boxDuringBuild: r.duringBuild ? { shown: r.duringBuild.boxShown, keep: r.duringBuild.boxKeep } : null, saidMissing: r.saidMissing, errors: r.errors.length, fail: r.fail }));
process.exit(failed ? 1 : 0);
