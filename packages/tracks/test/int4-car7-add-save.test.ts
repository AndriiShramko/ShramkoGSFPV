// Seam of train 5 car 7: w1-dialog's Add here against n-save's saving. A course made with Add here (a kept course and a
// ring joined round the drone, its id the link of both parts) must be one the editor's Save lets through (saveVerdict:
// no blocker), the page's own check before the POST lets through (validateServerTrack, the mirror of apps/api/tracks.py)
// and, as the editor saves it (toTrackV1 of the opened course), the same. The link of both parts lays it again (add-here
// test); a saved course travels by its server id, which these lanes did not change.
import { describe, expect, it } from 'vitest';
import { courseAnchor, marginOf, planCourse, saveVerdict, toTrackV1, upgradeTrack, validateServerTrack, wallsCheck } from '../src';
import type { CourseRequest, PlanInput, TrackFile, VoxelCollision } from '../src';
import { IDENTITY } from './worlds';
import { FRINGE_MOVED, FRINGE_SPAWN, fringeField } from './scan-worlds';

const WHOOP_R = 0.0425;
const input = (walls: VoxelCollision, request: CourseRequest, keep: TrackFile | null = null): PlanInput => ({
    walls, transform: IDENTITY, spawn: [FRINGE_SPAWN[0], FRINGE_SPAWN[1], FRINGE_SPAWN[2]], scene: { id: 'abcdef12', version: 1 }, created: '2026-11-19T00:00:00.000Z', craftRadiusM: WHOOP_R, request, elements: true, keep
});
const at = (seed: number, anchor: readonly [number, number, number]): CourseRequest => ({ seed, level: 'medium', spread: 'compact', anyQuality: false, anchor: courseAnchor(anchor) });

describe('car 7 seam: a course made with Add here can be saved', () => {
    const field = fringeField();
    const here = planCourse(input(field, at(2, FRINGE_SPAWN)));
    const base = here.ok ? here.track : null;
    const added = base ? planCourse(input(field, at(5, FRINGE_MOVED), base)) : null;
    const joined = added?.ok ? added.track : null;

    it('the page check before Save for everyone (validateServerTrack) lets the joined course through, as it does the plain one', () => {
        if (!base || !joined) throw new Error('no course');
        // the course is the joined one: every gate of the kept course is in it, and more
        expect(joined.gates.length).toBeGreaterThan(base.gates.length);
        const at3 = new Set(joined.gates.map((g) => JSON.stringify(g.pos)));
        expect(base.gates.filter((g) => !at3.has(JSON.stringify(g.pos)))).toEqual([]);
        const plain = validateServerTrack(JSON.parse(JSON.stringify(base)));
        expect(plain.ok && plain.track.id).toBe(base.id);
        const v = validateServerTrack(JSON.parse(JSON.stringify(joined)));
        expect(v.ok ? [] : v.issues).toEqual([]);
        expect(v.ok).toBe(true);
    });

    it('opened in the editor, the joined course has no problem in the walls and Save has no blocker', () => {
        if (!joined) throw new Error('no course');
        const course = upgradeTrack(joined);
        // the margin the page gives the editor (course.ts: wallsCheck(col, T, marginOf(tr)))
        const problems = wallsCheck(field, IDENTITY, marginOf(joined))(course);
        expect(problems).toEqual([]);
        const verdict = saveVerdict(course, problems);
        expect(verdict.blockers).toEqual([]);
        expect(validateServerTrack(JSON.parse(JSON.stringify(toTrackV1(course)))).ok).toBe(true);
    });
});
