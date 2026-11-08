// v0.12 Fly by Sound, lane v12-flight step 9 (docs/wip/v12-plan.md 4.2): the lesson host (apps/fly/src/sonic/lessons.ts) in the
// page, on the real flight model, the real lesson pilot, mode, bridge and the sound package's lesson runner (the rig,
// tools/bench/test/sonic-lesson-rig.ts: only the engine and the drawing are fakes). A scripted pilot flies the FIRST lesson
// of each module (0 ears, 1 hover, 2 move and stop, 3 walls, 4 corridor, 5 rings, 6 shapes) through its pass rule, end to
// end: world, start, assists, checkpoints, speech, goals, attempts, resets, the pass line, progress saved. Module 7 is a scan
// (step 10). Controls: a pilot who does not fly (or answers wrong) is not passed, and the pass is not the host's doing.
// Also held: the next lesson opens on the pilot's path after a pass (the world swapped only when it differs), G comes back to
// the lesson it left, a paused flight is not stepped, progress is saved at every attempt, and a lesson flown through the host
// passes the package's replay check (every event re-derived).
// v0.13 (lane v13-host A2, docs/wip/v13-host.md "Changed tests"): the counts, places and plays are the package's: lesson format 2
// (r counted attempts in total, `pass.required`), the micro-drone worlds (the zone, the walls and the ring where the world puts
// them), every named sound played REPEAT_PLAYS times as 'repeat-cue' events (M41-5), the corridor to its end (`track-end`).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { REPEAT_PLAYS, SPEECH_END_KEY, buildManifest, checkSession, defaultPrefs, getBuiltinTheme, getLesson, lessonPaths } from '../../../packages/sonic-fpv/src';
import type { FlightFrame, Vec3 } from '../../../packages/sonic-fpv/src';
import { S } from '../../../packages/sim-core/src';
import { onPlatform } from '../../../apps/fly/src/sonic/bridge';
import { savedProgress } from '../../../apps/fly/src/sonic/store';
import { Rig } from './sonic-lesson-rig';
import type { Control } from './sonic-lesson-rig';

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const wrap = (d: number): number => ((((d + 180) % 360) + 360) % 360) - 180;
const DEG = Math.PI / 180;
/** The unit direction `yawDeg` right of -Z, `pitchDeg` up. */
const dirAt = (yawDeg: number, pitchDeg = 0): Vec3 => [Math.sin(yawDeg * DEG) * Math.cos(pitchDeg * DEG), Math.sin(pitchDeg * DEG), -Math.cos(yawDeg * DEG) * Math.cos(pitchDeg * DEG)];

let rig: Rig | null = null;
afterEach(() => {
    rig?.dispose();
    rig = null;
    vi.restoreAllMocks();
});

async function open(id: string): Promise<Rig> {
    rig = await Rig.make(getLesson(id));
    expect(await rig.host.open(id)).toBe(true);
    return rig;
}

// ------------------------------------------------------------------ the scripted pilots

/** Module 0: a digit for each question, from the direction the sound just came from (control: always 3, "not sure"). */
const ears = (right: boolean): Control => (r) => {
    if (!r.host.asking || r.engine.speaking) return null;
    if (!right) return { answer: 3 };
    const d = r.engine.lastPreviewDir();
    return { answer: d && d[0] < 0 ? 1 : d && d[0] > 0 ? 2 : d && d[2] > 0 ? 2 : 1 };
};

/** Module 1: up to the middle of the band (2 to 3 m over the floor), then the throttle centred holds the height. */
const hover: Control = (r) => {
    const e = 2.5 - r.pos[1];
    return { lift: Math.abs(e) < 0.15 ? 0 : clamp(e * 0.8, -0.6, 0.6) };
};

/**
 * Module 2: forward from the start (the origin) until a metre short of the middle of the world's stop zone, then the sticks
 * centred: the brake stops the craft inside it (v0.13: the zone is 7 m out and 6 m deep, it was 6 to 22 m out).
 */
const moveStop: Control = (r) => {
    const zone = r.world.objects().find((o) => o.shape.kind === 'zone')!;
    return { forward: Math.hypot(r.pos[0], r.pos[2]) < Math.hypot(zone.pos[0], zone.pos[2]) - 1 ? 1 : 0 };
};

