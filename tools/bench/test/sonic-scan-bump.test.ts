// v0.13 v13-int step 4 (docs/wip/v13-int.md): a lesson on a scan flies with the lesson's bump too. free-garden (the Winter Garden scan)
// kept the drone's own contact (lane v13-look made the bump of M41-19, sim-core BumpRule 'slide', the rule of the lesson worlds only:
// BuiltinWorld.overrides), so a pilot could stick to a scan's wall there. The mode now decides it while a lesson runs on a scan
// (sonic/mode.ts: FlightSession.setLessonFlight with LESSON_FLIGHT, applied as a 'life' setting) and gives the drone's contact back
// when the lesson ends.
//   - the mode on a scan session (here walls-pillar's room seen as voxels and flown through a VoxelContactWorld with no rules of its
//     own, as the lesson rig flies a scan): the session's next lives fly 'slide' while free-garden runs, a new life starts with it at
//     once, and after leave() the drone's own contact comes back; a lesson world (walls-hall) is left as it is (it brings the rule
//     itself, no new life for it); the ordinary simulator never meets it (the reference hash: a6-reference.test.ts);
//   - the flight: the craft flown by the lesson pilot (free-garden's assists) into the scan's pillar at 0, 30 and 60 degrees from its
//     normal and 2 to 4 m/s, the stick let go or pointed away at the first contact: out of contact (2 cm off every surface, no contact
//     after) within 0.3 s, as v13-look's probe asks of the lesson worlds (sonic-bump.test.ts); control: the same flights with the
//     drone's own contact (the session outside the lesson) stay on the pillar past 0.3 s in most cases.
// The Winter Garden's own walls (.cache/scenes/7a475d38): sonic-garden.test.ts flies the lesson on them end to end.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MODE_CHANNEL, S } from '../../../packages/sim-core/src';
import { VoxelContactWorld } from '../../../packages/collision/src';
import { getLesson } from '../../../packages/sonic-fpv/src';
import type { LessonAssists } from '../../../packages/sonic-fpv/src';
import { FlightSession } from '../../../apps/fly/src/session';
import type { SessionOptions } from '../../../apps/fly/src/session';
import { Bus } from '../../../apps/fly/src/app/context';
import type { AppEvents } from '../../../apps/fly/src/app/context';
import { LessonPilot, rayClearance, rayClearanceUp } from '../../../apps/fly/src/play/lesson-pilot';
import { SonicMode } from '../../../apps/fly/src/sonic/mode';
import { LESSON_FLIGHT, lessonWorldOf } from '../../../apps/fly/src/sonic/lesson-world';
import type { LessonWorld } from '../../../apps/fly/src/sonic/lesson-world';

/** Out of contact: this far off every surface, with no contact after it, within OUT_WITHIN_S of the stick's move (v13-look's probe). */
const OUT_GAP_M = 0.02;
const OUT_WITHIN_S = 0.3;
const OUT_WATCH_S = 1;
const LEFT_M = 0.25;
const RAD = Math.PI / 180;

/** A renderer that draws nothing (as wind-session.test.ts). */
function nullRenderer(): NonNullable<SessionOptions['renderer']> {
    const app = { on() { /* no frames */ }, off() { /* no frames */ } };
    return new Proxy({}, { get: (_t, k) => (k === 'app' ? app : k === 'then' ? undefined : () => undefined) }) as NonNullable<SessionOptions['renderer']>;
}

const GARDEN = getLesson('free-garden');
let PILLAR_ROOM: LessonWorld | null = null;
const room = (): LessonWorld => (PILLAR_ROOM ??= lessonWorldOf(getLesson('walls-pillar'))!);

