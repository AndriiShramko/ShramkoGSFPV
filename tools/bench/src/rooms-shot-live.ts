// The lead's eyes on two pilots in one room: screenshots from B while A's drone and name tag are in B's view. Not a check with
// a verdict (rooms-two-page.ts and train1-live.ts decide); it keeps pictures and measures how much of B's view A's drone covers.
//   live:  cd tools/bench && SITE=https://gsfpv.flyreelstudio.eu SHOTS=<dir> npx tsx src/rooms-shot-live.ts
//   local: cd tools/bench && LOOK=before|after SHOTS=<dir> npx tsx src/rooms-shot-live.ts   (the release in dist/, rooms-serve.ts)
// The local run (lane look, docs/wip/look.md): A creates a room, B joins by the link, both go back to the start and pause (the
// sims stop; the page keeps sending the paused pose). Shot 1: both at the start. Then A's paused sim is put d metres in front of
// B's camera (the probe writes A's own sim state through the page hook: no teleport in the app) for each d of DISTANCES_M.
// The share of B's view a drone covers: the box of the pixels that differ from the same view with A behind the camera (the
// name tags hidden in both shots), over the whole view. A second reference shot gives the noise of that diff (a control).
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Browser, Page } from 'playwright';
import { launch, waitReady } from './browser';
import { writeEvidence } from './evidence';
import { lock, unlock } from './gpu-lock';
import { startRoomsRig } from './rooms-serve';
import { REPO } from './sonicrec-serve';

const SITE = (process.env.SITE ?? '').replace(/\/+$/, '');
const LOOK = process.env.LOOK ?? '';
const SCENE = process.env.ROOM_SCENE ?? '39e63ce9';
const SHOTS = process.env.SHOTS ?? join(tmpdir(), 'gsfpv-rooms-shot');
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const rooms = <T>(p: Page, js: string): Promise<T> => p.evaluate(`(() => { const r = window.__gsfpv.rooms; ${js} })()`) as Promise<T>;
const gs = <T>(p: Page, js: string): Promise<T> => p.evaluate(`(() => { const h = window.__gsfpv; const r = h.rooms; ${js} })()`) as Promise<T>;

/** the distances in front of B's camera the look run puts A at, metres (the task's list) */
export const DISTANCES_M = [0, 0.25, 0.5, 1, 2, 4, 8];
/** a pixel differs when a channel moved more than this (0..255; an estimate above the scan's frame-to-frame noise, see refNoise) */
const DIFF_LEVEL = 40;
/** the heights over the start B may take for the sweep, metres (estimates under the thing 0.29 m over the spawn of 39e63ce9, agent-map) */
const RAISE_M = [0.05, 0.12, 0.2];
/** the proof pictures show A pitched nose down this much, as in forward flight (an estimate of a cruising pitch) */
const PROOF_PITCH_DEG = 25;
/** the longest free ray looked for, metres */
const FREE_CAP_M = 12;
/** CSS that hides the name tags in the measuring shots (the tag is not the drone's body) */
const NO_TAGS = '.rooms-tags { visibility: hidden !important; }';

export type V3 = [number, number, number];
export type Q = [number, number, number, number]; // w, x, y, z

export const qmul = (a: Q, b: Q): Q => [
    a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
    a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
    a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0]
];
const qrot = (q: Q, v: V3): V3 => {
    const p = qmul(qmul(q, [0, v[0], v[1], v[2]]), [q[0], -q[1], -q[2], -q[3]]);
    return [p[1], p[2], p[3]];
};
export const axisQ = (ax: V3, deg: number): Q => {
    const h = (deg * Math.PI) / 360;
    return [Math.cos(h), ax[0] * Math.sin(h), ax[1] * Math.sin(h), ax[2] * Math.sin(h)];
};

