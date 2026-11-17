// Lane race, stage R1-share (docs/wip/race.md R1.3 and R1.4): the room's course and the board of best laps, in three
// headless browsers against the local rig of rooms-serve.ts (the release build in dist/ + rooms.py).
//   node scripts/build-release.mjs                      (once: dist/ of this tree)
//   copy the walls stand-in of SCENE into dist/walls     (docs/wip/walls.md: the release dir with its manifest.json)
//   cd tools/bench && npx tsx src/rooms-board.ts
// A and B open SCENE and press 9 (the scan's open room). A presses Shift+G: the course becomes the room's; B must build
// the same gates (count and places). Each page's craft is put through its gates, +Z side to -Z side (packages/tracks
// laps.ts), one point per drawn frame, until the course feature counts laps; each page must then hold both pilots' rows.
// C opens late and must get the course and the rows. B presses Shift+G again: A and C must follow B's new course and the
// rows must be cleared. The socket's own frames of kinds course, blap and board are recorded with their sizes.
// Control that must fire: before anyone flies, the board has no row with a lap.
// The whole run holds the GPU lock once (gpu-lock.ts) and stops itself after RUN_MS.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { launch, waitReady } from './browser';
import type { Launched } from './browser';
import { writeEvidence } from './evidence';
import { LOCK, lock, unlock } from './gpu-lock';
import { REPO } from './sonicrec-serve';
import { startRoomsRig } from './rooms-serve';
import { panelByMenu } from './rooms-two-page';
import type { RoomsRig } from './rooms-serve';

const DIST = join(REPO, 'dist');
const SCENE = process.env.SCENE ?? '70b50d42';
/** the run's own cap under the lane's 10 minutes of GPU lock (a setting) */
const RUN_MS = 570000;
/** a scan load in a headless page on this PC (an estimate with margin) */
const LOAD_MS = 200000;
/** how long join9 presses 9 on one page (a setting; JOIN_MS overrides it) */
const JOIN_MS = Number(process.env.JOIN_MS ?? 200000);
/** a course built in the page's worker (an estimate: course.ts says 15-31 s for one) */
const BUILD_MS = 120000;

type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const ev = <T>(p: Page, js: string): Promise<T> => p.evaluate(`(() => { const h = window.__gsfpv; const r = h.rooms; const b = r && r.board; const c = h.course; ${js} })()`) as Promise<T>;

async function until(p: Page, js: string, ms: number): Promise<boolean> {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
        if (await ev<boolean>(p, js).catch(() => false)) return true;
        await p.waitForTimeout(200);
    }
    return false;
}

const look = (p: Page): Promise<Any> => ev<Any>(p, `return { slot: r.slot, room: r.room, members: r.members.length, board: b ? { course: b.course, rows: b.rows.map((x) => ({ ...x })), sent: b.sent, adopting: b.adopting } : null,
    course: c ? { on: c.on, source: c.source, seed: c.seed, gates: c.gates, next: c.next, laps: c.laps, lastLapMs: c.lastLapMs, problem: c.problem, poses: c.gatePoses ? c.gatePoses().map((g) => g.pos.map((v) => Math.round(v * 1000) / 1000)) : [] } : null };`);

