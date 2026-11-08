// v0.13 lane v13-look L1-1 (docs/wip/v13-look.md; plan M41-19, the owner's message 41: "when we fly around a pillar and
// bump into it, we somehow stick to it ... it is very hard to fly away from it"): no sticking in the lesson worlds.
//
// The page's own loop in Node: a scripted RC radio (frames every 4 ms through the real Controls and its mapping), the lesson
// pilot in Controls.assist (play/lesson-pilot.ts: velocity control, altitude hold), the real arm gate, and the real Sim at
// 1 kHz on a lesson world's walls with that world's own flight rules (lesson-world.ts LESSON_FLIGHT: sim-core BumpRule
// 'slide'). The craft is flown into a surface: a wall, a pillar, the ceiling (from a run-up, the stick held toward it) and the
// floor (thrown at it: the lesson pilot never sinks fast near the ground), at 0 to 85 degrees from the surface's normal and
// 1 to 5 m/s. At the first contact (or after 1 s more of pressing into it) the stick is let go or pointed away from the
// surface, and the probe asks: from when on is the craft out of contact, at least OUT_GAP_M off every surface with no
// contact after it, for the rest of the watch (OUT_WATCH_S, or until it is LEFT_M away). Wanted: within OUT_WITHIN_S.
//   - no tunnelling: on every tick no sphere of the body overlaps the walls by more than PEN_MAX_M, thin walls included
//     (a ring's tube of 0.2 m and a square gate's bar of 0.15 m at 5 m/s);
//   - control: the same flights with the v0.12 response (the drone's own contact, the pilot that never hears a bump) stick:
//     the pillar keeps the craft past OUT_WITHIN_S in most of its cases (a 3 m/s hit spun it at 41 rad/s, its top to the
//     pillar, pinned there for 2 s with the stick pointed away), and the probe fails them.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { S, Sim } from '../../../packages/sim-core/src';
import type { ContactWorld, ParamOverrides } from '../../../packages/sim-core/src';
import type { VoxelContactWorld } from '../../../packages/collision/src';
import type { RawFrame, Profile } from '../../../packages/input/src';
import { getLesson } from '../../../packages/sonic-fpv/src';
import type { LessonAssists, LessonDef } from '../../../packages/sonic-fpv/src';
import { FakeStorage } from '../../../packages/prefs/test/helpers';
import { LESSON_FLIGHT, lessonWorldOf } from '../../../apps/fly/src/sonic/lesson-world';
import type { LessonWorld } from '../../../apps/fly/src/sonic/lesson-world';
import { params } from './game-loop';

type AppControls = typeof import('../../../apps/fly/src/controls');
type Pilot = typeof import('../../../apps/fly/src/play/lesson-pilot');

let C: AppControls, LP: Pilot;
const doc = { cookie: '', documentElement: { lang: '' }, visibilityState: 'visible' };

beforeAll(async () => {
    vi.stubGlobal('location', { search: '', pathname: '/fly/', href: 'http://127.0.0.1/fly/', origin: 'http://127.0.0.1' });
    vi.stubGlobal('document', doc);
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    vi.stubGlobal('localStorage', new FakeStorage());
    C = await import('../../../apps/fly/src/controls');
    LP = await import('../../../apps/fly/src/play/lesson-pilot');
});
afterEach(() => { vi.restoreAllMocks(); });

/** Out of contact: at least this far off every surface ... */
const OUT_GAP_M = 0.02;
/** ... with no contact after it, for this long after the stick moved (or until LEFT_M off every surface) ... */
const OUT_WATCH_S = 1;
const LEFT_M = 0.25;
/** ... from no later than this after the stick moved (M41-19). */
const OUT_WITHIN_S = 0.3;
/** No sphere of the body overlaps the walls by more than this on any tick (no tunnelling). */
const PEN_MAX_M = 0.005;
/** Pressing into the surface before the stick moves, in the 'press' cases, s (longer slides a 5 m/s craft into the next wall). */
const PRESS_S = 0.5;

