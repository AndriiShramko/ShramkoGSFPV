// Lane rooms2, stage Q1-open-room (docs/wip/rooms2.md; docs/wip/rooms-plan.md R27): the open room and the vote for the
// next scan in two headless browsers against the local rig of rooms-serve.ts (the release build in dist/ + rooms.py).
//   node scripts/build-release.mjs                      (once: dist/ of this tree)
//   cd tools/bench && npx tsx src/rooms-open-vote.ts
// Page A flies scan SCENE_A with the bot pilot, page B flies SCENE_B. Each presses 9 once: A lands in the open room of its
// scan, B (nobody on its scan) lands in the room with pilots, its page loads SCENE_A. Pass: both joined, the same room,
// kind persistent, roomScene SCENE_A, each sees the other's drone. Then A presses 9 (the panel opens with Race focused),
// Tab (Propose) and Enter; B's hook shows the vote as not its own; for VOTE_HOLD_MS one yes of two moves nobody; B presses 9
// once; pass: both roomScene = the proposed scan, both said rooms.vote.passed, each sees the other's drone again.
// Control: the rig with the relay off (rooms.py --no-relay): A2 and B2 meet by 9 in one room and B2 never sees A2 move.
// The whole run holds the GPU lock once (gpu-lock.ts), released on an error too. Evidence: evidence/<date>/rooms-open-vote.json.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Browser, Page } from 'playwright';
import { launch, waitReady } from './browser';
import type { Launched } from './browser';
import { writeEvidence } from './evidence';
import { LOCK, lock, unlock } from './gpu-lock';
import { REPO } from './sonicrec-serve';
import { startRoomsRig } from './rooms-serve';
import type { RoomsRig } from './rooms-serve';

const DIST = join(REPO, 'dist');
/** two scans of the release's showcase.json (dist/fly/showcase.json): A's first, B's the one after it */
const SCENE_A = '39e63ce9';
const SCENE_B = '7a475d38';
/** how long one yes of two must leave the room where it is (the vote needs more than half of the present) */
const VOTE_HOLD_MS = 3000;
/** a scan load in a headless page on this PC (an estimate with margin: the first loads of rooms-two-page took under 60 s) */
const LOAD_MS = 120000;

type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const hook = <T>(p: Page, js: string): Promise<T> => p.evaluate(`(() => { const h = window.__gsfpv; const r = h.rooms; ${js} })()`) as Promise<T>;

async function until(p: Page, js: string, ms: number): Promise<boolean> {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
        if (await hook<boolean>(p, js).catch(() => false)) return true;
        await p.waitForTimeout(250);
    }
    return false;
}

const state = (p: Page): Promise<Any> => hook<Any>(p, 'return { state: r.state, room: r.room, kind: r.kind ?? null, roomScene: r.roomScene ?? null, vote: r.vote ?? null, remotes: r.remotes.length, members: r.members.length, problem: r.problem, said: [...r.said], url: location.pathname + location.search };');

