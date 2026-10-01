// RespawnDirector (docs/architecture-v03.md C.6; C.12 item 6): automatic respawns after a crash,
// backoff, stuck detection, R / Y, and the cases where nothing may happen.

import { describe, expect, it } from 'vitest';
import { DEFAULT_RESPAWN_POLICY, RespawnDirector, S, StateHistory, compileParams, dcos, dsin, hoverSolve, hoverStickOf, lifeSim } from '../src/index';
import type { RespawnDecision, Runner, Sim } from '../src/index';
import { PRESET, PlaneWorld, Pilot, SPLITS, attachDirector, crashCycles, header, newRunner, runFrames } from './log-kit';

const WORLD = PlaneWorld.room({ wallX: 4 });
const SPAWN: [number, number, number, number] = [0, 1, 0, 0];

function crashes(r: Runner): number[] {
    return r.events.filter((e) => e.type === 'crash').map((e) => e.tick);
}

/** Record every decision as it is applied (the director overwrites `last`). */
function decisions(r: Runner): RespawnDecision[] {
    const out: RespawnDecision[] = [];
    const d = r.director!;
    r.onLife = () => { if (d.last) out.push({ ...d.last }); };
    return out;
}

describe('after a crash (C.12 item 6)', () => {
    it('a crash at c respawns at exactly c + 2000 at every frame split, 5.00-5.05 s back along the path, on the platform', () => {
        const got: string[] = [];
        for (const hz of SPLITS) {
            const r = newRunner({ world: WORLD, at: SPAWN });
            const d = attachDirector(r, SPAWN);
            crashCycles(new Pilot(r), { hoverTicks: 6000, speed: 6, maxCrashes: 1 });
            runFrames(r, hz, 12_000_000, { phaseUs: 1234 });
            const [c] = crashes(r);
            const L = r.lives()[1].header.life;
            expect(L.reason).toBe('crash');
            expect(L.startTick, `${hz} Hz`).toBe(c + 2000);
            const age = d.last!.incidentTick - d.last!.sampleTick!;
            expect(age).toBeGreaterThanOrEqual(5000);
            expect(age).toBeLessThanOrEqual(5050);
            expect(L.opts).toEqual({ platform: true, keepArmed: true });
            got.push(`${c}:${L.at.join(',')}`);
        }
        expect(new Set(got).size).toBe(1);
    });

    it('control: with auto-respawn off the craft stays crashed for 10 s', () => {
        const r = newRunner({ world: WORLD, at: SPAWN });
        const d = attachDirector(r, SPAWN, { auto: false });
        crashCycles(new Pilot(r), { hoverTicks: 3000, speed: 6, maxCrashes: 1 });
        runFrames(r, 60, 16_000_000);
        const [c] = crashes(r);
        expect(c).toBeLessThan(6000);
        expect(r.lives().length).toBe(1);
        expect(r.sim.crashed).toBe(true);
        expect(d.pending()).toBeNull();
    });

    it('Enter keeps the wreck: keep() cancels the pending respawn; the toast reads pending()', () => {
        const r = newRunner({ world: WORLD, at: SPAWN });
        const d = attachDirector(r, SPAWN);
        crashCycles(new Pilot(r), { hoverTicks: 3000, speed: 6, maxCrashes: 1 });
        let seen: { crashTick: number; atTick: number } | null = null;
        runFrames(r, 60, 12_000_000, { perFrame: () => { const p = d.pending(); if (p && !seen) { seen = p; d.keep(); } } });
        expect(seen).not.toBeNull();
        expect(seen!.atTick - seen!.crashTick).toBe(2000);
        expect(r.lives().length).toBe(1);
    });

    it('scenes.autoSwitch: at c + 2000 the scene host is asked for the next scene, and there is no respawn', () => {
        const r = newRunner({ world: WORLD, at: SPAWN });
        const d = attachDirector(r, SPAWN, { onCrash: 'next-scene' });
        const asked: number[] = [];
        d.onSceneIntent = (t) => asked.push(t);
        crashCycles(new Pilot(r), { hoverTicks: 3000, speed: 6, maxCrashes: 1 });
        runFrames(r, 60, 10_000_000);
        expect(asked).toEqual([crashes(r)[0] + 2000]);
        expect(r.lives().length).toBe(1);
    });
});

