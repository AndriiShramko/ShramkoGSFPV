// Train 2 integration page probe: the course's lap clock and its lines are not drawn over the pause menu
// (owner: "the clock and all these statistics lie over the menu that we call with Escape";
// apps/fly/src/course/cover.ts, course/hud.ts cover(), course/hud.css .course-covered).
// On a release build, headless, at 1920x1080 and 844x390: an ordinary flight page, Shift+G makes a course, the lap
// block shows; Escape opens the pause menu.
// Checks per size:
//   shownInFlight    the lap block is laid out before the menu opens
//   hiddenUnderMenu  with the pause menu open the block has display none (the class course-covered is on it)
//   control          the same page with the class taken off for a moment: the block is laid out again and its box
//                    crosses the menu's box (so the check can fail, and the class is what hides the block)
//   backAfterMenu    Escape again: the menu is gone and the block is laid out again
// Also recorded, no check: the flash note after a plain G on the ordinary page (sonic-optin-page part A asks for none).
// Pictures: <shots>/pause-over-course-1920.png and pause-over-course-844.png (the menu over the course).
// Last line: JSON {pass, checks}; exit 0 only on pass.
// Usage: node pause-over-course-probe.mjs <base with the locale, e.g. http://localhost:5760/en> <out.json> [shots dir] [scene]
//        PAUSE_PROBE_VISUAL=0 runs with render=off. Needs the GPU lock C:/dev/.gpu-lock around it (it does not take the lock itself).
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { pickHarnessBrowser } from './visual-browser.mjs';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '');
const require = createRequire(ROOT + '/tools/bench/package.json');
const { chromium } = require('playwright');
const base = process.argv[2] ?? 'http://localhost:5760/en';
const outFile = process.argv[3] ?? ROOT + '/.cache/pause-over-course-probe.json';
const shots = (process.argv[4] ?? dirname(outFile)).replace(/\\/g, '/');
const scene = process.argv[5] ?? '887f27aa';
const VISUAL = process.env.PAUSE_PROBE_VISUAL !== '0';
mkdirSync(dirname(outFile), { recursive: true });
mkdirSync(shots, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SIZES = [{ name: '1920', width: 1920, height: 1080 }, { name: '844', width: 844, height: 390 }];
const out = { base, scene, visual: VISUAL, sizes: {}, plainG: null, errors: [] };
const checks = [];
const check = (name, pass, value) => { checks.push({ name, pass: !!pass, value }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(value ?? null).slice(0, 400)}`); };

/** In the page: the lap block and the pause menu as they are laid out now. */
function look() {
    const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom) }; };
    const hud = document.querySelector('[data-testid=course-hud]');
    const menu = document.querySelector('.pause-menu');
    const note = document.querySelector('#ui > .hud-note');
    return {
        hud: hud ? { hidden: hud.hidden, covered: hud.classList.contains('course-covered'), display: getComputedStyle(hud).display, laidOut: hud.offsetParent !== null, box: box(hud), text: (hud.textContent ?? '').slice(0, 120) } : null,
        menu: menu ? { laidOut: menu.offsetParent !== null || getComputedStyle(menu).position === 'fixed', box: box(menu) } : null,
        note: note && !note.hidden && getComputedStyle(note).display !== 'none' ? (note.textContent ?? '').slice(0, 200) : ''
    };
}
const crosses = (a, b) => !!a && !!b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

const pick = pickHarnessBrowser({ expected: chromium.executablePath() }, VISUAL);
const browser = await chromium.launch({ ...pick.launch, headless: pick.launch.headless });
try {
    for (const size of SIZES) {
        const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height } });
        const page = await ctx.newPage();
        page.on('pageerror', (e) => out.errors.push(`${size.name}: ${String(e.message).slice(0, 160)}`));
        const rec = {};
        out.sizes[size.name] = rec;
        try {
            await page.goto(`${base}/fly/?scene=${scene}&nowarn=1&set.input.howToFly=false&set.input.play=easy${VISUAL ? '' : '&render=off'}`, { waitUntil: 'load' });
            await page.waitForFunction(() => window.__gsfpv?.status === 'ready', null, { timeout: 180000 });
            const asks = await page.waitForSelector('.screen.radio [data-action=radio-keyboard]', { timeout: 6000 }).then(() => true, () => false);
            if (asks) await page.locator('[data-action=radio-keyboard]').click();
            await page.waitForFunction(() => !document.querySelector('.screen.radio'), null, { timeout: 15000 });
            await sleep(1000);
            if (out.plainG === null) {
                // a key no binding has first (the page's own first-key effects), then a plain G
                await page.keyboard.press('KeyJ');
                await sleep(600);
                const before = (await page.evaluate(look)).note;
                await page.keyboard.press('KeyG');
                await sleep(500);
                out.plainG = { before, after: (await page.evaluate(look)).note };
                await sleep(3000);
            }
            await page.waitForFunction(() => !!window.__gsfpv?.session?.baseCollision, null, { timeout: 120000 });
            await page.keyboard.press('Shift+KeyG');
            await page.waitForFunction(() => { const el = document.querySelector('[data-testid=course-hud]'); return !!el && !el.hidden && el.offsetParent !== null; }, null, { timeout: 180000 });
            // off the ground, so the picture is a flight over a course
            await page.keyboard.down('KeyW');
            await sleep(1500);
            await page.keyboard.up('KeyW');
            await sleep(800);
            rec.flight = await page.evaluate(look);
            check(`${size.name}: shownInFlight`, rec.flight.hud?.laidOut === true && rec.flight.menu === null, { hud: rec.flight.hud, menu: rec.flight.menu });

            await page.keyboard.press('Escape');
            await page.waitForSelector('.pause-menu', { timeout: 10000 });
            await sleep(700);
            rec.paused = await page.evaluate(look);
            check(`${size.name}: hiddenUnderMenu`, rec.paused.menu !== null && rec.paused.hud?.display === 'none' && rec.paused.hud?.covered === true, { hud: rec.paused.hud, menu: rec.paused.menu?.box });
            await page.screenshot({ path: `${shots}/pause-over-course-${size.name}.png` });

            await page.evaluate(() => document.querySelector('[data-testid=course-hud]')?.classList.remove('course-covered'));
            await sleep(200);
            rec.control = await page.evaluate(look);
            await page.evaluate(() => document.querySelector('[data-testid=course-hud]')?.classList.add('course-covered'));
            check(`${size.name}: control (class off: the block is drawn again and crosses the menu's box)`, rec.control.hud?.laidOut === true && crosses(rec.control.hud?.box, rec.control.menu?.box), { hud: rec.control.hud?.box, menu: rec.control.menu?.box });

            await page.keyboard.press('Escape');
            await page.waitForFunction(() => !document.querySelector('.pause-menu'), null, { timeout: 10000 });
            await sleep(500);
            rec.after = await page.evaluate(look);
            check(`${size.name}: backAfterMenu`, rec.after.menu === null && rec.after.hud?.laidOut === true && rec.after.hud?.covered === false, { hud: rec.after.hud });
        } catch (e) {
            rec.error = String(e?.message ?? e).slice(0, 300);
            check(`${size.name}: ran to its end`, false, rec.error);
            await page.screenshot({ path: `${shots}/pause-over-course-${size.name}-error.png` }).catch(() => undefined);
        }
        await ctx.close();
    }
} finally {
    await browser.close();
}
const pass = checks.length >= SIZES.length * 4 && checks.every((c) => c.pass) && out.errors.length === 0;
writeFileSync(outFile, JSON.stringify({ ...out, checks, pass }, null, 2) + '\n');
console.log(JSON.stringify({ pass, checks: checks.map((c) => [c.name, c.pass]), plainG: out.plainG, errors: out.errors }));
process.exit(pass ? 0 : 1);
