// Walls built in this browser come back from the browser's store (lane fix3a, stage X1-walls-store).
// One browser profile, three opens of a scan that has no walls served: (1) build: the page's own build action
// (the walls box button, as a pilot presses it; --start shiftg: Shift+G, the course build the integrator used;
// --start url: ?bake=1), wait until the walls are in use; (2) reload of the same tab; (3) a new tab.
// Each open records walls.state/source/bakes, cacheKind, cacheMiss, the store key and its input, the store rows,
// the walls line and the console lines about walls. --reload-at in-use: reload the moment the walls are in use
// (the integrator's run); default 'line': when the walls line says they are built (what a pilot sees).
// Exit 0 only when opens 2 and 3 have source 'cache', state in-use and no build ran in them (bakes 0), and the build's
// store write (w.lastStore) ended ok, within KEEP_NOTE_S of its start or with the walls line saying it keeps them.
// Presses only the build action (or Shift+G). Nothing is sent or saved on a server. Takes no GPU lock (wrap it).
//   node tools/bench/scripts/walls-store-probe.mjs <base with /en> <scene> <out.json> [--start button|shiftg|url] [--reload-at line|in-use]
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pickBrowser } from '../src/chrome.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const args = process.argv.slice(2);
const opt = (name, d) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : d; };
const [base, id, out] = args;
if (!base || !id || !out) { console.error('usage: walls-store-probe.mjs <base with /en> <scene> <out.json> [--start button|shiftg|url] [--reload-at line|in-use]'); process.exit(2); }
const KEEP_NOTE_S = 2;
const start = opt('--start', 'button');
const reloadAt = opt('--reload-at', 'line');
const pick = pickBrowser({ expected: chromium.executablePath() });
const dir = mkdtempSync(join(tmpdir(), 'walls-store-'));
const ctx = await chromium.launchPersistentContext(dir, { ...pick.launch, headless: true, viewport: { width: 1280, height: 720 } });
const r = { base, id, start, reloadAt, profile: dir, runs: [] };
const url = `${base}/fly/?scene=${id}&nowarn=1&set.input.howToFly=false${start === 'url' ? '&bake=1' : ''}`;

const snap = (p) => p.evaluate(async () => {
    const w = window.__gsfpv && window.__gsfpv.walls;
    if (!w) return null;
    const rows = await w.rows().catch((e) => [{ error: String(e) }]);
    const est = await navigator.storage?.estimate?.().catch(() => null);
    const persisted = await navigator.storage?.persisted?.().catch(() => null);
    return {
        state: w.state, source: w.source, bakes: w.bakes, voxelM: w.voxelM, cacheKind: w.cacheKind, cacheMiss: w.cacheMiss,
        key: w.key, keyInput: w.keyInput, storing: w.storing ?? null, lastStore: w.lastStore ?? null, line: w.line, sizeEtag: w.size ? w.size.etag ?? null : 'no-size',
        rows: rows.map((x) => ({ key: x.key, voxelM: x.voxelM, bytesStored: x.bytesStored, stale: !!x.stale, error: x.error })),
        usageMb: est ? +(est.usage / 1048576).toFixed(1) : null, quotaMb: est ? +(est.quota / 1048576).toFixed(0) : null, persisted
    };
});