describe('backoff (C.6)', () => {
    /**
     * 40 s hover in the first life, then every life dashes into the wall 0.5 s after it starts (the
     * fourth after 6 s). Ages are along the pilot's path (history.ts): a rewind cuts out what it
     * undid, so 5 + 10 + 15 s of backoff need about 30 s of path before the first crash.
     */
    function backoffRun(history: StateHistory): { r: Runner; dec: RespawnDecision[] } {
        const r = newRunner({ world: WORLD, at: SPAWN });
        attachDirector(r, SPAWN, {}, history);
        const dec = decisions(r);
        const p = new Pilot(r);
        crashCycles(p, { hoverTicks: 500, speed: 6, maxCrashes: 4 });
        const base = p.plan!;
        p.plan = (pp, sim, lt) => base(pp, sim, pp.life === 0 ? lt - 39_500 : pp.life === 3 ? lt - 5_500 : lt);
        runFrames(r, 60, 62_000_000);
        return { r, dec };
    }

    it('a crash within 3 s of the previous rewind goes further back along the path: 5, 10, 15 s', () => {
        const { r, dec } = backoffRun(new StateHistory());
        const ages = dec.map((x) => x.pathAgeTicks!);
        expect(dec.slice(0, 3).map((x) => x.backoff)).toEqual([1, 2, 3]);
        const lo = [5000, 10_000, 15_000];
        ages.slice(0, 3).forEach((a, i) => { expect(a).toBeGreaterThanOrEqual(lo[i]); expect(a).toBeLessThanOrEqual(lo[i] + 50); });
        // each later crash came within 3 s of the rewind before it
        const lives = r.lives();
        for (let k = 2; k <= 3; k++) expect(dec[k - 1].incidentTick - lives[k - 1].header.life.startTick).toBeLessThan(3000);
    });

    it('beyond the history\'s reach it goes to the start, and the backoff begins again', () => {
        // 20 s deep: the 10 s step reaches 13.9 s before the first crash (kept), the 15 s step 27.8 s (gone)
        const { r, dec } = backoffRun(new StateHistory({ capacity: 400 }));
        expect(dec.slice(0, 3).map((x) => `${x.kind}:${x.backoff}`)).toEqual(['rewind:1', 'rewind:2', 'start:0']);
        expect(r.lives()[3].header.life.at).toEqual(SPAWN);
        expect(r.lives()[3].header.life.soc).toBe(1); // a start gives a fresh pack (refill 'start')
        expect(dec[3].backoff).toBe(1);
    });
});

