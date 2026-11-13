// A huge streamed scan seen from above, at a fixed splat budget: where does the budget go, and what does a fast turn
// show? (Lane lod-view, docs/wip/lod-view.md; the owner's stress test on the Lublin scan, 259 M splats.)
//
// The engine picks a level of detail per octree node from a "distance" (GSplatOctreeInstance.evaluateNodeDistances): the
// real distance to the node, made longer only for nodes BEHIND the camera (lodBehindPenalty). A node in front of the
// camera and outside the picture gets the same priority as one in its centre, so from a high place the budget is spread
// over the city, not over the frame. This probe measures that, and tries the other rule IN THE PAGE (--view on): the
// same method replaced, at run time, by one that leaves the distance alone for nodes inside the view frustum, makes it
// a little longer in a ring around the frame (so a turn finds something there), and much longer further out and behind;
// with --predict the frustum is widened toward where the camera is turning. Level selection and the download order
// both read that one number, so both follow. A probe-only override for measuring: the product is not changed by it.
//
// What a run records, at each of a few camera places (the scan's start place, above the roofs, high above):
//   - how many of the drawn splats belong to nodes that touch the view frustum, and how many do not;
//   - the level of detail shown in the frame by distance band, against the level the engine wants;
//   - frames drawn per second, files still loading, megabytes fetched, how long the place took to settle;
//   - a picture of the frame (JPEG) for the eye;
// and above the roofs a set of fast turns (yaw 90 and 180 degrees in one frame, a spin at 360 degrees/s, pitch up
// and down): right after each, how coarse the frame is against what the engine wants there, and how long it stays so.
//
//   node tools/bench/scripts/lod-view-probe.mjs --budget 1 --label lublin-1m-base
//   node tools/bench/scripts/lod-view-probe.mjs --budget 1 --view on --predict 0.25 --tune underfill=2 --label lublin-1m-view
// Options: --scene (2f1ddf5f), --browser, --variant default|force-hp, --site, --ring <deg> (25), --ringFactor (1.6),
// --far <deg> (80), --farFactor (16), --angle <deg> (lodUpdateAngle, 8 with --view), --heights "40,140" (metres above the
// start place), --pitch "-20,-35", --settle <s> (45), --no-turns, --cool <C>.
// Output: evidence/<date>/lod-view/<label>.json and <label>-<place>.jpg. Takes the benches' GPU lock.
import { mkdirSync, rmdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { asciiJson, browserExe, mask, startStockBrowser, VARIANTS } from './gpu-select-probe.mjs';
import { frameStats, nvidiaThermal } from './gpu-select-fly.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LOCK = 'C:/dev/.gpu-lock';
const r2 = (x) => (x === null || x === undefined || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);

export function parseArgs(argv) {
    const o = { browser: 'chrome', variant: 'default', scene: '2f1ddf5f', label: '', site: 'https://gsfpv.flyreelstudio.eu', path: '/en/fly/', budget: 1, view: false, predict: 0, force: 0, hold: 0, product: false, ring: 25, ringFactor: 1.6, far: 80, farFactor: 16, angle: null, heights: [40, 140], pitch: [-20, -35], settle: 45, turns: true, cool: 0, tune: {}, query: '' };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        const num = () => Number(argv[++i]);
        if (a === '--browser') o.browser = argv[++i];
        else if (a === '--variant') o.variant = argv[++i];
        else if (a === '--scene') o.scene = argv[++i];
        else if (a === '--label') o.label = argv[++i];
        else if (a === '--site') o.site = argv[++i].replace(/\/$/, '');
        // the page's path on that site: /en/fly/ on the live site and a release build, /fly/ on the Vite dev server
        else if (a === '--path') o.path = argv[++i];
        else if (a === '--budget') o.budget = num();
        else if (a === '--view') o.view = argv[++i] === 'on';
        else if (a === '--predict') o.predict = num();
        // --force <deg>: ask the engine for a new choice of detail as soon as the view turned that far since the last one
        // (the engine alone looks every 10th frame, and then only after lodUpdateAngle); 0 leaves the engine's cadence
        else if (a === '--force') o.force = num();
        // --product: the page's own code is what is measured (a build that has the frame's priority in it): the probe sets
        // nothing in the engine, it only reads (with --query "&viewlod=0" the same build runs the engine's own rule)
        else if (a === '--product') o.product = true;
        else if (a === '--ring') o.ring = num();
        else if (a === '--ringFactor') o.ringFactor = num();
        else if (a === '--far') o.far = num();
        else if (a === '--farFactor') o.farFactor = num();
        else if (a === '--angle') o.angle = num();
        else if (a === '--heights') o.heights = argv[++i].split(',').map(Number);
        else if (a === '--pitch') o.pitch = argv[++i].split(',').map(Number);
        else if (a === '--settle') o.settle = num();
        // --hold <x>: every turn is held x times as long (a reference run at a big budget needs the time to load its new view)
        else if (a === '--hold') o.hold = num();
        else if (a === '--no-turns') o.turns = false;
        else if (a === '--cool') o.cool = num();
        else if (a === '--query') o.query = argv[++i];
        else if (a === '--tune') {
            const [k, v] = argv[++i].split('=');
            // multiplier: the scan's lodMultiplier (how fast detail falls with distance; the engine's default is 3)
            if (!['underfill', 'concurrent', 'behind', 'cooldown', 'multiplier'].includes(k) || !Number.isFinite(Number(v))) throw new Error(`--tune ${k}=${v}`);
            o.tune[k] = Number(v);
        } else throw new Error(`unknown argument ${a}`);
    }
    if (!VARIANTS[o.variant]) throw new Error(`unknown variant ${o.variant}`);
    if (o.angle === null) o.angle = o.view ? 8 : 90;
    if (!o.label) o.label = `${o.scene}-${o.budget}m-${o.view ? 'view' : 'base'}`;
    return o;
}

