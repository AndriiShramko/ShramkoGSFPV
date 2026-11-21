// Lane n-save S3 (t7-plan Decision 1 and 6; the owner's wish 1: "save it as it is, with the errors, or fix it all in one
// click"): Save with warnings opens one dialog (the count, one line per kind, Fix all automatically / Save as it is /
// Show me by their data-testid, in that order); after Fix all the line says how many gates moved and offers Undo; the
// old places are ghosts; a blocker is one plain line with its way out; the editor's message line is 16 px, wraps to
// three lines and is never cut with '...'. Fake DOM (helpers/fake-dom), no browser.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { TrackFile } from '@shramko/sonic-fpv';
import { courseWarnings, saveVerdict, upgradeTrack, wallsCheck, yawQuatStep, type Course, type FixWalls, type GateMove } from '@gsfpv/tracks';
import { IDENTITY, threeRooms } from '../../../packages/tracks/test/worlds';
import { fakeDocument, FakeElement } from './helpers/fake-dom';
import en from '../../../packages/i18n/locales/fly/course-save/en.json';
import es from '../../../packages/i18n/locales/fly/course-save/es.json';
import pl from '../../../packages/i18n/locales/fly/course-save/pl.json';
import ru from '../../../packages/i18n/locales/fly/course-save/ru.json';

const root = join(__dirname, '../../..');
type Words = typeof import('../../../apps/fly/src/course/editor/save-words');
type Panel = typeof import('../../../apps/fly/src/course/editor/panel');
type Flash = typeof import('../../../apps/fly/src/course/editor/flash');
let W: Words;
let P: Panel;
let F: Flash;

beforeAll(async () => {
    vi.stubGlobal('location', { search: '', pathname: '/en/fly/', href: 'http://127.0.0.1/en/fly/', origin: 'http://127.0.0.1' });
    vi.stubGlobal('document', fakeDocument());
    vi.stubGlobal('navigator', { languages: ['en'], language: 'en' });
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
    vi.stubGlobal('requestAnimationFrame', () => 0);
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    W = await import('../../../apps/fly/src/course/editor/save-words');
    P = await import('../../../apps/fly/src/course/editor/panel');
    F = await import('../../../apps/fly/src/course/editor/flash');
});

type V3 = [number, number, number];
const ring = (id: string, pos: V3) => ({ id, shape: { kind: 'ring', diameter: 1.2, tube: 0.08 }, pos, quat: yawQuatStep(4), direction: 'forward' });
const course = (gates: ReturnType<typeof ring>[]): Course =>
    upgradeTrack({
        format: 'shramko-sonic-track/1', id: '0000aaaa-00000001', version: 1, parent: null, title: 'Save me',
        scene: { kind: 'scan', id: '0000aaaa', version: 1 }, transform: [1, 0, 0, 0], gates, laps: 1,
        start: { pos: [1.5, 2.5, 5], yawDeg: 90 }, author: { kind: 'person', name: 'pilot' }, generator: null, created: '2026-11-20T00:00:00Z'
    } as unknown as TrackFile);
const walls = threeRooms();
const w: FixWalls = { col: walls, transform: IDENTITY, margin: 0.5 };
/** gate 2 in a wall, gates 3 and 4 on one spot: the acceptance's course */
const bad = (): Course => course([ring('g1', [3, 2.5, 5]), ring('g2', [5.5, 2.5, 10.2]), ring('g3', [8, 2.5, 5]), ring('g4', [8.05, 2.5, 5])]);
/** the page's verdict (course.ts verdictNow): the editor's problems and every gate's warnings */
const verdictOf = (c: Course) => {
    const extra = courseWarnings(c, w).flatMap((x) => (x.kind === 'leg-blocked' || x.kind === 'blocked-start' ? [] : x.gates.map((gate) => ({ code: x.kind, gate }))));
    return saveVerdict(c, wallsCheck(walls, IDENTITY, 0.5)(c), extra);
};
const byId = (rootEl: FakeElement, id: string): FakeElement => {
    const e = rootEl.querySelector(`[data-testid="${id}"]`);
    if (!e) throw new Error(`no ${id}`);
    return e;
};
const host = () => ({ key: () => undefined, saveMine: () => undefined, saveAll: () => undefined, saveAdmin: () => undefined, vote: () => undefined, open: () => undefined });

