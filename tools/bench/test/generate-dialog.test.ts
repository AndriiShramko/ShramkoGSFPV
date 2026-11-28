// Lane gen4b B1 (gen4 design G7-G9): the 'Generate a course' dialog's model and its press routing. NEG (design S B1): on the
// old tree a press with a saved course shown generated at once (course.ts called generate() from Shift+G, the menu and the
// editor's G); here every eyes'-mode press opens the dialog, which names the course it replaces and builds only on a yes.
import { describe, expect, it, vi } from 'vitest';
// apps/fly/src/i18n.ts reads the page's path when it loads (ui/dom.ts imports it): an English page
vi.hoisted(() => {
    const g = globalThis as Record<string, unknown>;
    g.location = { pathname: '/en/', search: '', href: 'http://localhost/en/' };
    g.document ??= { cookie: '', documentElement: { lang: '' } };
});
import { LEVELS, VOXEL_VIEW_GATES } from '@gsfpv/tracks';
import { DEFAULT_WHERE, dialogKey, dialogModel, levelLine, pressAction, turnDeg, type DialogState } from '../../../apps/fly/src/course/generate-dialog';
import { fakeDocument } from './helpers/fake-dom';
import en from '../../../packages/i18n/locales/fly/course/en.json';
import es from '../../../packages/i18n/locales/fly/course/es.json';
import pl from '../../../packages/i18n/locales/fly/course/pl.json';
import ru from '../../../packages/i18n/locales/fly/course/ru.json';

const DICT = en as Record<string, string>;
const t = (key: string, vars?: Record<string, string | number>): string => {
    let s = DICT[key] ?? `?${key}`;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
    return s;
};
const base: DialogState = { level: 'medium', where: 'here', voxelsOnly: false, shownGates: 0, unsaved: false };

