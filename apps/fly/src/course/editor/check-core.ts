// Lane editor3, E2.1 (the editor freeze, docs/wip/editor3.md D1). The editor's course check against the walls cost 5.1-5.5 s
// on Wroclaw 70b50d42 and 3.5-3.6 s on Tunis 887f27aa (probe tools/bench/src/editor3-live.ts on the live site), on the page's
// thread after every change. Here it moves to a worker that gets the walls once: the page edits with no check and paints the
// problems when the answer comes. This file is the pure part (both sides), check-worker.ts the worker's entry.
import { wallsCheck } from '@gsfpv/tracks';
import type { CourseProblem, openEditor } from '@gsfpv/tracks';
import type { CourseGrid } from '../grid';

type Course = Parameters<typeof openEditor>[0];
type Walls = Parameters<typeof wallsCheck>[0];
/** [s, tx, ty, tz] of the flight */
export type FlownTransform = [number, number, number, number];

/** the flown walls, sent once per walls (`walls` is their number; the buffers are transferred) */
export interface WallsMsg {
    t: 'walls';
    walls: number;
    grid: CourseGrid;
    nodes: Uint32Array;
    leaf: Uint32Array;
}
/** one course to check on the walls numbered `walls` */
export interface CheckMsg {
    t: 'check';
    seq: number;
    walls: number;
    course: Course;
    transform: FlownTransform;
    margin: number;
}
export type ToCheckWorker = WallsMsg | CheckMsg;
export type FromCheckWorker =
    | { t: 'checked'; seq: number; problems: CourseProblem[]; ms: number }
    | { t: 'error'; seq: number; message: string };

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** The worker's side: keeps the walls it got last and answers each course with the problems wallsCheck finds. */
export function checkAnswerer(build: (m: WallsMsg) => Walls, now: () => number = () => performance.now()): (m: ToCheckWorker) => FromCheckWorker | null {
    let held: { id: number; walls: Walls } | null = null;
    let broken: string | null = null;
    return (m) => {
        if (m.t === 'walls') {
            try {
                held = { id: m.walls, walls: build(m) };
                broken = null;
            } catch (err) {
                held = null;
                broken = message(err);
            }
            return null;
        }
        const t0 = now();
        if (!held || held.id !== m.walls) return { t: 'error', seq: m.seq, message: broken ?? 'no walls' };
        try {
            const problems = wallsCheck(held.walls, m.transform, m.margin)(m.course);
            return { t: 'checked', seq: m.seq, problems, ms: Math.round(now() - t0) };
        } catch (err) {
            return { t: 'error', seq: m.seq, message: message(err) };
        }
    };
}

/** review ED-5: the same check on the page's own thread, for a save whose course got no ok answer from the worker (it failed
 *  or never answered). It freezes the page for the check's time (3.5-5.5 s on the big scans, E1 facts), so only then. */
export function checkOnPage(walls: Walls, transform: FlownTransform, margin: number, course: Course): CourseProblem[] {
    return wallsCheck(walls, transform, margin)(course);
}

export type CheckAnswer = { ok: true; problems: CourseProblem[] } | { ok: false; message: string };

/**
 * The page's side. One course is in the worker at a time; a course asked while one is checked waits and is replaced by any
 * newer one, so a burst of presses costs at most two checks and never a queue. Only the answer for the newest course counts.
 */
export class CheckQueue {
    private seq = 0;
    private wallsId = 0;
    private flying: number | null = null;
    private want: CheckMsg | null = null;
    private waiters: (() => void)[] = [];

    constructor(private readonly post: (m: ToCheckWorker, transfer: Transferable[]) => void) {}

    /** new walls for the checks asked from now on */
    walls(grid: CourseGrid, nodes: Uint32Array, leaf: Uint32Array): void {
        this.wallsId++;
        this.post({ t: 'walls', walls: this.wallsId, grid, nodes, leaf }, [nodes.buffer, leaf.buffer]);
    }

    /** the course as it stands now; returns its number */
    ask(course: Course, transform: FlownTransform, margin: number): number {
        const m: CheckMsg = { t: 'check', seq: ++this.seq, walls: this.wallsId, course, transform, margin };
        if (this.flying === null) {
            this.flying = m.seq;
            this.post(m, []);
        } else this.want = m;
        return m.seq;
    }

    /** a course is asked and its answer has not come yet */
    get pending(): boolean {
        return this.flying !== null || this.want !== null;
    }

    /** an answer from the worker: the result when it is for the newest course, else null (the waiting course goes now) */
    answer(a: FromCheckWorker): CheckAnswer | null {
        if (a.seq !== this.flying) return null;
        this.flying = null;
        if (this.want) {
            const w = this.want;
            this.want = null;
            this.flying = w.seq;
            this.post(w, []);
            return null;
        }
        const out: CheckAnswer = a.t === 'checked' ? { ok: true, problems: a.problems } : { ok: false, message: a.message };
        const ws = this.waiters;
        this.waiters = [];
        for (const f of ws) f();
        return out;
    }

    /** the worker died: nothing is in it any more, whoever waits goes on */
    drop(): void {
        this.flying = null;
        this.want = null;
        const ws = this.waiters;
        this.waiters = [];
        for (const f of ws) f();
    }

    /** resolves when the newest course asked has its answer (at once when none is pending) */
    settled(): Promise<void> {
        return this.pending ? new Promise((r) => this.waiters.push(r)) : Promise.resolve();
    }
}
