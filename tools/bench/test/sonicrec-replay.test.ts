// Fly by Sound, step 5 (docs/wip/v12-feedback.md): the replay of a recording (apps/fly/src/sonic-session/replay-*.ts) against the sound
// package's own model host (packages/sonic-fpv/test/helpers/record.ts), which flies a scripted lesson and records what the simulator's
// recorder must write: 30 Hz frames with their cue ids, the events and the host markers. Packages made that way are what the replay core was
// built for, so a replay of them must check out; the same page in a real browser, with the real recorder, a tone-burst microphone and a real
// AudioContext, is tools/bench/src/sonicrec-replay.ts. Every claim has a control that must fail the way the claim says it would.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { checkSession, getLesson, readPackage, readZip, REPLAY_KEY_ACTIONS, Replayer, rebuildSession, ZipWriter } from '../../../packages/sonic-fpv/src';
import type { FlightFrame, LessonLayers, SessionEvent, SessionPackage, SonicPrefs, SonicWorld, SpeechLine, ThemeDef } from '../../../packages/sonic-fpv/src';
import { RecordingHost } from '../../../packages/sonic-fpv/test/helpers/record';
import { checkPackage } from '../../../apps/fly/src/sonic-session/replay-check';
import { frameAtOrBefore, OLDER_LINE, poseAt, RECORDED_LINE, ReplayPlayer } from '../../../apps/fly/src/sonic-session/replay-player';
import type { ReplayDeps, ReplayEngine } from '../../../apps/fly/src/sonic-session/replay-player';
import { voicePlan } from '../../../apps/fly/src/sonic-session/replay-voice';
import type { VoiceBuffer } from '../../../apps/fly/src/sonic-session/replay-voice';
import { openBytes } from '../../../apps/fly/src/sonic-session/replay-open';
import type { ReplayHost, ReplayLink } from '../../../apps/fly/src/sonic-session/replay-host';

type ControlMod = typeof import('../../../apps/fly/src/sonic-session/replay-control');
let control: ControlMod;

beforeAll(async () => {
    class FakeElement { isContentEditable = false; }
    vi.stubGlobal('HTMLElement', FakeElement);
    vi.stubGlobal('location', { pathname: '/en/fly/', search: '' });
    vi.stubGlobal('document', { cookie: '', documentElement: { lang: '' }, visibilityState: 'visible', addEventListener() {}, removeEventListener() {} });
    control = await import('../../../apps/fly/src/sonic-session/replay-control');
});

const VOICE_OFFSET_MS = 1500;
/** The sound package's own fixtures (the recordings made with v0.12 among them). */
const FIXTURES = fileURLToPath(new URL('../../../packages/sonic-fpv/test/fixtures', import.meta.url));

/** The package with its entries rewritten by `fn`: a zip whose own checks (CRC-32) pass, so only what the package layer checks is damaged. */
function rewritten(bytes: Uint8Array, fn: (entries: Map<string, Uint8Array>) => void): Uint8Array {
    const entries = readZip(bytes);
    fn(entries);
    const zip = new ZipWriter({ date: '2026-11-07T10:00:00Z' });
    for (const [name, data] of entries) zip.add(name, data);
    return new Uint8Array(Buffer.concat(zip.finish()));
}

/** An events.jsonl with one junk line at its end: the file no longer matches its listed SHA-256 and a line is not an event. */
const junkEvents = (bytes: Uint8Array): Uint8Array =>
    rewritten(bytes, (m) => m.set('events.jsonl', new Uint8Array([...(m.get('events.jsonl') as Uint8Array), ...new TextEncoder().encode('{"t":1,"kind":"nothing"}\n')])));

/** A recorded flight of a lesson, as a package read back strictly (the way a file would be). */
async function recorded(lessonId: string, fly: (host: RecordingHost) => void, voice = true): Promise<{ pkg: SessionPackage; bytes: Uint8Array; host: RecordingHost }> {
    const host = new RecordingHost(getLesson(lessonId), { answerer: (_q, i) => [1, 2, 2][i] ?? 0 });
    host.begin();
    fly(host);
    const slices = [new Uint8Array(400).fill(7), new Uint8Array(400).fill(9)];
    const { bytes, pkg } = await host.toPackage(voice ? { voice: { offsetMs: VOICE_OFFSET_MS, slices } } : {});
    return { pkg, bytes, host };
}

const ringsFirst = (host: RecordingHost): void => {
    host.until(() => host.runner.phase === 'flying', 120);
    const gate = (host.world?.objects() ?? []).find((o) => o.order !== null);
    if (gate === undefined) throw new Error('rings-first has a ring');
    host.flyTo([gate.pos[0], gate.pos[1], gate.pos[2] + 6], 5);
    host.flyTo([gate.pos[0], gate.pos[1], gate.pos[2] - 6], 5);
    host.hold(3);
};

const wallsHall = (host: RecordingHost): void => {
    host.until(() => host.runner.phase === 'flying', 120);
    host.flyTo([0, 1.5, -27.5], 3);
    host.hold(1.2);
    host.press(REPLAY_KEY_ACTIONS.next);
    host.until(() => host.runner.phase === 'flying', 20);
    host.flyTo([0, 1.5, -20], 3);
    host.touch();
    host.flyTo([0, 1.5, -24], 3);
    host.press(REPLAY_KEY_ACTIONS.resetStart);
    host.hold(1.5);
};

