// Lane fix3b, stage Y2 (owner's message 52: gates in front of a person's eyes where the scan is dense, none in the poor
// ends of streets). Per scan on a local release: Shift+G and the time to the drawn course, then REGEN more Shift+G (time,
// gates, span, heights); a top-down picture of the walls (bright = many wall voxels in the column: dense scan, dark =
// thin) with the course (gate colour = centre height above the first wall below it: green 1.2-2.0 m, blue lower, yellow
// to 4 m, red higher); pilot's views from 1.6 m above the ground 8 m before a gate on its way in, turned to face it.
//   node tools/bench/scripts/gate-place-probe.mjs http://localhost:5784/en <out.json> <shots dir> <id>:<name>:<gate>[,<gate>][;...]
// Headless; takes no GPU lock itself (wrap it). Presses only Shift+G: nothing is sent or saved.
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { pickBrowser } from '../src/chrome.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [base, outFile, shots, spec] = process.argv.slice(2);
if (!base || !outFile || !shots || !spec) { console.error('usage: gate-place-probe.mjs <base with /en> <out.json> <shots dir> <id>:<name>:<gates>;...'); process.exit(2); }
const pick = pickBrowser({ expected: chromium.executablePath() });
const browser = await chromium.launch({ ...pick.launch, headless: true });

const TOPDOWN = () => {
    const h = window.__gsfpv, col = h.session.collision, poses = h.course.gatePoses();
    const xs = poses.map((p) => p.pos[0]), zs = poses.map((p) => p.pos[2]), ys = poses.map((p) => p.pos[1]);
    const m = 40;
    const x0 = Math.min(...xs) - m, x1 = Math.max(...xs) + m, z0 = Math.min(...zs) - m, z1 = Math.max(...zs) + m;
    const step = Math.max(0.4, Math.max(x1 - x0, z1 - z0) / 1000);
    const W = Math.ceil((x1 - x0) / step), H = Math.ceil((z1 - z0) / step);
    const yLo = Math.min(...ys) - 10, yHi = Math.max(...ys) + 15;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d'); const img = g.createImageData(W, H);
    let maxN = 1; const cnt = new Uint16Array(W * H);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
        const x = x0 + (i + 0.5) * step, z = z0 + (j + 0.5) * step;
        let n = 0; for (let y = yLo; y <= yHi; y += 0.5) if (!col.isFreeAt(x, y, z)) n++;
        cnt[j * W + i] = n; if (n > maxN) maxN = n;
    }
    for (let k = 0; k < W * H; k++) { const v = cnt[k] ? 50 + Math.round(180 * Math.min(1, cnt[k] / (maxN * 0.5))) : 10; img.data[k * 4] = v; img.data[k * 4 + 1] = v; img.data[k * 4 + 2] = v; img.data[k * 4 + 3] = 255; }
    g.putImageData(img, 0, 0);
    const px = (p) => [(p[0] - x0) / step, (p[2] - z0) / step];
    const heights = poses.map((p) => { const r = col.queryRay(p.pos[0], p.pos[1], p.pos[2], 0, -1, 0, 80); return r ? +(p.pos[1] - r.y).toFixed(2) : null; });
    g.strokeStyle = 'rgba(80,200,255,0.9)'; g.lineWidth = 2; g.beginPath();
    poses.forEach((p, k) => { const [a, b] = px(p.pos); if (k) g.lineTo(a, b); else g.moveTo(a, b); }); g.stroke();
    poses.forEach((p, k) => {
        const [a, b] = px(p.pos); const hh = heights[k];
        g.fillStyle = hh === null ? '#f0f' : hh < 1.2 ? '#39f' : hh <= 2.0 ? '#3f3' : hh <= 4 ? '#fc3' : '#f33';
        g.beginPath(); g.arc(a, b, 6, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#fff'; g.font = 'bold 13px sans-serif'; g.fillText(String(k + 1), a + 8, b - 6);
    });
    g.fillStyle = '#fff'; g.font = '13px sans-serif';
    g.fillText(`${(x1 - x0).toFixed(0)} x ${(z1 - z0).toFixed(0)} m; bright = dense walls; gate: green 1.2-2.0 m above the ground, blue lower, yellow <= 4, red higher`, 8, H - 10);
    let span = 0; for (const a of poses) for (const b of poses) span = Math.max(span, Math.hypot(a.pos[0] - b.pos[0], a.pos[2] - b.pos[2]));
    return { url: cv.toDataURL('image/png'), heights, spanM: +span.toFixed(1) };
};

