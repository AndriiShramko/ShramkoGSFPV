// Stage F1-no-freeze probe: the walls built in the worker equal the walls built on the page's main thread (the old
// path) for the same level and cell: solid voxel count and SHA-256 of scene.voxel.json + scene.voxel.bin, plus the
// longest main-thread long task during each build. Uses the hook walls' bakeTrial (no press, nothing sent or saved).
//   node tools/bench/scripts/walls-offthread-same-probe.mjs http://localhost:5720/en <out.json> <id> [level] [voxelM]
// Headless; takes no GPU lock itself (wrap it).
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { pickBrowser } from '../src/chrome.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [base, outFile, id, levelArg, voxelArg] = process.argv.slice(2);
if (!base || !outFile || !id) { console.error('usage: walls-offthread-same-probe.mjs <base with /en> <out.json> <id> [level] [voxelM]'); process.exit(2); }
const level = Number(levelArg ?? 0), voxelM = Number(voxelArg ?? 0.05);
const pick = pickBrowser({ expected: chromium.executablePath() });
const browser = await chromium.launch({ ...pick.launch, headless: true });
const r = { id, level, voxelM, errors: [], runs: [] };
try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => r.errors.push(String(e.message).slice(0, 160)));
    await page.addInitScript(() => {
        window.__lt = [];
        try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: true }); } catch { /* none */ }
    });
    await page.goto(`${base}/fly/?scene=${id}&nowarn=1&set.input.howToFly=false`, { waitUntil: 'load', timeout: 120000 });
    await page.waitForFunction(() => ['ready', 'error'].includes(window.__gsfpv && window.__gsfpv.status), null, { timeout: 300000 });
    for (const onPage of [true, false]) {
        const one = await page.evaluate(async ({ level, voxelM, onPage }) => {
            const h = window.__gsfpv;
            const t0 = performance.now();
            const res = await h.bakeTrial({ level, voxelM, page: onPage });
            const b = h.bakedBytes;
            let sha = null;
            if (res.ok && b) {
                const all = new Uint8Array(b.json.length + b.bin.length);
                all.set(b.json, 0); all.set(b.bin, b.json.length);
                sha = [...new Uint8Array(await crypto.subtle.digest('SHA-256', all))].map((x) => x.toString(16).padStart(2, '0')).join('');
            }
            const lt = (window.__lt || []).filter((e) => e[0] >= t0);
            return { onPage, ok: res.ok, where: res.where, error: res.error, solidVoxels: res.solidVoxels, gaussians: res.gaussians, voxelM: res.voxelM, ms: res.ms, sha,
                longN: lt.length, longMaxMs: Math.round(Math.max(0, ...lt.map((e) => e[1]))) };
        }, { level, voxelM, onPage });
        r.runs.push(one);
    }
    r.same = r.runs.length === 2 && r.runs[0].ok && r.runs[1].ok && r.runs[0].sha === r.runs[1].sha && r.runs[0].solidVoxels === r.runs[1].solidVoxels;
} catch (e) { r.fail = String(e).slice(0, 300); }
await browser.close();
writeFileSync(outFile, JSON.stringify(r, null, 1));
console.log(JSON.stringify({ id, same: r.same, runs: r.runs.map((x) => ({ where: x.where, ok: x.ok, solid: x.solidVoxels, sha: x.sha?.slice(0, 12), totalS: x.ms ? +(x.ms.total / 1000).toFixed(1) : null, longMaxMs: x.longMaxMs, error: x.error })), errors: r.errors.length, fail: r.fail }));
