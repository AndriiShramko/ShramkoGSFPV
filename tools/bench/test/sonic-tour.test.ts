// Train 4, lane tutor-air S3 (decision 5 of the brief): "What is this sound?" (key G, sound-tour.ts). Driven with the page's own
// PauseStack, the bridge, a craft that moves only while the flight is not paused and the package's real CuePlanner as the engine,
// in walls-hall near a wall:
//  - the tour freezes the flight (the craft holds, the lesson runner's pause is written: its clocks stand) but the engine is never
//    silenced; while a name is spoken nothing sounds; then each sound of the plan a moment ago plays alone (the plan holds that cue
//    and no other), the safety one first, each named once by the package's `cue.<id>.name`; then the flight and every cue go on;
//  - nothing audible: one line with the key, no freeze;
//  - G again ends it at once and gives the lesson's own gate back;
//  - the keymap: G is sonic.whatSound (the glossary stays a lesson of the menu), K's help names it.
import { describe, expect, it } from 'vitest';
import { S } from '../../../packages/sim-core/src';
import type { Sim } from '../../../packages/sim-core/src';
import { CuePlanner, DICTS, createAnalyticWorld, createTranslator, defaultPrefs, getBuiltinTheme, getLesson } from '../../../packages/sonic-fpv/src';
import type { CueId, FramePlan, LessonDef, LessonLayers, SessionEvent, SpeechLine, Vec3 } from '../../../packages/sonic-fpv/src';
import { KEYMAP } from '../../../packages/prefs/src/keymap';
import { PauseStack } from '../../../apps/fly/src/app/pause-stack';
import type { PauseReason } from '../../../apps/fly/src/app/context';
import { SILENT_LAYERS, SonicBridge } from '../../../apps/fly/src/sonic/bridge';
import type { BridgeEngine, BridgeRunner, BridgeSession } from '../../../apps/fly/src/sonic/bridge';
import { KEY_HELP } from '../../../apps/fly/src/sonic/mode-keys';
import { SoundTour, TOUR_PAUSE, audibleCues } from '../../../apps/fly/src/sonic/sound-tour';

const HALL_LESSON = getLesson('walls-hall');
const HALL = createAnalyticWorld((HALL_LESSON.world as Extract<LessonDef['world'], { kind: 'analytic' }>).spec);
const EN = createTranslator('en', DICTS);
const nameOf = (cue: CueId): string | null => (EN.has(`cue.${cue}.name`) ? EN.text({ key: `cue.${cue}.name` }) : null);
const base = (id: string): string => id.split(':')[0] as string;

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

type Phase = 'speech' | CueId;

/** The page around the tour: the pause stack, the bridge, the planner as the engine, the tour with fake speech and waits that run frames. */
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
        setAudible: (cues) => planner.setAudible(cues === null ? null : new Set(cues)),
        activeCues: () => plan?.cues ?? []
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
    const ctx = { pause: (r: PauseReason) => stack.hold(r), resume: (r: PauseReason) => stack.release(r) };
    bridge.start(flight);
    const frame = () => {
        clock.t += 1000 / 60;
        flight.step();
        const sample = bridge.frame()!;
        engine.update!({ sample, world: HALL, target: null, floorY: 0 });
        return { sample, plan: plan! };
    };
    const seen: { phase: Phase; pos: Vec3; cues: string[]; paused: boolean }[] = [];
    const lines: SpeechLine[] = [];
    const shown: (CueId | null)[] = [];
    let cueNow: CueId | null = null;
    const run = (n: number, phase: Phase) => {
        for (let i = 0; i < n; i++) {
            const f = frame();
            seen.push({ phase, pos: [...f.sample.pos] as Vec3, cues: f.plan.cues.map((c) => base(c.id)), paused: f.sample.paused });
        }
    };
    let tour: SoundTour | null = null;
    tour = new SoundTour(
        ctx,
        {
            activeCues: () => bridge.activeCues(),
            get audibleNow() {
                return bridge.audibleNow;
            },
            setAudible: (c) => bridge.setAudible(c),
            cue: (e) => {
                if (e.kind === 'repeat-cue') cueNow = e.cue;
                engine.cue(e);
            },
            say: async (line) => {
                lines.push(line);
                cueNow = null;
                run(30, 'speech');
            }
        },
        { showCue: (c) => void shown.push(c) },
        { name: nameOf, key: () => 'G', wait: async (ms) => run(Math.round(ms / (1000 / 60)), cueNow ?? 'speech') }
    );
    bridge.soundsOnPause = () => tour !== null && tour.running && reasons.every((r) => r === TOUR_PAUSE);
    return { events, flight, bridge, layersSent, tour, frame, run, seen, lines, shown, stack };
}

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

