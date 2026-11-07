// v0.12 Fly by Sound, lane v12-flight step 5 (docs/wip/v12-plan.md 1, 2.6 and 4.2): the mode in the flight page
// (apps/fly/src/sonic/mode.ts, installed by app/builtin/sonic-flight.ts), on the real FlightSession in a lesson world
// (the corridor lesson, with a checkpoint 4 m in), flown by the real lesson pilot.
//  - a checkpoint reset (R short) moves the spawn and respawns by R's own path: a logged 'manual-start' life at the
//    checkpoint's pose, and every life replays to the hash it was flown with (control: the same move made on the
//    model behind the log's back replays apart);
//  - R held 0.7 s goes to the lesson's start while still held, its release adds nothing; a radio switch's R is short;
//  - N is the lesson's next step, never a scene switch; [ ] say the size is locked; leave() gives every key back;
//  - while entered the session layer holds crash.enabled false and input.play easy, the lesson's assists go to the
//    input; leave() takes them all out;
//  - a touch counts and, for a 'bump-recentre' lesson with no runner, puts the craft back at the last checkpoint.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MODE_CHANNEL, S, replayLives } from '../../../packages/sim-core/src';
import { getLesson } from '../../../packages/sonic-fpv/src';
import type { LessonDef, SessionEvent } from '../../../packages/sonic-fpv/src';
import { FlightSession } from '../../../apps/fly/src/session';
import type { SessionOptions } from '../../../apps/fly/src/session';
import { depsFor, lifeProblem } from '../../../apps/fly/src/session/replay';
import { Bus } from '../../../apps/fly/src/app/context';
import type { AppEvents } from '../../../apps/fly/src/app/context';
import type { ActionHandler } from '../../../apps/fly/src/app/keys';
import { LessonPilot, rayClearance } from '../../../apps/fly/src/play/lesson-pilot';
import { LONG_PRESS_MS, MODE_PREFS, SonicMode } from '../../../apps/fly/src/sonic/mode';
import { lessonWorldOf } from '../../../apps/fly/src/sonic/lesson-world';

/** A renderer that draws nothing (as wind-session.test.ts). */
function nullRenderer(): NonNullable<SessionOptions['renderer']> {
    const app = { on() { /* no frames */ }, off() { /* no frames */ } };
    return new Proxy({}, { get: (_t, k) => (k === 'app' ? app : k === 'then' ? undefined : () => undefined) }) as NonNullable<SessionOptions['renderer']>;
}

/** The corridor lesson with a checkpoint 4 m in (its own first one is at the start). */
const BASE = getLesson('corridor');
const LESSON: LessonDef = { ...BASE, checkpoints: [{ id: 'cp-near', at: [0, 2, -4], radiusM: 1.5, pose: { pos: [0, 2, -4], yawDeg: 0 } }] };

/** The page around the mode: the real session, the mode with a host of fakes that record, the lesson pilot flying it. */
class Page {
    readonly clock = { t: 0 };
    readonly events = new Bus<AppEvents>();
    readonly sonic: SessionEvent[] = [];
    readonly sessionPrefs = new Map<string, unknown>();
    readonly keys = new Map<string, ActionHandler[]>();
    readonly notes: string[] = [];
    readonly lessons: (LessonDef['assists'] | null)[] = [];
    readonly mode: SonicMode;
    pilot: LessonPilot;

    constructor(readonly ses: FlightSession) {
        vi.spyOn(performance, 'now').mockImplementation(() => this.clock.t);
        this.events.on('sonicEvent', (e) => this.sonic.push(e));
        this.mode = new SonicMode({
            events: this.events,
            prefs: {
                setSession: (id: string, v: unknown) => { this.sessionPrefs.set(id, v); return { ok: true, value: v } as never; },
                clearSession: (id?: string) => { if (id) this.sessionPrefs.delete(id); }
            },
            session: () => this.ses,
            setLesson: (a) => this.lessons.push(a),
            onKey: (action, run) => {
                const list = this.keys.get(action) ?? [];
                list.push(run);
                this.keys.set(action, list);
                return () => { const i = list.indexOf(run); if (i >= 0) list.splice(i, 1); };
            },
            note: (k) => this.notes.push(k)
        });
        this.pilot = new LessonPilot({ sim: () => this.ses.sim, paused: () => false, ground: (sim) => rayClearance(this.ses.collision, sim) }, LESSON.assists);
        // a new life: the pilot starts from the new craft (sonic-flight.ts does this on 'life')
        ses.onLife = () => this.pilot.resetFlight();
    }