async function lock() {
    let waited = 0;
    for (;;) {
        try {
            mkdirSync(LOCK);
            return;
        } catch {
            try {
                if (Date.now() - statSync(LOCK).mtimeMs > 30 * 60 * 1000) {
                    rmdirSync(LOCK);
                    continue;
                }
            } catch {
                /* gone */
            }
            if (!waited++) console.log('waiting for the GPU lock');
            await sleep(200);
        }
    }
}
const unlock = () => {
    try {
        rmdirSync(LOCK);
    } catch {
        /* not ours */
    }
};

// ---- in the page ----

/** Every frame: [time, interval, files loading, frames held (cumulative), governor step, render scale, splats, place]. */
const TRACE = `(function hookTrace() {
    window.__gsTrace = window.__gsTrace || [];
    const h = window.__gsfpv; const s = h && h.session; const r = s && s.renderer;
    if (!r || !r.app) { setTimeout(hookTrace, 50); return; }
    if (window.__gsTraceOn) return;
    window.__gsTraceOn = true;
    let last = 0;
    r.app.on('frameend', () => {
        const t = performance.now(); const g = h.governor;
        if (window.__gsTrace.length < 60000) window.__gsTrace.push([Math.round(t * 10) / 10, last ? Math.round((t - last) * 100) / 100 : 0, r.splatFrame ? r.splatFrame.loading : -1, r.framesHeld, g ? g.step : -1, r.renderScale, r.app.stats.frame.gsplats, window.__gsPlace || '']);
        last = t;
    });
})()`;

/** The first octree instance of the page (engine internals, read for measuring), or null while there is none. */
const INSTANCE = `(() => {
    const h = window.__gsfpv; const s = h && h.session; const r = s && s.renderer; const a = r && r.app;
    const dir = a && a.renderer && a.renderer.gsplatDirector;
    let inst = null;
    if (dir) dir.camerasMap.forEach((cd) => cd.layersMap.forEach((ld) => { const m = ld.gsplatManager && ld.gsplatManager.world; if (m && m._octreeInstances) m._octreeInstances.forEach((i) => { inst = inst || i; }); }));
    return inst;
})()`;

/**
 * --view on: the engine's per-node distance replaced by a view-dependent one (see the header). cfg: ring and far in
 * degrees beyond the frustum's edge, their factors on the distance, predict in seconds of the present turn rate.
 * --tune and lodUpdateAngle are set here too, as soon as the renderer exists.
 */