describe('stuck (items 18, 23)', () => {
    const FLOOR = PlaneWorld.room();
    const START: [number, number, number, number] = [0, 0.5, 0, 0];

    /** Lays the craft down on the floor, disarmed and not crashed; flipped = on its back. */
    function lay(r: Runner, flipped: boolean): void {
        const s = r.sim.s;
        s[S.qw] = flipped ? 0 : 1; s[S.qx] = 0; s[S.qy] = 0; s[S.qz] = flipped ? 1 : 0;
        s[S.px] = 0; s[S.py] = 0.0305; s[S.pz] = 0;
        s[S.hold] = 0;
    }

    it('flipped on its back and still: a respawn 1.50-1.51 s later', () => {
        const r = newRunner({ world: FLOOR, at: START });
        const d = attachDirector(r, START);
        lay(r, true);
        runFrames(r, 60, 3_000_000);
        const L = r.lives()[1]?.header.life;
        expect(L?.reason).toBe('stuck-flipped');
        expect(L!.startTick).toBeGreaterThanOrEqual(1500);
        expect(L!.startTick).toBeLessThanOrEqual(1510);
        expect(d.last!.kind).toBe('start'); // never armed: no safe point to go back to
    });

    it('control: an upright, disarmed landing is left alone for 30 s', () => {
        const r = newRunner({ world: FLOOR, at: START });
        attachDirector(r, START);
        lay(r, false);
        runFrames(r, 60, 30_000_000);
        expect(r.lives().length).toBe(1);
    });

    /** On its back on the invisible platform, high over nothing (no scene): the director's world is `touch`. */
    function onPlatform(touch: 'contactWorld' | 'scene'): Runner {
        const at: [number, number, number, number] = [0, 5, 0, 0];
        const r = newRunner({ world: null, at, opts: { platform: true } });
        const p = r.sim.p;
        r.director = new RespawnDirector({ ...DEFAULT_RESPAWN_POLICY }, () => at, new StateHistory(), () => (touch === 'contactWorld' ? r.sim.contactWorld : r.sim.world), p.boundRadius, hoverStickOf(p));
        const s = r.sim.s;
        s[S.qw] = 0; s[S.qx] = 0; s[S.qy] = 0; s[S.qz] = 1; // on its back, the duct spheres on the disc
        s[S.hold] = 0;
        runFrames(r, 60, 3_000_000);
        return r;
    }

    it('flipped on the invisible platform (nothing else under it) counts as lying on something: reset at 1.50-1.51 s', () => {
        const r = onPlatform('contactWorld');
        expect(r.sim.s[S.py]).toBeGreaterThan(4.9); // it never fell: the disc held it
        const L = r.lives()[1]?.header.life;
        expect(L?.reason).toBe('stuck-flipped');
        expect(L!.startTick).toBeGreaterThanOrEqual(1500);
        expect(L!.startTick).toBeLessThanOrEqual(1510);
    });

    it('control: a director that tests the scene alone (sim.world) never sees it touching anything', () => {
        const r = onPlatform('scene');
        expect(r.lives().length).toBe(1);
    });

    it('control: with respawn.unstuck off, the flipped craft stays', () => {
        const r = newRunner({ world: FLOOR, at: START });
        attachDirector(r, START, { unstuck: false });
        lay(r, true);
        runFrames(r, 60, 5_000_000);
        expect(r.lives().length).toBe(1);
    });

    /** Armed under a ceiling with the throttle `above` over hover: it flies up and presses against it. */
    function pinned(above: number): { r: Runner; arrived: number } {
        const world = PlaneWorld.room({ ceilY: 1.2 });
        const at: [number, number, number, number] = [0, 1.12, 0, 0];
        const r = newRunner({ world, at });
        attachDirector(r, at);
        const stick = hoverSolve(r.sim.p, 1).stick + above;
        r.enqueue({ tUs: 1000, ch: [0, 0, -1, 0, -1, -1, 0, 0] });
        r.enqueue({ tUs: 20_000, ch: [0, 0, -1, 0, 1, -1, 0, 0] });
        r.enqueue({ tUs: 40_000, ch: [0, 0, stick * 2 - 1, 0, 1, -1, 0, 0] });
        // the tick its ducts first reach the ceiling (top of a 30 mm duct sphere within 3 mm of it)
        let arrived = -1;
        r.onStep = (sim: Sim) => { if (arrived < 0 && sim.s[S.py] + 0.03 > 1.2 - 0.003) arrived = sim.tick; };
        runFrames(r, 60, 10_000_000);
        return { r, arrived };
    }

    it('wedged: armed, throttle 0.2 over hover, pressed under a ceiling: a respawn 3.0 s after it got there', () => {
        const { r, arrived } = pinned(0.2);
        const L = r.lives()[1]?.header.life;
        expect(L?.reason).toBe('stuck-wedged');
        expect(arrived).toBeGreaterThan(40);
        expect(arrived).toBeLessThan(600);
        console.log(`wedged: arrived ${arrived}, respawn ${L!.startTick}, after ${L!.startTick - arrived} ticks`);
        expect(L!.startTick - arrived).toBeGreaterThanOrEqual(2950);
        expect(L!.startTick - arrived).toBeLessThanOrEqual(3050);
    });

    it('control: 0.1 over hover (below the 0.15 margin) presses too, but is not a wedge', () => {
        const { r } = pinned(0.1);
        expect(r.sim.s[S.py]).toBeGreaterThan(1.1); // still up at the ceiling
        expect(r.lives().length).toBe(1);
    });
});

