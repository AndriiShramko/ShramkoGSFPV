// Lane tracks2, stage K1: a pilot who follows the course's own beacon path registers every gate in the course's own lap
// detector, fed one straight step per 60 Hz frame as a page feeds it, at 3 m/s and at 12 m/s. Before K1 a gate whose leg
// out turned back more than 90 degrees from its axis was only touched at its centre (the race of lane rooms2 stood at
// gate 2 on 887f27aa; the audit tools/bench/src/tracks-audit.ts found it on most generated courses).
import { describe, expect, it } from 'vitest';
import { analyticCollision } from '@gsfpv/collision';
import { checkTrack, coursePath, flyPath, freeSpace, gateMisses, generateCourse, pathProblems, sweeperOf, yawQuatStep } from '../src';
import type { TrackFile } from '../src';
import { IDENTITY, SPAWN_A, threeRooms } from './worlds';

const SCENE = { id: '0000aaaa', version: 1 };

/** A hairpin: gate g1 passed toward -z, gate g2 behind it and to the side, so the leg out turns back 150 degrees. */
function hairpin(laps: number): TrackFile {
    return {
        format: 'shramko-sonic-track/1',
        id: 'g1.test',
        version: 1,
        parent: null,
        title: 'hairpin',
        scene: { kind: 'scan', id: SCENE.id, version: 1 },
        transform: [1, 0, 0, 0],
        gates: [
            { id: 'g1', shape: { kind: 'ring', diameter: 1.2, tube: 0.08 }, pos: [10, 2, 6], quat: yawQuatStep(0), direction: 'forward' },
            { id: 'g2', shape: { kind: 'ring', diameter: 1.2, tube: 0.08 }, pos: [12.5, 2, 10.5], quat: yawQuatStep(8), direction: 'forward' }
        ],
        laps,
        start: { pos: [10, 2, 12], yawDeg: 0 },
        author: { kind: 'generator', name: 'test' },
        created: '2026-11-14T00:00:00.000Z'
    } as unknown as TrackFile;
}

describe('the path pilot registers every gate', () => {
    const box = analyticCollision([0, 0, 0], [20, 6, 20], 0.1, (x, y, z) => x < 0.5 || x > 19.5 || y < 0.3 || y > 5.7 || z < 0.5 || z > 19.5);

    it('a hairpin gate (the leg out turns back 150 degrees) is flown through, open and closed, at 3 and 12 m/s', () => {
        for (const laps of [1, 3]) {
            const t = hairpin(laps);
            for (const v of [3, 12]) {
                const f = flyPath(t, v);
                expect(f.misses, `laps ${laps} at ${v} m/s`).toEqual([]);
                expect(f.done, `laps ${laps} at ${v} m/s`).toBe(true);
                expect(f.laps).toBe(laps);
            }
            expect(pathProblems(coursePath(t), t, IDENTITY, sweeperOf(box), 0.3)).toEqual([]);
            expect(checkTrack(t, box, IDENTITY, 0.5, false).ok).toBe(true);
        }
    });

    it('a turn after a gate into a wall is no proof: the gate is not clear', () => {
        // the same hairpin with a wall between g1's way out and g2
        const walled = analyticCollision([0, 0, 0], [20, 6, 20], 0.1, (x, y, z) => x < 0.5 || x > 19.5 || y < 0.3 || y > 5.7 || z < 0.5 || z > 19.5 || (x > 9.2 && x < 11.6 && z > 4 && z < 4.6));
        const r = checkTrack(hairpin(1), walled, IDENTITY, 0.5, false);
        expect(r.gates[0]!.clear).toBe(false);
        expect(r.issues.some((s) => s.includes('turn after'))).toBe(true);
    });

    it('generated courses on the three-room world: 0 gates missed at 3 and 12 m/s over 6 seeds', { timeout: 300_000 }, () => {
        const walls = threeRooms();
        const free = freeSpace(walls, { spawn: SPAWN_A });
        let missed = 0;
        let gates = 0;
        for (let seed = 1; seed <= 6; seed++) {
            const t = generateCourse(free, walls, { seed, scene: SCENE, transform: IDENTITY, created: '2026-11-14T00:00:00.000Z' });
            gates += t.gates.length;
            for (const v of [3, 12]) missed += gateMisses(t, v).length;
        }
        expect(gates).toBeGreaterThan(6);
        expect(missed).toBe(0);
    });
});