describe('n-save S3: the Save dialog and its words', () => {
    it('a gate in a wall and two gates on one spot: no blocker, the dialog counts the warnings with one line per kind and the gates from 1', () => {
        const c = bad();
        const v = verdictOf(c);
        expect(v.blockers).toEqual([]);
        const d = W.saveAskWords(v.warnings, c.gates.map((g) => g.id));
        expect(d.title).toEqual({ key: 'course.edit.saveWarn.title', args: { n: v.warnings.length } });
        const kinds = d.lines.map((l) => l.kind);
        expect(new Set(kinds).size).toBe(kinds.length);
        expect(d.lines.find((l) => l.kind === 'in-scan')?.args.gates).toBe('2');
        expect(d.lines.find((l) => l.kind === 'same-place')?.args.gates).toBe('3, 4');
        expect(kinds.indexOf('in-scan')).toBeLessThan(kinds.indexOf('same-place'));
    });

    it('the panel shows the dialog with the three buttons in order, each answers once and closes it; the cross saves nothing', () => {
        const ui = new FakeElement('div');
        const panel = new P.EditorPanel(ui as unknown as HTMLElement, host());
        const r = panel.root as unknown as FakeElement;
        const dialog = byId(r, 'save-warnings');
        expect(dialog.hidden).toBe(true);
        const answers: string[] = [];
        for (const [id, a] of [['save-fix-all', 'fix'], ['save-as-is', 'as-is'], ['save-show-me', 'show'], ['save-warnings-close', 'close']] as const) {
            panel.askSave({ title: 'Warnings: 3.', lines: ['Inside a wall of the scan (gates: 2)', 'Two gates on one spot (gates: 3, 4)'] }, (x) => answers.push(x));
            expect(dialog.hidden).toBe(false);
            expect(dialog.querySelectorAll('li').map((li) => li.textContent)).toEqual(['Inside a wall of the scan (gates: 2)', 'Two gates on one spot (gates: 3, 4)']);
            byId(r, id).click();
            expect(dialog.hidden).toBe(true);
            byId(r, id).click();
            expect(answers.at(-1)).toBe(a);
        }
        expect(answers).toEqual(['fix', 'as-is', 'show', 'close']);
        const row = dialog.querySelector('.ce-fix-buttons')!;
        expect(row.children.map((b) => (b as FakeElement).getAttribute('data-testid'))).toEqual(['save-fix-all', 'save-as-is', 'save-show-me']);
        expect(byId(r, 'save-fix-all').classList.contains('ce-fix-yes')).toBe(true);
        expect(byId(r, 'save-fix-all').textContent).toBe(en['course.edit.saveWarn.fixAll']);
        expect(byId(r, 'save-warnings-close').getAttribute('aria-label')).toBe(en['course.edit.saveWarn.close']);
    });

    it('the line after Fix all names the moved gates and its Undo runs once; with nothing moved there is no Undo', () => {
        const ui = new FakeElement('div');
        const panel = new P.EditorPanel(ui as unknown as HTMLElement, host());
        const r = panel.root as unknown as FakeElement;
        const c = bad();
        const moves = [{ index: 1, id: 'g2' }, { index: 3, id: 'g4' }] as unknown as GateMove[];
        const words = W.fixedWords(moves, [{ kind: 'blocked-start', gates: [] }], c.gates.map((g) => g.id));
        expect(words.moved).toEqual({ key: 'course.fix.moved', args: { n: 2, gates: '2, 4' } });
        expect(words.left.map((l) => l.key)).toEqual(['course.edit.saveWarn.kind.blockedStart']);
        let undone = 0;
        panel.fixedLine('Gates moved to free places: 2 (gates 2, 4).', () => undone++);
        const line = byId(r, 'save-fixed');
        expect(line.hidden).toBe(false);
        expect(byId(r, 'save-undo').hidden).toBe(false);
        byId(r, 'save-undo').click();
        byId(r, 'save-undo').click();
        expect(undone).toBe(1);
        expect(line.hidden).toBe(true);
        expect(W.fixedWords([], [], []).moved.key).toBe('course.fix.none');
        panel.fixedLine('No gate could be moved to a better place.', null);
        expect(byId(r, 'save-undo').hidden).toBe(true);
        // a new Save dialog takes the old line away
        panel.fixedLine('x', () => undefined);
        panel.askSave({ title: 't', lines: [] }, () => undefined);
        expect(line.hidden).toBe(true);
    });

    it('every blocker is one plain line with its way out (the gate pointed at, the field outlined); no button', () => {
        const order = ['g1', 'g2', 'g3'];
        expect(W.blockerWords({ kind: 'leg-too-long', gate: 'g3', limit: 80 }, order)).toMatchObject({ key: 'course.edit.saveBlock.legTooLong', args: { a: 3, b: 1, limit: 80 }, gate: 3 });
        expect(W.blockerWords({ kind: 'too-far', gate: 'start', limit: 1000 }, order)).toMatchObject({ key: 'course.edit.saveBlock.tooFarStart', gate: null });
        expect(W.blockerWords({ kind: 'name-refused', field: 'title' } as never, order)).toMatchObject({ key: 'course.save.problem.title', field: 'title' });
        expect(W.blockerWords({ kind: 'too-many-gates', limit: 2 }, order).args).toEqual({ limit: 2, extra: 1 });
        for (const k of ['legTooLong', 'tooFar', 'tooFarStart', 'gateTooBig', 'tooManyGates', 'noGates']) expect(en[`course.edit.saveBlock.${k}` as keyof typeof en]).toMatch(/then press Save|press Add gate/);
    });

    it('the words are in en, es, pl, ru', () => {
        for (const loc of [en, es, pl, ru] as Record<string, string>[]) for (const k of W.SAVE_VERDICT_KEYS) expect(loc[k], k).toBeTruthy();
    });

    it('ghosts: a ring of the opening where the gate stood and a line to where it is now; an old place behind the eye has none', () => {
        // a camera at the origin looking down -z, 500 px per metre at 1 m
        const project = (p: readonly [number, number, number]): [number, number, number] | null => (p[2] >= -0.1 ? null : [500 + (500 * p[0]) / -p[2], 300 - (500 * p[1]) / -p[2], -p[2]]);
        const spots = F.ghostSpots([{ was: [0, 0, -5], now: [1, 0, -5], opening: 1.2 }, { was: [0, 0, 3], now: [0, 0, -3], opening: 1 }], project);
        expect(spots).toHaveLength(1);
        expect(spots[0]!.x).toBe(500);
        expect(spots[0]!.r).toBeCloseTo(60, 6);
        expect(spots[0]!.to).toEqual([600, 300]);
        let now = 0;
        const parent = new FakeElement('div');
        const g = new F.GateGhosts(parent as unknown as HTMLElement, project, () => now);
        g.show([{ was: [0, 0, -5], now: [1, 0, -5], opening: 1.2 }]);
        expect(g.count()).toBe(2);
        now = F.GHOST_MS + 1;
        g.show([]);
        expect(g.count()).toBe(0);
    });
});