/** The bounding box (x0, y0, x1, y1, view px) of the pixels that differ between two PNGs, decoded in a blank page. */
async function diffBox(blank: Page, a: Buffer, b: Buffer): Promise<{ box: [number, number, number, number] | null; pixels: number; share: number; w: number; h: number }> {
    // a string, not a function: tsx would put its __name helper into a serialised function
    return (await blank.evaluate(`(async () => {
        const dec = async (s) => {
            const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + s)).blob());
            const c = new OffscreenCanvas(bmp.width, bmp.height);
            const g = c.getContext('2d');
            g.drawImage(bmp, 0, 0);
            return g.getImageData(0, 0, bmp.width, bmp.height);
        };
        const x = await dec(${JSON.stringify(a.toString('base64'))}), y = await dec(${JSON.stringify(b.toString('base64'))});
        const w = x.width, h = x.height;
        let x0 = w, y0 = h, x1 = -1, y1 = -1, n = 0;
        for (let j = 0; j < h; j++)
            for (let i = 0; i < w; i++) {
                const k = (j * w + i) * 4;
                const d = Math.max(Math.abs(x.data[k] - y.data[k]), Math.abs(x.data[k + 1] - y.data[k + 1]), Math.abs(x.data[k + 2] - y.data[k + 2]));
                if (d <= ${DIFF_LEVEL}) continue;
                n++;
                if (i < x0) x0 = i;
                if (j < y0) y0 = j;
                if (i > x1) x1 = i;
                if (j > y1) y1 = j;
            }
        const box = n ? [x0, y0, x1 + 1, y1 + 1] : null;
        return { box, pixels: n, share: box ? ((box[2] - box[0]) * (box[3] - box[1])) / (w * h) : 0, w, h };
    })()`)) as { box: [number, number, number, number] | null; pixels: number; share: number; w: number; h: number };
}

/** A creates a room in the page; returns the link and the nickname. */
async function createRoom(a: Page, url: string): Promise<{ link: string; nick: string }> {
    await a.goto(url);
    await waitReady(a, 240000);
    await sleep(1500);
    await a.keyboard.press('Digit9');
    await a.locator('[data-action=rooms-create]').click({ timeout: 15000 });
    for (let i = 0; i < 80 && !(await rooms<boolean>(a, "return r.state === 'joined' && !!r.link;").catch(() => false)); i++) await sleep(250);
    const st = await rooms<{ link: string; nick: string }>(a, 'return { link: r.link, nick: r.nick };');
    await a.keyboard.press('Escape').catch(() => undefined);
    return st;
}

/** B's camera now: the shown sim's pose tilted up by the camera uptilt (packages/render-pc renderer.ts setPose). */
export async function camera(b: Page): Promise<{ pos: V3; q: Q; fwd: V3; up: V3 }> {
    const c = await gs<{ s: number[]; tilt: number }>(b, 'const s = h.session.shownSim.s; return { s: [s[0], s[1], s[2], s[6], s[7], s[8], s[9]], tilt: h.session.cameraUptiltDeg };');
    const q: Q = [c.s[3], c.s[4], c.s[5], c.s[6]];
    const cq = qmul(q, axisQ([1, 0, 0], c.tilt));
    return { pos: [c.s[0], c.s[1], c.s[2]], q, fwd: qrot(cq, [0, 0, -1]), up: qrot(cq, [0, 1, 0]) };
}

/** Puts A's paused sim at `p` with the attitude `q` (w, x, y, z); A keeps sending that pose. */
export const placeA = (a: Page, p: V3, q: Q): Promise<unknown> =>
    gs(a, `const s = h.session.sim.s; s[0] = ${p[0]}; s[1] = ${p[1]}; s[2] = ${p[2]}; s[3] = 0; s[4] = 0; s[5] = 0; s[6] = ${q[0]}; s[7] = ${q[1]}; s[8] = ${q[2]}; s[9] = ${q[3]}; s[10] = 0; s[11] = 0; s[12] = 0; return 0;`);

/**
 * Turns B (paused) level, a few cm over where it is (RAISE_M), to the yaw whose ray through the walls (the session's voxel
 * collision) runs free longest; returns that yaw, the free length and B's height.
 */
