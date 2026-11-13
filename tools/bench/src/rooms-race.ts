// Lane rooms2, stage Q2-race (docs/wip/rooms2.md; docs/wip/rooms-plan.md 2.4 and 4D): a race on time in a room, in two
// headless browsers against the local rig of rooms-serve.ts (the release build in dist/ + rooms.py).
//   node scripts/build-release.mjs                      (once: dist/ of this tree)
//   cd tools/bench && npx tsx src/rooms-race.ts
// Pages A and B fly SCENE (a scan whose walls give a generated course, tracks-page.ts). Each presses 9 once: both land in
// the scan's open room. A presses 9 (the panel opens with "Race on a course" focused) and Enter. Both pages must get the
// race's prep as racers, build the same course (the same gates count) and hear "Go". Then each page flies its course: the
// probe moves the craft along the race's path (hook race.path) in small steps, one per drawn frame, while the sim runs, so
// the page's own lap timer sees every gate. Pass: both pages sent their laps, the race ended with results, both tables have
// both pilots with times, in the same order with the same totals; B's panel (9) shows the table; A's key 0 says his place.
// Control that must fire: before anyone flies, a page reports no lap (sent 0 on both, the table's laps 0).
// The whole run holds the GPU lock once (gpu-lock.ts), released on an error too. Evidence: evidence/<date>/rooms-race.json.
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
/** a scan whose walls give a generated course at its own size (tracks-page.ts: 39e63ce9 gives 0 gates) */
const SCENE = '887f27aa';
/** a scan load in a headless page on this PC (an estimate with margin, as rooms-open-vote.ts) */
const LOAD_MS = 120000;
/** a course built in the page's worker, both pages at once (an estimate: course.ts says 15-31 s for one) */
const BUILD_MS = 180000;
/** the probe's flight speed along the path, metres per drawn frame (an estimate: small enough to cross each gate's plane inside it) */
const STEP_M = 0.3;

type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const hook = <T>(p: Page, js: string): Promise<T> => p.evaluate(`(() => { const h = window.__gsfpv; const r = h.rooms; const x = r.race; ${js} })()`) as Promise<T>;

async function until(p: Page, js: string, ms: number): Promise<boolean> {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
        if (await hook<boolean>(p, js).catch(() => false)) return true;
        await p.waitForTimeout(250);
    }
    return false;
}

const raceState = (p: Page): Promise<Any> => hook<Any>(p, 'return x ? { state: x.state, course: x.course, laps: x.laps, racer: x.racer, built: x.built, gates: x.gates, sent: x.sent, problem: x.problem, pathPoints: x.path.length, table: x.table.map((t) => ({ slot: t.slot, nick: t.nick, laps: t.laps, totalMs: t.totalMs, bestMs: t.bestMs, place: t.place })), slot: r.slot, said: r.said.filter((k) => k.startsWith(\'rooms.race.\')) } : null;');

/** The craft moved along the race's path `rounds` times (one step per drawn frame, the sim running); resolves when done. */
function fly(p: Page, rounds: number): Promise<number> {
    return p.evaluate(`new Promise((done) => {
        const h = window.__gsfpv; const P = h.rooms.race.path; const pts = [];
        for (let k = 0; k < ${rounds}; k++) for (let i = 0; i + 1 < P.length; i++) {
            const a = P[i], b = P[i + 1]; const d = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]); const n = Math.max(1, Math.ceil(d / ${STEP_M}));
            for (let j = 0; j < n; j++) pts.push([a[0] + (b[0] - a[0]) * j / n, a[1] + (b[1] - a[1]) * j / n, a[2] + (b[2] - a[2]) * j / n]);
        }
        let i = 0;
        const step = () => {
            const sim = (h.session.runner && h.session.runner.sim) || h.session.sim;
            const q = pts[i++];
            if (sim && q) { sim.s[0] = q[0]; sim.s[1] = q[1]; sim.s[2] = q[2]; sim.s[3] = 0; sim.s[4] = 0; sim.s[5] = 0; }
            if (i < pts.length) requestAnimationFrame(step); else done(pts.length);
        };
        requestAnimationFrame(step);
    })`) as Promise<number>;
}

async function open(L: Launched, url: string): Promise<Page> {
    const page = L.page;
    await page.goto(url);
    await waitReady(page, 180000);
    await page.waitForTimeout(1500);
    return page;
}

