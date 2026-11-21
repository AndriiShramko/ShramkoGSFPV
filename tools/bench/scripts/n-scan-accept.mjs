// Lane n-scan S4 (docs/wip/n-scan.md): the acceptance. Every scan kind of superspl.at opens to its first flown frame,
// or says in one named line why not; never an endless loader.
// For every id of packages/scenes/test/fixtures/superspl-kinds.json (a39abad1 first) it opens <base>/fly/?scene=<id> in a
// fresh headless page at 1536 x 730, device scale 1.25, and passes the id when
//   flies:  the hook says 'ready'; drawn mode: the engine draws splats (app.stats.frame.gsplats > 0, 3 samples in a row);
//           then the MOUSE clicks into the scene (the pointer lock first) and the simulation steps (sim.tick grows) = the
//           first flown frame; drawn mode: the picture is not empty (at least MINLIT of the pixels differ from the clear colour)
//   a line: the hook says 'error' and the scene list's error line (.scene-error) is exactly the English line expected
// Expected per kind: 'gsaf' -> the line scenes.unsupported; 'sog-v2-heavy' -> flies OR the line scene.open.too-large
// (the device decides); every other kind flies. No page error and no CSP violation either way.
//   node tools/bench/scripts/n-scan-accept.mjs <base with /en> <out.json> [ids, comma separated]
// env: RENDER=off (logic only, no GPU: the splat count and the picture are not judged; the live negative control),
// MAXS (240 s per id), SHOTS (U:/Temp/gsfpv-train4/shots), MINLIT (0.005: an object scan on the clear colour, a5d25fb4, lights 1.3 %). Drawn mode takes no GPU lock itself: wrap it.
// Writes the picture of a39abad1 in flight (drawn mode only). Prints one JSON verdict and exits 1 when any id fails.
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pickBrowser } from '../src/chrome.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [base, outFile, idsArg] = process.argv.slice(2);
if (!base || !outFile) {
    console.error('usage: n-scan-accept.mjs <base with /en> <out.json> [ids]');
    process.exit(2);
}
console.log(`n-scan-accept: ${base}`);
const DRAWN = process.env.RENDER !== 'off';
const MAXS = Number(process.env.MAXS || 240);
const SHOTS = process.env.SHOTS || 'U:/Temp/gsfpv-train4/shots';
const MINLIT = Number(process.env.MINLIT || 0.005);
const repo = new URL('../../../', import.meta.url);
const EN = JSON.parse(readFileSync(new URL('packages/i18n/locales/fly/en.json', repo), 'utf8'));
const KINDS = JSON.parse(readFileSync(new URL('packages/scenes/test/fixtures/superspl-kinds.json', repo), 'utf8')).kinds;
const ORDER = ['a39abad1', ...KINDS.map((k) => k.id).filter((id) => id !== 'a39abad1')];
const IDS = idsArg ? idsArg.split(',').filter(Boolean) : ORDER;
/** what each kind must do: fly, and/or show one of these lines */
const expectOf = (kind) =>
    kind === 'gsaf' ? { flies: false, lines: ['scenes.unsupported'] }
    : kind === 'sog-v2-heavy' ? { flies: true, lines: ['scene.open.too-large'] }
    : { flies: true, lines: [] };
/** a single file over HEAVY_BYTES (open-error.ts) says before its download why it takes minutes: scene.open.heavy */
const HEAVY_KINDS = new Set(['sog-v2-heavy', 'compressed-ply-large']);
const HEAVY_RE = new RegExp(EN['scene.open.heavy'].replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace('\\{mb\\}', '\\d+').replace('{mb}', '\\d+'));
mkdirSync(SHOTS, { recursive: true });

