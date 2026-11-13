// Train 1, lane rooms (docs/wip/rooms.md, stage R3; docs/wip/train1-plan.md section 9, probe 1): flying together in
// two headless browsers against the local rig of rooms-serve.ts (the release build in dist/ + apps/rooms/rooms.py).
//   node scripts/build-release.mjs                      (once: dist/ of this tree)
//   cd tools/bench && npx tsx src/rooms-two-page.ts
// Page A opens 39e63ce9 with the bot pilot (?simradio=scenario), no ?rooms=1 (lane rooms-public: the menu is public), opens
// 'Fly with others' with key 9 and creates a room; page B opens A's link; both record for RECORD_S seconds. Pass: B's
// RoomsHook.remotes follows A's own positions (RMS after aligning the playout delay < RMS_BOUND_M), B's members hold A's
// nickname, A's said holds the join line (B joined), B's said holds the welcome line, key 0 on B appends the who-is-around
// line, and after A has gone B says the leave line and key 0 says nobody; then D opens /fly/?room=<id> with no ?scene= and
// flies the room's scan in the room (rooms-public point 3). Controls that must fire: C in another room sees no remote; the rig with
// the relay off (rooms.py --no-relay) never shows A to B; B's samples with x and z swapped give an RMS over the bound.
// A's trace hash equal to solo: tools/bench/test/rooms-a6.test.ts (a real-time page flight is not a fixed-step replay).
// The whole run holds the GPU lock once (gpu-lock.ts), released on an error too. Evidence: evidence/<date>/rooms-two-page.json.
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
/** seconds A flies while both pages record (plan section 9) */
const RECORD_S = Number(process.env.RECORD_S ?? 20);
/** the RMS bound: the interpolation's max error measured in R2 (tools/bench/test/rooms-interp.test.ts, 0.15 m) */
export const RMS_BOUND_M = 0.15;
/** A must move at least this far for the comparison to mean anything (an estimate: a few drone lengths) */
const MIN_PATH_M = 3;
const SCENE = '39e63ce9';

export type Sample = [number, number, number, number];

/** A's position at time t (linear between samples), or null outside the recording. */
function at(a: readonly Sample[], t: number): [number, number, number] | null {
    if (a.length < 2 || t < a[0][0] || t > a[a.length - 1][0]) return null;
    let lo = 0, hi = a.length - 1;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (a[mid][0] <= t) lo = mid;
        else hi = mid;
    }
    const p = a[lo], q = a[hi];
    const k = q[0] === p[0] ? 0 : (t - p[0]) / (q[0] - p[0]);
    return [p[1] + (q[1] - p[1]) * k, p[2] + (q[2] - p[2]) * k, p[3] + (q[3] - p[3]) * k];
}

/** The delay (0..1000 ms, 5 ms steps) that best aligns B's samples with A's, and the RMS distance there. */
/** A's teleports (a respawn or a reset): a step faster than this (m/s) is no flight. An estimate: well over any preset's top speed. */
const JUMP_MPS = 80;
/** around a teleport B's track is wrong by design for the playout plus the extrapolation (150 + 250 ms, interp.ts): skip this much each side */
const JUMP_SKIP_MS = 400;

/** The windows of A's time around its teleports. */
export function jumps(a: readonly Sample[]): [number, number][] {
    const w: [number, number][] = [];
    for (let i = 1; i < a.length; i++) {
        const dt = Math.max(1e-3, (a[i][0] - a[i - 1][0]) / 1000);
        if (Math.hypot(a[i][1] - a[i - 1][1], a[i][2] - a[i - 1][2], a[i][3] - a[i - 1][3]) / dt > JUMP_MPS) w.push([a[i - 1][0] - JUMP_SKIP_MS, a[i][0] + JUMP_SKIP_MS]);
    }
    return w;
}

