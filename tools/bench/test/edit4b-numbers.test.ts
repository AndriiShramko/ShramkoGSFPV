// Lane edit4b, stage B2 (docs/wip/edit4b.md; design C:/dev/.gsfpv-lanes/designs/edit4.md section 3): gate numbers and pointing.
// The owner (brief 551): "you write there is a problem with gate N, and I have no idea which gate is which: they carry no
// numbers on the course". Fails on e3201fec: no gate-numbers part, no pointAt provider, no flash paint, and a refused gate
// turned the camera (aim) instead of pointing.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { openEditor, upgradeTrack, type CourseProblem, type EditorState } from '@gsfpv/tracks';
import type { TrackFile } from '@shramko/sonic-fpv';

vi.mock('../../../apps/fly/src/i18n', () => ({ t: (k: string, v?: Record<string, unknown>) => `${k}${v ? JSON.stringify(v) : ''}` }));

const ROOT = join(__dirname, '../../..');
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');
const off = (): never[] => [];
const gate = (i: number) => ({ id: `g${i}`, shape: { kind: 'square' as const, side: 1.5, bar: 0.1 }, pos: [i * 4, 1, 0] as [number, number, number], quat: [1, 0, 0, 0] as [number, number, number, number], direction: 'forward' as const });
const track = (n: number): TrackFile => ({
    format: 'shramko-track/1', id: 't-1', version: 1, parent: null, title: 'generated', scene: { kind: 'scan', id: 's1', version: 1 },
    transform: [1, 0, 0, 0], gates: Array.from({ length: n }, (_, i) => gate(i + 1)), laps: 1, start: { pos: [0, 1, 0], quat: [1, 0, 0, 0] },
    author: { kind: 'generator', name: 'gen' }, generator: { name: 'gen', version: '1', seed: 7, params: {} }, created: '2026-11-19T00:00:00Z'
} as unknown as TrackFile);

describe('edit4b B2: numberSpots puts one readable label per gate in view', () => {
    it('keeps the nearer of two overlapping labels, drops behind the eye and outside the view, sorts by number', async () => {
        const { numberSpots, LABEL_BOX_PX } = await import('../../../apps/fly/src/course/editor/parts/gate-numbers');
        expect(LABEL_BOX_PX).toBeGreaterThanOrEqual(24);
        const spots = numberSpots([
            { n: 1, x: 100, y: 200, depth: 30 },
            { n: 2, x: 110, y: 205, depth: 8 }, // over 1, nearer: 2 keeps its label
            null, // 3 behind the eye
            { n: 4, x: 400, y: 300, depth: -1 },
            { n: 5, x: 2000, y: 300, depth: 10 }, // right of the view
            { n: 6, x: 600, y: 400, depth: 50 }
        ], 1229, 584);
        expect(spots.map((s) => s.n)).toEqual([2, 6]);
        // the label stands over the gate's top point
        expect(spots[0]!.y).toBeLessThan(205);
    });

    it('drops a label over an editor bar, and the selected or pointed gate keeps its label before a nearer one', async () => {
        const { numberSpots } = await import('../../../apps/fly/src/course/editor/parts/gate-numbers');
        const pts = [{ n: 1, x: 100, y: 200, depth: 30 }, { n: 2, x: 110, y: 205, depth: 8 }, { n: 3, x: 500, y: 60, depth: 9 }];
        expect(numberSpots(pts, 1229, 584, [[0, 0, 1229, 70]]).map((s) => s.n)).toEqual([2]);
        expect(numberSpots(pts, 1229, 584, [], [1]).map((s) => s.n)).toEqual([1, 3]);
    });

    it('every gate a problem names is a red label (the window\'s problem words point by colour)', async () => {
        const { badGates } = await import('../../../apps/fly/src/course/editor/rules');
        const ids = ['a', 'b', 'c', 'd'];
        const ps: CourseProblem[] = [{ code: 'gate-wall', gate: 'b' }, { code: 'leg-wall', from: 'c', to: 'd' }] as CourseProblem[];
        expect([...badGates(ps, ids)].sort()).toEqual([1, 2, 3]);
    });
});

