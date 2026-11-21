// Lane head4, stage H4: the acceptance of "Turn my head to listen" (Fly by Sound) on a served release, the pilot's own path
// with the MOUSE at 1536 x 730, device scale 1.25. Chrome's flags stand in for the web camera (a Motion-JPEG clip of a still
// portrait turned in its plane, made by head4-tracker.mjs) and auto-answer the browser's camera question
// (--use-fake-ui-for-media-stream: the page still goes through the question, the permission starts as 'prompt').
//
// Steps, each PASS or FAIL in one JSON:
//   rowShown          the sound settings have the row "Turn my head to listen", off by default
//   offLoadsNothing   with it off, nothing of head tracking is downloaded and no camera is opened
//   flyPageMayAsk     the simulator page's Permissions-Policy lets it ask for the camera
//   explainedFirst    a click on the row: the explanation is said before the camera is asked
//   cameraOn          the camera opens (the permission 'granted' after; Chrome's fake answer reports it granted before too),
//                     the row stays on, "on" is said
//   trackerFiles      the face tracker's files come from our own origin under /fly/headtrack/ (sizes reported)
//   picturesStayHere  while the camera runs, nothing is sent: no request other than GET, none to another origin
//   offStopsCamera    a second click: the camera's track ends and "off" is said
//   centreKey         on again, a lesson started by the mouse, a click into the scene, key Shift+H: "Centred." is said
//   listenerTurns     in the lesson the page's AudioListener turns with the picture (its up vector moves as the portrait rolls)
//   refusalSaid       in a browser that refuses the camera (no fake answer: Playwright's Chrome says no), a click on the
//                     row says what is wrong and what to do, and the row is off again
//   otherPageRefuses  the site's other pages may not use the camera (the landing page's getUserMedia is refused)
//
// Usage: node tools/bench/scripts/head4-accept.mjs <base, e.g. http://localhost:6142> <out.json> [clip.mjpeg]
// The base serves a release (node tools/bench/scripts/serve-csp.mjs dist <port>) or is the live site (read-only: the steps
// keep the setting in this browser's own storage, nothing is saved, sent or created on the site). ?render=off: no GPU lock.
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { pickHarnessBrowser } from './visual-browser.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '');
const require = createRequire(ROOT + '/tools/bench/package.json');
const { chromium } = require('playwright');
const [base = 'http://localhost:6142', outFile = 'U:/Temp/gsfpv-train4/head4/accept.json', clip = 'U:/Temp/gsfpv-train4/head4/head4-clip.mjpeg'] = process.argv.slice(2);
if (!existsSync(clip)) throw new Error(`no clip at ${clip}: run head4-tracker.mjs first (it makes the clip beside the portrait)`);
const origin = new URL(base).origin;
const EN = JSON.parse(readFileSync(`${ROOT}/packages/i18n/locales/fly/sonichead/en.json`, 'utf8'));
const LINE = (id) => EN[`sonichead.say.${id}`].replace('{key}', 'Shift+H');
const HEAD_FILE = /\/fly\/headtrack\/|face-worker|face-tracker|\/tracking-[\w-]+\.js/;

// in the page, before its own scripts: the spoken lines (Web Speech, ended after 30 ms: headless Chrome has no voice), the
// camera calls and the audio contexts, so the listener can be read
function spy() {
    const w = window;
    w.__said = [];
    w.__gum = [];
    w.__acs = [];
    const synth = w.speechSynthesis;
    if (synth) {
        synth.speak = (u) => {
            w.__said.push({ t: performance.now(), text: u.text });
            setTimeout(() => {
                u.dispatchEvent(new Event('start'));
                u.dispatchEvent(new Event('end'));
            }, 30);
        };
        synth.cancel = () => {};
    }
    const md = navigator.mediaDevices;
    if (md?.getUserMedia) {
        const gum = md.getUserMedia.bind(md);
        md.getUserMedia = async (c) => {
            const rec = { t: performance.now(), video: !!c?.video, result: 'pending', stream: null };
            w.__gum.push(rec);
            try {
                const s = await gum(c);
                rec.result = 'ok';
                rec.stream = s;
                return s;
            } catch (e) {
                rec.result = e?.name ?? 'error';
                throw e;
            }
        };
    }
    const A = w.AudioContext;
    if (A) w.AudioContext = class extends A { constructor(...a) { super(...a); w.__acs.push(this); } };
}

