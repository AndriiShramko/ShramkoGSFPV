import { describe, expect, it } from 'vitest';
import { SCHEMA, checkValue, defineSettings } from '../src';
import type { EnumDef, JsonDef, NumDef, SettingDef } from '../src';

const num = (over: Partial<NumDef> = {}): NumDef => ({ id: 'test.n', group: 'display', scope: 'global', type: 'number', min: 0, max: 10, step: 1, default: 5, apply: 'live', shown: ['settings'], status: 'planned', since: 1, ...over });
const en = (over: Partial<EnumDef> = {}): EnumDef => ({ id: 'test.e', group: 'display', scope: 'global', type: 'enum', options: ['a', 'b'], default: 'a', apply: 'live', shown: ['settings'], status: 'planned', since: 1, ...over });

describe('defineSettings (A.11 schema)', () => {
    it('throws on a duplicate id', () => {
        expect(() => defineSettings([num(), num()])).toThrow(/test\.n: defined twice/);
    });

    it('throws on a default outside its range', () => {
        expect(() => defineSettings([num({ default: 11 })])).toThrow(/default 11 outside 0\.\.10/);
        expect(() => defineSettings([num({ default: -1 })])).toThrow(/outside/);
    });

    it('throws on an enum default that is not an option', () => {
        expect(() => defineSettings([en({ default: 'c' })])).toThrow(/default 'c' is not an option/);
    });

    it('throws on a preset default without a fallback, or on a setting that is not per drone', () => {
        expect(() => defineSettings([num({ scope: 'drone', default: { preset: 'v_crash_ms' } })])).toThrow(/without a fallback/);
        expect(() => defineSettings([num({ default: { preset: 'v_crash_ms', fallback: 4 } })])).toThrow(/needs scope 'drone'/);
    });

    it('throws on a key action the keymap does not have, a reused URL parameter, a bad id', () => {
        expect(() => defineSettings([num({ action: 'no.such' })])).toThrow(/action no\.such is not in the keymap/);
        expect(() => defineSettings([num({ url: 'g' }), en({ url: 'g' })])).toThrow(/already used by test\.n/);
        expect(() => defineSettings([num({ id: 'nodot' })])).toThrow(/is not '<group>\.<name>'/);
    });

    it('throws on a JSON default its own validator would change', () => {
        const j: JsonDef = { id: 'test.j', group: 'tune', scope: 'drone', type: 'json', kind: 'pid', validate: () => ({ fixed: true }), default: { raw: 1 }, apply: 'life', shown: ['settings'], status: 'planned', since: 1 };
        expect(() => defineSettings([j])).toThrow(/does not pass its own validator/);
    });

    it('lists every problem at once, so one run shows the whole list', () => {
        try {
            defineSettings([num({ default: 99 }), en({ default: 'z' })]);
            expect.unreachable();
        } catch (e) {
            expect(String(e)).toMatch(/test\.n.*test\.e/);
        }
    });

    it('control: the real SCHEMA passes and is in group order', () => {
        expect(() => defineSettings(SCHEMA.defs)).not.toThrow();
        const order = SCHEMA.defs.map((d) => SCHEMA.groups.indexOf(d.group));
        expect(order).toEqual([...order].sort((a, b) => a - b));
    });

    it('sorts a def into its group even when its file lists it elsewhere (stats.ts is in display)', () => {
        const s = defineSettings([en({ id: 'x.late', group: 'recording' }), num({ id: 'x.early', group: 'flight' })]);
        expect(s.defs.map((d) => d.id)).toEqual(['x.early', 'x.late']);
    });
});

describe('checkValue', () => {
    const d = num() as SettingDef;
    it('clamps a number into range and says so', () => {
        expect(checkValue(d, 12)).toEqual({ ok: true, value: 10, clamped: true });
        expect(checkValue(d, 3)).toEqual({ ok: true, value: 3, clamped: false });
    });
    it('refuses a wrong type, NaN and an unknown option', () => {
        expect(checkValue(d, '3')).toEqual({ ok: false, reason: 'type' });
        expect(checkValue(d, NaN)).toEqual({ ok: false, reason: 'range' });
        expect(checkValue(en(), 'c')).toEqual({ ok: false, reason: 'option' });
        expect(checkValue(en(), 1)).toEqual({ ok: false, reason: 'type' });
    });
    it('a JSON value repaired by its validator counts as clamped, and is a copy', () => {
        const pid = SCHEMA.byId.get('tune.pid')!;
        const v = { roll: [300, 1, 2, 3], pitch: [1, 2, 3, 4], yaw: [1, 2, 3, 4] };
        const c = checkValue(pid, v);
        expect(c).toEqual({ ok: true, value: { roll: [250, 1, 2, 3], pitch: [1, 2, 3, 4], yaw: [1, 2, 3, 4] }, clamped: true });
        expect(v.roll[0]).toBe(300);
    });
});