async function open(p, label, build) {
    const logs = [];
    const onLog = (m) => { const s = m.text(); if (/wall|store|idb|indexeddb/i.test(s)) logs.push(`${m.type()}: ${s.slice(0, 300)}`); };
    p.on('console', onLog);
    const t0 = Date.now();
    const at = () => +((Date.now() - t0) / 1000).toFixed(1);
    const run = { label };
    await p.goto(url, { waitUntil: 'load', timeout: 120000 });
    await p.waitForFunction(() => ['ready', 'error'].includes(window.__gsfpv && window.__gsfpv.status), null, { timeout: 300000 });
    run.readyS = at();
    console.log(`${label}: ready ${run.readyS} s`);
    await p.waitForFunction(() => { const w = window.__gsfpv && window.__gsfpv.walls; return w && w.state !== 'checking'; }, null, { timeout: 60000 }).catch(() => 0);
    run.decidedS = at();
    run.first = await snap(p);
    if (build && run.first && run.first.state !== 'in-use' && run.first.state !== 'queued') {
        await p.waitForTimeout(2000);
        // as course-path-probe.mjs: the radio screen takes the keys until it is closed
        const x = p.locator('.screen.radio [data-action=radio-close]');
        if (await x.count()) { await x.first().click(); await p.waitForTimeout(800); }
        if (start === 'shiftg') await p.keyboard.press('Shift+KeyG');
        else if (start === 'button') {
            const b = p.locator('[data-testid=walls-box] button[data-action=bake]');
            run.buttonVisible = await b.isVisible().catch(() => false);
            if (run.buttonVisible) await b.click();
        }
        run.startedS = at();
    }
    const limit = build ? Number(opt('--build-s', '480')) : 60;
    let w = run.first;
    while (at() < limit) {
        w = await p.evaluate(() => { const w = window.__gsfpv && window.__gsfpv.walls; return w ? { state: w.state, source: w.source } : null; });
        if (w && ['in-use', 'failed', 'refused'].includes(w.state)) break;
        if (Math.round(at() * 2) % 60 === 0) console.log(`${label}: ${at()} s ${JSON.stringify(w)} ${await p.evaluate(() => window.__gsfpv.walls.line).catch(() => '')}`);
        await p.waitForTimeout(500);
    }
    run.inUseS = w && w.state === 'in-use' ? at() : null;
    run.atInUse = await snap(p);
    if (build && reloadAt === 'line') {
        // the walls line says they are built; a pilot reloads after that. Record when the store holds the key.
        const key = run.atInUse && run.atInUse.key;
        const t1 = Date.now();
        while (Date.now() - t1 < 120000) {
            const s = await snap(p);
            if (s && /Keeping them in this browser/.test(s.line || '')) run.sawKeeping = true;
            if (s && key && s.rows.some((x) => x.key === key) && !s.storing) { run.storedS = at(); break; }
            await p.waitForTimeout(250);
        }
    }
    run.final = await snap(p);
    run.logs = logs;
    p.off('console', onLog);
    r.runs.push(run);
    writeFileSync(out, JSON.stringify(r, null, 1));
    console.log(JSON.stringify({ label, readyS: run.readyS, inUseS: run.inUseS, storedS: run.storedS, state: run.final && run.final.state, source: run.final && run.final.source, bakes: run.final && run.final.bakes, cacheKind: run.final && run.final.cacheKind, cacheMiss: run.final && run.final.cacheMiss, rows: run.final && run.final.rows.length }));
}

try {
    const p = ctx.pages()[0] ?? await ctx.newPage();
    await open(p, 'build', true);
    await open(p, 'reload', false);
    const q = await ctx.newPage();
    await open(q, 'fresh page', false);
    const ls = r.runs[0].final && r.runs[0].final.lastStore;
    // the owner's rule (2 s) is the limit, not a measurement: a longer write must have been said in the line
    r.kept = reloadAt === 'in-use' ? true : !!(ls && ls.ok && (ls.ms <= KEEP_NOTE_S * 1000 || r.runs[0].sawKeeping));
    r.cached = r.runs.slice(1).every((x) => x.final && x.final.state === 'in-use' && x.final.source === 'cache' && x.final.bakes === 0);
} catch (e) { r.error = String(e).slice(0, 400); }
await ctx.close();
writeFileSync(out, JSON.stringify(r, null, 1));
console.log(JSON.stringify({ cached: !!r.cached, kept: !!r.kept, error: r.error }));
process.exit(r.cached && r.kept ? 0 : 1);
