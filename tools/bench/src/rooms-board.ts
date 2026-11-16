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
import type { RoomsRig } from './rooms-serve';

const DIST = join(REPO, 'dist');
const SCENE = process.env.SCENE ?? '70b50d42';
/** the run's own cap under the lane's 10 minutes of GPU lock (a setting) */
const RUN_MS = 570000;
/** a scan load in a headless page on this PC (an estimate with margin) */
const LOAD_MS = 200000;
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
function fly(p: Page, rounds: number): Promise<Any> {
    return p.evaluate(`new Promise((done) => {
        const h = window.__gsfpv; const G = h.course.gatePoses(); const pts = [];
        const zOf = (q) => { const [w, x, y, z] = q; return [2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y)]; };
        for (let k = 0; k < rounds; k++) for (let i = 0; i <= G.length; i++) {
            const g = G[i % G.length]; const n = zOf(g.quat);
            for (const s of [1.5, 1.5, 1.0, 0.5, 0, -0.5, -1.0, -1.5]) pts.push([g.pos[0] + n[0] * s, g.pos[1] + n[1] * s, g.pos[2] + n[2] * s]);
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
    })`.replace('rounds', String(rounds))) as Promise<Any>;
}

interface Frames { sent: { type: string; bytes: number; t: number }[]; got: { type: string; bytes: number; t: number }[] }
function watchSocket(page: Page): Frames {
    const f: Frames = { sent: [], got: [] };
    const kind = (s: string): string => { try { return String(JSON.parse(s).type ?? '?'); } catch { return 'bin'; } };
    const keep = (t: string): boolean => /^(course|blap|board|welcome)$/.test(t);
    page.on('websocket', (ws) => {
        ws.on('framesent', (x) => { const s = typeof x.payload === 'string' ? x.payload : ''; const t = kind(s); if (keep(t)) f.sent.push({ type: t, bytes: Buffer.byteLength(s), t: Date.now() }); });
        ws.on('framereceived', (x) => { const s = typeof x.payload === 'string' ? x.payload : ''; const t = kind(s); if (keep(t)) f.got.push({ type: t, bytes: Buffer.byteLength(s), t: Date.now() }); });
    });
    return f;
}

/** 9 pressed until the page is in the scan's room (a big scan answers keys only once it is in; 9 again while joining would leave). */
async function join9(p: Page, members: number): Promise<boolean> {
    const t0 = Date.now();
    while (Date.now() - t0 < LOAD_MS) {
        const st = await ev<string>(p, 'return r ? r.state : "none";').catch(() => 'none');
        if (st === 'joined' && await ev<boolean>(p, `return r.members.length >= ${members};`)) return true;
        if (st !== 'joined' && st !== 'joining') await p.keyboard.press('Digit9');
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

async function main(): Promise<void> {
    if (!existsSync(join(DIST, 'release.json'))) throw new Error('dist/release.json is missing: run node scripts/build-release.mjs first');
    if (!existsSync(join(DIST, 'walls', SCENE))) throw new Error(`dist/walls/${SCENE} is missing: copy the walls stand-in first`);
    const out: Any = { scene: SCENE, gpuLock: LOCK };
    const rigs: RoomsRig[] = [];
    const browsers: Launched[] = [];
    let pass = false;
    await lock();
    const t00 = Date.now();
    const cap = setTimeout(() => { out.error = `run cap ${RUN_MS} ms`; for (const L of browsers) void L.browser.close().catch(() => undefined); }, RUN_MS);
    try {
        const rig = await startRoomsRig(DIST);
        rigs.push(rig);
        const url = `${rig.origin}/en/fly/?scene=${SCENE}&simradio=open&nowarn=1`;
        const LA = await launch();
        const LB = await launch();
        browsers.push(LA, LB);
        out.browser = LA.which;
        const fa = watchSocket(LA.page); const fb = watchSocket(LB.page);
        const [A, B] = await Promise.all([open(LA, url), open(LB, url)]);
        out.loadMs = Date.now() - t00;
        await A.keyboard.press('Digit9');
        const aIn = await until(A, `return r.state === 'joined' && r.roomScene === '${SCENE}';`, 30000);
        await B.keyboard.press('Digit9');
        const bIn = await until(B, 'return r.state === \'joined\' && r.members.length === 2;', 60000);
        out.meet = { aIn, bIn, sameRoom: (await look(A)).room === (await look(B)).room };

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
        const lag = fa.sent.filter((x) => x.type === 'blap').map((x, i) => (fb.got.filter((y) => y.type === 'blap')[i]?.t ?? Infinity) - x.t);
        out.lapLagMs = lag;
        const sameBoard = JSON.stringify(a1.board?.rows) === JSON.stringify(b1.board?.rows);

        // ---- C joins late
        const LC = await launch();
        browsers.push(LC);
        const fc = watchSocket(LC.page);
        const C = await open(LC, url);
        await C.keyboard.press('Digit9');
        const cIn = await until(C, 'return r.state === \'joined\' && r.members.length === 3;', 60000);
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
            bothFlewLaps: (a1.course.laps ?? 0) > 0 && (b1.course.laps ?? 0) > 0,
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
        for (const L of browsers) await L.browser.close().catch(() => undefined);
        for (const r of rigs) await r.stop().catch(() => undefined);
        unlock();
    }
    out.runMs = Date.now() - t00;
    const file = writeEvidence('rooms-board', out);
    console.log(JSON.stringify({ pass, checks: out.checks, follow: out.follow, lapLagMs: out.lapLagMs, flight: out.flight && { a: { ...out.flight.a, nexts: undefined }, b: { ...out.flight.b, nexts: undefined } }, runMs: out.runMs, error: out.error }));
    console.log(`evidence ${file}`);
    process.exitCode = pass ? 0 : 1;
}

if (process.argv[1] && /rooms-board\.ts$/.test(process.argv[1].replace(/\\/g, '/'))) await main();
