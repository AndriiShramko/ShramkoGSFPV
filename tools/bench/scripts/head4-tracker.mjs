// Lane head4, stage H3: the face tracker on a fake camera. Chrome's flags feed a Motion-JPEG file to getUserMedia
// (--use-file-for-fake-video-capture); the lab page apps/fly/lab/head.html runs the real tracking module (camera, worker,
// pose filter, listener turn) on it and records numbers per camera picture. This prints one JSON verdict and exits 1 on a
// failure.
//
// The clip is made here from one still portrait (a face photo given as argument; not stored in the repository): 8 s at
// 30 pictures a second, the picture turned in its plane (the head's roll) 0 -> +20 -> -20 -> 0 degrees, then 1 s without a
// face. Only roll has a true value in such a clip (a flat picture cannot turn the head left or right): yaw and pitch are
// reported, not judged. Reports: pose per picture, the worker's time per picture, the share of pictures with a face, the
// delay from the camera's picture time to the listener's turn, and that "head lost" was said in the faceless second.
//
// Usage: node tools/bench/scripts/head4-tracker.mjs <dev server base, e.g. http://localhost:6141> <portrait.jpg> <out.json> [seconds]
// The dev server: cd apps/fly && npx vite --port 6141 --strictPort. No drawing is judged: it needs no GPU lock.
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pickHarnessBrowser } from './visual-browser.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '');
const require = createRequire(ROOT + '/tools/bench/package.json');
const { chromium } = require('playwright');
const [base = 'http://localhost:6141', portrait = 'U:/Temp/gsfpv-train4/head4/portrait.jpg', outFile = 'U:/Temp/gsfpv-train4/head4/tracker.json'] = process.argv.slice(2);
const seconds = Number(process.argv[5] ?? 12);
const FPS = 30;
const CLIP_S = 8;
const FACELESS_FROM_S = 7;
// beside the portrait, an absolute path (Chrome's flag opens it as given); never in the repository
const clip = resolve(dirname(portrait), 'head4-clip.mjpeg');

/** the clip's roll at time s (degrees the picture is turned clockwise on the screen), null where no face is shown */
function scriptRoll(s) {
    const t = ((s % CLIP_S) + CLIP_S) % CLIP_S;
    if (t >= FACELESS_FROM_S) return null;
    if (t < 1) return 0;
    if (t < 2) return 20 * (t - 1);
    if (t < 3) return 20;
    if (t < 5) return 20 - 20 * (t - 3);
    if (t < 6) return -20;
    return -20 + 20 * (t - 6);
}

/** in the page: the clip's pictures as JPEG bytes (base64), drawn on a 640 x 480 canvas */
async function drawClip({ dataUrl, frames, fps, faceless, rolls }) {
    const img = new Image();
    img.src = dataUrl;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = 640;
    c.height = 480;
    const g = c.getContext('2d');
    const h = 440, w = (img.width / img.height) * h;
    const out = [];
    for (let i = 0; i < frames; i++) {
        g.fillStyle = '#6b6f73';
        g.fillRect(0, 0, 640, 480);
        if (i / fps < faceless) {
            g.save();
            g.translate(320, 240);
            g.rotate((rolls[i] * Math.PI) / 180);
            g.drawImage(img, -w / 2, -h / 2, w, h);
            g.restore();
        }
        const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
        const buf = new Uint8Array(await blob.arrayBuffer());
        let s = '';
        for (let k = 0; k < buf.length; k += 0x8000) s += String.fromCharCode(...buf.subarray(k, k + 0x8000));
        out.push(btoa(s));
    }
    return out;
}

const pct = (xs, p) => {
    if (!xs.length) return null;
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const r1 = (x) => (x === null || x === undefined ? null : Math.round(x * 10) / 10);

/** Pearson correlation and least-squares gain of y on x */
function fit(x, y) {
    const n = x.length;
    if (n < 3) return { r: 0, gain: 0, n };
    const mx = x.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n;
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < n; i++) {
        sxy += (x[i] - mx) * (y[i] - my);
        sxx += (x[i] - mx) ** 2;
        syy += (y[i] - my) ** 2;
    }
    return { r: sxy / Math.sqrt(sxx * syy || 1), gain: sxy / (sxx || 1), n };
}

mkdirSync(dirname(outFile), { recursive: true });
const pick = pickHarnessBrowser({ expected: chromium.executablePath() }, false);
const verdict = { probe: 'head4-tracker', base, browser: pick.kind, checks: {}, pass: false };

// 1. the clip
if (!existsSync(clip)) {
    const b = await chromium.launch({ ...pick.launch });
    const page = await b.newPage();
    const frames = FPS * CLIP_S;
    const rolls = Array.from({ length: frames }, (_, i) => scriptRoll(i / FPS) ?? 0);
    const jpegs = await page.evaluate(drawClip, { dataUrl: 'data:image/jpeg;base64,' + readFileSync(portrait).toString('base64'), frames, fps: FPS, faceless: FACELESS_FROM_S, rolls });
    await b.close();
    writeFileSync(clip, Buffer.concat(jpegs.map((s) => Buffer.from(s, 'base64'))));
}

