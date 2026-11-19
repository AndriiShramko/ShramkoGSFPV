// Lane gen4a, stage A1: the scan analysis on four synthetic scans. Each test carries its negative control inside it where
// the old rule exists (qualityMap's ground counted from the bottom).
import { describe, expect, it } from 'vitest';
import { analyzeScan, flownCollision, qualityMap, scanTile } from '../src';
import type { ScanAnalysis, SceneTransform, Vec3 } from '../src';
import { IDENTITY } from './worlds';
import { ROOF_AT, ROOM_IN, SKULL, SLAB_TOP_M, STREET_AT, TABLE_HALF, cityFromAbove, plantTray, scannedRoom, tableAndSkull } from './scan-worlds';

const at = (a: ScanAnalysis, arr: Float32Array | Uint8Array, p: Vec3): number => {
    const t = scanTile(a, p);
    return t < 0 ? NaN : arr[t]!;
};
const flat = (a: Vec3, b: Vec3): number => Math.sqrt((a[0] - b[0]) * (a[0] - b[0]) + (a[2] - b[2]) * (a[2] - b[2]));

describe('analyzeScan: the kind, the ground, the roofs and the best part of a scan', () => {
    it('a closed room is a room: a ceiling over the floor, the floor as its ground', () => {
        const a = analyzeScan(scannedRoom(), IDENTITY);
        expect(a.kind).toBe('room');
        const mid: Vec3 = [5, 2, 4];
        const block = 0.4;
        expect(Math.abs(at(a, a.groundTop, mid) - ROOM_IN[0][1])).toBeLessThanOrEqual(block);
        expect(Math.abs(at(a, a.ceiling, mid) - ROOM_IN[1][1])).toBeLessThanOrEqual(block);
        expect(at(a, a.footprint, mid)).toBe(1);
        expect(a.measures.ceilingShare).toBeGreaterThanOrEqual(0.6);
    });

    it('a skull on a table is an object: the core is the skull, the air beside the table is not scanned territory', () => {
        const a = analyzeScan(tableAndSkull(), IDENTITY);
        expect(a.kind).toBe('object');
        expect(flat(a.core, SKULL)).toBeLessThan(0.1);
        expect(a.coreRadiusM).toBeLessThan(0.3);
        // tiles in the scan's own proportion: a 1 m scene gets 10 cm tiles, not the street's 4 m
        expect(a.tileM).toBeLessThanOrEqual(0.1);
        expect(at(a, a.footprint, [0, 0.8, 0])).toBe(1);
        expect(at(a, a.footprint, [TABLE_HALF[0] + 0.25, 0.8, 0]) === 1).toBe(false);
        expect(at(a, a.footprint, [1.3, 0.8, 0]) === 1).toBe(false);
        // the skull is the best part, the bare table top is not
        expect(at(a, a.quality, SKULL)).toBe(1);
        expect(at(a, a.quality, [-0.3, 0.8, -0.2])).toBeLessThan(at(a, a.quality, SKULL));
    });

    it('the same skull flown at Scene size x15 gives the same analysis x15', () => {
        const T = [15, 0, 0, 0] as unknown as SceneTransform;
        const a = analyzeScan(flownCollision(tableAndSkull(), T), T);
        expect(a.unitM).toBe(15);
        expect(a.kind).toBe('object');
        expect(flat(a.core, [SKULL[0] * 15, 0, SKULL[2] * 15])).toBeLessThan(1.5);
    });

    it('a city from above: groundTop is the TOP of the fuzzy ground shell, the roofs stand over it', () => {
        const walls = cityFromAbove();
        const a = analyzeScan(walls, IDENTITY);
        expect(a.kind).toBe('cityAbove');
        const block = 0.8;
        expect(Math.abs(at(a, a.groundTop, STREET_AT) - SLAB_TOP_M)).toBeLessThanOrEqual(block);
        expect(at(a, a.roofTop, ROOF_AT) - SLAB_TOP_M).toBeGreaterThanOrEqual(10);
        expect(a.measures.groundCrisp).toBeLessThan(0.5 * a.measures.upperCrisp);
        // control: the old rule (qualityMap's ground, counted from the bottom) does not find the shell's top in a street
        const q = qualityMap(walls);
        const tx = Math.floor((STREET_AT[0] - q.x0) / q.tileM), tz = Math.floor((STREET_AT[2] - q.z0) / q.tileM);
        const old = q.ground[tz * q.nx + tx]!;
        expect(Number.isFinite(old) && Math.abs(old - SLAB_TOP_M) <= block).toBe(false);
    });

    it('a tray of plants is plants: the leaves fill the volume over the soil', () => {
        const a = analyzeScan(plantTray(), IDENTITY);
        expect(a.kind).toBe('plants');
        expect(at(a, a.footprint, [0.5, 0.2, 0.5])).toBe(1);
        expect(at(a, a.footprint, [1.15, 0.2, 0.5]) === 1).toBe(false);
        expect(a.measures.coreFill).toBeGreaterThanOrEqual(0.25);
    });
});
