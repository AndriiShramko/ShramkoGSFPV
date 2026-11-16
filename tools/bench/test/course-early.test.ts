// Integration E (2026-11-16, live): Shift+G pressed before the course's chunk was there did nothing. The stub
// (apps/fly/src/app/builtin/course-lazy.ts) keeps the last early press and gives it to the feature once.
import { describe, expect, it } from 'vitest';
import { EARLY_ACTIONS, EARLY_KEEP_MS, earlyPress } from '../../../apps/fly/src/app/builtin/course-early';

describe('a course key pressed before the course chunk is there', () => {
    it('is given back when the chunk arrives 1.3 s later (the time measured on the live site)', () => {
        const e = earlyPress(EARLY_KEEP_MS);
        e.note('course.generate', 1000);
        expect(e.take(2300)).toBe('course.generate');
    });
    it('is given back once only', () => {
        const e = earlyPress(EARLY_KEEP_MS);
        e.note('course.generate', 0);
        expect(e.take(100)).toBe('course.generate');
        expect(e.take(200)).toBeNull();
    });
    it('the last press wins', () => {
        const e = earlyPress(EARLY_KEEP_MS);
        e.note('course.generate', 0);
        e.note('course.edit', 500);
        expect(e.take(900)).toBe('course.edit');
    });
    it('a press older than the keep time is not run', () => {
        const e = earlyPress(EARLY_KEEP_MS);
        e.note('course.toggle', 0);
        expect(e.take(EARLY_KEEP_MS + 1)).toBeNull();
    });
    it('nothing pressed: nothing to run', () => {
        expect(earlyPress(EARLY_KEEP_MS).take(5000)).toBeNull();
    });
    it('the three course keys are taken: make, show or hide, edit', () => {
        expect([...EARLY_ACTIONS].sort()).toEqual(['course.edit', 'course.generate', 'course.toggle']);
    });
});
