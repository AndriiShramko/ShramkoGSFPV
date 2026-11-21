// Train 4, lane tutor-air S1 (plan t8-plan.md Part B 3, decision 4 host side): a moment of the sound package's runner freezes the
// flight and keeps its one sound going. The page carries out RunnerAction 'moment' (moment-host.ts: ctx.pause('moment')) and
// 'audible' (the engine's gate, bridge.ts setAudible); the bridge does not silence a pause held for a moment alone (momentOnly).
// Driven with the page's own PauseStack, the bridge, a craft that moves only while the flight is not paused (the SimClock's rule)
// and the package's real CuePlanner as the engine, in walls-hall near a wall:
//  - during the moment the craft does not move, the frames and samples go on (not paused), no 'session' pause is written, the
//    engine is never silenced, and it plans the moment's cue alone (no height tone, no other cue);
//  - the null moment gives the flight back: the craft moves again and every cue sounds again;
//  - control: the lesson menu opened in a moment is a real pause (silenced, written), as before;
//  - the host pauses once for the phases of one moment, and release() gives the flight and every cue back.
import { describe, expect, it } from 'vitest';
import { S } from '../../../packages/sim-core/src';
import type { Sim } from '../../../packages/sim-core/src';
import { CuePlanner, createAnalyticWorld, defaultPrefs, getBuiltinTheme, getLesson } from '../../../packages/sonic-fpv/src';
import type { CueId, FramePlan, LessonDef, LessonLayers, MomentView, SessionEvent, Vec3 } from '../../../packages/sonic-fpv/src';
import { PauseStack } from '../../../apps/fly/src/app/pause-stack';
import type { PauseReason } from '../../../apps/fly/src/app/context';
import { SILENT_LAYERS, SonicBridge } from '../../../apps/fly/src/sonic/bridge';
import type { BridgeEngine, BridgeRunner, BridgeSession } from '../../../apps/fly/src/sonic/bridge';
import { MOMENT_PAUSE, MomentHost } from '../../../apps/fly/src/sonic/moment-host';

const HALL_LESSON = getLesson('walls-hall');
const HALL = createAnalyticWorld((HALL_LESSON.world as Extract<LessonDef['world'], { kind: 'analytic' }>).spec);

/** The session as the bridge reads it; the craft moves by its velocity only while the flight is not paused. */
class HeldFlight implements BridgeSession {
    readonly sim = { s: new Float64Array(S.size), tick: 0, ch: new Float64Array(8) } as unknown as Sim;
    readonly runner: BridgeRunner = { sim: this.sim, events: [], onStep: null };
    paused = false;
    replaying = false;
    get shownSim(): Sim {
        return this.sim;
    }
    put(pos: Vec3, vel: Vec3): void {
        const s = this.sim.s;
        [s[S.px], s[S.py], s[S.pz]] = pos;
        [s[S.vx], s[S.vy], s[S.vz]] = vel;
        s[S.qw] = 1;
        s[S.armed] = 1;
    }
    /** one 60 Hz step of the model: nothing while paused (sim time stands still) */
    step(): void {
        if (this.paused) return;
        const s = this.sim.s;
        s[S.px] += s[S.vx] / 60;
        s[S.py] += s[S.vy] / 60;
        s[S.pz] += s[S.vz] / 60;
        (this.sim as { tick: number }).tick++;
    }
    pos(): Vec3 {
        const s = this.sim.s;
        return [s[S.px], s[S.py], s[S.pz]];
    }
}

/** The page around a moment: the pause stack (flight.ts), the bridge, the planner as the engine, the moment host. */
function page() {
    const clock = { t: 0 };
    const events: SessionEvent[] = [];
    const flight = new HeldFlight();
    const bridge = new SonicBridge({ sample: () => undefined, event: (e) => events.push(e) }, () => clock.t);
    const planner = new CuePlanner({ theme: getBuiltinTheme('soft'), prefs: defaultPrefs(), layers: HALL_LESSON.layers });
    const layersSent: LessonLayers[] = [];
    let plan: FramePlan | null = null;
    const engine: BridgeEngine = {
        setLayers: (l) => { layersSent.push(l); planner.setLayers(l); },
        cue: (e) => void planner.cue(e),
        say: async () => undefined,
        update: (input) => { plan = planner.plan(input); },
        setAudible: (cues) => planner.setAudible(cues === null ? null : new Set(cues))
    };
    bridge.engine = engine;
    bridge.world = HALL;
    bridge.layers = HALL_LESSON.layers;
    let reasons: readonly PauseReason[] = [];
    const stack = new PauseStack<PauseReason>((on, r) => {
        flight.paused = on;
        reasons = r;
        bridge.syncPause();
    });
    bridge.momentOnly = () => reasons.length > 0 && reasons.every((r) => r === MOMENT_PAUSE);
    const ctx = { pause: (r: PauseReason) => stack.hold(r), resume: (r: PauseReason) => stack.release(r) };
    const moments = new MomentHost(ctx, bridge);
    bridge.start(flight);
    const frame = () => {
        clock.t += 1000 / 60;
        flight.step();
        const sample = bridge.frame()!;
        engine.update!({ sample, world: HALL, target: null, floorY: 0 });
        return { sample, plan: plan! };
    };
    return { clock, events, flight, bridge, layersSent, ctx, moments, frame };
}

