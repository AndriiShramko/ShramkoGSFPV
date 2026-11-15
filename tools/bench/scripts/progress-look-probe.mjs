// Stage G1-progress page probe: one press of Shift+G on a scan, then every 500 ms the progress lines the pilot reads:
// the walls build (hook walls.progress and the walls box line [data-testid=bake-status]) and the course generation
// (hook course.progress and the HUD note). Keeps every distinct line with its time and the longest time the shown
// text did not change while a build or a generation ran (the "never silent for more than two seconds" rule).
//   node tools/bench/scripts/progress-look-probe.mjs http://localhost:5720/en <out.json> <shots dir> <id>[,<id>...]
// Headless; takes no GPU lock itself (wrap it). Presses only Shift+G: nothing is sent or saved.
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { pickBrowser } from '../src/chrome.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [base, outFile, shots, idsArg] = process.argv.slice(2);
if (!base || !outFile || !shots || !idsArg) { console.error('usage: progress-look-probe.mjs <base with /en> <out.json> <shots dir> <id>[,...]'); process.exit(2); }
const LIMIT_MS = 600_000;
const pick = pickBrowser({ expected: chromium.executablePath() });
const browser = await chromium.launch({ ...pick.launch, headless: true });

const READ = () => {
    const g = window.__gsfpv || {};
    const w = g.walls;
    const c = g.course;
    const q = (s) => { const e = document.querySelector(s); return e ? (e.textContent || '').trim().slice(0, 240) : null; };
    const note = document.querySelector('.hud-note');
    // CR-2: the moving bar of the walls box (shown, and its compositor animation running)
    const busy = document.querySelector('[data-testid=walls-busy]');
    const anim = busy && busy.firstElementChild && busy.firstElementChild.getAnimations ? busy.firstElementChild.getAnimations() : [];
    return {
        bar: busy && !busy.hidden ? (anim.length && anim[0].playState === 'running' ? 'moving' : 'shown') : null,
        status: g.status,
        wallsState: w ? w.state : null, wallsSource: w ? w.source : null, wallsProgress: w ? w.progress : null,
        courseProgress: c ? (c.progress ?? null) : null, gates: c ? c.gates : 0, drawn: c ? c.drawn : 0, problem: c ? c.problem : null,
        box: q('[data-testid=bake-status]'),
        note: note && !note.hidden ? (note.textContent || '').trim().slice(0, 240) : null
    };
};

const out = [];
for (const id of idsArg.split(',')) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    const r = { id, errors: [], walls: [], course: [], box: [], notes: [], bar: [] };
    page.on('pageerror', (e) => r.errors.push(String(e.message).slice(0, 160)));
    try {
        await page.goto(`${base}/fly/?scene=${id}&nowarn=1&set.input.howToFly=false`, { waitUntil: 'load', timeout: 120000 });
        await page.waitForFunction(() => ['ready', 'error'].includes(window.__gsfpv && window.__gsfpv.status), null, { timeout: 300000 });
        await page.waitForFunction(() => { const w = window.__gsfpv && window.__gsfpv.walls; return w && w.state !== 'checking'; }, null, { timeout: 60000 }).catch(() => 0);
        await page.waitForTimeout(2000);
        const x = page.locator('.screen.radio [data-action=radio-close]');
        if (await x.count()) { await x.first().click(); await page.waitForTimeout(800); }
        r.before = await page.evaluate(READ);
        const t0 = Date.now();
        await page.keyboard.press('Shift+KeyG');
        let shotWalls = false, shotCourse = false, lastShown = null, lastChange = 0, busySince = null;
        r.maxSilentS = 0;
        for (;;) {
            const s = await page.evaluate(READ);
            const at = (Date.now() - t0) / 1000;
            const add = (arr, text) => { if (text && arr.at(-1)?.text !== text) arr.push({ at, text }); };
            add(r.walls, s.wallsProgress); add(r.course, s.courseProgress); add(r.box, s.box); add(r.notes, s.note); add(r.bar, s.bar);
            const busy = !!(s.wallsProgress || s.courseProgress);
            const shown = `${s.box ?? ''}|${s.note ?? ''}`;
            if (busy) {
                if (busySince === null) { busySince = at; lastChange = at; lastShown = shown; }
                if (shown !== lastShown) { r.maxSilentS = Math.max(r.maxSilentS, at - lastChange); lastChange = at; lastShown = shown; }
                else r.maxSilentS = Math.max(r.maxSilentS, at - lastChange);
            } else { busySince = null; lastShown = null; }
            if (s.wallsProgress && !shotWalls && at > 4) { shotWalls = true; await page.screenshot({ path: `${shots}/g1-progress-${id}-walls.png` }); }
            if (s.courseProgress && !shotCourse) { shotCourse = true; await page.screenshot({ path: `${shots}/g1-progress-${id}-course.png` }); }
            if (s.gates > 0 && s.drawn > 0) { r.firstGateS = at; break; }
            if (s.problem && !busy && at > 5 && !s.gates) { r.problemSeen = s.problem; break; }
            if (Date.now() - t0 > LIMIT_MS) { r.fail = 'timeout'; break; }
            await page.waitForTimeout(500);
        }
        await page.waitForTimeout(1500);
        r.after = await page.evaluate(READ);
        await page.screenshot({ path: `${shots}/g1-progress-${id}-end.png` });
    } catch (e) { r.fail = String(e).slice(0, 200); try { r.after = await page.evaluate(READ); } catch { /* page gone */ } }
    out.push(r);
    await ctx.close();
}
await browser.close();
writeFileSync(outFile, JSON.stringify(out, null, 1));
for (const r of out) console.log(JSON.stringify({ id: r.id, firstGateS: r.firstGateS, wallsLines: r.walls.length, courseLines: r.course.length, maxSilentS: r.maxSilentS, problem: r.problemSeen, errors: r.errors.length, fail: r.fail }));
