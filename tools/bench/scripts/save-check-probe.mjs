// Lane fix3b, stage Y1-save-check: the edit mode's Save check of the generated course, untouched, in the page. For each
// way in (shiftg: Shift+G with the page's own seed; g1.<seed36>: the course link) the page is opened fresh, the course is
// waited for, and window.__gsfpv.course.saveCheck() (builtin/course.ts, read only) gives the start, gate 1, the transform,
// the walls in use and the problems the Save would refuse. Presses Shift+G only. Takes no GPU lock (wrap it).
//   node tools/bench/scripts/save-check-probe.mjs <base with /en> <scene> <out.json> shiftg g1.1 g1.2 [--wait-s=400] [--push]
// --push (Y3): also gate 1 moved into the nearest wall must be refused, and the course in use still has 0 problems.
// Exit 0 when every course came and its Save check has no problem.
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { pickBrowser } from '../src/chrome.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const args = process.argv.slice(2);
const [base, id, out, ...rest] = args;
const ways = rest.filter((a) => !a.startsWith('--'));
if (!base || !id || !out || ways.length === 0) { console.error('usage: save-check-probe.mjs <base with /en> <scene> <out.json> shiftg|g1.<seed36> ...'); process.exit(2); }
const waitS = Number((rest.find((a) => a.startsWith('--wait-s=')) ?? '--wait-s=400').slice(9));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = pickBrowser({ expected: chromium.executablePath() });
const rows = [];
let browser = null;
let bad = 0;
try {
    for (const way of ways) {
        const t0 = Date.now();
        // a fresh browser per way: a second context in one browser crashed on Tunis (Target crashed)
        browser = await chromium.launch({ ...pick.launch, headless: true });
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
        const page = await ctx.newPage();
        page.on('pageerror', (e) => console.log('pageerror ' + String(e.message).slice(0, 200)));
        page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`console ${m.type()} ${Math.round((Date.now() - t0) / 1000)} s ${m.text().slice(0, 200)}`); });
        page.on('crash', () => console.log(`crash ${Math.round((Date.now() - t0) / 1000)} s`));
        const row = { way };
        try {
            await page.goto(`${base}/fly/?scene=${id}${way === 'shiftg' ? '' : `&course=${way}`}&nowarn=1`);
            await page.waitForFunction(() => ['ready', 'error'].includes(window.__gsfpv?.status), null, { timeout: 240000 });
            try {
                await page.waitForSelector('.screen.radio [data-action="radio-keyboard"]', { timeout: 15000 });
                await page.focus('.screen.radio [data-action="radio-keyboard"]');
                await page.keyboard.press('Enter');
                await page.waitForFunction(() => !document.querySelector('.screen.radio'), null, { timeout: 15000 });
            } catch { /* no Controls screen */ }
            await sleep(1500);
            const tPress = Date.now();
            if (way === 'shiftg') await page.keyboard.press('Shift+KeyG');
            for (let k = 0; ; k++) {
                const st = await page.evaluate(() => { const c = window.__gsfpv?.course, w = window.__gsfpv?.walls; return { done: !!c && (c.source === 'generated' || !!c.problem), source: c?.source, problem: c?.problem ?? null, seed: c?.seed ?? null, walls: w ? { state: w.state, source: w.source } : null }; });
                if (st.done) { Object.assign(row, st); break; }
                if (k % 30 === 0) console.log(`${way} wait ${Math.round((Date.now() - t0) / 1000)} s ${JSON.stringify(st)}`);
                if (Date.now() - t0 > waitS * 1000) throw new Error(`no course after ${waitS} s: ${JSON.stringify(st)}`);
                await sleep(1000);
            }
            row.genS = Math.round((Date.now() - t0) / 1000);
            row.pressToCourseS = +((Date.now() - tPress) / 1000).toFixed(1);
            await sleep(1500);
            row.check = await page.evaluate(() => window.__gsfpv.course.saveCheck?.() ?? 'no hook');
            const n = Array.isArray(row.check?.problems) ? row.check.problems.length : -1;
            if (n !== 0) bad++;
            console.log(`${way}: seed ${row.seed} press-to-course ${row.pressToCourseS} s gates ${row.check?.gates} problems ${n} start ${JSON.stringify(row.check?.startFlown)} g1 ${JSON.stringify(row.check?.gate1)} T ${JSON.stringify(row.check?.transform)} res ${row.check?.walls?.res} ${JSON.stringify(row.check?.problems).slice(0, 300)}`);
            // Y3 negative row: gate 1 pushed 0.3 m into the nearest wall (level rays from its centre, 24 ways, 30 m) must be
            // refused by the same check; the course in use is checked again after it (still 0 problems: the copy was checked)
            if (process.argv.includes('--push')) {
                row.push = await page.evaluate(() => {
                    const h = window.__gsfpv, col = h.session.collision, g = h.course.gatePoses()[0].pos;
                    let best = null;
                    for (let k = 0; k < 24; k++) {
                        const a = (k / 24) * Math.PI * 2, d = [Math.cos(a), 0, Math.sin(a)];
                        const hit = col.queryRay(g[0], g[1], g[2], d[0], 0, d[2], 30);
                        if (hit) { const m = Math.hypot(hit.x - g[0], hit.z - g[2]); if (!best || m < best.m) best = { m, d, hit }; }
                    }
                    if (!best) return { error: 'no wall within 30 m of gate 1' };
                    const pos = [best.hit.x + best.d[0] * 0.3, best.hit.y, best.hit.z + best.d[2] * 0.3];
                    const moved = h.course.saveCheck({ gate: 0, pos });
                    const after = h.course.saveCheck();
                    return { from: g.map((v) => +v.toFixed(2)), to: pos.map((v) => +v.toFixed(2)), wallM: +best.m.toFixed(2), inWall: !col.isFreeAt(pos[0], pos[1], pos[2]), problems: moved?.problems ?? null, untouchedAfter: after?.problems?.length ?? -1 };
                });
                const np = Array.isArray(row.push?.problems) ? row.push.problems.length : 0;
                if (np === 0 || row.push?.untouchedAfter !== 0) bad++;
                console.log(`${way} push: gate 1 into the wall ${row.push?.wallM} m away, in wall ${row.push?.inWall}: problems ${np} (must be > 0), untouched after ${row.push?.untouchedAfter} ${JSON.stringify(row.push?.problems ?? row.push).slice(0, 300)}`);
            }
        } catch (e) {
            bad++;
            row.error = String(e.message ?? e).slice(0, 300);
            console.log(`${way}: ERROR ${row.error}`);
        }
        rows.push(row);
        writeFileSync(out, JSON.stringify({ base, id, rows }, null, 1));
        await browser.close();
        browser = null;
    }
} finally {
    if (browser) await browser.close();
    writeFileSync(out, JSON.stringify({ base, id, rows }, null, 1));
}
process.exit(bad === 0 ? 0 : 1);
