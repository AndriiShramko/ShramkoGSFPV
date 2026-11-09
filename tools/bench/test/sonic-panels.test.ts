// v0.13 lane v13-look L2-1 to L2-3 (docs/wip/v13-look.md; plan M41-24, M41-25; the sound package's merge review W14): the mode's
// attitude display and sound panel on paper, before the page (apps/fly/src/sonic/attitude.ts, sound-panel.ts, look-prefs.ts; the
// page proofs are tools/bench/src/v13-look-page.ts panels | layout).
//   - the attitude display's horizon is the craft body's (an attitude indicator): for attitudes the flight model reports (sim-core
//     attitude() of a body turned by a known pitch and roll), two points of the world's horizon projected by a camera along the body's
//     -z at that attitude lie on a line with the display's tilt and on the display's side of the centre (a right roll lifts the
//     horizon's right end; a nose down lifts the horizon); control in the test: the roll's sign turned is caught. The FPV camera of
//     the view is tilted up by the drone's uptilt (20 degrees on the default drone): it sees the level horizon that far under its
//     centre, the dial through its own (v13-int review F6, kept as a true attitude indicator);
//   - the tape: the floor at the bottom, the room's top at the top, the craft, the band and the height to fly at where they are;
//     the climb arrow up for a climb, down for a sink, none at a standstill, longer the faster;
//   - every line and mark of both panels at least 4.5:1 against what it lies on, in a dark page and a light one;
//   - every cue the package can name has a kind; the radar's places: a wall on the left on the left, the ceiling over the craft at
//     the top of the height bar, a cue rising 45 degrees marked above, the open way over a block marked above by the plan's side;
//     with the real planner (walls-pillar, tunnel-gaps, rings-heights): the pillar ahead, the open way above block 1, the target
//     note at the next ring's height; control: the same open way without the plan's side has no mark;
//   - (v13-int step 2, the package at s13-int) real elevations: with SonicPrefs.heightDirection on, tunnel-gaps' open way above is
//     marked above by the chime's own direction (the middle of the way), off by the plan's side (control: no side, no mark); the
//     target note is on the radar at plan.height.target.dir, marked above or below by it, and with the setting off on the bar alone;
//   - the sound a step plays three times has its glossary name in en, es, pl and ru (the package's own words, not a fallback);
//   - the two switches: on by default, saved, read back by a new store on the same storage, a value that is not a boolean dropped;
//   - the panels' words come with the mode's chunk, never with an ordinary page's (the namespace soniclook).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { S, attitude } from '../../../packages/sim-core/src';
import { CuePlanner, DICTS, SHIPPED_LESSON_IDS, createAnalyticWorld, createTranslator, defaultPrefs, getBuiltinTheme, getLesson } from '../../../packages/sonic-fpv/src';
import type { ActiveCue, AnalyticWorldInfo, FlightSample, FreeWay, Quat, Vec3 } from '../../../packages/sonic-fpv/src';
import { MARK_CONTRAST, attitudeLayout, attitudePairs, climbArrow, horizonOf, tapeOf } from '../../../apps/fly/src/sonic/attitude';
import type { AttitudeState } from '../../../apps/fly/src/sonic/attitude';
import { ELEVATION_SIN, RADAR_KINDS, TARGET_NOTE_ID, cueKind, heightBar, placeDiscs, radarItems, radiusOf, soundLayout, soundPairs } from '../../../apps/fly/src/sonic/sound-panel';
import { LOOK_PANELS, panelOn, setPanel } from '../../../apps/fly/src/sonic/look-prefs';
import { MemoryBackend, validateCollection } from '../../../packages/prefs/src';
import { mkStore } from '../../../packages/prefs/test/helpers';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DEG = Math.PI / 180;

// ------------------------------------------------------------------ quaternions (w, x, y, z), sim-core's frame: x right, y up, z back

