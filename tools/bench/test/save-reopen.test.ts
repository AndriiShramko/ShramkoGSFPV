// Lane n-save S4: a course saved as it is (with warnings) opens again. The page proves every course it loads on the pilot's
// walls; a course that does not pass was never shown, so a row's Open on a course saved with a gate in a wall did nothing
// (found by tools/bench/scripts/n-save-accept.mjs, step asIs.reload). A course the pilot named (a row's Open, a link) is now
// shown with its warnings and a line that says Save fixes them; the newest course tried for the flight still skips to the next.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..', '..', '..');
const src = readFileSync(resolve(ROOT, 'apps/fly/src/app/builtin/course.ts'), 'utf8');
const LANGS = ['en', 'es', 'pl', 'ru'] as const;

/** the part of the worker's answer that handles a proven stored course */
function checkedPart(): string {
    const a = src.indexOf("if (m.t === 'checked')");
    const b = src.indexOf('if (!m.track)', a);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    return src.slice(a, b);
}

describe('a course saved with warnings opens again', () => {
    it('a named course that fails the walls proof is shown, with the line about its warnings', () => {
        const part = checkedPart();
        const named = part.indexOf('!m.ok && why.only');
        expect(named).toBeGreaterThan(0);
        const branch = part.slice(named, part.indexOf('return;', named));
        expect(branch).toMatch(/setTrack\(tr, 'server'/);
        expect(branch).toMatch(/course\.edit\.saveOpenedWarned/);
        expect(branch).not.toMatch(/fail\(/);
        // it stands before the refusal, which is left for the courses tried on their own
        expect(named).toBeLessThan(part.lastIndexOf("t('course.server.refused')"));
    });

    it('the line exists in en, es, pl, ru, names the gates and the way on (Save)', () => {
        for (const lang of LANGS) {
            const j = JSON.parse(readFileSync(resolve(ROOT, `packages/i18n/locales/fly/course-save/${lang}.json`), 'utf8')) as Record<string, string>;
            const bar = JSON.parse(readFileSync(resolve(ROOT, `packages/i18n/locales/fly/${lang}.json`), 'utf8')) as Record<string, string>;
            const line = j['course.edit.saveOpenedWarned'];
            expect(line, lang).toBeTypeOf('string');
            expect(line).toContain('{n}');
            const save = bar['course.edit.bar.save'] ?? findKey(lang, 'course.edit.bar.save');
            expect(line!.includes(save!), `${lang}: names ${save}`).toBe(true);
        }
    });
});

function findKey(lang: string, key: string): string | undefined {
    const dirs = ['course', 'course-save', 'course-view', 'course-pieces', 'course-life'];
    for (const d of dirs) {
        try {
            const j = JSON.parse(readFileSync(resolve(ROOT, `packages/i18n/locales/fly/${d}/${lang}.json`), 'utf8')) as Record<string, string>;
            if (j[key]) return j[key];
        } catch {
            /* a folder without this language */
        }
    }
    return undefined;
}