/** 1.2 m from the hall's nearest wall, flying at it slowly. */
function nearWall(): { pos: Vec3; vel: Vec3 } {
    const start = HALL_LESSON.start.pos;
    const dirs: Vec3[] = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];
    let best: { d: Vec3; dist: number } | null = null;
    for (const d of dirs) {
        const hit = HALL.castRay(start, d, 50);
        if (hit !== null && (best === null || hit.distance < best.dist)) best = { d, dist: hit.distance };
    }
    const b = best!;
    const go = b.dist - 1.2;
    return { pos: [start[0] + b.d[0] * go, start[1], start[2] + b.d[2] * go], vel: [b.d[0] * 0.4, 0, b.d[2] * 0.4] };
}

const WALL: CueId = 'safety.wall';
const view = (phase: MomentView['phase'], form = 0): MomentView => ({ id: 'wall-ahead', cue: WALL, phase, form });

describe('a moment freezes the flight and sounds its cue alone (tutor-air S1)', () => {
    it('the craft holds, the frames and the engine go on with the moment cue alone, then the flight goes on', () => {
        const p = page();
        const w = nearWall();
        p.flight.put(w.pos, w.vel);
        for (let i = 0; i < 30; i++) p.frame();
        const before = p.frame();
        // before: the room sounds as a lesson does (the height tone and the walls)
        expect(before.plan.height).not.toBeNull();
        expect(before.plan.voices.map((v) => v.cue)).toEqual([WALL]);
        expect(before.plan.cues.map((c) => c.id.split(':')[0])).toEqual(expect.arrayContaining(['height.tone', 'room.bed']));

        // the runner's moment: the gate first, then the freeze (moments.ts freeze())
        expect(p.moments.act({ kind: 'audible', cues: [WALL] })).toBe(true);
        expect(p.moments.act({ kind: 'moment', moment: view('what') })).toBe(true);
        expect(p.flight.paused).toBe(true);
        expect(p.moments.frozen).toBe(true);
        const held = p.flight.pos();
        const sessionEvents = p.events.filter((e) => e.kind === 'session').length;
        const silentBefore = p.layersSent.filter((l) => l === SILENT_LAYERS).length;
        p.moments.act({ kind: 'moment', moment: view('sound') });
        for (let i = 0; i < 120; i++) {
            const f = p.frame();
            // the craft holds for the whole moment
            expect(f.sample.pos).toEqual(held);
            // the frames go on for the runner: the sample is not a paused one
            expect(f.sample.paused).toBe(false);
            // the engine plans the moment's cue and nothing else
            expect(f.plan.height).toBeNull();
            expect(f.plan.speed).toBeNull();
            expect(f.plan.voices.every((v) => v.cue === WALL)).toBe(true);
            // the active cues by their id ('<cue>:<sector>'): the wall alone, no height tone, no room bed
            expect(f.plan.cues.map((c) => c.id.split(':')[0])).toEqual(f.plan.cues.map(() => WALL));
        }
        expect(p.frame().plan.voices.map((v) => v.cue)).toEqual([WALL]);
        expect(p.events.filter((e) => e.kind === 'session').length).toBe(sessionEvents);
        expect(p.layersSent.filter((l) => l === SILENT_LAYERS).length).toBe(silentBefore);
        expect(p.bridge.paused).toBe(false);

        // the moment ends: the flight and every cue go on
        p.moments.act({ kind: 'moment', moment: null });
        p.moments.act({ kind: 'audible', cues: null });
        expect(p.flight.paused).toBe(false);
        const after = p.frame();
        expect(after.sample.pos).not.toEqual(held);
        expect(after.plan.height).not.toBeNull();
    });

    it('control: the lesson menu opened in a moment is a real pause (silenced, written), and the moment holds after it', () => {
        const p = page();
        const w = nearWall();
        p.flight.put(w.pos, w.vel);
        p.frame();
        p.moments.act({ kind: 'audible', cues: [WALL] });
        p.moments.act({ kind: 'moment', moment: view('what') });
        p.frame();
        expect(p.bridge.paused).toBe(false);
        p.ctx.pause('menu');
        const f = p.frame();
        expect(f.sample.paused).toBe(true);
        expect(p.bridge.paused).toBe(true);
        expect(p.layersSent.at(-1)).toBe(SILENT_LAYERS);
        expect(p.events.filter((e) => e.kind === 'session').map((e) => (e as { what: string }).what)).toEqual(['pause']);
        p.ctx.resume('menu');
        const g = p.frame();
        expect(g.sample.paused).toBe(false);
        // the moment still holds the craft
        expect(p.flight.paused).toBe(true);
        expect(p.frame().sample.pos).toEqual(g.sample.pos);
    });

    it('one pause for the phases of a moment; release() gives the flight and every cue back', () => {
        const held: string[] = [];
        const audible: (readonly CueId[] | null)[] = [];
        const m = new MomentHost({ pause: (r) => held.push(`pause:${r}`), resume: (r) => held.push(`resume:${r}`) }, { setAudible: (c) => audible.push(c) });
        const seen: (MomentView | null)[] = [];
        m.onView((v) => seen.push(v));
        m.act({ kind: 'audible', cues: [WALL] });
        for (const ph of ['what', 'sound', 'do'] as const) m.act({ kind: 'moment', moment: view(ph) });
        expect(held).toEqual(['pause:moment']);
        expect(m.view?.phase).toBe('do');
        expect(m.act({ kind: 'say', lines: [] } as never)).toBe(false);
        m.release();
        expect(held).toEqual(['pause:moment', 'resume:moment']);
        expect(audible).toEqual([[WALL], null]);
        expect(m.frozen).toBe(false);
        expect(seen.map((v) => v?.phase ?? null)).toEqual(['what', 'sound', 'do', null]);
        // nothing held, nothing gated: release() again does nothing
        m.release();
        expect(held.length).toBe(2);
        expect(audible.length).toBe(2);
    });
});