/** A TX16S as the setup wizard saves it (sonic-pilot.test.ts): axes 0..3 sticks, the arm switch on axis 4 (never moved). */
const TX16S: Profile = {
    version: 1, deviceKey: 'hid:1209:4f54:Radiomaster TX16S Joystick:19', deviceName: 'Radiomaster TX16S Joystick', deadband: 0, created: '2026-09-26T19:44:02.118Z', mode: 2, wizard: 2,
    axes: { roll: { index: 0, invert: false, center: 0.004, min: -0.999, max: 0.999 }, pitch: { index: 1, invert: false, center: -0.002, min: -0.999, max: 0.999 }, throttle: { index: 2, invert: false, center: -0.999, min: -0.999, max: 0.999 }, yaw: { index: 3, invert: false, center: 0.001, min: -0.999, max: 0.999 } },
    arm: { kind: 'axis', index: 4, threshold: 0.4985, onAbove: true, off: -0.999, on: 0.999 }, angleMode: null
} as unknown as Profile;

/** The page around the model: the Sim at 1 kHz, the radio's frames every 4 ms through Controls, a frame tick every 16 ms. */
class Rig {
    readonly sim: Sim;
    readonly controls: InstanceType<AppControls['Controls']>;
    t = 0;
    /** roll, pitch, yaw -1..1; throttle -1 (bottom) .. 1 (top), 0 = the middle (hold) */
    sticks = { roll: 0, pitch: 0, thr: 0, yaw: 0 };
    /** contacts off the respawn platform: tick and the speed it came in at */
    contacts: { t: number; speed: number }[] = [];
    /** the deepest overlap of a sphere with the walls seen on any tick, m */
    maxPen = 0;
    private pending: Float32Array | null = null;

    /** the walls' own contact world, which the probe's measures ask (the flight may fly another: the detector's control) */
    private readonly walls: VoxelContactWorld;

    constructor(readonly w: LessonWorld, assists: LessonAssists, overrides: ParamOverrides, at: readonly [number, number, number, number], flown?: ContactWorld) {
        this.walls = w.builtin.contact!;
        this.sim = new Sim(params('pavo20pro-3s', { crashOn: false, ...overrides }), flown ?? this.walls);
        this.sim.reset(at[0], at[1], at[2], at[3], { platform: true });
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const rig = this;
        const session = { get sim() { return rig.sim; }, paused: false, input: (ch: ArrayLike<number>) => { rig.pending = Float32Array.from(ch); }, beforeStep: null };
        this.controls = new C.Controls(session as never);
        this.controls.setProfile(TX16S);
        this.controls.source = 'hid';
        const pilot = new LP.LessonPilot({ sim: () => this.sim, paused: () => false, ground: (sim) => LP.rayClearance(this.w.collision, sim) }, assists);
        this.controls.assist = (ch, out, tt) => pilot.apply(ch, out, tt);
        this.controls.forcedMode = LP.lessonMode(assists);
    }

    private frame(): RawFrame {
        const s = this.sticks;
        const ax = (v: number): number => Math.max(-1, Math.min(1, v)) * 0.999;
        return { t: this.t, axes: new Float32Array([ax(s.roll), ax(s.pitch), ax(s.thr), ax(s.yaw), -0.999, 0, 0, 0]), buttons: 0 };
    }

    step(): void {
        if (this.t % 4 === 0) this.controls.raw(this.frame());
        if (this.t % 16 === 0) this.controls.tick(this.t);
        if (this.pending) {
            this.sim.setChannels(this.pending);
            this.pending = null;
        }
        const n0 = this.sim.events.length;
        this.sim.step();
        for (let i = n0; i < this.sim.events.length; i++) {
            const e = this.sim.events[i];
            if (e.type === 'contact' && this.sim.s[S.platOn] === 0) this.contacts.push({ t: this.t, speed: e.speed });
        }
        // the page's runner keeps the model's event list short the same way (runner.ts)
        if (this.sim.events.length > 256) this.sim.events.length = 0;
        this.t++;
        this.maxPen = Math.max(this.maxPen, this.penetration());
    }

