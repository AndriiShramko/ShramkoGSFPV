// Lane gap-gen, stage S3: at the owner's own scale (the skull 5dfeb49b at Scene size x15) the start and the finish of an
// asked course stand in the most detailed part (brief: 'the start and the end in the most detailed part of the scan').
// The skull's pro ring turned to its nearest gate failed the proof, and the walk's gate 1 stayed 19.7 m from the core while
// another gate stood 2.3 m from it: an asked course tries the next nearest gates too (START_TRIES), the old g1 course one.
import { describe, expect, it } from 'vitest';
import { SEAM_DROPS, START_BACK_M, START_TRIES, startNearSpawn, turnToSpawn } from '../src';
import type { TrackGate, Vec3 } from '../src';

const gate = (i: number, pos: Vec3): TrackGate => ({ id: `g${i + 1}`, shape: { kind: 'ring', diameter: 1.2, tube: 0.05 }, pos, quat: [1, 0, 0, 0], direction: 'forward' });
const same = (p: Vec3): Vec3 => p;
const key = (g: TrackGate): string => (g.pos as readonly number[]).join(',');

describe('gap-gen S3: the start near the core', () => {
    // gate 1 of the walk far out, the nearest gate (index 3) not provable as gate 1, the next nearest (index 4) provable
    const places: Vec3[] = [[20, 1, 0], [30, 1, 10], [10, 1, 10], [1, 1, 0], [3, 1, 0]];
    const ring = places.map((p, i) => gate(i, p));
    const notNearest = (gs: TrackGate[]): boolean => key(gs[0]!) !== key(ring[3]!);
    it('an asked course (tries > 1) starts at the next nearest gate when the nearest is not proven', () => {
        expect(START_TRIES).toBeGreaterThan(1);
        const got = startNearSpawn(ring, [0, 1, 0], same, notNearest, () => 0, START_TRIES);
        expect(got.map(key)).toEqual([ring[4]!, ring[0]!, ring[1]!, ring[2]!, ring[3]!].map(key));
        expect(got.map((g) => g.id)).toEqual(['g1', 'g2', 'g3', 'g4', 'g5']);
    });
    it('the old g1 course (one try) keeps the walk order, as its shared links lay it', () => {
        expect(startNearSpawn(ring, [0, 1, 0], same, notNearest, () => 0).map(key)).toEqual(ring.map(key));
    });
    it('the search ends at the walk\'s own gate 1 when it is nearer than every provable turn', () => {
        const far: Vec3[] = [[2, 1, 0], [30, 1, 10], [10, 1, 10], [1, 1, 0], [3, 1, 0]];
        const r2 = far.map((p, i) => gate(i, p));
        const got = startNearSpawn(r2, [0, 1, 0], same, (gs) => key(gs[0]!) !== key(r2[3]!), () => 0, START_TRIES);
        expect(got.map(key)).toEqual(r2.map(key));
    });
});

// The skull at x15, pro seed 3: the walk went out 78 m and came back to 3.3 m of the core; every turn to a near gate failed
// because the leg from the scan's start crossed the new gate 1 66-72 deg off its axis and the lap leg into the walk's own
// gate 1 was 59 deg off. turnToSpawn moves the start onto the new gate 1's approach and leaves the walk's gate 1 out.
describe('gap-gen S3: a turned asked ring starts on its gate 1 approach', () => {
    const places: Vec3[] = [[20, 1, 0], [30, 1, 10], [10, 1, 10], [6, 1, 0], [1, 1, 0], [3, 1, 2]];
    const ring = places.map((p, i) => gate(i, p));
    const axis = (): Vec3 => [0, 0, -1]; // quat [1, 0, 0, 0]: passed toward -z
    const onApproach = (gs: TrackGate[], from: Vec3 | null): boolean =>
        from !== null && from[0] === gs[0]!.pos[0] && from[2] === (gs[0]!.pos[2] as number) + START_BACK_M[0]!;
    it('a turn the scan start cannot prove starts behind gate 1 on its axis, without the walk gate 1', () => {
        const got = turnToSpawn(ring, [0, 1, 0], same, axis, (gs, from) => onApproach(gs, from) && !gs.some((g) => key(g) === key(ring[0]!)), START_TRIES, 4);
        expect(got.gates.map(key)).toEqual([ring[4]!, ring[5]!, ring[1]!, ring[2]!, ring[3]!].map(key));
        expect(got.gates.map((g) => g.id)).toEqual(['g1', 'g2', 'g3', 'g4', 'g5']);
        expect(got.from).toEqual([1, 1, 4]);
    });
    it('the walk gate 1 stays when the ring would fall under minGates without it', () => {
        const got = turnToSpawn(ring, [0, 1, 0], same, axis, (gs, from) => onApproach(gs, from) && !gs.some((g) => key(g) === key(ring[0]!)), START_TRIES, 6);
        expect(got.gates.map(key)).toEqual(ring.map(key));
        expect(got.from).toBeNull();
    });
    it('the walk gates 1 and 2 left out when gate 2 still meets the seam off its axis (SEAM_DROPS)', () => {
        expect(SEAM_DROPS).toBeGreaterThanOrEqual(2);
        const without2 = (gs: TrackGate[]): boolean => !gs.some((g) => key(g) === key(ring[0]!) || key(g) === key(ring[1]!));
        const got = turnToSpawn(ring, [0, 1, 0], same, axis, (gs, from) => onApproach(gs, from) && without2(gs), START_TRIES, 3);
        expect(got.gates.map(key)).toEqual([ring[4]!, ring[5]!, ring[2]!, ring[3]!].map(key));
        expect(got.from).toEqual([1, 1, 4]);
    });
    it('a turn the scan start proves keeps that start', () => {
        const got = turnToSpawn(ring, [0, 1, 0], same, axis, (_gs, from) => from === null, START_TRIES, 4);
        expect(got.gates.map(key)).toEqual([ring[4]!, ring[5]!, ring[0]!, ring[1]!, ring[2]!, ring[3]!].map(key));
        expect(got.from).toBeNull();
    });
});