// the craft held at pos facing yaw (re-written every physics step), the camera's gimbal aim (when it draws) turned too
const HOLD = ([pos, yawRad, pitchRad = 0]) => {
    const ss = window.__gsfpv.session;
    window.__hold = { pos, yawRad, pitchRad };
    if (!window.__holdOn) {
        window.__holdOn = true;
        const prev = ss.runner.onStep;
        ss.runner.onStep = (sim) => {
            prev?.(sim);
            const hd = window.__hold, s = sim.s;
            if (!hd) return;
            for (let i = 0; i < 3; i++) { s[i] = hd.pos[i]; s[3 + i] = 0; }
            // yaw about y, then pitch about the craft's own x (pass 2: a gate above or below the view is looked at)
            const cy = Math.cos(hd.yawRad / 2), sy = Math.sin(hd.yawRad / 2), cp = Math.cos(hd.pitchRad / 2), sp = Math.sin(hd.pitchRad / 2);
            s[6] = cy * cp; s[7] = cy * sp; s[8] = sy * cp; s[9] = -sy * sp;
            for (let i = 10; i < 13; i++) s[i] = 0;
        };
        const orig = ss.cameraAim;
        if (orig) ss.cameraAim = () => { const a = orig(); const hd = window.__hold; return a && hd ? { ...a, yawDeg: (hd.yawRad * 180) / Math.PI, pitchDeg: 0 } : a; };
    }
    return true;
};
const VIEW = (gp) => {
    const cam = window.__gsfpv.session.renderer.camera;
    const p = cam.getPosition(), R = cam.right, F = cam.forward, U = cam.up;
    const d = [gp[0] - p.x, gp[1] - p.y, gp[2] - p.z];
    const x = d[0] * R.x + d[1] * R.y + d[2] * R.z, y = d[0] * U.x + d[1] * U.y + d[2] * U.z, z = d[0] * F.x + d[1] * F.y + d[2] * F.z;
    return { cam: [p.x, p.y, p.z].map((v) => +v.toFixed(2)), bearing: +((Math.atan2(x, z) * 180) / Math.PI).toFixed(1), elev: +((Math.atan2(y, Math.hypot(x, z)) * 180) / Math.PI).toFixed(1), dist: +Math.hypot(...d).toFixed(2) };
};