    /** The world centres of the body's spheres and their radii. */
    private spheres(): { x: number; y: number; z: number; r: number }[] {
        const s = this.sim.s, sp = this.sim.p.spheres;
        const qw = s[S.qw], qx = s[S.qx], qy = s[S.qy], qz = s[S.qz];
        const r00 = 1 - 2 * (qy * qy + qz * qz), r01 = 2 * (qx * qy - qw * qz), r02 = 2 * (qx * qz + qw * qy);
        const r10 = 2 * (qx * qy + qw * qz), r11 = 1 - 2 * (qx * qx + qz * qz), r12 = 2 * (qy * qz - qw * qx);
        const r20 = 2 * (qx * qz - qw * qy), r21 = 2 * (qy * qz + qw * qx), r22 = 1 - 2 * (qx * qx + qy * qy);
        const out: { x: number; y: number; z: number; r: number }[] = [];
        for (let i = 0; i < sp.length; i += 4) {
            const lx = sp[i], ly = sp[i + 1], lz = sp[i + 2];
            out.push({ x: s[S.px] + r00 * lx + r01 * ly + r02 * lz, y: s[S.py] + r10 * lx + r11 * ly + r12 * lz, z: s[S.pz] + r20 * lx + r21 * ly + r22 * lz, r: sp[i + 3] });
        }
        return out;
    }

    /** How deep a sphere overlaps the walls, m (0: none), to 0.5 mm (the flight's own overlap test). */
    private penetration(): number {
        const world = this.walls;
        let worst = 0;
        for (const b of this.spheres()) {
            if (!world.overlap(b.x, b.y, b.z, b.r)) continue;
            let lo = 0, hi = b.r;
            while (hi - lo > 0.0005) {
                const m = (lo + hi) / 2;
                if (world.overlap(b.x, b.y, b.z, b.r - m)) lo = m; else hi = m;
            }
            worst = Math.max(worst, hi);
        }
        return worst;
    }

    /** The gap between the body and the walls, m (0 when a sphere overlaps), to 0.5 mm, up to `cap`. */
    gap(cap = 0.5): number {
        const world = this.walls;
        let best = cap;
        for (const b of this.spheres()) {
            if (world.overlap(b.x, b.y, b.z, b.r)) return 0;
            if (!world.overlap(b.x, b.y, b.z, b.r + best)) continue;
            let lo = 0, hi = best;
            while (hi - lo > 0.0005) {
                const m = (lo + hi) / 2;
                if (world.overlap(b.x, b.y, b.z, b.r + m)) hi = m; else lo = m;
            }
            best = Math.min(best, lo);
        }
        return best;
    }
}

function rig(w: LessonWorld, assists: LessonAssists, overrides: ParamOverrides, at: readonly [number, number, number, number], flown?: ContactWorld): Rig {
    const r = new Rig(w, assists, overrides, at, flown);
    vi.spyOn(performance, 'now').mockImplementation(() => r.t);
    return r;
}

type Surface = 'wall' | 'pillar' | 'ceiling' | 'floor' | 'ring' | 'bar';
type After = 'release' | 'away' | 'press';
interface Case { surface: Surface; angleDeg: number; speed: number; after: After }
interface Outcome extends Case {
    /** the first contact's speed into the surface, m/s; null: no contact */
    hitMps: number | null;
    /** seconds from the stick's move to "out of contact" (null: not within the watch) */
    outS: number | null;
    contactsAfter: number;
    maxPenM: number;
}