/**
 * Module 3: to the farthest wall of the four ways the room runs, slowing so as to stop `stopM` from it (the craft's centre; the
 * lesson counts the hull's distance), then the next wall (the attempts of this lesson begin where the last one ended).
 */
function wallsPilot(stopM: number): Control {
    let target: number | null = null;
    return (r) => {
        const front = r.world.castRay(r.pos, dirAt(r.yaw), 200)?.distance ?? 99;
        // stopped at a wall: the next one is chosen (the attempt asks for 2 m of flying before it counts a stop)
        if (r.speed < 0.3 && front < stopM + 1.1) target = null;
        if (target === null) {
            let best = -1;
            for (const h of [0, 90, 180, 270]) {
                // the wall behind the craft counts, the one it faces does not (it is `stopM` away)
                const d = r.world.castRay(r.pos, dirAt(h), 200)?.distance ?? 0;
                if (d > best + 1e-6) { best = d; target = h; }
            }
        }
        const err = wrap((target as number) - r.yaw);
        if (Math.abs(err) > 6) return { turn: clamp(err / 30, -1, 1) };
        return { forward: clamp((front - stopM) / 2.5, 0, 1), turn: clamp(err / 30, -1, 1) * 0.5 };
    };
}

/** Modules 5 and 6: straight ahead at the gate's height. */
const throughTheGate: Control = (r) => ({ forward: 1, lift: clamp((3 - r.pos[1]) * 0.8, -0.4, 0.4) });

/**
 * Module 5 at the wrong height: under the world's ring (half the height of its lowest edge), then straight on. An attempt begins
 * on the respawn platform, a disc that holds the craft up until it has left it: off it slowly first, then down, then forward.
 * `under()`: the craft went past the ring's plane below the ring (the pilot really flew there).
 */
function underTheRing(r: Rig): { pilot: Control; under: () => boolean } {
    const ring = r.world.objects().find((o) => o.shape.kind === 'ring')!;
    const shape = ring.shape as { diameter: number; tube: number };
    const bottom = ring.pos[1] - (shape.diameter / 2 + shape.tube);
    const low = bottom / 2;
    let under = false;
    const pilot: Control = (rr) => {
        if (rr.pos[2] < ring.pos[2] && rr.pos[1] < bottom) under = true;
        if (rr.session.sim.s[S.platOn] > 0) return { forward: 0.3 };
        return { forward: Math.abs(rr.pos[1] - low) < 0.2 ? 1 : 0, lift: clamp((low - rr.pos[1]) * 0.8, -0.4, 0.4) };
    };
    return { pilot, under: () => under };
}

/**
 * Module 4: along the corridor by its walls, as a person with a cane would: a fan of rays, the way with the most room
 * (clipped at 9 m, so a straight corridor has no favourite, a little nearer the nose and to the right) is where to turn,
 * slower the nearer the wall ahead, a little sideways to keep to the middle, and the height midway between the floor and
 * the ceiling (and toward an opening higher or lower ahead: the jogs). It reads the world's rays, as the engine does.
 */
const corridor: Control = (r) => {
    const p = r.pos, yaw = r.yaw;
    const ray = (dy: number, pitch = 0, max = 30): number => r.world.castRay(p, dirAt(yaw + dy, pitch), max)?.distance ?? max;
    let best = 0, bestScore = -1e9;
    for (let a = -80; a <= 80; a += 10) {
        const score = Math.min(ray(a), 9) - 0.04 * Math.abs(a) + (a > 0 ? 0.01 : 0);
        if (score > bestScore) { bestScore = score; best = a; }
    }
    const front = ray(0), left = ray(-90), right = ray(90);
    const up = r.world.castRay(p, [0, 1, 0], 12)?.distance ?? 12, down = r.world.castRay(p, [0, -1, 0], 12)?.distance ?? 12;
    const upAhead = ray(0, 25), downAhead = ray(0, -25);
    return {
        forward: clamp((front - 1.8) / 5, 0.18, 1),
        turn: clamp(best / 25, -1, 1),
        strafe: clamp((right - left) * 0.06, -0.3, 0.3),
        lift: clamp((up - down) * 0.3 + (upAhead > front + 2 && front < 8 ? 0.4 : 0) - (downAhead > front + 2 && front < 8 ? 0.4 : 0), -0.7, 0.7)
    };
};

// ------------------------------------------------------------------ the first lesson of each module