// ------------------------------------------------------------------ the fake page

interface Calls {
    update: { t: number; at: number }[];
    say: { key: string; params?: SpeechLine['params']; interrupt: boolean | undefined; at: number }[];
    cue: { kind: string; at: number }[];
    layers: LessonLayers[];
    prefs: SonicPrefs[];
    theme: ThemeDef[];
    shows: { pos: readonly number[]; at: number }[];
    log: string[];
    plays: { whenAc: number; offsetS: number; duration: number }[];
    stops: number;
}

function rig(pkg: SessionPackage, o: { voiceDuration?: number; decodeFails?: boolean; lag?: number; maxCatchUp?: number; world?: SonicWorld | null } = {}) {
    const clock = { a: 100 };
    const calls: Calls = { update: [], say: [], cue: [], layers: [], prefs: [], theme: [], shows: [], log: [], plays: [], stops: 0 };
    const ownPrefs = { marker: 'own-prefs' } as unknown as SonicPrefs;
    const ownTheme = { marker: 'own-theme' } as unknown as ThemeDef;
    const states: string[] = [];
    const engine: ReplayEngine = {
        update: (input) => calls.update.push({ t: input.sample.t, at: clock.a }),
        cue: (e) => calls.cue.push({ kind: e.kind, at: clock.a }),
        say: async (line, opt) => void calls.say.push({ key: line.key, ...(line.params ? { params: line.params } : {}), interrupt: opt?.interrupt, at: clock.a }),
        setLayers: (l) => calls.layers.push(l),
        setPrefs: (p) => calls.prefs.push(p),
        setTheme: (x) => calls.theme.push(x)
    };
    const deps: ReplayDeps = {
        now: () => clock.a,
        engine,
        pose: {
            begin: () => calls.log.push('pose.begin'),
            show: (pos) => calls.shows.push({ pos, at: clock.a }),
            end: () => calls.log.push('pose.end')
        },
        voice: {
            decode: async () => {
                if (o.decodeFails === true) throw new Error('cannot decode');
                return { duration: o.voiceDuration ?? 20 } as VoiceBuffer;
            },
            play: (buffer, whenAc, offsetS) => {
                calls.plays.push({ whenAc, offsetS, duration: buffer.duration });
                return { stop: () => void calls.stops++ };
            }
        },
        own: () => ({ prefs: ownPrefs, theme: ownTheme }),
        playback: (on) => calls.log.push(`playback.${on}`),
        ...(o.lag === undefined ? {} : { viewLagMs: () => o.lag as number }),
        ...(o.maxCatchUp === undefined ? {} : { maxCatchUp: o.maxCatchUp }),
        onChange: (s) => states.push(s.phase)
    };
    const setup = rebuildSession(pkg.manifest, o.world === undefined ? {} : { world: o.world });
    const player = new ReplayPlayer(deps, pkg, setup);
    /** advance the audio clock by `ms` in steps of one display frame, ticking the player each step */
    const run = (ms: number, step = 1000 / 60): void => {
        for (let t = 0; t < ms - 1e-9; t += step) {
            clock.a += Math.min(step, ms - t) / 1000;
            player.tick();
        }
    };
    return { player, clock, calls, deps, setup, run, ownPrefs, ownTheme, states };
}

// ------------------------------------------------------------------ the pure parts

describe('where the voice starts', () => {
    it('later than now before the voice began, part way in once it has, nothing after it ends', () => {
        expect(voicePlan(1500, 0, 20)).toEqual({ atS: 1.5, offsetS: 0, audible: true });
        expect(voicePlan(1500, 1500, 20)).toEqual({ atS: 0, offsetS: 0, audible: true });
        expect(voicePlan(1500, 4000, 20)).toEqual({ atS: 0, offsetS: 2.5, audible: true });
        expect(voicePlan(1500, 21_499, 20).audible).toBe(true);
        expect(voicePlan(1500, 21_500, 20).audible).toBe(false);
        expect(voicePlan(1500, 100_000, 20).audible).toBe(false);
        expect(voicePlan(0, 0, 0).audible).toBe(false);          // an empty voice is not started
    });
});

describe('the craft between two frames', () => {
    const f = (t: number, x: number, q: FlightFrame['q'] = [1, 0, 0, 0]): FlightFrame => ({ t, tick: t, p: [x, 0, 0], v: [0, 0, 0], q, s: [0, 0, 0, 0], c: [] });
    const frames = [f(100, 0), f(133, 3.3), f(166, 6.6)];
    it('finds the last frame at or before a time', () => {
        expect([50, 100, 120, 133, 165, 166, 900].map((t) => frameAtOrBefore(frames, t))).toEqual([-1, 0, 0, 1, 1, 2, 2]);
        expect(frameAtOrBefore([], 5)).toBe(-1);
    });
    it('is exactly the recorded pose at a frame time and a blend between', () => {
        expect(poseAt(frames, 133)?.pos).toEqual([3.3, 0, 0]);
        const mid = poseAt(frames, 116.5);
        expect(mid?.pos[0]).toBeCloseTo(1.65, 9);
        expect(poseAt(frames, 0)?.pos).toEqual([0, 0, 0]);             // before the first: the first
        expect(poseAt(frames, 9999)?.pos).toEqual([6.6, 0, 0]);        // after the last: the last
        expect(poseAt([], 1)).toBeNull();
    });
    it('blends attitudes by the nearer sign, normalised', () => {
        const h = Math.SQRT1_2;
        const a = f(0, 0, [1, 0, 0, 0]);
        const b = f(100, 0, [-h, 0, -h, 0]);                          // the same attitude as [h, 0, h, 0], written with the other sign
        const mid = poseAt([a, b], 50)?.quat as readonly number[];
        expect(Math.hypot(...mid)).toBeCloseTo(1, 9);
        expect(mid[0]).toBeGreaterThan(0.9);                          // 22.5 degrees about Y: cos(11.25 deg) = 0.98; the far sign would pass through zero
        expect(mid[2]).toBeGreaterThan(0.15);
    });
});