const pick = pickHarnessBrowser({ expected: chromium.executablePath() }, false);
const browser = await chromium.launch({
    ...pick.launch,
    args: [...(pick.launch.args ?? []), '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-video-capture=${clip}`, '--autoplay-policy=no-user-gesture-required']
});
const steps = {};
const facts = {};
const errors = [];
const requests = [];
const step = (name, pass, fact) => {
    steps[name] = pass ? 'PASS' : 'FAIL';
    if (fact !== undefined) facts[name] = fact;
};
const said = (page) => page.evaluate(() => window.__said.map((s) => ({ t: Math.round(s.t), text: s.text })));
const waitSaid = (page, text, ms) => page.waitForFunction((x) => window.__said.some((s) => s.text.includes(x)), text, { timeout: ms }).then(() => true, () => false);
const cam = (page) => page.evaluate(() => window.__gum.map((g) => ({ t: Math.round(g.t), video: g.video, result: g.result, track: g.stream?.getVideoTracks()[0]?.readyState ?? null })));
const camPermission = (page) => page.evaluate(async () => { try { return (await navigator.permissions.query({ name: 'camera' })).state; } catch (e) { return String(e?.name); } });
const allows = (page) => page.evaluate(() => document.featurePolicy?.allowsFeature('camera') ?? null);

try {
    const ctx = await browser.newContext({ viewport: { width: 1536, height: 730 }, deviceScaleFactor: 1.25 });
    await ctx.addInitScript(spy);
    ctx.on('request', (r) => requests.push({ at: Date.now(), url: r.url(), method: r.method(), post: (r.postDataBuffer()?.length ?? 0), req: r }));
    ctx.on('response', (r) => r.status() >= 400 && errors.push(`${r.status()} ${r.url()}`.slice(0, 200)));
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)));
    page.on('console', (m) => m.type() === 'error' && !/^(INFO|[IW]\d{4})/.test(m.text()) && errors.push(`${m.text()} at ${m.location().url}`.slice(0, 240)));

    // 1. the start screen, the setting off
    await page.goto(`${base}/en/fly/?sonic=start&render=off`, { waitUntil: 'load' });
    await page.waitForSelector('[data-testid="sonic-start"]', { timeout: 60_000 });
    await page.waitForTimeout(2500);
    const row = page.locator('[data-testid="sonic-head"]');
    const rowCount = await row.count();
    const rowText = rowCount ? (await page.locator('label[for="sonic-head"]').textContent())?.trim() : null;
    step('rowShown', rowCount === 1 && rowText === EN['sonichead.setting'] && !(await row.isChecked()), { rowCount, rowText });
    const early = requests.filter((r) => HEAD_FILE.test(r.url)).map((r) => r.url);
    step('offLoadsNothing', early.length === 0 && (await cam(page)).length === 0, { headFilesBeforeOn: early });
    const permBefore = await camPermission(page);
    step('flyPageMayAsk', (await allows(page)) === true, { allowsCamera: await allows(page), permissionBefore: permBefore });

    if (rowCount === 1) {
        // 2. on, with the mouse
        await page.locator('label[for="sonic-head"]').scrollIntoViewIfNeeded();
        const tOn = Date.now();
        await page.locator('label[for="sonic-head"]').click();
        const onSaid = await waitSaid(page, LINE('on'), 60_000);
        const lines = await said(page);
        const calls = await cam(page);
        const ask = lines.find((s) => s.text === LINE('ask'));
        const firstCall = calls.find((c) => c.video);
        step('explainedFirst', !!ask && !!firstCall && ask.t < firstCall.t, { askAt: ask?.t ?? null, cameraAskedAt: firstCall?.t ?? null });
        const permAfter = await camPermission(page);
        step('cameraOn', onSaid && permAfter === 'granted' && firstCall?.track === 'live' && (await row.isChecked()), { permissionBefore: permBefore, permissionAfter: permAfter, calls, onAfterMs: Date.now() - tOn });
        await page.waitForTimeout(500);
        const files = [];
        for (const r of requests.filter((x) => HEAD_FILE.test(x.url))) {
            const res = await r.req.response();
            const sizes = await r.req.sizes().catch(() => null);
            files.push({ path: new URL(r.url).pathname, status: res?.status() ?? null, bytes: sizes?.responseBodySize ?? null, encoding: (await res?.allHeaders().catch(() => ({})))?.['content-encoding'] ?? null });
        }
        const need = ['face_landmarker.task', 'vision_wasm_module_internal.wasm', 'vision_wasm_module_internal.js'];
        step('trackerFiles', need.every((n) => files.some((f) => f.path === `/fly/headtrack/${n}` && f.status === 200)) && files.every((f) => new URL(f.path, origin).origin === origin), files);

        const tCam = Date.now();
        const sent = requests.filter((r) => r.at >= tOn && (r.method !== 'GET' || r.post > 0 || new URL(r.url).origin !== origin)).map((r) => `${r.method} ${r.url}`.slice(0, 160));
        step('picturesStayHere', sent.length === 0, { sentWhileCamera: sent, requestsWhileCamera: requests.filter((r) => r.at >= tCam).length });

        // 4. off: the track ends
        await page.locator('label[for="sonic-head"]').click();
        const offSaid = await waitSaid(page, LINE('off'), 15_000);
        await page.waitForTimeout(300);
        const after = await cam(page);
        step('offStopsCamera', offSaid && after.length > 0 && after.every((c) => c.track !== 'live') && !(await row.isChecked()), after);

        // 5. on again, a lesson by the mouse, a click into the scene, Shift+H
        const n = (await said(page)).length;
        await page.locator('label[for="sonic-head"]').click();
        const onAgain = await page.waitForFunction(([k, x]) => window.__said.slice(k).some((s) => s.text === x), [n, LINE('on')], { timeout: 60_000 }).then(() => true, () => false);
        // int4: sound6 replaced 'Start the course from the beginning' with Quick start and Full course (sonic-start-screen.test.ts
        // expects no sonic-start-beginning); Quick start is the first lesson by the mouse, as the step meant
        await page.locator('[data-testid="sonic-start-quick"]').click();
        await page.waitForTimeout(4000);
        await page.mouse.click(768, 365);
        await page.waitForTimeout(500);
        const m = (await said(page)).length;
        await page.keyboard.press('Shift+KeyH');
        const centred = await page.waitForFunction(([k, x]) => window.__said.slice(k).some((s) => s.text === x), [m, LINE('centred')], { timeout: 10_000 }).then(() => true, () => false);
        step('centreKey', onAgain && centred, { onAgain, centred, linesAfterKey: (await said(page)).slice(m).map((s) => s.text.slice(0, 80)) });
        // the listener follows the picture for 5 s (the sound runs from the lesson's start: before it there is no listener)
        const ups = [];
        for (let i = 0; i < 25; i++) {
            await page.waitForTimeout(200);
            ups.push(await page.evaluate(() => {
                const l = window.__acs.at(-1)?.listener;
                return l?.upX ? [l.upX.value, l.upY.value, l.forwardX.value, l.forwardZ.value].map((v) => Math.round(v * 1000) / 1000) : null;
            }));
        }
        const upX = ups.filter(Boolean).map((u) => u[0]);
        const range = upX.length ? Math.max(...upX) - Math.min(...upX) : 0;
        step('listenerTurns', range > 0.1, { upXRange: Math.round(range * 1000) / 1000, samples: ups.slice(0, 25) });
    } else {
        for (const s of ['explainedFirst', 'cameraOn', 'trackerFiles', 'listenerTurns', 'picturesStayHere', 'offStopsCamera', 'centreKey', 'refusalSaid']) step(s, false, 'no row: not run');
    }
    facts.said = (await said(page)).map((s) => s.text.slice(0, 90));

    // 6. another page of the site may not use the camera
    const other = await ctx.newPage();
    await other.goto(`${base}/en/`, { waitUntil: 'load' });
    const otherAllows = await allows(other);
    const otherGum = await other.evaluate(async () => { try { const s = await navigator.mediaDevices.getUserMedia({ video: true }); s.getTracks().forEach((t) => t.stop()); return 'ok'; } catch (e) { return String(e?.name); } });
    step('otherPageRefuses', otherAllows === false && otherGum === 'NotAllowedError', { allowsCamera: otherAllows, getUserMedia: otherGum });
} catch (e) {
    errors.push(String(e).slice(0, 300));
} finally {
    await browser.close();
}