/** walls-pillar's room as a scan: its voxels flown through a VoxelContactWorld, no flight rules of its own (BuiltinWorld.overrides none). */
async function scanSession(): Promise<FlightSession> {
    const w = room();
    const scene = { ...w.builtin.scene, id: '0badc0de' };
    return FlightSession.start({} as HTMLCanvasElement, {
        sceneId: scene.id,
        world: { scene, collision: w.collision, contact: new VoxelContactWorld(w.collision), sha256: 'scan-stand-in', spawn: [0, 1.5, 4, 0] },
        renderer: nullRenderer(),
        crashOn: false,
        windSeed: 5
    });
}

/** The page around the mode (sonic-mode.test.ts's): the real session, the mode with a host that records, the lesson pilot flying. */
class Page {
    readonly clock = { t: 0 };
    readonly mode: SonicMode;
    readonly pilot: LessonPilot;
    readonly walls: VoxelContactWorld;
    /** contacts off the respawn platform: when and how fast */
    contacts: { t: number; speed: number }[] = [];
    private seenTick = -1;

    constructor(readonly ses: FlightSession, assists: LessonAssists) {
        vi.spyOn(performance, 'now').mockImplementation(() => this.clock.t);
        this.walls = new VoxelContactWorld(room().collision);
        this.mode = new SonicMode({
            events: new Bus<AppEvents>(),
            prefs: { setSession: (_id: string, v: unknown) => ({ ok: true, value: v }) as never, clearSession: () => undefined },
            session: () => this.ses,
            setLesson: () => undefined,
            onKey: () => () => undefined,
            note: () => undefined
        });
        this.pilot = new LessonPilot({ sim: () => this.ses.sim, paused: () => false, ground: (sim) => rayClearance(room().collision, sim), above: (sim) => rayClearanceUp(room().collision, sim) }, assists);
        ses.onLife = () => this.pilot.resetFlight();
    }

    /** `ms` of flight: the pilot's intents every 10 ms into the runner, the model at 1 kHz; `each` after every 2 ms (false stops). */
    fly(ms: number, k: { forward?: number; strafe?: number } = {}, each?: () => boolean | void): void {
        const out = new Float32Array(8);
        for (let i = 0; i < ms; i += 2) {
            const t = this.clock.t;
            if (t % 10 === 0) {
                this.pilot.apply([k.strafe ?? 0, k.forward ?? 0, 0, 0, -1, 0, 0, 0], out, t);
                out[5] = MODE_CHANNEL.angle;
                this.ses.runner.enqueue({ tUs: t * 1000, ch: Array.from(out) });
            }
            this.clock.t += 2;
            this.ses.runner.advanceTo(this.clock.t * 1000);
            this.readContacts();
            if (each && each() === false) return;
        }
    }

    private readContacts(): void {
        const sim = this.ses.sim;
        if (sim.tick < this.seenTick) this.seenTick = -1;
        for (const e of sim.events) if (e.tick > this.seenTick && e.type === 'contact' && sim.s[S.platOn] === 0) this.contacts.push({ t: this.clock.t, speed: e.speed });
        this.seenTick = sim.tick;
    }

    /** The gap between the body and the scan's walls, m (0 when a sphere overlaps), to 0.5 mm, up to `cap` (v13-look's measure). */
    gap(cap = LEFT_M): number {
        const sim = this.ses.sim;
        const s = sim.s, sp = sim.p.spheres;
        const qw = s[S.qw], qx = s[S.qx], qy = s[S.qy], qz = s[S.qz];
        const r00 = 1 - 2 * (qy * qy + qz * qz), r01 = 2 * (qx * qy - qw * qz), r02 = 2 * (qx * qz + qw * qy);
        const r10 = 2 * (qx * qy + qw * qz), r11 = 1 - 2 * (qx * qx + qz * qz), r12 = 2 * (qy * qz - qw * qx);
        const r20 = 2 * (qx * qz - qw * qy), r21 = 2 * (qy * qz + qw * qx), r22 = 1 - 2 * (qx * qx + qy * qy);
        let best = cap;
        for (let i = 0; i < sp.length; i += 4) {
            const lx = sp[i]!, ly = sp[i + 1]!, lz = sp[i + 2]!, r = sp[i + 3]!;
            const x = s[S.px] + r00 * lx + r01 * ly + r02 * lz, y = s[S.py] + r10 * lx + r11 * ly + r12 * lz, z = s[S.pz] + r20 * lx + r21 * ly + r22 * lz;
            if (this.walls.overlap(x, y, z, r)) return 0;
            if (!this.walls.overlap(x, y, z, r + best)) continue;
            let lo = 0, hi = best;
            while (hi - lo > 0.0005) {
                const m = (lo + hi) / 2;
                if (this.walls.overlap(x, y, z, r + m)) hi = m;
                else lo = m;
            }
            best = Math.min(best, lo);
        }
        return best;
    }
}

