// Lane w3-model of train 5 (docs/wip/w3-model.md): does the Prop wash setting (physics.propWash, the row in Settings)
// change the flight of the default craft in the built page, and does 0 switch prop wash off? Logic-only page
// (?render=off): no GPU, the picture is not judged.
// Three loads of the same scan: no setting (the default 1), set.physics.propWash=0 and =2 (the URL form of the same
// setting the row edits; the store validates it the same way). In each page: the setting's value, the session's
// overrides (what the next life compiles), the running life's compiled prop wash (sim.p.wakeLoss / wakeShake), and a
// fast drop and firm catch flown on the page's own Sim class with the life's own params (deterministic, 1 kHz):
// angle mode, a hover held by a loop for 1.5 s, idle 1.5 s, then 1.5 x the hover stick for 2 s; the height lost in
// the catch and the largest wash. Verdict: 0 gives wakeLoss = wakeShake = 0 and never any wash; 1 and 2 give
// wash and more sink than 0, 2 more than 1. Prints one JSON verdict, exits 1 on a failure.
// Usage: node w3-model-wash-probe.mjs <base with the locale, e.g. http://localhost:7440/en> <out.json> [scene]
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { pickBrowser } from '../src/chrome.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [base, outFile, scene = '39e63ce9'] = process.argv.slice(2);
if (!base || !outFile) { console.error('usage: w3-model-wash-probe.mjs <base with /en> <out.json> [scene]'); process.exit(2); }

/** In the page: the setting, the overrides, the life's params and the drop-and-catch flight on the page's Sim. */
const MEASURE = () => {
    const h = window.__gsfpv;
    const ses = h.session;
    const life = ses.runner.sim;
    const p = life.p;
    const Sim = life.constructor;
    const sim = new Sim(p, null);
    const PY = 1, VY = 4, WX = 10, WZ = 12;
    sim.reset(0, 200, 0, 0);
    const ch = [0, 0, -1, 0, -1, 1, 0, 0]; // angle mode (MODE_CHANNEL.angle 1), arm switch low
    sim.setChannels(ch); sim.step();
    ch[4] = 1; sim.setChannels(ch); sim.step();
    let stick = 0.4, integ = 0;
    for (let i = 0; i < 1500; i++) { // hover: a PI loop on the vertical speed
        const e = -sim.s[VY]; integ += e * 0.001;
        stick = Math.min(1, Math.max(0, 0.4 + 0.05 * e + 0.5 * integ));
        ch[2] = stick * 2 - 1; sim.setChannels(ch); sim.step();
    }
    ch[2] = -1; sim.setChannels(ch);
    for (let i = 0; i < 1500; i++) sim.step();
    const vyDrop = sim.s[VY], y0 = sim.s[PY];
    ch[2] = Math.min(1, stick * 1.5) * 2 - 1; sim.setChannels(ch);
    let yMin = y0, washMax = 0, washMs = 0, rr = 0;
    for (let i = 0; i < 2000; i++) {
        sim.step();
        if (sim.s[PY] < yMin) yMin = sim.s[PY];
        const w = sim.washNow;
        if (w > washMax) washMax = w;
        if (w > 0.05) { washMs++; rr += sim.s[WX] * sim.s[WX] + sim.s[WZ] * sim.s[WZ]; }
    }
    return {
        status: h.status, preset: ses.presetId, setting: h.prefs ? h.prefs.get('physics.propWash') : null,
        overridesWake: ses.lifeOverrides().wake ?? null,
        life: { wakeLoss: p.wakeLoss, wakeShake: p.wakeShake, wakeArea: p.wakeArea, wakeShift: p.wakeShift },
        flight: { armed: !!sim.armed, hoverStick: Number(stick.toFixed(4)), vyAtCatch: Number(vyDrop.toFixed(2)), sinkM: Number((y0 - yMin).toFixed(3)), washMax: Number(washMax.toFixed(3)), washMs, wobbleDps: washMs ? Number((Math.sqrt(rr / washMs) * 180 / Math.PI).toFixed(2)) : 0 }
    };
};

const pick = pickBrowser({ expected: chromium.executablePath() });
const browser = await chromium.launch({ ...pick.launch, headless: true });
const out = { base, scene, runs: {}, checks: {}, errors: [] };
try {
    for (const [name, q] of [['default', ''], ['x0', '&set.physics.propWash=0'], ['x2', '&set.physics.propWash=2']]) {
        const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
        const page = await ctx.newPage();
        page.on('pageerror', (e) => out.errors.push(`${name}: ${String(e.message).slice(0, 160)}`));
        await page.goto(`${base}/fly/?scene=${scene}&nowarn=1&set.input.howToFly=false&render=off${q}`, { waitUntil: 'load', timeout: 120000 });
        await page.waitForFunction(() => { const h = window.__gsfpv; return h && (h.status === 'error' || (h.status === 'ready' && h.session && h.session.runner && h.session.runner.sim)); }, null, { timeout: 300000 });
        out.runs[name] = await page.evaluate(MEASURE);
        await ctx.close();
    }
} catch (e) {
    out.errors.push(String(e && e.message ? e.message : e).slice(0, 300));
}
await browser.close();
const r = out.runs, d = r.default, z = r.x0, two = r.x2;
const ok = (k, v) => { out.checks[k] = v ? 'PASS' : 'FAIL'; };
ok('loaded', !!(d && z && two) && [d, z, two].every((x) => x.status === 'ready' && x.flight.armed));
if (d && z && two) {
    ok('default craft', d.preset === 'pavo20pro-3s');
    ok('default setting 1 reaches the life', d.setting === 1 && d.life.wakeLoss > 0 && d.life.wakeShake > 0);
    ok('setting 0 reaches the life', z.setting === 0 && z.overridesWake === 0 && z.life.wakeLoss === 0 && z.life.wakeShake === 0);
    ok('setting 0: no wash at all', z.flight.washMax === 0 && z.flight.washMs === 0);
    ok('setting 1: wash in the catch', d.flight.washMax > 0.5 && d.flight.washMs > 50);
    ok('setting 1 sinks deeper than 0', d.flight.sinkM > z.flight.sinkM);
    ok('setting 2 sinks deeper than 1', two.setting === 2 && two.flight.sinkM > d.flight.sinkM && two.life.wakeLoss > d.life.wakeLoss);
}
const pass = Object.values(out.checks).length > 0 && Object.values(out.checks).every((v) => v === 'PASS');
out.verdict = pass ? 'PASS' : 'FAIL';
writeFileSync(outFile, JSON.stringify(out, null, 1));
console.log(JSON.stringify({ verdict: out.verdict, checks: out.checks, sink: d && z && two ? { x0: z.flight.sinkM, x1: d.flight.sinkM, x2: two.flight.sinkM } : null, errors: out.errors.slice(0, 3) }));
process.exit(pass ? 0 : 1);
