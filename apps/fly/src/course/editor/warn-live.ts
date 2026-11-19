// The live warnings' state of the course editor (lane edit4c, stage C1w, complaint E11): what the dragged gate breaks right
// now (worked out at most every WARN_EVERY_MS), and the gates the pilot kept in such a place (orange until the warning is
// gone). Pure: no DOM, no clock of its own (the page passes `now`), so a Node test drives it; warn-bar.ts shows it.
import type { Course } from '@gsfpv/tracks';
import type { VoxelCollision } from '@gsfpv/collision';
import { gateFlownPose, type Flown, type FlownPose } from './drag';
import { WARN_EVERY_MS, placeWarnings, warnedGates, type Warning } from './warn';

export interface LiveWarningsHost {
    /** the flown transform [s, tx, ty, tz] */
    flown(): Flown;
    /** the flown-frame walls; null before they load (then no wall warning) */
    walls(): VoxelCollision | null;
    /** the course's margin for the leg sweeps, flown m */
    margin(): number;
}

export class LiveWarnings {
    private last = -Infinity;
    private live = new Set<number>();
    private readonly kept = new Set<string>();
    private keptFor: Course | null = null;
    private keptPaint = new Set<number>();

    constructor(private readonly host: LiveWarningsHost) {}

    /**
     * While the gate `index` drags to `pose` (the rest of `course` where it stands): its warnings, or null when the last ones
     * were worked out less than WARN_EVERY_MS ago (they still stand).
     */
    during(course: Course, index: number, pose: FlownPose, now: number): Warning[] | null {
        if (now - this.last < WARN_EVERY_MS) return null;
        this.last = now;
        const ws = placeWarnings(course, index, pose, this.host.flown(), this.host.walls(), this.host.margin());
        this.live = warnedGates(ws, index);
        return ws;
    }

    /** The drag ended (released, refused or unchanged): no live warning stands any more. */
    endDrag(): void {
        this.last = -Infinity;
        this.live = new Set();
    }

    /** On the release: the warnings of the gate `index` where it now stands in `course` (always worked out). */
    released(course: Course, index: number): Warning[] {
        this.endDrag();
        const g = course.gates[index];
        if (!g) return [];
        const fl = this.host.flown();
        return placeWarnings(course, index, gateFlownPose(g, fl), fl, this.host.walls(), this.host.margin());
    }

    /** the pilot kept gate `id` where it warns: it stays orange until its warnings are gone */
    keep(id: string): void {
        this.kept.add(id);
        this.keptFor = null;
    }

    /** the gate ids kept with a warning still standing (for the page probes) */
    keptIds(): string[] {
        return [...this.kept];
    }

    /**
     * The gates to paint orange in `course`: the dragging gate's live set, and each kept gate that still warns (worked out
     * again only when the course changed, never while a drag runs: `dragging` keeps the last answer).
     */
    painted(course: Course, dragging: boolean): Set<number> {
        if (!dragging && this.keptFor !== course) {
            this.keptFor = course;
            this.keptPaint = new Set();
            const fl = this.host.flown();
            for (const id of [...this.kept]) {
                const i = course.gates.findIndex((g) => g.id === id);
                const g = course.gates[i];
                const ws = g ? placeWarnings(course, i, gateFlownPose(g, fl), fl, this.host.walls(), this.host.margin()) : [];
                if (ws.length === 0) this.kept.delete(id);
                else for (const k of warnedGates(ws, i)) this.keptPaint.add(k);
            }
        }
        return new Set([...this.keptPaint, ...(dragging ? this.live : [])]);
    }
}
