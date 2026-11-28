// Lane n-save S1 (the owner's wish 1 of 2026-11-20, t7-plan Part C 4 and Decision 6): Save never refuses what a pilot may
// accept. saveVerdict splits the findings in two: blockers are exactly what the server refuses (validateServerTrack, the
// mirror of apps/api/tracks.py), warnings are everything else and never block. A gate in the free air just past the walls'
// grid is no problem for the editor (it was 'outside the scanned space'), while the generator's strict proof still refuses
// it. Controls: a gate far past the grid is still named, and each blocker's course is one the server contract refuses.
import { describe, expect, it } from 'vitest';
import type { TrackFile } from '@shramko/sonic-fpv';
import { MARGIN_M, NEAR_GRID_M, SAME_PLACE_M, canSave, checkTrack, openEditor, saveVerdict, upgradeTrack, validateServerTrack, wallsCheck, yawQuatStep } from '../src';
import type { CourseProblem, SaveWarningKind, StoreBlockerKind } from '../src';
import { IDENTITY, roomWithHole } from './worlds';

type V3 = [number, number, number];
const gate = (id: string, pos: V3, diameter = 1.2) => ({ id, shape: { kind: 'ring', diameter, tube: 0.08 }, pos, quat: yawQuatStep(4), direction: 'forward' });
const track = (gates: ReturnType<typeof gate>[], over: Record<string, unknown> = {}): TrackFile =>
    ({
        format: 'shramko-sonic-track/1', id: '0000aaaa-00000001', version: 1, parent: null, title: 'Course x',
        scene: { kind: 'scan', id: '0000aaaa', version: 1 }, transform: [1, 0, 0, 0], gates, laps: 1,
        start: { pos: [18, 3, 5], yawDeg: 90 }, author: { kind: 'generator', name: 'gsfpv-course' },
        generator: { name: 'gsfpv-course', version: '1', seed: 1, params: {} }, created: '2026-11-13T00:00:00Z', ...over
    }) as unknown as TrackFile;
/** the yard of roomWithHole: the grid ends at x = 30 */
const yard = (lastX: number): TrackFile => track([gate('g1', [22, 3, 5]), gate('g2', [26, 3, 5]), gate('g3', [lastX, 3, 5])]);
const walls = roomWithHole();
const check = wallsCheck(walls, IDENTITY);
const kinds = (ws: readonly { kind: string }[]): string[] => ws.map((w) => w.kind);

describe('n-save S1: the editor does not call a gate just past the scan outside', () => {
    it('a gate 2 m past the grid in free air: no problem for the editor, Save allowed; the generator proof still refuses it', () => {
        const near = yard(32);
        expect(check(upgradeTrack(near))).toEqual([]);
        expect(canSave(openEditor(upgradeTrack(near), check))).toBe(true);
        // the generator's strict use: checkTrack without a reach keeps refusing before any sweep
        expect(checkTrack(near, walls, IDENTITY, MARGIN_M, false).outside).toEqual(['g3']);
    });

    it('control: a gate far past the reach is still named outside, as a warning (Save allowed)', () => {
        const far = upgradeTrack(yard(30 + NEAR_GRID_M + 5));
        const problems = check(far);
        expect(problems).toEqual([{ code: 'outside', gate: 'g3' }]);
        const v = saveVerdict(far, problems);
        expect(v.blockers).toEqual([]);
        expect(v.warnings).toEqual([{ kind: 'in-scan', gates: ['g3'] }]);
    });
});