const axisAngle = (ax: Vec3, deg: number): Quat => {
    const h = (deg * DEG) / 2;
    return [Math.cos(h), ax[0] * Math.sin(h), ax[1] * Math.sin(h), ax[2] * Math.sin(h)];
};
const mul = (a: Quat, b: Quat): Quat => [
    a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
    a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
    a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0]
];
/** v in the body's frame for a body turned by q (q^-1 v q). */
const toBody = (q: Quat, v: Vec3): Vec3 => {
    const [w, x, y, z] = q;
    // the rotation matrix of q, transposed
    const r = [
        [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
        [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
        [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)]
    ];
    return [r[0]![0]! * v[0] + r[1]![0]! * v[1] + r[2]![0]! * v[2], r[0]![1]! * v[0] + r[1]![1]! * v[1] + r[2]![1]! * v[2], r[0]![2]! * v[0] + r[1]![2]! * v[1] + r[2]![2]! * v[2]];
};

/** A body with yaw, then a nose up (pitchUp > 0) about its right axis, then a right roll (rollRight > 0: right side down) about its nose. */
function bodyQuat(yawDeg: number, pitchUp: number, rollRight: number): Quat {
    const yaw = axisAngle([0, 1, 0], -yawDeg); // a right turn is a negative turn about +y
    const pitch = axisAngle([1, 0, 0], pitchUp); // +x turns the nose (-z) up
    const roll = axisAngle([0, 0, 1], -rollRight); // about +z (back) a right side down is negative
    return mul(mul(yaw, pitch), roll);
}

function simState(q: Quat): Float64Array {
    const s = new Float64Array(80);
    s[S.qw] = q[0];
    s[S.qx] = q[1];
    s[S.qy] = q[2];
    s[S.qz] = q[3];
    return s;
}

/**
 * The world's horizon as a camera on the craft sees it: looking along -z of the body, tilted up by `uptiltDeg` (the FPV camera's uptilt;
 * 0: the body's own axis): its tilt (screen degrees, y down) and its lift toward the sky (degrees).
 */
function cameraHorizon(q: Quat, yawDeg: number, n: readonly [number, number], uptiltDeg = 0): { tiltDeg: number; liftDeg: number } {
    const u = uptiltDeg * DEG;
    const pt = (az: number): [number, number] => {
        const a = (yawDeg + az) * DEG;
        const b = toBody(q, [Math.sin(a), 0, -Math.cos(a)]);
        // the camera's axes in the body: forward (0, sin u, -cos u), up (0, cos u, sin u), right (1, 0, 0)
        const fwd = b[1] * Math.sin(u) - b[2] * Math.cos(u);
        const up = b[1] * Math.cos(u) + b[2] * Math.sin(u);
        return [b[0] / fwd, -up / fwd];
    };
    const p1 = pt(-8), p2 = pt(8);
    const dx = p2[0] - p1[0], dy = p2[1] - p1[1];
    const len = Math.hypot(dx, dy);
    const ux = dx / len, uy = dy / len;
    // the point of the line nearest the centre, along the display's normal toward the sky
    const k = -(p1[0] * ux + p1[1] * uy);
    const cx = p1[0] + ux * k, cy = p1[1] + uy * k;
    return { tiltDeg: Math.atan2(dy, dx) / DEG, liftDeg: Math.atan(cx * n[0] + cy * n[1]) / DEG };
}

const level: AttitudeState = { rollDeg: 0, pitchDeg: 0, heightM: 1.5, vyMps: 0, bandM: null, targetM: null, roomM: 3.2 };

describe('the attitude display (M41-24)', () => {
    const layout = attitudeLayout(1.62 * 216, 216);

    it('level: the horizon through the dial\'s centre, flat, the sky above it, the sky pointer at the top', () => {
        const hz = horizonOf(level, layout.dial);
        expect(hz.centre[0]).toBeCloseTo(layout.dial.cx, 6);
        expect(hz.centre[1]).toBeCloseTo(layout.dial.cy, 6);
        expect(hz.u[0]).toBeCloseTo(1, 9);
        expect(hz.u[1]).toBeCloseTo(0, 9);
        expect(hz.n[1]).toBeCloseTo(-1, 9);
        expect(hz.pointer[1]).toBeCloseTo(layout.dial.cy - layout.dial.r, 6);
    });

    it('the horizon is the one a camera along the body\'s axis sees: tilt and lift for pitches and rolls the flight model reports', () => {
        const cases: [number, number, number][] = [];
        for (const yaw of [0, 37, -120]) for (const up of [-25, -10, 0, 10, 25]) for (const right of [-45, -20, 0, 20, 45]) cases.push([yaw, up, right]);
        let worst = { tilt: 0, lift: 0 };
        for (const [yaw, up, right] of cases) {
            const q = bodyQuat(yaw, up, right);
            const a = attitude(simState(q));
            // the flight model's own reading: nose below the horizon positive, right side below positive
            expect(a.pitch).toBeCloseTo(-up, 6);
            expect(a.roll).toBeCloseTo(right, 6);
            const hz = horizonOf({ rollDeg: a.roll, pitchDeg: a.pitch }, layout.dial);
            const cam = cameraHorizon(q, a.yaw, hz.n);
            const tilt = Math.atan2(hz.u[1], hz.u[0]) / DEG;
            // the display's lift is linear in pitch (PITCH_SPAN_DEG to the rim); the camera's is the pitch itself
            const lift = (Math.hypot(hz.centre[0] - layout.dial.cx, hz.centre[1] - layout.dial.cy) / hz.pxPerDeg) * Math.sign((hz.centre[0] - layout.dial.cx) * hz.n[0] + (hz.centre[1] - layout.dial.cy) * hz.n[1]);
            worst = { tilt: Math.max(worst.tilt, Math.abs(tilt - cam.tiltDeg)), lift: Math.max(worst.lift, Math.abs(lift - cam.liftDeg)) };
        }
        console.log(`sonic-panels: horizon against the camera, ${cases.length} attitudes, worst tilt ${worst.tilt.toFixed(4)} deg, worst lift ${worst.lift.toFixed(4)} deg`);
        expect(worst.tilt).toBeLessThan(0.01);
        expect(worst.lift).toBeLessThan(0.01);
    });

    it('v13-int review F6: the dial is the craft body\'s attitude, not the FPV camera\'s view: level, it draws the horizon through its centre, while the default drone\'s camera, tilted up 20 degrees, sees it 20 degrees under its centre (kept: a true attitude indicator)', () => {
        const preset = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../../packages/sim-core/presets/pavo20pro-3s.json'), 'utf8')) as { fields: { camera_uptilt_deg: { value: number } } };
        const uptilt = preset.fields.camera_uptilt_deg.value;
        expect(uptilt).toBe(20);
        for (const up of [0, -20, 10]) {
            const q = bodyQuat(0, up, 0);
            const a = attitude(simState(q));
            const hz = horizonOf({ rollDeg: a.roll, pitchDeg: a.pitch }, layout.dial);
            const lift = ((layout.dial.cy - hz.centre[1]) / hz.pxPerDeg) * Math.sign(-hz.n[1]);
            // the dial: the body's pitch (a nose up of 10 degrees moves the horizon 10 degrees down the dial)
            expect(lift, `up ${up}`).toBeCloseTo(-up, 6);
            // the view's camera: the same horizon `uptilt` degrees lower, whatever the pitch (a nose down by the uptilt levels the view)
            expect(cameraHorizon(q, a.yaw, hz.n, uptilt).liftDeg, `up ${up}`).toBeCloseTo(-up - uptilt, 6);
            // and a camera along the body's own axis agrees with the dial (the test above)
            expect(cameraHorizon(q, a.yaw, hz.n).liftDeg, `up ${up}`).toBeCloseTo(-up, 6);
        }
    });

    it('a right roll lifts the horizon\'s right end and moves the sky pointer left of the top; a nose down lifts the horizon', () => {
        const right = horizonOf({ rollDeg: 30, pitchDeg: 0 }, layout.dial);
        expect(right.u[1]).toBeLessThan(0);
        expect(Math.atan2(right.u[1], right.u[0]) / DEG).toBeCloseTo(-30, 6);
        expect(right.pointer[0]).toBeLessThan(layout.dial.cx);
        const down = horizonOf({ rollDeg: 0, pitchDeg: 10 }, layout.dial);
        expect(layout.dial.cy - down.centre[1]).toBeCloseTo(10 * down.pxPerDeg, 6);
        const up = horizonOf({ rollDeg: 0, pitchDeg: -10 }, layout.dial);
        expect(up.centre[1] - layout.dial.cy).toBeCloseTo(10 * up.pxPerDeg, 6);
    });

    it('control: a display whose roll turned the wrong way would disagree with the camera', () => {
        const q = bodyQuat(0, 0, 30);
        const a = attitude(simState(q));
        const wrong = horizonOf({ rollDeg: -a.roll, pitchDeg: a.pitch }, layout.dial);
        const cam = cameraHorizon(q, a.yaw, wrong.n);
        expect(Math.abs(Math.atan2(wrong.u[1], wrong.u[0]) / DEG - cam.tiltDeg)).toBeGreaterThan(50);
    });

    it('the tape: the floor at the bottom, the room\'s top at the top, the craft, the band and the height to fly at in their places', () => {
        const s: AttitudeState = { ...level, heightM: 1.25, bandM: [1, 2], targetM: 1.5, roomM: 3.2 };
        const tape = tapeOf(s, layout.tape);
        expect(tape.topM).toBe(3.5);
        const span = tape.y(0) - tape.y(tape.topM);
        expect(span).toBeGreaterThan(0.8 * (layout.tape.y1 - layout.tape.y0));
        expect((tape.y(0) - tape.y(1.25)) / span).toBeCloseTo(1.25 / 3.5, 6);
        expect(tape.y(2)).toBeLessThan(tape.y(1.5));
        expect(tape.y(1.5)).toBeLessThan(tape.y(1.25));
        expect(tape.y(1.25)).toBeLessThan(tape.y(1));
        // in the open the scale is 4 m at least and grows a metre at a time over a craft that climbs
        expect(tapeOf({ ...s, roomM: null, bandM: null, targetM: null, heightM: 1 }, layout.tape).topM).toBe(4);
        expect(tapeOf({ ...s, roomM: null, bandM: null, targetM: null, heightM: 6.2 }, layout.tape).topM).toBe(8);
    });

    it('the climb arrow: up for a climb, down for a sink, none at a standstill, longer the faster', () => {
        const tape = tapeOf(level, layout.tape);
        const up = climbArrow({ ...level, vyMps: 0.6 }, tape, layout.arrow)!;
        const fast = climbArrow({ ...level, vyMps: 1.8 }, tape, layout.arrow)!;
        const down = climbArrow({ ...level, vyMps: -0.6 }, tape, layout.arrow)!;
        expect(up.up).toBe(true);
        expect(up.to).toBeLessThan(up.from);
        expect(down.up).toBe(false);
        expect(down.to).toBeGreaterThan(down.from);
        expect(up.from - fast.to).toBeGreaterThan(up.from - up.to);
        expect(climbArrow({ ...level, vyMps: 0.05 }, tape, layout.arrow)).toBeNull();
        expect(climbArrow({ ...level, vyMps: Number.NaN }, tape, layout.arrow)).toBeNull();
    });
});

describe('contrast on paper: every line and mark 4.5:1 or more against what it lies on', () => {
    for (const scheme of ['dark', 'light'] as const) {
        it(`the attitude display, ${scheme} page`, () => {
            const pairs = attitudePairs(scheme);
            console.log(`sonic-panels: attitude ${scheme} ${JSON.stringify(Object.fromEntries(Object.entries(pairs).map(([k, v]) => [k, Math.round(v * 100) / 100])))}`);
            for (const [k, v] of Object.entries(pairs)) expect(v, k).toBeGreaterThanOrEqual(MARK_CONTRAST);
        });
        it(`the sound panel, ${scheme} page`, () => {
            const pairs = soundPairs(scheme);
            console.log(`sonic-panels: sounds ${scheme} ${JSON.stringify(Object.fromEntries(Object.entries(pairs).map(([k, v]) => [k, Math.round(v * 100) / 100])))}`);
            for (const [k, v] of Object.entries(pairs)) expect(v, k).toBeGreaterThanOrEqual(MARK_CONTRAST);
        });
    }
});

const cue = (id: string, dir: Vec3 | null, distance: number | null = null): ActiveCue => ({ id, layer: 'safety', dir, distance, rateHz: null, pitchHz: null, rough: 0 });

describe('the sound panel (M41-25, W14)', () => {
    it('every cue the glossary names has a kind; the radar shows the seven kinds; an unknown cue none', () => {
        const en = JSON.parse(readFileSync(join(ROOT, 'packages/sonic-fpv/locales/en.json'), 'utf8')) as Record<string, string>;
        const named = Object.keys(en).filter((k) => /^cue\.[\w-]+\.[\w-]+\.name$/.test(k)).map((k) => k.slice(4, -5));
        expect(named.length).toBeGreaterThan(25);
        for (const id of named) expect(cueKind(id), id).not.toBeNull();
        expect([...new Set(named.map((id) => cueKind(id)).filter((k) => RADAR_KINDS.includes(k!)))].sort()).toEqual([...RADAR_KINDS].sort());
        expect(cueKind('safety.wall:front-left')).toBe('wall');
        expect(cueKind('safety.free:preview')).toBe('open');
        expect(cueKind('safety.lava')).toBeNull();
    });

    it('places: left on the left, front-right up and right, nearer nearer the middle; straight up and down on the height bar; a rise of 45 degrees marked above', () => {
        const [left, fr, ceiling, floor, rise] = radarItems([
            cue('safety.wall:left', [-1, 0, 0], 1),
            cue('safety.obstacle:front-right', [Math.SQRT1_2, 0, -Math.SQRT1_2], 3),
            cue('safety.ceiling:up', [0, 1, 0], 0.8),
            cue('safety.floor:down', [0, -1, 0], 0.5),
            cue('safety.ceiling:front-up', [0, Math.SQRT1_2, -Math.SQRT1_2], 1)
        ], null);
        expect(left!.x).toBeCloseTo(-radiusOf(1), 6);
        expect(left!.y).toBeCloseTo(0, 6);
        expect(fr!.x).toBeGreaterThan(0);
        expect(fr!.y).toBeLessThan(0);
        expect(Math.hypot(fr!.x, fr!.y)).toBeGreaterThan(Math.hypot(left!.x, left!.y));
        expect(ceiling).toMatchObject({ bar: 'top', elev: 'above', kind: 'surface' });
        expect(floor).toMatchObject({ bar: 'bottom', elev: 'below', kind: 'surface' });
        expect(rise).toMatchObject({ bar: null, elev: 'above' });
        expect(rise!.y).toBeLessThan(0);
        // a cue without a direction is the craft's own, for a moment
        expect(radarItems([cue('target.praise', null)], null)[0]).toMatchObject({ event: true, kind: 'praise' });
        // the height, speed and room cues are not on the radar
        expect(radarItems([cue('height.tone', null), cue('speed.tick', null), cue('room.bed', null)], null)).toEqual([]);
    });

    it('discs never touch: a wall heard in five sectors 0.5 m off and the open way beside them, each still on its side; control: at their own places they would', () => {
        const l = soundLayout(0.8 * 216 * 1.36, 0.8 * 216);
        const s2 = Math.SQRT1_2;
        const items = radarItems([
            cue('safety.wall:left', [-1, 0, 0], 0.5),
            cue('safety.wall:front-left', [-s2, 0, -s2], 0.5),
            cue('safety.obstacle:front', [0, 0, -1], 0.6),
            cue('safety.wall:front-right', [s2, 0, -s2], 0.5),
            cue('safety.wall:right', [1, 0, 0], 0.5),
            cue('safety.free:up', [0, 0, -1], null)
        ], { side: 'up', offsetM: 0.5, obstacleM: 0.6, ttcS: 0.5 });
        const places = placeDiscs(items, l);
        const reach = (q: { r: number; mark: boolean }): number => q.r * (q.mark ? 1.5 : 1);
        let closest = Infinity;
        for (let i = 0; i < places.length; i++) for (let j = i + 1; j < places.length; j++) {
            const a = places[i]!, b = places[j]!;
            closest = Math.min(closest, Math.hypot(a.x - b.x, a.y - b.y) - reach(a) - reach(b));
        }
        expect(closest).toBeGreaterThanOrEqual(0);
        for (const q of places) {
            const it = items.find((x) => x.id === q.id)!;
            const want = Math.atan2(it.y, it.x), got = Math.atan2(q.y - l.radar.cy, q.x - l.radar.cx);
            const off = Math.abs(((got - want + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
            expect(off, q.id).toBeLessThan((40 * Math.PI) / 180);
            expect(Math.hypot(q.x - l.radar.cx, q.y - l.radar.cy) + q.r, q.id).toBeLessThanOrEqual(l.radar.r);
        }
        // control: the same cues at their own places touch
        let raw = Infinity;
        for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) raw = Math.min(raw, Math.hypot((items[i]!.x - items[j]!.x) * l.radar.r, (items[i]!.y - items[j]!.y) * l.radar.r) - 2 * l.icon);
        expect(raw).toBeLessThan(0);
    });

    it('the open way: its side from the plan (a way above or below sounds from ahead with the pilot\'s "Sound from above and below" off); control: without the side no mark', () => {
        const ahead: Vec3 = [0, 0, -1];
        const fw = (side: FreeWay['side']): FreeWay => ({ side, offsetM: 0.5, obstacleM: 1.5, ttcS: 1 });
        expect(radarItems([cue('safety.free:up', ahead)], fw('up'))[0]).toMatchObject({ kind: 'open', elev: 'above', bar: null });
        expect(radarItems([cue('safety.free:down', ahead)], fw('down'))[0]).toMatchObject({ elev: 'below' });
        const left = radarItems([cue('safety.free:left', [-Math.sin(Math.PI / 3), 0, -0.5])], fw('left'))[0]!;
        expect(left.elev).toBeNull();
        expect(left.x).toBeLessThan(0);
        // once the package gives the chime an elevation of its own (lane s13-elev), the direction carries the mark by itself
        expect(radarItems([cue('safety.free:up', [0, 0.5, -0.866])], null)[0]).toMatchObject({ elev: 'above' });
        // control: a chime from ahead with no side anywhere is not marked
        expect(radarItems([cue('safety.free', ahead)], null)[0]!.elev).toBeNull();
    });

    it('with the real planner: the pillar ahead in walls-pillar, the open way above block 1 of tunnel-gaps, the target note at the next ring of rings-heights', () => {
        const sample = (pos: Vec3, vel: Vec3, t: number): FlightSample => ({ t, tick: t, pos, vel, quat: [1, 0, 0, 0], rate: [0, 0, 0], yawDeg: 0, pitchDeg: 0, rollDeg: 0, sticks: [0, 0, 0, 0], armed: true, touched: false, paused: false });
        const run = (id: string, at: (w: AnalyticWorldInfo) => Vec3, speed: number) => {
            const lesson = getLesson(id);
            if (lesson.world.kind !== 'analytic') throw new Error(id);
            const world = createAnalyticWorld(lesson.world.spec);
            const planner = new CuePlanner({ theme: getBuiltinTheme('soft'), prefs: defaultPrefs(), layers: lesson.layers });
            const pos = at(world);
            const gates = world.objects().filter((o) => o.shape.kind === 'ring').sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
            let plan = planner.plan({ sample: sample(pos, [0, 0, -speed], 0), world, target: gates[0] ?? null, floorY: world.floorY });
            for (let i = 1; i <= 30; i++) plan = planner.plan({ sample: sample([pos[0], pos[1], pos[2] - (speed * i) / 60], [0, 0, -speed], (1000 * i) / 60), world, target: gates[0] ?? null, floorY: world.floorY });
            return { plan, world, gates };
        };
        // walls-pillar: 2.5 m before the pillar at 2 m/s
        const pillar = run('walls-pillar', (w) => {
            const p = w.objects().find((o) => o.shape.kind === 'pillar')!;
            return [p.pos[0], 1.5, p.pos[2] + 2.5];
        }, 2);
        const items = radarItems(pillar.plan.cues, pillar.plan.freeWay, pillar.plan.urgent);
        const obstacle = items.find((it) => it.id.startsWith('safety.obstacle'));
        console.log(`sonic-panels: walls-pillar cues ${pillar.plan.cues.map((c) => c.id).join(', ')}; free way ${JSON.stringify(pillar.plan.freeWay)}`);
        expect(obstacle, 'the pillar is heard').toBeDefined();
        expect(obstacle!.y).toBeLessThan(0);
        expect(Math.abs(obstacle!.x)).toBeLessThan(Math.abs(obstacle!.y));
        // tunnel-gaps: block 1 ahead (the L1 view: 4.25 m ahead of z -4.5), its free way above, at 2.5 m/s
        const gaps = run('tunnel-gaps', () => [0, 1.5, -6.5], 2.5);
        console.log(`sonic-panels: tunnel-gaps cues ${gaps.plan.cues.map((c) => c.id).join(', ')}; free way ${JSON.stringify(gaps.plan.freeWay)}`);
        expect(gaps.plan.freeWay?.side).toBe('up');
        const way = radarItems(gaps.plan.cues, gaps.plan.freeWay).find((it) => it.kind === 'open');
        expect(way).toMatchObject({ elev: 'above', bar: null });
        // rings-heights: from the start, the first ring's height is the target note's
        const rings = run('rings-heights', (w) => [...w.start.pos] as Vec3, 0.5);
        const bar = heightBar(rings.plan, 5.5, 0);
        expect(bar.targetM).not.toBeNull();
        expect(bar.targetM!).toBeCloseTo(rings.gates[0]!.pos[1] - rings.world.floorY, 6);
        expect(bar.toneM!).toBeCloseTo(rings.world.start.pos[1] - rings.world.floorY, 6);
        expect(bar.periodS).toBeGreaterThan(0.5);
        expect(bar.noteS).toBeGreaterThan(0);
        expect(bar.noteS!).toBeLessThan(bar.periodS!);
        // the note is on for noteS of every periodS
        expect(heightBar(rings.plan, 5.5, 0).noteOn).toBe(true);
        expect(heightBar(rings.plan, 5.5, (bar.noteS! + 0.01) * 1000).noteOn).toBe(false);
    });

    // v13-int step 2: the package at s13-int (lane s13-elev's up and down by direction) gives the panel real elevations: the open way's
    // chime from the middle of the way (plan.freeWay.dir, middleM), the target note from its target (plan.height.target.dir, the active
    // height.target cue's dir); both only with SonicPrefs.heightDirection on, the setting the pilot can turn off.
    describe('real elevations from the package (s13-elev), with the pilot\'s "Sound from above and below" on and off', () => {
        const sample = (pos: Vec3, vel: Vec3, t: number): FlightSample => ({ t, tick: t, pos, vel, quat: [1, 0, 0, 0], rate: [0, 0, 0], yawDeg: 0, pitchDeg: 0, rollDeg: 0, sticks: [0, 0, 0, 0], armed: true, touched: false, paused: false });
        const world = (id: string): AnalyticWorldInfo => {
            const w = getLesson(id).world;
            if (w.kind !== 'analytic') throw new Error(id);
            return createAnalyticWorld(w.spec);
        };
        const sinEl = (d: readonly number[] | null): number => (d === null ? 0 : (d[1] as number) / Math.hypot(d[0] as number, d[1] as number, d[2] as number));

        /** tunnel-gaps, block 1 ahead with its free way above (the test above's place), half a second at 2.5 m/s */
        const gaps = (heightDirection: boolean) => {
            const w = world('tunnel-gaps');
            const planner = new CuePlanner({ theme: getBuiltinTheme('soft'), prefs: { ...defaultPrefs(), heightDirection }, layers: getLesson('tunnel-gaps').layers });
            let plan = planner.plan({ sample: sample([0, 1.5, -6.5], [0, 0, -2.5], 0), world: w, target: null, floorY: w.floorY });
            for (let i = 1; i <= 30; i++) plan = planner.plan({ sample: sample([0, 1.5, -6.5 - (2.5 * i) / 60], [0, 0, -2.5], (1000 * i) / 60), world: w, target: null, floorY: w.floorY });
            const chime = plan.cues.find((c) => cueKind(c.id) === 'open') ?? null;
            return { plan, chime };
        };

        it('tunnel-gaps\' open way above, setting on: marked above by its own direction (the chime rises from the middle of the way), with or without the plan\'s side', () => {
            const { plan, chime } = gaps(true);
            expect(plan.freeWay?.side).toBe('up');
            expect(chime?.id).toBe('safety.free:up');
            // the package's direction: the middle of the way, above the craft's line and ahead
            const dir = plan.freeWay!.dir!;
            expect(dir).toBeDefined();
            expect(plan.freeWay!.middleM).toBeGreaterThan(0);
            expect(chime!.dir).toEqual(dir);
            expect(sinEl(chime!.dir)).toBeGreaterThanOrEqual(ELEVATION_SIN);
            expect(chime!.dir![2]).toBeLessThan(0);
            expect(radarItems(plan.cues, plan.freeWay).find((it) => it.kind === 'open')).toMatchObject({ elev: 'above', bar: null });
            // the mark comes from the direction itself: the same chime with no side anywhere (no free way, no suffix) is still marked above
            const bare = plan.cues.map((c) => (c.id === 'safety.free:up' ? { ...c, id: 'safety.free' } : c));
            expect(radarItems(bare, null).find((it) => it.kind === 'open')).toMatchObject({ elev: 'above' });
        });

        it('setting off: the chime sounds from ahead (its pitch tells the way), so the mark comes from the plan\'s side; control: without the side, no mark', () => {
            const { plan, chime } = gaps(false);
            expect(plan.freeWay?.side).toBe('up');
            expect(chime?.id).toBe('safety.free:up');
            // the way's middle is still found (plan.freeWay.dir), but the chime does not come from it
            expect(chime!.dir).not.toEqual(plan.freeWay!.dir);
            expect(Math.abs(sinEl(chime!.dir))).toBeLessThan(ELEVATION_SIN);
            expect(radarItems(plan.cues, plan.freeWay).find((it) => it.kind === 'open')).toMatchObject({ elev: 'above', bar: null });
            // control: the cue's own suffix still names the side, so take the side away everywhere: the chime from ahead is not marked
            const bare = plan.cues.map((c) => (c.id === 'safety.free:up' ? { ...c, id: 'safety.free' } : c));
            expect(radarItems(bare, null).find((it) => it.kind === 'open')!.elev).toBeNull();
        });

        /** rings-heights' first ring 2 m ahead, the craft `dy` m off its centre's height, at rest */
        const note = (heightDirection: boolean, dy: number) => {
            const w = world('rings-heights');
            const lesson = getLesson('rings-heights');
            const ring = w.objects().filter((o) => o.shape.kind === 'ring').sort((a, b) => (a.order ?? 0) - (b.order ?? 0))[0]!;
            const planner = new CuePlanner({ theme: getBuiltinTheme('soft'), prefs: { ...defaultPrefs(), heightDirection }, layers: lesson.layers });
            const plan = planner.plan({ sample: sample([ring.pos[0], ring.pos[1] + dy, ring.pos[2] + 2], [0, 0, 0], 0), world: w, target: ring, floorY: w.floorY });
            return { plan, item: radarItems(plan.cues, plan.freeWay).find((it) => it.id === TARGET_NOTE_ID) ?? null };
        };

        it('the target note\'s mark follows plan.height.target.dir: on the radar as the target\'s, ahead, above for a ring above the craft and below for one under it', () => {
            for (const [dy, elev] of [[-1.2, 'above'], [1.2, 'below'], [0, null]] as const) {
                const { plan, item } = note(true, dy);
                const target = plan.height?.target;
                expect(target?.dir, `dy ${dy}`).toBeDefined();
                const cueDir = plan.cues.find((c) => c.id === TARGET_NOTE_ID)!.dir;
                expect(cueDir).toEqual(target!.dir);
                expect(item, `dy ${dy}`).toMatchObject({ kind: 'target', elev, bar: null, event: false });
                // where it is drawn is the direction's level part: ahead of the craft (the radar's nose up)
                expect(item!.y).toBeLessThan(0);
                expect(Math.sign(sinEl(target!.dir!))).toBe(dy === 0 ? 0 : -Math.sign(dy));
            }
        });

        it('setting off: the target note has no direction, so it stays on the height bar alone (control: on, it is on the radar)', () => {
            const off = note(false, -1.2);
            expect(off.plan.height?.target).not.toBeNull();
            expect(off.plan.height?.target?.dir).toBeUndefined();
            expect(off.item).toBeNull();
            expect(heightBar(off.plan, 5.5, 0).targetM).not.toBeNull();
            expect(note(true, -1.2).item).not.toBeNull();
        });
    });

    it('every sound a lesson plays three times has its glossary name in en, es, pl and ru (the package\'s own words, not a fallback)', () => {
        const repeated = new Set<string>();
        for (const id of SHIPPED_LESSON_IDS) {
            const raw = JSON.parse(readFileSync(join(ROOT, `packages/sonic-fpv/lessons/${id}.json`), 'utf8')) as { intro?: { cues?: (string | { cue: string })[] }[] };
            for (const part of raw.intro ?? []) for (const c of part.cues ?? []) repeated.add(typeof c === 'string' ? c : c.cue);
        }
        expect(repeated.size).toBeGreaterThan(10);
        for (const l of ['en', 'es', 'pl', 'ru'] as const) {
            const tr = createTranslator(l, DICTS);
            for (const c of repeated) {
                expect(cueKind(c), c).not.toBeNull();
                expect(tr.has(`cue.${c}.name`), `${l} cue.${c}.name`).toBe(true);
            }
        }
        expect(createTranslator('pl', DICTS).text({ key: 'cue.safety.obstacle.name' })).not.toBe(createTranslator('en', DICTS).text({ key: 'cue.safety.obstacle.name' }));
        // control: a name that does not exist is caught by the same question
        expect(createTranslator('pl', DICTS).has('cue.safety.lava.name')).toBe(false);
    });
});

describe('the panels\' switches (L2-3) and words', () => {
    it('on by default, saved, read back by a new store on the same storage, both apart', () => {
        const backend = new MemoryBackend();
        const a = mkStore(backend);
        for (const k of LOOK_PANELS) expect(panelOn(a, k)).toBe(true);
        setPanel(a, 'soundPanel', false);
        expect(panelOn(a, 'soundPanel')).toBe(false);
        expect(panelOn(a, 'attitude')).toBe(true);
        const b = mkStore(backend);
        expect(panelOn(b, 'soundPanel')).toBe(false);
        expect(panelOn(b, 'attitude')).toBe(true);
        setPanel(b, 'attitude', false);
        setPanel(b, 'soundPanel', true);
        const c = mkStore(backend);
        expect(panelOn(c, 'soundPanel')).toBe(true);
        expect(panelOn(c, 'attitude')).toBe(false);
        expect(JSON.parse(backend.read()!).collections.sonic).toMatchObject({ soundPanel: true, attitude: false });
    });

    it('a switch that is not a boolean is dropped (the panel shows); the rest of the collection stays', () => {
        const v = validateCollection('sonic', { v: 1, prefs: null, progress: {}, current: 'walls-hall', soundPanel: 'off', attitude: false })!;
        expect(v.soundPanel).toBeUndefined();
        expect(v.attitude).toBe(false);
        expect(v.current).toBe('walls-hall');
    });

    it('the words of the panels come with the mode\'s chunk (sonic/texts.ts), never an ordinary page\'s (i18n.ts)', () => {
        const main = readFileSync(join(ROOT, 'apps/fly/src/i18n.ts'), 'utf8');
        expect(main).toContain("'!../../../packages/i18n/locales/fly/soniclook/*.json'");
        const texts = readFileSync(join(ROOT, 'apps/fly/src/sonic/texts.ts'), 'utf8');
        expect(texts).toContain("'../../../../packages/i18n/locales/fly/soniclook/*.json'");
        const en = JSON.parse(readFileSync(join(ROOT, 'packages/i18n/locales/fly/soniclook/en.json'), 'utf8')) as Record<string, string>;
        const asked = new Set<string>();
        for (const f of ['attitude.ts', 'sound-panel.ts', 'look-panels.ts', 'look-prefs.ts']) for (const m of readFileSync(join(ROOT, 'apps/fly/src/sonic', f), 'utf8').matchAll(/'(soniclook\.[\w.-]+)'/g)) asked.add(m[1]!);
        expect([...asked].sort()).toEqual(Object.keys(en).sort());
    });
});

// ------------------------------------------------------------------ v13-int step 8: the places of the three panels (sonic.css, look.css)

/**
 * The numbers the progress panel's places (sonic.css) and the other two panels' (look.css) share, which no rule states twice: what
 * disagrees, as a list of problems (empty: they agree). The page proof (v13-look-page.ts layout) measures the places on a page at
 * eight sizes; this holds the arithmetic between the two files, so a change to one that the other does not follow fails here at once.
 */
function placeProblems(sonic: string, look: string, fly: string): string[] {
    const out: string[] = [];
    const num = (re: RegExp, text: string): number | null => (re.exec(text) ? Number(re.exec(text)![1]) : null);
    // 1. the progress panel stands 12 px under halfway down; the sound panel under it ends 8 px under, so its formula takes 101 + 12 px
    const top = num(/\.sonic-progress \{[^}]*top: calc\(50% \+ (\d+)px\)/, sonic);
    const formula = num(/\.sonic-sounds \{ --u: min\(clamp\(120px, 30vh, 260px\), calc\(\(50vh - 3 \* clamp\(18px, 2\.2vw, 28px\) - (\d+)px\) \/ 0\.8\)\)/, look);
    if (top === null || formula === null || formula !== 101 + top) out.push(`the sound panel's formula takes ${formula} px, the progress panel stands ${top} px under halfway (101 + that)`);
    // 2. 501 to 600 px high: the sound panel's size is one variable, the progress panel's `left` is that panel's width: the canvas 0.8 x 1.36 of
    //    it, plus the panel's own padding and border on both sides
    const cond = '@media (min-width: 641px) and (min-height: 501px) and (max-height: 600px)';
    if (!look.includes(`${cond} {\n    :root { --sonic-sounds-u:`) || !/\.sonic-sounds \{ --u: var\(--sonic-sounds-u\); \}/.test(look)) out.push('look.css does not set --sonic-sounds-u as the sound panel\'s --u for 501 to 600 px');
    const row = /@media \(min-width: 641px\) and \(min-height: 501px\) and \(max-height: 600px\) \{ \.sonic-progress \{[^}]*left: calc\(max\(12px, env\(safe-area-inset-left\)\) \+ var\(--sonic-sounds-u, \d+px\) \* ([\d.]+) \+ (\d+)px \+ (\d+)px\)/.exec(sonic);
    const canvas = /\.sonic-sounds canvas \{ width: calc\(var\(--u\) \* ([\d.]+) \* ([\d.]+)\)/.exec(look);
    const box = /\.sonic-attitude, \.sonic-sounds \{[^}]*padding: (\d+)px; border: (\d+)px solid/.exec(look);
    if (!row || !canvas || !box) out.push('the row rule, the canvas width or the panel box is not where the test reads it');
    else {
        const width = Number(canvas[1]) * Number(canvas[2]);
        if (Math.abs(Number(row[1]) - width) > 0.0005) out.push(`the progress panel's left takes ${row[1]} of the sound panel's --u, the canvas is ${width}`);
        if (Number(row[2]) !== 2 * (Number(box[1]) + Number(box[2]))) out.push(`the progress panel's left takes ${row[2]} px of padding and border, the panel has ${2 * (Number(box[1]) + Number(box[2]))}`);
    }
    // 3. touch sticks: the progress panel ends 8 px over the telemetry line, which fly.css stands 16 px over the sticks and is 19 px tall
    const over = num(/body\.touch-on \.osd\.bl \{ bottom: calc\(max\(24px, env\(safe-area-inset-bottom\)\) \+ min\(40vw, 220px\) \+ (\d+)px\)/, fly);
    const stick = num(/body\.touch-on \.sonic-progress \{ bottom: calc\(max\(24px, env\(safe-area-inset-bottom\)\) \+ min\(40vw, 220px\) \+ (\d+)px\)/, sonic);
    if (over === null || stick === null || stick !== over + 19 + 8) out.push(`over the sticks the progress panel takes ${stick} px, the telemetry line stands ${over} px (+ 19 + 8)`);
    // 4. the recorder's row and the take-off line move only with touch sticks on a phone, and take the width the sticks' layout gave them
    if (!/@media \(max-width: 640px\) \{\n    body\.touch-on \.sonic-progress[^\n]*\n    body\.sonic-mode\.touch-on \.cinema-bar, body\.sonic-mode\.touch-on \.gate-msg \{ left: auto; right: max\(8px, env\(safe-area-inset-right\)\); transform: none; max-width: 50vw; \}/.test(sonic)) out.push('the recorder\'s row and the take-off line are not moved by the touch rule alone');
    return out;
}

describe('v13-int step 8: the three panels\' places agree between sonic.css and look.css', () => {
    const read = (f: string): string => readFileSync(join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
    const sonic = read('apps/fly/src/sonic/sonic.css');
    const look = read('apps/fly/src/sonic/look.css');
    const fly = read('apps/fly/src/fly.css');

    it('the sound panel\'s formula, the row beside it, the sticks\' stack and the moved recorder row use the same numbers', () => {
        expect(placeProblems(sonic, look, fly)).toEqual([]);
    });

    it('control: a number changed in one file and not the other is caught, each of the four', () => {
        const once = (text: string, from: string, to: string): string => {
            expect(text, from).toContain(from);
            return text.replace(from, to);
        };
        expect(placeProblems(once(sonic, 'top: calc(50% + 12px)', 'top: calc(50% + 16px)'), look, fly).join('|')).toContain('formula takes 113 px');
        expect(placeProblems(sonic, once(look, 'canvas { width: calc(var(--u) * 0.8 * 1.36)', 'canvas { width: calc(var(--u) * 0.8 * 1.5)'), fly).join('|')).toContain('of the sound panel\'s --u');
        expect(placeProblems(sonic, look, once(fly, 'min(40vw, 220px) + 16px)', 'min(40vw, 220px) + 24px)')).join('|')).toContain('over the sticks');
        expect(placeProblems(once(sonic, 'transform: none; max-width: 50vw; }', 'transform: none; }'), look, fly).join('|')).toContain('not moved by the touch rule alone');
    });
});