const STATE = `(() => {
    const h = window.__gsfpv || {}; const s = h.session; const r = s && s.renderer; const a = r && r.app;
    const e = document.querySelector('.scene-error');
    return { status: h.status || null, errorCode: h.errorCode || null, error: h.error ? String(h.error).slice(0, 200) : null,
        line: e ? e.textContent : null, notes: [...document.querySelectorAll('.msg-stack')].map((m) => m.textContent).join(' | '), drawn: a ? a.stats.frame.gsplats : null,
        stage: h.loading ? h.loading.stage : null, loaded: h.loading ? h.loading.loaded : null, total: h.loading ? h.loading.total : null,
        tick: s && s.sim ? s.sim.tick : null, paused: s ? !!s.paused : null, locked: !!document.pointerLockElement };
})()`;
const CLEAR = `(() => { const c = window.__gsfpv.session.renderer.camera.camera.clearColor; return [c.r, c.g, c.b].map((v) => Math.round(v * 255)); })()`;
// decoded in a separate blank page, so the app's CSP never sees a data: image
const LIT = (b64, clear) => `(async () => {
    const img = new Image(); img.src = 'data:image/png;base64,${b64}'; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0); const d = g.getImageData(0, 0, c.width, c.height).data;
    const k = ${JSON.stringify(clear)}; let n = 0, lit = 0;
    for (let i = 0; i < d.length; i += 8) { n++; if (Math.abs(d[i] - k[0]) > 24 || Math.abs(d[i + 1] - k[1]) > 24 || Math.abs(d[i + 2] - k[2]) > 24) lit++; }
    return { w: c.width, h: c.height, lit: lit / n };
})()`;

/** a download in progress: at least 3 samples, the bytes grew between every two of them */
function slowButMoving(samples = []) {
    const d = samples.filter((x) => x.status === 'loading' && typeof x.loaded === 'number');
    return d.length >= 3 && d.every((x, i) => i === 0 || x.loaded > d[i - 1].loaded);
}

