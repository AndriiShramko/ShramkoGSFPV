// Stage X3 (train 3, lane fix3a): a generated closed course starts at the gate nearest the scene's spawn; the gates, their
// places and the direction of travel stay the generator's. Open courses keep their order.
import { describe, expect, it } from 'vitest';
import { checkTrack, freeSpace, generateCourse, startNearSpawn } from '../src';
import type { TrackFile, TrackGate, Vec3 } from '../src';
import { IDENTITY, SPAWN_A, threeRooms } from './worlds';

const gate = (i: number, pos: Vec3): TrackGate => ({ id: `g${i + 1}`, shape: { kind: 'ring', diameter: 1.2, tube: 0.05 }, pos, quat: [1, 0, 0, 0], direction: 'forward' });
const same = (p: Vec3): Vec3 => p;
const key = (g: TrackGate): string => (g.pos as number[]).join(',');
const d = (a: readonly number[], b: readonly number[]): number => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
/** the cyclic successor of every gate by place: the direction of travel of a ring */
const successors = (gs: readonly TrackGate[]): Map<string, string> => new Map(gs.map((g, i) => [key(g), key(gs[(i + 1) % gs.length]!)]));

describe('startNearSpawn (pure)', () => {
    const ring = [[0, 1, -10], [10, 1, -10], [10, 1, 0], [3, 1, 1], [0, 1, 0]].map((p, i) => gate(i, p as Vec3));
    it('turns a ring to start at the gate nearest the spawn: same gates, same direction, numbered from there', () => {
        const got = startNearSpawn(ring, [3, 1, 3], same, () => true, () => 0);
        expect(got.map(key)).toEqual([ring[3]!, ring[4]!, ring[0]!, ring[1]!, ring[2]!].map(key));
        expect(got.map((g) => g.id)).toEqual(['g1', 'g2', 'g3', 'g4', 'g5']);
        expect(new Set(got.map(key))).toEqual(new Set(ring.map(key)));
        expect(successors(got)).toEqual(successors(ring));
    });
    it('keeps the order when the turned ring is not proven, or gate 1 is already the nearest', () => {
        expect(startNearSpawn(ring, [3, 1, 3], same, () => false, () => 0).map(key)).toEqual(ring.map(key));
        expect(startNearSpawn(ring, [0, 1, -9], same, () => true, () => 0).map(key)).toEqual(ring.map(key));
    });
});

describe('generateCourse on the three-room world: a closed course starts nearest the spawn', () => {
    const walls = threeRooms();
    const free = freeSpace(walls, { spawn: SPAWN_A });
    const opts = (seed: number, spawn?: Vec3) => ({ seed, scene: { id: 'three-rooms', version: 1 }, transform: IDENTITY, created: '2026-11-15T00:00:00.000Z', spawn });
    it('over seeds 1-6: on every ring gate 1 is the gate nearest the spawn, and the course is proven whole', () => {
        let rings = 0;
        for (let seed = 1; seed <= 6; seed++) {
            const tr: TrackFile = generateCourse(free, walls, opts(seed, SPAWN_A));
            if (tr.laps <= 1 || tr.gates.length < 2) continue;
            rings++;
            const ds = tr.gates.map((g) => d(g.pos, SPAWN_A));
            expect(ds[0]).toBe(Math.min(...ds));
            expect(checkTrack(tr, walls, IDENTITY, (tr.generator?.params['marginM'] as number) ?? 0.4, false).ok).toBe(true);
        }
        expect(rings).toBeGreaterThan(0);
    });
    it('another spawn gives the same gates in the same direction, only another gate 1', () => {
        // a spawn beside gate k of the course: the ring is turned to start there when the turned ring is proven whole (its
        // two changed legs clear); every course, turned or not, keeps the gates and their direction
        let turned = 0;
        for (let seed = 1; seed <= 6; seed++) {
            const a = generateCourse(free, walls, opts(seed, SPAWN_A));
            if (a.laps <= 1 || a.gates.length < 3) continue;
            for (let k = 1; k < a.gates.length; k++) {
                const at = a.gates[k]!.pos as Vec3;
                const b = generateCourse(free, walls, opts(seed, [at[0], at[1], at[2] + 0.01]));
                expect(new Set(b.gates.map(key))).toEqual(new Set(a.gates.map(key)));
                expect(successors(b.gates)).toEqual(successors(a.gates));
                if (key(b.gates[0]!) === key(a.gates[k]!)) turned++;
                else expect(key(b.gates[0]!)).toBe(key(a.gates[0]!));
            }
        }
        // the old generator kept gate 1 wherever the spawn was
        expect(turned).toBeGreaterThan(0);
    });
});