// ------------------------------------------------------------------ the check

describe('the replay check', () => {
    let rings: Awaited<ReturnType<typeof recorded>>;
    let walls: Awaited<ReturnType<typeof recorded>>;
    beforeAll(async () => {
        rings = await recorded('rings-first', ringsFirst);
        walls = await recorded('walls-hall', wallsHall);
    }, 120_000);

    it('holds what the model host recorded: the same check as the package makes in one piece', async () => {
        for (const r of [rings, walls]) {
            const mine = await checkPackage(r.pkg);
            const theirs = checkSession(r.pkg);
            expect(mine.error).toBeNull();
            expect(mine.check?.ok).toBe(true);
            expect(mine.check).toEqual(theirs.check);                      // chunking changes when the work is done, not what it finds
            expect(mine.line.startsWith('replay check PASS')).toBe(true);
            expect(mine.check?.events.recorded).toBeGreaterThan(5);
            expect(mine.check?.events.matched).toBe(mine.check?.events.recorded);
        }
    });

    it('yields to the browser while it works, and the page can stay alive', async () => {
        let yields = 0;
        await checkPackage(rings.pkg, { yieldEvery: 50, yieldFn: async () => void yields++ });
        expect(yields).toBe(Math.floor(rings.pkg.frames.length / 50));
        expect(yields).toBeGreaterThan(3);
        // and the yields are real: other tasks of the page (a timer here) run while the check is under way
        let ticks = 0;
        const timer = setInterval(() => void ticks++, 0);
        await checkPackage(rings.pkg, { yieldEvery: 50 });
        clearInterval(timer);
        expect(ticks).toBeGreaterThan(3);
    });

    it('fails when the recording does not hold what the lesson would have done (controls)', async () => {
        // an event the lesson re-derives is taken out of the recording
        const starts = walls.pkg.events.filter((e) => e.kind === 'lesson' && e.what === 'attempt-start');
        expect(starts.length).toBeGreaterThan(0);
        const without = walls.pkg.events.filter((e) => !(e.kind === 'lesson' && e.what === 'attempt-start'));
        const missing = await checkPackage({ ...walls.pkg, events: without });
        expect(missing.check?.ok).toBe(false);
        expect(missing.check?.events.diffs.some((d) => d.problem === 'extra')).toBe(true);
        // the flight is moved: the lesson sees another path
        const moved = walls.pkg.frames.map((fr) => ({ ...fr, p: [fr.p[0] + 6, fr.p[1], fr.p[2]] as FlightFrame['p'] }));
        expect((await checkPackage({ ...walls.pkg, frames: moved })).check?.ok).toBe(false);
        // the recorded cues are not what the planner makes of the frames
        const cues = walls.pkg.frames.map((fr) => ({ ...fr, c: ['safety.nothing-like-it'] }));
        const wrongCues = await checkPackage({ ...walls.pkg, frames: cues });
        expect(wrongCues.check?.ok).toBe(false);
        expect(wrongCues.check?.cues.share).toBeLessThan(0.95);
    });

    it('says why a recording cannot be replayed at all', async () => {
        const unknown = await checkPackage({ ...rings.pkg, manifest: { ...rings.pkg.manifest, lesson: { id: 'no-such-lesson', version: 1, path: 'full' } } });
        expect(unknown.setup).toBeNull();
        expect(unknown.error?.code).toBe('unknown-lesson');
        expect((await checkPackage({ ...rings.pkg, frames: [] })).error?.code).toBe('frames');
        // a scan recording without the simulator's world: replayed without one when the caller says so, refused when it says nothing
        const scan = { ...rings.pkg.manifest, lesson: null, scene: { kind: 'scan' as const, id: 'ab12cd34', version: 1, transform: [5, 0, 0, 0] as const } };
        expect((await checkPackage({ ...rings.pkg, manifest: scan })).error?.code).toBe('scan-world-needed');
        const without = await checkPackage({ ...rings.pkg, manifest: scan }, { world: null });
        expect(without.error).toBeNull();
        expect(without.setup?.notes.some((n) => n.code === 'no-world')).toBe(true);
    });
});

// ------------------------------------------------------------------ the player

