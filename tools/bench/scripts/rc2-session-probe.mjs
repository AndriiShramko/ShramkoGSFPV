// Lane connect, stage C1 (docs/wip/connect.md): the owner's real DJI RC 2 session played back through the RC bridge
// into a headless page, and what the page did with it, second by second.
// Before: the bridge plays the record at its pace from the moment the page connects:
//   python tools/rc-bridge/rc_bridge.py --replay packages/input/test/fixtures/dji-rc2/owner-session-2026-11-13.jsonl --dev
// The probe presses what a pilot presses: Controls, "My controller is not in the list", "Fly through the RC bridge"; the
// wizard walks itself on the sticks of the record (its autopilot); on the check screen "Fly" at the record second
// FLY_S (default 70: after the owner's throttle-down at 59 s and arm-dial flip at 65-66 s, before his throttle-up at
// 84 s). Record second 0 = the first stick answer the page got.
// Usage: node rc2-session-probe.mjs <base with the locale, e.g. http://localhost:5780/en> <out.json> [FLY_S] [END_S]
// Screenshots: <out>-check.png, <out>-flight-<s>.png. Prints one last line of JSON (summary); exit 0 when the run ended.
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { pickHarnessBrowser } from './visual-browser.mjs';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '');
const require = createRequire(ROOT + '/tools/bench/package.json');
const { chromium } = require('playwright');
const base = process.argv[2] ?? 'http://localhost:5780/en';
const outFile = process.argv[3] ?? ROOT + '/.cache/rc2-session-probe.json';
const FLY_S = Number(process.argv[4] ?? 70);
const END_S = Number(process.argv[5] ?? 200);
const SHOTS_AT = [100, 160, 175, 190];
const scene = '887f27aa'; // open sky above the spawn (docs/agent-map.md, traps)
mkdirSync(dirname(outFile), { recursive: true });
const T0 = Date.now();
const step = (s) => process.stderr.write(`[${((Date.now() - T0) / 1000).toFixed(1)}s] ${s}\n`);

/** In the page before the app: the bridge's answers counted (first answer = record second 0) and a sampler every 100 ms. */
function installSampler() {
    const rec = { first: NaN, answers: 0, last: null, rows: [], t: () => (Number.isNaN(rec.first) ? -1 : (performance.now() - rec.first) / 1000) };
    window.__rec = rec;
    const RealWS = window.WebSocket;
    window.WebSocket = class extends RealWS {
        constructor(...a) {
            super(...a);
            this.addEventListener('message', (e) => {
                if (typeof e.data !== 'string' || e.data.indexOf('"v"') < 0) return;
                if (Number.isNaN(rec.first)) rec.first = performance.now();
                rec.answers++;
                try { rec.last = JSON.parse(e.data).v; } catch { /* not ours */ }
            });
        }
    };
    const r2 = (x) => (typeof x === 'number' ? Math.round(x * 100) / 100 : x ?? null);
    setInterval(() => {
        if (Number.isNaN(rec.first)) return;
        const g = window.__gsfpv;
        const w = g?.radio?.wizard?.state;
        const th = g?.throttle?.() ?? null;
        const hd = g?.session?.hud?.();
        const c = g?.controls;
        rec.rows.push({
            s: Math.round(rec.t() * 10) / 10,
            n: rec.answers,
            wiz: w ? (w.stage ? `${w.id}/${w.stage}` : w.id) : null,
            raw: rec.last ? rec.last.slice(0, 5) : null,
            mT: c?.mapped ? r2(c.mapped[2]) : null,
            src: c?.source ?? null,
            style: th ? th.now : null,
            pend: th ? th.pending : null,
            why: th?.resolved ? th.resolved.why : null,
            seen: th ? th.seen : null,
            armed: !!hd?.armed,
            block: c?.block ?? null,
            alt: r2(hd?.altitude ?? null),
            screen: !!document.querySelector('.screen.radio'),
            card: (() => { const e = document.querySelector('.arm-card'); return e && !e.classList.contains('hidden') ? (e.textContent ?? '').replace(/\s+/g, ' ').slice(0, 160) : null; })()
        });
    }, 100);
}

