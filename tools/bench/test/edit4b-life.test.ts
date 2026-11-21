// Lane edit4b, stage B1 (docs/wip/edit4b.md; design C:/dev/.gsfpv-lanes/designs/edit4.md section 3): the course's life in
// the editor. The owner (brief 541, 553, 555): "I want to delete everything and start again, or make my own course from the
// start"; "I cannot see how to fly it at once while editing"; "what if I press Generate by chance and it deletes all I did".
// Each test fails on e3201fec: MIN_GATES 1 refuses the clear, there is no 'replace', no fly button, no part, KeyG regenerates.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { edit, openEditor, upgradeTrack, type Course, type EditorState } from '@gsfpv/tracks';
import type { TrackFile } from '@shramko/sonic-fpv';

const ROOT = join(__dirname, '../../..');
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');
const off = (): never[] => [];

const gate = (i: number) => ({ id: `g${i}`, shape: { kind: 'square' as const, side: 1.5, bar: 0.1 }, pos: [i * 4, 1, 0] as [number, number, number], quat: [1, 0, 0, 0] as [number, number, number, number], direction: 'forward' as const });
const track = (n: number): TrackFile => ({
    format: 'shramko-track/1', id: 't-1', version: 1, parent: null, title: 'generated', scene: { kind: 'scan', id: 's1', version: 1 },
    transform: [1, 0, 0, 0], gates: Array.from({ length: n }, (_, i) => gate(i + 1)), laps: 2, start: { pos: [0, 1, 0], quat: [1, 0, 0, 0] },
    author: { kind: 'generator', name: 'gen' }, generator: { name: 'gen', version: '1', seed: 7, params: {} }, created: '2026-11-19T00:00:00Z'
} as unknown as TrackFile);

describe('edit4b B1: Delete all gates is one undo step, and an empty course edits', () => {
    it('replace with no gate empties the course; Ctrl+Z brings every gate back', () => {
        const st = openEditor(upgradeTrack(track(24)), off, 3);
        const out = edit(st, { kind: 'replace', gates: [], selected: -1 }, off);
        expect(out.ok).toBe(true);
        const empty = out.state;
        expect(empty.course.gates).toHaveLength(0);
        expect(empty.selected).toBe(-1);
        const back = edit(empty, { kind: 'undo' }, off);
        expect(back.ok).toBe(true);
        expect(back.state.course.gates).toHaveLength(24);
        expect(back.state.selected).toBe(3);
    });

    it('the empty course takes its first gate from Add (selected 0), and refuses what needs a gate in words', () => {
        const st = openEditor(upgradeTrack({ ...track(0) }), off);
        expect(st.selected).toBe(-1);
        expect(edit(st, { kind: 'delete' }, off)).toMatchObject({ ok: false, reason: { code: 'no-gate' } });
        expect(edit(st, { kind: 'move', axis: 0, steps: 1 }, off)).toMatchObject({ ok: false, reason: { code: 'no-gate' } });
        expect(edit(st, { kind: 'select-step', step: 1 }, off)).toMatchObject({ ok: false, reason: { code: 'no-gate' } });
        const add = edit(st, { kind: 'add', pos: [2, 1, 3], quat: [1, 0, 0, 0] }, off);
        expect(add.ok).toBe(true);
        expect(add.state.course.gates).toHaveLength(1);
        expect(add.state.selected).toBe(0);
        expect(add.state.course.gates[0]!.id).toBe('g1');
    });

    it('the last gate can be deleted; an empty course is never saved', async () => {
        const { canSave } = await import('@gsfpv/tracks');
        const one = openEditor(upgradeTrack(track(1)), off);
        const del = edit(one, { kind: 'delete' }, off);
        expect(del.ok).toBe(true);
        expect(del.state.course.gates).toHaveLength(0);
        expect(canSave(del.state)).toBe(false);
    });
});

// ---- the life part on a fake seam (no page): the menu, the question, the order of the steps
vi.mock('../../../apps/fly/src/course/editor/parts/life-ask', () => ({ askFirst: vi.fn(), askOpen: () => false }));
vi.mock('../../../apps/fly/src/i18n', () => ({ t: (k: string) => k }));

