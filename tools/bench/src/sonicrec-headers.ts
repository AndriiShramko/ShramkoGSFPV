// Fly by Sound, step 1: the two header changes of deploy/nginx.conf, proven in a real browser (headless Chrome, a fake
// microphone, no scan drawn: no GPU lock needed, --disable-gpu).
//   getUserMedia  Permissions-Policy microphone=(self) on /{lang}/fly/ lets the page open the microphone and record
//                 it with MediaRecorder; microphone=() (the config before v0.12) refuses it with NotAllowedError.
//   blob: audio   CSP media-src 'self' blob: lets <audio src=blob:> load (a recording's voice is played that way in the
//                 replay); without media-src the blob is blocked by default-src 'self'.
// The page is served by tools/bench/scripts/serve-csp.mjs, which sends the headers the nginx.conf it reads has (the
// enforced CSP, the Permissions-Policy of the location). The same page is served under four copies of the config:
// the real one, the one before v0.12, and each change reverted alone, so every effect is tied to its own header.
//   npx tsx tools/bench/src/sonicrec-headers.ts      evidence/<date>/sonicrec-headers.json
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchChrome } from './browser';
import { writeEvidence } from './evidence';
import { NGINX_CONF, makeDist, serveDist } from './sonicrec-serve';

const PROBE = String.raw`
const out = { violations: [] };
document.addEventListener('securitypolicyviolation', (e) => out.violations.push({ directive: e.effectiveDirective, blocked: e.blockedURI }));
function wav(seconds, hz) {
    const rate = 8000, n = Math.round(seconds * rate), b = new DataView(new ArrayBuffer(44 + n * 2));
    const s = (o, t) => { for (let i = 0; i < t.length; i++) b.setUint8(o + i, t.charCodeAt(i)); };
    s(0, 'RIFF'); b.setUint32(4, 36 + n * 2, true); s(8, 'WAVEfmt '); b.setUint32(16, 16, true); b.setUint16(20, 1, true); b.setUint16(22, 1, true);
    b.setUint32(24, rate, true); b.setUint32(28, rate * 2, true); b.setUint16(32, 2, true); b.setUint16(34, 16, true); s(36, 'data'); b.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) b.setInt16(44 + i * 2, Math.round(Math.sin(2 * Math.PI * hz * i / rate) * 12000), true);
    return b.buffer;
}
(async () => {
    out.allowsMicrophone = document.featurePolicy && document.featurePolicy.allowsFeature ? document.featurePolicy.allowsFeature('microphone') : null;
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        out.getUserMedia = 'ok';
        const rec = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
        let bytes = 0, slices = 0;
        rec.ondataavailable = (e) => { bytes += e.data.size; slices++; };
        rec.start(250);
        await new Promise((r) => setTimeout(r, 1300));
        await new Promise((r) => { rec.onstop = r; rec.stop(); });
        out.recorderBytes = bytes;
        out.recorderSlices = slices;
        stream.getTracks().forEach((t) => t.stop());
    } catch (e) {
        out.getUserMedia = e.name;
    }
    const a = new Audio();
    out.audioBlob = await new Promise((resolve) => {
        a.onloadedmetadata = () => resolve('loaded ' + a.duration.toFixed(2));
        a.onerror = () => resolve('error');
        setTimeout(() => resolve('timeout'), 4000);
        a.src = URL.createObjectURL(new Blob([wav(0.25, 440)], { type: 'audio/wav' }));
    });
    await new Promise((r) => setTimeout(r, 200));
    window.__probe = out;
})();
`;

interface Probe {
    allowsMicrophone: boolean | null;
    getUserMedia: string;
    recorderBytes?: number;
    recorderSlices?: number;
    audioBlob: string;
    violations: { directive: string; blocked: string }[];
}