const RAD = Math.PI / 180;
let WORLDS: { hall: LessonWorld; pillar: LessonWorld; rings: LessonWorld; square: LessonWorld; lessons: Record<string, LessonDef> } | null = null;
function worlds(): NonNullable<typeof WORLDS> {
    if (WORLDS) return WORLDS;
    const ids = ['walls-hall', 'walls-pillar', 'rings-first', 'shapes-square'];
    const lessons = Object.fromEntries(ids.map((id) => [id, getLesson(id)]));
    WORLDS = {
        hall: lessonWorldOf(lessons['walls-hall']!)!,
        pillar: lessonWorldOf(lessons['walls-pillar']!)!,
        rings: lessonWorldOf(lessons['rings-first']!)!,
        square: lessonWorldOf(lessons['shapes-square']!)!,
        lessons
    };
    return WORLDS;
}

/** The radio's sticks for a wish in the world (x, z on the ground, up), the craft's heading `yawDeg` (0 = -z, right +). */
function sticksFor(dx: number, dz: number, up: number, yawDeg: number): { roll: number; pitch: number; thr: number } {
    const h = yawDeg * RAD;
    // forward = (sin h, -cos h), right = (cos h, sin h)
    const f = dx * Math.sin(h) - dz * Math.cos(h);
    const r = dx * Math.cos(h) + dz * Math.sin(h);
    const n = Math.max(1, Math.hypot(f, r));
    return { roll: r / n, pitch: f / n, thr: up };
}

/**
 * One flight into a surface: where the craft starts, its heading and caps, the stick toward the surface; at the first
 * contact (after PRESS_S more in 'press') the stick moves, and the watch runs.
 */