    /** A key as the router runs it: the last handler of the action. */
    press(action: string, o: { repeat?: boolean; source?: 'key' | 'switch' } = {}): boolean {
        const run = this.keys.get(action)?.at(-1);
        if (!run) return false;
        run({ repeat: o.repeat ?? false, code: '' } as KeyboardEvent, o.source ?? 'key');
        return true;
    }

    /** `ms` of flight: the pilot's intents every 10 ms through the lesson pilot into the runner, a frame every 16 ms. */
    fly(ms: number, k: { forward?: number; strafe?: number; lift?: number; turn?: number } = {}): void {
        const r = this.ses.runner;
        const out = new Float32Array(8);
        for (let i = 0; i < ms; i += 2) {
            const t = this.clock.t;
            if (t % 10 === 0) {
                this.pilot.apply([k.strafe ?? 0, k.forward ?? 0, k.lift ?? 0, k.turn ?? 0, -1, 0, 0, 0], out, t);
                out[5] = MODE_CHANNEL.angle;
                this.ses.runner.enqueue({ tUs: t * 1000, ch: Array.from(out) });
            }
            this.clock.t += 2;
            this.ses.runner.advanceTo(this.clock.t * 1000);
            if (this.clock.t % 16 === 0) this.mode.frame(this.clock.t);
            void r;
        }
    }
}

let page: Page | null = null;
afterEach(() => {
    page?.ses.dispose();
    page = null;
    vi.restoreAllMocks();
});

async function open(): Promise<Page> {
    const lw = lessonWorldOf(LESSON)!;
    const ses = await FlightSession.start({} as HTMLCanvasElement, { sceneId: lw.builtin.scene.id, world: lw.builtin, renderer: nullRenderer(), crashOn: false, windSeed: 5 });
    page = new Page(ses);
    return page;
}

describe('a checkpoint reset is R\'s own respawn, so the flight log replays it', () => {
    it('R short after passing the checkpoint: a manual-start life at its pose; every life replays to its hash; control: the move behind the log\'s back replays apart', async () => {
        const p = await open();
        p.mode.enter({ lesson: LESSON });
        p.fly(1000);
        p.fly(4000, { forward: 1 }); // through the checkpoint at 4 m and on
        expect(p.ses.sim.s[S.pz]).toBeLessThan(-6);
        p.press('respawn.start');
        p.mode.releaseR();
        p.fly(500);
        const lives = p.ses.lives();
        const reset = lives.at(-1)!;
        expect(reset.header.life.reason).toBe('manual-start');
        expect(reset.header.life.at).toEqual([0, 2, -4, 0]);
        expect(Math.hypot(p.ses.sim.s[S.px], p.ses.sim.s[S.py] - 2, p.ses.sim.s[S.pz] + 4)).toBeLessThan(0.5);
        expect(p.sonic.filter((e) => e.kind === 'key')).toMatchObject([{ kind: 'key', code: 'KeyR', action: 'reset.checkpoint' }]);
        p.fly(2000, { forward: 1, strafe: 0.5 });
        const all = p.ses.lives();
        expect(all.length).toBeGreaterThanOrEqual(2);
        for (const [i, life] of all.entries()) {
            expect(lifeProblem(life.header, p.ses.wallsSource)).toBeNull();
            const current = i === all.length - 1;
            const endTick = current ? p.ses.runner.sim.tick : life.endTick;
            const recorded = current ? p.ses.runner.liveLifeHash()!.hash : life.traceHash!;
            expect(replayLives([life], depsFor(life.header, p.ses.wallsSource), { endTick }).hash).toBe(recorded);
        }
        // control: the same move made on the model itself, not through the respawn path, is not in the log
        const before = p.ses.lives().length;
        p.ses.sim.reset(0, 2, -4, 0, { keepArmed: true });
        p.fly(1000, { forward: 1 });
        expect(p.ses.lives().length).toBe(before);
        const last = p.ses.lives().at(-1)!;
        expect(replayLives([last], depsFor(last.header, p.ses.wallsSource), { endTick: p.ses.runner.sim.tick }).hash).not.toBe(p.ses.runner.liveLifeHash()!.hash);
    });
});