async function open(b: Browser | null, L: Launched | null, url: string): Promise<Page> {
    const page = L ? L.page : await (await b!.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
    await page.goto(url);
    await waitReady(page, 180000);
    await page.waitForTimeout(1500);
    return page;
}

/** A pilot's own positions for ms, read on page `own`, and the first remote's on page `seen`: the remote's path length. */
async function remotePath(own: Page, seen: Page, ms: number): Promise<{ ownM: number; remoteM: number; frames: number }> {
    const rec = (p: Page, js: string): Promise<unknown> => p.evaluate(`(() => { const h = window.__gsfpv; const out = []; window.__ovRec = out; window.__ovStop = false;
        const step = () => { ${js} if (!window.__ovStop) requestAnimationFrame(step); }; requestAnimationFrame(step); return 0; })()`);
    const stop = (p: Page): Promise<number[][]> => p.evaluate('(() => { window.__ovStop = true; return window.__ovRec; })()') as Promise<number[][]>;
    await Promise.all([
        rec(own, 'const s = h.session.shownSim || h.session.sim; if (s) out.push([s.s[0], s.s[1], s.s[2]]);'),
        rec(seen, 'const x = h.rooms.remotes[0]; if (x) out.push([x.pos[0], x.pos[1], x.pos[2]]);')
    ]);
    await seen.waitForTimeout(ms);
    const [a, b] = await Promise.all([stop(own), stop(seen)]);
    const len = (v: number[][]): number => v.reduce((s, x, i) => (i ? s + Math.hypot(x[0] - v[i - 1][0], x[1] - v[i - 1][1], x[2] - v[i - 1][2]) : 0), 0);
    return { ownM: +len(a).toFixed(3), remoteM: +len(b).toFixed(3), frames: b.length };
}

async function main(): Promise<void> {
    if (!existsSync(join(DIST, 'release.json'))) throw new Error('dist/release.json is missing: run node scripts/build-release.mjs first');
    const out: Any = { sceneA: SCENE_A, sceneB: SCENE_B, voteHoldMs: VOTE_HOLD_MS, gpuLock: LOCK };
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
        const A = await open(null, LA, `${rig.origin}/en/fly/?scene=${SCENE_A}&simradio=scenario&nowarn=1`);
        const B = await open(null, LB, `${rig.origin}/en/fly/?scene=${SCENE_B}&simradio=open&nowarn=1`);

        // ---- one press each: A first (its scan's open room), then B (the room with pilots, on A's scan)
        await A.keyboard.press('Digit9');
        const aIn = await until(A, `return r.state === 'joined' && r.kind === 'persistent' && r.roomScene === '${SCENE_A}';`, 30000);
        await B.keyboard.press('Digit9');
        const bIn = await until(B, `return r.state === 'joined' && r.kind === 'persistent' && r.roomScene === '${SCENE_A}' && r.remotes.length > 0;`, LOAD_MS);
        const aSeesB = await until(A, 'return r.remotes.length > 0;', 20000);
        const [a1, b1] = await Promise.all([state(A), state(B)]);
        out.meet = { aIn, bIn, aSeesB, a: { ...a1, said: undefined }, b: { ...b1, said: undefined } };
        const met = aIn && bIn && aSeesB && a1.room !== null && a1.room === b1.room;

        // ---- A proposes with 9, Tab and Enter (stage Q2: "Race on a course" takes the panel's first focus)
        await A.keyboard.press('Digit9');
        const propose = A.locator('[data-action=rooms-propose]');
        const panelUp = await propose.waitFor({ timeout: 10000 }).then(() => true, () => false);
        // with the race's entry off (rooms/race-page.ts RACE_ON) Propose has the first focus: Tab only past the race button
        if (await A.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset?.action === 'rooms-race')) await A.keyboard.press('Tab');
        const focused = await A.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset?.action ?? null);
        await A.keyboard.press('Enter');
        const bSeesVote = await until(B, 'return !!r.vote && r.vote.mine === false;', 15000);
        const vote = (await state(B)).vote as Any | null;
        const proposed = (vote?.scene as string | undefined) ?? null;
        await B.waitForTimeout(VOTE_HOLD_MS);
        const [a2, b2] = await Promise.all([state(A), state(B)]);
        const oneYesHolds = a2.roomScene === SCENE_A && b2.roomScene === SCENE_A;
        out.vote = { panelUp, focused, bSeesVote, vote, proposed, oneYesHolds, aVote: a2.vote };

        // ---- B agrees with one press; both pages load the proposed scan and meet there
        await B.keyboard.press('Digit9');
        const want = JSON.stringify(proposed);
        const [aMoved, bMoved] = await Promise.all([
            until(A, `return r.roomScene === ${want} && r.remotes.length > 0;`, LOAD_MS),
            until(B, `return r.roomScene === ${want} && r.remotes.length > 0;`, LOAD_MS)
        ]);
        const [a3, b3] = await Promise.all([state(A), state(B)]);
        out.moved = { aMoved, bMoved, a: { ...a3, said: (a3.said as string[]).slice(-8) }, b: { ...b3, said: (b3.said as string[]).slice(-8) } };

        // ---- control: the relay off, the same two presses
        const rig2 = await startRoomsRig(DIST, { relay: false });
        rigs.push(rig2);
        const A2 = await open(LA.browser, null, `${rig2.origin}/en/fly/?scene=${SCENE_A}&simradio=scenario&nowarn=1`);
        const B2 = await open(LB.browser, null, `${rig2.origin}/en/fly/?scene=${SCENE_B}&simradio=open&nowarn=1`);
        await A2.keyboard.press('Digit9');
        const a2In = await until(A2, `return r.state === 'joined' && r.roomScene === '${SCENE_A}';`, 30000);
        await B2.keyboard.press('Digit9');
        const b2In = await until(B2, `return r.state === 'joined' && r.roomScene === '${SCENE_A}' && r.members.length === 2;`, LOAD_MS);
        const [s2a, s2b] = await Promise.all([state(A2), state(B2)]);
        const path = await remotePath(A2, B2, 8000);
        const fired = a2In && b2In && s2a.room === s2b.room && path.ownM > 1 && path.remoteM < 0.01;
        out.controlRelayOff = { a2In, b2In, sameRoom: s2a.room === s2b.room, ...path, fired };

        const checks = {
            oneKeyEachMeet: met,
            bothPersistent: a1.kind === 'persistent' && b1.kind === 'persistent',
            proposePanelFocused: panelUp && focused === 'rooms-propose',
            bSeesTheVote: bSeesVote && proposed !== null && proposed !== SCENE_A,
            oneYesOfTwoHolds: oneYesHolds,
            bothInProposedScan: aMoved && bMoved && a3.room === b3.room,
            passedSaidOnBoth: (a3.said as string[]).includes('rooms.vote.passed') && (b3.said as string[]).includes('rooms.vote.passed'),
            controlRelayOff: fired
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
    const file = writeEvidence('rooms-open-vote', out);
    console.log(JSON.stringify({ pass, checks: out.checks, meet: out.meet, vote: out.vote, control: out.controlRelayOff, error: out.error }));
    console.log(`evidence ${file}`);
    process.exitCode = pass ? 0 : 1;
}

if (process.argv[1] && /rooms-open-vote\.ts$/.test(process.argv[1].replace(/\\/g, '/'))) await main();