describe('the first lesson of each module, passed end to end by a scripted pilot', () => {
    it('module 0, ears-headphones: sounds from the left, the right and behind, answered by digits: passed, the pass line spoken, progress saved', async () => {
        const r = await open('ears-headphones');
        expect(r.of('lesson')[0]).toMatchObject({ what: 'open', lessonId: 'ears-headphones' });
        await r.run(240000, ears(true), () => r.passed);
        expect(r.passed).toBe(true);
        const answers = r.of('answer');
        expect(answers.length).toBeGreaterThanOrEqual(3);
        expect(answers.every((a) => a.via === 'key' && a.value !== null)).toBe(true);
        // each trial was a sound the engine played from the side the question is about, REPEAT_PLAYS times (M41-5: 'repeat-cue')
        const trials = (getLesson('ears-headphones').goals.find((g) => g.kind === 'locate') as { trials: number }).trials;
        const plays = r.engine.cues.filter((c) => c.kind === 'repeat-cue');
        expect(plays).toHaveLength(trials * REPEAT_PLAYS);
        expect(plays.every((c) => c.kind === 'repeat-cue' && Array.isArray(c.dir))).toBe(true);
        expect(r.engine.said.some((s) => s.line.key === 'headphones.good')).toBe(true);
        expect(r.engine.cues.some((c) => c.kind === 'fanfare')).toBe(true);
        expect(savedProgress(r.store, 'ears-headphones')).toMatchObject({ passed: true, attempts: 1, successes: 1 });
        // module 0 has no flight to fly: the engine heard the lesson's own frames
        expect(r.engine.frames).toBeGreaterThan(100);
    }, 120000);

    it('control: the same lesson answered "not sure" every time is not passed (the pass is the pilot\'s, not the host\'s)', async () => {
        const r = await open('ears-headphones');
        await r.run(120000, ears(false), () => r.passed);
        expect(r.passed).toBe(false);
        expect(r.lessonEvents('attempt-fail').length).toBeGreaterThanOrEqual(1);
        expect(savedProgress(r.store, 'ears-headphones')).toMatchObject({ passed: false, successes: 0 });
        expect(savedProgress(r.store, 'ears-headphones')!.attempts).toBeGreaterThanOrEqual(1);
    }, 120000);

    it('module 1, hover-height: up into the 2 to 3 m band and held 20 s, passed with r counted attempts in total', async () => {
        const r = await open('hover-height');
        const need = getLesson('hover-height').pass.required;
        await r.run(600000, hover, () => r.passed);
        expect(r.passed).toBe(true);
        expect(r.lessonEvents('attempt-pass')).toHaveLength(need);
        expect(savedProgress(r.store, 'hover-height')).toMatchObject({ passed: true });
        expect(r.of('goal').filter((g) => g.what === 'met').length).toBeGreaterThanOrEqual(need);
        // auto-armed with no switch, height held within the band the rest of the time
        expect(r.last!.armed).toBe(true);
        expect(r.pos[1]).toBeGreaterThan(1.9);
        expect(r.pos[1]).toBeLessThan(3.1);
    }, 180000);

    it('control: a pilot who never touches a stick in hover-height is not passed (the motors never start, every attempt runs out)', async () => {
        const r = await open('hover-height');
        await r.run(200000, null, () => r.passed);
        expect(r.passed).toBe(false);
        expect(r.last!.armed).toBe(false);
        expect(r.lessonEvents('attempt-fail').length).toBeGreaterThanOrEqual(2);
    }, 120000);

    it('module 2, move-speed: a few metres of flight then a stop inside the zone, r counted', async () => {
        const r = await open('move-speed');
        const need = getLesson('move-speed').pass.required;
        await r.run(600000, moveStop, () => r.passed);
        expect(r.passed).toBe(true);
        expect(r.lessonEvents('attempt-pass')).toHaveLength(need);
        // the craft goes back to the start for each attempt: a logged life each time
        expect(r.session.lives().filter((l) => l.header.life.reason === 'manual-start').length).toBeGreaterThanOrEqual(need);
    }, 180000);

    it('module 3, walls-hall: r counted stops close to a wall (the lesson\'s stopWithinM), at most one touch each', async () => {
        const r = await open('walls-hall');
        const lesson = getLesson('walls-hall');
        const within = (lesson.goals[0] as { stopWithinM: number }).stopWithinM;
        // the craft's centre stops half a metre nearer the wall than `within`: its hull is well inside the rule
        await r.run(900000, wallsPilot(within - 0.5), () => r.passed);
        const why = JSON.stringify({ t: r.clock.t, pos: r.pos, yaw: r.yaw, speed: r.speed, touches: r.of('touch').length, ev: r.sonic.filter((e) => e.kind === 'lesson' || e.kind === 'goal').slice(-10) });
        expect(r.passed, why).toBe(true);
        expect(r.lessonEvents('attempt-pass')).toHaveLength(lesson.pass.required);
        expect(r.of('touch').length).toBeLessThanOrEqual(2);
        expect(savedProgress(r.store, 'walls-hall')).toMatchObject({ passed: true });
        // the lesson's layers reached the engine (v0.13: safety, height, room and the voice; M41-10, never silence)
        const want = lesson.layers.on;
        expect(want).toContain('safety');
        expect(r.engine.layers.some((l) => l.on.length === want.length && want.every((x) => l.on.includes(x)))).toBe(true);
    }, 300000);

    it('module 4, corridor: the whole corridor through its bends, obstacles and jogs to its end, with at most two touches, passed in r counted attempts', async () => {
        const r = await open('corridor');
        const lesson = getLesson('corridor');
        await r.run(2400000, corridor, () => r.passed);
        const touches = r.of('touch').length;
        expect(r.passed, `touches ${touches}, attempts ${r.lessonEvents('attempt-start').length}, events ${JSON.stringify(r.sonic.filter((e) => e.kind === 'lesson' || e.kind === 'goal').slice(-8))}`).toBe(true);
        expect(r.lessonEvents('attempt-pass')).toHaveLength(lesson.pass.required);
        // at most two touches an attempt, and a restart of the attempt (back to the start, on the respawn platform) is not one
        expect(touches).toBeLessThanOrEqual(2);
        // a touch in a corridor puts the craft back near the crash (M41-20): before the last point of the world's track passed,
        // named w1 .. wN after the world's checkpoint list, and the lesson goes on from there
        const points = (r.world as unknown as { checkpoints?: readonly unknown[] }).checkpoints ?? [];
        expect(points.length).toBeGreaterThan(0);
        const resets = r.of('reset');
        const back = resets.filter((e) => e.to === 'checkpoint');
        expect(back.length > 0).toBe(touches > 0);
        for (const e of back) {
            expect(e.checkpointId).toMatch(/^w[0-9]+$/);
            expect(Number(e.checkpointId!.slice(1))).toBeLessThanOrEqual(points.length);
        }
        expect(resets.filter((e) => e.to === 'start').length).toBeGreaterThanOrEqual(1);
        // the checkpoints of the corridor were reached in order, the last at its end
        const cps = r.of('checkpoint').map((c) => c.id);
        for (const id of lesson.checkpoints.map((c) => c.id)) expect(cps).toContain(id);
    }, 600000);

    it('module 5, rings-first: through the ring r times, back to the start each time', async () => {
        const r = await open('rings-first');
        await r.run(900000, throughTheGate, () => r.passed);
        expect(r.passed).toBe(true);
        expect(r.of('gate')).toHaveLength(getLesson('rings-first').pass.required);
        expect(r.of('gate').every((g) => g.gateId === 'ring-1' && g.missM < 1.5)).toBe(true);
        // the helper's view was drawn for this world with the ring in it, and the ring was the lit target
        expect(r.shown.at(-1)!.ids).toContain('ring-1');
        expect(r.stage.target === 'ring-1' || r.stage.target === null).toBe(true);
        expect(r.engine.inputs.some((i) => i.target?.id === 'ring-1')).toBe(true);
    }, 300000);

    it('control: a pilot who flies at the wrong height misses the ring and is not passed', async () => {
        const r = await open('rings-first');
        // v0.13: the room is 5.2 m high and the ring 5.5 m ahead, so a climb toward 7 m on the way crossed it inside; the
        // pilot goes under the ring instead (the world's ring), and does fly past it there
        const wrong = underTheRing(r);
        await r.run(400000, wrong.pilot, () => r.passed);
        expect(wrong.under()).toBe(true);
        expect(r.passed).toBe(false);
        expect(r.of('gate')).toHaveLength(0);
        expect(r.lessonEvents('attempt-fail').length).toBeGreaterThanOrEqual(2);
    }, 120000);

    it('module 6, shapes-square: through the square, two of three (a lesson that never blocks)', async () => {
        const r = await open('shapes-square');
        await r.run(600000, throughTheGate, () => r.passed);
        expect(r.passed).toBe(true);
        expect(r.of('gate').length).toBeGreaterThanOrEqual(2);
        expect(r.shown.at(-1)!.ids).toContain('square-1');
    }, 180000);
});

