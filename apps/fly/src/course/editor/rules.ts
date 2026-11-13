// Pure rules of the course editor's finishing stage (lane tracks, stage F1-finish; tracks-plan.md 2.9 and 2.11): how each gate is
// painted while editing (the selected one told apart at a glance, a failing one red), who may vote (only after a completed lap on
// that course in this browser), and the body of an admin's version saved from the editor. No DOM, no i18n, no PlayCanvas: a Node
// test holds them.
import type { CourseProblem } from '@gsfpv/tracks';
import { ADMIN_AUTHOR_NAME } from '../../admin/tracks/model';

export type EditPaint = 'selected' | 'bad' | 'selected-bad' | 'later';

/** 0-based indices of the gates a problem names (a leg in a wall marks both of its ends; the start is no gate). */
export function badGates(problems: readonly CourseProblem[], ids: readonly string[]): Set<number> {
    const out = new Set<number>();
    const mark = (id: string): void => {
        const i = ids.indexOf(id);
        if (i >= 0) out.add(i);
    };
    for (const p of problems) {
        if (p.code === 'outside' || p.code === 'gate-wall' || p.code === 'gate-direction') mark(p.gate);
        else if (p.code === 'leg-wall') {
            mark(p.from);
            mark(p.to);
        }
    }
    return out;
}

/** The paint of every gate while editing: the selected one, the failing ones red, the rest 'later'. */
export function editPaints(ids: readonly string[], selected: number, problems: readonly CourseProblem[]): EditPaint[] {
    const bad = badGates(problems, ids);
    return ids.map((_, i) => (i === selected ? (bad.has(i) ? 'selected-bad' : 'selected') : bad.has(i) ? 'bad' : 'later'));
}

/** The course ids this browser has a completed lap on: the best-lap keys are `<id>.v<n>.<scene>...` (course/link.ts bestKey). */
export function lappedIds(bests: Record<string, unknown>): Set<string> {
    const out = new Set<string>();
    for (const [k, v] of Object.entries(bests)) {
        const at = k.indexOf('.v');
        if (at > 0 && typeof v === 'number' && Number.isFinite(v) && v > 0) out.add(k.slice(0, at));
    }
    return out;
}

/** tracks-plan 2.9: the vote buttons of a row are offered only after a completed lap on that course. */
export function mayVote(id: string, lapped: ReadonlySet<string>): boolean {
    return lapped.has(id);
}

/**
 * The body of an admin's version saved from the editor (POST /api/admin/tracks/<id>/versions): the edited gates on the served
 * course's id, the next version naming the one it was edited from, written as a person's file under ADMIN_AUTHOR_NAME without a
 * generator block (a generator's file must keep its "Course <x>" title, admin/tracks/model.ts renamed). The server sets the
 * version number, parent and time again and marks the version edited by the admin, the creator kept.
 */
export function adminVersionBody<T extends { readonly title: string }>(edited: T, id: string, base: number, title: string): Omit<T, 'id' | 'version' | 'parent' | 'author' | 'title' | 'generator'> & {
    id: string; version: number; parent: { id: string; version: number }; author: { kind: 'person'; name: string }; title: string; generator: null;
} {
    const t = title.trim().normalize('NFC');
    return {
        ...edited,
        id,
        version: base + 1,
        parent: { id, version: base },
        author: { kind: 'person', name: ADMIN_AUTHOR_NAME },
        title: t || edited.title,
        generator: null
    };
}