export async function levelView(b: Page): Promise<{ yaw: number; freeM: number; y: number }> {
    const look = await gs<{ yaw: number; freeM: number; tilt: number; p: number[] }>(b, `const s = h.session.shownSim.s; const c = h.session.collision;
        let best = { yaw: 0, freeM: -1, p: [s[0], s[1], s[2]] };
        for (const up of ${JSON.stringify(RAISE_M)}) { const o = [s[0], s[1] + up, s[2]]; if (c && !c.isFreeAt(o[0], o[1], o[2])) continue;
        for (let yaw = 0; yaw < 360; yaw += 5) { const a = yaw * Math.PI / 180, d = [-Math.sin(a), 0, -Math.cos(a)];
            const hit = c ? c.queryRay(o[0], o[1], o[2], d[0], d[1], d[2], ${FREE_CAP_M}) : null;
            const free = hit ? Math.hypot(hit.x - o[0], hit.y - o[1], hit.z - o[2]) : ${FREE_CAP_M};
            if (free > best.freeM) best = { yaw, freeM: free, p: o }; } }
        return { ...best, tilt: h.session.cameraUptiltDeg };`);
    const qB = qmul(axisQ([0, 1, 0], look.yaw), axisQ([1, 0, 0], -look.tilt));
    await gs(b, `const s = h.session.sim.s; s[1] = ${look.p[1]}; s[6] = ${qB[0]}; s[7] = ${qB[1]}; s[8] = ${qB[2]}; s[9] = ${qB[3]}; return 0;`);
    await sleep(800);
    return { yaw: look.yaw, freeM: look.freeM, y: look.p[1] };
}

/** What B shows of the remotes now: the hook, the tags on the page. */
export const bState = (b: Page): Promise<Record<string, unknown>> =>
    gs(b, `const tags = [...document.querySelectorAll('.rooms-tag')].map((e) => { const x = e.getBoundingClientRect(); return { text: e.textContent, box: [x.left, x.top, x.right, x.bottom].map((v) => Math.round(v)), opacity: e.style.opacity }; });
        return { remotes: r.remotes.map((x) => ({ slot: x.slot, pos: x.pos.map((v) => +v.toFixed(3)), ageMs: x.ageMs })), tags, hookTags: r.tags || [], drawn: r.drawn ?? null, view: [innerWidth, innerHeight] };`);

async function look(): Promise<void> {
    const mode = LOOK === 'after' ? 'after' : 'before';
    mkdirSync(SHOTS, { recursive: true });
    const dist = join(REPO, 'dist');
    const out: Record<string, unknown> = { mode, scene: SCENE, diffLevel: DIFF_LEVEL, distancesM: DISTANCES_M };
    await lock();
    const rig = await startRoomsRig(dist);
    const browsers: Browser[] = [];
    try {
        const LA = await launch();
        const LB = await launch();
        browsers.push(LA.browser, LB.browser);
        const a = LA.page, b = LB.page;
        const A = await createRoom(a, `${rig.origin}/en/fly/?scene=${SCENE}&simradio=scenario&nowarn=1`);
        out.aNick = A.nick;
        await b.goto(`${A.link}&simradio=open&nowarn=1`);
        await waitReady(b, 240000);
        for (let i = 0; i < 120 && !(await rooms<boolean>(b, 'return r.remotes.length > 0;').catch(() => false)); i++) await sleep(250);
        // both back at the start, then both sims stop
        await gs(a, "h.session.respawnStart(); return 0;");
        await gs(b, "h.session.respawnStart(); return 0;");
        await sleep(1500);
        await gs(a, "h.session.pause(true, 'menu'); return 0;");
        await gs(b, "h.session.pause(true, 'menu'); return 0;");
        await sleep(1500);
        const start = await bState(b);
        const camStart = await camera(b);
        writeFileSync(join(SHOTS, `look-${mode}-start.png`), await b.screenshot());
        out.start = { ...start, bCamera: camStart.pos.map((v) => +v.toFixed(3)) };

        // the sweep needs 8 m of free air in front of B
        const lv = await levelView(b);
        out.lookDir = { yawDeg: lv.yaw, freeM: +lv.freeM.toFixed(2), raiseM: +(lv.y - camStart.pos[1]).toFixed(3) };
        // the sweep: A d metres along B's view, turned 135 degrees about B's up so its arms and nose show
        const cam = await camera(b);
        const qA = qmul(axisQ(cam.up, 135), cam.q);
        const at = (d: number): V3 => [cam.pos[0] + cam.fwd[0] * d, cam.pos[1] + cam.fwd[1] * d, cam.pos[2] + cam.fwd[2] * d];
        await placeA(a, at(-30), qA);
        await sleep(1500);
        const ref1 = await b.screenshot({ style: NO_TAGS });
        await sleep(700);
        const ref2 = await b.screenshot({ style: NO_TAGS });
        const blank = await (await LB.browser.newContext()).newPage();
        out.refNoise = await diffBox(blank, ref1, ref2);
        out.camera = { pos: cam.pos.map((v) => +v.toFixed(3)), fwd: cam.fwd.map((v) => +v.toFixed(3)) };
        const rows: Record<string, unknown>[] = [];
        for (const d of DISTANCES_M) {
            await placeA(a, at(d), qA);
            await sleep(1500);
            const bare = await b.screenshot({ style: NO_TAGS });
            const shot = await b.screenshot();
            writeFileSync(join(SHOTS, `look-${mode}-d${d}.png`), shot);
            const st = await bState(b);
            const diff = await diffBox(blank, ref1, bare);
            rows.push({ d, share: +diff.share.toFixed(4), box: diff.box, pixels: diff.pixels, ...st });
            console.log(JSON.stringify({ d, share: +diff.share.toFixed(4), pixels: diff.pixels, tags: (st.tags as unknown[]).length }));
            // the proof pictures for the lead: A as in forward flight, nose down PROOF_PITCH_DEG (its top shows), same place
            if (mode === 'after' && (d === 2 || d === 4 || d === 8)) {
                await placeA(a, at(d), qmul(qA, axisQ([1, 0, 0], -PROOF_PITCH_DEG)));
                await sleep(1500);
                writeFileSync(join(SHOTS, `look-remote-${d}m.png`), await b.screenshot());
                await placeA(a, at(d), qA);
            }
        }
        out.rows = rows;
        // back to the start for the last picture
        await placeA(a, cam.pos, cam.q);
        await sleep(1500);
        writeFileSync(join(SHOTS, `look-${mode}-start2.png`), await b.screenshot());
        out.start2 = await bState(b);
        out.console = { a: LA.console.filter((l) => /error/i.test(l)).slice(-6), b: LB.console.filter((l) => /error/i.test(l)).slice(-6) };
    } catch (e) {
        out.error = String((e as Error).stack ?? e).slice(0, 1500);
    } finally {
        for (const x of browsers) await x.close().catch(() => undefined);
        await rig.stop().catch(() => undefined);
        unlock();
    }
    const file = writeEvidence(`rooms-look-${mode}`, out, '2026-11-13/train1c');
    console.log(JSON.stringify({ error: out.error ?? null, refNoise: out.refNoise, evidence: file }));
}