describe('the player on a clock it does not own', () => {
    let rings: Awaited<ReturnType<typeof recorded>>;
    beforeAll(async () => {
        rings = await recorded('rings-first', ringsFirst);
    }, 120_000);

    const lengthMs = (): number => (rings.pkg.frames.at(-1) as FlightFrame).t;

    it('steps every frame once, in order, when its time comes, and feeds the engine what the lesson said and cued', async () => {
        const r = rig(rings.pkg, { voiceDuration: 1 });
        await r.player.prepare();
        expect(r.player.state.voice).toBe('ready');
        r.player.play();
        r.run(lengthMs() + 500);
        const frames = rings.pkg.frames;
        expect(r.calls.update.map((u) => u.t)).toEqual(frames.map((f) => f.t));              // every frame once, in order
        // each frame is fed no earlier than its time and at most one display frame (17 ms) after it
        const start = 100;                                                                    // the audio clock when play() was pressed
        for (const u of r.calls.update) {
            const due = start + u.t / 1000;
            expect(u.at).toBeGreaterThanOrEqual(due - 1e-9);
            expect(u.at - due).toBeLessThan(0.0175);
        }
        // the lesson's own lines, in the recorded order, with the interrupt the runner asked for
        const recordedLines = rings.pkg.events.filter((e): e is Extract<SessionEvent, { kind: 'speech' }> => e.kind === 'speech' && e.key !== 'speech.end').map((e) => e.key);
        expect(r.calls.say.map((s) => s.key)).toEqual(recordedLines);
        expect(recordedLines.length).toBeGreaterThan(3);
        // and its cues: what an independent run of the replay core derives
        const core = new Replayer({ setup: r.setup, frames, events: rings.pkg.events });
        let cueActions = 0;
        for (let s = core.step(); s !== null; s = core.step()) cueActions += s.actions.filter((a) => a.kind === 'cue').length;
        expect(r.calls.cue.length).toBe(cueActions);
        expect(cueActions).toBeGreaterThan(0);
        expect(r.player.state.phase).toBe('ended');
        // control: a player that is never ticked feeds nothing
        const idle = rig(rings.pkg);
        idle.player.play();
        expect(idle.calls.update.length).toBe(0);
    });

    it('shows the recorded pose at each frame time and a blend between, a lag behind the audio clock when asked', async () => {
        const frames = rings.pkg.frames;
        const moving = (frames.find((f) => Math.hypot(...f.v) > 2) as FlightFrame).t + 400;      // a moment when the craft is on the move
        const r = rig(rings.pkg, { lag: 40 });
        await r.player.prepare();
        r.player.play();
        r.run(moving);
        for (const s of r.calls.shows.slice(-30)) {
            const t = (s.at - 100) * 1000 - 40;                                               // package time of the pose shown
            const want = poseAt(frames, t)?.pos as readonly number[];
            expect(s.pos[0]).toBeCloseTo(want[0] as number, 6);
            expect(s.pos[2]).toBeCloseTo(want[2] as number, 6);
        }
        // control: with no lag the same moments show other poses (the craft is moving)
        const r0 = rig(rings.pkg);
        await r0.player.prepare();
        r0.player.play();
        r0.run(moving);
        expect(r0.calls.shows.at(-1)?.pos).not.toEqual(r.calls.shows.at(-1)?.pos);
    });

    it('starts the voice on the audio clock so that voice and frames are the same moment, through pause, resume, seek and a stall', async () => {
        const r = rig(rings.pkg);
        await r.player.prepare();
        const voiceAt = (): number => {
            // the package time of the voice sample sounding now, from the last play() call
            const p = r.calls.plays.at(-1);
            if (p === undefined) return NaN;
            return VOICE_OFFSET_MS / 1000 + p.offsetS + (r.clock.a - p.whenAc);
        };
        r.player.play();
        expect(r.calls.plays[0]).toEqual({ whenAc: 100 + VOICE_OFFSET_MS / 1000, offsetS: 0, duration: 20 });     // not yet: the voice begins 1.5 s into the recording
        r.run(2500);
        expect(r.player.currentT() / 1000).toBeCloseTo(voiceAt(), 6);
        r.player.pause();
        expect(r.calls.stops).toBe(1);
        const held = r.player.currentT();
        r.run(3000);                                                                          // the clock runs on, the replay does not
        expect(r.player.currentT()).toBe(held);
        r.player.play();
        expect(r.calls.plays.length).toBe(2);
        expect(r.calls.plays[1]?.offsetS).toBeCloseTo((held - VOICE_OFFSET_MS) / 1000, 6);   // back where it was left
        r.run(1000);
        expect(r.player.currentT()).toBeCloseTo(held + 1000, 3);
        expect(r.player.currentT() / 1000).toBeCloseTo(voiceAt(), 6);
        r.player.seek(6000);                                                                 // while playing: voice and frames both jump
        expect(r.calls.plays.length).toBe(3);
        expect(r.player.currentT()).toBeCloseTo(6000, 3);
        expect(r.player.currentT() / 1000).toBeCloseTo(voiceAt(), 6);
        r.run(700);
        expect(r.player.currentT() / 1000).toBeCloseTo(voiceAt(), 6);
        r.clock.a += 4;                                                                       // the page stalls for 4 s
        r.player.tick();
        expect(r.player.currentT() / 1000).toBeCloseTo(voiceAt(), 6);                         // the voice kept going on the same clock
        // control: a voice anchored a half second off would show up in the same comparison
        const p = r.calls.plays.at(-1) as { whenAc: number; offsetS: number };
        expect(Math.abs(r.player.currentT() / 1000 - (VOICE_OFFSET_MS / 1000 + p.offsetS + 0.5 + (r.clock.a - p.whenAc)))).toBeGreaterThan(0.4);
    });

    it('goes silent on pause, comes back with the lesson layers, and gives everything back on close', async () => {
        const r = rig(rings.pkg);
        await r.player.prepare();
        r.player.play();
        expect(r.calls.log).toEqual(['playback.true', 'pose.begin']);                         // the mode lets go before the camera is taken
        expect(r.calls.prefs[0]).toBe(r.setup.prefs);
        expect(r.calls.theme[0]).toBe(r.setup.theme);
        expect(r.calls.layers.at(-1)).toBe(r.player.layers);
        r.run(1000);
        r.player.pause();
        expect(r.calls.layers.at(-1)?.on).toEqual([]);                                        // nothing sounds while it is paused
        r.player.play();
        expect(r.calls.layers.at(-1)).toBe(r.player.layers);
        r.player.close();
        expect(r.calls.log).toEqual(['playback.true', 'pose.begin', 'pose.end', 'playback.false']);
        expect(r.calls.prefs.at(-1)).toBe(r.ownPrefs);                                        // the pilot's own settings again
        expect(r.calls.theme.at(-1)).toBe(r.ownTheme);
        expect(r.calls.layers.at(-1)?.on).toEqual([]);
        expect(r.player.state.phase).toBe('ready');
        // control: a replay that was only opened and never played took nothing from the page
        const untouched = rig(rings.pkg);
        await untouched.player.prepare();
        untouched.player.close();
        expect(untouched.calls.log).toEqual([]);
    });

    it('does not play a burst of old lines after a stall, and does not repeat what a seek has passed', async () => {
        const slow = rig(rings.pkg, { voiceDuration: 1 });
        await slow.player.prepare();
        slow.player.play();
        slow.run(lengthMs() + 100);
        const all = slow.calls.say.length;
        const fast = rig(rings.pkg, { voiceDuration: 1 });
        await fast.player.prepare();
        fast.player.play();
        fast.clock.a += (lengthMs() - 200) / 1000;                                            // one stall almost to the end
        fast.player.tick();
        expect(fast.calls.update.length).toBe(1);                                             // the engine hears the last frame, not every one
        expect(fast.calls.say.length).toBeLessThan(all);                                      // lines from long ago are not said in a burst
        // a seek forward to the middle and on: the lines that follow are the straight run's lines after that moment
        const mid = rig(rings.pkg, { voiceDuration: 1 });
        await mid.player.prepare();
        mid.player.play();
        mid.player.seek(lengthMs() / 2);
        mid.run(lengthMs() / 2 + 200);
        const cut = lengthMs() / 2;
        const straightAfter = slow.calls.say.filter((s) => (s.at - 100) * 1000 > cut).map((s) => s.key);
        expect(mid.calls.say.map((s) => s.key)).toEqual(straightAfter);
        expect(mid.player.state.phase).toBe('ended');
        // and a seek back replays from the start: the lesson's lines come again
        mid.player.seek(0);
        mid.player.play();
        mid.run(lengthMs() + 200);
        expect(mid.calls.say.length).toBeGreaterThanOrEqual(all);
    });

    it('replays without a voice when there is none or it cannot be decoded, and says which', async () => {
        const noVoice = await recorded('rings-first', ringsFirst, false);
        const a = rig(noVoice.pkg);
        await a.player.prepare();
        expect(a.player.state.voice).toBe('none');
        a.player.play();
        a.run(1000);
        expect(a.calls.plays.length).toBe(0);
        const b = rig(rings.pkg, { decodeFails: true });
        await b.player.prepare();
        expect(b.player.state.voice).toBe('failed');
        b.player.play();
        b.run(1000);
        expect(b.calls.plays.length).toBe(0);
        expect(b.calls.update.length).toBeGreaterThan(10);                                    // the flight still goes (frames begin half a second in)
        // control: with a voice that decodes it is started
        const c = rig(rings.pkg);
        await c.player.prepare();
        c.player.play();
        expect(c.calls.plays.length).toBe(1);
    });

    it('ends by itself, silences the engine, and starts over when played again', async () => {
        const r = rig(rings.pkg, { voiceDuration: 3 });
        await r.player.prepare();
        r.player.play();
        r.run(lengthMs() + 300);
        expect(r.player.state.phase).toBe('ended');
        expect(r.calls.layers.at(-1)?.on).toEqual([]);
        expect(r.calls.stops).toBeGreaterThanOrEqual(1);
        const before = r.calls.update.length;
        r.run(500);
        expect(r.calls.update.length).toBe(before);                                           // nothing more once it is over
        r.player.play();
        expect(r.player.state.phase).toBe('playing');
        r.run(1000);
        expect(r.calls.update.length).toBeGreaterThan(before);
    });

    it('lasts as long as the longer of the flight and the voice', async () => {
        const long = rig(rings.pkg, { voiceDuration: 120 });
        await long.player.prepare();
        expect(long.player.state.durationMs).toBeCloseTo(VOICE_OFFSET_MS + 120_000, 3);
        const short = rig(rings.pkg, { voiceDuration: 1 });
        await short.player.prepare();
        expect(short.player.state.durationMs).toBe(lengthMs());
    });
});