const SETUP = (o) => `(function setup() {
    const h = window.__gsfpv; const s = h && h.session; const r = s && s.renderer; const a = r && r.app;
    if (!a) { setTimeout(setup, 20); return; }
    const g = a.scene.gsplat; const cfg = ${JSON.stringify({ view: o.view, predict: o.predict, force: o.force, ring: o.ring, ringFactor: o.ringFactor, far: o.far, farFactor: o.farFactor, angle: o.angle, tune: o.tune, product: o.product })};
    if (!window.__gsSetup) {
        window.__gsSetup = { at: Math.round(performance.now()), cfg, before: { underfill: g.lodUnderfillLimit, behind: g.lodBehindPenalty, angle: g.lodUpdateAngle, cooldown: g.cooldownTicks }, view: null };
        if (!cfg.product) g.lodUpdateAngle = cfg.angle;
        if (cfg.tune.underfill !== undefined) g.lodUnderfillLimit = cfg.tune.underfill;
        if (cfg.tune.behind !== undefined) g.lodBehindPenalty = cfg.tune.behind;
        if (cfg.tune.cooldown !== undefined) g.cooldownTicks = cfg.tune.cooldown;
    }
    const inst = ${INSTANCE};
    if (!inst) { setTimeout(setup, 20); return; }
    const loader = inst.octree.assetLoader;
    if (loader && cfg.tune.concurrent !== undefined && window.__gsSetup.before.concurrent === undefined) { window.__gsSetup.before.concurrent = loader.maxConcurrentLoads; loader.maxConcurrentLoads = cfg.tune.concurrent; }
    const comp = r.splat && r.splat.gsplat;
    if (comp && cfg.tune.multiplier !== undefined && window.__gsSetup.before.multiplier === undefined) { window.__gsSetup.before.multiplier = comp.lodMultiplier; comp.lodMultiplier = cfg.tune.multiplier; }
    if (window.__gsSetup.view) return;
    const proto = Object.getPrototypeOf(inst);
    const D2R = Math.PI / 180;
    const stat = window.__gsSetup.view = { installedAt: Math.round(performance.now()), on: cfg.view, calls: 0, ms: 0, forced: 0, inFrustum: 0, ring: 0, out: 0 };
    const orig = proto.evaluateNodeDistances;
    let prevF = null; let prevT = 0;
    // the view axis of the last choice of detail, and (--force) a new choice asked for as soon as the view left it far enough
    let evalF = null;
    if (cfg.force > 0) {
        let world = null;
        a.renderer.gsplatDirector.camerasMap.forEach((cd) => cd.layersMap.forEach((ld) => { const m = ld.gsplatManager && ld.gsplatManager.world; if (m && m._octreeInstances) world = world || m; }));
        a.on('update', () => {
            if (!world || !evalF) return;
            const fw = r.camera.forward;
            const dot = Math.min(1, Math.max(-1, fw.x * evalF.x + fw.y * evalF.y + fw.z * evalF.z));
            if (Math.acos(dot) > cfg.force * D2R) { world._lodUpdateRequested = true; world.markInstancesNeedLodUpdate(); stat.forced++; }
        });
    }
    proto.evaluateNodeDistances = function (cameraNode, params) {
        const t0 = performance.now();
        const fw0 = cameraNode.forward; evalF = { x: fw0.x, y: fw0.y, z: fw0.z };
        if (!cfg.view) { orig.call(this, cameraNode, params); stat.calls++; stat.ms += performance.now() - t0; return; }
        const shrink = params.lodDistanceShrink ?? 0;
        const excessFlat = this.octree.nodeBoundsExcess;
        const wt = this.placement.node.getWorldTransform();
        const uniformScale = wt.getScale().x;
        const camera = cameraNode.camera;
        const aspect = camera.aspectRatio > 0 && Number.isFinite(camera.aspectRatio) ? camera.aspectRatio : 1;
        let tanV = Math.tan(camera.fov * 0.5 * D2R);
        if (camera.horizontalFov) tanV /= aspect;
        const tanH = tanV * aspect;
        const fovScale = Math.min(tanV, tanH) / Math.tan(22.5 * D2R);
        const halfH = Math.atan(tanH); const halfV = Math.atan(tanV);
        // the camera in the octree's own space: place and the three axes
        const inv = wt.clone().invert();
        const V = cameraNode.getPosition().constructor;
        const p = inv.transformPoint(cameraNode.getPosition(), new V());
        const f = inv.transformVector(cameraNode.forward, new V()).normalize();
        const rt = inv.transformVector(cameraNode.right, new V()).normalize();
        const up = inv.transformVector(cameraNode.up, new V()).normalize();
        // where the camera will look after cfg.predict seconds of the present turn (from the last two evaluations)
        let pf = null;
        if (cfg.predict > 0 && prevF && t0 - prevT < 1000 && t0 > prevT) {
            const k = cfg.predict * 1000 / (t0 - prevT);
            const x = f.x + (f.x - prevF.x) * k, y = f.y + (f.y - prevF.y) * k, z = f.z + (f.z - prevF.z) * k;
            const l = Math.hypot(x, y, z);
            if (l > 1e-6 && Math.hypot(f.x - prevF.x, f.y - prevF.y, f.z - prevF.z) > 0.01) pf = { x: x / l, y: y / l, z: z / l };
        }
        prevF = { x: f.x, y: f.y, z: f.z }; prevT = t0;
        // the predicted view keeps the camera's roll: its right axis is the old one made square to the new forward
        let prt = null; let pup = null;
        if (pf) {
            const d = rt.x * pf.x + rt.y * pf.y + rt.z * pf.z;
            let x = rt.x - pf.x * d, y = rt.y - pf.y * d, z = rt.z - pf.z * d; const l = Math.hypot(x, y, z) || 1;
            prt = { x: x / l, y: y / l, z: z / l };
            pup = { x: prt.y * pf.z - prt.z * pf.y, y: prt.z * pf.x - prt.x * pf.z, z: prt.x * pf.y - prt.y * pf.x };
        }
        const ring = cfg.ring * D2R; const far = cfg.far * D2R;
        // how far (radians) a node of angular radius ar, seen along (fx, rx, ux), lies outside a frustum
        const excess = (vx, vy, vz, d, ar, F, R, U) => {
            const z = vx * F.x + vy * F.y + vz * F.z; const x = Math.abs(vx * R.x + vy * R.y + vz * R.z); const y = Math.abs(vx * U.x + vy * U.y + vz * U.z);
            const eh = Math.max(0, Math.atan2(x, z) - halfH - ar); const ev = Math.max(0, Math.atan2(y, z) - halfV - ar);
            return Math.hypot(eh, ev);
        };
        const nodes = this.octree.nodes; const infos = this.nodeInfos; const b6 = this.octree.nodeBoundsMinMax;
        const scaleSq = fovScale * uniformScale * (fovScale * uniformScale);
        let nIn = 0, nRing = 0, nOut = 0;
        for (let i = 0; i < nodes.length; i++) {
            const b = i * 6;
            let minX = b6[b], minY = b6[b + 1], minZ = b6[b + 2], maxX = b6[b + 3], maxY = b6[b + 4], maxZ = b6[b + 5];
            if (shrink > 0) { const e = i * 3; const sx = excessFlat[e] * shrink, sy = excessFlat[e + 1] * shrink, sz = excessFlat[e + 2] * shrink; minX += sx; maxX -= sx; minY += sy; maxY -= sy; minZ += sz; maxZ -= sz; }
            const qx = p.x < minX ? minX : p.x > maxX ? maxX : p.x; const qy = p.y < minY ? minY : p.y > maxY ? maxY : p.y; const qz = p.z < minZ ? minZ : p.z > maxZ ? maxZ : p.z;
            const dx = qx - p.x, dy = qy - p.y, dz = qz - p.z;
            const distanceSq = dx * dx + dy * dy + dz * dz;
            let factor = 1;
            if (distanceSq > 1e-4) {
                // the node as a sphere seen from the camera: its centre's direction and its angular radius
                const cx = (minX + maxX) * 0.5 - p.x, cy = (minY + maxY) * 0.5 - p.y, cz = (minZ + maxZ) * 0.5 - p.z;
                const d = Math.hypot(cx, cy, cz);
                const rad = 0.5 * Math.hypot(maxX - minX, maxY - minY, maxZ - minZ);
                if (d > rad) {
                    const ar = Math.asin(Math.min(1, rad / d));
                    let e = excess(cx, cy, cz, d, ar, f, rt, up);
                    if (e > 0 && pf) e = Math.min(e, excess(cx, cy, cz, d, ar, pf, prt, pup));
                    if (e <= 0) nIn++;
                    else if (e < ring) { factor = 1 + (cfg.ringFactor - 1) * (e / ring); nRing++; }
                    else { const t = Math.min(1, (e - ring) / Math.max(1e-3, far - ring)); const sm = t * t * (3 - 2 * t); factor = cfg.ringFactor + (cfg.farFactor - cfg.ringFactor) * sm; nOut++; }
                } else nIn++;
            } else nIn++;
            infos[i].worldDistanceSq = distanceSq * factor * factor * scaleSq;
        }
        stat.calls++; stat.ms += performance.now() - t0; stat.inFrustum = nIn; stat.ring = nRing; stat.out = nOut;
    };
})()`;

