// Lane n-save S2 (t7-plan Part C 5: "the fix ... also serves the editor's Fix of one selected warning"): the small
// corrections a refused Save offers (edit4s's proposeFixes) are fixAll's repair of that one gate, not a second fixer.
// On threeRooms: a gate low in the floor and a gate passed the wrong way; each Fix equals fixAll({ only }) for its gate.
import { describe, expect, it } from 'vitest';
import type { TrackFile } from '@shramko/sonic-fpv';
import { fixAll, upgradeTrack, wallsCheck, yawQuatStep } from '@gsfpv/tracks';
import type { Course } from '@gsfpv/tracks';
import { FIX_MAX_M, FIX_WORDS, proposeFixes } from '../../../apps/fly/src/course/editor/fixes';
import { IDENTITY, threeRooms } from '../../../packages/tracks/test/worlds';

type V3 = [number, number, number];
const walls = threeRooms();
const margin = 0.5;
const w = { col: walls, transform: IDENTITY, margin };
const check = wallsCheck(walls, IDENTITY, margin);
const gate = (id: string, pos: V3, step = 4) => ({ id, shape: { kind: 'ring', diameter: 1.2, tube: 0.08 }, pos, quat: yawQuatStep(step), direction: 'forward' });
const course = (gates: ReturnType<typeof gate>[]): Course =>
    upgradeTrack({
        format: 'shramko-sonic-track/1', id: '0000aaaa-00000001', version: 1, parent: null, title: 'One',
        scene: { kind: 'scan', id: '0000aaaa', version: 1 }, transform: [1, 0, 0, 0], gates, laps: 1,
        start: { pos: [1.5, 2.5, 5], yawDeg: 90 }, author: { kind: 'generator', name: 'gsfpv-course' },
        generator: { name: 'gsfpv-course', version: '1', seed: 1, params: {} }, created: '2026-11-20T00:00:00Z'
    } as unknown as TrackFile);

describe('n-save S2: one gate fixed is fixAll for that gate (one flow)', () => {
    it('a gate low against the floor: the nudge is fixAll\'s move of it, at most 1 m', () => {
        const c = course([gate('g1', [3, 2.5, 5]), gate('g2', [5.5, 0.9, 5]), gate('g3', [8, 2.5, 5])]);
        const problems = check(c);
        expect(problems.some((p) => p.code === 'gate-wall' && p.gate === 'g2'), JSON.stringify(problems)).toBe(true);
        const fixes = proposeFixes(c, problems, w);
        const nudge = fixes.find((f) => f.kind === 'nudge')!;
        const m = fixAll(c, w, 'medium', { only: 1, maxM: FIX_MAX_M }).moves[0]!;
        expect(nudge.gates).toEqual([{ index: 1, before: m.before, after: m.after }]);
        expect(nudge.words).toEqual({ key: FIX_WORDS.nudge, args: { g: 2, cm: Math.round(m.movedM * 100) } });
        expect(m.movedM).toBeLessThanOrEqual(FIX_MAX_M);
    });

    it('a gate passed the wrong way: the turn is fixAll\'s turn of it where it stands', () => {
        const c = course([gate('g1', [3, 2.5, 5]), gate('g2', [6.5, 2.5, 5], 12), gate('g3', [8.5, 2.5, 5])]);
        const problems = check(c);
        const f = proposeFixes(c, problems, w).find((x) => x.kind === 'face-line')!;
        const m = fixAll(c, w, 'medium', { only: 1, maxM: 0 }).moves[0]!;
        expect(f.gates).toEqual([{ index: 1, before: m.before, after: m.after }]);
        expect(f.gates[0]!.after.pos).toEqual([6.5, 2.5, 5]);
        expect(check({ ...c, gates: c.gates.map((g, i) => (i === 1 ? { ...g, quat: m.after.quat } : g)) })).toEqual([]);
    });
});
