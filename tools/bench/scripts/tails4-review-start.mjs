// Review of lane tails4 (independent check), the pilot's own step the lane did not take: open each of the three scans
// whose start was moved (2f1ddf5f, d10c5638, ab5efa0e) IN THE PAGE, click into the scene with the mouse (1536x730,
// scale 1.25, render=off) as a person does, keep the sticks still for 4 s and see where the drone is: over the page's own
// walls, near the ground (the lane measured this only in Node, on its own reading of the camera).
// PASS per scan: the page's spawn has ground within 6 m under it in the page's walls and the craft's sphere there is
// free of the walls. (Headless Chrome gives no pointer lock and nothing arms without a radio, so the craft does not
// move after the click; the probe reads the start the page itself placed, not a flight.)
// Usage: node tails4-review-start.mjs <base with the locale> <out.json>. One JSON line; exit 1 on a failure.
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { pickHarnessBrowser } from './visual-browser.mjs';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '');
const require = createRequire(ROOT + '/tools/bench/package.json');
const { chromium } = require('playwright');
const base = process.argv[2] ?? 'http://localhost:6121/en';
const outFile = process.argv[3] ?? ROOT + '/.cache/tails4-review-start.json';
// --shot <png>: one drawn run of 2f1ddf5f (the start found 'around' the camera's target) with a picture of what the pilot sees
const shotAt = process.argv.indexOf('--shot');
const shot = shotAt > 0 ? process.argv[shotAt + 1] : null;
const SCANS = shot ? ['2f1ddf5f'] : ['2f1ddf5f', 'd10c5638', 'ab5efa0e'];
const MAX_OVER_M = 6;

const pick = pickHarnessBrowser({ expected: chromium.executablePath() }, !!shot);
const browser = await chromium.launch({ ...pick.launch, headless: true });
const out = { what: 'tails4 review: the moved starts in the page', base, rows: [] };
const checks = {};
for (const id of SCANS) {
    const row = { scene: id };
    const ctx = await browser.newContext({ viewport: { width: 1536, height: 730 }, deviceScaleFactor: 1.25, bypassCSP: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)));
    try {
        await page.goto(`${base}/fly/?scene=${id}&nowarn=1${shot ? '' : '&render=off'}&set.input.howToFly=false`, { waitUntil: 'load' });
        await page.waitForFunction(() => window.__gsfpv?.status === 'ready' && !!window.__gsfpv.session?.runner, null, { timeout: 180000 });
        const probe = () => {
            const s = window.__gsfpv.session;
            const col = s.collision;
            const sp = s.spawn;
            const st = s.runner.sim.s;
            const g = (x, y, z) => { const h = col ? col.queryRay(x, y, z, 0, -1, 0, 1000) : null; return h ? h.y : null; };
            const gs = g(sp[0], sp[1], sp[2]);
            const gc = g(st[0], st[1], st[2]);
            const push = { x: 0, y: 0, z: 0 };
            const free = col ? !col.querySphere(sp[0], sp[1], sp[2], s.params.boundRadius + 0.03, push) : false;
            return { hasCollision: !!col, free, spawn: sp.slice(0, 3).map((n) => Math.round(n * 100) / 100), spawnOver: gs === null ? null : sp[1] - gs, craft: [st[0], st[1], st[2]].map((n) => Math.round(n * 100) / 100), craftOver: gc === null ? null : st[1] - gc, lock: !!document.pointerLockElement };
        };
        row.before = await page.evaluate(probe);
        // the pilot's click into the scene (pointer lock first), then the sticks stay still
        await page.mouse.click(768, 365);
        await page.waitForTimeout(4000);
        row.after = await page.evaluate(probe);
        if (shot) { await page.waitForTimeout(8000); await page.screenshot({ path: shot }); }
    } catch (e) {
        row.threw = String(e?.message ?? e).slice(0, 300);
    }
    row.errors = errors;
    const b = row.before, a = row.after;
    checks[`${id}.walls`] = !!b?.hasCollision;
    checks[`${id}.spawnOverGround`] = b?.spawnOver !== null && b?.spawnOver !== undefined && b.spawnOver >= 0 && b.spawnOver <= MAX_OVER_M;
    checks[`${id}.spawnFree`] = b?.free === true && a?.free === true;
    out.rows.push(row);
    await ctx.close();
}
await browser.close();
const pass = Object.values(checks).every(Boolean);
out.pass = pass;
out.checks = checks;
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify(out, null, 1));
console.log(JSON.stringify({ pass, checks }));
process.exit(pass ? 0 : 1);