/** the element brought into view by the mouse wheel when needed, then clicked by the mouse at its centre; false when absent */
async function mouseTo(page, sel) {
    for (let n = 0; n < 10; n++) {
        const b = await page.evaluate((s) => { const e = document.querySelector(s); if (!e || !e.getClientRects().length) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, sel);
        if (!b) return false;
        if (b.y > 0 && b.y < 730) { await page.mouse.move(b.x, b.y, { steps: 4 }); await page.mouse.click(b.x, b.y); return true; }
        await page.mouse.move(768, 365);
        await page.mouse.wheel(0, b.y < 0 ? -300 : 300);
        await page.waitForTimeout(250);
    }
    return false;
}

const pick = pickBrowser({ expected: chromium.executablePath() });
const browser = await chromium.launch({ ...pick.launch, headless: true });
const res = { base, at: new Date().toISOString(), drawn: DRAWN, browser: { kind: pick.kind, version: browser.version() }, maxS: MAXS, ids: {}, pass: false };
const blank = await (await browser.newContext()).newPage();
try {
    for (const id of IDS) {
        const kind = (KINDS.find((k) => k.id === id) || {}).kind || 'unknown';
        const want = expectOf(kind);
        const r = { kind, expect: { flies: want.flies, lines: want.lines.map((k) => EN[k]) }, pass: false, why: null, outcome: null, errors: [], csp: [] };
        res.ids[id] = r;
        const ctx = await browser.newContext({ viewport: { width: 1536, height: 730 }, deviceScaleFactor: 1.25 });
        const page = await ctx.newPage();
        await page.addInitScript(() => {
            window.__csp = [];
            document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.disposition} ${e.effectiveDirective} ${String(e.blockedURI).slice(0, 100)}`));
        });
        page.on('pageerror', (e) => r.errors.push(String(e.message).slice(0, 240)));
        const url = `${base}/fly/?scene=${id}&nowarn=1&set.input.howToFly=false${DRAWN ? '' : '&render=off'}`;
        const t0 = Date.now();
        try {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
            let last = null, drawnRun = 0;
            while ((Date.now() - t0) / 1000 < MAXS) {
                await page.waitForTimeout(1000);
                last = await page.evaluate(STATE).catch(() => null);
                if (!last) continue;
                if (!r.notice && last.notes && HEAVY_RE.test(last.notes)) r.notice = { s: Math.round((Date.now() - t0) / 1000), text: last.notes.match(HEAVY_RE)[0] };
                const s = Math.round((Date.now() - t0) / 1000);
                if (s % 20 === 0) (r.samples ||= []).push({ s, status: last.status, stage: last.stage, loaded: last.loaded, total: last.total, drawn: last.drawn });
                if (last.status === 'error' && last.line) break;
                drawnRun = last.status === 'ready' && (!DRAWN || last.drawn > 0) ? drawnRun + 1 : 0;
                if (drawnRun >= 3) break;
            }
            r.seconds = Math.round((Date.now() - t0) / 1000);
            r.atOpen = last;
            if (last && last.status === 'error' && last.line) {
                r.outcome = 'line';
                if (!r.expect.lines.includes(last.line)) r.why = `the line is "${last.line}" (${last.errorCode}), expected ${want.flies ? 'a flight' : ''}${r.expect.lines.map((l) => ` "${l}"`).join(' or')}`;
            } else if (drawnRun >= 3) {
                // the pilot's path: Keyboard on the Controls screen ("The scan is ready. How will you fly?"), then the
                // pointer lock by a click into the scene; then the simulation must step
                const keyboard = await mouseTo(page, '[data-action="radio-keyboard"]');
                await page.waitForTimeout(800);
                await page.mouse.click(768, 365);
                await page.waitForTimeout(500);
                const a = await page.evaluate(STATE);
                await page.waitForTimeout(1500);
                const b = await page.evaluate(STATE);
                r.flight = { keyboardClicked: keyboard, lockedAfterClick: a.locked, tick0: a.tick, tick1: b.tick, paused: b.paused };
                const flown = typeof a.tick === 'number' && b.tick > a.tick;
                if (flown) r.outcome = 'flown';
                if (!want.flies) r.why = `it opened (${flown ? 'flown' : 'not flown'}), expected the line "${r.expect.lines[0]}"`;
                else if (!flown) r.why = `ready but no flown frame after the click: tick ${a.tick} -> ${b.tick}, paused ${b.paused}`;
                else if (DRAWN) {
                    const clear = await page.evaluate(CLEAR);
                    await page.evaluate(`(() => { const u = document.getElementById('ui'); if (u) u.style.visibility = 'hidden'; })()`);
                    await page.waitForTimeout(300);
                    const png = await page.screenshot({ type: 'png' });
                    const lit = await blank.evaluate(LIT(png.toString('base64'), clear));
                    r.picture = { clear, ...lit };
                    if (id === 'a39abad1' || lit.lit < MINLIT) { r.picture.shot = join(SHOTS, `n-scan-${id}.png`); writeFileSync(r.picture.shot, png); }
                    if (lit.lit < MINLIT) r.why = `picture empty: ${(lit.lit * 100).toFixed(1)} % of pixels differ from the clear colour`;
                }
            } else if (HEAVY_KINDS.has(kind) && r.notice && slowButMoving(r.samples)) {
                // a heavy single file still downloading at MAXS: it said why first, and every 20 s more of it arrived
                r.outcome = 'slow-said';
            } else {
                r.why = `no flight and no line in ${MAXS} s (status ${last && last.status}, ${last && last.errorCode}, splats drawn ${last && last.drawn}): an endless loader or an empty screen`;
            }
        } catch (e) {
            r.why = `probe: ${String(e.message || e).slice(0, 200)}`;
        }
        // a heavy single file must say why before its long download, whatever the outcome
        if (!r.why && HEAVY_KINDS.has(kind) && !r.notice) r.why = `no line "${EN['scene.open.heavy']}" before the download`;
        r.csp = await page.evaluate('window.__csp || []').catch(() => []);
        if (!r.why && r.errors.length) r.why = `page error: ${r.errors[0]}`;
        if (!r.why && r.csp.length) r.why = `CSP: ${r.csp[0]}`;
        r.pass = !r.why;
        console.error(`${id} ${kind}: ${r.pass ? 'PASS' : 'FAIL'} ${r.outcome || '-'} ${r.seconds ?? '-'} s${r.why ? ' ' + r.why : ''}`);
        await ctx.close();
    }
} finally {
    await browser.close();
}
res.pass = Object.values(res.ids).every((r) => r.pass);
res.summary = Object.fromEntries(Object.entries(res.ids).map(([k, v]) => [k, v.pass ? `PASS ${v.outcome}` : `FAIL ${v.why}`]));
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify(res, null, 2));
console.log(JSON.stringify({ pass: res.pass, base, drawn: DRAWN, summary: res.summary }));
process.exit(res.pass ? 0 : 1);
