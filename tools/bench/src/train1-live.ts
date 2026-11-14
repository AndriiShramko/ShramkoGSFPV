// Train 1, the lead's checks on a DEPLOYED site (docs/wip/train1-lead.md "Live checks after the deploy"): the courses'
// round trip through the real nginx and API, and two browsers in one room through the real nginx-proxy and gsfpv-rooms.
//   cd tools/bench && SITE=https://gsfpv.flyreelstudio.eu npx tsx src/train1-live.ts [tracks] [rooms]
// tracks  A: Shift+G on TRACK_SCENE, the pause menu's "Save for everyone"; B (a fresh profile): the list has it, Shift+T
//         loads the same id. It STORES ONE COURSE on that server: its id is printed so the lead can remove the file.
// rooms   A creates a room on ROOM_SCENE (key 9, on a release before train 1b Shift+L; a room lives in the memory of
//         gsfpv-rooms only and goes when its pilots leave), B opens A's link, B's remote follows A (the two-page probe's
//         measure and bound), speech lines, A leaves. Controls: C in another room sees nobody; swapped axes break the fit.
//         The relay-off control needs the local rig (rooms-two-page.ts) and is not run here.
// The local probes with all their controls stay tracks-page.ts and rooms-two-page.ts. Holds the GPU lock for the run.
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Browser, Page } from 'playwright';
import { launch, waitReady } from './browser';
import type { Launched } from './browser';
import { today, writeEvidence } from './evidence';
import { lock, unlock } from './gpu-lock';
import { RMS_BOUND_M, align, jumps, panelByMenu } from './rooms-two-page';
import type { Sample } from './rooms-two-page';

const SITE = (process.env.SITE ?? '').replace(/\/+$/, '');
const TRACK_SCENE = process.env.TRACK_SCENE ?? '887f27aa';
const ROOM_SCENE = process.env.ROOM_SCENE ?? '39e63ce9';
const RECORD_S = Number(process.env.RECORD_S ?? 20);
const SHOTS = process.env.SHOTS ?? join(tmpdir(), 'gsfpv-train1-live', today());
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const checks: { name: string; pass: boolean; detail: unknown }[] = [];
const check = (name: string, pass: boolean, detail: unknown = null): void => {
    checks.push({ name, pass, detail });
};

async function poll<T>(get: () => Promise<T>, ok: (v: T) => boolean, ms: number): Promise<{ ok: boolean; v: T | null }> {
    const t0 = Date.now();
    let v: T | null = null;
    while (Date.now() - t0 < ms) {
        v = await get().catch(() => null);
        if (v !== null && ok(v)) return { ok: true, v };
        await sleep(250);
    }
    return { ok: false, v };
}

const course = (p: Page): Promise<Any | null> => p.evaluate(() => (window as unknown as { __gsfpv?: { course?: unknown } }).__gsfpv?.course ?? null) as Promise<Any | null>;
const rooms = <T>(p: Page, js: string): Promise<T> => p.evaluate(`(() => { const h = window.__gsfpv; const r = h.rooms; ${js} })()`) as Promise<T>;

/** A flight on `scene` in a new profile; the Controls screen of a first flight (if it comes) answered with the keyboard. */
async function openFlight(browser: Browser, query: string): Promise<Page> {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto(`${SITE}/en/fly/?${query}&nowarn=1`);
    await waitReady(page, 240000);
    const radio = '.screen.radio [data-action="radio-keyboard"]';
    try {
        await page.waitForSelector(radio, { timeout: 12000 });
        await page.focus(radio);
        await page.keyboard.press('Enter');
        await poll(() => page.evaluate(() => !document.querySelector('.screen.radio')), (v) => v, 10000);
    } catch {
        /* no Controls screen */
    }
    await sleep(1500);
    return page;
}

async function tracks(L: Launched, out: Any): Promise<void> {
    const a = await openFlight(L.browser, `scene=${TRACK_SCENE}`);
    await a.keyboard.press('Shift+KeyG');
    const gen = await poll(() => course(a), (h) => h?.source === 'generated' || !!h?.problem, 120000);
    check('tracks A Shift+G: a generated course with gates, drawn', gen.v?.source === 'generated' && gen.v.gates > 0 && gen.v.drawn > 0, { source: gen.v?.source, gates: gen.v?.gates, drawn: gen.v?.drawn, problem: gen.v?.problem });
    await sleep(1500);
    const shot = join(SHOTS, 'tracks-live-course.png');
    writeFileSync(shot, await a.screenshot());
    await a.keyboard.press('Escape');
    await a.waitForSelector('.pause-menu', { timeout: 10000 });
    const saveBtn = '[data-action="pause.course.save"]';
    const enabled = await a.isEnabled(saveBtn).catch(() => false);
    check('tracks A menu: Save for everyone enabled', enabled);
    if (enabled) await a.click(saveBtn);
    const sv = await poll(() => course(a), (h) => !!h?.saved || !!h?.problem, 30000);
    const saved: string | null = sv.v?.saved ?? null;
    check('tracks A saved on the live server', typeof saved === 'string' && saved.startsWith(`${TRACK_SCENE}-`), { saved, problem: sv.v?.problem });
    await a.context().close();

    const b = await openFlight(L.browser, `scene=${TRACK_SCENE}`);
    const lb = await poll(() => course(b), (h) => (h?.serverTracks ?? -1) >= 0, 30000);
    check('tracks B fresh profile: the list has a course', (lb.v?.serverTracks ?? 0) > 0, lb.v?.serverTracks);
    await b.keyboard.press('Shift+KeyT');
    const ld = await poll(() => course(b), (h) => h?.source === 'server' || !!h?.problem, 90000);
    check("tracks B Shift+T: A's course from the server, drawn", ld.v?.source === 'server' && !!saved && ld.v?.track?.id === saved && ld.v.drawn > 0, { source: ld.v?.source, id: ld.v?.track?.id, drawn: ld.v?.drawn, problem: ld.v?.problem });
    await b.context().close();
    out.tracks = { scene: TRACK_SCENE, generated: gen.v, saved, loaded: ld.v, shot };
}

