// Lane vox4 (voxux4 V-2 step 1): what the voxels-only view holds right around the craft. Opens a scene, turns on
// "voxels only" and samples VoxelStats.near (the 27 chunks around the camera) for a while; prints one JSON with the
// decision of the design: occupied=false -> H1 (floaters / outside the walls), wanted but not loaded -> H2 (queue,
// level flips), loaded with 0 quads at a coarse level -> H3. Usage:
//   node vox4-near.mjs <base> <scene> <out.json> [seconds=20] [extra query, e.g. render=off]
// Exits 1 when a near occupied chunk is still not drawn at the end.
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { pickBrowser } from '../src/chrome.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [base, id, out, secS = '20', extra = ''] = process.argv.slice(2);
if (!base || !id || !out) { console.error('usage: vox4-near.mjs <base> <scene> <out.json> [seconds] [query]'); process.exit(2); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = pickBrowser({ expected: chromium.executablePath() });
const browser = await chromium.launch({ ...pick.launch, headless: true });
const r = { base, id, extra, samples: [], errors: [] };
let code = 1;
try {
    const ctx = await browser.newContext({ viewport: { width: 1536, height: 730 }, deviceScaleFactor: 1.25 });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => r.errors.push(String(e.message).slice(0, 200)));
    await page.goto(`${base}/fly/?scene=${id}&nowarn=1${extra ? '&' + extra : ''}`);
    await page.waitForFunction(() => ['ready', 'error'].includes(window.__gsfpv?.status), null, { timeout: 240000 });
    r.status = await page.evaluate(() => window.__gsfpv.status);
    const t0 = Date.now();
    while (Date.now() - t0 < 300000) { if (await page.evaluate(() => (window.__gsfpv?.voxels?.stats?.()?.voxelCm ?? 0) > 0)) break; await sleep(500); }
    await page.evaluate(() => window.__gsfpv.voxels.setMode('only'));
    const t1 = Date.now();
    const secs = Number(secS);
    for (;;) {
        const s = await page.evaluate(() => {
            const v = window.__gsfpv.voxels.stats();
            const p = window.__gsfpv.session.renderer.camera.getPosition();
            return { state: v.state, whole: v.whole, share: v.share, detail: v.detail, wallChunks: v.wallChunks, plannedChunks: v.plannedChunks, perLevel: v.perLevel, inFlight: v.inFlight, pendingUploads: v.pendingUploads, dropped: v.dropped, cam: [p.x, p.y, p.z].map((n) => Math.round(n * 100) / 100), near: v.near };
        });
        s.t = Math.round((Date.now() - t1) / 100) / 10;
        r.samples.push(s);
        if (Date.now() - t1 >= secs * 1000) break;
        await sleep(2000);
    }
    const last = r.samples[r.samples.length - 1];
    const near = last.near ?? [];
    const occ = near.filter((c) => c.occupied);
    const missing = occ.filter((c) => c.loaded === null);
    const flip = occ.filter((c) => c.wanted !== null && c.loaded !== null && c.wanted !== c.loaded);
    const empty = occ.filter((c) => c.loaded !== null && c.loaded >= 2 && c.quads === 0);
    // the first second each near chunk was drawn
    const firstDrawn = {};
    for (const s of r.samples) for (const c of s.near ?? []) if (c.occupied && c.loaded !== null && firstDrawn[c.key] === undefined) firstDrawn[c.key] = s.t;
    r.verdict = {
        near: near.length, occupied: occ.length, notOccupied: near.length - occ.length, missing: missing.length, levelFlip: flip.length, emptyCoarse: empty.length,
        levels: occ.map((c) => c.loaded), firstDrawnS: firstDrawn,
        decision: occ.length === 0 ? 'H1 (no wall chunk around the camera)' : missing.length > 0 ? (missing.some((c) => c.wanted === null) ? 'H2 (not planned)' : 'H2 (planned, not drawn)') : empty.length > 0 ? 'H3' : 'drawn'
    };
    code = missing.length === 0 && occ.length > 0 ? 0 : 1;
} catch (e) {
    r.errors.push(String(e?.message ?? e).slice(0, 300));
} finally {
    await browser.close();
}
writeFileSync(out, JSON.stringify(r, null, 1));
console.log(JSON.stringify({ status: r.status, verdict: r.verdict, errors: r.errors.slice(0, 3), last: r.samples.length ? { ...r.samples[r.samples.length - 1], near: undefined } : null }));
process.exit(code);
