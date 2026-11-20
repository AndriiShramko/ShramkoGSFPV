// Lane gap-gen, stage S3: at the owner's own scale (the skull 5dfeb49b at Scene size x15) the start and the finish of an
// asked course stand in the most detailed part (brief: 'the start and the end in the most detailed part of the scan').
// The skull's pro ring turned to its nearest gate failed the proof, and the walk's gate 1 stayed 19.7 m from the core while
// another gate stood 2.3 m from it: an asked course tries the next nearest gates too (START_TRIES), the old g1 course one.
import { describe, expect, it } from 'vitest';
import { START_TRIES, startNearSpawn } from '../src';
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