/** The craft put through the course's gates `rounds` times, +Z side to -Z side, one point per drawn frame. */
function fly(p: Page, rounds: number, offs: number[] = [1.5, 1.5, 1.0, 0.5, 0, -0.5, -1.0, -1.5], hold = 1): Promise<Any> {
    return p.evaluate(`new Promise((done) => {
        const h = window.__gsfpv; const G = h.course.gatePoses(); const pts = [];
        const zOf = (q) => { const [w, x, y, z] = q; return [2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y)]; };
        for (let k = 0; k < rounds; k++) for (let i = 0; i <= G.length; i++) {
            const g = G[i % G.length]; const n = zOf(g.quat);
            for (const s of OFFS) for (let k2 = 0; k2 < HOLD; k2++) pts.push([g.pos[0] + n[0] * s, g.pos[1] + n[1] * s, g.pos[2] + n[2] * s]);
        }
        const d = { nexts: {}, crashes: 0 }; let i = 0;
        const step = () => {
            const sim = (h.session.runner && h.session.runner.sim) || h.session.sim;
            const nx = h.course.next; d.nexts[nx] = (d.nexts[nx] || 0) + 1;
            const q = pts[i++];
            if (sim && q) { sim.s[0] = q[0]; sim.s[1] = q[1]; sim.s[2] = q[2]; sim.s[3] = 0; sim.s[4] = 0; sim.s[5] = 0; }
            if (i < pts.length) requestAnimationFrame(step); else done({ pts: pts.length, laps: h.course.laps, ...d });
        };
        requestAnimationFrame(step);
    })`.replace('rounds', String(rounds)).replace('OFFS', JSON.stringify(offs)).replace('HOLD', String(hold))) as Promise<Any>;
}

interface Frame { type: string; bytes: number; t: number; slot?: number; n?: number }
interface Frames { sent: Frame[]; got: Frame[] }
function watchSocket(page: Page): Frames {
    const f: Frames = { sent: [], got: [] };
    const kind = (s: string): string => { try { return String(JSON.parse(s).type ?? '?'); } catch { return 'bin'; } };
    const who = (s: string): { slot?: number; n?: number } => { try { const m = JSON.parse(s); return { slot: m.slot, n: m.n }; } catch { return {}; } };
    const keep = (t: string): boolean => /^(course|blap|board|welcome)$/.test(t);
    page.on('websocket', (ws) => {
        ws.on('framesent', (x) => { const s = typeof x.payload === 'string' ? x.payload : ''; const t = kind(s); if (keep(t)) f.sent.push({ type: t, bytes: Buffer.byteLength(s), t: Date.now(), ...who(s) }); });
        ws.on('framereceived', (x) => { const s = typeof x.payload === 'string' ? x.payload : ''; const t = kind(s); if (keep(t)) f.got.push({ type: t, bytes: Buffer.byteLength(s), t: Date.now(), ...who(s) }); });
    });
    return f;
}

/** what join9 saw each 3 s on each page (R1.3 item 0: why 9 did not join on the big scan) */
const joinTrace: Any[] = [];
/** 9 pressed until the page is in the scan's room (a big scan answers keys only once it is in; 9 again while connecting
 *  would start a second join). The hook's states are off, connecting, joined, lost (apps/fly/src/rooms/hook.ts). */
async function join9(p: Page, members: number, name: string): Promise<boolean> {
    const t0 = Date.now();
    while (Date.now() - t0 < JOIN_MS) {
        const s = await ev<Any>(p, `return { st: r ? r.state : 'none', problem: r ? r.problem : null, said: r ? r.said.slice(-3) : [], members: r ? r.members.length : 0,
            status: h.status ?? null, dialog: !!document.querySelector('#ui .screen, #ui .panel, dialog[open]'), panel: (document.querySelector('#ui .panel') || {}).className || null };`).catch((e): Any => ({ st: 'none', err: String(e).slice(0, 120) }));
        let pressed = false;
        if (s.st === 'joined' && s.members >= members) { joinTrace.push({ name, t: Date.now() - t0, ...s }); return true; }
        if (s.st !== 'joined' && s.st !== 'connecting') { await p.keyboard.press('Digit9'); pressed = true; }
        joinTrace.push({ name, t: Date.now() - t0, pressed, ...s });
        await p.waitForTimeout(3000);
    }
    return false;
}

async function open(L: Launched, url: string): Promise<Page> {
    await L.page.goto(url);
    await waitReady(L.page, LOAD_MS);
    await L.page.waitForTimeout(1500);
    return L.page;
}