export function align(a: readonly Sample[], b: readonly Sample[], skip: readonly [number, number][] = []): { delayMs: number; rmsM: number; n: number; p50M: number; p90M: number; maxM: number } {
    let best = { delayMs: -1, rmsM: Infinity, n: 0, p50M: NaN, p90M: NaN, maxM: NaN };
    for (let d = 0; d <= 1000; d += 5) {
        let sum = 0, n = 0;
        for (const s of b) {
            const ta = s[0] - d;
            if (skip.some(([x, y]) => ta >= x && ta <= y)) continue;
            const p = at(a, ta);
            if (!p) continue;
            sum += (s[1] - p[0]) ** 2 + (s[2] - p[1]) ** 2 + (s[3] - p[2]) ** 2;
            n++;
        }
        if (n >= 20 && Math.sqrt(sum / n) < best.rmsM) best = { ...best, delayMs: d, rmsM: Math.sqrt(sum / n), n };
    }
    const errs: number[] = [];
    for (const s of b) {
        const ta = s[0] - best.delayMs;
        if (skip.some(([x, y]) => ta >= x && ta <= y)) continue;
        const p = at(a, ta);
        if (p) errs.push(Math.hypot(s[1] - p[0], s[2] - p[1], s[3] - p[2]));
    }
    errs.sort((x, y) => x - y);
    const q = (k: number): number => +(errs[Math.min(errs.length - 1, Math.floor(k * errs.length))] ?? NaN).toFixed(4);
    return { ...best, p50M: q(0.5), p90M: q(0.9), maxM: q(1) };
}

const pathLen = (a: readonly Sample[]): number => a.reduce((L, s, i) => (i ? L + Math.hypot(s[1] - a[i - 1][1], s[2] - a[i - 1][2], s[3] - a[i - 1][3]) : 0), 0);

type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const hook = <T>(p: Page, js: string): Promise<T> => p.evaluate(`(() => { const h = window.__gsfpv; const r = h.rooms; ${js} })()`) as Promise<T>;

async function until(p: Page, js: string, ms: number): Promise<boolean> {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
        if (await hook<boolean>(p, js).catch(() => false)) return true;
        await p.waitForTimeout(200);
    }
    return false;
}

/** A recorder in the page: every frame, the epoch time with the own position ('own') or the first remote's ('remote'). */
const startRec = (p: Page, what: 'own' | 'remote'): Promise<unknown> => p.evaluate(`(() => {
    const h = window.__gsfpv; const out = []; window.__roomsRec = out;
    const step = (ts) => {
        // the frame's own time (the rAF timestamp, the 'now' the page's frame handlers use), not performance.now(): a
        // callback that runs after the frame's rendering work would otherwise stamp the pose late, by a different
        // amount every frame
        const t = performance.timeOrigin + ts;
        if (${JSON.stringify(what)} === 'own') { const sim = h.session.shownSim || h.session.sim; if (sim) out.push([t, sim.s[0], sim.s[1], sim.s[2]]); }
        else { const x = h.rooms.remotes[0]; const g = (h.rooms.tags || []).length; out.push(x ? [t, x.pos[0], x.pos[1], x.pos[2], g] : [t, NaN, NaN, NaN, g]); }
        if (!window.__roomsRecStop) requestAnimationFrame(step);
    };
    requestAnimationFrame(step); return 0; })()`);
const stopRec = (p: Page): Promise<Sample[]> => p.evaluate('(() => { window.__roomsRecStop = true; return window.__roomsRec; })()') as Promise<Sample[]>;

async function openA(page: Page, origin: string): Promise<{ page: Page; created: boolean; link: string | null; nick: string; slot: number | null }> {
    await page.goto(`${origin}/en/fly/?scene=${SCENE}&simradio=scenario&nowarn=1`);
    await waitReady(page, 180000);
    await page.waitForTimeout(1500);
    await page.keyboard.press('Digit9');
    const btn = page.locator('[data-action=rooms-create]');
    await btn.waitFor({ timeout: 10000 });
    await btn.click();
    const created = await until(page, "return r.state === 'joined' && !!r.link;", 15000);
    const st = await hook<Any>(page, 'return { link: r.link, nick: r.nick, slot: r.slot };');
    return { page, created, link: st.link, nick: st.nick, slot: st.slot };
}

async function openB(L: Launched, link: string): Promise<Page> {
    const page = L.page;
    // simradio=open: B flies by a simulated radio with no plan (no first-visit screen that blocks the keys, as on A)
    await page.goto(`${link}&simradio=open&nowarn=1`);
    await waitReady(page, 180000);
    return page;
}

