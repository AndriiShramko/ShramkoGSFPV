// Lane gap-gen, stage S1: what gen4a's planner still left open at x1 (audit entries generator-1, -4, -10 of t6-audit.json).
//   (a) never a refusal where a gate fits: the fallback chain (compact, then the walk of a harder level) answers a course
//   (d) a beginner course has at least the level's gatesMin where the level's gates fit (a sharper walk, the same gates)
//   (e) a level's element kinds: medium draws no flat square and no cube, pro does
//   (f) the voxels-only view (anyQuality): more gates than the whole-scene course, on poor tiles too
import { describe, expect, it } from 'vitest';
import { ELEMENT_SHARES, HARDER, LEVELS, elementOf, fallbackAsks, planCourse, validateServerTrack, walkedBy } from '../src';
import type { CourseLevel, CourseRequest, PlanInput, TrackFile, VoxelCollision } from '../src';
import { IDENTITY } from './worlds';
import { cityFromAbove, plantTray, tableAndSkull } from './scan-worlds';

const WHOOP_R = 0.0425;
const D = 2 * WHOOP_R;
const input = (walls: VoxelCollision, request: CourseRequest): PlanInput => ({
    walls, transform: IDENTITY, spawn: [0, 1, 0], scene: { id: 'abcdef12', version: 1 }, created: '2026-11-19T00:00:00.000Z', craftRadiusM: WHOOP_R, request, elements: true
});
const ask = (level: CourseLevel, seed: number, spread: 'compact' | 'wide' = 'compact', anyQuality = false): CourseRequest => ({ seed, level, spread, anyQuality });
/** the kinds of a course's elements: a cube frame, a flat square (a gate pitched up: its quaternion's x near 0.7) */
const shapesOf = (t: TrackFile): Set<string> => new Set(t.gates.map((g) => (g.shape.kind === 'cube-frame' ? 'cube' : Math.abs(g.quat[1]) > 0.5 ? 'flat' : g.shape.kind)));

describe('gap-gen S1: the asked course at x1', () => {
    it('fallbackAsks: the asked one, compact when wide was asked, then compact by the walk of each harder level', () => {
        expect(fallbackAsks(ask('beginner', 3, 'wide')).map((x) => `${x.req.spread}/${x.walk}`)).toEqual(['wide/beginner', 'compact/beginner', 'compact/medium', 'compact/pro']);
        expect(fallbackAsks(ask('medium', 3)).map((x) => `${x.req.spread}/${x.walk}`)).toEqual(['compact/medium', 'compact/pro']);
        expect(fallbackAsks(ask('pro', 3, 'wide', true)).map((x) => `${x.req.spread}.${x.req.anyQuality}/${x.walk}`)).toEqual(['wide.true/pro', 'compact.false/pro']);
        // every ask keeps the asked level's gates: the walk changes, the opening and the counts do not
        for (const l of ['beginner', 'medium'] as CourseLevel[]) {
            const w = walkedBy(l, HARDER[l]);
            expect(w.openingD).toBe(LEVELS[l].openingD);
            expect(w.gatesMin).toBe(LEVELS[l].gatesMin);
            expect(w.turnCosMin).toBe(LEVELS[HARDER[l]].turnCosMin);
        }
    });

    // (a) + (d): a skull on a table at x1 refused beginner and medium (the 60 and 105 degree turns find no loop round it)
    // while pro laid 3 gates; a plant tray at x1 refused beginner
    for (const [name, make, level] of [['a skull on a table', tableAndSkull, 'beginner'], ['a skull on a table', tableAndSkull, 'medium'], ['a plant tray', plantTray, 'beginner']] as const)
        it(`${name} at x1, ${level}: a course of the level's gates, never no-room`, () => {
            const walls = make();
            for (const seed of [1, 2]) {
                const r = planCourse(input(walls, ask(level, seed)));
                expect(r.ok).toBe(true);
                if (!r.ok) return;
                expect(r.stats.gates).toBeGreaterThanOrEqual(1);
                if (level === 'beginner') expect(r.stats.gates).toBeGreaterThanOrEqual(LEVELS.beginner.gatesMin);
                expect(r.stats.outside).toBe(0);
                expect(r.stats.underGround).toBe(0);
                expect(r.stats.closed).toBe(true);
                // the level's gate, or its ladder down to 4 D: never smaller
                expect(r.stats.openingM).toBeGreaterThanOrEqual(4 * D - 1e-3);
                expect(validateServerTrack(r.track).ok).toBe(true);
            }
        });

    it('the medium course draws no flat square and no cube; the pro course does (LEVELS.elements)', () => {
        const city = cityFromAbove();
        const medium = new Set<string>(), pro = new Set<string>();
        for (const seed of [1, 2]) {
            const m = planCourse(input(city, ask('medium', seed)));
            const p = planCourse(input(city, ask('pro', seed)));
            expect(m.ok && p.ok).toBe(true);
            if (m.ok) for (const k of shapesOf(m.track)) medium.add(k);
            if (p.ok) for (const k of shapesOf(p.track)) pro.add(k);
        }
        expect(medium.has('cube') || medium.has('flat')).toBe(false);
        expect(pro.has('cube') || pro.has('flat')).toBe(true);
        // the draw: only the level's kinds; without kinds the very draws of the old courses
        for (let u = 0; u < 1; u += 0.01) {
            expect(LEVELS.medium.elements).toContain(elementOf(u, LEVELS.medium.elements));
            let acc = 0, old: string = 'single';
            for (const [k, s] of ELEMENT_SHARES) if (u < (acc += s)) { old = k; break; }
            expect(elementOf(u)).toBe(old);
        }
    });

    it('anyQuality: more gates than wide, on poor tiles too', () => {
        const city = cityFromAbove();
        const wide = planCourse(input(city, ask('medium', 2, 'wide')));
        const any = planCourse(input(city, ask('medium', 2, 'wide', true)));
        expect(wide.ok && any.ok).toBe(true);
        if (!wide.ok || !any.ok) return;
        expect(any.stats.gates).toBeGreaterThan(wide.stats.gates);
        expect(any.stats.goodShare).toBeLessThan(1);
        expect(wide.stats.goodShare).toBe(1);
        expect(any.stats.outside).toBe(0);
        expect(any.track.id).toMatch(/\.mv$/);
        expect(validateServerTrack(any.track).ok).toBe(true);
    });
});