describe('n-save S1: saveVerdict', () => {
    // a gate in the room's wall (z 2 is no part of the hole) and two gates on one spot
    const messy = upgradeTrack(track([gate('g1', [22, 3, 5]), gate('g2', [10.2, 3, 2]), gate('g3', [22.1, 3, 5])]));

    it('a gate in a wall and two gates on one spot: problems, but no blocker and Save allowed', () => {
        const problems = check(messy);
        expect(problems.some((p) => p.code === 'gate-wall' && p.gate === 'g2'), JSON.stringify(problems)).toBe(true);
        const v = saveVerdict(messy, problems);
        expect(v.blockers).toEqual([]);
        expect(v.warnings).toContainEqual({ kind: 'in-scan', gates: ['g2'] });
        expect(v.warnings).toContainEqual({ kind: 'same-place', gates: ['g1'] });
        expect(v.warnings).toContainEqual({ kind: 'same-place', gates: ['g3'] });
        expect(kinds(v.warnings)).not.toContain('outside');
        expect(canSave(openEditor(messy, check))).toBe(true);
        // the server contract stores it as it is
        expect(validateServerTrack(JSON.parse(JSON.stringify(track(messy.gates as never)))).ok).toBe(true);
    });

    it('the mapping of the editor problems and live warnings (t7-plan Part C 4), in the dialog order', () => {
        const c = upgradeTrack(yard(28));
        const problems: CourseProblem[] = [
            { code: 'leg-wall', from: 'g1', to: 'g2', freeM: 0 },
            { code: 'gate-direction', gate: 'g3', deg: 90 },
            { code: 'start-wall', freeM: 0 },
            { code: 'outside', gate: 'g1' },
            { code: 'gate-wall', gate: 'g2', freeM: 0 }
        ];
        const live = [{ code: 'sharp-turn', gate: 'g2' }, { code: 'too-close', gate: 'g3' }, { code: 'wall-in-opening', gate: 'g3' }, { code: 'leg-long', gate: 'g1' }, { code: 'under-ground', gate: 'g1' }];
        const v = saveVerdict(c, problems, live);
        expect(v.blockers).toEqual([]);
        expect(v.warnings).toEqual([
            { kind: 'in-scan', gates: ['g1'] },
            { kind: 'in-scan', gates: ['g2'] },
            { kind: 'in-scan', gates: ['g3'] },
            { kind: 'under-ground', gates: ['g1'] },
            { kind: 'too-close', gates: ['g3'] },
            { kind: 'sharp-turn', gates: ['g2'] },
            { kind: 'blocked-start', gates: [] },
            { kind: 'leg-blocked', gates: ['g1', 'g2'] },
            { kind: 'wrong-way', gates: ['g3'] }
        ] satisfies { kind: SaveWarningKind; gates: string[] }[]);
        expect(saveVerdict(c, [{ code: 'no-start' }]).warnings).toEqual([{ kind: 'blocked-start', gates: [] }]);
    });

    it(`a live too-close on a gate within ${SAME_PLACE_M} m of another is same-place`, () => {
        const v = saveVerdict(messy, [], [{ code: 'too-close', gate: 'g3' }]);
        expect(kinds(v.warnings)).toEqual(['same-place', 'same-place']);
    });

    it('blockers mirror the server: each course the server contract refuses is named, the same one fixed is stored', () => {
        const ok = yard(28);
        const cases: { kind: StoreBlockerKind; t: TrackFile; names?: { name?: string; title?: string } }[] = [
            { kind: 'no-gates', t: track([]) },
            { kind: 'too-many-gates', t: track(Array.from({ length: 61 }, (_, i) => gate(`g${i + 1}`, [1 + (i % 9), 3, 1 + Math.floor(i / 9)]))) },
            { kind: 'gate-too-big', t: track([gate('g1', [22, 3, 5], 21), gate('g2', [26, 3, 5])]) },
            { kind: 'leg-too-long', t: yard(26 + 61) },
            { kind: 'too-far', t: yard(20000) },
            { kind: 'name-refused', t: track(ok.gates as never, { author: { kind: 'person', name: 'A' }, generator: null }), names: { name: 'A' } }
        ];
        for (const c of cases) {
            expect(validateServerTrack(JSON.parse(JSON.stringify(c.t))).ok, c.kind).toBe(false);
            expect(kinds(saveVerdict(upgradeTrack(c.t), [], [], c.names).blockers), c.kind).toContain(c.kind);
        }
        expect(validateServerTrack(JSON.parse(JSON.stringify(ok))).ok).toBe(true);
        expect(saveVerdict(upgradeTrack(ok), [], [], { name: 'Andrii Shramko', title: 'My yard' }).blockers).toEqual([]);
        // a closed course: the leg back counts as the server counts it
        expect(kinds(saveVerdict(upgradeTrack({ ...yard(28), laps: 3, gates: [gate('g1', [0, 3, 5]), gate('g2', [30, 3, 5]), gate('g3', [61, 3, 5])] } as never), []).blockers)).toEqual(['leg-too-long']);
    });
});