// ------------------------------------------------------------------ v0.13 W9: a recording of an older version of the lesson

describe('v0.13 (lane v13-host C4, W9): the player feeds the engine the lines the pilot heard when the lesson was flown with an older version of it', () => {
    /** The sound package's recordings made with v0.12 (lesson and theme version 1), read strictly. */
    const v012 = (name: string): SessionPackage => readPackage(new Uint8Array(readFileSync(join(FIXTURES, name))));
    const linesOf = (pkg: SessionPackage): { t: number; text: string }[] => pkg.events.flatMap((e) => (e.kind === 'speech' && e.key !== 'speech.end' ? [{ t: e.t, text: e.text }] : []));

    it.each(['session-v012-rings-first.zip', 'session-v012-walls-hall.zip'])('%s: every recorded line, its text at its time, after one line that says it was flown with an older version; none of the lines this build works out', async (name) => {
        const pkg = v012(name);
        expect(pkg.problems).toEqual([]);
        const lessonId = pkg.manifest.lesson!.id;
        const r = rig(pkg);
        expect(r.setup.notes.find((n) => n.code === 'lesson-version')).toMatchObject({ recorded: 1, here: getLesson(lessonId).version });
        await r.player.prepare();
        r.player.play();
        r.run((pkg.frames.at(-1) as FlightFrame).t + 500);
        expect(r.player.state.phase).toBe('ended');
        const lines = linesOf(pkg);
        expect(lines.length).toBeGreaterThan(5);
        // first, once: the line that says so, with the versions
        expect(r.calls.say[0]).toMatchObject({ key: OLDER_LINE, params: { recorded: 1, here: getLesson(lessonId).version }, interrupt: false });
        expect(r.calls.say.filter((s) => s.key === OLDER_LINE)).toHaveLength(1);
        // then every recorded line, in order, queued as it was (each line's text as the pilot heard it)
        const said = r.calls.say.filter((s) => s.key === RECORDED_LINE);
        expect(said.map((s) => s.params?.text)).toEqual(lines.map((l) => l.text));
        expect(said.every((s) => s.interrupt === false)).toBe(true);
        // each at its time on the audio clock: never before it, at most one display frame after it
        said.forEach((s, i) => {
            const due = 100 + (lines[i] as { t: number }).t / 1000;
            expect(s.at).toBeGreaterThanOrEqual(due - 1e-9);
            expect(s.at - due).toBeLessThan(0.0175);
        });
        // nothing else: this build's runner works out other lines for it (format 2, the three plays), none of which is said
        expect(r.calls.say).toHaveLength(lines.length + 1);
        const core = new Replayer({ setup: r.setup, frames: pkg.frames, events: pkg.events });
        const worked: string[] = [];
        for (let s = core.step(); s !== null; s = core.step()) for (const a of s.actions) if (a.kind === 'say') worked.push(a.line.key);
        expect(worked.length).toBeGreaterThan(0);
        expect(r.calls.say.some((s) => worked.includes(s.key))).toBe(false);
        // the cues are still the ones this build works out from the frames
        expect(r.calls.cue.length).toBeGreaterThan(0);
    });

    it('a seek passes the lines before it and says the ones after it; a replay from its start says them again, and the line about the older version once in all', async () => {
        const pkg = v012('session-v012-walls-hall.zip');
        const lines = linesOf(pkg);
        const r = rig(pkg);
        await r.player.prepare();
        r.player.play();
        const cut = 20_000;
        r.player.seek(cut);
        r.run((pkg.frames.at(-1) as FlightFrame).t - cut + 500);
        const after = lines.filter((l) => l.t >= cut).map((l) => l.text);
        expect(after.length).toBeGreaterThan(0);
        expect(r.calls.say.filter((s) => s.key === RECORDED_LINE).map((s) => s.params?.text)).toEqual(after);
        r.player.seek(0);
        r.player.play();
        r.run((pkg.frames.at(-1) as FlightFrame).t + 500);
        expect(r.calls.say.filter((s) => s.key === RECORDED_LINE)).toHaveLength(after.length + lines.length);
        expect(r.calls.say.filter((s) => s.key === OLDER_LINE)).toHaveLength(1);
        // a stall: the lines from long ago are not said in a burst
        const stalled = rig(pkg);
        await stalled.player.prepare();
        stalled.player.play();
        stalled.clock.a += 25;
        stalled.player.tick();
        expect(stalled.calls.say.filter((s) => s.key === RECORDED_LINE).length).toBeLessThan(lines.filter((l) => l.t <= 25_000).length);
    });

    it('control: the same recording claiming this build\'s lesson version is replayed with the lines this build works out, and nothing about an older version', async () => {
        const pkg = v012('session-v012-rings-first.zip');
        const m = pkg.manifest;
        const claimed: SessionPackage = { ...pkg, manifest: { ...m, lesson: { ...m.lesson!, version: getLesson(m.lesson!.id).version } } };
        const r = rig(claimed);
        expect(r.setup.notes.some((n) => n.code === 'lesson-version')).toBe(false);
        await r.player.prepare();
        r.player.play();
        r.run((pkg.frames.at(-1) as FlightFrame).t + 500);
        expect(r.calls.say.some((s) => s.key === OLDER_LINE || s.key === RECORDED_LINE)).toBe(false);
        // the lines an independent run of the replay core works out, in order
        const core = new Replayer({ setup: r.setup, frames: claimed.frames, events: claimed.events });
        const worked: string[] = [];
        for (let x = core.step(); x !== null; x = core.step()) for (const a of x.actions) if (a.kind === 'say') worked.push(a.line.key);
        expect(worked.length).toBeGreaterThan(0);
        expect(r.calls.say.map((x) => x.key)).toEqual(worked);
    });
});