/** R1.3 item (1): on the rig 9 opens the rooms panel (joinOpen, builtin/rooms.ts) instead of joining, so A makes the room by
 *  the panel's create button (opened by 9, or by the pause menu as in rooms-two-page.ts) and B and C open A's link. */
async function createRoom(p: Page): Promise<{ created: boolean; link: string | null; how: string }> {
    const btn = p.locator('[data-action=rooms-create]');
    await p.keyboard.press('Digit9');
    let how = 'key9';
    if (!(await btn.waitFor({ timeout: 8000 }).then(() => true, () => false))) { how = 'menu'; await panelByMenu(p); await btn.waitFor({ timeout: 10000 }); }
    await btn.click();
    const created = await until(p, "return r.state === 'joined' && !!r.link;", 20000);
    const link = await ev<string | null>(p, 'return r.link ?? null;');
    await p.keyboard.press('Escape');
    return { created, link, how };
}

async function byLink(L: Launched, link: string, members: number): Promise<{ page: Page; joined: boolean }> {
    await L.page.goto(`${link}&simradio=open&nowarn=1`);
    await waitReady(L.page, LOAD_MS);
    const joined = await until(L.page, `return r.state === 'joined' && r.members.length >= ${members};`, 30000);
    await L.page.waitForTimeout(1000);
    return { page: L.page, joined };
}

// ---- Stage R2-board (docs/wip/race.md R2.4, R2.5): the board and the lead banner on the screen, rendering on.
const SHOTS = 'U:/Temp/gsfpv-train3/shots';
/** In-page watcher: every drawn frame it logs when the banner's text or the board's row order changes (page clock = this
 *  PC's clock, as Date.now() in Node) and, while the board or the banner shows, every overlap of their rectangles with the
 *  middle third, the clock block, the lap's time, the mode chip and the page's buttons. */
const WATCH = `(() => { if (window.__r2) return; const w = window.__r2 = { log: [], over: {}, snaps: {} };
    const R = (el) => { if (!el || el.hidden) return null; const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return null;
        const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 ? [r.left, r.top, r.right, r.bottom].map(Math.round) : null; };
    const hit = (a, b) => !!a && !!b && a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
    let lb = null, lo = '';
    const tick = () => { try {
        const bn = document.querySelector('[data-testid=rooms-lead]'); const bd = document.querySelector('[data-testid=rooms-board]');
        const rb = R(bn), rd = R(bd); const now = Date.now(); const W = innerWidth, H = innerHeight;
        const bt = rb ? bn.textContent : null;
        const rows = rd ? [...bd.querySelectorAll('[data-slot]')] : [];
        const order = rows.map((e) => e.dataset.slot).join(',');
        if (bt !== lb) { w.log.push({ t: now, kind: 'banner', text: bt, mine: bn ? bn.dataset.mine : null, W, H }); lb = bt; }
        if (order !== lo) { w.log.push({ t: now, kind: 'order', order, moving: rows.some((e) => /transform/.test(e.style.transition)), W, H }); lo = order; }
        if (rb || rd) {
            const root = (bd || bn).parentElement;
            const o = { mid: [W / 3, H / 3, 2 * W / 3, 2 * H / 3].map(Math.round), clock: R(document.querySelector('[data-testid=course-hud]')), lapTime: R(document.querySelector('[data-testid=course-splash]')), mode: R(document.querySelector('[data-testid=mode-chip]')) };
            const btns = [...root.querySelectorAll('button, a[href], [role=button], [data-action]')].filter((e) => getComputedStyle(e).pointerEvents !== 'none').map((e) => [e.dataset.action || e.getAttribute('aria-label') || e.textContent.trim().slice(0, 24), R(e)]).filter((x) => x[1]);
            for (const [n, a] of [['board', rd], ['banner', rb]]) { if (!a) continue;
                for (const k in o) if (hit(a, o[k])) w.over[n + '~' + k + '@' + W] = { a, b: o[k], W, H };
                for (const [lab, b] of btns) if (hit(a, b)) w.over[n + '~btn:' + lab + '@' + W] = { a, b, W, H }; }
            const key = W + 'x' + H + (rb ? '+banner' : '') + (o.lapTime ? '+lap' : '');
            if (!w.snaps[key]) w.snaps[key] = { board: rd, banner: rb, ...o, btns: btns.length };
        }
    } catch (e) { w.err = String(e); } requestAnimationFrame(tick); };
    requestAnimationFrame(tick); })()`;

