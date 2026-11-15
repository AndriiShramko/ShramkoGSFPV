// Lane quiet2, stage fixes (review QW-1, QW-2, QW-3, QW-5, QW-6): with the narrator off every line a flight tells by itself either
// has a sound or is not said, and the first frames after the switch on are quiet too.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SCAN_FREE_ID } from '../../../packages/sonic-fpv/src';
import * as entryMod from '../../../apps/fly/src/sonic/entry';

const ROOT = join(__dirname, '..', '..', '..');
const text = (p: string): string => readFileSync(join(ROOT, p), 'utf8');
const PREFS_OFF = { narrator: false } as Parameters<typeof entryMod.quietFlight>[0];

describe('QW-5: the free flight the entry opens is quiet before the host sets its lesson', () => {
    const of = (entryMod as { flightLessonOf?: typeof entryMod.flightLessonOf }).flightLessonOf;
    it('in place: quiet from the switch on, then the host answers', () => {
        expect(typeof of).toBe('function');
        const lesson = of!({ lessonId: SCAN_FREE_ID, here: true });
        expect(entryMod.quietFlight(PREFS_OFF, lesson(null), false)).toBe(true);
        expect(lesson(SCAN_FREE_ID)).toBe(SCAN_FREE_ID);
        // the host had a lesson and left it: its own answer (none) stands
        expect(lesson(null)).toBe(null);
    });
    it('the scan link free flight counts too; a lesson of the list does not', () => {
        expect(of!({ lessonId: SCAN_FREE_ID, free: {} })(null)).toBe(SCAN_FREE_ID);
        expect(of!({ lessonId: 'hover-1' })(null)).toBe(null);
        expect(of!({ lessonId: SCAN_FREE_ID, free: null })(null)).toBe(null);
    });
});

describe('QW-1, QW-2, QW-6: the course and walls lines pass their own sound', () => {
    const course = text('apps/fly/src/app/builtin/course.ts');
    const walls = text('apps/fly/src/walls.ts');
    const builtinWalls = text('apps/fly/src/app/builtin/walls.ts');
    it('a lap plays the lap notes, the course end the finish notes (the lead M3)', () => {
        expect(course).toContain("sayLine(line, ev === 'done' ? { kind: 'fanfare' } : { kind: 'lap' })");
    });
    it('Shift+G with no course plays the falling sound, a press while busy the wait sound', () => {
        expect(course).toContain("sayLine(text, { kind: 'wrong-side' })");
        expect(course).toContain("sayLine(hook.progress, { kind: 'answer', what: 'wait' })");
    });
    it('a failed walls build and the picture-may-stop warning reach the speaker with their kind', () => {
        expect(walls).toContain("o.speak?.(line, ok ? undefined : 'failed')");
        expect(walls).toContain("o.speak?.(n, 'wait')");
        expect(builtinWalls).toContain("kind === 'failed' ? { kind: 'wrong-side' as const }");
        expect(builtinWalls).toContain("kind === 'wait' ? { kind: 'answer' as const, what: 'wait' as const }");
    });
});

describe('QW-3: the scan loading line is not said with the narrator off', () => {
    it('start.ts guards it with the narrator setting', () => {
        expect(text('apps/fly/src/sonic/start.ts')).toMatch(/forceScanPrefs\(d\.prefs, lesson\.world\) && setup\.prefs\.narrator !== false\) void setup\.audio\.engine\.say\(\{ key: 'sonic\.say\.scanLoading' \}/);
    });
});