type Deferred = { promise: Promise<boolean>; resolve: (v: boolean) => void };
const deferred = (): Deferred => {
    let resolve!: (v: boolean) => void;
    const promise = new Promise<boolean>((r) => { resolve = r; });
    return { promise, resolve };
};

async function rig(gates: number) {
    const { SeamBus } = await import('../../../apps/fly/src/course/editor/seam');
    const ask = (await import('../../../apps/fly/src/course/editor/parts/life-ask')).askFirst as unknown as ReturnType<typeof vi.fn>;
    const life = await import('../../../apps/fly/src/course/editor/parts/life');
    const bus = new SeamBus();
    let state: EditorState = openEditor(upgradeTrack(track(gates)), off);
    const menus: Record<string, { id: string; run: () => void }[]> = {};
    const spy = { startNew: vi.fn((f: TrackFile) => { state = openEditor(upgradeTrack(f), off); }), replace: vi.fn(), generate: vi.fn(), say: vi.fn(), frameAll: vi.fn(), hook: {} as Record<string, unknown> };
    bus.provide('frameAll', spy.frameAll);
    const seam = {
        on: bus.on.bind(bus), emit: bus.emit.bind(bus), provide: bus.provide.bind(bus), call: bus.call.bind(bus),
        state: () => state, flown: () => [2, 0, 0, 0], trackNow: () => track(gates), startNew: spy.startNew, replace: spy.replace, generate: spy.generate, say: spy.say,
        menu: (id: string, items: { id: string; run: () => void }[]) => { menus[id] = [...(menus[id] ?? []), ...items]; },
        hook: (_p: string, d: Record<string, unknown>) => Object.assign(spy.hook, d)
    };
    const offPart = life.install(seam as never);
    const item = (id: string) => menus.course!.find((m) => m.id === id)!;
    return { ask, bus, spy, item, menus, offPart, life, emit: bus.emit.bind(bus), course: () => state.course as Course };
}

describe('edit4b B1: the Course menu asks before it drops the gates', () => {
    afterEach(() => { vi.clearAllMocks(); });

    it('fills the Course menu with New empty course, Delete all gates, Generate a new course, Overview', async () => {
        const r = await rig(5);
        expect(r.menus.course!.map((m) => m.id)).toEqual(['new', 'clear', 'generate', 'overview']);
        r.item('overview').run();
        expect(r.spy.frameAll).toHaveBeenCalledTimes(1);
        r.offPart();
    });

    it('Generate is never called before the question answers Yes; No keeps the gates', async () => {
        const r = await rig(12);
        const first = deferred();
        r.ask.mockReturnValueOnce(first.promise);
        r.item('generate').run();
        await Promise.resolve();
        expect(r.ask).toHaveBeenCalledTimes(1);
        expect(r.ask.mock.calls[0]![0]).toMatchObject({ titleKey: 'course.life.ask.genTitle', vars: { n: 12 } });
        expect(r.spy.generate).not.toHaveBeenCalled();
        first.resolve(false);
        await new Promise((x) => setTimeout(x, 0));
        expect(r.spy.generate).not.toHaveBeenCalled();
        const second = deferred();
        r.ask.mockReturnValueOnce(second.promise);
        r.item('generate').run();
        await Promise.resolve();
        expect(r.spy.generate).not.toHaveBeenCalled();
        second.resolve(true);
        await new Promise((x) => setTimeout(x, 0));
        expect(r.spy.generate).toHaveBeenCalledWith(null);
        r.offPart();
    });

    it('Delete all gates asks with the count, then replaces the gates with none as one step', async () => {
        const r = await rig(24);
        r.ask.mockResolvedValueOnce(true);
        r.item('clear').run();
        await new Promise((x) => setTimeout(x, 0));
        expect(r.ask.mock.calls[0]![0]).toMatchObject({ titleKey: 'course.life.ask.clearTitle', vars: { n: 24 } });
        expect(r.spy.replace).toHaveBeenCalledWith([], 'clear', -1);
        r.offPart();
    });

    it('New empty course asks when there are gates, then starts a course with no gate on the same scene, at the scene spawn and the scale flown now (int4 car 3)', async () => {
        const r = await rig(6);
        r.ask.mockResolvedValueOnce(true);
        r.item('new').run();
        await new Promise((x) => setTimeout(x, 0));
        expect(r.ask).toHaveBeenCalledTimes(1);
        expect(r.spy.startNew).toHaveBeenCalledTimes(1);
        const f = r.spy.startNew.mock.calls[0]![0] as TrackFile;
        expect(f.gates).toEqual([]);
        expect(f.scene.id).toBe('s1');
        expect(f.start).toBeNull();
        expect(f.transform).toEqual([2, 0, 0, 0]);
        expect(f.generator).toBeNull();
        expect(r.course().gates).toHaveLength(0);
        r.offPart();
    });

    it('nothing to lose (no gate, nothing unsaved): New empty course goes on without a question', async () => {
        const r = await rig(0);
        r.item('new').run();
        await new Promise((x) => setTimeout(x, 0));
        expect(r.ask).not.toHaveBeenCalled();
        expect(r.spy.startNew).toHaveBeenCalledTimes(1);
        r.offPart();
    });

    it('the part is found by the parts loader (course/editor/parts/*.ts)', async () => {
        const { editorParts } = await import('../../../apps/fly/src/course/editor/parts');
        const life = await import('../../../apps/fly/src/course/editor/parts/life');
        expect(editorParts({ './parts/life.ts': life, './parts/life-texts.ts': {} }).map((p) => p.name)).toEqual(['life']);
    });
});

