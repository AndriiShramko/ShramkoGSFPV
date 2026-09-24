// Phase C acceptance: collision baked in the browser.
//  - 723068d7 (no collision on SuperSplat): bake in the tab, time + peak memory, voxel count vs the
//    splat-transform 3.6.4 CLI on the same file (±1 %), the baked data saved for the Node
//    tunnelling (A5) and clearance (A8) harnesses.
//  - bd04e182 (16.8 M Gaussians): a clear refusal with numbers, in the page language.
//   SITE=https://gsfpv.flyreelstudio.eu npx tsx src/accept-c.ts
import { mkdirSync, writeFileSync, readFileSync, copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { launch, waitReady } from './browser';
import { writeEvidence, REPO, today } from './evidence';
import { countSolidVoxelsFromBytes } from '@gsfpv/collision';

const SITE = (process.env.SITE ?? 'https://gsfpv.flyreelstudio.eu').replace(/\/$/, '');
const fly = (l: string, qs: string) => (process.env.LOCAL_FLY ? `${SITE}/fly/?${qs}` : `${SITE}/${l}/fly/?${qs}`) + `&cb=${Math.random().toString(36).slice(2)}`;
const SHOTS = join(REPO, 'evidence', today(), 'c');
mkdirSync(SHOTS, { recursive: true });
const CLI_DIR = join(REPO, '.cache', 'scenes', '723068d7');
const BAKED_DIR = join(REPO, '.cache', 'scenes', '723068d7-baked');
mkdirSync(BAKED_DIR, { recursive: true });

const { browser, context, page } = await launch();
const cdp = await context.newCDPSession(page);
await cdp.send('Performance.enable');
let peakHeap = 0;
const poll = setInterval(async () => {
    try {
        const m = await cdp.send('Performance.getMetrics');
        const h = m.metrics.find((x) => x.name === 'JSHeapUsedSize')?.value ?? 0;
        if (h > peakHeap) peakHeap = h;
    } catch { /* page navigating */ }
}, 250);

// ---- 723068d7: bake in the browser
await page.goto(fly('en', 'scene=723068d7&nowarn=1&input=touch'));
const ready = await waitReady(page, 180000);
const before = await page.evaluate(() => ({ hasCollision: !!(window as any).__gsfpv.session.collision, badge: !!document.querySelector('[data-testid="no-collision"]') }));
peakHeap = 0;
const t0 = Date.now();
await page.click('[data-action="bake"]');
let bake: Record<string, unknown> | null = null;
while (Date.now() - t0 < 600000) {
    bake = await page.evaluate(() => (window as any).__gsfpv.bake ?? null);
    if (bake) break;
    await page.waitForTimeout(1000);
}
const wallS = (Date.now() - t0) / 1000;
await page.waitForTimeout(1500);
await page.screenshot({ path: join(SHOTS, 'c-723068d7-baked.jpg') });
const after = await page.evaluate(() => { const h = (window as any).__gsfpv; const s = h.session; return { hasCollision: !!s.collision, badge: !!document.querySelector('[data-testid="no-collision"]'), status: document.querySelector('[data-testid="bake-status"]')?.textContent ?? null, spawnFree: s.spawnIsFree() }; });
// save the baked files through the page's own download path
const downloads: string[] = [];
page.on('download', async (d) => { const f = join(BAKED_DIR, d.suggestedFilename().endsWith('.json') ? 'scene.voxel.json' : 'scene.voxel.bin'); await d.saveAs(f); downloads.push(f); });
await page.evaluate(() => (window as any).__gsfpv.downloadBaked());
for (let i = 0; i < 120 && downloads.length < 2; i++) await page.waitForTimeout(500);
if (existsSync(join(CLI_DIR, 'settings.json'))) copyFileSync(join(CLI_DIR, 'settings.json'), join(BAKED_DIR, 'settings.json'));
const cliJson = readFileSync(join(CLI_DIR, 'cli.voxel.json'));
const cliBin = readFileSync(join(CLI_DIR, 'cli.voxel.bin'));
const cliCount = countSolidVoxelsFromBytes(cliJson, cliBin);
const bJson = existsSync(join(BAKED_DIR, 'scene.voxel.json')) ? readFileSync(join(BAKED_DIR, 'scene.voxel.json')) : null;
const bBin = existsSync(join(BAKED_DIR, 'scene.voxel.bin')) ? readFileSync(join(BAKED_DIR, 'scene.voxel.bin')) : null;
const browserCount = bJson && bBin ? countSolidVoxelsFromBytes(bJson, bBin) : -1;
const relDiff = cliCount > 0 ? browserCount / cliCount - 1 : NaN;
const identical = !!bBin && Buffer.compare(bBin, cliBin) === 0;

// in-tab tunnelling on the baked walls (the full ≥10 000 passes run in Node on the saved files)
const tab = await page.evaluate(() => (window as any).__gsfpv.session.tunnelSelfTest(20, 25, 11));

// ---- bd04e182: refusal with numbers, in Russian
await page.goto(fly('ru', 'scene=bd04e182&nowarn=1&input=touch'));
await waitReady(page, 180000);
await page.click('[data-action="bake"]');
let refusal: Record<string, unknown> | null = null;
for (let i = 0; i < 60 && !refusal; i++) { refusal = await page.evaluate(() => (window as any).__gsfpv.bake ?? null); if (!refusal) await page.waitForTimeout(500); }
const refusalText = await page.locator('[data-testid="bake-status"]').textContent();
await page.screenshot({ path: join(SHOTS, 'c-bd04e182-refused.jpg') });
clearInterval(poll);
await browser.close();

const pass = ready.status === 'ready' && before.hasCollision === false && !!bake && bake.ok === true && after.hasCollision && !after.badge && after.spawnFree
    && Math.abs(relDiff) <= 0.01 && tab.passes === 20 && tab.penetrations === 0
    && !!refusal && refusal.refused === true && /\d/.test(refusalText ?? '') && /[А-Яа-я]/.test(refusalText ?? '');
const file = writeEvidence('c-bake', {
    site: SITE,
    pass,
    scene: '723068d7',
    bake: { ...bake, wallClockS: wallS, peakJsHeapMbCdp: Math.round(peakHeap / 1048576), note: 'peakJsHeapMb = performance.memory.usedJSHeapSize sampled in the page every 200 ms (the main number); peakJsHeapMbCdp = CDP polling from outside, which does not get through while the page is busy, so it undercounts; GPU buffers of the voxeliser are in neither' },
    before, after,
    vsCli: { tool: 'splat-transform 3.6.4 CLI, same meta.json, defaults (0.05 m, opacity 0.1)', cliSolidVoxels: cliCount, browserSolidVoxels: browserCount, relDiff, binIdentical: identical, cliPeak: 'CPU 1.00 GB, GPU 154.9 MB, 18.9 s (its own log)' },
    tunnellingInTab: tab,
    refusal: { scene: 'bd04e182', result: refusal, text: refusalText },
    savedFor: 'A5_SCENES=723068d7-baked (Node, ≥10 000 passes per speed) and A8_SCENES=723068d7-baked'
});
writeFileSync(join(BAKED_DIR, 'bake-result.json'), JSON.stringify({ bake, browserCount, cliCount }, null, 1));
console.log(`C ${pass ? 'PASS' : 'FAIL'} -> ${file}`, JSON.stringify({ browserCount, cliCount, relDiff, identical, tab, refusal }));