// ------------------------------------------------------------------ opening a file

describe('opening a recording', () => {
    it('reads a package strictly, reads a damaged one as far as it goes, and refuses what is not a package', async () => {
        const { bytes } = await recorded('rings-first', ringsFirst);
        const ok = openBytes(bytes);
        expect(ok.ok && !ok.lenient && ok.problems.length === 0).toBe(true);
        // an event log with a line that is not an event: the whole file is no longer a package, and what can be read is
        const bad = junkEvents(bytes);
        const damaged = openBytes(bad);
        expect(damaged.ok).toBe(true);
        if (damaged.ok) {
            expect(damaged.lenient).toBe(true);
            expect(damaged.problems.length).toBeGreaterThan(0);
            expect(damaged.pkg.frames.length).toBeGreaterThan(100);                           // the flight is all there
        }
        // control: strict reading does refuse it
        expect(() => readPackage(bad)).toThrow();
        // a zip with a flipped byte inside an entry fails its CRC-32: nothing of it can be trusted, and it is refused
        const flipped = bytes.slice();
        flipped[60] = (flipped[60] as number) ^ 0xff;
        expect(openBytes(flipped).ok).toBe(false);
        expect(openBytes(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])).ok).toBe(false);
        expect(openBytes(new Uint8Array(0)).ok).toBe(false);
    });
});

