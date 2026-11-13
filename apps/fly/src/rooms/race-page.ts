// Lane rooms2, stage Q2 (rooms-plan.md 2.4 and 4D; docs/rooms-protocol.md "Races"): the race on the page. The proposal names a
// course (race.ts courseFor), every racer's page builds the same course (a saved course: CourseStore.load; a seed: the course
// worker with the flown walls, as the course feature generates), draws its gates, says ready, hears and sees the countdown,
// starts its own lap timer at go and reports its laps. The race's course is its own CourseRun and CourseStage: the course
// feature (app/builtin/course.ts, lane tracks) is read through its public classes and never changed. Like the course timer,
// nothing here writes into the sim, the input log or the runner. Without a race nothing here runs per frame.
import type { TrackFile } from '@shramko/sonic-fpv';
import type { FlightContext } from '../app/context';
import { CourseRun } from '../course/run';
import { CourseStore } from '../course/store';
import { CourseStage } from '../course/view';
import type { CourseGrid, CourseJob, FromCourseWorker } from '../course/worker';
import { Countdown, RaceLaps, courseFor, parseCourse, raceLine, secs } from './race';
import type { CourseNow, RaceMsg } from './race';
import type { RaceHook } from './hook';
import type { RoomSocket } from './socket';

/** Laps of a race (an estimate: two laps give each pilot a best lap and keep a race to a few minutes). */
export const RACE_LAPS = 2;
/** A course a page generates for a race may take this long before the page gives up (course.ts: 15-31 s, an estimate). */
const BUILD_LIMIT_MS = 150_000;

function randomSeed(): number {
    const a = new Uint32Array(1);
    crypto.getRandomValues(a);
    return a[0]! & 0x7fffffff;
}

export type Tell = (key: string, params: Record<string, string | number>, interrupt: boolean) => void;

export class RacePage {
    readonly h: RaceHook = { state: 'off', course: null, laps: 0, startAt: null, racer: false, built: false, gates: 0, next: -1, sent: 0, table: [], problem: null, path: [] };
    private run: CourseRun | null = null;
    private stage: CourseStage | null = null;
    private count: Countdown | null = null;
    private laps: RaceLaps | null = null;
    private started = false;
    private shownNext = -2;
    /** the race draws its own gates (false while the course feature shows the same course) */
    private drawn = false;
    private worker: Worker | null = null;
    private job = 0;
    /** the worker's job numbers (the build's own `job` guards a course replaced while it builds) */
    private wjob = 0;
    private readonly offs: (() => void)[] = [];

    constructor(private readonly ctx: FlightContext, private readonly sock: RoomSocket, private readonly tell: Tell) {
        const tick = (): number => ctx.session.runner.sim.tick;
        this.offs.push(
            ctx.events.on('sim', (e) => {
                if (e.type === 'respawn' || e.type === 'crash') this.run?.reset();
            }),
            ctx.events.on('life', () => this.run?.reset()),
            ctx.events.on('pause', ({ on }) => {
                if (!this.run) return;
                if (on) this.run.pause(tick());
                else this.run.resume(tick());
            }),
            ctx.events.on('session', () => this.clear())
        );
    }

    /** The panel's "Race on a course": the course flown now, else the scan's newest saved course, else a new seed. */
    async propose(): Promise<void> {
        const rows = await new CourseStore().list(this.ctx.scene.id);
        const now = (this.ctx.hook as { course?: CourseNow }).course ?? null;
        this.sock.race(courseFor(now, rows, randomSeed()), RACE_LAPS);
    }

