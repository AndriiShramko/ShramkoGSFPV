// The measurement switches of the frame's priority (laptop3 P3): ?lodmul= sets the scan's multiplier while the rule is at
// work, ?viewlodfar= the far field's levels; out of range or absent leaves the defaults.
import { describe, expect, it } from 'vitest';
import { ENGINE_RULE, VIEW_LOD_DEFAULTS, lodRule } from '../src/view-lod';
import * as viewLod from '../src/view-lod';

describe('lodRule with a multiplier asked for', () => {
    it('at work: the multiplier asked for, within its range', () => {
        expect(lodRule(true, 6, 1.5).lodMultiplier).toBe(1.5);
        expect(lodRule(true, 6, 1.2).lodMultiplier).toBe(1.2);
        expect(lodRule(true, 6, 4).lodMultiplier).toBe(4);
    });

    it('at work without one, or with one out of range: the default 2', () => {
        expect(lodRule(true, 6).lodMultiplier).toBe(2);
        expect(lodRule(true, 6, 1).lodMultiplier).toBe(2);
        expect(lodRule(true, 6, 9).lodMultiplier).toBe(2);
        expect(lodRule(true, 6, Number.NaN).lodMultiplier).toBe(2);
    });

    it('not at work: the engine\'s rule whatever was asked (control)', () => {
        expect(lodRule(false, 6, 1.5)).toEqual(ENGINE_RULE);
    });

    it('the defaults carry the multiplier 2', () => {
        expect(VIEW_LOD_DEFAULTS.lodMultiplier).toBe(2);
    });
});

describe('viewLodParamsOf (the URL switches)', () => {
    it('reads numbers and strings, drops what is out of range', () => {
        const of = viewLod.viewLodParamsOf;
        expect(of(undefined, undefined)).toEqual({});
        expect(of(1.5, 8)).toEqual({ lodMultiplier: 1.5, farLevels: 8 });
        expect(of('1.7', '0')).toEqual({ lodMultiplier: 1.7, farLevels: 0 });
        expect(of('x', 13)).toEqual({ lodMultiplier: 2 });
        expect(of(0.5, -1)).toEqual({ lodMultiplier: 2 });
    });
});
