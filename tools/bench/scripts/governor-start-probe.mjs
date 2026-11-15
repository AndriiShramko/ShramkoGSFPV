// Governor start step (R32, review LP-1): four loads on ONE browser profile against a local release.
//   W1 desktop-weak, overloaded (test hook setFrameDelay, 1.4 display periods) until the step holds 10 s: record written
//   W2 desktop-weak, no overload: the governor's step at the first frames and at the reveal = the remembered step
//   S1 desktop-strong, overloaded the same way: a record for the strong id is written
//   S2 desktop-strong, no overload: the step at the first frames and at the reveal must be 0 (the top)
// Usage: node tools/bench/scripts/governor-start-probe.mjs --site http://localhost:5742 --scene 39e63ce9 --out <file.json>
// It does NOT take the GPU lock: wrap it in the lock loop (docs/wip/laptop3.md). Headless through chrome.mjs pickBrowser.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { describeBrowser, pickBrowser } from '../src/chrome.mjs';

const arg = (k, d) => {
    const i = process.argv.indexOf(`--${k}`);
    return i > 0 ? process.argv[i + 1] : d;
};
const SITE = arg('site', 'http://localhost:5742');
const SCENE = arg('scene', '39e63ce9');
const OUT = arg('out', null);
const KEY = 'gsfpv.governor.start';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const profile = mkdtempSync(join(tmpdir(), 'gsfpv-govstart-'));
const pick = pickBrowser({ expected: chromium.executablePath() });
const context = await chromium.launchPersistentContext(profile, { ...pick.launch, viewport: { width: 1280, height: 720 } });
const result = { site: SITE, scene: SCENE, browser: describeBrowser(pick, context.browser()?.version() ?? '?'), loads: [] };

async function load(name, cls, overload) {
    const page = context.pages()[0] ?? (await context.newPage());
    const url = `${SITE}/en/fly/?scene=${SCENE}&nowarn=1&input=touch&set.display.deviceClass=${cls}`;
    const before = await page.evaluate(`localStorage.getItem('${KEY}')`).catch(() => null);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
    const seen = [];
    let reveal = null;
    const t0 = Date.now();
    // the step from the first frames until the reveal, every 100 ms
    while (Date.now() - t0 < 180000) {
        const s = await page.evaluate(`(() => { const h = window.__gsfpv; const g = h && h.governor; const s = h && h.session; return g ? { step: g.step, visible: !!(s && s.timings && s.timings.visibleMs !== null) } : null; })()`).catch(() => null);
        if (s && (seen.length === 0 || seen[seen.length - 1] !== s.step)) seen.push(s.step);
        if (s && s.visible) { reveal = s.step; break; }
        await sleep(100);
    }
    const rec = { name, cls, overload, recordBefore: before, stepsBeforeReveal: seen, stepAtReveal: reveal, revealMs: Date.now() - t0 };
    if (overload) {
        await sleep(6000); // the display period is learned on normal frames
        await page.evaluate(`(() => { const h = window.__gsfpv; h.setFrameDelay(Math.round(h.governor.displayPeriodMs * 1.4)); })()`);
        // to the lowest step, then 10 s held there (GOVERNOR_SETTLE_MS) and a margin; give up after 60 s
        let low = null;
        for (const tA = Date.now(); Date.now() - tA < 60000; await sleep(500)) {
            const st = await page.evaluate(`(() => { const g = window.__gsfpv.governor; return { step: g.step, last: g.steps.length - 1 }; })()`);
            if (st.step === st.last) { low = Date.now() - tA; break; }
        }
        rec.msToLowest = low;
        await sleep(13000);
        rec.stepAfterOverload = await page.evaluate('window.__gsfpv.governor.step');
        await page.evaluate('window.__gsfpv.setFrameDelay(0)');
    } else {
        await sleep(2000);
    }
    rec.lod = await page.evaluate('(() => { const l = window.__gsfpv.lod(); return { kind: l.kind, governorStep: l.governorStep, governorBudgetM: l.governorBudgetM, renderScale: l.renderScale }; })()').catch(() => null);
    rec.recordAfter = await page.evaluate(`localStorage.getItem('${KEY}')`);
    rec.drawingClass = await page.evaluate('(window.__gsfpv.drawing || {}).class').catch(() => null);
    result.loads.push(rec);
    console.log(JSON.stringify(rec));
}

try {
    await load('W1', 'desktop-weak', true);
    await load('W2', 'desktop-weak', false);
    await load('S1', 'desktop-strong', true);
    await load('S2', 'desktop-strong', false);
} finally {
    await context.close().catch(() => {});
    rmSync(profile, { recursive: true, force: true });
    if (OUT) writeFileSync(OUT, JSON.stringify(result, null, 1));
}
const [w1, w2, s1, s2] = result.loads;
const w1Step = w1?.recordAfter ? JSON.parse(w1.recordAfter).step : null;
const pass = {
    weakRemembered: w1Step !== null && w1Step > 0,
    weakStartsThere: w2?.stepsBeforeReveal?.[0] === w1Step,
    strongRemembered: !!s1?.recordAfter && JSON.parse(s1.recordAfter).id.startsWith('desktop-strong|') && JSON.parse(s1.recordAfter).step > 0,
    strongStartsAtTop: (s2?.stepsBeforeReveal ?? [1]).every((s) => s === 0) && s2?.stepAtReveal === 0
};
console.log(`PASS ${JSON.stringify(pass)} all=${Object.values(pass).every(Boolean)}`);