async function main(): Promise<void> {
    if (!existsSync(join(DIST, 'release.json'))) throw new Error('dist/release.json is missing: run node scripts/build-release.mjs first');
    const out: Any = { scene: SCENE, recordS: RECORD_S, rmsBoundM: RMS_BOUND_M, gpuLock: LOCK };
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

        // ---- A creates, B joins by the link
        const A = await openA(LA.page, rig.origin);
        out.a = { created: A.created, link: A.link?.replace(rig.origin, '<origin>') ?? null, nick: A.nick, slot: A.slot };
        if (!A.created || !A.link) throw new Error('A did not create a room');
        const B = await openB(LB, A.link);
        const bJoined = await until(B, "return r.state === 'joined' && r.remotes.length > 0;", 30000);
        out.b = { joined: bJoined, url: B.url().replace(rig.origin, '<origin>') };

        // ---- control 1: C in another room (a second context of B's browser) sees no remote
        const C = await openA(await (await LB.browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage(), rig.origin);

        // ---- record
        await Promise.all([startRec(A.page, 'own'), startRec(B, 'remote'), startRec(C.page, 'remote')]);
        await B.waitForTimeout(RECORD_S * 1000);
        const [a, bRaw, cRaw] = await Promise.all([stopRec(A.page), stopRec(B), stopRec(C.page)]);
        const b = bRaw.filter((s) => Number.isFinite(s[1]));
        const skip = jumps(a);
        const raw = align(a, b);
        const fit = align(a, b, skip);
        const swapped = align(a, b.map((s): Sample => [s[0], s[3], s[2], s[1]]), skip);
        const aState = await hook<Any>(A.page, 'return { said: [...r.said], members: r.members };');
        const bState = await hook<Any>(B, 'return { said: [...r.said], members: r.members, room: r.room, tags: r.tags };');
        const cState = await hook<Any>(C.page, 'return { room: r.room, remotes: r.remotes.length, state: r.state };');
        const steps = a.slice(1).map((s, i) => Math.hypot(s[1] - a[i][1], s[2] - a[i][2], s[3] - a[i][3]) / Math.max(1e-3, (s[0] - a[i][0]) / 1000)).sort((x, y) => x - y);
        out.follow = { aSamples: a.length, aPathM: +pathLen(a).toFixed(2), aSpeedP50: +(steps[Math.floor(steps.length / 2)] ?? 0).toFixed(2), aSpeedMax: +(steps[steps.length - 1] ?? 0).toFixed(2), bFrames: bRaw.length, bWithRemote: b.length, bestDelayMs: fit.delayMs, rmsM: +fit.rmsM.toFixed(4), p50M: fit.p50M, p90M: fit.p90M, maxM: fit.maxM, compared: fit.n, aTeleports: skip.length, skipMsEachSide: JUMP_SKIP_MS, withTeleports: raw };
        out.bTagFrames = bRaw.filter((s) => (s as unknown as number[])[4] > 0).length;
        out.bScreens = await B.evaluate(() => [...document.querySelectorAll('#ui .screen, #ui .panel')].map((e) => e.className).slice(0, 5));
        out.names = { aNick: A.nick, bMembers: bState.members, bTags: bState.tags, aMembers: aState.members };
        out.said = { a: aState.said, b: bState.said };
        out.control1OtherRoom = { cRoom: cState.room, sameRoom: cState.room === bState.room, cFramesWithRemote: cRaw.filter((s) => Number.isFinite(s[1])).length, cFrames: cRaw.length };
        out.control1OtherRoom.fired = !out.control1OtherRoom.sameRoom && out.control1OtherRoom.cFramesWithRemote === 0 && cRaw.length > 100;
        out.control3SwappedAxes = { rmsM: +swapped.rmsM.toFixed(4), fired: swapped.rmsM > RMS_BOUND_M };
        await C.page.context().close();

        // ---- key 0 on B with A there, then A leaves, then key 0 again
        const n0 = bState.said.length;
        await B.keyboard.press('Digit0');
        await B.waitForTimeout(500);
        const whoSaid = await hook<string[]>(B, 'return [...r.said];');
        await A.page.close();
        const leftHeard = await until(B, "return r.said.includes('rooms.say.left') && r.remotes.length === 0;", 15000);
        await B.keyboard.press('Digit0');
        await B.waitForTimeout(500);
        const afterSaid = await hook<string[]>(B, 'return [...r.said];');
        const region = await B.evaluate(() => { const e = document.querySelector('[data-testid=rooms-live]'); return e ? (e.textContent ?? '').length : -1; });
        out.speech = { who: whoSaid.slice(n0), whoLast: whoSaid[whoSaid.length - 1], leftHeard, nobodyLast: afterSaid[afterSaid.length - 1], liveRegionChars: region };

        // ---- lane rooms-public point 3: D opens the room by /fly/?room=<id> alone (no ?scene=) and lands in the room's scan
        const roomId = new URL(A.link).searchParams.get('room') ?? '';
        const D = await (await LA.browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
        await D.goto(`${rig.origin}/en/fly/?room=${roomId}&simradio=open&nowarn=1`);
        await waitReady(D, 180000);
        const dJoined = await until(D, "return r.state === 'joined';", 20000);
        const dUrl = new URL(D.url());
        out.roomOnlyLink = { asked: `/en/fly/?room=${roomId}`, joined: dJoined, scene: dUrl.searchParams.get('scene'), room: dUrl.searchParams.get('room'), picker: await D.evaluate(() => (window as unknown as { __gsfpv?: { status?: string } }).__gsfpv?.status ?? null) };
        await D.context().close();

        // ---- control 2: the rig with the relay off
        const rig2 = await startRoomsRig(DIST, { relay: false });
        rigs.push(rig2);
        const A2 = await openA(await (await LA.browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage(), rig2.origin);
        const B2 = await (await LB.browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
        let fired2 = false;
        const c2: Any = { created: A2.created };
        if (A2.created && A2.link) {
            await B2.goto(`${A2.link}&nowarn=1`);
            await waitReady(B2, 180000);
            const joined2 = await until(B2, "return r.state === 'joined' && r.members.length === 2;", 20000);
            await Promise.all([startRec(A2.page, 'own'), startRec(B2, 'remote')]);
            await B2.waitForTimeout(8000);
            const [a2, b2] = await Promise.all([stopRec(A2.page), stopRec(B2)]);
            const seen2 = b2.filter((s) => Number.isFinite(s[1]));
            c2.joined = joined2;
            c2.aPathM = +pathLen(a2).toFixed(2);
            c2.bFrames = b2.length;
            c2.bFramesWithRemote = seen2.length;
            c2.bRemoteMovedM = +pathLen(seen2).toFixed(3);
            fired2 = joined2 && c2.aPathM > 1 && c2.bRemoteMovedM < 0.01;
        }
        out.control2RelayOff = { ...c2, fired: fired2 };

        const f = out.follow;
        const checks = {
            bJoined,
            aMoved: f.aPathM >= MIN_PATH_M,
            rmsUnderBound: f.rmsM < RMS_BOUND_M && f.compared >= 100,
            bMembersHaveA: (bState.members as Any[]).some((m) => m.nick === A.nick),
            bTagShown: out.bTagFrames > 0,
            aSaidJoined: (aState.said as string[]).includes('rooms.say.joined'),
            bSaidWelcome: (bState.said as string[]).includes('rooms.say.welcome'),
            whoOnB: out.speech.whoLast === 'rooms.say.who',
            leftOnB: leftHeard,
            nobodyOnB: out.speech.nobodyLast === 'rooms.say.nobody',
            roomOnlyLinkFliesTheRoomScan: out.roomOnlyLink.joined && out.roomOnlyLink.scene === SCENE && out.roomOnlyLink.room === roomId,
            control1: out.control1OtherRoom.fired,
            control2: fired2,
            control3: out.control3SwappedAxes.fired
        };
        out.checks = checks;
        pass = Object.values(checks).every(Boolean);
        out.pass = pass;
        out.rigLogTail = rig.log.filter((l) => !/ping|pong/.test(l)).slice(-12);
        out.console = { a: LA.console.filter((l) => /error/i.test(l)).slice(-8), b: LB.console.filter((l) => /error/i.test(l)).slice(-8) };
    } catch (e) {
        out.error = String((e as Error).stack ?? e).slice(0, 1500);
    } finally {
        for (const L of browsers) await L.browser.close().catch(() => undefined);
        for (const r of rigs) await r.stop().catch(() => undefined);
        unlock();
    }
    const file = writeEvidence('rooms-two-page', out);
    console.log(JSON.stringify({ pass, checks: out.checks, follow: out.follow, c1: out.control1OtherRoom, c2: out.control2RelayOff, c3: out.control3SwappedAxes, speech: out.speech, error: out.error }));
    console.log(`evidence ${file}`);
    process.exitCode = pass ? 0 : 1;
}

if (process.argv[1] && /rooms-two-page\.ts$/.test(process.argv[1].replace(/\\/g, '/'))) await main();