let page: Page | null = null;
afterEach(() => {
    page?.ses.dispose();
    page = null;
    vi.restoreAllMocks();
});

interface Case { readonly angleDeg: number; readonly speed: number; readonly after: 'release' | 'away' }
interface Outcome extends Case { readonly bump: string; readonly hitMps: number | null; readonly outS: number | null }

/**
 * One flight at the scan's pillar: the craft placed 4 m before it (off its axis so the line meets its surface at the case's angle),
 * hovering, then flown at it; at the first contact the stick is let go or pointed away along the surface's normal there, and the
 * watch asks from when on the craft is out of contact. `lesson`: free-garden runs (the mode entered), else the ordinary flight.
 */
async function atThePillar(c: Case, lesson: boolean): Promise<Outcome> {
    const ses = await scanSession();
    const p = (page = new Page(ses, { ...GARDEN.assists, maxSpeedMps: c.speed }));
    if (lesson) p.mode.enter({ lesson: GARDEN });
    const pillar = room().world.objects().find((o) => o.shape.kind === 'pillar')!;
    const a = c.angleDeg * RAD;
    const reach = 0.3 + 0.05;
    ses.spawn = [pillar.pos[0] + reach * Math.sin(a), 1.5, pillar.pos[2] + 4, 0];
    ses.respawnStart();
    p.fly(1500);
    p.contacts = [];
    let hit = -1;
    p.fly(8000, { forward: 1 }, () => {
        if (p.contacts.length > 0) hit = p.clock.t;
        return hit < 0;
    });
    const bump = ses.sim.p.bump;
    if (hit < 0) return { ...c, bump, hitMps: null, outS: null };
    const hitMps = p.contacts[0]!.speed;
    const t0 = p.clock.t;
    const n0 = p.contacts.length;
    // away: along the pillar's normal where the line meets it (from its axis to the contact), as sticks: right is +x, forward is -z
    const k = c.after === 'away' ? { strafe: Math.sin(a), forward: -Math.cos(a) } : {};
    let outAt: number | null = null;
    p.fly(OUT_WATCH_S * 1000, k, () => {
        const g = p.gap();
        const touched = p.contacts.length > n0 && p.contacts[p.contacts.length - 1]!.t === p.clock.t;
        if (g < OUT_GAP_M || touched) outAt = null;
        else if (outAt === null) outAt = p.clock.t;
        return g < LEFT_M;
    });
    ses.dispose();
    page = null;
    return { ...c, bump, hitMps, outS: outAt === null ? null : (outAt - t0) / 1000 };
}

const CASES: Case[] = [0, 30, 60].flatMap((angleDeg) => [2, 3, 4].flatMap((speed) => (['release', 'away'] as const).map((after) => ({ angleDeg, speed, after }))));
const label = (o: Outcome): string => `${o.angleDeg} deg ${o.speed} m/s ${o.after}: hit ${o.hitMps?.toFixed(2)} m/s, out ${o.outS === null ? 'never' : `${o.outS.toFixed(3)} s`}`;