const startRec = (p: Page, what: 'own' | 'remote'): Promise<unknown> => p.evaluate(`(() => {
    const h = window.__gsfpv; const out = []; window.__roomsRec = out;
    const step = (ts) => {
        const t = performance.timeOrigin + ts;
        if (${JSON.stringify(what)} === 'own') { const sim = h.session.shownSim || h.session.sim; if (sim) out.push([t, sim.s[0], sim.s[1], sim.s[2]]); }
        else { const x = h.rooms.remotes[0]; out.push(x ? [t, x.pos[0], x.pos[1], x.pos[2]] : [t, NaN, NaN, NaN]); }
        if (!window.__roomsRecStop) requestAnimationFrame(step);
    };
    requestAnimationFrame(step); return 0; })()`);
const stopRec = (p: Page): Promise<Sample[]> => p.evaluate('(() => { window.__roomsRecStop = true; return window.__roomsRec; })()') as Promise<Sample[]>;
const pathLen = (a: readonly Sample[]): number => a.reduce((s, x, i) => (i ? s + Math.hypot(x[1] - a[i - 1][1], x[2] - a[i - 1][2], x[3] - a[i - 1][3]) : 0), 0);

/** The keys of the release under test: 9 and 0 since the rooms went public (train 1b), Shift+L and Shift+O before. */
let roomKeys: { panel: string; who: string } = { panel: 'Digit9', who: 'Digit0' };

async function createRoom(page: Page): Promise<{ created: boolean; link: string | null; nick: string | null }> {
    const btn = page.locator('[data-action=rooms-create]');
    await page.keyboard.press('Digit9');
    const byNine = await btn.waitFor({ timeout: 8000 }).then(() => true, () => false);
    // lane rooms2 (R27): on a release with open rooms, 9 lands in the open room (kind persistent) and opens no panel; the
    // panel with create comes from the pause menu after leaving the open room (the panel in a room offers leave, not create)
    const openRoom = !byNine && (await poll(() => rooms<string | null>(page, 'return r.kind ?? null;'), (v) => v === 'persistent', 8000)).ok;
    if (byNine) roomKeys = { panel: 'Digit9', who: 'Digit0' };
    else if (openRoom) {
        roomKeys = { panel: 'Digit9', who: 'Digit0' };
        await panelByMenu(page);
        const leave = page.locator('[data-action=rooms-leave]');
        if (await leave.waitFor({ timeout: 10000 }).then(() => true, () => false)) await leave.click();
        await poll(() => rooms<string>(page, 'return r.state;'), (v) => v === 'off', 10000);
        await panelByMenu(page);
        await btn.waitFor({ timeout: 15000 });
    } else {
        roomKeys = { panel: 'Shift+KeyL', who: 'Shift+KeyO' };
        await page.keyboard.press('Shift+KeyL');
        await btn.waitFor({ timeout: 15000 });
    }
    await btn.click();
    const ok = await poll(() => rooms<boolean>(page, "return r.state === 'joined' && !!r.link;"), (v) => v, 20000);
    const st = await rooms<Any>(page, 'return { link: r.link, nick: r.nick, state: r.state, problem: r.problem || null };').catch(() => ({}) as Any);
    return { created: ok.ok, link: st.link ?? null, nick: st.nick ?? null };
}