// ------------------------------------------------------------------ what the host does around a lesson

describe('the host around a lesson', () => {
    it('opens the next lesson of the pilot\'s path after a pass, swapping the world only when it differs', async () => {
        // hover-height (full path: hover-turn next, another world; fast path: walls-hall)
        const r = await open('shapes-square');
        await r.run(600000, throughTheGate, () => r.passed);
        expect(r.passed).toBe(true);
        expect(r.swaps).toEqual([]);
        await r.run(60000, null, () => r.host.lesson?.id !== 'shapes-square');
        expect(r.host.lesson!.id).toBe('shapes-series');
        // squares in a turn: other walls than the single square: the session was swapped for them
        expect(r.swaps).toEqual(['lesson-shapes-series']);
        expect(r.of('lesson').filter((e) => e.what === 'open').map((e) => e.lessonId)).toContain('shapes-series');
        expect(savedProgress(r.store, 'shapes-square')).toMatchObject({ passed: true });
        const cur = r.store.collection('sonic').current;
        expect(cur).toBe('shapes-series');
    }, 300000);

    it('a restart is not a touch: the craft parked on the respawn platform touches nothing, a wall still does', async () => {
        const r = await open('rings-first');
        // the lesson's restart parked the craft on the invisible platform, held until the motors start; the first flying
        // intent arms them and the craft settles on the disc for a few ticks: the model reports those contacts
        expect(r.session.sim.s[S.platOn]).toBeGreaterThan(0);
        await r.run(300, throughTheGate);
        const contacts = (r.session.runner.events as unknown as { type: string }[]).filter((e) => e.type === 'contact').length;
        expect(contacts).toBeGreaterThan(0);
        // ... and none of them is a touch
        expect(r.of('touch')).toHaveLength(0);
        // control: a flight into the room's wall is a touch. Once the lesson flies (v0.13: its first attempt begins at the start,
        // so a flight made during the task is put back), and sideways to the side wall: straight on, the ring's plane ends the
        // attempt (through the ring, or under or beside it as a miss) before the front wall, and between attempts nothing is a touch
        await r.run(240000, null, () => r.host.runner!.phase === 'flying');
        await r.run(60000, () => ({ strafe: 1 }), () => r.of('touch').length > 0);
        expect(r.of('touch').length).toBeGreaterThan(0);
        expect(r.of('touch')[0]!.material).toBe('wall');
        // and off the disc (after take-off) onPlatform is false
        expect(onPlatform(r.session.sim)).toBe(false);
    }, 120000);

    it('onPlatform reads the model alone: platform on, craft over the disc and on its top: yes; beside it, above it, or the platform off: no', () => {
        const sim = (o: { on?: number; x?: number; y?: number; z?: number }) => {
            const s = new Float64Array(S.size);
            s[S.platOn] = o.on ?? 1;
            s[S.platX] = 0; s[S.platY] = 1.0; s[S.platZ] = 0; s[S.platR] = 0.4;
            s[S.px] = o.x ?? 0; s[S.py] = o.y ?? 1.0 + 0.05; s[S.pz] = o.z ?? 0;
            return { s, p: { bodyBottom: 0.05, boundRadius: 0.2 } } as never;
        };
        expect(onPlatform(sim({}))).toBe(true);
        expect(onPlatform(sim({ x: 0.5 }))).toBe(true); // within the disc's radius and the craft's own reach
        expect(onPlatform(sim({ x: 0.9 }))).toBe(false);
        expect(onPlatform(sim({ y: 1.6 }))).toBe(false);
        expect(onPlatform(sim({ on: 0 }))).toBe(false);
    });

    it('the fast path skips what it leaves out; off the path the full ladder goes on', async () => {
        const fast = lessonPaths().fast;
        expect(fast).toContain('rings-first');
        expect(fast).not.toContain('rings-line');
        const r = await open('rings-first');
        r.paths = 'fast';
        await r.run(900000, throughTheGate, () => r.passed);
        await r.run(60000, null, () => r.host.lesson?.id !== 'rings-first');
        expect(r.host.lesson!.id).toBe('rings-course');
    }, 300000);

    it('a paused flight is not stepped: the lesson waits with it and nothing is heard', async () => {
        const r = await open('rings-first');
        await r.run(20000, throughTheGate);
        const frames = r.engine.frames;
        const events = r.sonic.length;
        const t0 = r.last!.t;
        r.session.pause(true, 'menu');
        await r.run(4000, throughTheGate);
        expect(r.last!.paused).toBe(true);
        expect(r.engine.frames).toBe(frames);
        // only the session's own pause event, no lesson, goal or gate event while it waited
        expect(r.sonic.slice(events).every((e) => e.kind === 'session' || e.kind === 'speech')).toBe(true);
        r.session.pause(false, 'menu');
        await r.run(2000, throughTheGate);
        expect(r.engine.frames).toBeGreaterThan(frames);
        expect(r.last!.t).toBeGreaterThan(t0 + 5000);
    }, 120000);

    it('digits answer only a question that was asked; 0 skips it; the answer is an event with how it came', async () => {
        const r = await open('ears-headphones');
        expect(r.host.answer(1)).toBe(false);
        // run until the first question is asked and its lines are said
        await r.run(240000, null, () => r.host.asking && !r.engine.speaking);
        expect(r.host.asking).toBe(true);
        expect(r.host.answer(0)).toBe(true);
        expect(r.of('answer').at(-1)).toMatchObject({ via: 'skip', value: null });
        expect(r.host.asking).toBe(false);
    }, 120000);

    // v0.13 (stage B, B3, W5): Z is the runner's repeat, the step's whole task again (it was the bridge's last line)
    it('N skips the intro, I says where the pilot is, Z says the step\'s task again from its title, with interrupt, while the attempt waits', async () => {
        const r = await open('rings-first');
        expect(r.host.status()).toMatchObject({ key: 'status.lesson' });
        expect(r.press('scene.next')).toBe(true);
        expect(r.sonic.filter((e) => e.kind === 'key').at(-1)).toMatchObject({ code: 'KeyN', action: 'next' });
        await r.run(3000, null);
        expect(r.host.runner!.phase).toBe('flying');
        const before = r.engine.said.length;
        expect(r.press('sonic.repeat')).toBe(true);
        expect(r.sonic.filter((e) => e.kind === 'key').at(-1)).toMatchObject({ code: 'KeyZ', action: 'repeat' });
        expect(r.engine.said[before]).toMatchObject({ line: getLesson('rings-first').title, interrupt: true });
        expect(r.engine.said.length).toBeGreaterThan(before + 1);
        expect(r.host.runner!.view().listening).toBe(true);
    }, 120000);

    // v0.13 (stage B, docs/wip/v13-host.md B2, W3 and W4): N from the glossary's last step is its 'go next', which leads back to the
    // lesson G left (the runner's returnTo and the host's way back); N is pressed only while the glossary runs (a press after the way
    // back would be rings-first's own N)
    const nInGlossary: Control = (rr) => {
        if (rr.host.lesson?.id === 'ears-glossary') rr.mode.next('KeyN');
        return null;
    };

    it('G opens the sound glossary and comes back to the lesson it left', async () => {
        const r = await open('rings-first');
        await r.run(2000, null);
        expect(await r.host.glossary()).toBe(true);
        expect(r.host.lesson!.id).toBe('ears-glossary');
        const glossary = r.host.runner!;
        // N skips every line and scene of the glossary, and from its last step goes back
        await r.run(900000, nInGlossary, () => r.host.lesson?.id === 'rings-first');
        expect(r.host.lesson!.id).toBe('rings-first');
        expect(r.of('lesson').filter((e) => e.what === 'open').map((e) => e.lessonId)).toEqual(['rings-first', 'ears-glossary', 'rings-first']);
        expect(r.lessonEvents('leave').map((e) => e.lessonId)).toEqual(['ears-glossary']);
        // the glossary was heard, not skipped: a detour left forward does not mark it (review R3; the runner got returnTo)
        expect(glossary.progress().skipped).toBe(false);
    }, 300000);

    // review of v12-int, I3 (the lesson opened again when a recording starts, session.ts onStatus -> LessonHost.reopen)
    it('review I3: a recording that starts in the glossary opens it again WITH its way back: it still returns to the lesson G left, not on along the path', async () => {
        const r = await open('rings-first');
        await r.run(2000, null);
        expect(await r.host.glossary()).toBe(true);
        expect(r.host.lesson!.id).toBe('ears-glossary');
        await r.run(1500, null);
        expect(await r.host.reopen()).toBe(true);
        expect(r.host.lesson!.id).toBe('ears-glossary');
        await r.run(900000, nInGlossary, () => r.host.lesson?.id !== 'ears-glossary');
        expect(r.host.lesson!.id).toBe('rings-first');
        expect(r.of('lesson').filter((e) => e.what === 'open').map((e) => e.lessonId)).toEqual(['rings-first', 'ears-glossary', 'ears-glossary', 'rings-first']);
    }, 300000);

    // review of v12-flight, D2 (the bridge's speech count after another lesson is entered while a line is being said)
    it('review D2: G while the intro is being said: the glossary\'s speech.end markers come only when the engine has nothing left to say', async () => {
        const r = await open('rings-first');
        const ends: boolean[] = [];
        r.events.on('sonicEvent', (e) => {
            if (e.kind === 'speech' && e.key === SPEECH_END_KEY) ends.push(r.engine.speaking);
        });
        // the intro of rings-first is being said (the engine's queue is not empty)
        await r.run(10000, null, () => r.engine.speaking);
        expect(r.engine.speaking).toBe(true);
        const before = r.engine.said.length;
        expect(await r.host.glossary()).toBe(true);
        expect(r.host.lesson!.id).toBe('ears-glossary');
        expect(r.engine.said.length).toBeGreaterThan(before);
        ends.length = 0;
        // the glossary talks for a good while: every end of speech it gets is the real one (the long window is for the
        // time before review D2b, when G left the intro's lines in the queue ahead of the glossary's own)
        await r.run(300000, null, () => ends.length >= 3);
        expect(ends.length).toBeGreaterThanOrEqual(3);
        expect(ends).toEqual(ends.map(() => false));
    }, 300000);

    it('review D2 control: with no lesson left behind (no G) the same lesson\'s speech.end markers come with an empty engine queue too', async () => {
        const r = await open('ears-glossary');
        const ends: boolean[] = [];
        r.events.on('sonicEvent', (e) => {
            if (e.kind === 'speech' && e.key === SPEECH_END_KEY) ends.push(r.engine.speaking);
        });
        await r.run(60000, null, () => ends.length >= 3);
        expect(ends.length).toBeGreaterThanOrEqual(3);
        expect(ends).toEqual(ends.map(() => false));
    }, 300000);

    // review of v12-flight, D2b: entering another lesson (G, a lesson chosen on the start screen) while the lesson left is still
    // talking: the new lesson's lines queued behind the old ones (the probe: about a minute of the old intro first)
    it('review D2b: G while the intro is being said cuts it: the glossary\'s first line interrupts and its own intro is what is heard next', async () => {
        const r = await open('rings-first');
        await r.run(10000, null, () => r.engine.speaking);
        expect(r.engine.speaking).toBe(true);
        const before = r.engine.said.length;
        const t0 = r.clock.t;
        expect(await r.host.glossary()).toBe(true);
        const mine = r.engine.said.slice(before);
        expect(mine.length).toBeGreaterThan(1);
        expect(mine[0]).toMatchObject({ line: { key: 'lesson.ears-glossary.title' }, interrupt: true });
        expect(mine.slice(1).every((s) => !s.interrupt)).toBe(true);
        // so the glossary speaks next: its first end of speech comes when its own lines are said (a clean open: 12.9 s of page time)
        let firstEnd: number | null = null;
        r.events.on('sonicEvent', (e) => {
            if (firstEnd === null && e.kind === 'speech' && e.key === SPEECH_END_KEY) firstEnd = r.clock.t - t0;
        });
        await r.run(120000, null, () => firstEnd !== null);
        expect(firstEnd).not.toBeNull();
        expect(firstEnd as unknown as number).toBeLessThan(20000);
    }, 300000);

    it('review D2b control: a lesson opened while nothing is being said queues its lines (no interrupt), as after a pass or from the menu', async () => {
        const r = await open('ears-glossary');
        expect(r.engine.said.length).toBeGreaterThan(1);
        expect(r.engine.said.every((s) => !s.interrupt)).toBe(true);
        // and the same when the lesson left had finished talking
        await r.run(300000, null, () => !r.engine.speaking && r.host.runner!.phase !== 'intro');
        const before = r.engine.said.length;
        expect(await r.host.open('rings-first')).toBe(true);
        const mine = r.engine.said.slice(before);
        expect(mine.length).toBeGreaterThan(1);
        expect(mine.every((s) => !s.interrupt)).toBe(true);
    }, 300000);

    it('progress is saved at every attempt, not only at the pass', async () => {
        const r = await open('rings-first');
        // one counted attempt short of the pass (r counted pass the lesson, format 2)
        const before = getLesson('rings-first').pass.required - 1;
        expect(before).toBeGreaterThanOrEqual(1);
        await r.run(900000, throughTheGate, () => r.lessonEvents('attempt-pass').length >= before);
        const p = savedProgress(r.store, 'rings-first')!;
        expect(p.successes).toBeGreaterThanOrEqual(before);
        expect(p.passed).toBe(false);
        expect(p.attempts).toBe(r.lessonEvents('attempt-pass').length + r.lessonEvents('attempt-fail').length);
    }, 300000);

    it('a scan lesson on a page that flies no scan is refused and leaves the lesson running as it was', async () => {
        const r = await open('rings-first');
        expect(await r.host.open('free-garden')).toBe(false);
        expect(r.host.lesson!.id).toBe('rings-first');
        await expect(r.host.open('no-such-lesson')).resolves.toBe(false);
    }, 60000);
});

