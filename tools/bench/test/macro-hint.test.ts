// v0.9 lane C, item 17: the one-time hint for a scene that starts at the owner's size of x2 or more
// (apps/fly/src/app/macro-hint.ts). The rule, and the browser's note that it was shown. Controls: each
// case that must stay quiet differs from the one that speaks in exactly one fact.
import { describe, expect, it } from 'vitest';
import { MACRO_HINT_KEY, MACRO_HINT_MIN, macroHintDue, macroHintSeen, markMacroHintSeen } from '../../../apps/fly/src/app/macro-hint';
import type { MacroHintFacts } from '../../../apps/fly/src/app/macro-hint';

const SPEAKS: MacroHintFacts = { start: 5, ownerDefault: 5, pilotOwn: false, sharedSize: false, seen: false };

describe('the macro hint rule', () => {
    it('speaks when the scene starts at the owner\'s x2 or more, once, with no size of the pilot\'s or a link\'s', () => {
        expect(macroHintDue(SPEAKS)).toBe(true);
        expect(macroHintDue({ ...SPEAKS, start: MACRO_HINT_MIN, ownerDefault: MACRO_HINT_MIN })).toBe(true);
        expect(macroHintDue({ ...SPEAKS, start: 100, ownerDefault: 100 })).toBe(true);
    });

    it('is quiet in each case that differs by one fact', () => {
        expect(macroHintDue({ ...SPEAKS, start: 1.99, ownerDefault: 1.99 })).toBe(false); // below x2
        expect(macroHintDue({ ...SPEAKS, start: 1, ownerDefault: 1 })).toBe(false); // an ordinary scene
        expect(macroHintDue({ ...SPEAKS, ownerDefault: 0.5, start: 0.5 })).toBe(false); // a shrunk one
        expect(macroHintDue({ ...SPEAKS, pilotOwn: true })).toBe(false); // the pilot tuned it himself
        expect(macroHintDue({ ...SPEAKS, start: 3 })).toBe(false); // it starts at another size than the owner's
        expect(macroHintDue({ ...SPEAKS, sharedSize: true })).toBe(false); // a shared link's size: its chip says it
        expect(macroHintDue({ ...SPEAKS, seen: true })).toBe(false); // said before
    });

    it('a start that is the owner\'s size to the single-precision rounding of the session counts', () => {
        expect(macroHintDue({ ...SPEAKS, start: Math.fround(3.3), ownerDefault: 3.3 })).toBe(true);
    });
});

describe('the note that it was shown', () => {
    const box = (): { m: Map<string, string>; getItem(k: string): string | null; setItem(k: string, v: string): void } => {
        const m = new Map<string, string>();
        return { m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
    };

    it('is written once shown and read back', () => {
        const s = box();
        expect(macroHintSeen(s)).toBe(false);
        markMacroHintSeen(s);
        expect(s.m.get(MACRO_HINT_KEY)).toBe('1');
        expect(macroHintSeen(s)).toBe(true);
    });

    it('a blocked or missing storage reads as not yet, and writing to it never throws (the hint shows again, which is harmless)', () => {
        const blocked = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
        expect(macroHintSeen(blocked)).toBe(false);
        expect(() => markMacroHintSeen(blocked)).not.toThrow();
        expect(macroHintSeen(null)).toBe(false);
        expect(() => markMacroHintSeen(null)).not.toThrow();
    });
});