describe('v13-int step 4: a lesson on a scan flies with the lesson\'s bump, and only while it runs', () => {
    it('free-garden on a scan: the next lives fly \'slide\' from the mode\'s enter (a new life at once), the drone\'s own contact after leave(); a lesson world is left as it is', async () => {
        expect(GARDEN.world.kind).toBe('scan');
        const ses = await scanSession();
        const p = (page = new Page(ses, GARDEN.assists));
        // the scan flies the drone's own contact, as every scan
        expect(ses.lifeOverrides().bump).toBeUndefined();
        expect(ses.sim.p.bump).toBe('drone');
        const lives0 = ses.lives().length;
        const runner0 = ses.runner;
        p.mode.enter({ lesson: GARDEN });
        expect(ses.lifeOverrides().bump).toBe(LESSON_FLIGHT.bump);
        expect(ses.sim.p.bump).toBe('slide');
        // at once: a new life where the craft flies, or (a craft still on its spawn) a new flight model there
        expect(ses.runner !== runner0 || ses.lives().length === lives0 + 1).toBe(true);
        expect((ses.lives().at(-1)!.header.overrides as { bump?: string }).bump).toBe('slide');
        p.fly(500);
        expect(ses.sim.p.bump).toBe('slide');
        // a respawn in the lesson keeps it (the life's header says so: a replay flies it too)
        ses.respawnStart();
        p.fly(200);
        expect((ses.lives().at(-1)!.header.overrides as { bump?: string }).bump).toBe('slide');
        p.mode.leave();
        expect(ses.lifeOverrides().bump).toBeUndefined();
        expect(ses.sim.p.bump).toBe('drone');
        expect((ses.lives().at(-1)!.header.overrides as { bump?: string }).bump).toBeUndefined();
        ses.dispose();
        page = null;
        // a lesson world brings the rule itself: entering its lesson starts no life for it
        const hall = lessonWorldOf(getLesson('walls-hall'))!;
        const own = await FlightSession.start({} as HTMLCanvasElement, { sceneId: hall.builtin.scene.id, world: hall.builtin, renderer: nullRenderer(), crashOn: false, windSeed: 5 });
        const q = (page = new Page(own, getLesson('walls-hall').assists));
        const n = own.lives().length;
        const r = own.runner;
        expect(own.sim.p.bump).toBe('slide');
        q.mode.enter({ lesson: getLesson('walls-hall') });
        expect(own.runner).toBe(r);
        expect(own.lives().length).toBe(n);
        q.mode.leave();
        expect(own.sim.p.bump).toBe('slide');
        expect(own.runner).toBe(r);
        expect(own.lives().length).toBe(n);
    });

    it(`into the scan's pillar at 0-60 deg and 2-4 m/s in the lesson: out of contact (>= ${OUT_GAP_M * 100} cm, no contact after) within ${OUT_WITHIN_S} s with the stick let go or pointed away; control: the drone's own contact (no lesson) stays on it past ${OUT_WITHIN_S} s in most cases`, async () => {
        const lesson: Outcome[] = [];
        for (const c of CASES) lesson.push(await atThePillar(c, true));
        const drone: Outcome[] = [];
        for (const c of CASES) drone.push(await atThePillar(c, false));
        console.log(`sonic-scan-bump: in the lesson ${lesson.map(label).join('; ')}`);
        console.log(`sonic-scan-bump: drone's rule ${drone.map(label).join('; ')}`);
        expect(lesson.every((o) => o.bump === 'slide')).toBe(true);
        expect(drone.every((o) => o.bump === 'drone')).toBe(true);
        // every flight met the pillar
        expect(lesson.filter((o) => o.hitMps === null).map(label)).toEqual([]);
        expect(drone.filter((o) => o.hitMps === null).map(label)).toEqual([]);
        const late = (o: Outcome): boolean => o.outS === null || o.outS > OUT_WITHIN_S;
        expect(lesson.filter(late).map(label)).toEqual([]);
        // control: the drone's own contact, the same flights
        expect(drone.filter(late).length).toBeGreaterThan(drone.length / 2);
    }, 600000);
});