    /** A race message of the room (or the welcome's race). */
    onMsg(m: RaceMsg): void {
        const me = this.sock.slot;
        const h = this.h;
        if (m.table) h.table = m.table;
        // review RM-6: the table asked for by the panel after a race is old news, not said again
        if (m.state === 'results' && (h.state === 'results' || h.state === 'off')) {
            h.state = 'results';
            return;
        }
        if (m.state === 'wait') return this.tell('rooms.race.wait', {}, true); // review RM-10: a refused proposal says why
        const fresh = m.state === 'prep' && (h.state === 'off' || h.state === 'results' || h.course !== m.course);
        if (m.state === 'prep' || m.state === 'count' || m.state === 'run') {
            const joined = h.state === 'off' && m.state !== 'prep';
            if (fresh || h.course !== m.course) this.begin(m, me);
            h.state = m.state;
            if (typeof m.startAt === 'number') h.startAt = m.startAt;
            // review RM-9: a page that came in during a race (a new pilot, a reconnect) is no racer; it says so once
            if (joined && !h.racer) return this.tell('rooms.race.watching', {}, false);
        } else if (m.state === 'results') {
            this.end();
            h.state = 'results';
        } else if (m.state === 'refused' && m.slot === me) {
            h.problem = 'lap refused';
            return this.tell('rooms.race.refused', { n: typeof m.n === 'number' ? m.n : h.sent }, false);
        }
        // a repeated prep (a pilot said ready) says nothing; the countdown has its own lines (frame)
        if (m.state === 'prep' && !fresh) return;
        // review RM-9: rows are keyed by slot; a pilot in a racer's freed slot is not that racer
        const line = raceLine(m, h.racer ? me : null, (s) => this.sock.members.get(s) ?? `#${s + 1}`);
        if (line) this.tell(line.key, line.params, true);
    }

    private begin(m: RaceMsg, me: number | null): void {
        this.end();
        const h = this.h;
        h.course = m.course;
        h.laps = m.laps ?? 1;
        h.startAt = null;
        h.problem = null;
        h.sent = 0;
        // review RM-14: a member who flies another scan builds nothing (the course is the room's scan's)
        h.racer = me !== null && (m.racers ?? []).includes(me) && this.sock.room?.scene.id === this.ctx.scene.id;
        this.count = new Countdown();
        this.laps = new RaceLaps(h.laps);
        if (h.racer) void this.build(m.course);
    }

    private async build(course: string): Promise<void> {
        const mine = ++this.job;
        const ref = parseCourse(course);
        let track: TrackFile | null = null;
        if (ref?.kind === 'saved') {
            const got = await new CourseStore().load(ref);
            if (got.ok) track = got.track;
            else this.h.problem = got.problem;
        } else if (ref?.kind === 'seed') {
            track = await this.generate(ref.seed);
        } else this.h.problem = 'course';
        if (mine !== this.job || this.h.course !== course) return;
        // a page that cannot build the course says so once and keeps everyone's table (review RM-3); the service starts
        // with the pages that built it, or ends the race when none did
        if (!track) return this.tell('rooms.race.noCourse', {}, true);
        this.run = new CourseRun(track, this.ctx.session.transform);
        // review RM-13: the course feature already draws this very course: its gates stay, the race only times
        const now = (this.ctx.hook as { course?: CourseNow }).course ?? null;
        this.drawn = !(now?.on && courseFor(now, [], 0) === course);
        if (this.drawn) {
            this.stage ??= new CourseStage(this.ctx.renderer);
            this.stage.show(this.run.gates);
        }
        this.shownNext = -2;
        this.h.built = true;
        this.h.gates = this.run.gates.length;
        this.h.path = this.run.path.map((p) => [p.pos[0], p.pos[1], p.pos[2]]);
        this.sock.ready();
    }

