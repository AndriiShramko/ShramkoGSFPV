// The drawing presets (v0.10 lane R, the owner's items 3 and 4): the built-in table, the owner's changes read strictly from
// the public catalogue, and how they combine. Controls: a reader that trusts the document, one that lets an unknown class or
// an out-of-range number through, a merge that replaces a whole class instead of a field.
import { describe, it, expect } from 'vitest';
import { BUILTIN_PRESETS, PRESET_BUDGET_MAX, PRESET_BUDGET_MIN, PRESET_DRAWINGS, PRESET_SCALE_MAX, PRESET_SCALE_MIN, changedFields, presetFor, presetTable, readDrawingDefaults } from '../src/presets';
import type { DrawingDefaults } from '../src/presets';
import { DEVICE_CLASSES } from '../src/device-class';
import { BUDGET_RANGE_M } from '../src/drawing';

describe('the built-in table', () => {
    it('has every class, every field in its range, sorted drawing', () => {
        expect(Object.keys(BUILTIN_PRESETS)).toEqual([...DEVICE_CLASSES]);
        for (const c of DEVICE_CLASSES) {
            const p = BUILTIN_PRESETS[c];
            expect(PRESET_DRAWINGS, c).toContain(p.drawing);
            expect(p.budgetM, c).toBeGreaterThanOrEqual(PRESET_BUDGET_MIN);
            expect(p.budgetM, c).toBeLessThanOrEqual(PRESET_BUDGET_MAX);
            expect(p.renderScale, c).toBeGreaterThanOrEqual(PRESET_SCALE_MIN);
            expect(p.renderScale, c).toBeLessThanOrEqual(PRESET_SCALE_MAX);
        }
    });

    it('a stronger class never gets a smaller budget or a smaller render scale than a weaker one', () => {
        const order = ['phone', 'tablet', 'desktop-weak', 'desktop-strong'] as const;
        for (let i = 1; i < order.length; i++) {
            expect(BUILTIN_PRESETS[order[i]].budgetM, order[i]).toBeGreaterThanOrEqual(BUILTIN_PRESETS[order[i - 1]].budgetM);
            expect(BUILTIN_PRESETS[order[i]].renderScale, order[i]).toBeGreaterThanOrEqual(BUILTIN_PRESETS[order[i - 1]].renderScale);
        }
    });

    it('the budget range is the link contract\'s (the same 0.25 to 32 M the Splat budget and ?budget= use)', () => {
        expect([PRESET_BUDGET_MIN, PRESET_BUDGET_MAX]).toEqual([BUDGET_RANGE_M.min, BUDGET_RANGE_M.max]);
    });
});