function fly(c: Case, overrides: ParamOverrides, leaky = false): Outcome {
    const W = worlds();
    const a = c.angleDeg * RAD;
    const v = c.speed;
    let w: LessonWorld;
    let lesson: LessonDef;
    let at: [number, number, number, number];
    // the stick toward the surface (world x, z, throttle), and the surface's outward normal (for "away")
    let toward: [number, number, number];
    let away: [number, number, number];
    const caps: Partial<LessonAssists> = {};
    /** a craft thrown at the floor from just over it: its velocity (x, y, z) */
    let thrown: [number, number, number] | null = null;
    const RUN = 4; // metres of run-up
    switch (c.surface) {
        case 'wall': {
            // walls-hall's left wall, x = -5, normal +x (the room's 12 m run along it, for a slide at 5 m/s and its stop):
            // the craft at height 1.5 runs RUN m along d = (-cos a, 0, -sin a) to it, heading d
            w = W.hall; lesson = W.lessons['walls-hall']!;
            at = [-5 + 0.2 + RUN * Math.cos(a), 1.5, 5.5, a / RAD - 90];
            toward = [-Math.cos(a), -Math.sin(a), 0];
            away = [1, 0, 0];
            caps.maxSpeedMps = v;
            break;
        }
        case 'pillar': {
            // walls-pillar's pillar (radius 0.3 at x 0, z -0.75): a line along -z, off its axis so it meets the surface at a
            w = W.pillar; lesson = W.lessons['walls-pillar']!;
            const p = w.world.objects().find((o) => o.shape.kind === 'pillar')!;
            const reach = 0.3 + 0.05;
            at = [p.pos[0] + reach * Math.sin(a), 1.5, p.pos[2] + RUN, 0];
            toward = [0, -1, 0];
            // away from the pillar: along the normal where the line meets it (from the axis to the contact)
            away = [Math.sin(a), Math.cos(a), 0];
            caps.maxSpeedMps = v;
            break;
        }
        case 'ceiling': {
            // walls-hall's ceiling, y = 3.2: a climb at v cos a with v sin a along -z (the stick toward it: throttle up and
            // forward), from as far under it as the room gives (2.6 m) or less at a steep angle
            w = W.hall; lesson = W.lessons['walls-hall']!;
            const below = Math.min(2.6, 0.3 + 2.3 * Math.cos(a));
            at = [0, 3.2 - below, 5.5, 0];
            toward = [0, Math.sin(a) > 0.01 ? -1 : 0, 1];
            away = [0, 0, -1];
            caps.maxClimbMps = v * Math.cos(a);
            caps.maxSpeedMps = Math.max(0.5, v * Math.sin(a));
            break;
        }
        case 'floor': {
            // walls-hall's floor, y = 0: the lesson pilot never sinks fast near the ground (a soft touch-down), so the craft
            // is thrown at it: 5 cm over it at v along (0, -cos a, -sin a), the stick toward it (down, and forward at a slant)
            w = W.hall; lesson = W.lessons['walls-hall']!;
            at = [0, 1, 4, 0];
            toward = [0, Math.sin(a) > 0.01 ? -1 : 0, -1];
            away = [0, 0, 1];
            thrown = [0, -v * Math.cos(a), -v * Math.sin(a)];
            caps.maxSpeedMps = Math.max(0.5, v * Math.sin(a));
            break;
        }
        case 'ring': {
            // rings-first's ring (diameter 3, tube radius 0.1, centre line 1.6 m from its axis): the tube's left side at the
            // ring's own height, hit along -z at 0 or 45 degrees
            w = W.rings; lesson = W.lessons['rings-first']!;
            const ring = w.world.objects().find((o) => o.shape.kind === 'ring')!;
            const off = (0.1 + 0.05) * Math.sin(a);
            at = [ring.pos[0] - 1.6 + off, ring.pos[1], ring.pos[2] + RUN, 0];
            toward = [0, -1, 0];
            away = [Math.sin(a), Math.cos(a), 0];
            caps.maxSpeedMps = v;
            break;
        }
        case 'bar': {
            // shapes-square's left bar (0.15 m square, its centre 1.575 m left of the gate's), its front face (normal +z) at
            // the gate's height, met at a from its normal: heading a, running RUN m along d = (sin a, 0, -cos a)
            w = W.square; lesson = W.lessons['shapes-square']!;
            const sq = w.world.objects().find((o) => o.shape.kind === 'square')!;
            const zFace = sq.pos[2] + 0.075 + 0.15;
            at = [sq.pos[0] - 1.575 - RUN * Math.sin(a), sq.pos[1], zFace + RUN * Math.cos(a), c.angleDeg];
            toward = [Math.sin(a), -Math.cos(a), 0];
            away = [0, 1, 0];
            caps.maxSpeedMps = v;
            break;
        }
    }
    const assists: LessonAssists = { ...lesson.assists, ...caps };
    const r = rig(w, assists, overrides, at, leaky ? new LeakyWalls() : undefined);
    const yaw = at[3];
    const push = (d: [number, number, number]): void => {
        const st = sticksFor(d[0], d[1], d[2], yaw);
        r.sticks.roll = st.roll;
        r.sticks.pitch = st.pitch;
        r.sticks.thr = st.thr;
    };
    // the motors start (the throttle a little up until the model is armed), then the craft hovers over the platform 0.8 s
    r.sticks.thr = 0.5;
    for (let i = 0; i < 3000 && !r.sim.armed; i++) r.step();
    expect(r.sim.armed).toBe(true);
    r.sticks.thr = 0;
    for (let i = 0; i < 800; i++) r.step();
    r.contacts.length = 0;
    push(toward);
    if (thrown) {
        // 5 cm over the floor, off the platform, thrown
        const s = r.sim.s;
        s[S.platOn] = 0;
        s[S.py] = r.sim.p.bodyBottom + 0.05;
        s[S.vx] = thrown[0];
        s[S.vy] = thrown[1];
        s[S.vz] = thrown[2];
    }
    let hit = -1;
    for (let i = 0; i < 8000 && hit < 0; i++) {
        r.step();
        if (r.contacts.length > 0) hit = r.t;
    }
    if (hit < 0) return { ...c, hitMps: null, outS: null, contactsAfter: 0, maxPenM: r.maxPen };
    const hitMps = r.contacts[0]!.speed;
    if (c.after === 'press') for (let i = 0; i < PRESS_S * 1000; i++) r.step();
    const t0 = r.t;
    const n0 = r.contacts.length;
    if (c.after === 'away') push(away);
    else {
        r.sticks.roll = 0;
        r.sticks.pitch = 0;
        r.sticks.thr = 0;
    }
    let outAt: number | null = null;
    for (let i = 0; i < OUT_WATCH_S * 1000; i++) {
        r.step();
        const g = r.gap(LEFT_M);
        const touched = r.contacts.length > n0 && r.contacts[r.contacts.length - 1]!.t === r.t - 1;
        if (g < OUT_GAP_M || touched) outAt = null;
        else if (outAt === null) outAt = r.t;
        // clearly away from every surface: the craft left (what it meets later is another bump)
        if (g >= LEFT_M) break;
    }
    return { ...c, hitMps, outS: outAt === null ? null : (outAt - t0) / 1000, contactsAfter: r.contacts.length - n0, maxPenM: r.maxPen };
}