const r2log = (p: Page): Promise<Any> => p.evaluate('window.__r2 ? JSON.parse(JSON.stringify(window.__r2)) : null') as Promise<Any>;
const fmt = (ms: number): string => { const cs = Math.round(ms / 10); return `${Math.floor(cs / 6000)}:${String(Math.floor((cs % 6000) / 100)).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`; };
const shot = async (p: Page, name: string): Promise<string> => { const f = `${SHOTS}/${name}`; await p.screenshot({ path: f }).catch((e) => console.log('shot', name, String(e).slice(0, 120))); return f; };
const BANNER_ON = "const e = document.querySelector('[data-testid=rooms-lead]'); return !!e && e.style.display !== 'none' && e.textContent.includes(";

/** One takeover: `who` flies two quick rounds; both pages' logs say when who's banner showed and how the rows moved. */
async function takeover(who: Page, other: Page, fw: Frames, offs: number[], shotName: string | null): Promise<Any> {
    const t0 = Date.now();
    const fl = await fly(who, 3, offs, 1);
    const me = await ev<Any>(who, 'return { slot: r.slot, nick: (r.members.find((m) => m.slot === r.slot) || {}).nick, row: b.rows.find((x) => x.slot === r.slot) };');
    const seen = await until(other, `${BANNER_ON}${JSON.stringify(me.nick ?? '?')});`, 15000);
    const shotFile = shotName ? await shot(other, shotName) : null;
    await other.waitForTimeout(2600);
    const [lw, lo] = await Promise.all([r2log(who), r2log(other)]);
    const time = me.row ? fmt(me.row.best) : '?';
    const firstBanner = (l: Any): Any => (l?.log ?? []).find((x: Any) => x.t >= t0 && x.kind === 'banner' && x.text && String(x.text).includes(time));
    const bw = firstBanner(lw); const bo = firstBanner(lo);
    const sends = fw.sent.filter((x) => x.type === 'blap' && x.t >= t0);
    const sendT = (bt: number): number => Math.max(-Infinity, ...sends.filter((x) => x.t <= bt + 50).map((x) => x.t));
    const orderAfter = (l: Any): string => [...(l?.log ?? [])].reverse().find((x: Any) => x.kind === 'order' && x.order)?.order ?? '';
    const movedAt = (l: Any): Any => (l?.log ?? []).find((x: Any) => x.t >= t0 && x.kind === 'order' && String(x.order).startsWith(String(me.slot)));
    return { fly: { pts: fl.pts, laps: fl.laps }, me, time, seen, shotFile, sends: sends.length,
        bannerWho: bw ?? null, bannerOther: bo ?? null,
        lagWhoMs: bw ? bw.t - sendT(bw.t) : null, lagOtherMs: bo ? bo.t - sendT(bo.t) : null,
        whoMine: bw?.mine === '1', otherNamed: !!bo && bo.mine === '0' && String(bo.text).includes(me.nick ?? '?'),
        orderWho: orderAfter(lw), orderOther: orderAfter(lo), movedWho: movedAt(lw) ?? null, movedOther: movedAt(lo) ?? null };
}