describe('edit4b B1: the test flight has its own button, and no key regenerates', () => {
    it('the top bar has Fly the course; while flying it reads Back to editing and stays on the bar', async () => {
        const { TOP_BUTTONS } = await import('../../../apps/fly/src/course/editor/bar-place');
        expect(TOP_BUTTONS.find((b) => b.id === 'fly')).toMatchObject({ labelKey: 'course.edit.bar.fly', press: 'fly' });
        const top = read('apps/fly/src/course/editor/top-bar.ts');
        expect(top).toMatch(/press === 'fly'\) host\.fly\(!this\.isFlying\)/);
        expect(top).toMatch(/t\(on \? 'course\.edit\.bar\.back' : 'course\.edit\.bar\.fly'\)/);
        expect(read('apps/fly/src/course/editor/editor.css')).toMatch(/\.ce-topbar\.flying \.ce-tb:not\(\[data-top='exit'\]\):not\(\[data-top='fly'\]\) \{ display: none; \}/);
        const course = read('apps/fly/src/app/builtin/course.ts');
        expect(course).toMatch(/fly: \(on\) => bus\?\.call\('testFlight', on\)/);
        expect(course).toMatch(/setKeyboardArm\(on\)/);
    });

    it('no key regenerates the course (KeyG gone from the editor keys)', async () => {
        const { editorKey, KEY_ROWS } = await import('../../../apps/fly/src/course/editor/keys');
        expect(editorKey({ code: 'KeyG' }, [0, -1])).toBeNull();
        expect(KEY_ROWS.some((r) => r.press.code === 'KeyG')).toBe(false);
        expect(read('apps/fly/src/course/editor/keys.ts')).not.toMatch(/KeyG|regen/);
    });

    it('every key of the part is in the four languages of fly/course-life, and no other', async () => {
        const { lifeLocaleKeys } = await import('../../../apps/fly/src/course/editor/parts/life-texts');
        const keys = lifeLocaleKeys();
        for (const lang of ['en', 'es', 'pl', 'ru']) {
            const j = JSON.parse(read(`packages/i18n/locales/fly/course-life/${lang}.json`)) as Record<string, string>;
            expect(Object.keys(j).sort()).toEqual(keys);
            for (const k of keys) expect((j[k] ?? '').trim().length).toBeGreaterThan(0);
        }
    });
});
