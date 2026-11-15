// Lane fix3b, stage Y1-save-check: the edit mode's Save check of the generated course, untouched, in the page. For each
// way in (shiftg: Shift+G with the page's own seed; g1.<seed36>: the course link) the page is opened fresh, the course is
// waited for, and window.__gsfpv.course.saveCheck() (builtin/course.ts, read only) gives the start, gate 1, the transform,
// the walls in use and the problems the Save would refuse. Presses Shift+G only. Takes no GPU lock (wrap it).
//   node tools/bench/scripts/save-check-probe.mjs <base with /en> <scene> <out.json> shiftg g1.1 g1.2 [--wait-s=400]
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
const browser = await chromium.launch({ ...pick.launch, headless: true });
const rows = [];
let bad = 0;
try {
    for (const way of ways) {
        const t0 = Date.now();
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
        const page = await ctx.newPage();
        page.on('pageerror', (e) => console.log('pageerror ' + String(e.message).slice(0, 200)));
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
            if (way === 'shiftg') await page.keyboard.press('Shift+KeyG');
            for (let k = 0; ; k++) {
                const st = await page.evaluate(() => { const c = window.__gsfpv?.course, w = window.__gsfpv?.walls; return { done: !!c && (c.source === 'generated' || !!c.problem), source: c?.source, problem: c?.problem ?? null, seed: c?.seed ?? null, walls: w ? { state: w.state, source: w.source } : null }; });
                if (st.done) { Object.assign(row, st); break; }
                if (k % 30 === 0) console.log(`${way} wait ${Math.round((Date.now() - t0) / 1000)} s ${JSON.stringify(st)}`);
                if (Date.now() - t0 > waitS * 1000) throw new Error(`no course after ${waitS} s: ${JSON.stringify(st)}`);
                await sleep(1000);
            }
            row.genS = Math.round((Date.now() - t0) / 1000);
            await sleep(1500);
            row.check = await page.evaluate(() => window.__gsfpv.course.saveCheck?.() ?? 'no hook');
            const n = Array.isArray(row.check?.problems) ? row.check.problems.length : -1;
            if (n !== 0) bad++;
            console.log(`${way}: seed ${row.seed} gates ${row.check?.gates} problems ${n} start ${JSON.stringify(row.check?.startFlown)} g1 ${JSON.stringify(row.check?.gate1)} T ${JSON.stringify(row.check?.transform)} res ${row.check?.walls?.res} ${JSON.stringify(row.check?.problems).slice(0, 300)}`);
        } catch (e) {
            bad++;
            row.error = String(e.message ?? e).slice(0, 300);
            console.log(`${way}: ERROR ${row.error}`);
        }
        rows.push(row);
        await ctx.close();
    }
} finally {
    await browser.close();
    writeFileSync(out, JSON.stringify({ base, id, rows }, null, 1));
}
process.exit(bad === 0 ? 0 : 1);