describe('a new model through newLife (a life setting: another drone, gravity mode, throttle curve)', () => {
    const CEIL = PlaneWorld.room({ ceilY: 1.2 });
    const AT: [number, number, number, number] = [0, 1.12, 0, 0];

    /**
     * Armed under a ceiling on the Pro (honest gravity); at 0.3 s a settings life switches to
     * auto-throttle, where the hover stick is 0.5, and the stick goes to 0.6: it climbs into the
     * ceiling and presses there, 0.1 over hover, which is not a wedge. `late`: the director is made
     * only after the switch, from the old model's values (what a page that never re-reads them has).
     */
    function switchToAuto(late: boolean): { r: Runner; d: RespawnDirector } {
        const r = newRunner({ world: CEIL, at: AT });
        const p0 = r.sim.p;
        const stale = new RespawnDirector({ ...DEFAULT_RESPAWN_POLICY }, () => AT, new StateHistory(), () => r.sim.contactWorld, p0.boundRadius, hoverStickOf(p0));
        if (!late) r.director = stale;
        r.enqueue({ tUs: 1000, ch: [0, 0, -1, 0, -1, -1, 0, 0] });
        r.enqueue({ tUs: 20_000, ch: [0, 0, -1, 0, 1, -1, 0, 0] });
        r.enqueue({ tUs: 40_000, ch: [0, 0, 0.2, 0, 1, -1, 0, 0] });
        r.advanceTo(300_000);
        const overrides = { gravityMode: 'auto-throttle' as const };
        const s = r.sim.s;
        r.newLife(lifeSim(compileParams(PRESET, overrides), CEIL), header({ at: [s[S.px], s[S.py], s[S.pz], 0], overrides, opts: { keepArmed: true }, reason: 'settings' }));
        if (late) r.director = stale;
        runFrames(r, 60, 10_000_000);
        return { r, d: stale };
    }

    it('the director takes the new model\'s hover stick (0.5 in auto-throttle) and body: 0.1 over hover presses but is no wedge', () => {
        const { r, d } = switchToAuto(false);
        expect(d.hoverStick).toBe(0.5);
        expect(d.boundRadius).toBe(r.sim.p.boundRadius);
        expect(r.sim.s[S.py]).toBeGreaterThan(1.1); // pressed at the ceiling
        expect(r.lives().map((l) => l.header.life.reason)).toEqual(['start', 'settings']);
    });

    it('control: a director left with the old model\'s hover stick (0.277) calls the same craft wedged', () => {
        const { r, d } = switchToAuto(true);
        expect(d.hoverStick).toBeLessThan(0.3);
        expect(r.lives().map((l) => l.header.life.reason)).toContain('stuck-wedged');
    });
});