async function r2(A: Page, B: Page, LB: Launched, fa: Frames, fb: Frames, out: Any): Promise<void> {
    await A.setViewportSize({ width: 1920, height: 1080 });
    await B.setViewportSize({ width: 1280, height: 720 });
    await Promise.all([A.evaluate(WATCH), B.evaluate(WATCH)]);
    await A.keyboard.press('Shift+KeyG');
    const aCourse = await until(A, 'return !!c && c.on && c.gates > 0 && !!b && !!b.course;', BUILD_MS);
    const course = (await look(A)).board?.course ?? null;
    const bCourse = await until(B, `return !!c && c.on && c.gates > 0 && !!b && b.course === ${JSON.stringify(course)} && b.adopting === null;`, BUILD_MS);
    const r: Any = { aCourse, bCourse, course };
    out.r2 = r;
    if (!aCourse || !bCourse) throw new Error('no shared course: ' + JSON.stringify(r));
    const noLap = await ev<Any>(A, "return { shown: b.shown, withLap: b.rows.filter((x) => x.laps > 0).length, shownDom: getComputedStyle(document.querySelector('[data-testid=rooms-board]')).display !== 'none' };");
    // phase 1: both fly slowly (each point held 2 frames on A, 3 on B), so A leads; a takeover flies 3 quick rounds (run 1: the
    // first round's lap holds the wait before it, so 2 rounds gave no clean quick lap)
    const [f1a, f1b] = await Promise.all([fly(A, 2, undefined, 2), fly(B, 2, undefined, 3)]);
    const both = 'return !!b && b.rows.length === 2 && b.rows.every((x) => x.laps > 0 && x.best > 0) && b.shown === true;';
    const [aBoth, bBoth] = await Promise.all([until(A, both, 15000), until(B, both, 15000)]);
    await A.waitForTimeout(2600);
    const [a1, b1] = await Promise.all([look(A), look(B)]);
    const domOrder = (p: Page): Promise<string> => p.evaluate("[...document.querySelectorAll('[data-testid=rooms-board] [data-slot]')].map((e) => e.dataset.slot).join(',')") as Promise<string>;
    const [oa1, ob1] = await Promise.all([domOrder(A), domOrder(B)]);
    const boardShot = await shot(A, 'race-board.png');
    r.phase1 = { f1a: { pts: f1a.pts, laps: f1a.laps }, f1b: { pts: f1b.pts, laps: f1b.laps }, aSlot: a1.slot, aRows: a1.board?.rows, bRows: b1.board?.rows, oa1, ob1, boardShot, noLap };
    // phase 2: B beats A (half the points per gate); the picture on A at 1920x1080 at the moment of the takeover
    const t2 = await takeover(B, A, fb, [1.5, 0.5, -0.5, -1.5], 'race-lead-change.png');
    // phase 3: A at 844x390 beats B again (three points per gate)
    await A.setViewportSize({ width: 844, height: 390 });
    await A.waitForTimeout(800);
    const t3 = await takeover(A, B, fa, [1.0, 0, -1.0], null);
    const smallShot = await shot(A, 'race-844.png');
    r.takeovers = { t2, t3, smallShot };
    const lbB = await r2log(B);
    // the pause menu: Escape on A hides the board and the banner
    const vis = "const v = (s) => { const e = document.querySelector(s); return !!e && getComputedStyle(e).display !== 'none'; };";
    await A.keyboard.press('Escape');
    await A.waitForTimeout(800);
    const paused = await ev<Any>(A, `${vis} return { menu: v('.pause-menu'), board: v('[data-testid=rooms-board]'), banner: v('[data-testid=rooms-lead]'), shown: b.shown };`);
    await A.keyboard.press('Escape');
    await A.waitForTimeout(800);
    const resumed = await ev<Any>(A, `${vis} return { menu: v('.pause-menu'), board: v('[data-testid=rooms-board]'), shown: b.shown };`);
    // one pilot alone: B leaves, A must see no board
    await LB.browser.close().catch(() => undefined);
    const alone = await until(A, "return r.members.length === 1 && b.shown === false && getComputedStyle(document.querySelector('[data-testid=rooms-board]')).display === 'none';", 30000);
    const la = await r2log(A);
    r.pause = { paused, resumed, alone };
    r.overA = la?.over; r.snapsA = la?.snaps; r.overB = lbB?.over; r.snapsB = lbB?.snaps; r.err = [la?.err ?? null, lbB?.err ?? null];
    const sameBoard1 = JSON.stringify(a1.board?.rows) === JSON.stringify(b1.board?.rows) && oa1 === ob1 && oa1.startsWith(String(a1.slot));
    const quick = (t: Any): boolean => t.lagWhoMs !== null && t.lagOtherMs !== null && t.lagWhoMs <= 1000 && t.lagOtherMs <= 1000;
    out.checks = {
        controlNoBoardBeforeLaps: noLap.withLap === 0,
        boardSameOrderBothPages: aBoth && bBoth && sameBoard1,
        bTakesLeadBannerBothWithin1s: quick(t2) && t2.whoMine && t2.otherNamed,
        rowsSwapWithMove: t2.orderWho.startsWith(String(t2.me.slot)) && t2.orderOther.startsWith(String(t2.me.slot)) && !!t2.movedOther?.moving,
        aTakesLeadBackAt844: quick(t3) && t3.whoMine && t3.otherNamed && t3.orderOther.startsWith(String(t3.me.slot)),
        noOverlap: Object.keys(la?.over ?? {}).length === 0 && Object.keys(lbB?.over ?? {}).length === 0,
        pauseHidesBoth: paused.menu && !paused.board && !paused.banner && resumed.board,
        aloneNoBoard: alone
    };
    out.pass = Object.values(out.checks as Any).every(Boolean);
}

