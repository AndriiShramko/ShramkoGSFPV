// A7 (browser): the bot pilot flies the scenario in the visible system Chrome on the real scan;
// PNG series per phase. Control: same plan in an open volume -> no crash.
import { mkdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { launch, waitReady, visibility } from './browser';
import { REPO, today, writeEvidence } from './evidence';

const BASE = process.env.FLY_BASE ?? 'http://localhost:5190/fly/';

async function run(scene: string, mode: 'scenario' | 'open') {
    const dir = join(REPO, 'evidence', today(), 'a7', `${scene}-${mode}`);
    mkdirSync(dir, { recursive: true });
    const { browser, page, console: log } = await launch();
    await page.goto(`${BASE}?scene=${scene}&simradio=${mode}`);
    const ready = await waitReady(page);
    const shots: { phase: string; file: string; t: number; vis: string }[] = [];
    let lastPhase = '';
    let preImpactShot = false;
    const t0 = Date.now();
    while (Date.now() - t0 < 60000) {
        const st = await page.evaluate(() => {
            const h = (window as any).__gsfpv;
            const sc = h.scenario;
            const s = h.session.sim.s;
            return { phase: sc.phase, tick: h.session.sim.tick, speed: Math.hypot(s[3], s[4], s[5]), crash: sc.log.crash, renderer: h.session.renderer.currentRenderer, finished: sc.finished };
        });
        const vis = await visibility(page);
        if (st.phase !== lastPhase || (st.phase === 'dash' && st.speed > 6 && !preImpactShot) || (st.phase === 'box' && shots.filter(x => x.phase === 'box').length < 3 && (Date.now() % 1000) < 250)) {
            if (st.phase === 'dash' && st.speed > 6) preImpactShot = true;
            const file = join(dir, `${String(shots.length).padStart(2, '0')}-${st.phase}${st.phase === 'dash' && preImpactShot ? '-fast' : ''}.png`);
            await page.screenshot({ path: file });
            shots.push({ phase: st.phase, file: relative(REPO, file).split(sep).join('/'), t: st.tick / 1000, vis });
            lastPhase = st.phase;
        }
        if (st.finished) break;
        await page.waitForTimeout(120);
    }
    const final = await page.evaluate(() => { const h = (window as any).__gsfpv; return { log: h.scenario.log, crashes: h.session.crashes, hitches: h.session.runner.hitches, startOverlaps: h.session.sim.startOverlaps, frames: h.session.frames, renderer: h.session.renderer.currentRenderer, visibility: document.visibilityState }; });
    await page.screenshot({ path: join(dir, `${String(shots.length).padStart(2, '0')}-final.png`) });
    await browser.close();
    return { scene, mode, ready, shots, final, consoleErrors: log.filter((l) => l.startsWith('error') || l.startsWith('pageerror')) };
}

const results = [];
for (const scene of ['39e63ce9', '887f27aa']) {
    results.push(await run(scene, 'scenario'));
    results.push(await run(scene, 'open'));
}
const byKey = (s: string, m: string) => results.find((r) => r.scene === s && r.mode === m)!;
const checks = ['39e63ce9', '887f27aa'].map((s) => {
    const a = byKey(s, 'scenario'), c = byKey(s, 'open');
    const valid = a.final.visibility === 'visible' && a.final.renderer === 2 && c.final.visibility === 'visible' && c.final.renderer === 2;
    const phases = (a.final.log.phases as { phase: string }[]).map((p) => p.phase);
    const flew = ['arm', 'hover', 'box', 'return', 'aim', 'dash', 'crashed'].every((p) => phases.includes(p));
    return { scene: s, valid, flewAllPhases: flew, crash: a.final.log.crash, controlCrash: c.final.log.crash, pass: valid && flew && !!a.final.log.crash && !c.final.log.crash };
});
const pass = checks.every((c) => c.pass);
const file = writeEvidence('a7-bot-pilot-browser', { pass, browser: 'system Chrome (Playwright channel chrome), visible window, no rendering flags', checks, control: { name: 'same plan in an open volume must not crash', fired: checks.every((c) => !c.controlCrash) }, runs: results });
console.log('A7', pass ? 'PASS' : 'FAIL', JSON.stringify(checks), '->', file);
