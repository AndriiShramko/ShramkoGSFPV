// v0.10 lane R, step A: what does SuperSplat's own viewer do with ?stochastic? The hosted viewer
// (https://superspl.at/s?id=<scene>) reads ?stochastic and draws with its OWN stochastic splat renderer: it is not the
// engine's gsplat.stochastic that this simulator uses. Its bundle has a class "StochasticSplatRenderer" with a TAA history
// (variant defaults taa "on", taaMax 256 frames while the camera rests, taaMoveMax 16 while it moves, taaFilter cubic,
// taaReproj "sample"); the engine's own stochastic drawing takes one dithered sample per pixel per frame and its
// documentation says it "looks best under temporal anti-aliasing". So the same word, a different picture. This opens one
// scene in the viewer twice, with the viewer's own start camera (noanim) at 1280x720:
//   sorted      https://superspl.at/s?id=<id>&noanim
//   stochastic  https://superspl.at/s?id=<id>&noanim&stochastic
// The sorted picture is the reference. The stochastic page is screenshot every SHOT_MS from the moment it shows a scan
// until the picture stops changing (PSNR between two shots above 45 dB), each shot scored against the sorted picture
// (PSNR and SSIM on luma, as v10-r-quality.ts): the series shows the history filling in (the first frames are noisy, the
// settled one is what a pilot of the viewer sees). The address parameter `variant=taa:off` is NOT read by the hosted page
// (a run with it gave the same picture byte for byte), so TAA is attributed from the bundle's code, not switched off here.
// Nothing is changed on superspl.at; it is a page load and screenshots. Draws: run it under the GPU lock.
//   SCENES=39e63ce9,7a475d38,224aba38 npx tsx src/v10-r-supersplat.ts
// Evidence: evidence/<date>/v10-r-supersplat.json; the full frames land in .cache/v10-r-supersplat/ (gitignored), 1:1 crops of
// them are cut by tools/bench/scripts/crop-evidence.py into evidence/<date>/v10-r-supersplat/.
import { mkdirSync, rmdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchChrome } from './browser';
import { REPO, today } from './evidence';

const SCENES = (process.env.SCENES ?? '39e63ce9,7a475d38,224aba38').split(',');
const W = 1280, H = 720;
const SHOT_MS = Number(process.env.SHOT_MS ?? 2500);
const MAX_MS = Number(process.env.MAX_MS ?? 90000);
const LOCK = 'C:/dev/.gpu-lock';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

for (;;) {
    try { mkdirSync(LOCK); break; } catch { console.log('waiting for the GPU lock'); await sleep(Number(process.env.LOCK_POLL_MS ?? 3000)); }
}
const release = (): void => { try { rmdirSync(LOCK); } catch { /* gone */ } };
process.on('SIGINT', () => { release(); process.exit(130); });

/** Score PNG b against PNG a in a blank page: PSNR and SSIM on luma (the same maths as v10-r-quality.ts). */
const SCORE = `(async (aB64, bB64, W, H) => {
  const load = async (b64) => { const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob()); const c = new OffscreenCanvas(W, H); const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(bmp, 0, 0, W, H); return x.getImageData(0, 0, W, H).data; };
  const luma = (d) => { const o = new Float32Array(W * H); for (let i = 0; i < W * H; i++) o[i] = 0.299 * d[4 * i] + 0.587 * d[4 * i + 1] + 0.114 * d[4 * i + 2]; return o; };
  const a = luma(await load(aB64)), b = luma(await load(bB64));
  let e = 0, dark = 0; for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; e += d * d; if (b[i] < 8) dark++; } e /= a.length;
  const C1 = 6.5025, C2 = 58.5225; let sum = 0, n = 0;
  for (let y = 0; y + 8 <= H; y += 4) for (let x = 0; x + 8 <= W; x += 4) {
    let ma = 0, mb = 0, aa = 0, bb = 0, ab = 0;
    for (let j = 0; j < 8; j++) { const o = (y + j) * W + x; for (let i = 0; i < 8; i++) { const u = a[o + i], v = b[o + i]; ma += u; mb += v; aa += u * u; bb += v * v; ab += u * v; } }
    ma /= 64; mb /= 64; const va = aa / 64 - ma * ma, vb = bb / 64 - mb * mb, cv = ab / 64 - ma * mb;
    sum += ((2 * ma * mb + C1) * (2 * cv + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2)); n++;
  }
  return { psnr: Math.round((e === 0 ? 99 : 10 * Math.log10(255 * 255 / e)) * 100) / 100, ssim: Math.round(sum / n * 1000) / 1000, darkShare: Math.round(dark / a.length * 1000) / 1000 };
})`;

