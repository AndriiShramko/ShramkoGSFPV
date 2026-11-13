// Lane tracks T2: the course's keys shipped (Shift+T on and off, Shift+G a new course) keep the keymap sound, on a normal
// page and on a page of the sound mode, where T alone records. Control: course.toggle on plain T (no Shift) is reported as
// a clash with the sound mode's T.
import { describe, expect, it } from 'vitest';
import { KEYMAP, actionFor, keymapProblems } from '../../../packages/prefs/src/keymap';
import type { KeyBinding } from '../../../packages/prefs/src/keymap';

describe('the course keys (shipped)', () => {
    const own = (a: string): KeyBinding => KEYMAP.find((b) => b.action === a)!;

    it('Shift+T and Shift+G are shipped, routed in flight and in a crash, and the map has no problem', () => {
        expect(own('course.toggle').status).toBe('shipped');
        expect(own('course.generate').status).toBe('shipped');
        expect(keymapProblems(KEYMAP)).toEqual([]);
        for (const state of ['flight', 'crash'] as const) {
            expect(actionFor({ code: 'KeyT', shiftKey: true }, state)).toBe('course.toggle');
            expect(actionFor({ code: 'KeyG', shiftKey: true }, state)).toBe('course.generate');
            expect(actionFor({ code: 'KeyT', shiftKey: true }, state, { sonic: true })).toBe('course.toggle');
        }
        // T alone on a sound page is still the recorder's
        expect(actionFor({ code: 'KeyT', shiftKey: false }, 'flight', { sonic: true })).toBe('sonic.record');
    });

    it('control: course.toggle on plain T clashes with the sound mode\'s T', () => {
        const plain = KEYMAP.map((b) => (b.action === 'course.toggle' ? { ...b, keys: [{ ...b.keys[0]!, shift: false, cap: 'T', aria: 'T' }] } : b));
        expect(keymapProblems(plain).some((p) => p.includes('course.toggle') && p.includes('sonic.record'))).toBe(true);
    });
});