const pick = pickHarnessBrowser({ expected: chromium.executablePath() }, false);
const browser = await chromium.launch({ ...pick.launch, headless: true });
step('launched ' + browser.version());
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
await ctx.addInitScript(installSampler);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)));
const out = { what: 'rc2-session-probe.mjs: the owner\'s DJI RC 2 session 2 through the RC bridge', base, at: new Date().toISOString(), browser: browser.version(), flyS: FLY_S, endS: END_S, notes: {} };
const recS = () => page.evaluate(() => window.__rec.t());
const shot = (name) => page.screenshot({ path: outFile.replace(/\.json$/, `-${name}.png`) }).catch((e) => { out.notes['shot-' + name] = String(e.message).slice(0, 120); });
try {
    await page.goto(`${base}/fly/?scene=${scene}&nowarn=1&rcbridge=1&set.input.howToFly=false`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__gsfpv?.status === 'ready' && document.querySelector('.screen.radio .choice button'), null, { timeout: 120000 });
    await page.evaluate(() => { const d = document.querySelector('[data-testid=usb-look]'); if (d) d.open = true; });
    await page.locator('[data-action=usb-rc2-bridge]').click();
    step('pressed Fly through the RC bridge');
    await page.waitForFunction(() => window.__rec.answers > 0, null, { timeout: 15000 });
    // the check screen
    await page.waitForFunction(() => window.__gsfpv?.radio?.wizard?.state?.id === 'check', null, { timeout: 150000 }).catch(() => undefined);
    out.notes.checkAtS = Math.round((await recS()) * 10) / 10;
    step(`check screen at record ${out.notes.checkAtS} s`);
    const waitRec = async (s) => { const now = await recS(); if (now < s) await page.waitForTimeout((s - now) * 1000); };
    await waitRec(FLY_S - 1);
    out.check = await page.evaluate(() => {
        const w = window.__gsfpv?.radio?.wizard?.state;
        const p = w?.profile ?? null;
        const row = document.querySelector('.screen.radio [data-testid=throttle-style-row], .screen.radio .throttle-style');
        return {
            wizard: w ? `${w.id}/${w.stage ?? ''}` : null, checks: w?.checks ?? null,
            profile: p ? { deviceKey: p.deviceKey, axes: p.axes, arm: p.arm, throttleRest: p.throttleRest ?? null, throttleStyle: p.throttleStyle ?? null, known: p.known ?? null, modeSwitch: p.modeSwitch ?? null } : null,
            styleRow: row ? row.textContent.replace(/\s+/g, ' ').slice(0, 300) : null,
            screenText: (document.querySelector('.screen.radio')?.textContent ?? '').replace(/\s+/g, ' ').slice(0, 1200)
        };
    });
    await shot('check');
    await waitRec(FLY_S);
    const done = page.locator('[data-action=wizard-done]');
    if (await done.count()) { await done.first().click(); out.notes.flyPressedAtS = Math.round((await recS()) * 10) / 10; }
    else out.notes.flyPressedAtS = null;
    step(`Fly pressed at record ${out.notes.flyPressedAtS} s`);
    await page.waitForTimeout(1500);
    out.flying = await page.evaluate(() => {
        const c = window.__gsfpv?.controls;
        const p = c?.profile ?? null;
        return { source: c?.source ?? null, profile: p ? { deviceKey: p.deviceKey, axes: p.axes, arm: p.arm, throttleRest: p.throttleRest ?? null, throttleStyle: p.throttleStyle ?? null, known: p.known ?? null } : null, throttle: window.__gsfpv?.throttle?.() ?? null };
    });
    for (const s of SHOTS_AT) {
        if (s >= END_S) break;
        await waitRec(s);
        await shot(`flight-${s}`);
    }
    await waitRec(END_S);
} catch (e) {
    out.notes.threw = String(e?.message ?? e).slice(0, 300);
}
out.rows = await page.evaluate(() => window.__rec.rows).catch(() => []);
out.answers = await page.evaluate(() => window.__rec.answers).catch(() => null);
out.errors = errors;
// the changes only: wizard screens, style, why, seen, armed
const ev = [];
let prev = {};
for (const r of out.rows) {
    for (const k of ['wiz', 'style', 'pend', 'why', 'seen', 'armed', 'src', 'screen', 'block']) {
        if (r[k] !== prev[k]) ev.push({ s: r.s, k, from: prev[k] ?? null, to: r[k], raw: r.raw, mT: r.mT });
    }
    prev = r;
}
out.events = ev;
writeFileSync(outFile, JSON.stringify(out, null, 1));
await browser.close();
const last = out.rows[out.rows.length - 1] ?? {};
console.log(JSON.stringify({ ran: !out.notes.threw, checkAtS: out.notes.checkAtS, flyAtS: out.notes.flyPressedAtS, throttleRest: out.check?.profile?.throttleRest ?? null, styleAfterFly: out.flying?.throttle?.resolved ?? null, lastRow: { s: last.s, style: last.style, why: last.why, armed: last.armed }, answers: out.answers, errors: errors.length, threw: out.notes.threw ?? null }));