async function roomsCheck(LA: Launched, LB: Launched, out: Any): Promise<void> {
    const a = await openFlight(LA.browser, `scene=${ROOM_SCENE}&simradio=scenario&rooms=1`);
    const A = await createRoom(a);
    check('rooms A: created a room and has a link', A.created && !!A.link, { link: A.link?.replace(SITE, '<site>'), nick: A.nick });
    if (!A.created || !A.link) {
        out.rooms = { a: A, console: LA.console.filter((l) => /error|websocket|rooms/i.test(l)).slice(-10) };
        return;
    }
    const b = await openFlight(LB.browser, `${A.link.split('?')[1]}&simradio=open`);
    const joined = await poll(() => rooms<boolean>(b, "return r.state === 'joined' && r.remotes.length > 0;"), (v) => v, 40000);
    check('rooms B: joined by the link and sees a remote drone', joined.ok);
    const c = await openFlight(LB.browser, `scene=${ROOM_SCENE}&simradio=scenario&rooms=1`);
    const C = await createRoom(c);

    await Promise.all([startRec(a, 'own'), startRec(b, 'remote'), startRec(c, 'remote')]);
    await sleep(RECORD_S * 1000);
    const [ra, rbRaw, rcRaw] = await Promise.all([stopRec(a), stopRec(b), stopRec(c)]);
    const rb = rbRaw.filter((s) => Number.isFinite(s[1]));
    const skip = jumps(ra);
    const fit = align(ra, rb, skip);
    const swapped = align(ra, rb.map((s): Sample => [s[0], s[3], s[2], s[1]]), skip);
    const aSt = await rooms<Any>(a, 'return { said: [...r.said], members: r.members };');
    const bSt = await rooms<Any>(b, 'return { said: [...r.said], members: r.members, room: r.room };');
    const cSt = await rooms<Any>(c, 'return { room: r.room, remotes: r.remotes.length };').catch(() => ({}) as Any);
    writeFileSync(join(SHOTS, 'rooms-live-b.png'), await b.screenshot());
    check('rooms A moved', pathLen(ra) >= 3, +pathLen(ra).toFixed(2));
    check(`rooms B's remote follows A: RMS < ${RMS_BOUND_M} m over >= 100 samples`, fit.rmsM < RMS_BOUND_M && fit.n >= 100, { rmsM: +fit.rmsM.toFixed(4), n: fit.n, delayMs: fit.delayMs, p90M: fit.p90M, maxM: fit.maxM });
    check("rooms B's member list has A's name", (bSt.members as Any[]).some((m) => m.nick === A.nick), bSt.members);
    check('rooms speech: A heard the join, B the welcome', (aSt.said as string[]).includes('rooms.say.joined') && (bSt.said as string[]).includes('rooms.say.welcome'), { a: aSt.said, b: bSt.said });
    const cSeen = rcRaw.filter((s) => Number.isFinite(s[1])).length;
    check('rooms control: C in another room sees nobody', C.created && cSt.room !== bSt.room && cSeen === 0 && rcRaw.length > 100, { cRoomDiffers: cSt.room !== bSt.room, cFramesWithRemote: cSeen, cFrames: rcRaw.length });
    check('rooms control: swapped axes break the fit', swapped.rmsM > RMS_BOUND_M, +swapped.rmsM.toFixed(3));
    await c.context().close();

    await b.keyboard.press(roomKeys.who);
    await sleep(600);
    const who = await rooms<string[]>(b, 'return [...r.said];');
    await a.context().close();
    const left = await poll(() => rooms<boolean>(b, "return r.said.includes('rooms.say.left') && r.remotes.length === 0;"), (v) => v, 20000);
    check('rooms B: the who-is-around key says who is around, then A leaves and B hears it', who[who.length - 1] === 'rooms.say.who' && left.ok, { key: roomKeys.who, whoLast: who[who.length - 1], left: left.ok });
    out.rooms = { scene: ROOM_SCENE, keys: roomKeys, fit, aPathM: +pathLen(ra).toFixed(2), bFrames: rbRaw.length, bWithRemote: rb.length, console: { a: LA.console.filter((l) => /error/i.test(l)).slice(-6), b: LB.console.filter((l) => /error/i.test(l)).slice(-6) } };
    await b.context().close();
}

async function main(): Promise<void> {
    if (!/^https?:\/\//.test(SITE)) throw new Error('SITE is not set: SITE=https://... npx tsx src/train1-live.ts');
    const what = process.argv.slice(2).filter((a) => a === 'tracks' || a === 'rooms');
    const run = what.length ? what : ['tracks', 'rooms'];
    mkdirSync(SHOTS, { recursive: true });
    console.log(`train1-live target: ${SITE} (${run.join(', ')})`);
    const out: Any = { site: SITE, run, shots: SHOTS };
    const browsers: Launched[] = [];
    await lock();
    try {
        const LA = await launch();
        const LB = await launch();
        browsers.push(LA, LB);
        out.browser = LA.which;
        if (run.includes('tracks')) await tracks(LA, out).catch((e) => check('tracks ran to the end', false, String((e as Error).message ?? e).slice(0, 400)));
        if (run.includes('rooms')) await roomsCheck(LA, LB, out).catch((e) => check('rooms ran to the end', false, String((e as Error).message ?? e).slice(0, 400)));
    } finally {
        for (const L of browsers) await L.browser.close().catch(() => undefined);
        unlock();
    }
    const pass = checks.length > 0 && checks.every((c) => c.pass);
    out.checks = checks;
    out.pass = pass;
    const file = writeEvidence('train1-live', out);
    console.log(JSON.stringify({ pass, passed: checks.filter((c) => c.pass).length, of: checks.length, failed: checks.filter((c) => !c.pass), saved: out.tracks?.saved ?? null }));
    console.log(`evidence ${file}`);
    process.exitCode = pass ? 0 : 1;
}

await main();
