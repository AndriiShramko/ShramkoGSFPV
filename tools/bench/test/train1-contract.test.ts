// Train 1 (docs/wip/train1-plan.md, "Contracts between lanes"): what the train base gives every lane before it starts, so
// that two lanes never edit the same line of a shared file: the reserved keys (planned, so not routed yet), one settings
// file and one feature file per lane, the labels of the reserved keys in the four languages.
// The negative control of this file is the base itself: on origin/main (before the contract) the first test fails.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FLYING_CODES, KEYMAP, keymapProblems } from '../../../packages/prefs/src/keymap';
import type { KeyBinding } from '../../../packages/prefs/src/keymap';

const ROOT = join(__dirname, '..', '..', '..');
const LANGS = ['en', 'es', 'pl', 'ru'];
const RESERVED: Readonly<Record<string, string>> = {
    'course.toggle': 'Shift+T',
    'course.generate': 'Shift+G',
    // lane rooms-public moved the rooms keys to 9 and 0 (Shift+L / Shift+O stay share and settings for a pilot descending with Shift)
    'rooms.panel': '9',
    'rooms.who': '0'
};
const text = (p: string) => readFileSync(join(ROOT, p), 'utf8');

describe('train 1: the keys reserved for the lanes', () => {
    it('each lane has its chords in the table, planned or shipped, one chord each', () => {
        for (const [action, cap] of Object.entries(RESERVED)) {
            const b = KEYMAP.filter((x) => x.action === action);
            expect(b, action).toHaveLength(1);
            expect(b[0].keys.map((k) => k.cap), action).toEqual([cap]);
            expect(!!b[0].keys[0].shift, action).toBe(cap.startsWith('Shift+'));
            expect(b[0].labelKey, action).toBe(`keys.${action}`);
        }
    });

    it('the table with them has no clash, and none of them sits on a flying key', () => {
        expect(keymapProblems(KEYMAP)).toEqual([]);
        for (const action of Object.keys(RESERVED)) {
            const code = KEYMAP.find((x) => x.action === action)!.keys[0].code;
            expect(FLYING_CODES, action).not.toContain(code);
        }
    });

    it('control: the same chord given to both lanes is reported', () => {
        const clash: KeyBinding[] = KEYMAP.map((b) => (b.action === 'rooms.who' ? { ...b, keys: KEYMAP.find((x) => x.action === 'course.toggle')!.keys } : b));
        expect(keymapProblems(clash).length).toBeGreaterThan(0);
    });
});

describe('train 1: one file per lane in the shared lists', () => {
    it('the key labels are in the lane\'s own namespace, in four languages', () => {
        for (const ns of ['course', 'rooms']) for (const lang of LANGS) {
            const dict = JSON.parse(text(`packages/i18n/locales/fly/${ns}/${lang}.json`)) as Record<string, string>;
            for (const action of Object.keys(RESERVED).filter((a) => a.startsWith(`${ns}.`))) expect(dict[`keys.${action}`], `${ns}/${lang} ${action}`).toBeTruthy();
        }
    });

    it('the settings list and the feature list name both lanes\' files', () => {
        const defs = text('packages/prefs/src/defs/index.ts');
        const features = text('apps/fly/src/app/features.ts');
        for (const [ns, DEFS] of [['course', 'COURSE_DEFS'], ['rooms', 'ROOMS_DEFS']]) {
            expect(defs).toContain(`...${DEFS}`);
            expect(existsSync(join(ROOT, `packages/prefs/src/defs/${ns}.ts`))).toBe(true);
            // the integration loads the courses' feature as its own chunk through a stub (builtin/course-lazy.ts, sonic-int-lazy.test.ts)
            expect(features).toMatch(new RegExp(`import \\{ ${ns} \\} from './builtin/${ns}(?:-lazy)?';`));
            expect(features).toMatch(new RegExp(`\\n    ${ns},?\\r?\\n`));
            expect(existsSync(join(ROOT, `apps/fly/src/${ns}/hook.ts`))).toBe(true);
        }
        const hook = text('apps/fly/src/app/test-hook.ts');
        expect(hook).toContain('course?: CourseHook;');
        expect(hook).toContain('rooms?: RoomsHook;');
    });
});