describe('R and Y (manual)', () => {
    function hoverThenMove(refill: 'start' | 'never'): { r: Runner; d: ReturnType<typeof attachDirector> } {
        const r = newRunner({ world: WORLD, at: SPAWN });
        const d = attachDirector(r, SPAWN, { refill });
        const p = new Pilot(r);
        p.plan = (pp, sim) => {
            if (pp.phase === '') { pp.bot.setTask({ kind: 'hover', target: [0, 1, 0], yawDeg: 0 }, sim); pp.phase = 'hover'; }
            else if (pp.phase === 'hover' && sim.tick >= 8000 && pp.life === 0) { pp.bot.setTask({ kind: 'path', points: [[2, 1.2, 1]], speed: 1.5, yawDeg: 0 }, sim); pp.phase = 'move'; }
        };
        runFrames(r, 60, 12_000_000);
        // onStep runs before the director decides: this is the pack the respawn tick sees
        const prev = r.onStep;
        r.onStep = (sim) => { prev?.(sim); socAt.set(sim.tick, sim.s[S.soc]); };
        return { r, d };
    }
    const socAt = new Map<number, number>();

    it('Y rewinds 5 s along the path at the next tick; R goes to the spawn with a fresh pack', () => {
        const { r, d } = hoverThenMove('start');
        const t = r.sim.tick;
        d.request('rewind');
        r.advanceTo((t + 5) * 1000);
        const y = r.lives()[1].header.life;
        expect(y.reason).toBe('manual-rewind');
        expect(y.startTick).toBe(t + 1);
        expect(t + 1 - d.last!.sampleTick!).toBeGreaterThanOrEqual(5000);
        expect(t + 1 - d.last!.sampleTick!).toBeLessThanOrEqual(5050);
        expect(y.soc).toBe(socAt.get(t + 1)); // a rewind keeps the pack (refill 'start')
        expect(y.soc).toBeLessThan(0.99);
        d.request('start');
        r.advanceTo((t + 10) * 1000);
        const R = r.lives()[2].header.life;
        expect(R.reason).toBe('manual-start');
        expect(R.at).toEqual(SPAWN);
        expect(R.soc).toBe(1);
        expect(R.opts).toEqual({ platform: true, keepArmed: true, soc: 1 });
    });

    it('control: with battery.refill never, R keeps the used pack', () => {
        const { r, d } = hoverThenMove('never');
        const t = r.sim.tick;
        d.request('start');
        r.advanceTo((t + 2) * 1000);
        expect(r.lives()[1].header.life.startTick).toBe(t + 1);
        expect(socAt.get(t + 1)).toBeLessThan(0.99);
        expect(r.lives()[1].header.life.soc).toBe(socAt.get(t + 1));
    });
});

