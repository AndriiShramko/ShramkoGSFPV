// Lane w1-dialog (train 5, R2 of designs/w1-diag.md; the owner's brief line 667, idea c): Add here. A course laid at the
// author's camera (Here), the drone flown 28 m to the far street of the village, Add here: the old gates stay gate for gate,
// new gates stand round the drone, the ring is closed and proven, and the link lays the very same course again.
// Negative control: on w1-anchor (the base) PlanInput.keep is ignored and the course from the drone replaces the old one.
import { describe, expect, it } from 'vitest';
import { ADD_SEP, MAX_ADDS, SERVER_MAX_GATES, addedLinkId, checkTrack, courseAnchor, courseLinkId, joinCourses, legsWithinServer, marginOf, parseCourseLink, planCourse } from '../src';
import type { CourseRequest, PlanInput, TrackFile, VoxelCollision } from '../src';
import { IDENTITY } from './worlds';
import { FRINGE_MOVED, FRINGE_SPAWN, fringeField } from './scan-worlds';

const WHOOP_R = 0.0425;
const input = (walls: VoxelCollision, request: CourseRequest, keep: TrackFile | null = null): PlanInput => ({
    walls, transform: IDENTITY, spawn: [FRINGE_SPAWN[0], FRINGE_SPAWN[1], FRINGE_SPAWN[2]], scene: { id: 'abcdef12', version: 1 }, created: '2026-11-19T00:00:00.000Z', craftRadiusM: WHOOP_R, request, elements: true, keep
});
const at = (seed: number, anchor: readonly [number, number, number]): CourseRequest => ({ seed, level: 'medium', spread: 'compact', anyQuality: false, anchor: courseAnchor(anchor) });
const flat = (p: readonly number[], q: readonly number[]): number => Math.hypot(p[0]! - q[0]!, p[2]! - q[2]!);

describe('w1-dialog Add here: the kept course stays, more gates round the drone, the ring closed again', () => {
    const field = fringeField();
    const here = planCourse(input(field, at(2, FRINGE_SPAWN)));
    const base = here.ok ? here.track : null;
    const add = at(5, FRINGE_MOVED);
    const added = base ? planCourse(input(field, add, base)) : null;
    const joined = added?.ok ? added.track : null;

    it('the base course (Here at the camera) and the added one are laid', () => {
        expect(base).not.toBeNull();
        expect(added?.ok).toBe(true);
    });

    it('the old gates stay where they were, gate for gate (position, turn, shape), in their order', () => {
        if (!base || !joined) throw new Error('no course');
        expect(joined.gates.length).toBeGreaterThan(base.gates.length);
        const key = (g: TrackFile['gates'][number]): string => JSON.stringify([g.pos, g.quat, g.shape, g.direction]);
        const keys = joined.gates.map(key);
        let from = 0;
        for (const g of base.gates) {
            const i = keys.indexOf(key(g), from);
            expect(i).toBeGreaterThanOrEqual(from);
            from = i + 1;
        }
        expect(joined.start).toEqual(base.start);
    });

    it('the new gates stand round the drone: one within 10 m of it', () => {
        if (!base || !joined) throw new Error('no course');
        const old = new Set(base.gates.map((g) => JSON.stringify(g.pos)));
        const fresh = joined.gates.filter((g) => !old.has(JSON.stringify(g.pos)));
        expect(fresh.length).toBeGreaterThan(0);
        expect(Math.min(...fresh.map((g) => flat(g.pos, FRINGE_MOVED)))).toBeLessThanOrEqual(10);
    });

    it('no gate or leg inside a wall, the ring closed, every leg within the server\'s 60 m', () => {
        if (!joined) throw new Error('no course');
        expect(joined.laps).toBeGreaterThan(1);
        expect(checkTrack(joined, field, IDENTITY, marginOf(joined), false, true).ok).toBe(true);
        expect(legsWithinServer(joined)).toBe(true);
        expect(joined.gates.length).toBeLessThanOrEqual(SERVER_MAX_GATES);
    });

    it('the link names both parts and lays the very same course again (another browser)', () => {
        if (!base || !joined) throw new Error('no course');
        expect(joined.id).toBe(`${courseLinkId(at(2, FRINGE_SPAWN))}${ADD_SEP}${courseLinkId(add).slice(3)}`);
        const link = parseCourseLink(joined.id);
        if (!link || link.kind !== 'request') throw new Error('not a request link');
        expect(link.request).toEqual(at(2, FRINGE_SPAWN));
        expect(link.adds).toEqual([add]);
        const again = planCourse(input(field, link.request));
        if (!again.ok) throw new Error('first part not laid');
        const second = planCourse(input(field, link.adds[0]!, again.track));
        if (!second.ok) throw new Error('second part not laid');
        expect(second.track.gates).toEqual(joined.gates);
        expect(second.track.id).toBe(joined.id);
    });

    it('a kept course with the server\'s most gates: Add here answers no-join (the page says what to do), never a course over 60', () => {
        if (!base) throw new Error('no course');
        const full: TrackFile = { ...base, gates: Array.from({ length: SERVER_MAX_GATES }, (_, i) => ({ ...base.gates[i % base.gates.length]!, id: `g${i + 1}` })) };
        const r = planCourse(input(field, add, full));
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toBe('no-join');
    });

    it('joinCourses: two rings with no free join within 60 m give null, not a course with a leg through a wall', () => {
        if (!base) throw new Error('no course');
        const far: TrackFile = { ...base, gates: base.gates.map((g) => ({ ...g, pos: [g.pos[0] + 500, g.pos[1], g.pos[2]] as [number, number, number] })) };
        expect(joinCourses(base, far, field, IDENTITY)).toBeNull();
    });
});

describe('w1-dialog: the link of a course with Add here parts', () => {
    const first: CourseRequest = { seed: 7, level: 'medium', spread: 'compact', anyQuality: false, anchor: [12, -3, -540] };
    const part: CourseRequest = { seed: 1295, level: 'pro', spread: 'compact', anyQuality: false, anchor: [40, 2, -500] };

    it('round trip; a plain link has no parts', () => {
        const id = addedLinkId(courseLinkId(first), part)!;
        expect(id).toBe('g2.7.mc.12.-3.-540_zz.pc.40.2.-500');
        expect(parseCourseLink(id)).toEqual({ kind: 'request', request: first, adds: [part] });
        expect(parseCourseLink(courseLinkId(first))).toEqual({ kind: 'request', request: first, adds: [] });
    });

    it('no part without an anchor, none after a g1 link or another id, at most MAX_ADDS; a broken part breaks the link', () => {
        expect(addedLinkId(courseLinkId(first), { ...part, anchor: null })).toBeNull();
        expect(addedLinkId('g1.abc', part)).toBeNull();
        expect(addedLinkId('0123abcd-89abcdef', part)).toBeNull();
        let id = courseLinkId(first);
        for (let i = 0; i < MAX_ADDS; i++) id = addedLinkId(id, part)!;
        expect(parseCourseLink(id)?.kind).toBe('request');
        expect(addedLinkId(id, part)).toBeNull();
        expect(parseCourseLink(`${courseLinkId(first)}_zz.pc.40.2`)).toBeNull();
        expect(parseCourseLink('g1.abc_zz.pc.40.2.-500')).toBeNull();
    });
});