    /** The course of a seed on the flown walls, built in the course worker as the course feature builds it. */
    private generate(seed: number): Promise<TrackFile | null> {
        const s = this.ctx.session;
        const col = s.collision;
        if (!col) {
            this.h.problem = 'no walls';
            return Promise.resolve(null);
        }
        const grid: CourseGrid = { flip: col.flipXY, min: [col.gridMinX, col.gridMinY, col.gridMinZ], res: col.voxelResolution, n: [col.numVoxelsX, col.numVoxelsY, col.numVoxelsZ], leafSize: col.leafSize, treeDepth: col.treeDepth };
        const nodes = col.nodes.slice();
        const leaf = col.leafData.slice();
        const tr = s.transform;
        const job = ++this.wjob;
        const msg: CourseJob = {
            t: 'generate', job, grid, nodes, leaf, spawn: [s.spawn[0], s.spawn[1], s.spawn[2]], seed,
            scene: { id: s.scene.id, version: s.scene.version }, transform: [tr.s, tr.t[0] ?? 0, tr.t[1] ?? 0, tr.t[2] ?? 0], created: new Date().toISOString()
        };
        this.worker ??= new Worker(new URL('../course/worker.ts', import.meta.url), { type: 'module' });
        const w = this.worker;
        return new Promise((resolve) => {
            const done = (track: TrackFile | null, problem: string | null): void => {
                clearTimeout(timer);
                w.removeEventListener('message', onMsg);
                if (problem !== null) this.h.problem = problem;
                resolve(track);
            };
            const timer = setTimeout(() => {
                this.worker?.terminate();
                this.worker = null;
                done(null, 'timeout');
            }, BUILD_LIMIT_MS);
            const onMsg = (e: MessageEvent<FromCourseWorker>): void => {
                const r = e.data;
                if (r.job !== job) return;
                if (r.t === 'error') return done(null, r.message.slice(0, 200));
                if (r.t === 'track') return done(r.track, r.track ? null : 'nothing fits');
            };
            w.addEventListener('message', onMsg);
            w.postMessage(msg, [nodes.buffer, leaf.buffer]);
        });
    }

    /** One drawn frame: the countdown on the server's clock, the start at go, the laps after it. */
    frame(now: number): void {
        const h = this.h;
        if (h.state !== 'count' && h.state !== 'run') return;
        if (h.startAt !== null && this.count && !this.count.over) {
            const sn = this.sock.clock.serverNow(now);
            const c = sn === null ? null : this.count.due(h.startAt - sn);
            if (c) {
                this.tell(c.key, c.params, true);
                if (c.key === 'rooms.race.go') {
                    this.run?.reset();
                    this.started = true;
                }
            }
        }
        const run = this.run;
        if (!run) return;
        const { ev, view } = run.fromSim(this.ctx.session.runner.sim);
        const lap = this.laps?.feed(ev, view.lastLapMs, this.started) ?? null;
        if (lap) {
            this.sock.lap(lap.n, lap.ms);
            h.sent = lap.n;
        }
        const next = view.running || view.next >= 0 ? view.next : -1;
        if (next !== this.shownNext) {
            if (this.drawn) this.stage?.setNext(next, run.path, run.track.laps > 1);
            this.shownNext = next;
        }
        h.next = view.next;
    }

    /** Key 0 during or after a race: this pilot's place first (null without a table or a row of his). */
    standing(): { key: string; params: Record<string, string | number> } | null {
        // review RM-9: only a racer of this race has a row of his own (rows are keyed by slot)
        const me = this.h.racer ? this.h.table.find((r) => r.slot === this.sock.slot) : undefined;
        if (!me || this.h.state === 'off') return null;
        const n = this.h.table.length;
        return me.bestMs === null
            ? { key: 'rooms.race.standingNoLap', params: { place: me.place, n } }
            : { key: 'rooms.race.standing', params: { place: me.place, n, time: secs(me.bestMs) } };
    }

    /** The race's gates go; the table stays for key 0 and the panel. */
    private end(): void {
        this.job++;
        this.run = null;
        this.stage?.hide();
        this.drawn = false;
        this.count = null;
        this.laps = null;
        this.started = false;
        this.h.built = false;
        this.h.gates = 0;
        this.h.next = -1;
        this.h.path = [];
    }

    /** A new scan: the race's course was the old scan's. */
    private clear(): void {
        this.end();
        if (this.h.state !== 'results') this.h.state = 'off';
    }

    dispose(): void {
        for (const off of this.offs) off();
        this.end();
        this.stage?.dispose();
        this.stage = null;
        this.worker?.terminate();
        this.worker = null;
    }
}