describe('gen4b B1: the Generate dialog', () => {
    it('a press with a saved course shown asks first: the dialog, not a course', () => {
        expect(pressAction({ busy: false, sonic: false })).toBe('dialog');
        const m = dialogModel({ ...base, shownGates: 9 }, t);
        expect(m.replaces).toBe('Replaces the current course (9 gates)');
        expect(m.main).toBe('Replace with a new course');
        expect(m.lost).toBeNull();
    });

    it('a press while a course is built answers with the progress; Fly by Sound builds at once (no visual dialog)', () => {
        expect(pressAction({ busy: true, sonic: false })).toBe('wait');
        expect(pressAction({ busy: true, sonic: true })).toBe('wait');
        expect(pressAction({ busy: false, sonic: true })).toBe('direct');
    });

    it('no course shown: Build the course, no replace line; unsaved editor changes are named', () => {
        const m = dialogModel(base, t);
        expect(m.replaces).toBeNull();
        expect(m.main).toBe('Build the course');
        expect(dialogModel({ ...base, shownGates: 4, unsaved: true }, t).lost).toBe('Your unsaved changes are lost');
    });

    it('three levels, one pressed, its numbers from LEVELS; every text is a real key', () => {
        for (const level of ['beginner', 'medium', 'pro'] as const) {
            const m = dialogModel({ ...base, level }, t);
            expect(m.levels.map((b) => b.id)).toEqual(['beginner', 'medium', 'pro']);
            expect(m.levels.filter((b) => b.pressed).map((b) => b.id)).toEqual([level]);
            const r = LEVELS[level];
            expect(m.levelLine).toBe(levelLine(level, t));
            expect(m.levelLine).toContain(`${r.gatesMin} to ${r.gatesMax} gates`);
            expect(m.request).toEqual({ level, spread: 'compact', anyQuality: false });
            const all = [m.title, m.levelLine, m.whereLine, m.hint, m.main, m.cancel, ...m.levels.map((b) => b.label), ...m.wheres.map((b) => b.label)];
            for (const s of all) expect(s.startsWith('?')).toBe(false);
        }
        expect([turnDeg(LEVELS.beginner.turnCosMin), turnDeg(LEVELS.medium.turnCosMin), turnDeg(LEVELS.pro.turnCosMin)]).toEqual([60, 105, 150]);
    });

    it('the where: Here or Whole scan; the voxels-only view sets the whole scene at any quality and says so', () => {
        expect(dialogModel({ ...base, where: 'scan' }, t).request).toEqual({ level: 'medium', spread: 'wide', anyQuality: false });
        const v = dialogModel({ ...base, voxelsOnly: true }, t);
        expect(v.wheres).toEqual([]);
        expect(v.request).toEqual({ level: 'medium', spread: 'wide', anyQuality: true });
        expect(v.whereLine).toContain(String(VOXEL_VIEW_GATES));
    });

    // lane w1-dialog (R2 of designs/w1-diag.md, the owner's brief line 667 b and d). NEG: the old dialog offered Compact and
    // Whole scene of 'the best scanned part' and never said where the course is laid.
    it('w1-dialog: WHERE is Here (the default, a compact course round the drone) or Whole scan (from the drone over the scan)', () => {
        expect(DEFAULT_WHERE).toBe('here');
        const m = dialogModel({ ...base, where: DEFAULT_WHERE }, t);
        expect(m.wheres.map((b) => [b.id, b.label, b.pressed])).toEqual([['here', 'Here', true], ['scan', 'Whole scan', false]]);
        expect(m.request).toEqual({ level: 'medium', spread: 'compact', anyQuality: false });
        expect(m.whereLine).toBe('Gates close together round the drone, start and finish side by side');
        const w = dialogModel({ ...base, where: 'scan' }, t);
        expect(w.whereLine).toBe('Starts at the drone and spreads over the whole well scanned part of the scan');
        // idea d without a question that stops the pilot: one line says how to have the course elsewhere
        for (const x of [m, w, dialogModel({ ...base, voxelsOnly: true }, t)]) {
            expect(x.hint).toBe('The course is laid where the drone is. For another place, fly there, press key Esc, then key Shift+G');
        }
    });

    it('w1-dialog: every where text has the same keys in en, es, pl and ru', () => {
        const keys = ['course.gen.whereTitle', 'course.gen.where.here', 'course.gen.where.scan', 'course.gen.whereLine.here', 'course.gen.whereLine.scan', 'course.gen.whereVoxels', 'course.gen.whereHint'];
        for (const d of [en, es, pl, ru] as Record<string, string>[]) {
            for (const k of keys) expect(typeof d[k] === 'string' && d[k]!.length > 0 ? k : `missing ${k}`).toBe(k);
            expect(Object.keys(d).some((k) => k.startsWith('course.gen.spread'))).toBe(false);
            expect(d['course.gen.whereVoxels']).toContain('{n}');
            expect(d['course.gen.whereHint']).toContain('Shift+G');
        }
    });

    it('Enter builds and Esc cancels by e.code (every keyboard layout)', () => {
        expect(dialogKey('Enter')).toBe('build');
        expect(dialogKey('NumpadEnter')).toBe('build');
        expect(dialogKey('Escape')).toBe('cancel');
        expect(dialogKey('KeyG')).toBeNull();
    });

    it('the DOM: a .panel with its 44 px cross, Cancel builds nothing, the main button builds the picked request', async () => {
        const doc = fakeDocument();
        const g = globalThis as Record<string, unknown>;
        const keep = { document: g.document, addEventListener: g.addEventListener, removeEventListener: g.removeEventListener };
        const keys: ((e: unknown) => void)[] = [];
        g.document = doc;
        g.addEventListener = (_k: string, f: (e: unknown) => void) => keys.push(f);
        g.removeEventListener = (_k: string, f: (e: unknown) => void) => keys.splice(keys.indexOf(f), 1);
        try {
            const { GenerateDialog } = await import('../../../apps/fly/src/course/generate-dialog');
            const parent = doc.createElement('div') as unknown as HTMLElement;
            const built: unknown[] = [];
            let cancelled = 0;
            const picks: unknown[] = [];
            const d = new GenerateDialog(parent, t, { pick: (p) => picks.push(p), build: (r) => built.push(r), cancel: () => cancelled++ });
            d.open({ ...base, shownGates: 7 });
            const q = (sel: string): { click: () => void } | null => (parent as unknown as { querySelector: (s: string) => { click: () => void } | null }).querySelector(sel);
            expect(q('div.panel.gen-dialog')).not.toBeNull();
            expect(q('button.panel-x')).not.toBeNull();
            q('[data-action=gen-cancel]')!.click();
            expect([built.length, cancelled, d.isOpen]).toEqual([0, 1, false]);
            d.open({ ...base, shownGates: 7 });
            q('[data-action=gen-level-beginner]')!.click();
            expect(q('[data-testid=gen-where-hint]')).not.toBeNull();
            q('[data-action=gen-where-scan]')!.click();
            expect(picks).toEqual([{ level: 'beginner' }, { where: 'scan' }]);
            expect(d.model()!.levels.find((b) => b.pressed)!.id).toBe('beginner');
            const ev = { code: 'Enter', repeat: false, preventDefault: () => undefined, stopImmediatePropagation: () => undefined };
            for (const f of [...keys]) f(ev);
            expect(built).toEqual([{ level: 'beginner', spread: 'wide', anyQuality: false }]);
            expect([d.isOpen, keys.length]).toEqual([false, 0]);
            // review gen4b (probe step 11): Tab to Cancel, then Enter, presses Cancel (the browser's own press), never the build
            d.open({ ...base, shownGates: 7 });
            let prevented = 0;
            const at = (sel: string) => ({ code: 'Enter', repeat: false, target: q(sel), preventDefault: () => void prevented++, stopImmediatePropagation: () => undefined });
            for (const sel of ['[data-action=gen-cancel]', 'button.panel-x', '[data-action=gen-level-pro]']) for (const f of [...keys]) f(at(sel));
            expect([built.length, prevented, d.isOpen]).toEqual([1, 0, true]);
            for (const f of [...keys]) f(at('[data-action=gen-build]'));
            expect([built.length, d.isOpen]).toEqual([2, false]);
        } finally {
            Object.assign(g, keep);
        }
    });
});
