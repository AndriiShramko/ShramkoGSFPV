// The far rim inside the frame (laptop4 Q2, ?viewlodrim=): a node in the frame further than RIM_FROM times the nearest one
// is made up to rimLevels levels coarser, so a small budget goes to the near field; off (0) by default.
import { describe, expect, it } from 'vitest';
import * as viewLod from '../src/view-lod';

const rim = (d: number, near: number, levels: number, m: number): number => {
    expect(typeof viewLod.rimFactor).toBe('function');
    return viewLod.rimFactor(d, near, levels, m);
};

describe('rimFactor', () => {
    it('leaves the near field alone: up to RIM_FROM times the nearest node', () => {
        expect(rim(150, 150, 2, 2)).toBe(1);
        expect(rim(150 * viewLod.RIM_FROM, 150, 2, 2)).toBe(1);
    });

    it('reaches rimLevels levels (the multiplier to that power) at RIM_FROM * RIM_SPAN and stays there', () => {
        const full = 150 * viewLod.RIM_FROM * viewLod.RIM_SPAN;
        expect(rim(full, 150, 2, 2)).toBeCloseTo(4, 6);
        expect(rim(full * 3, 150, 2, 2)).toBeCloseTo(4, 6);
        expect(rim(full, 150, 1.5, 1.7)).toBeCloseTo(1.7 ** 1.5, 6);
    });

    it('grows smoothly in between', () => {
        const a = rim(150 * viewLod.RIM_FROM * 1.5, 150, 2, 2);
        const b = rim(150 * viewLod.RIM_FROM * 2, 150, 2, 2);
        const c = rim(150 * viewLod.RIM_FROM * 3, 150, 2, 2);
        expect(a).toBeGreaterThan(1);
        expect(b).toBeGreaterThan(a);
        expect(c).toBeGreaterThan(b);
        expect(c).toBeLessThan(4);
    });

    it('is off at 0 levels or without a near distance', () => {
        expect(rim(5000, 150, 0, 2)).toBe(1);
        expect(rim(5000, 0, 2, 2)).toBe(1);
        expect(rim(5000, Number.NaN, 2, 2)).toBe(1);
    });
});

describe('the switch ?viewlodrim=', () => {
    it('is off by default', () => {
        expect((viewLod.VIEW_LOD_DEFAULTS as { rimLevels?: number }).rimLevels).toBe(0);
    });

    it('reads 0 to 6 from a number or a string, drops the rest', () => {
        const of = viewLod.viewLodParamsOf as (m?: unknown, f?: unknown, r?: unknown) => Record<string, number>;
        expect(of(undefined, undefined, 2)).toEqual({ rimLevels: 2 });
        expect(of(undefined, undefined, '1.5')).toEqual({ rimLevels: 1.5 });
        expect(of(undefined, undefined, 7)).toEqual({});
        expect(of(undefined, undefined, 'x')).toEqual({});
        expect(of(undefined, undefined, -1)).toEqual({});
    });
});
