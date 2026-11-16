// The course's keys pressed before the course chunk is there (apps/fly/src/app/builtin/course-lazy.ts; the lead's fix of
// 2026-11-16 after integration E: on the live site the chunk came 1.3 s after the Controls screen closed and Shift+G pressed in
// that time did nothing). The chunk is held back CHUNK_DELAY_MS (default 3000) in the test browser, the key is pressed right
// after the Controls screen closes; the probe reads the line shown, when the feature arrives and whether the key was carried out
// (a course for Shift+G, the edit mode for Shift+B). Exit 0 when it was. Rendering off, no GPU lock. Flight keys only.
// Usage: node tools/bench/scripts/course-early-probe.mjs <base, e.g. http://localhost:5708> [Shift+KeyG|Shift+KeyB] [seconds]
import { createRequire } from 'node:module';
import { pickBrowser } from '../src/chrome.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const pick = pickBrowser({ expected: chromium.executablePath() });
const browser = await chromium.launch({ ...pick.launch, headless: true });
const [base, key = 'Shift+KeyG', secsArg = '45'] = process.argv.slice(2);
const delay = Number(process.env.CHUNK_DELAY_MS || 3000);
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 200)));
let chunkAsked = 0;
await page.route('**/fly/assets/course-*.js', async (route) => { chunkAsked++; await new Promise((r) => setTimeout(r, delay)); await route.continue(); });
await page.goto(base + '/en/fly/?scene=70b50d42&nowarn=1&render=off');
await page.waitForFunction(() => window.__gsfpv?.status === 'ready', null, { timeout: 180000 });
await page.waitForSelector('.screen.radio [data-action="radio-keyboard"]', { timeout: 20000 });
await page.focus('.screen.radio [data-action="radio-keyboard"]');
await page.keyboard.press('Enter');
await page.waitForFunction(() => !document.querySelector('.screen.radio'), null, { timeout: 10000 });
const READ = () => {
    const g = window.__gsfpv; const c = g.course;
    const n = document.querySelector('.hud-note');
    return { feature: !!c, gates: c ? c.gates : 0, drawn: c ? c.drawn : 0, on: c ? c.on : false, editor: c && c.editor ? c.editor.open : false, problem: c ? c.problem : null, progress: c && c.progress ? 1 : 0,
        note: n && !n.hidden ? (n.textContent || '').trim().slice(0, 90) : null };
};
const featureAtPress = await page.evaluate(() => !!window.__gsfpv.course);
const t0 = Date.now();
await page.keyboard.press(key);
await new Promise((r) => setTimeout(r, 300));
const afterPress = await page.evaluate(READ);
let tFeature = null, tDone = null, last = afterPress;
const want = (s) => (key === 'Shift+KeyB' ? s.editor : s.gates > 0 && s.drawn > 0);
for (let i = 0; i < Number(secsArg) * 4; i++) {
    await new Promise((r) => setTimeout(r, 250));
    last = await page.evaluate(READ);
    if (last.feature && tFeature === null) tFeature = Date.now() - t0;
    if (want(last)) { tDone = Date.now() - t0; break; }
}
console.log(JSON.stringify({ base, key, chunkDelayMs: delay, chunkAsked, featureAtPress, noteAfterPress: afterPress.note, featureAfterMs: tFeature, doneAfterMs: tDone, last, errs }));
await browser.close();
process.exit(tDone !== null ? 0 : 1);