const out = [];
for (const item of spec.split(';')) {
    const [id, name, gatesArg] = item.split(':');
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const page = await ctx.newPage();
    const r = { id, errors: [] };
    page.on('pageerror', (e) => r.errors.push(String(e.message).slice(0, 160)));
    const ev = (f, a) => page.evaluate(f, a);
    const until = async (f, ok, ms, every = 250) => { const t = Date.now(); for (;;) { const v = await ev(f); if (ok(v) || Date.now() - t > ms) return v; await page.waitForTimeout(every); } };
    try {
        await page.goto(`${base}/fly/?scene=${id}&nowarn=1&set.input.howToFly=false&set.crash.enabled=0`, { waitUntil: 'load', timeout: 120000 });
        await page.waitForFunction(() => ['ready', 'error'].includes(window.__gsfpv && window.__gsfpv.status), null, { timeout: 300000 });
        await page.waitForFunction(() => { const w = window.__gsfpv && window.__gsfpv.walls; return w && w.state !== 'checking'; }, null, { timeout: 60000 }).catch(() => 0);
        await page.waitForTimeout(2000);
        const x = page.locator('.screen.radio [data-action=radio-close]');
        if (await x.count()) { await x.first().click(); await page.waitForTimeout(800); }
        r.regen = [];
        for (let i = 0; i <= Number(process.env.REGEN ?? 2); i++) {
            const seed0 = await ev(() => window.__gsfpv.course.seed ?? null);
            const tg = Date.now();
            await page.keyboard.press('Shift+KeyG');
            const c = await until(() => { const c = window.__gsfpv.course; return { seed: c.seed, gates: c.gates, drawn: c.drawn, problem: c.problem ?? null, walls: window.__gsfpv.walls?.state }; }, (v) => (v.seed !== seed0 && v.gates > 0 && v.drawn > 0), 600000, 250);
            const s = +((Date.now() - tg) / 1000).toFixed(1);
            const ps = await ev(() => window.__gsfpv.course.gatePoses());
            let span = 0; for (const a of ps) for (const b of ps) span = Math.max(span, Math.hypot(a.pos[0] - b.pos[0], a.pos[2] - b.pos[2]));
            const hs = await ev((pp) => { const col = window.__gsfpv.session.collision; return pp.map((p) => { const h = col.queryRay(p.pos[0], p.pos[1], p.pos[2], 0, -1, 0, 80); return h ? +(p.pos[1] - h.y).toFixed(2) : null; }); }, ps);
            const hv = hs.filter((v) => v !== null);
            r.regen.push({ seed: c.seed, s, gates: ps.length, problem: c.problem, walls: c.walls, spanM: +span.toFixed(1), eye: hv.filter((v) => v >= 1.2 && v <= 2.0).length, h: hv.length ? [Math.min(...hv), Math.max(...hv)] : null, noGround: hs.length - hv.length, scale: ps[0]?.scale ?? null });
        }
        await page.waitForTimeout(3000);
        const top = await ev(TOPDOWN);
        writeFileSync(`${shots}/fix3b-${name}-top.png`, Buffer.from(top.url.split(',')[1], 'base64'));
        delete top.url;
        r.top = top;
        const poses = await ev(() => window.__gsfpv.course.gatePoses());
        const start = await ev(() => { const s = window.__gsfpv.session.sim.s; return [s[0], s[1], s[2]]; });
        r.views = [];
        for (const [n, k] of (gatesArg || '1').split(',').map((v, n) => [n, Math.min(poses.length, Number(v)) - 1])) {
            const g = poses[k].pos, from = k > 0 ? poses[k - 1].pos : start;
            let dx = g[0] - from[0], dz = g[2] - from[2]; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
            // 8 m before the gate on its way in (nearer when a wall stands there), 1.6 m above the first wall below that point
            const eye = await ev(([g, dx, dz]) => {
                const col = window.__gsfpv.session.collision;
                for (const back of [8, 7, 6, 5, 4]) {
                    const px = g[0] - dx * back, pz = g[2] - dz * back;
                    const hit = col.queryRay(px, g[1] + 1, pz, 0, -1, 0, 30);
                    if (!hit) continue;
                    const p = [px, hit.y + 1.6, pz];
                    if (col.isFreeAt(p[0], p[1], p[2])) return { p, back, ground: hit.y };
                }
                return null;
            }, [g, dx, dz]);
            if (!eye) { r.views.push({ gate: k + 1, err: 'no free eye point 4-8 m before it' }); continue; }
            // the yaw that faces the gate: a search over the drawn camera (the sign convention is not assumed)
            const wrap = (d) => ((((d + 180) % 360) + 360) % 360) - 180;
            const at = async (deg) => { await ev(HOLD, [eye.p, (deg * Math.PI) / 180]); await page.waitForTimeout(120); const v = await ev(VIEW, g); return { deg, v, err: Math.abs(wrap(v.bearing)) }; };
            let best = null;
            for (let a = 0; a < 24; a++) { const t = await at(a * 15); if (!best || t.err < best.err) best = t; }
            for (const st of [7.5, 3.75, 1.875]) for (const d of [best.deg - st, best.deg + st]) { const t = await at(d); if (t.err < best.err) best = t; }
            // pass 2: the yaw alone left a gate 34 deg above the view (Wroclaw gate 6, the picture showed a shop window): when the
            // gate is more than 10 deg off the centre up or down, search the pitch too (sign not assumed)
            let pitch = 0;
            if (Math.abs(best.v.elev) > 10) {
                let pe = Math.abs(best.v.elev);
                for (let a = -60; a <= 60; a += 5) {
                    await ev(HOLD, [eye.p, (best.deg * Math.PI) / 180, (a * Math.PI) / 180]);
                    await page.waitForTimeout(120);
                    const w = await ev(VIEW, g);
                    if (Math.abs(w.elev) < pe && Math.abs(wrap(w.bearing)) < 10) { pe = Math.abs(w.elev); pitch = a; }
                }
            }
            await ev(HOLD, [eye.p, (best.deg * Math.PI) / 180, (pitch * Math.PI) / 180]);
            await page.waitForTimeout(120);
            const v = { ...(await ev(VIEW, g)), pitchDeg: pitch };
            await page.waitForTimeout(1500);
            const file = `fix3b-${name}-pilot${n ? `-${n + 1}` : ''}.png`;
            await page.screenshot({ path: `${shots}/${file}` });
            r.views.push({ gate: k + 1, file, back: eye.back, eyeAboveGround: +(eye.p[1] - eye.ground).toFixed(2), gateAboveGround: top.heights[k], ...v });
        }
    } catch (e) { r.fail = String(e).slice(0, 240); }
    out.push(r);
    writeFileSync(outFile, JSON.stringify(out, null, 1));
    await ctx.close();
}
await browser.close();
for (const r of out) console.log(JSON.stringify({ id: r.id, regen: r.regen, span: r.top?.spanM, views: r.views, errors: r.errors.length, fail: r.fail }));