async function main(): Promise<void> {
    if (!existsSync(join(DIST, 'release.json'))) throw new Error('dist/release.json is missing: run node scripts/build-release.mjs first');
    const out: Any = { scene: SCENE, stepM: STEP_M, gpuLock: LOCK };
    const rigs: RoomsRig[] = [];
    const browsers: Launched[] = [];
    let pass = false;
    await lock();
    try {
        const rig = await startRoomsRig(DIST);
        rigs.push(rig);
        const LA = await launch();
        const LB = await launch();
        browsers.push(LA, LB);
        out.browser = LA.which;
        const A = await open(LA, `${rig.origin}/en/fly/?scene=${SCENE}&simradio=open&nowarn=1`);
        const B = await open(LB, `${rig.origin}/en/fly/?scene=${SCENE}&simradio=open&nowarn=1`);

        // ---- one 9 each: the scan's open room
        await A.keyboard.press('Digit9');
        const aIn = await until(A, `return r.state === 'joined' && r.roomScene === '${SCENE}';`, 30000);
        await B.keyboard.press('Digit9');
        const bIn = await until(B, `return r.state === 'joined' && r.roomScene === '${SCENE}' && r.members.length === 2;`, LOAD_MS);
        const sameRoom = await hook<string>(A, 'return r.room;') === await hook<string>(B, 'return r.room;');
        out.meet = { aIn, bIn, sameRoom };

        // ---- A: 9, Enter
        await A.keyboard.press('Digit9');
        const raceBtn = A.locator('[data-action=rooms-race]');
        const panelUp = await raceBtn.waitFor({ timeout: 10000 }).then(() => true, () => false);
        const focused = await A.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset?.action ?? null);
        await A.keyboard.press('Enter');
        const [aPrep, bPrep] = await Promise.all([A, B].map((p) => until(p, "return !!x && x.state !== 'off' && x.racer;", 15000)));
        const [aBuilt, bBuilt] = await Promise.all([A, B].map((p) => until(p, 'return !!x && x.built && x.path.length > 1;', BUILD_MS)));
        const [aGo, bGo] = await Promise.all([A, B].map((p) => until(p, "return !!x && (x.state === 'count' || x.state === 'run') && r.said.includes('rooms.race.go');", 90000)));
        const [a0, b0] = await Promise.all([raceState(A), raceState(B)]);
        out.start = { panelUp, focused, aPrep, bPrep, aBuilt, bBuilt, aGo, bGo, a: a0, b: b0 };
        const control = a0?.sent === 0 && b0?.sent === 0 && [...(a0?.table ?? []), ...(b0?.table ?? [])].every((t: Any) => t.laps === 0);

        // ---- both fly the course: the race's laps and one round more (the first round's start gate may be passed late)
        const rounds = (a0?.laps ?? 1) + 1;
        const t0 = Date.now();
        const [aPts, bPts] = await Promise.all([fly(A, rounds), fly(B, rounds)]);
        out.flight = { rounds, aPts, bPts, ms: Date.now() - t0 };
        const [aEnd, bEnd] = await Promise.all([A, B].map((p) => until(p, "return !!x && x.state === 'results';", 90000)));
        const [a1, b1] = await Promise.all([raceState(A), raceState(B)]);
        out.end = { aEnd, bEnd, a: a1, b: b1 };

        // ---- the table on demand: B's panel (9), A's key 0
        await B.keyboard.press('Digit9');
        const tbl = B.locator('[data-testid=rooms-race-table] tbody tr');
        const tableShown = await tbl.first().waitFor({ timeout: 10000 }).then(() => true, () => false);
        const panelRows = tableShown ? await tbl.evaluateAll((rows) => rows.map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent ?? ''))) : [];
        await B.keyboard.press('Escape');
        await A.keyboard.press('Digit0');
        const standingSaid = await until(A, "return r.said.includes('rooms.race.standing');", 5000);
        out.onDemand = { tableShown, panelRows, standingSaid };

        const order = (s: Any): string => JSON.stringify((s?.table ?? []).map((t: Any) => [t.slot, t.totalMs]));
        const timed = (s: Any): boolean => (s?.table ?? []).length === 2 && (s.table as Any[]).every((t) => t.laps > 0 && t.totalMs > 0);
        const checks = {
            oneKeyEachMeet: aIn && bIn && sameRoom,
            raceButtonFocused: panelUp && focused === 'rooms-race',
            bothRacers: aPrep && bPrep,
            sameCourseBuilt: aBuilt && bBuilt && a0?.course === b0?.course && a0?.gates === b0?.gates && (a0?.gates ?? 0) > 0,
            goOnBoth: aGo && bGo,
            controlNoLapBeforeFlight: control,
            bothSentLaps: (a1?.sent ?? 0) > 0 && (b1?.sent ?? 0) > 0,
            resultsOnBoth: aEnd && bEnd,
            bothTimesSameOrder: timed(a1) && timed(b1) && order(a1) === order(b1),
            panelTableBoth: panelRows.length === 2 && panelRows.map((r) => r[1]).join('|') === (b1?.table ?? []).map((t: Any) => t.nick).join('|'),
            keyZeroPlace: standingSaid
        };
        out.checks = checks;
        pass = Object.values(checks).every(Boolean);
        out.pass = pass;
        out.rigLogTail = rig.log.filter((l) => !/ping|pong|pose/.test(l)).slice(-16);
        out.console = { a: LA.console.filter((l) => /error/i.test(l)).slice(-8), b: LB.console.filter((l) => /error/i.test(l)).slice(-8) };
    } catch (e) {
        out.error = String((e as Error).stack ?? e).slice(0, 1500);
    } finally {
        for (const L of browsers) await L.browser.close().catch(() => undefined);
        for (const r of rigs) await r.stop().catch(() => undefined);
        unlock();
    }
    const file = writeEvidence('rooms-race', out);
    console.log(JSON.stringify({ pass, checks: out.checks, start: out.start && { ...out.start, a: undefined, b: undefined }, flight: out.flight, error: out.error }));
    console.log(`evidence ${file}`);
    process.exitCode = pass ? 0 : 1;
}

if (process.argv[1] && /rooms-race\.ts$/.test(process.argv[1].replace(/\\/g, '/'))) await main();
