// Scores the pictures of lod-view-probe.mjs runs against the pictures of a reference run (the same places and turns at a
// much higher splat budget, on the same adapter, drawing and window): how close is each small-budget picture to what the
// scan really looks like from there? (Lane lod-view, docs/wip/lod-view.md.)
//
// For every picture name both runs have (start, up40, up140, turn-<name>-0 / -1 / -end): PSNR on luma at full size and at a
// quarter of the size (4x4 pixels averaged: less sensitive to where single splats fall), in dB; higher is closer. A turn's
// pictures are all scored against the reference's picture at the END of that turn's hold: what the view should become.
// The pictures are PNGs under .cache/lod-view (the probe writes them); they are decoded and compared in a headless browser
// page, so no image library is needed.
//
//   node tools/bench/scripts/lod-view-score.mjs --ref ref16 lublin-1m-base lublin-1m-view
// Output: a table, and evidence/<date>/lod-view/score-<ref>.json.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { asciiJson, browserExe } from './gpu-select-probe.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DIR = join(REPO, '.cache', 'lod-view');

/** In the page: two PNGs (base64) decoded and compared. */
const COMPARE = async ({ a, b }) => {
    const dec = async (b64) => {
        const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const bmp = await createImageBitmap(new Blob([bin], { type: 'image/png' }));
        const c = new OffscreenCanvas(bmp.width, bmp.height);
        const g = c.getContext('2d');
        g.drawImage(bmp, 0, 0);
        return g.getImageData(0, 0, bmp.width, bmp.height);
    };
    const A = await dec(a);
    const B = await dec(b);
    if (A.width !== B.width || A.height !== B.height) return { error: `sizes differ: ${A.width}x${A.height} and ${B.width}x${B.height}` };
    const w = A.width, h = A.height, n = w * h;
    const la = new Float32Array(n), lb = new Float32Array(n);
    let e = 0, lit = 0;
    for (let i = 0; i < n; i++) {
        const k = i * 4;
        la[i] = 0.299 * A.data[k] + 0.587 * A.data[k + 1] + 0.114 * A.data[k + 2];
        lb[i] = 0.299 * B.data[k] + 0.587 * B.data[k + 1] + 0.114 * B.data[k + 2];
        const d = la[i] - lb[i];
        e += d * d;
        if (la[i] > 4) lit++;
    }
    const db = (mse) => (mse <= 0 ? 99 : Math.round(10 * Math.log10(255 * 255 / mse) * 100) / 100);
    // a quarter of the size: 4x4 pixels averaged
    const qw = w >> 2, qh = h >> 2;
    let eq = 0;
    for (let y = 0; y < qh; y++) {
        for (let x = 0; x < qw; x++) {
            let sa = 0, sb = 0;
            for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++) { const i = (y * 4 + dy) * w + x * 4 + dx; sa += la[i]; sb += lb[i]; }
            const d = (sa - sb) / 16;
            eq += d * d;
        }
    }
    // the part of the reference that is not black sky: the score over the scan itself is what matters when most of a picture is sky
    return { width: w, height: h, psnr: db(e / n), psnrQuarter: db(eq / (qw * qh)), litShare: Math.round(lit / n * 1000) / 1000, psnrLit: lit > 0 ? db(e / lit) : null };
};

async function main() {
    const argv = process.argv.slice(2);
    let ref = '';
    const labels = [];
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--ref') ref = argv[++i];
        else labels.push(argv[i]);
    }
    if (!ref || !labels.length) throw new Error('usage: lod-view-score.mjs --ref <label> <label> [<label> ...]');
    if (!existsSync(DIR)) throw new Error(`no pictures: ${DIR}`);
    const names = readdirSync(DIR).filter((f) => f.startsWith(`${ref}-`) && f.endsWith('.png')).map((f) => f.slice(ref.length + 1, -4));
    const b64 = (label, name) => readFileSync(join(DIR, `${label}-${name}.png`)).toString('base64');
    // a turn's pictures are judged against what the view becomes in the reference: its picture at the end of the hold
    const refFor = (name) => (/^turn-.*-(0|1)$/.test(name) ? name.replace(/-(0|1)$/, '-end') : name);
    const exe = browserExe('chrome');
    const browser = await chromium.launch({ headless: true, ...(exe ? { executablePath: exe } : {}) });
    const page = await browser.newPage();
    await page.goto('about:blank');
    const rows = [];
    try {
        for (const label of labels) {
            for (const name of [...names, ...names.filter((x) => /-end$/.test(x)).flatMap((x) => [x.replace(/-end$/, '-0'), x.replace(/-end$/, '-1')])]) {
                if (rows.some((r) => r.label === label && r.picture === name)) continue;
                if (!existsSync(join(DIR, `${label}-${name}.png`)) || !existsSync(join(DIR, `${ref}-${refFor(name)}.png`))) continue;
                const r = await page.evaluate(COMPARE, { a: b64(ref, refFor(name)), b: b64(label, name) });
                rows.push({ label, picture: name, against: `${ref}-${refFor(name)}`, ...r });
            }
        }
    } finally {
        await browser.close();
    }
    const pictures = [...new Set(rows.map((r) => r.picture))];
    const pad = (s, n) => String(s).padEnd(n);
    console.log(`PSNR on luma against ${ref}, dB: over the scan (the reference's lit pixels) / at a quarter of the size`);
    console.log(pad('picture', 22) + labels.map((l) => pad(l, 26)).join(''));
    for (const p of pictures) console.log(pad(p, 22) + labels.map((l) => { const r = rows.find((x) => x.label === l && x.picture === p); return pad(r ? (r.error ? 'error' : `${r.psnrLit} / ${r.psnrQuarter}`) : '-', 26); }).join(''));
    const outDir = join(REPO, 'evidence', new Date().toISOString().slice(0, 10), 'lod-view');
    mkdirSync(outDir, { recursive: true });
    const file = join(outDir, `score-${ref}-${labels[0]}.json`);
    writeFileSync(file, asciiJson(JSON.stringify({ name: `lod-view/score-${ref}`, date: new Date().toISOString(), reference: ref, labels, measure: 'PSNR on luma in dB against the reference run\'s picture of the same place (a turn\'s pictures against the reference at the end of that turn): psnr over the whole picture, psnrLit over the reference\'s lit pixels (the scan, not the black sky), psnrQuarter with 4x4 pixels averaged', rows }, null, 1)) + '\n');
    console.log(`written ${file.replace(REPO, '.').replace(/\\/g, '/')}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === resolve(process.argv[1]).toLowerCase()) await main();