const real = readFileSync(NGINX_CONF, 'utf8');
const MIC_FIRST_CUT = ['camera=(), microphone=(self), geolocation=()', 'camera=(), microphone=(), geolocation=()'] as const;
const MEDIA = " media-src 'self' blob:;";
const confs: Record<string, string> = {
    'real': real,
    'first-cut': real.replace(MIC_FIRST_CUT[0], MIC_FIRST_CUT[1]).replace(MEDIA, ''),
    'microphone-reverted-only': real.replace(MIC_FIRST_CUT[0], MIC_FIRST_CUT[1]),
    'media-src-removed-only': real.replace(MEDIA, '')
};
for (const [name, text] of Object.entries(confs)) if (name !== 'real' && text === real) throw new Error(`the config for "${name}" is the real one: nothing was reverted`);

const dist = makeDist({
    'en/fly/index.html': '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>probe</title></head><body><script type="module" src="/fly/assets/probe.js"></script></body></html>',
    'fly/assets/probe.js': PROBE
});

const { browser } = await launchChrome({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--disable-gpu'] });
const results: Record<string, Probe & { policy: string | null; csp: string | null }> = {};
try {
    for (const [name, text] of Object.entries(confs)) {
        const file = join(dist, `nginx-${name}.conf`);
        writeFileSync(file, text);
        const served = await serveDist(dist, { NGINX_CONF: file });
        try {
            const context = await browser.newContext();
            await context.grantPermissions(['microphone'], { origin: served.origin });
            const page = await context.newPage();
            const response = await page.goto(`${served.origin}/en/fly/`);
            await page.waitForFunction(() => (window as unknown as { __probe?: unknown }).__probe !== undefined, null, { timeout: 30000 });
            const probe = (await page.evaluate(() => (window as unknown as { __probe: unknown }).__probe)) as Probe;
            results[name] = { ...probe, policy: response?.headers()['permissions-policy'] ?? null, csp: response?.headers()['content-security-policy'] ?? null };
            await context.close();
        } finally {
            await served.stop();
        }
        console.log(name, JSON.stringify({ ...results[name], policy: undefined, csp: undefined }));
    }
} finally {
    await browser.close();
    rmSync(dist, { recursive: true, force: true });
}

const r = results as Record<string, Probe>;
const checks = {
    'real: getUserMedia opens the microphone and MediaRecorder records it': r['real']!.getUserMedia === 'ok' && (r['real']!.recorderBytes ?? 0) > 1000 && r['real']!.allowsMicrophone === true,
    'real: a blob: audio loads under the enforced CSP': (r['real']!.audioBlob).startsWith('loaded') && r['real']!.violations.length === 0,
    'control, first cut: getUserMedia is refused': r['first-cut']!.getUserMedia === 'NotAllowedError' && r['first-cut']!.allowsMicrophone === false,
    'control, first cut: a blob: audio is blocked by the CSP': !(r['first-cut']!.audioBlob).startsWith('loaded') && r['first-cut']!.violations.some((v) => v.directive === 'media-src'),
    'the microphone alone (media-src kept): getUserMedia refused, blob audio loads': r['microphone-reverted-only']!.getUserMedia === 'NotAllowedError' && r['microphone-reverted-only']!.audioBlob.startsWith('loaded'),
    'media-src alone (microphone kept): getUserMedia ok, blob audio blocked': r['media-src-removed-only']!.getUserMedia === 'ok' && !r['media-src-removed-only']!.audioBlob.startsWith('loaded')
};
const pass = Object.values(checks).every(Boolean);
writeEvidence('sonicrec-headers', {
    pass,
    checks,
    results: Object.fromEntries(Object.entries(results).map(([k, v]) => [k, { ...v, csp: undefined, permissionsPolicyMicrophone: /(?:^|,\s*)microphone=\(([^)]*)\)/.exec(v.policy ?? '')?.[1] ?? null, cspHasMediaSrcBlob: (v.csp ?? '').includes("media-src 'self' blob:") }])),
    note: 'headless Chrome with --use-fake-device-for-media-stream and --use-fake-ui-for-media-stream; no scan drawn; the page and the headers come from tools/bench/scripts/serve-csp.mjs reading each copy of deploy/nginx.conf'
});
console.log(pass ? 'sonicrec-headers PASS' : `sonicrec-headers FAIL ${JSON.stringify(checks)}`);
process.exit(pass ? 0 : 1);