async function live(): Promise<void> {
    mkdirSync(SHOTS, { recursive: true });
    await lock();
    const LA = await launch();
    const LB = await launch();
    try {
        const a = LA.page;
        await a.goto(`${SITE}/en/fly/?scene=${SCENE}&simradio=scenario&nowarn=1&rooms=1`);
        await waitReady(a, 240000);
        await sleep(1500);
        await a.keyboard.press('Shift+KeyL');
        await a.locator('[data-action=rooms-create]').click({ timeout: 15000 });
        for (let i = 0; i < 80 && !(await rooms<boolean>(a, "return r.state === 'joined' && !!r.link;").catch(() => false)); i++) await sleep(250);
        const link = await rooms<string>(a, 'return r.link;');
        writeFileSync(join(SHOTS, 'rooms-live-a-screen.png'), await a.screenshot());
        await a.keyboard.press('Escape').catch(() => undefined);
        const b = LB.page;
        await b.goto(`${link}&simradio=scenario&nowarn=1`);
        await waitReady(b, 240000);
        let kept = 0;
        const seen: unknown[] = [];
        for (let i = 0; i < 120 && kept < 3; i++) {
            const st = await rooms<{ tags: unknown[]; remotes: number; members: number }>(b, 'return { tags: r.tags || [], remotes: r.remotes.length, members: r.members.length };').catch(() => null);
            if (st && st.tags.length > 0) {
                writeFileSync(join(SHOTS, `rooms-live-b-tag-${++kept}.png`), await b.screenshot());
                seen.push(st);
                await sleep(1500);
            } else await sleep(250);
        }
        if (!kept) writeFileSync(join(SHOTS, 'rooms-live-b-no-tag.png'), await b.screenshot());
        console.log(JSON.stringify({ kept, seen: seen.slice(0, 3), shots: SHOTS }));
    } finally {
        await LA.browser.close().catch(() => undefined);
        await LB.browser.close().catch(() => undefined);
        unlock();
    }
}

if (process.argv[1] && /rooms-shot-live\.ts$/.test(process.argv[1].replace(/\\/g, '/'))) {
    if (SITE) await live();
    else await look();
}