// ------------------------------------------------------------------ the controller

describe('the replay as the helper uses it', () => {
    let rings: Awaited<ReturnType<typeof recorded>>;
    beforeAll(async () => {
        rings = await recorded('rings-first', ringsFirst);
    }, 120_000);

    function page(o: { runtime?: boolean; world?: SonicWorld | null; sceneId?: string | null } = {}) {
        const r = rig(rings.pkg);
        const frameListeners: (() => void)[] = [];
        const lostListeners: (() => void)[] = [];
        const links: ReplayLink[] = [];
        const host: ReplayHost = {
            link: () => {
                if (o.runtime === false) return null;
                const link = { deps: r.deps, world: o.world === undefined ? null : o.world, sceneId: o.sceneId ?? null };
                links.push(link);
                return link;
            },
            frames: (cb) => {
                frameListeners.push(cb);
                return () => void frameListeners.splice(frameListeners.indexOf(cb), 1);
            },
            lost: (cb) => {
                lostListeners.push(cb);
                return () => void lostListeners.splice(lostListeners.indexOf(cb), 1);
            }
        };
        const changes: import('../../../apps/fly/src/sonic-session/replay-control').ReplayViewState[] = [];
        const ctl = new control.ReplayControl({
            host,
            stores: { durable: false } as never,
            formatWhen: (iso) => iso.slice(0, 10),
            onChange: (s) => changes.push(s)
        });
        return { r, ctl, host, frameListeners, lostListeners, changes, links };
    }
    const file = (bytes: Uint8Array): Blob => new Blob([bytes as BlobPart]);

    it('opens a file, checks it, takes nothing from the page until Play, and gives it all back on close', async () => {
        const p = page();
        await p.ctl.openFile(file(rings.bytes));
        const s = p.ctl.state;
        expect(s.stage).toBe('ready');
        expect(s.title).toBe('rings-first · 2026-11-07');
        expect(s.check?.ok).toBe(true);
        expect(s.check?.summary).toMatch(/^The replay agrees with the recording: \d+ of \d+ events were worked out again, and \d+ % of the sounds are the same\.$/);
        expect(s.details.startsWith('replay check PASS')).toBe(true);
        expect(s.player?.voice).toBe('ready');
        expect(p.r.calls.log).toEqual([]);                                                    // opened and checked: the flight and the camera untouched
        expect(p.frameListeners.length).toBe(1);
        p.ctl.play();
        expect(p.r.calls.log).toEqual(['playback.true', 'pose.begin']);
        p.frameListeners[0]?.();                                                              // the page's frame tick reaches the player
        p.ctl.pause();
        p.ctl.close();
        expect(p.r.calls.log).toEqual(['playback.true', 'pose.begin', 'pose.end', 'playback.false']);
        expect(p.ctl.state.stage).toBe('closed');
        expect(p.frameListeners.length).toBe(0);
        expect(p.lostListeners.length).toBe(0);
        // control: a second close does nothing more
        p.ctl.close();
        expect(p.r.calls.log.length).toBe(4);
    });

    it('says in words when the file cannot be opened, the recording cannot be replayed, or the mode is off', async () => {
        const p = page();
        await p.ctl.openFile(file(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])));
        expect(p.ctl.state.stage).toBe('error');
        expect(p.ctl.state.error).toMatch(/^This file cannot be opened: /);
        expect(p.frameListeners.length).toBe(0);
        const off = page({ runtime: false });
        await off.ctl.openFile(file(rings.bytes));
        expect(off.ctl.state.stage).toBe('error');
        expect(off.ctl.state.error).toMatch(/needs the sound mode to be running/);
        // a recording of a lesson this build does not have: not replayed, and the reason is said; the page is untouched
        const lessonGone = rewritten(rings.bytes, (m) => {
            const manifest = JSON.parse(new TextDecoder().decode(m.get('manifest.json') as Uint8Array));
            manifest.lesson.id = 'no-such-lesson';
            m.set('manifest.json', new TextEncoder().encode(JSON.stringify(manifest)));
        });
        const other = page();
        await other.ctl.openFile(file(lessonGone));
        expect(other.ctl.state.stage).toBe('error');
        expect(other.ctl.state.error).toMatch(/^This recording cannot be replayed: this build has no lesson 'no-such-lesson'/);
        expect(other.r.calls.log).toEqual([]);
        expect(other.frameListeners.length).toBe(0);
    });

    it('notes an unreadable voice, a missing voice, a damaged file and another place on screen', async () => {
        const noVoice = await recorded('rings-first', ringsFirst, false);
        const a = page();
        await a.ctl.openFile(file(noVoice.bytes));
        expect(a.ctl.state.notes).toContain('This recording has no voice.');
        const b = page();
        await b.ctl.openFile(file(junkEvents(rings.bytes)));
        expect(b.ctl.state.stage).toBe('ready');
        expect(b.ctl.state.notes.some((n) => /problem/.test(n))).toBe(true);
        // control: the intact file, with the lesson's own world on screen, has none of these notes
        const c = page({ world: rebuildSession(rings.pkg.manifest).world });
        await c.ctl.openFile(file(rings.bytes));
        expect(c.ctl.state.notes.some((n) => /problem|no voice|another place/.test(n))).toBe(false);
        // the world on screen is another lesson's: the picture is not the recording's place
        const other = createOtherWorld();
        const d = page({ world: other });
        await d.ctl.openFile(file(rings.bytes));
        expect(d.ctl.state.notes.some((n) => /another place/.test(n))).toBe(true);
        // the lesson's own world on screen: no such note
        const own = page({ world: rebuildSession(rings.pkg.manifest).world });
        await own.ctl.openFile(file(rings.bytes));
        expect(own.ctl.state.notes.some((n) => /another place/.test(n))).toBe(false);
    });

    it('lets the latest open win and drops what it was doing', async () => {
        const p = page();
        const first = p.ctl.openFile(file(rings.bytes));
        const second = p.ctl.openFile(file(rings.bytes));
        await Promise.all([first, second]);
        expect(p.ctl.state.stage).toBe('ready');
        expect(p.frameListeners.length).toBe(1);                                              // one player listens, not two
        expect(p.r.calls.log).toEqual([]);
    });

    it('closes itself when the page loses the sound mode or the scene', async () => {
        const p = page();
        await p.ctl.openFile(file(rings.bytes));
        p.ctl.play();
        p.lostListeners[0]?.();
        expect(p.ctl.state.stage).toBe('closed');
        expect(p.r.calls.log).toEqual(['playback.true', 'pose.begin', 'pose.end', 'playback.false']);
    });

    it('toggles and seeks through the controller', async () => {
        const p = page();
        await p.ctl.openFile(file(rings.bytes));
        p.ctl.toggle();
        expect(p.ctl.state.player?.phase).toBe('playing');
        p.ctl.toggle();
        expect(p.ctl.state.player?.phase).toBe('paused');
        p.ctl.seek(4000);
        expect(p.ctl.state.player?.tMs).toBeCloseTo(4000, 3);
        expect(control.ReplayControl.clock(p.ctl.state.player as never)).toMatch(/^0:04 of 0:\d\d$/);
    });
});

function createOtherWorld(): SonicWorld {
    const lesson = getLesson('walls-hall');
    const w = rebuildSession({ ...readManifestOf(lesson.id) }).world;
    if (w === null) throw new Error('walls-hall has a world');
    return w;
}

function readManifestOf(lessonId: string) {
    // a minimal manifest of a lesson: enough for rebuildSession to make that lesson's world
    const lesson = getLesson(lessonId);
    return {
        format: 'shramko-sonic-session/1',
        id: 'x'.repeat(20),
        created: '2026-11-07T10:00:00Z',
        ended: null,
        complete: true,
        app: { name: 't', release: 't', sonic: 't' },
        scene: { kind: 'analytic', id: 'x', version: 1, transform: [1, 0, 0, 0] },
        track: null,
        lesson: { id: lesson.id, version: lesson.version, path: 'full' },
        theme: { id: 'soft', version: 1 },
        settings: {},
        assists: null,
        device: { locale: 'en' },
        consent: {},
        pilot: { id: 'p', nickname: null },
        clock: { startIso: '2026-11-07T10:00:00Z', frameHz: 30, voiceOffsetMs: null },
        files: []
    } as never;
}