// 7. a browser that refuses the camera
if (steps.rowShown === 'PASS') {
    const b2 = await chromium.launch({ ...pick.launch, args: [...(pick.launch.args ?? []), '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
    try {
        const ctx = await b2.newContext({ viewport: { width: 1536, height: 730 }, deviceScaleFactor: 1.25 });
        await ctx.addInitScript(spy);
        const page = await ctx.newPage();
        await page.goto(`${base}/en/fly/?sonic=start&render=off`, { waitUntil: 'load' });
        await page.waitForSelector('[data-testid="sonic-start"]', { timeout: 60_000 });
        const before = await camPermission(page);
        await page.locator('label[for="sonic-head"]').click();
        const deniedSaid = await waitSaid(page, LINE('denied'), 30_000);
        await page.waitForTimeout(300);
        const checked = await page.locator('[data-testid="sonic-head"]').isChecked();
        step('refusalSaid', deniedSaid && !checked, { permissionBefore: before, deniedSaid, rowOnAfter: checked, calls: await cam(page) });
    } catch (e) {
        errors.push(String(e).slice(0, 300));
    } finally {
        await b2.close();
    }
}

const verdict = { probe: 'head4-accept', base, browser: pick.kind, viewport: '1536x730@1.25', steps, pass: Object.keys(steps).length === 12 && Object.values(steps).every((s) => s === 'PASS'), facts, errors };
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify(verdict, null, 1));
console.log(JSON.stringify({ probe: verdict.probe, base, pass: verdict.pass, steps, errors: errors.slice(0, 5) }));
process.exit(verdict.pass ? 0 : 1);