/** The scan: its box in the world, node and level counts, splats per level, the start place of the camera. */
const SCAN = `(() => {
    const h = window.__gsfpv; const s = h.session; const r = s.renderer; const inst = ${INSTANCE};
    if (!inst) return null;
    const wt = inst.placement.node.getWorldTransform(); const V = r.camera.getPosition().constructor; const v = new V();
    let min = [1e30, 1e30, 1e30], max = [-1e30, -1e30, -1e30]; const per = {};
    inst.octree.nodes.forEach((n) => {
        const c = n.bounds.center; const e = n.bounds.halfExtents;
        for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) { v.set(c.x + sx * e.x, c.y + sy * e.y, c.z + sz * e.z); wt.transformPoint(v, v); min = [Math.min(min[0], v.x), Math.min(min[1], v.y), Math.min(min[2], v.z)]; max = [Math.max(max[0], v.x), Math.max(max[1], v.y), Math.max(max[2], v.z)]; }
        n.lods.forEach((c2, l) => { per[l] = (per[l] || 0) + (c2 ? c2.count : 0); });
    });
    const p = r.camera.getPosition(); const f = r.camera.forward;
    const rd = (a) => a.map((x) => Math.round(x * 10) / 10);
    return { nodes: inst.octree.nodes.length, levels: inst.octree.lodLevels, files: inst.octree.files ? inst.octree.files.length : null, scale: Math.round(wt.getScale().x * 1000) / 1000, min: rd(min), max: rd(max), splatsPerLevelM: Object.fromEntries(Object.entries(per).map(([k, x]) => [k, Math.round(x / 1e4) / 100])), start: { pos: rd([p.x, p.y, p.z]), yawDeg: Math.round(Math.atan2(f.x, f.z) * 1800 / Math.PI) / 10, pitchDeg: Math.round(Math.asin(Math.max(-1, Math.min(1, f.y))) * 1800 / Math.PI) / 10 }, fov: r.camera.camera.fov, horizontalFov: r.camera.camera.horizontalFov, aspect: Math.round(r.camera.camera.aspectRatio * 1000) / 1000 };
})()`;

/** The camera held at a place by the probe (the session's cameraOverride), every engine update. */
const HOLD = `(() => {
    const h = window.__gsfpv; const s = h.session; const r = s.renderer; const a = r.app;
    if (window.__gsHold) return true;
    window.__gsHold = { pos: null, yaw: 0, pitch: 0, spin: 0, t: performance.now() };
    s.cameraOverride = true;
    a.on('update', () => {
        const c = window.__gsHold; if (!c.pos) return;
        const now = performance.now(); const dt = (now - c.t) / 1000; c.t = now;
        if (c.spin) c.yaw += c.spin * dt;
        const y = c.yaw * Math.PI / 180, p = c.pitch * Math.PI / 180;
        r.setCameraLookAt(c.pos[0], c.pos[1], c.pos[2], c.pos[0] + Math.sin(y) * Math.cos(p) * 10, c.pos[1] + Math.sin(p) * 10, c.pos[2] + Math.cos(y) * Math.cos(p) * 10);
    });
    return true;
})()`;

