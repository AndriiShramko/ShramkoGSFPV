// Lane review TR-3: a saved course with a gate far outside the scan was proven (outside the walls' grid counted as free) and a
// gate 500 m out kept the page's worker in the sweeps for minutes. The proof now refuses a course that leaves the walls'
// grid before any sweep. Control: the same course with the far gate brought back into the yard is proven.
import { describe, expect, it } from 'vitest';
import type { TrackFile } from '@shramko/sonic-fpv';
import { MARGIN_M, checkTrack, insideGrid, validateServerTrack, yawQuatStep } from '../src';
import { IDENTITY, roomWithHole } from './worlds';

const gate = (id: string, x: number) => ({ id, shape: { kind: 'ring', diameter: 1.2, tube: 0.08 }, pos: [x, 3, 5], quat: yawQuatStep(4), direction: 'forward' });
const track = (farX: number): TrackFile =>
    ({
        format: 'shramko-sonic-track/1', id: '0000aaaa-00000001', version: 1, parent: null, title: 'Course x',
        scene: { kind: 'scan', id: '0000aaaa', version: 1 }, transform: [1, 0, 0, 0],
        gates: [gate('g1', 22), gate('g2', 26), gate('g3', farX)], laps: 1,
        start: { pos: [18, 3, 5], yawDeg: 90 }, author: { kind: 'generator', name: 'gsfpv-course' },
        generator: { name: 'gsfpv-course', version: '1', seed: 1, params: {} }, created: '2026-11-13T00:00:00Z'
    }) as unknown as TrackFile;

describe('the proof stays inside the walls', () => {
    const walls = roomWithHole();

    it('refuses a gate outside the walls\' grid at once', () => {
        const far = track(130);
        const t0 = performance.now();
        const r = checkTrack(far, walls, IDENTITY, MARGIN_M, false);
        const ms = performance.now() - t0;
        expect(r.ok).toBe(false);
        expect(r.issues.join(' ')).toContain('g3: outside');
        // 50 ms: an estimate far above a bounds test (the sweeps took 1641 ms for this gate before, review log far_*.log)
        expect(ms).toBeLessThan(50);
    });

    it('the server contract refuses the long leg too', () => {
        expect(validateServerTrack(JSON.parse(JSON.stringify(track(500)))).ok).toBe(false);
    });

    it('review T2-2: a smaller course of fitCourse (scale, legMinM, legMaxM in its params) passes the server contract', () => {
        const t = track(28);
        const small = { ...t, generator: { ...t.generator!, params: { marginM: 0.15, scale: 0.3, legMinM: 0.9, legMaxM: 4.5 } } };
        const r = validateServerTrack(JSON.parse(JSON.stringify(small)));
        expect(r.ok, JSON.stringify(r)).toBe(true);
        // control: an unknown key is still refused
        expect(validateServerTrack(JSON.parse(JSON.stringify({ ...small, generator: { ...small.generator, params: { legMidM: 1 } } }))).ok).toBe(false);
    });

    it('insideGrid: the yard is in, 130 m out is not', () => {
        expect(insideGrid(walls, [28, 3, 5])).toBe(true);
        expect(insideGrid(walls, [130, 3, 5])).toBe(false);
    });

    it('control: the same course inside the yard is proven', () => {
        const r = checkTrack(track(28), walls, IDENTITY, MARGIN_M, false);
        expect(r.issues).toEqual([]);
        expect(r.ok).toBe(true);
    });
});