describe('n-save S3: the editor message line (Decision 6: 12.75 px and cut with "...")', () => {
    const css = readFileSync(join(root, 'apps/fly/src/course/editor/editor.css'), 'utf8');
    const rule = (/\.ce-topbar \.ce-tb-line \{([^}]*)\}/.exec(css)?.[1] ?? '').replace(/\/\*[\s\S]*?\*\//g, '');
    const prop = (name: string): string | null => new RegExp(`(^|[\\s;])${name}:\\s*([^;]+);`).exec(rule)?.[2]?.trim() ?? null;

    it('is at least 16 px, wraps, holds at most three lines and is never cut with an ellipsis', () => {
        const size = prop('font-size')!;
        const px = size.endsWith('rem') ? parseFloat(size) * 16 : parseFloat(size);
        expect(px).toBeGreaterThanOrEqual(16);
        expect(prop('white-space')).toBe('normal');
        expect(prop('text-overflow')).toBeNull();
        expect(prop('overflow')).not.toBe('hidden');
        const lh = parseFloat(prop('line-height')!);
        const maxEm = parseFloat(prop('max-height')!);
        expect(Math.round(maxEm / lh)).toBe(3);
    });
});

describe('n-save S3: the page goes through the verdict', () => {
    const page = readFileSync(join(root, 'apps/fly/src/app/builtin/course.ts'), 'utf8');
    it('saveMine and saveAdmin stop only on a blocker; warnings open the dialog once; Fix all is one undo step, then the save', () => {
        expect(page).not.toMatch(/canSave\(ed\)/);
        expect(page).toMatch(/if \(v\.blockers\.length > 0\) return blockedSave\(v\.blockers\[0\]!\);\n\s*if \(v\.warnings\.length > 0 && !asIs\) return askSave\(v, \(\) => void saveMine\(nameIn, titleIn, true\)\);/);
        expect(page).toMatch(/return askSave\(v, \(\) => void saveAdmin\(titleIn, true\)\)/);
        expect(page).toMatch(/applyEdit\(\{ kind: 'replace', gates: r\.course\.gates, selected: r\.moves\[0\]!\.index \}, 'fix'\)/);
        expect(page).toMatch(/applyEdit\(\{ kind: 'undo' \}, 'fix'\)/);
        expect(page).toMatch(/if \(a === 'show'\) return showMe\(v\)/);
    });
});