describe('readDrawingDefaults: the public catalogue\'s "drawing", read strictly', () => {
    const full = { presets: { 'desktop-strong': { drawing: 'stochastic', budgetM: 8, renderScale: 1 }, phone: { drawing: 'sorted', budgetM: 1.5, renderScale: 0.6 } } };

    it('keeps known classes, known modes and numbers in range', () => {
        expect(readDrawingDefaults(full)).toEqual(full);
        expect(readDrawingDefaults({ presets: { tablet: { budgetM: 1.25 } } })).toEqual({ presets: { tablet: { budgetM: 1.25 } } });
        // three decimals, like the server
        expect(readDrawingDefaults({ presets: { tablet: { budgetM: 1.23456 } } })).toEqual({ presets: { tablet: { budgetM: 1.235 } } });
    });

    it('drops what it does not know, and says nothing when nothing is left', () => {
        expect(readDrawingDefaults({ presets: { console: { drawing: 'sorted' } } })).toBeUndefined();
        expect(readDrawingDefaults({ presets: { phone: { drawing: 'taa', budgetM: 99, renderScale: 0.1 } } })).toBeUndefined();
        expect(readDrawingDefaults({ presets: { phone: { budgetM: '2', renderScale: Number.NaN } } })).toBeUndefined();
        for (const bad of [undefined, null, 0, 'sorted', [], {}, { presets: [] }, { presets: null }, { presets: { phone: [] } }]) expect(readDrawingDefaults(bad), JSON.stringify(bad)).toBeUndefined();
        // one bad field does not take the good ones of its class
        expect(readDrawingDefaults({ presets: { phone: { drawing: 'sorted', budgetM: 99 } } })).toEqual({ presets: { phone: { drawing: 'sorted' } } });
    });

    it('the range edges are in, a step outside is out', () => {
        expect(readDrawingDefaults({ presets: { phone: { budgetM: PRESET_BUDGET_MIN, renderScale: PRESET_SCALE_MIN } } })).toBeDefined();
        expect(readDrawingDefaults({ presets: { phone: { budgetM: PRESET_BUDGET_MAX, renderScale: PRESET_SCALE_MAX } } })).toBeDefined();
        expect(readDrawingDefaults({ presets: { phone: { budgetM: PRESET_BUDGET_MIN - 0.01 } } })).toBeUndefined();
        expect(readDrawingDefaults({ presets: { phone: { renderScale: PRESET_SCALE_MAX + 0.01 } } })).toBeUndefined();
    });

    it('control: a reader that trusts the document would let an unknown class and a 99 M budget through', () => {
        const trusting = (v: unknown): unknown => (v as { presets?: unknown })?.presets;
        const hostile = { presets: { console: { drawing: 'sorted' }, phone: { budgetM: 99 } } };
        expect(trusting(hostile)).toEqual(hostile.presets);
        expect(readDrawingDefaults(hostile)).toBeUndefined();
    });
});

describe('presetFor and presetTable: the owner\'s fields over the built-in ones', () => {
    const owner: DrawingDefaults = { presets: { 'desktop-strong': { drawing: 'stochastic', budgetM: 8 }, phone: { renderScale: 0.5 } } };

    it('no document: the built-in table', () => {
        for (const c of DEVICE_CLASSES) expect(presetFor(c)).toEqual(BUILTIN_PRESETS[c]);
        expect(presetTable()).toEqual(BUILTIN_PRESETS);
    });

    it('a field the owner set replaces that field only', () => {
        expect(presetFor('desktop-strong', owner)).toEqual({ drawing: 'stochastic', budgetM: 8, renderScale: BUILTIN_PRESETS['desktop-strong'].renderScale });
        expect(presetFor('phone', owner)).toEqual({ ...BUILTIN_PRESETS.phone, renderScale: 0.5 });
        // a class he did not touch is the built-in one
        expect(presetFor('tablet', owner)).toEqual(BUILTIN_PRESETS.tablet);
        // control: a merge that takes the owner's class whole (instead of field by field) loses the render scale of the strong desktop
        const takeWhole = (c: (typeof DEVICE_CLASSES)[number]) => owner.presets[c] ?? BUILTIN_PRESETS[c];
        expect((takeWhole('desktop-strong') as Record<string, unknown>).renderScale).toBeUndefined();
        expect(presetFor('desktop-strong', owner).renderScale).toBe(BUILTIN_PRESETS['desktop-strong'].renderScale);
    });

    it('the table does not alias the built-in one (editing the answer never edits the table)', () => {
        const t = presetTable(owner);
        t.phone.budgetM = 99;
        expect(BUILTIN_PRESETS.phone.budgetM).not.toBe(99);
        expect(presetFor('phone').budgetM).not.toBe(99);
    });

    it('changedFields: only the fields that differ from the built-in value (the admin marks them)', () => {
        expect(changedFields('desktop-strong', owner)).toEqual(['drawing', 'budgetM']);
        // the owner typed the built-in value: not a change
        expect(changedFields('phone', { presets: { phone: { budgetM: BUILTIN_PRESETS.phone.budgetM } } })).toEqual([]);
        expect(changedFields('tablet', owner)).toEqual([]);
        expect(changedFields('tablet')).toEqual([]);
    });
});