async function main(): Promise<void> {
    // R1.3: two runs ended with exit 0 and no line after the lock was taken: say where the process left
    process.on('beforeExit', () => console.log('beforeExit: the event loop emptied', Date.now()));
    process.on('exit', (c) => console.log('exit', c, Date.now()));
    const step = (s: string): void => console.log('step', s, Date.now());
    if (!existsSync(join(DIST, 'release.json'))) throw new Error('dist/release.json is missing: run node scripts/build-release.mjs first');
    if (!existsSync(join(DIST, 'walls', SCENE))) throw new Error(`dist/walls/${SCENE} is missing: copy the walls stand-in first`);
    const out: Any = { scene: SCENE, gpuLock: LOCK };
    const rigs: RoomsRig[] = [];
    const browsers: Launched[] = [];
    let pass = false;
    await lock();
    step('locked');
    const t00 = Date.now();
    const cap = setTimeout(() => { out.error = `run cap ${RUN_MS} ms`; for (const L of browsers) void L.browser.close().catch(() => undefined); }, RUN_MS);
    try {
        const rig = await startRoomsRig(DIST);
        rigs.push(rig);
        step('rig ' + rig.origin);
        const url = `${rig.origin}/en/fly/?scene=${SCENE}&simradio=open&nowarn=1`;
        const LA = await launch();
        const LB = await launch();
        browsers.push(LA, LB);
        out.browser = LA.which;
        const fa = watchSocket(LA.page); const fb = watchSocket(LB.page);
        const A = await open(LA, url);
        out.loadMs = Date.now() - t00;
        step('loaded');
        const made = await createRoom(A);
        if (!made.created || !made.link) throw new Error('A did not create a room: ' + JSON.stringify(made));
        const link = made.link;
        const { page: B, joined: bJoined } = await byLink(LB, link, 2);
        const aIn = made.created; const bIn = bJoined;
        out.joinMs = Date.now() - t00;
        out.meet = { aIn, bIn, how: made.how, sameRoom: (await look(A)).room === (await look(B)).room, aMembers: (await look(A)).members, bMembers: (await look(B)).members };
        step('met ' + JSON.stringify(out.meet));
        if (process.env.JOIN_ONLY) { pass = aIn && bIn && out.meet.sameRoom; out.pass = pass; return; }
        if (process.env.MODE === 'r2') { await r2(A, B, LB, fa, fb, out); pass = out.pass; return; }

        // ---- R1.3 / R1.4: A makes a course, B follows
        await A.keyboard.press('Shift+KeyG');
        const aCourse = await until(A, 'return !!c && c.on && c.gates > 0 && !!b && !!b.course;', BUILD_MS);
        const roomCourse = (await look(A)).board?.course ?? null;
        const t1 = Date.now();
        const bCourse = await until(B, `return !!c && c.on && c.gates > 0 && !!b && b.course === ${JSON.stringify(roomCourse)} && b.adopting === null;`, BUILD_MS);
        out.follow = { aCourse, bCourse, roomCourse, bFollowMs: Date.now() - t1 };
        const [a0, b0] = await Promise.all([look(A), look(B)]);
        out.before = { a: a0, b: b0 };
        const sameGates = a0.course.gates === b0.course.gates && a0.course.gates > 0 && JSON.stringify(a0.course.poses) === JSON.stringify(b0.course.poses);
        const control = [...(a0.board?.rows ?? []), ...(b0.board?.rows ?? [])].every((x: Any) => !(x.laps > 0));

        // ---- each page flies two rounds through its gates
        if (!sameGates) throw new Error('no shared course: ' + JSON.stringify(out.follow));
        const sentBefore = fa.sent.length + fb.sent.length;
        const [aFly, bFly] = await Promise.all([fly(A, 2), fly(B, 2)]);
        const tFlown = Date.now();
        out.flight = { a: aFly, b: bFly };
        const both = 'return !!b && b.rows.length === 2 && b.rows.every((x) => x.laps > 0 && x.best > 0);';
        const [aBoth, bBoth] = await Promise.all([until(A, both, 15000), until(B, both, 15000)]);
        out.lapsHeldMs = Date.now() - tFlown;
        const [a1, b1] = await Promise.all([look(A), look(B)]);
        out.after = { a: a1.board, b: b1.board, aLaps: a1.course.laps, bLaps: b1.course.laps };
        out.lapFrames = { aSent: fa.sent.slice(sentBefore ? 0 : 0).filter((x) => x.type === 'blap'), bGot: fb.got.filter((x) => x.type === 'blap') };
        // laps reach the other page within 1 s of being sent: matched by order
        // each lap sent by one page, matched on the other page by its slot and number (the service sends it to everyone)
        const lagOf = (from: Frames, slot: number, to: Frames): number[] => from.sent.filter((x) => x.type === 'blap').map((x) => (to.got.find((y) => y.type === 'blap' && y.slot === slot && y.n === x.n)?.t ?? Infinity) - x.t);
        const lag = [...lagOf(fa, a1.slot, fb), ...lagOf(fb, b1.slot, fa)];
        out.lapLagMs = lag;
        const sameBoard = JSON.stringify(a1.board?.rows) === JSON.stringify(b1.board?.rows);

        // ---- C joins late
        const LC = await launch();
        browsers.push(LC);
        const fc = watchSocket(LC.page);
        const { page: C, joined: cIn } = await byLink(LC, link, 3);
        const cCourse = await until(C, `return !!c && c.on && c.gates > 0 && !!b && b.course === ${JSON.stringify(roomCourse)} && b.adopting === null;`, BUILD_MS);
        const c1 = await look(C);
        const lateGotBoard = (c1.board?.rows ?? []).filter((x: Any) => x.laps > 0).length === 2;
        const lateSameGates = JSON.stringify(c1.course.poses) === JSON.stringify(a0.course.poses);
        out.late = { cIn, cCourse, board: c1.board, welcome: fc.got.filter((x) => x.type === 'welcome') };

        // ---- B makes a new course: A and C follow, the laps are cleared
        await B.keyboard.press('Shift+KeyG');
        const newCourse = await until(B, `return !!b && !!b.course && b.course !== ${JSON.stringify(roomCourse)} && c.on && c.gates > 0;`, BUILD_MS);
        const course2 = (await look(B)).board?.course ?? null;
        const follow2 = 'return !!b && b.course === ' + JSON.stringify(course2) + ' && b.adopting === null && c.on && c.gates > 0;';
        const [aNew, cNew] = await Promise.all([until(A, follow2, BUILD_MS), until(C, follow2, BUILD_MS)]);
        const [a2, b2, c2] = await Promise.all([look(A), look(B), look(C)]);
        const cleared = [a2, b2, c2].every((s) => (s.board?.rows ?? []).every((x: Any) => !(x.laps > 0)));
        const same2 = JSON.stringify(a2.course.poses) === JSON.stringify(b2.course.poses) && JSON.stringify(c2.course.poses) === JSON.stringify(b2.course.poses);
        out.replace = { course2, newCourse, aNew, cNew, a: a2.board, b: b2.board, c: c2.board, gates: b2.course.gates };

        const kinds = (f: Frames): Any => { const o: Any = {}; for (const x of [...f.sent.map((y) => ({ ...y, d: 'up' })), ...f.got.map((y) => ({ ...y, d: 'down' }))]) { const k = `${x.d}:${x.type}`; o[k] = Math.max(o[k] ?? 0, x.bytes); } return o; };
        out.frameMaxBytes = { a: kinds(fa), b: kinds(fb), c: kinds(fc) };
        const checks = {
            oneKeyEachMeet: aIn && bIn && out.meet.sameRoom,
            aCourseIsTheRooms: aCourse && !!roomCourse,
            bSameGates: bCourse && sameGates,
            controlNoLapBeforeFlight: control,
            bothFlewLaps: (a1.board?.sent ?? 0) > 0 && (b1.board?.sent ?? 0) > 0,
            eachPageHoldsBothLaps: aBoth && bBoth && sameBoard,
            lapsWithin1s: lag.length > 0 && lag.every((x) => x <= 1000),
            lateJoinerGetsCourse: cIn && cCourse && lateSameGates,
            lateJoinerGetsLaps: lateGotBoard,
            newCourseReplaces: newCourse && aNew && cNew && same2,
            newCourseClearsLaps: cleared
        };
        out.checks = checks;
        pass = Object.values(checks).every(Boolean);
        out.pass = pass;
        out.rigLogTail = rig.log.filter((l) => !/ping|pong|pose/.test(l)).slice(-20);
        out.console = browsers.map((L) => L.console.filter((l) => /error/i.test(l)).slice(-6));
    } catch (e) {
        out.error = (out.error ? out.error + ' / ' : '') + String((e as Error).stack ?? e).slice(0, 1500);
    } finally {
        clearTimeout(cap);
        // R1.3: the lock goes first and each close gets 10 s; the report is written here, so a JOIN_ONLY return writes it too
        unlock();
        const within = (x: Promise<unknown>): Promise<unknown> => Promise.race([x.catch(() => undefined), new Promise((r) => setTimeout(r, 10000))]);
        for (const L of browsers) await within(L.browser.close());
        for (const r of rigs) await within(r.stop());
        out.runMs = Date.now() - t00;
        const file = writeEvidence('rooms-board', out);
        console.log(JSON.stringify({ pass, checks: out.checks, follow: out.follow, lapLagMs: out.lapLagMs, flight: out.flight && { a: { ...out.flight.a, nexts: undefined }, b: { ...out.flight.b, nexts: undefined } }, runMs: out.runMs, error: out.error }));
        if (out.joinTrace) console.log(out.joinTrace.map((x: Any) => `${x.name} ${x.t} ${x.st} p=${x.pressed ? 1 : 0} m=${x.members} dlg=${x.dialog ? 1 : 0} ${x.panel ?? ''} prob=${x.problem ?? ''} said=${(x.said ?? []).join('|')} ${x.err ?? ''}`).join(String.fromCharCode(10)));
        console.log(`evidence ${file}`);
        process.exitCode = pass ? 0 : 1;
    }
}

if (process.argv[1] && /rooms-board\.ts$/.test(process.argv[1].replace(/\\/g, '/'))) await main();