/**
 * Where the budget is: the nodes whose bounding sphere touches the view frustum against the rest, the level shown and
 * wanted in the frame by distance band (under 25 m, 25 to 100 m, 100 to 400 m, beyond) and inside 15 degrees of the
 * view axis. The frustum test is the camera's own planes from its field of view (not the probe's rule under test).
 */
const STATE = `(() => {
    const h = window.__gsfpv; const s = h.session; const r = s.renderer; const a = r.app; const inst = ${INSTANCE};
    const out = { t: Math.round(performance.now()), loading: r.splatFrame ? r.splatFrame.loading : null, drawn: a.stats.frame.gsplats, budgetM: Math.round(a.scene.gsplat.splatBudget / 1e4) / 100, step: h.governor ? h.governor.step : null, scale: r.renderScale, held: r.framesHeld, place: window.__gsPlace || '' };
    if (!inst) return out;
    const cam = r.camera; const cp = cam.getPosition(); const F = cam.forward, R = cam.right, U = cam.up;
    const c = cam.camera; const aspect = c.aspectRatio > 0 ? c.aspectRatio : 1;
    let tanV = Math.tan(c.fov * Math.PI / 360); if (c.horizontalFov) tanV /= aspect; const tanH = tanV * aspect;
    const cosH = 1 / Math.hypot(1, tanH), sinH = tanH * cosH, cosV = 1 / Math.hypot(1, tanV), sinV = tanV * cosV;
    const wt = inst.placement.node.getWorldTransform(); const sc = Math.abs(wt.getScale().x) || 1; const v = cp.clone();
    const BANDS = [25, 100, 400, 1e9];
    const mk = () => ({ n: 0, none: 0, atWanted: 0, cur: 0, want: 0, splats: 0 });
    const inB = BANDS.map(mk); const centre = mk(); const inAll = mk(); const outAll = mk();
    const ns = inst.octree.nodes;
    out.pending = inst.pending.size; out.prefetch = inst.prefetchPending.size;
    // the picture's own measure: each node in the frame weighted by the share of the picture it covers (its solid angle),
    // so the level a pilot sees over most of the screen counts most; and the splats drawn per unit of that area
    let area = 0, areaLevel = 0, areaNone = 0;
    inst.nodeInfos.forEach((ni, i) => {
        const b = ns[i].boundingSphere; v.set(b.x, b.y, b.z); wt.transformPoint(v, v);
        const dx = v.x - cp.x, dy = v.y - cp.y, dz = v.z - cp.z; const d = Math.hypot(dx, dy, dz); const rad = b.w * sc;
        const z = dx * F.x + dy * F.y + dz * F.z; const x = Math.abs(dx * R.x + dy * R.y + dz * R.z); const y = Math.abs(dx * U.x + dy * U.y + dz * U.z);
        const inside = d < rad || (z > -rad && x * cosH - z * sinH <= rad && y * cosV - z * sinV <= rad);
        const l = ni.currentLod; const cnt = l >= 0 && ns[i].lods[l] ? ns[i].lods[l].count : 0;
        const add = (o) => { o.n++; if (l < 0) o.none++; else { o.cur += l; o.splats += cnt; } if (ni.optimalLod >= 0) { o.want += ni.optimalLod; if (l === ni.optimalLod) o.atWanted++; } };
        if (!inside) { add(outAll); return; }
        add(inAll); add(inB[BANDS.findIndex((k) => Math.max(0, d - rad) < k)]);
        if (d < rad || z / d > 0.966) add(centre);
        const w = d > rad ? (rad / d) * (rad / d) : 1;
        if (l < 0) areaNone += w; else { area += w; areaLevel += w * l; }
    });
    const sum = (o) => ({ n: o.n, none: o.none, atWanted: o.atWanted, meanShown: o.n - o.none > 0 ? Math.round(o.cur / (o.n - o.none) * 100) / 100 : null, meanWanted: o.n ? Math.round(o.want / o.n * 100) / 100 : null, splatsM: Math.round(o.splats / 1e4) / 100 });
    out.inFrustum = sum(inAll); out.outside = sum(outAll); out.centre = sum(centre); out.bands = inB.map(sum);
    out.shareInFrustum = inAll.splats + outAll.splats > 0 ? Math.round(inAll.splats / (inAll.splats + outAll.splats) * 1000) / 1000 : null;
    out.areaLevel = area > 0 ? Math.round(areaLevel / area * 100) / 100 : null;
    out.areaEmptyShare = area + areaNone > 0 ? Math.round(areaNone / (area + areaNone) * 1000) / 1000 : null;
    return out;
})()`;