// ------------------------------------------------------------------ a recorded lesson re-derives

describe('a lesson flown through the host passes the sound package\'s replay check', () => {
    it('rings-first, three attempts with N and a reset: every event re-derived, the cues of the frames agree', async () => {
        const r = await open('rings-first');
        const frames: FlightFrame[] = [];
        let n = 0;
        const record: Control = (rr) => {
            const s = rr.last;
            if (s && rr.engine.lastInput && ++n % 2 === 0 && !s.paused) {
                frames.push({ t: s.t, tick: s.tick, p: s.pos, v: s.vel, q: s.quat, s: s.sticks, c: rr.engine.activeCues().map((c) => c.id) });
            }
            return throughTheGate(rr);
        };
        // the pilot presses N while the intro is spoken, flies two gates, and presses R a second into the third attempt
        await r.run(1200, record);
        r.mode.next('KeyN');
        await r.run(80000, record, () => r.lessonEvents('attempt-start').length >= 3);
        await r.run(1500, record);
        r.mode.resetTo('checkpoint', 'KeyR');
        await r.run(60000, record, () => r.lessonEvents('attempt-pass').length >= 3);
        // the recording goes on a little after the last event: a replay derives an event at the first recorded frame after it
        await r.run(600, record);
        const manifest = buildManifest({
            id: 'hostSession0000001',
            created: '2026-11-07T10:00:00Z',
            app: { name: 'ShramkoGSFPV', release: 'test', sonic: 'test' },
            scene: { kind: 'analytic', id: r.world.id, version: r.world.version, transform: [1, 0, 0, 0] },
            lesson: { id: 'rings-first', version: 1, path: 'full' },
            theme: { id: 'soft', version: getBuiltinTheme('soft').version },
            settings: defaultPrefs(),
            assists: getLesson('rings-first').assists,
            device: { userAgent: 'vitest', locale: 'en', audio: { sampleRate: 48000, baseLatencyMs: null, outputLatencyMs: null }, input: 'keyboard', inputName: null, headphones: 'wired', gpu: null },
            consent: { recording: true, voice: false, send: false, speechRecognition: false, minor: false, guardianConfirmed: null, at: '2026-11-07T10:00:00Z' },
            pilot: { id: 'testPilot01', nickname: null },
            clock: { startIso: '2026-11-07T10:00:00Z', frameHz: 30 }
        });
        const { check } = checkSession({ manifest, frames, events: r.sonic });
        expect(check.events.diffs).toEqual([]);
        expect(check.ok, JSON.stringify({ notes: check.notes, cues: check.cues, frames: frames.length })).toBe(true);
        expect(r.of('gate').length).toBeGreaterThanOrEqual(3);
        // control: without the host's markers (N, R) the same recording does not re-derive
        const bare = checkSession({ manifest, frames, events: r.sonic.filter((e) => e.kind !== 'key') });
        expect(bare.check.ok).toBe(false);
    }, 300000);
});