/** The tunnelling detector's control: walls the flight model never meets (it flies through them). */
class LeakyWalls implements ContactWorld {
    sweep(): number {
        return -1;
    }

    pushOut(): boolean {
        return false;
    }
}

const SPEEDS = [1, 2, 3, 4, 5];
const ANGLES = [0, 30, 60, 85];
const MAIN: Surface[] = ['wall', 'pillar', 'ceiling', 'floor'];

function cases(surfaces: readonly Surface[], afters: readonly After[], angles = ANGLES, speeds = SPEEDS): Case[] {
    const out: Case[] = [];
    for (const surface of surfaces) {
        for (const after of afters) {
            // pressing into the floor is how a lesson lands: the craft rests there by design
            if (surface === 'floor' && after === 'press') continue;
            for (const angleDeg of angles) for (const speed of speeds) out.push({ surface, angleDeg, speed, after });
        }
    }
    return out;
}

const label = (o: Outcome): string => `${o.surface} ${o.angleDeg} deg ${o.speed} m/s ${o.after}`;
const passed = (o: Outcome): boolean => o.hitMps !== null && o.outS !== null && o.outS <= OUT_WITHIN_S;

describe('M41-19: a bump in a lesson world pushes the craft out; it never sticks', () => {
    it(`walls, pillars, ceiling, floor at 0-85 deg and 1-5 m/s: out of contact (>= ${OUT_GAP_M * 100} cm, no contact after) within ${OUT_WITHIN_S} s with the stick let go, pointed away, or after pressing ${PRESS_S} s`, () => {
        const all = cases(MAIN, ['release', 'away', 'press']).map((c) => fly(c, LESSON_FLIGHT));
        const missed = all.filter((o) => o.hitMps === null);
        const bad = all.filter((o) => o.hitMps !== null && !passed(o));
        const worst = Math.max(...all.filter((o) => o.outS !== null).map((o) => o.outS!));
        const pen = Math.max(...all.map((o) => o.maxPenM));
        const hits = all.filter((o) => o.hitMps !== null).map((o) => o.hitMps!);
        console.log(`sonic-bump: ${all.length} flights, ${all.length - missed.length} hits at ${Math.min(...hits).toFixed(2)} to ${Math.max(...hits).toFixed(2)} m/s into the surface; out of contact after at most ${worst.toFixed(3)} s; deepest overlap ${(pen * 1000).toFixed(1)} mm`);
        for (const o of bad) console.log(`  STUCK ${label(o)}: hit ${o.hitMps?.toFixed(2)} m/s, out ${o.outS === null ? 'never' : `${o.outS.toFixed(3)} s`}, ${o.contactsAfter} contacts after`);
        expect(missed.map(label)).toEqual([]);
        expect(bad.map(label)).toEqual([]);
        expect(pen).toBeLessThanOrEqual(PEN_MAX_M);
    });

    it('thin walls (a ring\'s tube, a square gate\'s bar) at 1-5 m/s: the craft bounces off, never through, and gets out', () => {
        const all = cases(['ring', 'bar'], ['release', 'away'], [0, 45], [1, 3, 5]).map((c) => fly(c, LESSON_FLIGHT));
        const pen = Math.max(...all.map((o) => o.maxPenM));
        console.log(`sonic-bump thin walls: ${all.length} flights, hits ${all.filter((o) => o.hitMps !== null).length}, deepest overlap ${(pen * 1000).toFixed(1)} mm, out after at most ${Math.max(...all.map((o) => o.outS ?? Infinity)).toFixed(3)} s`);
        expect(all.filter((o) => o.hitMps === null).map(label)).toEqual([]);
        expect(all.filter((o) => !passed(o)).map(label)).toEqual([]);
        expect(pen).toBeLessThanOrEqual(PEN_MAX_M);
    });

    it('control of the tunnelling detector: walls the flight model flies through are caught (5 m/s into the bar)', () => {
        const o = fly({ surface: 'bar', angleDeg: 0, speed: 5, after: 'release' }, LESSON_FLIGHT, true);
        console.log(`sonic-bump detector control: deepest overlap ${(o.maxPenM * 1000).toFixed(1)} mm`);
        expect(o.maxPenM).toBeGreaterThan(PEN_MAX_M);
    });

    it('control: the v0.12 response (the drone\'s own contact, a pilot that never hears a bump) sticks to the pillar and fails the probe', () => {
        const all = cases(['pillar'], ['release', 'away', 'press']).map((c) => fly(c, {}));
        const stuck = all.filter((o) => o.hitMps !== null && !passed(o));
        console.log(`sonic-bump control (v0.12 response): pillar ${stuck.length} of ${all.length} flights stuck past ${OUT_WITHIN_S} s`);
        expect(stuck.length).toBeGreaterThan(all.length / 2);
        // the owner's case: a pillar hit at 3 m/s, the stick pointed away: still on the pillar
        expect(stuck.map(label)).toContain('pillar 0 deg 3 m/s away');
    });

    it('a lesson still lands: the stick held down over walls-hall\'s floor sets the craft down and the motors stop (a floor bump lifts only a craft let go)', () => {
        const W = worlds();
        const lesson = W.lessons['walls-hall']!;
        const r = rig(W.hall, lesson.assists, LESSON_FLIGHT, [0, 1.5, 0, 0]);
        r.sticks.thr = 0.5;
        for (let i = 0; i < 3000 && !r.sim.armed; i++) r.step();
        expect(r.sim.armed).toBe(true);
        // off the respawn platform first (it carries a craft that sinks over it), then let go, then the stick down
        r.sticks.thr = 0;
        r.sticks.pitch = 0.5;
        for (let i = 0; i < 1500; i++) r.step();
        r.sticks.pitch = 0;
        for (let i = 0; i < 1500; i++) r.step();
        expect(r.sim.s[S.platOn]).toBe(0);
        r.sticks.thr = -1;
        const t0 = r.t;
        let downAt = -1;
        for (let i = 0; i < 8000 && downAt < 0; i++) {
            r.step();
            if (!r.sim.armed) downAt = r.t;
        }
        console.log(`sonic-bump landing: motors stopped ${downAt < 0 ? 'never' : `${((downAt - t0) / 1000).toFixed(2)} s after the stick went down`}, ${r.contacts.length} contacts, height ${(r.sim.s[S.py] - r.sim.p.bodyBottom).toFixed(3)} m`);
        expect(downAt).toBeGreaterThan(0);
        expect(r.sim.s[S.py] - r.sim.p.bodyBottom).toBeLessThan(0.05);
    });
});
