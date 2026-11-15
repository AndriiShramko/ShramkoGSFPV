// Lane editor3, stage fixes pass 2 (docs/wip/editor3.md, review ED-5, ED-6, ED-7): a save checks the course itself when the
// worker gave no ok answer for it; a step back and a click are not announced as "next gate"; the top bar has Save, Courses
// and Keys, and the Keys table names the edit camera's keys.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { actionKey, editorLocaleKeys } from '../../../apps/fly/src/course/editor/texts';
import { TOP_BUTTONS } from '../../../apps/fly/src/course/editor/bar-place';
import { CAM_ROWS } from '../../../apps/fly/src/course/editor/keys';
import * as checkCore from '../../../apps/fly/src/course/editor/check-core';

const ROOT = join(__dirname, '../../..');
const COURSE_TS = readFileSync(join(ROOT, 'apps/fly/src/app/builtin/course.ts'), 'utf8');
const PANEL_TS = readFileSync(join(ROOT, 'apps/fly/src/course/editor/panel.ts'), 'utf8');
const TOP_TS = readFileSync(join(ROOT, 'apps/fly/src/course/editor/top-bar.ts'), 'utf8');
const locale = (lang: string): Record<string, string> =>
    JSON.parse(readFileSync(join(ROOT, `packages/i18n/locales/fly/course/${lang}.json`), 'utf8')) as Record<string, string>;

describe('editor3 fixes ED-6: the word matches the action', () => {
    it('a step back is "previous gate", a click is "selected", a step on is "next gate"', () => {
        expect(actionKey({ kind: 'select-step', step: -1 })).toBe('course.edit.key.prev');
        expect(actionKey({ kind: 'select-step', step: 1 })).toBe('course.edit.key.next');
        expect(actionKey({ kind: 'select', index: 3 })).toBe('course.edit.selected');
        expect(actionKey({ kind: 'undo' })).toBe('course.edit.key.undo');
    });
    it('course.ts announces by actionKey, both for a key and for a click', () => {
        expect(COURSE_TS).toMatch(/t\(actionKey\(k\.edit\)\)/);
        expect(COURSE_TS).toMatch(/t\(actionKey\(\{ kind: 'select', index: i \}\)\)/);
    });
});

describe('editor3 fixes ED-7: the top bar and the Keys table', () => {
    it('the top bar has Add, Undo, Redo, Save, Courses, Keys and Exit; Save runs Ctrl+S', () => {
        expect(TOP_BUTTONS.map((b) => b.id)).toEqual(['add', 'undo', 'redo', 'save', 'courses', 'keys', 'exit']);
        expect(TOP_BUTTONS.find((b) => b.id === 'save')!.press).toEqual({ code: 'KeyS', ctrlKey: true });
        expect(TOP_TS).toMatch(/host\.show\(press\)/);
        expect(COURSE_TS).toMatch(/show: \(part\) => panel\?\.reveal\(part\)/);
        expect(PANEL_TS).toMatch(/reveal\(part: 'save' \| 'keys' \| 'courses'\)/);
    });
    it('the Keys table has the camera keys, Space to arm and the mouse', () => {
        const caps = CAM_ROWS.map((r) => r.caps);
        expect(caps).toEqual(expect.arrayContaining(['W A S D', 'E / Q', 'Shift', 'Space']));
        expect(CAM_ROWS.map((r) => r.labelKey)).toEqual(expect.arrayContaining(['course.edit.cam.look', 'course.edit.cam.wheel', 'course.edit.cam.click']));
        expect(PANEL_TS).toMatch(/for \(const r of CAM_ROWS\)/);
    });
    it('every new text is in en, es, pl and ru and is not the English one in the others', () => {
        const keys = editorLocaleKeys();
        const fresh = ['course.edit.selected', ...TOP_BUTTONS.map((b) => b.labelKey), ...CAM_ROWS.map((r) => r.labelKey)];
        for (const k of fresh) expect(keys).toContain(k);
        const en = locale('en');
        for (const lang of ['en', 'es', 'pl', 'ru']) {
            const d = locale(lang);
            for (const k of fresh) {
                expect(typeof d[k], `${lang} ${k}`).toBe('string');
                if (lang !== 'en' && k.startsWith('course.edit.cam.')) expect(d[k], `${lang} ${k}`).not.toBe(en[k]);
            }
        }
    });
});

describe('editor3 fixes ED-5: no save without a check of the course as it stands', () => {
    it('check-core has the page-thread check', () => {
        expect(typeof (checkCore as Record<string, unknown>).checkOnPage).toBe('function');
    });
    it('course.ts remembers the course of the last ok answer and checks again before the save when it is not the course now', () => {
        expect(COURSE_TS).toMatch(/okCourse = q\.pending \? null : ed\.course/);
        expect(COURSE_TS).toMatch(/if \(ed && ed\.course !== okCourse && col\)/);
        expect(COURSE_TS).toMatch(/checkOnPage\(col, flownTransform\(\), edMargin, ed\.course\)/);
        // the save paths wait for it
        expect((COURSE_TS.match(/await checked\(\);/g) ?? []).length).toBeGreaterThanOrEqual(2);
    });
});
