// The guide to the next gate (lane fix3a, stage X2-gate-one; finding 2 of integration A: "Fly through gate 1" and no gate in
// the frame). One scan per run, the owner's path: Tunis 887f27aa by the course link seed 1 (?course=g1.1), or a scan with
// --shiftg (Wroclaw 70b50d42 on its published walls: Shift+G, as a pilot does). Then, by numbers and not only pixels:
//   start    as the course appears: the guide's side matches the bearing of gate 1 the probe computes from the drawn camera
//            (its world place and axes) and the gate's place (hook course.gatePoses), its metres within 1 m of the distance
//   behind   the craft turned so the gate is behind it to the right (the sim's quaternion, a pure yaw): turn mark, right half
//   near     the craft put 6 m before the gate on its leg and turned to it: the guide hides
//   rects    the guide never meets the note, the lap block (clock and lines), and with Escape the pause menu
//   844      at 844x390 the guide stays inside the screen and clear of them
// Pictures: <shots>/fix3a-gate1-<name>.png (and -behind, -844 when --extra). Presses Shift+G and Escape only. Takes no GPU lock.
//   node tools/bench/scripts/gate-guide-probe.mjs <base with /en> <scene> <out.json> <shots dir> <name> [--shiftg] [--extra]
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pickBrowser } from '../src/chrome.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const args = process.argv.slice(2);
const [base, id, out, shots, name] = args;
if (!base || !id || !out || !shots || !name) { console.error('usage: gate-guide-probe.mjs <base with /en> <scene> <out.json> <shots dir> <name> [--shiftg] [--extra]'); process.exit(2); }
const shiftg = args.includes('--shiftg');
const extra = args.includes('--extra');
const above = args.includes('--above');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [];
const check = (what, pass, detail) => { checks.push({ what, pass: !!pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${what}  ${JSON.stringify(detail).slice(0, 300)}`); };
const r = { base, id, shiftg, checks, reads: {}, turns: [] };
const pick = pickBrowser({ expected: chromium.executablePath() });
const browser = await chromium.launch({ ...pick.launch, headless: true });
const t0 = Date.now();
try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log('pageerror ' + String(e.message).slice(0, 200)));
    await page.goto(`${base}/fly/?scene=${id}${shiftg ? '' : '&course=g1.1'}&nowarn=1`);
    await page.waitForFunction(() => ['ready', 'error'].includes(window.__gsfpv?.status), null, { timeout: 240000 });
    try {
        await page.waitForSelector('.screen.radio [data-action="radio-keyboard"]', { timeout: 15000 });
        await page.focus('.screen.radio [data-action="radio-keyboard"]');
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => !document.querySelector('.screen.radio'), null, { timeout: 15000 });
    } catch { /* no Controls screen */ }
    await sleep(1500);
    if (shiftg) await page.keyboard.press('Shift+KeyG');
    // the course (walls-first on a scan without walls: the walls are built first); the walls and the course said every 30 s
    const waitS = Number((args.find((a) => a.startsWith('--wait-s=')) ?? '--wait-s=400').slice(9));
    for (let k = 0; ; k++) {
        const st = await page.evaluate(() => { const g = window.__gsfpv, c = g?.course, w = g?.walls; return { done: !!c && (c.source === 'generated' || !!c.problem), course: c ? { source: c.source, problem: c.problem ?? null } : null, walls: w ? { state: w.state, source: w.source, line: String(w.line ?? '').slice(0, 100) } : null, box: document.querySelector('#ui > .bake-box')?.textContent?.trim().slice(0, 100) ?? null }; });
        if (st.done) break;
        if (k % 30 === 0) console.log(`wait ${Math.round((Date.now() - t0) / 1000)} s ${JSON.stringify(st)}`);
        if (Date.now() - t0 > waitS * 1000) throw new Error(`no course after ${waitS} s: ${JSON.stringify(st)}`);
        await sleep(1000);
    }
    r.genS = Math.round((Date.now() - t0) / 1000);
    await sleep(2500);

    // one read, all in the same frame: the guide's state and box, the camera, the gate, the boxes it must not meet
    const read = () => page.evaluate(() => {
        const g = window.__gsfpv;
        const c = g.course;
        const gd = c.guide();
        const cam = g.session.renderer.camera;
        const p = cam.getPosition(), R = cam.right, F = cam.forward;
        const poses = c.gatePoses();
        const idx = gd.gate >= 0 ? gd.gate : 0;
        const gp = poses[idx]?.pos ?? null;
        const box = (el) => { if (!el || el.hidden || el.offsetParent === null) return null; const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0 ? { left: b.left, top: b.top, right: b.right, bottom: b.bottom } : null; };
        const guideEl = document.querySelector('[data-testid=course-guide]');
        return {
            guide: gd, text: guideEl?.textContent ?? '', guideBox: box(guideEl), ariaHidden: guideEl?.getAttribute('aria-hidden') ?? null,
            cam: [p.x, p.y, p.z], right: [R.x, R.y, R.z], fwd: [F.x, F.y, F.z], gate: gp, gates: poses.length, next: c.next,
            note: box(document.querySelector('#ui > .hud-note')), block: box(document.querySelector('[data-testid=course-hud]')),
            menu: box(document.querySelector('.pause-menu')), walls: box(document.querySelector('#ui > .bake-box')),
            wallsLine: document.querySelector('#ui > .bake-box')?.textContent?.trim().slice(0, 120) ?? '', vw: innerWidth, vh: innerHeight
        };
    });
    const bearing = (v) => {
        const d = [v.gate[0] - v.cam[0], v.gate[1] - v.cam[1], v.gate[2] - v.cam[2]];
        const x = d[0] * v.right[0] + d[1] * v.right[1] + d[2] * v.right[2];
        const z = d[0] * v.fwd[0] + d[1] * v.fwd[1] + d[2] * v.fwd[2];
        return { deg: (Math.atan2(x, z) * 180) / Math.PI, dist: Math.hypot(d[0], d[1], d[2]) };
    };
    const meets = (a, b) => !!a && !!b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    const metresOf = (t) => { const m = /(\d+)\D*$/.exec(t.trim()); return m ? Number(m[1]) : null; };
    const shot = async (n) => { const f = join(shots, `fix3a-gate1-${n}.png`); await page.screenshot({ path: f }); return f; };
    const judge = (label, v) => {
        const b = bearing(v);
        r.reads[label] = { ...v, probeBearing: +b.deg.toFixed(1), probeDist: +b.dist.toFixed(2) };
        const cx = v.guideBox ? (v.guideBox.left + v.guideBox.right) / 2 : null;
        const sideOk = v.guide.side === (b.deg < 0 ? 'left' : 'right') && (v.guide.inFrame || cx === null || (b.deg < 0 ? cx < v.vw / 2 : cx > v.vw / 2));
        check(`${label}: guide shown for gate ${v.guide.gate + 1} (hook next ${v.next})`, v.guide.shown && !!v.guideBox, { shown: v.guide.shown, box: v.guideBox, text: v.text });
        check(`${label}: side ${v.guide.side} matches the bearing from the camera pose (${b.deg.toFixed(1)} deg)${v.guide.behind ? ', behind' : ''}`, sideOk, { side: v.guide.side, cx, vw: v.vw, behind: v.guide.behind, inFrame: v.guide.inFrame });
        check(`${label}: metres within 1 m (${metresOf(v.text)} shown, ${b.dist.toFixed(2)} measured)`, metresOf(v.text) !== null && Math.abs(metresOf(v.text) - b.dist) <= 1, v.text);
        check(`${label}: clear of the note, the lap block and the walls box`, !meets(v.guideBox, v.note) && !meets(v.guideBox, v.block) && !meets(v.guideBox, v.walls), { guide: v.guideBox, note: v.note, block: v.block, walls: v.walls });
        check(`${label}: inside the screen`, !!v.guideBox && v.guideBox.left >= 0 && v.guideBox.top >= 0 && v.guideBox.right <= v.vw && v.guideBox.bottom <= v.vh, { box: v.guideBox, vw: v.vw, vh: v.vh });
        return b;
    };
    // what draws the camera (measured in pass 1: on Wroclaw 24 yaws written into sim.s gave one bearing). The session
    // draws sim.s unless cameraOverride is set or cameraAim (play.ts, the stabilised gimbal along the pilot's aim)
    // returns an aim; then the yaw comes from that aim and not from s[6..9].
    r.camMode = await page.evaluate(() => {
        const ss = window.__gsfpv.session;
        const a = ss.cameraAim?.() ?? null;
        return { override: !!ss.cameraOverride, aim: a, editorOpen: !!window.__gsfpv.editor?.open };
    });
    // the craft's pose written into the sim (S.px 0-2, S.vx 3-5, S.qw 6-9, rates 10-12) for a few frames, then one read;
    // when the gimbal aim draws the camera, the aim's yaw is the one turned (the pilot's own way to look), its pitch kept
    const pose = (pos, yawRad, pitchDeg = null) => page.evaluate(async ({ pos, yawRad, pitchDeg }) => {
        const ss = window.__gsfpv.session;
        const s = ss.sim.s;
        const orig = ss.__probeAim ?? ss.cameraAim;
        const a0 = orig?.() ?? null;
        if (a0) {
            ss.__probeAim = orig;
            ss.cameraAim = () => { const a = orig() ?? a0; return { ...a, yawDeg: (yawRad * 180) / Math.PI, ...(pitchDeg === null ? {} : { pitchDeg }) }; };
        }
        const put = () => {
            if (pos) { s[0] = pos[0]; s[1] = pos[1]; s[2] = pos[2]; }
            for (let i = 3; i < 6; i++) s[i] = 0;
            s[6] = Math.cos(yawRad / 2); s[7] = 0; s[8] = Math.sin(yawRad / 2); s[9] = 0;
            for (let i = 10; i < 13; i++) s[i] = 0;
        };
        for (let k = 0; k < 8; k++) { put(); await new Promise((res) => requestAnimationFrame(() => res())); }
        return [s[6], s[7], s[8], s[9], s[0], s[1], s[2]].map((x) => +x.toFixed(3));
    }, { pos, yawRad, pitchDeg });
    /** a yaw that puts the gate at `want` deg of bearing (the sign convention measured: two tries) */
    const turnTo = async (pos, want) => {
        // a search, not a formula: every 15 deg of yaw, then halving steps around the best (the sign convention is not assumed)
        const wrap = (d) => ((((d + 180) % 360) + 360) % 360) - 180;
        const at = async (deg) => { await pose(pos, (deg * Math.PI) / 180); const v = await read(); return { deg, v, err: Math.abs(wrap(bearing(v).deg - want)) }; };
        let best = null;
        for (let k = 0; k < 24; k++) { const t = await at(k * 15); if (!best || t.err < best.err) best = t; }
        for (const step of [7.5, 3.75, 1.875, 0.9]) {
            for (const d of [best.deg - step, best.deg + step]) { const t = await at(d); if (t.err < best.err) best = t; }
        }
        const v = (await at(best.deg)).v;
        const got = bearing(v).deg;
        r.turns.push({ want, yawDeg: best.deg, got: +got.toFixed(1) });
        // the turn itself is checked, so a case cannot pass because the start pose happened to fit
        check(`turn to ${want} deg reached (${got.toFixed(1)} deg)`, Math.abs(wrap(got - want)) < 10, { want, got, yawDeg: best.deg });
        return v;
    };

    const v0 = await read();
    r.gates = v0.gates;
    check('aria-hidden on the guide', v0.ariaHidden === 'true', v0.ariaHidden);
    judge('start', v0);
    r.shotStart = await shot(name);
    if (above) {
        // review FX-4: the camera pitched down 80 deg at the start yaw puts gate 1 above the view, so the guide goes to the top
        // edge centre, where the walls box (top centre) still holds its line after a walls-first course start. Read at once.
        const yaw0 = r.camMode.aim ? r.camMode.aim.yawDeg : 0;
        await pose(null, (yaw0 * Math.PI) / 180, -80);
        const va = await read();
        r.reads.above = va;
        check('above: the walls box is up (walls-first start)', !!va.walls, { walls: va.walls, line: va.wallsLine });
        check('above: guide shown at the top', va.guide.shown && !!va.guideBox && va.guideBox.top < va.vh / 3, { box: va.guideBox, guide: va.guide });
        check('above: the guide does not meet the walls box', !!va.guideBox && !meets(va.guideBox, va.walls), { guide: va.guideBox, walls: va.walls });
        r.shotAbove = await shot(`${name}-above`);
        await pose(null, (yaw0 * Math.PI) / 180, r.camMode.aim ? r.camMode.aim.pitchDeg : null);
    }
    if (extra) {
        const vb = await turnTo(null, 150);
        judge('behind', vb);
        check('behind: turn mark (behind true)', vb.guide.behind === true, vb.guide);
        r.shotBehind = await shot('behind');
        // the pause menu: the guide goes with the lap block
        await page.keyboard.press('Escape');
        await sleep(800);
        const vm = await read();
        r.reads.menu = vm;
        check('Escape: the guide does not meet the pause menu', !!vm.menu && !meets(vm.guideBox, vm.menu), { guide: vm.guideBox, menu: vm.menu });
        await page.keyboard.press('Escape');
        await sleep(800);
        // 844x390, the gate still behind
        await page.setViewportSize({ width: 844, height: 390 });
        await sleep(1200);
        const vs = await turnTo(null, 150);
        judge('844x390', vs);
        r.shot844 = await shot('844');
        await page.setViewportSize({ width: 1280, height: 800 });
        await sleep(1200);
        // near: 6 m before the gate on its leg (from the gate before it, or from here), turned to it
        const poses = await page.evaluate(() => window.__gsfpv.course.gatePoses().map((g) => g.pos));
        const gi = vs.guide.gate >= 0 ? vs.guide.gate : 0;
        const g = poses[gi], prev = gi > 0 ? poses[gi - 1] : poses.length > 1 ? poses[poses.length - 1] : vs.cam;
        const d = [g[0] - prev[0], g[2] - prev[2]], L = Math.hypot(d[0], d[1]) || 1;
        const at = [g[0] - (d[0] / L) * 6, g[1], g[2] - (d[1] / L) * 6];
        const vn = await turnTo(at, 0);
        const bn = bearing(vn);
        r.reads.near = { ...vn, probeBearing: +bn.deg.toFixed(1), probeDist: +bn.dist.toFixed(2) };
        check(`near: turned to the gate (${bn.deg.toFixed(1)} deg, ${bn.dist.toFixed(1)} m): the guide hides`, Math.abs(bn.deg) < 20 && bn.dist < 12 && !vn.guide.shown && !vn.guideBox, { shown: vn.guide.shown, inFrame: vn.guide.inFrame, metres: vn.guide.metres });
        r.shotNear = await shot(`${name}-near`);
    }
} catch (err) {
    check('the run finished', false, String(err).slice(0, 300));
} finally {
    await browser.close().catch(() => undefined);
}
r.seconds = Math.round((Date.now() - t0) / 1000);
r.pass = checks.every((c) => c.pass);
writeFileSync(out, JSON.stringify(r, null, 1));
console.log(`${checks.filter((c) => c.pass).length}/${checks.length} checks passed; ${out}`);
process.exit(r.pass ? 0 : 1);