describe('stillness is the largest pose change over 100 ms, of the centre and of the up direction (C.6, deviation noted in director.ts)', () => {
    const FLOOR = PlaneWorld.room();

    /**
     * Drives decide() with a scripted pose on its back, touching the floor: sliding along x at v,
     * tipping about the horizontal x axis at w (rad/s), spinning about its own up axis at spin, and
     * rocking about x by +-rockDeg at rockHz. Returns the tick of the first respawn, or -1.
     */
    function scripted(o: { v?: number; w?: number; spin?: number; rockDeg?: number; rockHz?: number }, ticks: number): number {
        const r = newRunner({ world: FLOOR, at: [0, 0.5, 0, 0] });
        const sim = r.sim;
        const p = sim.p;
        const d = new RespawnDirector({ ...DEFAULT_RESPAWN_POLICY }, () => [0, 0.5, 0, 0], new StateHistory(), () => FLOOR, p.boundRadius, hoverSolve(p, 1).stick);
        const s = sim.s;
        for (let t = 1; t <= ticks; t++) {
            sim.tick = t;
            const tip = ((o.w ?? 0) * t) / 1000 + ((o.rockDeg ?? 0) * Math.PI / 180) * dsin(2 * Math.PI * (o.rockHz ?? 0) * t / 1000);
            const yaw = ((o.spin ?? 0) * t) / 1000;
            // q = Rx(tip) * Ry(yaw) * Rz(180 deg): on its back, spun about its own up axis, tipped about world x
            const cx = dcos(tip / 2), sx = dsin(tip / 2), cy = dcos(yaw / 2), sy = dsin(yaw / 2);
            // Rx(tip) * Ry(yaw) = (cx cy, sx cy, cx sy, sx sy); times Rz(180) = (0, 0, 0, 1)
            const aw = cx * cy, ax = sx * cy, ay = cx * sy, az = sx * sy;
            s[S.qw] = -az; s[S.qx] = ay; s[S.qy] = -ax; s[S.qz] = aw;
            s[S.px] = ((o.v ?? 0) * t) / 1000; s[S.py] = 0.031; s[S.pz] = 0;
            if (d.decide(sim)) return t;
        }
        return -1;
    }

    it('0.19 m/s and a 0.95 rad/s tilt count as still: a respawn at 1.50-1.51 s', () => {
        for (const o of [{}, { v: 0.19 }, { w: 0.95 }]) {
            const t = scripted(o, 3000);
            expect(t, JSON.stringify(o)).toBeGreaterThanOrEqual(1500);
            expect(t, JSON.stringify(o)).toBeLessThanOrEqual(1510);
        }
    });

    it('control: 0.21 m/s or a 1.05 rad/s tilt is moving, never stuck', () => {
        expect(scripted({ v: 0.21 }, 5000)).toBe(-1);
        expect(scripted({ w: 1.05 }, 5000)).toBe(-1);
    });

    it('a spin about its own up axis (2.6 rad/s, what the 39e63ce9 floor does to a craft on its back) is still lying there', () => {
        const t = scripted({ spin: 2.6 }, 3000);
        expect(t).toBeGreaterThanOrEqual(1500);
        expect(t).toBeLessThanOrEqual(1510);
    });

    it('control: the design\'s literal |w| (the whole rotation) reads that spin as 2.6 rad/s, so the craft would never count as still', () => {
        // the angle between the poses 100 ms apart, as the first implementation measured it
        const q = (yaw: number) => [0, dsin(yaw / 2), 0, dcos(yaw / 2)];
        const a = q(0), b = q(0.26);
        const dot = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
        expect((2 * Math.acos(Math.min(1, dot))) / 0.1).toBeGreaterThan(1);
    });

    it('a rocking that comes back after exactly 100 ms (+-6 deg at 10 Hz) still reads as motion: the largest change, not the net one', () => {
        expect(scripted({ rockDeg: 6, rockHz: 10 }, 5000)).toBe(-1);
        // control: the net change over 100 ms of that rocking is nil, so a net-change rule would call it still
        const tipAt = (t: number) => 6 * dsin(2 * Math.PI * 10 * t / 1000);
        expect(Math.abs(tipAt(1234) - tipAt(1134))).toBeLessThan(1e-9);
        // and a small rocking inside the tolerance (+-1.3 deg, the voxel floor's wobble) is still
        const t = scripted({ rockDeg: 1.3, rockHz: 7 }, 3000);
        expect(t).toBeGreaterThanOrEqual(1500);
        expect(t).toBeLessThanOrEqual(1510);
    });

    it('why: a craft at rest on the floor fails the rule read per tick, and passes it over 100 ms', () => {
        const r = newRunner({ world: FLOOR, at: [0, 0.5, 0, 0] });
        const s = r.sim.s;
        s[S.qw] = 0; s[S.qx] = 0; s[S.qy] = 0; s[S.qz] = 1; s[S.px] = 0; s[S.py] = 0.0305; s[S.pz] = 0; s[S.hold] = 0;
        let perTick = 0;
        let n = 0;
        const pose: number[][] = [];
        let windowed = 0;
        let windows = 0;
        r.onStep = (sim) => {
            const q = sim.s;
            if (sim.tick > 500) {
                n++;
                if (Math.hypot(q[S.wx], q[S.wy], q[S.wz]) < 1 && Math.hypot(q[S.vx], q[S.vy], q[S.vz]) < 0.2) perTick++;
            }
            pose.push([q[S.px], q[S.py], q[S.pz], q[S.qw], q[S.qx], q[S.qy], q[S.qz]]);
            if (sim.tick > 500 && sim.tick % 10 === 0) {
                const a = pose[pose.length - 101], b = pose[pose.length - 1];
                const dot = Math.min(1, Math.abs(a[3] * b[3] + a[4] * b[4] + a[5] * b[5] + a[6] * b[6]));
                windows++;
                if (Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / 0.1 < 0.2 && (2 * Math.acos(dot)) / 0.1 < 1) windowed++;
            }
        };
        runFrames(r, 60, 3_000_000);
        console.log(`resting on its back: per tick ${perTick}/${n} ticks meet |w| < 1 and |v| < 0.2; over 100 ms ${windowed}/${windows} windows`);
        // if the contact solver one day settles a resting craft, this first line fails: the window is still right
        expect(perTick / n).toBeLessThan(0.1);
        expect(windowed).toBe(windows);
    });
});