describe('"What is this sound?" names each sound heard now and plays it alone (tutor-air S3)', () => {
    it('freezes the flight, names and plays each audible cue alone (safety first), then the flight and every cue go on', async () => {
        const p = page();
        const w = nearWall();
        p.flight.put(w.pos, w.vel);
        for (let i = 0; i < 30; i++) p.frame();
        const before = p.frame().plan.cues.map((c) => base(c.id));
        expect(before).toEqual(expect.arrayContaining(['safety.wall', 'height.tone']));
        const want = audibleCues(p.bridge.activeCues(), nameOf).map((c) => c.cue);
        expect(want[0]).toBe('safety.wall');
        expect(new Set(want)).toEqual(new Set(before.filter((c) => nameOf(c) !== null)));
        const silentBefore = p.layersSent.filter((l) => l === SILENT_LAYERS).length;

        const end = await p.tour.start();
        expect(end).toBe('done');
        // the lines: each sound's name once, in order, then back to the flight
        expect(p.lines.map((l) => l.key)).toEqual([...want.map(() => 'sonic.say.tourName'), 'sonic.say.helpCut']);
        expect(p.lines.map((l) => l.params?.['name'])).toEqual([...want.map((c) => nameOf(c)), undefined]);
        expect(p.lines[0]?.params).toMatchObject({ n: 1, of: want.length });
        // the card names each sound, then hides
        expect(p.shown.filter((c) => c !== null)).toEqual(want);
        expect(p.shown.at(-1)).toBeNull();
        // the whole tour: the craft holds, the frames are paused ones (the runner waits), the engine is never silenced
        const held = p.seen[0]!.pos;
        expect(p.seen.every((s) => s.paused && s.pos.every((v, i) => v === held[i]))).toBe(true);
        expect(p.layersSent.filter((l) => l === SILENT_LAYERS).length).toBe(silentBefore);
        // while a name is spoken nothing sounds; while a cue plays it sounds alone
        for (const s of p.seen.filter((x) => x.phase === 'speech').slice(5)) expect(s.cues).toEqual([]);
        for (const cue of want) {
            const plays = p.seen.filter((s) => s.phase === cue);
            expect(plays.length).toBeGreaterThan(100);
            expect(plays.some((s) => s.cues.length > 0)).toBe(true);
            for (const s of plays) expect(s.cues.every((c) => c === cue)).toBe(true);
        }
        // the 'session' pause and resume were written (the lesson's clocks stood)
        expect(p.events.filter((e) => e.kind === 'session').map((e) => (e as { what: string }).what)).toEqual(['pause', 'resume']);
        // then the flight goes on: the craft moves and every cue sounds again
        expect(p.tour.running).toBe(false);
        expect(p.bridge.audibleNow).toBeNull();
        const a = p.frame();
        const b = p.frame();
        expect(b.sample.pos).not.toEqual(a.sample.pos);
        expect(b.sample.paused).toBe(false);
        expect(b.plan.cues.map((c) => base(c.id))).toEqual(expect.arrayContaining(['safety.wall', 'height.tone']));
    });

    it('nothing audible: one line with the key, and the flight is not frozen', async () => {
        const p = page();
        p.flight.put(HALL_LESSON.start.pos, [0, 0, 0]);
        p.bridge.setAudible([]);
        for (let i = 0; i < 10; i++) p.frame();
        expect(await p.tour.start()).toBe('none');
        expect(p.lines).toEqual([{ key: 'sonic.say.tourNone', params: { key: 'G' } }]);
        expect(p.flight.paused).toBe(false);
        expect(p.shown).toEqual([]);
    });

    it('G again ends the tour at once and gives the lesson its own gate back', async () => {
        const p = page();
        const w = nearWall();
        p.flight.put(w.pos, w.vel);
        p.bridge.setAudible(['safety.wall', 'height.tone']);
        for (let i = 0; i < 30; i++) p.frame();
        const first = p.tour.start();
        expect(p.tour.running).toBe(true);
        expect(p.flight.paused).toBe(true);
        expect(await p.tour.start()).toBe('stopped');
        expect(await first).toBe('stopped');
        expect(p.flight.paused).toBe(false);
        expect(p.bridge.audibleNow).toEqual(['safety.wall', 'height.tone']);
        expect(p.shown.at(-1)).toBeNull();
    });

    it('G is "What is this sound?" in the keymap and in K\'s help; the glossary is no key', () => {
        const g = KEYMAP.filter((b) => b.keys.some((k) => k.code === 'KeyG' && k.shift !== true));
        expect(g.map((b) => b.action)).toEqual(['sonic.whatSound']);
        expect(KEYMAP.some((b) => (b.action as string) === 'sonic.glossary')).toBe(false);
        expect(KEY_HELP.find(([, action]) => action === 'sonic.whatSound')?.[0]).toBe('sonic.say.helpWhatSound');
    });
});