// 2. the tracker on the fake camera
const browser = await chromium.launch({
    ...pick.launch,
    args: [...(pick.launch.args ?? []), '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-video-capture=${clip}`, '--autoplay-policy=no-user-gesture-required']
});
const errors = [];
let lab = null;
try {
    const ctx = await browser.newContext();
    await ctx.grantPermissions(['camera'], { origin: new URL(base).origin });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)));
    // MediaPipe writes its INFO lines to console.error: those are not errors
    page.on('console', (m) => m.type() === 'error' && !/^(INFO|[IW]\d{4})/.test(m.text()) && errors.push(`${m.text()} at ${m.location().url}`.slice(0, 240)));
    ctx.on('response', (r) => r.status() >= 400 && errors.push(`${r.status()} ${r.url()}`.slice(0, 200)));
    await page.goto(`${base}/fly/lab/head.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.__headLab, null, { timeout: 60_000 });
    lab = await page.evaluate((s) => window.__headLab.run(s), seconds);
} catch (e) {
    errors.push(String(e).slice(0, 300));
} finally {
    await browser.close();
}

// 3. the numbers
const rows = lab?.rows ?? [];
const t0 = rows[0]?.tMs ?? 0;
// the clip's phase is not known (the fake camera starts it when it opens): take the offset that fits the script best
let best = { off: 0, r: 0, gain: 0, n: 0 };
for (let off = 0; off < CLIP_S * 1000; off += 1000 / FPS) {
    const x = [], y = [];
    for (const row of rows) {
        const want = scriptRoll((row.tMs - t0 + off) / 1000);
        if (want !== null && row.raw) {
            x.push(want);
            y.push(row.raw.rollDeg);
        }
    }
    const f = fit(x, y);
    if (Math.abs(f.r) > Math.abs(best.r)) best = { off, ...f };
}
const phase = (row) => scriptRoll((row.tMs - t0 + best.off) / 1000);
const facePics = rows.filter((r) => phase(r) !== null);
const facelessPics = rows.filter((r) => phase(r) === null);
const delays = rows.map((r) => r.appliedMs - r.tMs);
const work = rows.map((r) => r.workMs).filter((x) => x >= 0);
const gaps = rows.slice(1).map((r, i) => r.tMs - rows[i].tMs);
const lost = (lab?.said ?? []).filter((s) => s.id === 'lost').length;
const stat = {
    result: lab?.result ?? null,
    loadMs: r1(lab?.loadMs ?? null),
    pictures: rows.length,
    picturesPerSecond: r1(rows.length / seconds),
    gapMs: { p50: r1(pct(gaps, 50)), p95: r1(pct(gaps, 95)) },
    workMs: { p50: r1(pct(work, 50)), p95: r1(pct(work, 95)), max: r1(pct(work, 100)) },
    faceShareWithFace: r1((100 * facePics.filter((r) => r.face).length) / (facePics.length || 1)),
    faceShareFaceless: r1((100 * facelessPics.filter((r) => r.face).length) / (facelessPics.length || 1)),
    cameraToListenerMs: { p50: r1(pct(delays, 50)), p95: r1(pct(delays, 95)) },
    audioOutputLatencyMs: r1(lab?.outputLatencyMs ?? null),
    audioBaseLatencyMs: r1(lab?.baseLatencyMs ?? null),
    roll: { r: Math.round(best.r * 1000) / 1000, gain: Math.round(best.gain * 1000) / 1000, pictures: best.n, offsetMs: Math.round(best.off) },
    yawDegRange: [r1(Math.min(...rows.filter((r) => r.raw).map((r) => r.raw.yawDeg))), r1(Math.max(...rows.filter((r) => r.raw).map((r) => r.raw.yawDeg)))],
    pitchDegRange: [r1(Math.min(...rows.filter((r) => r.raw).map((r) => r.raw.pitchDeg))), r1(Math.max(...rows.filter((r) => r.raw).map((r) => r.raw.pitchDeg)))],
    said: (lab?.said ?? []).map((s) => s.id)
};
verdict.checks = {
    started: stat.result === 'on',
    picturesRead: rows.length >= seconds * 10,
    faceFound: stat.faceShareWithFace >= 90,
    noFaceInBlank: facelessPics.length > 0 && stat.faceShareFaceless <= 10,
    // the picture turned clockwise on the screen is the pilot's head tipped to the left: rollDeg follows with the opposite sign
    rollFollows: Math.abs(best.r) >= 0.9 && best.gain < -0.7 && best.gain > -1.3,
    lostSaid: lost >= 1,
    delayUnder100ms: stat.cameraToListenerMs.p50 !== null && stat.cameraToListenerMs.p50 < 100,
    noPageErrors: errors.length === 0
};
verdict.pass = Object.values(verdict.checks).every(Boolean);
verdict.stat = stat;
verdict.errors = errors;
writeFileSync(outFile, JSON.stringify({ ...verdict, rows: rows.map((r) => ({ t: r1(r.tMs - t0), w: r1(r.workMs), d: r1(r.appliedMs - r.tMs), raw: r.raw ? [r1(r.raw.yawDeg), r1(r.raw.pitchDeg), r1(r.raw.rollDeg)] : null, ears: [r1(r.ears.yawDeg), r1(r.ears.pitchDeg), r1(r.ears.rollDeg)] })) }, null, 1));
console.log(JSON.stringify(verdict));
process.exit(verdict.pass ? 0 : 1);