describe('edit4b B2: pointAt selects the named gate where it stands, flashes it, and an edge arrow leads to it', () => {
    it('flashes three times in 1.5 s; with reduced motion one steady mark of 3 s', async () => {
        const { flashOn, FLASH_MS, STEADY_MS } = await import('../../../apps/fly/src/course/editor/parts/point');
        const ons = Array.from({ length: 30 }, (_, i) => flashOn(i * 50, false));
        const rises = ons.filter((v, i) => v && (i === 0 || !ons[i - 1])).length;
        expect(rises).toBe(3);
        expect(flashOn(FLASH_MS + 1, false)).toBe(false);
        expect(flashOn(STEADY_MS - 1, true)).toBe(true);
        expect(flashOn(STEADY_MS + 1, true)).toBe(false);
    });

    it('the edge arrow stands on the edge toward an off-screen gate, at the bottom for one behind, none for one in view', async () => {
        const { edgeArrow, EDGE_PX } = await import('../../../apps/fly/src/course/editor/parts/point');
        const right = edgeArrow(3, { n: 3, x: 5000, y: 292, depth: 10 }, 1229, 584)!;
        expect(right.x).toBeCloseTo(1229 - EDGE_PX);
        expect(right.glyph).toBe('\u2192');
        const behind = edgeArrow(3, null, 1229, 584)!;
        expect(behind.behind).toBe(true);
        expect(behind.y).toBeCloseTo(584 - EDGE_PX);
        expect(edgeArrow(3, { n: 3, x: 600, y: 300, depth: 10 }, 1229, 584)).toBeNull();
    });

    it('pointAt selects by point (no camera move), paints the flash on and off, and the arrow click frames the gate', async () => {
        const { SeamBus } = await import('../../../apps/fly/src/course/editor/seam');
        const { GatePointer, FLASH_MS } = await import('../../../apps/fly/src/course/editor/parts/point');
        const bus = new SeamBus();
        let state: EditorState = openEditor(upgradeTrack(track(5)), off);
        const spy = { select: vi.fn((i: number) => { state = { ...state, selected: i }; }), flash: vi.fn(), frameSel: vi.fn(), frameAll: vi.fn() };
        bus.provide('frameSelection', spy.frameSel);
        const seam = {
            on: bus.on.bind(bus), emit: bus.emit.bind(bus), provide: bus.provide.bind(bus), call: bus.call.bind(bus),
            state: () => state, select: spy.select, flashGate: spy.flash, hook: () => undefined
        };
        const p = new GatePointer(seam as never);
        const offP = p.install();
        const now = vi.spyOn(performance, 'now').mockReturnValue(1000);
        bus.call('pointAt', 3, 'problem');
        expect(spy.select).toHaveBeenCalledWith(3, 'point');
        expect(spy.frameSel).not.toHaveBeenCalled();
        expect(p.flashing(1000)).toBe(3);
        expect(spy.flash).toHaveBeenLastCalledWith(3, true);
        expect(p.flashing(1000 + FLASH_MS / 6 + 1)).toBe(-1);
        expect(spy.flash).toHaveBeenLastCalledWith(3, false);
        // gate 4 out of view to the left: an arrow with its number; in view: none
        const a = p.arrow([null, null, null, { n: 4, x: -300, y: 200, depth: 12 }, null], [], 1229, 584, 1200);
        expect(a).toMatchObject({ n: 4, glyph: '\u2190' });
        expect(p.arrow([null, null, null, { n: 4, x: 300, y: 200, depth: 12 }, null], [{ n: 4, x: 300, y: 180 }], 1229, 584, 1200)).toBeNull();
        p.arrowPressed();
        expect(spy.frameSel).toHaveBeenCalledTimes(1);
        // another gate taken by the pilot ends the pointing
        bus.call('pointAt', 1, 'message');
        expect(p.flashing(5000)).toBe(-1);
        bus.emit('selected', { index: 2, id: 'g3', by: 'click' });
        expect(p.arrow([null, { n: 2, x: -50, y: 1, depth: 3 }, null, null, null], [], 1229, 584, 5001)).toBeNull();
        now.mockRestore();
        offP();
    });
});

describe('edit4b B2: every sentence that names a gate points at it', () => {
    it('the locale lines that name a gate by number are the pointed fixes, the red-labelled problems or the selected gate', async () => {
        const { POINTED_KEYS, PROBLEM_KEYS, LEG_START_KEY } = await import('../../../apps/fly/src/course/editor/texts');
        const en = JSON.parse(read('packages/i18n/locales/fly/course/en.json')) as Record<string, string>;
        const naming = Object.keys(en).filter((k) => k.startsWith('course.edit.') && /gate \{(g|a|b|m)\}/i.test(en[k]!));
        // course.edit.gate is the selected gate's own line: its label is the yellow one
        const allowed = new Set([...POINTED_KEYS, ...Object.values(PROBLEM_KEYS), LEG_START_KEY]);
        expect(naming.filter((k) => !allowed.has(k))).toEqual([]);
        for (const k of POINTED_KEYS) expect(en[k]).toMatch(/[Gg]ate \{/);
    });

    it('the pointed fixes come only from firstWrong, whose one caller points at the gate and no longer turns the camera', () => {
        const hub = read('apps/fly/src/app/builtin/course.ts');
        expect(hub.match(/firstWrong\(/g)).toHaveLength(1);
        const body = hub.slice(hub.indexOf('const showWrong'), hub.indexOf('const fixWalls'));
        expect(body).toContain("call('pointAt', w.index, 'problem')");
        expect(body).not.toMatch(/\baim\(\)/);
        expect(hub).toContain('flashGate: (index, on) => stage.flashEdit(index, on)');
        const fixUsers = ['apps/fly/src/course/editor/words.ts', 'apps/fly/src/course/editor/panel.ts'].filter((f) => /FIX_KEYS|firstWrong/.test(read(f)));
        expect(fixUsers).toEqual([]);
    });

    it('the course stage has the flash paint and keeps it across a redraw until the pointer ends it', () => {
        const view = read('apps/fly/src/course/view.ts');
        expect(view).toMatch(/flash: \[1, 0\.25, 0\.95\]/);
        expect(view).toContain('flashEdit(index: number, on: boolean): void');
        expect(view).toContain("i === this.look.flash ? 'flash'");
    });
});