describe('R short and long, N, [ ]', () => {
    it('R held 0.7 s: the start while still held, the release adds nothing; a quick R: the checkpoint; a switch\'s R: short; key repeats ignored', async () => {
        const p = await open();
        p.mode.enter({ lesson: LESSON });
        p.fly(500);
        p.fly(4000, { forward: 1 });
        p.press('respawn.start');
        p.fly(LONG_PRESS_MS - 100, { forward: 1 });
        expect(p.sonic.filter((e) => e.kind === 'key')).toHaveLength(0); // not yet
        p.press('respawn.start', { repeat: true }); // the key's auto-repeat
        p.fly(200, { forward: 1 });
        p.mode.releaseR();
        let keys = p.sonic.filter((e) => e.kind === 'key');
        expect(keys).toMatchObject([{ action: 'reset.start' }]);
        p.fly(300);
        expect(p.ses.lives().at(-1)!.header.life.at).toEqual([...LESSON.start.pos, LESSON.start.yawDeg]);
        p.press('respawn.start', { source: 'switch' });
        keys = p.sonic.filter((e) => e.kind === 'key');
        expect(keys.map((e) => (e.kind === 'key' ? e.action : ''))).toEqual(['reset.start', 'reset.checkpoint']);
    });

    it('N is the next step (a key event), never a scene switch; [ ] note the lock; leave() gives the keys back', async () => {
        const p = await open();
        const sceneNext = vi.fn();
        // what the page had before the mode: the scene switch on N, the scale on [ ], R's respawn
        p.keys.set('scene.next', [sceneNext]);
        p.keys.set('scale.down', [vi.fn()]);
        p.keys.set('scale.up', [vi.fn()]);
        p.keys.set('respawn.start', [vi.fn()]);
        p.mode.enter({ lesson: LESSON });
        p.press('scene.next');
        expect(sceneNext).not.toHaveBeenCalled();
        expect(p.sonic.filter((e) => e.kind === 'key')).toMatchObject([{ code: 'KeyN', action: 'next' }]);
        p.press('scale.down');
        p.press('scale.up');
        expect(p.notes).toEqual(['sonic.scaleLocked', 'sonic.scaleLocked']);
        p.mode.leave();
        for (const a of ['scene.next', 'scale.down', 'scale.up', 'respawn.start']) expect(p.keys.get(a)).toHaveLength(1);
        p.press('scene.next');
        expect(sceneNext).toHaveBeenCalledTimes(1);
    });
});

describe('the mode\'s settings and assists, in and out', () => {
    it('enter: crash.enabled false and input.play easy in the session layer, the lesson\'s assists to the input; leave: all out', async () => {
        const p = await open();
        expect(MODE_PREFS).toEqual({ 'crash.enabled': false, 'input.play': 'easy' });
        p.mode.enter({ lesson: LESSON });
        expect(Object.fromEntries(p.sessionPrefs)).toEqual({ 'crash.enabled': false, 'input.play': 'easy' });
        expect(p.lessons).toEqual([LESSON.assists]);
        expect(p.mode.active).toBe(true);
        p.mode.leave();
        expect(p.sessionPrefs.size).toBe(0);
        expect(p.lessons).toEqual([LESSON.assists, null]);
        expect(p.mode.active).toBe(false);
        // off: a frame does nothing, a key press finds no handler of the mode's
        expect(p.mode.frame(16)).toBeNull();
        expect(p.press('scene.next')).toBe(false);
    });
});

describe('touches', () => {
    it('a bump into the corridor\'s wall counts, and the bump-recentre lesson puts the craft back at the last checkpoint', async () => {
        const p = await open();
        p.mode.enter({ lesson: LESSON });
        p.fly(500);
        p.fly(4000, { forward: 1 }); // past the checkpoint
        const before = p.ses.lives().length;
        p.fly(4000, { strafe: 1 }); // into the right wall (2.5 m away)
        expect(p.mode.touches).toBeGreaterThanOrEqual(1);
        const after = p.ses.lives().slice(before);
        expect(after.length).toBeGreaterThanOrEqual(1);
        expect(after[0].header.life.reason).toBe('manual-start');
        expect(after[0].header.life.at).toEqual([0, 2, -4, 0]);
    });
});