const out: Record<string, Any> = { size: [W, H], shotMs: SHOT_MS, scenes: {} };
const picDir = process.env.PIC_DIR ?? join(REPO, '.cache', 'v10-r-supersplat');
mkdirSync(picDir, { recursive: true });
const { browser, which } = await launchChrome({ headless: false, args: ['--window-position=0,0', '--window-size=1400,900'] });
try {
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    const score = await ctx.newPage();
    await score.goto('about:blank');
    const b64 = (b: Buffer): string => b.toString('base64');
    for (const id of SCENES) {
        // ---- the sorted reference: the last of the shots until the picture stops changing
        async function settle(qs: string, keepSeries: boolean, reference?: Buffer): Promise<{ last: Buffer; series: Any[]; settledMs: number }> {
            const page = await ctx.newPage();
            const t0 = Date.now();
            await page.goto(`https://superspl.at/s?id=${id}&noanim${qs}`, { waitUntil: 'domcontentloaded' });
            let prev: Buffer | null = null, last: Buffer | null = null;
            const series: Any[] = [];
            let settledMs = 0;
            while (Date.now() - t0 < MAX_MS) {
                await sleep(SHOT_MS);
                last = await page.screenshot({ type: 'png' });
                const row: Any = { tMs: Date.now() - t0 };
                if (keepSeries && reference) row.vsSorted = await score.evaluate(`${SCORE}("${b64(reference)}", "${b64(last)}", ${W}, ${H})`);
                if (prev) {
                    const s = (await score.evaluate(`${SCORE}("${b64(prev)}", "${b64(last)}", ${W}, ${H})`)) as { psnr: number };
                    row.vsPrevious = s.psnr;
                    if (s.psnr > 45 && Date.now() - t0 > 20000) { series.push(row); settledMs = Date.now() - t0; break; }
                }
                series.push(row);
                prev = last;
            }
            await page.close();
            return { last: last!, series, settledMs: settledMs || Date.now() - t0 };
        }
        const sorted = await settle('', false);
        writeFileSync(join(picDir, `${id}-sorted-full.png`), sorted.last);
        console.log(id, 'sorted', sorted.settledMs, 'ms');
        const stoch = await settle('&stochastic', true, sorted.last);
        writeFileSync(join(picDir, `${id}-stochastic-full.png`), stoch.last);
        const final = stoch.series[stoch.series.length - 1]?.vsSorted;
        // the shots that already show the scan (not the black or loading page): the series from the first one that is within 25 dB of anything
        out.scenes[id] = { sortedSettledMs: sorted.settledMs, stochasticSettledMs: stoch.settledMs, stochasticVsSorted: final, series: stoch.series.map((r) => ({ tMs: r.tMs, psnr: r.vsSorted?.psnr, ssim: r.vsSorted?.ssim, vsPrevious: r.vsPrevious })) };
        console.log(id, 'stochastic', stoch.settledMs, 'ms', JSON.stringify(final), 'series', stoch.series.map((r) => r.vsSorted?.psnr).join(' '));
    }
    await ctx.close();
} finally {
    await browser.close().catch(() => undefined);
    release();
}
out.browser = which;
mkdirSync(join(REPO, 'evidence', today()), { recursive: true });
writeFileSync(join(REPO, 'evidence', today(), 'v10-r-supersplat.json'), JSON.stringify(out, null, 2));
console.log('written');