async function main() {
    const o = parseArgs(process.argv.slice(2));
    if (process.platform !== 'win32') throw new Error('lod-view-probe: Windows only');
    const exe = browserExe(o.browser);
    if (!exe) throw new Error(`no executable for --browser ${o.browser}`);
    const outDir = join(REPO, 'evidence', new Date().toISOString().slice(0, 10), 'lod-view');
    mkdirSync(outDir, { recursive: true });
    const url = `${o.site}${o.path}?scene=${o.scene}&nowarn=1&input=touch&governor=0&budget=${o.budget}${o.query}`;
    const result = { name: `lod-view/${o.label}`, date: new Date().toISOString(), label: o.label, scene: o.scene, url, variant: o.variant, budgetM: o.budget, view: o.view ? { ringDeg: o.ring, ringFactor: o.ringFactor, farDeg: o.far, farFactor: o.farFactor, predictS: o.predict } : null, forceDeg: o.force, lodUpdateAngle: o.angle, tune: o.tune, bandsMetres: [25, 100, 400, 'more'] };
    await lock();
    let stock = null;
    try {
        if (o.cool) for (let t0 = Date.now(); Date.now() - t0 < 300000; await sleep(5000)) { const th = nvidiaThermal(); if (!th || th.tempC <= o.cool) break; }
        result.thermalBefore = nvidiaThermal();
        stock = await startStockBrowser({ exe, label: o.label, variant: o.variant, maximized: true });
        const { context, page } = stock;
        result.browser = stock.version;
        const files = [];
        let nav0 = Date.now();
        page.on('response', (resp) => {
            const u = resp.url();
            if (!u.includes(`/${o.scene}/`)) return;
            const m = u.match(/\/(\d+)_(\d+)\/([^/?]+)/);
            files.push({ t: Date.now() - nav0, level: m ? Number(m[1]) : null, bytes: Number(resp.headers()['content-length'] ?? 0) || 0 });
        });
        await context.addInitScript(TRACE);
        await context.addInitScript(SETUP(o));
        await page.bringToFront();
        nav0 = Date.now();
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
        const trace = [];
        const drain = async () => {
            for (const x of await page.evaluate('window.__gsTrace ? window.__gsTrace.splice(0) : []').catch(() => [])) trace.push(x);
        };
        const ready = async (expr, ms) => {
            for (const t0 = Date.now(); Date.now() - t0 < ms; await sleep(250)) if (await page.evaluate(`(() => { try { return !!(${expr}); } catch (e) { return false; } })()`).catch(() => false)) return true;
            return false;
        };
        if (!(await ready('window.__gsfpv && window.__gsfpv.session && window.__gsfpv.session.timings && window.__gsfpv.session.timings.visibleMs !== null', 240000))) throw new Error(`the scan did not reveal: ${await page.evaluate('JSON.stringify({ s: window.__gsfpv && window.__gsfpv.status, e: window.__gsfpv && window.__gsfpv.error })').catch(() => '?')}`);
        result.revealS = r2((Date.now() - nav0) / 1000);
        // the pictures are of the scan: the page's own layer of notes, sticks and buttons is hidden for them (a style of the
        // probe's, nothing of the page is switched off)
        await page.addStyleTag({ content: '#ui { visibility: hidden !important; }' }).catch(() => {});
        /** Stay at the present place until nothing loads for 2.5 s (or `maxS`), sampling the state every 250 ms. */
        const settle = async (maxS) => {
            const t0 = Date.now();
            const samples = [];
            let calm = 0;
            for (;;) {
                await sleep(250);
                const st = await page.evaluate(STATE);
                samples.push({ ms: Date.now() - t0, loading: st.loading, pending: st.pending, drawnM: r2(st.drawn / 1e6), share: st.shareInFrustum, inM: st.inFrustum?.splatsM, area: st.areaLevel ?? null, shown: st.inFrustum?.meanShown, wanted: st.inFrustum?.meanWanted, centreShown: st.centre?.meanShown, centreWanted: st.centre?.meanWanted, behind: st.inFrustum ? st.inFrustum.n - st.inFrustum.atWanted : null });
                await drain();
                calm = st.loading === 0 && (st.pending ?? 0) === 0 && (st.prefetch ?? 0) === 0 ? calm + 1 : 0;
                if (calm >= 10) return { settledS: r2((Date.now() - t0 - 2500) / 1000), timedOut: false, samples, last: st };
                if (Date.now() - t0 > maxS * 1000) return { settledS: null, timedOut: true, samples, last: st };
            }
        };
        const megabytes = () => r2(files.reduce((a, b) => a + b.bytes, 0) / 1e6);
        // every picture also as a PNG under .cache/lod-view (not evidence: too big to commit), for lod-view-score.mjs, which
        // scores a run's pictures against those of a run at a much higher budget from the same places; `jpeg` false: the PNG only
        const pngDir = join(REPO, '.cache', 'lod-view');
        mkdirSync(pngDir, { recursive: true });
        const shot = async (name, jpeg = true) => {
            writeFileSync(join(pngDir, `${o.label}-${name}.png`), await page.screenshot({ type: 'png' }));
            if (!jpeg) return null;
            const file = `${o.label}-${name}.jpg`;
            writeFileSync(join(outDir, file), await page.screenshot({ type: 'jpeg', quality: 72 }));
            return file;
        };
        // ---- the start place ----
        await page.evaluate(`window.__gsPlace = 'start'`);
        const first = await settle(Math.max(o.settle, 90));
        result.scan = await page.evaluate(SCAN);
        result.setup = await page.evaluate('window.__gsSetup || null');
        trace.length = 0;
        await sleep(4000);
        await drain();
        result.places = [{ place: 'start', settledS: first.settledS, timedOut: first.timedOut, megabytes: megabytes(), frames: frameStats(trace), state: first.last, picture: await shot('start') }];
        // ---- above the roofs, and higher: straight up from the start place, looking the way the scan's start looks ----
        await page.evaluate(HOLD);
        const start = result.scan.start;
        for (let i = 0; i < o.heights.length; i++) {
            const place = `up${o.heights[i]}`;
            const mb0 = megabytes();
            await page.evaluate(`(() => { window.__gsPlace = '${place}'; const c = window.__gsHold; c.pos = [${start.pos[0]}, ${start.pos[1] + o.heights[i]}, ${start.pos[2]}]; c.yaw = ${start.yawDeg}; c.pitch = ${o.pitch[i] ?? o.pitch[o.pitch.length - 1]}; c.spin = 0; })()`);
            const st = await settle(o.settle);
            trace.length = 0;
            await sleep(4000);
            await drain();
            result.places.push({ place, heightM: o.heights[i], pitchDeg: o.pitch[i] ?? o.pitch[o.pitch.length - 1], settledS: st.settledS, timedOut: st.timedOut, megabytesHere: r2(megabytes() - mb0), frames: frameStats(trace), state: st.last, firstSeconds: st.samples.filter((x, k) => k % 4 === 0).slice(0, 12), picture: await shot(place) });
        }
        // ---- fast turns above the roofs (the first height) ----
        if (o.turns) {
            const place = `up${o.heights[0]}`;
            await page.evaluate(`(() => { window.__gsPlace = '${place}'; const c = window.__gsHold; c.pos = [${start.pos[0]}, ${start.pos[1] + o.heights[0]}, ${start.pos[2]}]; c.yaw = ${start.yawDeg}; c.pitch = ${o.pitch[0]}; c.spin = 0; })()`);
            await settle(o.settle);
            const turns = [
                // (a little over 90 and 180: at exactly 90 degrees the engine's own rule, "more than lodUpdateAngle", does not fire)
                { name: 'yaw95', set: `c.yaw += 95`, hold: 7 },
                { name: 'yaw185', set: `c.yaw += 185`, hold: 7 },
                { name: 'pitchUp', set: `c.pitch = ${Math.min(30, o.pitch[0] + 45)}`, hold: 6 },
                { name: 'pitchDown', set: `c.pitch = ${Math.max(-80, o.pitch[0] - 35)}`, hold: 6 },
                { name: 'spin360', set: `c.pitch = ${o.pitch[0]}; c.spin = 360`, hold: 3, after: `c.spin = 0` },
                // (the spin stops wherever its last frame left it: the view is put on a fixed heading, the same in every run,
                // so that its pictures can be compared between runs)
                { name: 'afterSpin', set: `c.spin = 0; c.yaw = ${start.yawDeg + 140}`, hold: 6 }
            ];
            result.turns = [];
            for (const tn of turns) {
                if (o.hold > 0 && !/spin360/.test(tn.name)) tn.hold = Math.round(tn.hold * o.hold);
                trace.length = 0;
                await page.evaluate(`(() => { window.__gsPlace = '${tn.name}'; const c = window.__gsHold; ${tn.set}; })()`);
                const t0 = Date.now();
                const samples = [];
                // pictures of the new view for the score: at once (the screenshot itself takes a moment), about 1.5 s on, and at
                // the end of the hold (not for the spin, whose view never stands still)
                const still = !/spin/i.test(tn.name) || tn.name === 'afterSpin';
                const shotTimes = {};
                if (still) { await shot(`turn-${tn.name}-0`, false); shotTimes.atOnceMs = Date.now() - t0; }
                while (Date.now() - t0 < tn.hold * 1000) {
                    await sleep(120);
                    if (still && shotTimes.laterMs === undefined && Date.now() - t0 >= 1500) { await shot(`turn-${tn.name}-1`, false); shotTimes.laterMs = Date.now() - t0; }
                    const st = await page.evaluate(STATE);
                    samples.push({ ms: Date.now() - t0, loading: st.loading, share: st.shareInFrustum, inM: st.inFrustum.splatsM, shown: st.inFrustum.meanShown, wanted: st.inFrustum.meanWanted, area: st.areaLevel, empty: st.areaEmptyShare, centreShown: st.centre.meanShown, centreWanted: st.centre.meanWanted, behind: st.inFrustum.n - st.inFrustum.atWanted, n: st.inFrustum.n, none: st.inFrustum.none });
                }
                if (still) await shot(`turn-${tn.name}-end`, tn.name === 'yaw185' || tn.name === 'pitchDown');
                if (tn.after) await page.evaluate(`(() => { const c = window.__gsHold; ${tn.after}; })()`);
                await drain();
                // How coarse the new frame is right after the turn against what it becomes once the engine has caught up: the
                // level the picture shows (weighted by the area each node covers) at once, after 1 s and 3 s, and at the end of the
                // hold; "ms to a quarter level" is the time until it is within a quarter of a level of that end value. (Against the
                // engine's own "wanted" level a turn shows no gap at all: until the engine looks again it wants what it shows.)
                const end = samples[samples.length - 1];
                const at = (ms) => samples.find((x) => x.ms >= ms) ?? end;
                const gap = (x) => (x.area !== null && end.area !== null ? r2(x.area - end.area) : null);
                const close = samples.find((x) => gap(x) !== null && gap(x) <= 0.25);
                result.turns.push({ turn: tn.name, holdS: tn.hold, pictures: still ? shotTimes : null, frames: frameStats(trace), areaLevelAtOnce: samples[0].area, areaLevelAfter1s: at(1000).area, areaLevelAfter3s: at(3000).area, areaLevelAtEnd: end.area, gapAtFirstSample: gap(samples[0]), gapAfter1s: gap(at(1000)), gapAfter3s: gap(at(3000)), msToQuarterLevel: close ? close.ms : null, emptyAreaAtFirstSample: samples[0].empty, emptyNodesAtFirstSample: samples[0].none, inFrameAtOnceM: samples[0].inM, inFrameAtEndM: end.inM, shareInFrustumAtOnce: samples[0].share, shareInFrustumAtEnd: end.share, maxLoading: samples.reduce((a, b) => Math.max(a, b.loading ?? 0), 0), samples: samples.filter((x, k) => k % 3 === 0) });
            }
        }
        result.megabytes = megabytes();
        result.filesFetched = files.length;
        result.viewStats = await page.evaluate('window.__gsSetup ? window.__gsSetup.view : null');
        // what the page's own code says about the frame's priority (a build that has it), and the engine's settings at the end
        result.product = await page.evaluate(`(() => { const h = window.__gsfpv; const r = h.session.renderer; const g = r.app.scene.gsplat; const comp = r.splat && r.splat.gsplat; const oct = comp && comp.resource && comp.resource.octree; return { viewLod: typeof r.viewLodStats === 'function' ? r.viewLodStats() : null, engine: { lodBehindPenalty: g.lodBehindPenalty, lodUpdateAngle: g.lodUpdateAngle, lodUnderfillLimit: g.lodUnderfillLimit, cooldownTicks: g.cooldownTicks, lodMultiplier: comp ? comp.lodMultiplier : null, parallelLoads: oct && oct.assetLoader ? oct.assetLoader.maxConcurrentLoads : null } }; })()`).catch(() => null);
        result.thermalAfter = nvidiaThermal();
        const last = await page.evaluate(`(() => { const h = window.__gsfpv; const r = h.session.renderer; const d = h.drawing || {}; return { gpu: r.gpuInfo, cls: d.class, drawn: d.drawn, backbuffer: [r.app.graphicsDevice.width, r.app.graphicsDevice.height], lod: h.lod() }; })()`);
        result.page = last;
        result.verdict = {
            adapter: last.gpu ? `${last.gpu.vendor} ${last.gpu.architecture}` : 'webgl',
            scan: `${result.scan.nodes} nodes, ${result.scan.levels} levels, ${result.scan.splatsPerLevelM[0]} M splats`,
            places: result.places.map((p) => `${p.place}: ${Math.round((p.state.shareInFrustum ?? 0) * 100)} % of ${r2(p.state.drawn / 1e6)} M drawn splats in the frame (${p.state.inFrustum?.splatsM} M), level over the picture ${p.state.areaLevel} (by node ${p.state.inFrustum?.meanShown}, centre ${p.state.centre?.meanShown}), empty ${Math.round((p.state.areaEmptyShare ?? 0) * 100)} %, ${p.frames.fps} frames/s, settled ${p.settledS ?? 'not in ' + o.settle} s`),
            turns: (result.turns ?? []).map((t) => `${t.turn}: level over the picture ${t.areaLevelAtOnce} at once, ${t.areaLevelAfter1s} after 1 s, ${t.areaLevelAfter3s} after 3 s, ${t.areaLevelAtEnd} at the end; within a quarter level in ${t.msToQuarterLevel ?? '-'} ms; in the frame ${t.inFrameAtOnceM} M at once, ${t.inFrameAtEndM} M at the end; ${t.frames.fps} frames/s`),
            megabytes: result.megabytes
        };
    } catch (e) {
        result.error = String(e?.stack ?? e).slice(0, 1500);
    } finally {
        if (stock) await stock.close(false);
        unlock();
    }
    const file = join(outDir, `${o.label}.json`);
    writeFileSync(file, asciiJson(mask(JSON.stringify(result, null, 1))) + '\n');
    console.log(JSON.stringify({ file: file.replace(REPO, '.').replace(/\\/g, '/'), verdict: result.verdict ?? null, error: result.error ?? null }, null, 2));
    if (result.error) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === resolve(process.argv[1]).toLowerCase()) await main();
