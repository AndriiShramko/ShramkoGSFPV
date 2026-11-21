// Lane tutor-say, the independent check (train 4): ONE step of the reviewer's own on top of tutor-say-accept.mjs.
// With "my screen reader speaks" on (the sound start screen's sonic-sr box, clicked with the mouse), Start flying, then key N five
// times: the captions region (div[data-testid=sonic-captions], role log: what a screen reader announces) holds the line of keys at
// most once in the whole lesson part and never after the first step change; the engine's own voice says nothing; #ui (the page's
// aria-live region) is "off" while the lesson runs. ?render=off, headless, 1536 x 730 at scale 1.25, a new empty profile.
// Usage: node tools/bench/scripts/tutor-say-review.mjs <base, e.g. http://localhost:7022> <out.json>
// Read only: nothing is saved, sent or created on any site; the profile is a throwaway folder.
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { pickHarnessBrowser } from './visual-browser.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '');
const require = createRequire(ROOT + '/tools/bench/package.json');
const { chromium } = require('playwright');
const [base = 'http://localhost:7022', outFile = 'U:/Temp/gsfpv-train4/tutor-say/review.json'] = process.argv.slice(2);
const TEMP = 'U:/Temp/gsfpv-train4/tutor-say';
const VIEW = { viewport: { width: 1536, height: 730 }, deviceScaleFactor: 1.25 };
const URL_START = `${base}/en/fly/?sonic=start&render=off&nowarn=1`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const KEYLIST = /\bkey [A-Z]\b.*\bkey [A-Z]\b/i;

function spy() {
    const w = window;
    w.__rv = { said: [], cap: [] };
    const watch = () =>
        new MutationObserver((list) => {
            for (const m of list) {
                if (m.type !== 'childList' || !m.target.closest?.('[data-testid="sonic-captions"]')) continue;
                for (const n of m.addedNodes) {
                    const t = (n.textContent ?? '').replace(/\s+/g, ' ').trim();
                    if (t !== '') w.__rv.cap.push(t);
                }
            }
        }).observe(document.documentElement, { subtree: true, childList: true });
    if (document.documentElement) watch();
    else document.addEventListener('DOMContentLoaded', watch);
    const synth = w.speechSynthesis;
    if (synth) {
        synth.speak = (u) => {
            const text = String(u.text ?? '');
            if (text.trim() !== '') w.__rv.said.push(text);
            setTimeout(() => u.dispatchEvent(new Event('end')), 50);
        };
    }
}

async function clickCentre(page, sel) {
    const loc = page.locator(sel).first();
    if (!(await loc.isVisible().catch(() => false))) return false;
    await loc.scrollIntoViewIfNeeded().catch(() => undefined);
    const box = await loc.boundingBox();
    if (!box) return false;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    return true;
}

/** every line added to the captions region since the page loaded (the MutationObserver's log: dropped lines stay counted) */
const captionLines = (page) => page.evaluate(() => [...window.__rv.cap]);

const pick = pickHarnessBrowser({ expected: chromium.executablePath() }, false);
mkdirSync(TEMP, { recursive: true });
const dir = mkdtempSync(`${TEMP}/profile-`);
const errors = [];
const facts = { srOn: false, started: false, changes: [] };
let pass = false;
let ctx = null;
try {
    ctx = await chromium.launchPersistentContext(dir, { ...pick.launch, args: [...(pick.launch.args ?? []), '--autoplay-policy=no-user-gesture-required'], ...VIEW });
    await ctx.addInitScript(spy);
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)));
    await page.goto(URL_START, { waitUntil: 'load' });
    for (let i = 0; i < 300 && !(await page.evaluate(() => !!document.querySelector('[data-testid="sonic-start"] button')).catch(() => false)); i++) await sleep(100);
    await sleep(800);
    await clickCentre(page, '#sonic-sr');
    await sleep(400);
    facts.srOn = await page.evaluate(() => document.querySelector('#sonic-sr')?.checked === true);
    facts.started = await clickCentre(page, '[data-testid="sonic-start-quick"]');
    await sleep(1500);
    await page.mouse.click(VIEW.viewport.width / 2, Math.round(VIEW.viewport.height * 0.6)).catch(() => undefined);
    for (let i = 0; i < 300 && !(await page.evaluate(() => window.__gsfpv?.sonic?.(false)?.lesson ?? null)); i++) await sleep(100);
    await sleep(6000);
    const voice0 = await page.evaluate(() => window.__rv.said.length);
    let seen = (await captionLines(page)).length;
    const all = [...(await captionLines(page))];
    for (let i = 0; i < 5; i++) {
        const s0 = await page.evaluate(() => window.__gsfpv?.sonic?.(false) ?? null);
        await page.keyboard.press('KeyN');
        await sleep(5000);
        const lines = await captionLines(page);
        const fresh = lines.slice(seen);
        seen = lines.length;
        all.push(...fresh);
        const ui = await page.evaluate(() => document.getElementById('ui')?.getAttribute('aria-live'));
        const s1 = await page.evaluate(() => window.__gsfpv?.sonic?.(false) ?? null);
        facts.changes.push({ from: s0?.lesson, to: s1?.lesson, panel: s1?.panel ?? null, captions: fresh, keyLines: fresh.filter((x) => KEYLIST.test(x)).length, uiLive: ui });
    }
    facts.voiceSaidInLesson = (await page.evaluate(() => window.__rv.said)).slice(voice0);
    facts.keyLinesTotal = all.filter((x) => KEYLIST.test(x)).length;
    // the line of keys once, when keys first matter (lessons.ts keysDue: a listening lesson's first step after its first sound);
    // after the step change that carried it, never again
    const firstKeys = facts.changes.findIndex((c) => c.keyLines > 0);
    facts.afterFirst = facts.changes.slice(firstKeys < 0 ? 0 : firstKeys + 1).reduce((a, c) => a + c.keyLines, 0);
    pass = facts.srOn && facts.started && facts.changes.length === 5 && facts.changes.every((c) => c.uiLive === 'off') && facts.keyLinesTotal <= 1 && facts.afterFirst === 0 && facts.voiceSaidInLesson.length === 0 && facts.changes.every((c) => c.captions.length > 0);
} catch (e) {
    errors.push(String(e).slice(0, 300));
} finally {
    await ctx?.close().catch(() => undefined);
    rmSync(dir, { recursive: true, force: true });
}
const verdict = { probe: 'tutor-say-review', base, pass, ...facts, errors };
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify(verdict, null, 1));
console.log(JSON.stringify({ probe: verdict.probe, base, pass, keyLinesTotal: facts.keyLinesTotal, perStep: facts.changes.map((c) => [c.keyLines, c.captions.length, c.uiLive]), errors: errors.slice(0, 3) }));
process.exit(pass ? 0 : 1);
