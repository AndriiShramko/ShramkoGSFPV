// What says how a scene is drawn, read from the page's state (v0.9 lane R, apps/fly/src/app/drawing-ask.ts), in
// Node on the real modules and the real settings store: the pilot's two Display settings reach the policy, a
// setting changed while flying beats the scene's link for THAT scene only (and Auto hands over to the link
// again), hostile setting values read as auto, and F3's line names what draws and who decided it.
// Each claim has a control that must fail: a reader that ignores the live choice, one that keeps it for the
// next scene, one that takes the setting's text at its word.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveDrawing, STOCHASTIC_BUDGET_M, DEFAULT_BUDGET_M } from '../../../packages/render-pc/src/drawing';
import type { DrawingDevice } from '../../../packages/render-pc/src/drawing';
import { mkStore } from '../../../packages/prefs/test/helpers';
import { askFor, drawingBudget, drawingLine, drawingMode, linkOf, setLive } from '../../../apps/fly/src/app/drawing-ask';
import type { AskedScene } from '../../../apps/fly/src/app/drawing-ask';
import { REPO } from '../src/evidence';

const DESKTOP: DrawingDevice = { webgpu: true, handheld: false, mobile: false };
const EN = JSON.parse(readFileSync(join(REPO, 'packages', 'i18n', 'locales', 'fly', 'drawing', 'en.json'), 'utf8')) as Record<string, string>;
const say = (key: string, vars: Record<string, string | number> = {}): string => (EN[key] ?? `?${key}`).replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k]));
const OWNER = { budgetM: 8, stochastic: true };
const drawn = (prefs: Parameters<typeof askFor>[0], scene: AskedScene) => resolveDrawing(askFor(prefs, scene), DESKTOP);

describe('the pilot\'s settings reach the policy', () => {
    it('a fresh store asks for nothing: the desktop default', () => {
        const prefs = mkStore();
        expect(askFor(prefs, {})).toEqual({ pilot: { mode: 'auto' } });
        expect(drawn(prefs, {})).toMatchObject({ stochastic: true, budgetM: STOCHASTIC_BUDGET_M, from: { stochastic: 'device', budget: 'device' } });
    });

    it('Render and Splat budget, from the real store', () => {
        const prefs = mkStore();
        prefs.set('display.drawing', 'sorted');
        prefs.set('display.budget', '2');
        expect(askFor(prefs, {})).toEqual({ pilot: { mode: 'sorted', budgetM: 2 } });
        expect(drawn(prefs, {})).toMatchObject({ stochastic: false, budgetM: 2, from: { stochastic: 'setting', budget: 'setting' } });
        prefs.set('display.drawing', 'auto');
        prefs.set('display.budget', 'auto');
        expect(askFor(prefs, {})).toEqual({ pilot: { mode: 'auto' } });
    });

    it('anything the store might hold that is not one of the values reads as auto (control: taking the text at its word)', () => {
        for (const bad of ['STOCHASTIC', 'on', '', null, undefined, 1, {}]) {
            const r = { get: () => bad as never };
            expect([drawingMode(r), drawingBudget(r)]).toEqual(['auto', undefined]);
        }
        const trusting = (v: string) => (v === 'auto' ? undefined : Number(v));
        expect(trusting('3')).toBe(3); // the policy would draw 3 M; the real reader refuses it (BUDGET_OPTIONS)
        expect(drawingBudget({ get: () => '3' as never })).toBeUndefined();
        expect(drawingBudget({ get: () => '64' as never })).toBeUndefined();
    });

    it('the owner\'s catalogue entry is the third voice, never merged into the link (control: the v0.8 merge)', () => {
        const scene: AskedScene = { render: { budgetM: 3 }, meta: { render: { stochastic: false } } };
        expect(askFor(mkStore(), scene)).toEqual({ link: { budgetM: 3 }, pilot: { mode: 'auto' }, scene: { stochastic: false } });
        expect(drawn(mkStore(), scene)).toMatchObject({ stochastic: false, budgetM: 3, from: { stochastic: 'scene', budget: 'link' } });
        // the v0.8 reader merged them (sceneRender): the link then owned stochastic=false and the pilot's Stochastic lost to it
        const merged = { ...scene.meta!.render, ...scene.render };
        const prefs = mkStore();
        prefs.set('display.drawing', 'stochastic');
        expect(drawn(prefs, scene).stochastic).toBe(true); // the pilot beats the owner's entry
        expect(resolveDrawing({ link: merged, pilot: { mode: 'stochastic' } }, DESKTOP).stochastic).toBe(false); // the merge hid the pilot's choice
    });
});

describe('a setting changed while flying beats the link for that scene', () => {
    it('Sorted over the owner\'s link, then Auto hands back', () => {
        const prefs = mkStore();
        const scene: AskedScene = { render: OWNER };
        expect(drawn(prefs, scene)).toMatchObject({ stochastic: true, budgetM: 8 });
        prefs.set('display.drawing', 'sorted');
        // before the live choice is noted, the link still wins (this is how a page LOADS with a stored setting)
        expect(drawn(prefs, scene)).toMatchObject({ stochastic: true, from: { stochastic: 'link' } });
        setLive(scene, 'stochastic', true);
        expect(linkOf(scene)).toEqual({ budgetM: 8 });
        expect(drawn(prefs, scene)).toMatchObject({ stochastic: false, budgetM: 8, from: { stochastic: 'setting', budget: 'link' } });
        // back to Auto: the pilot hands over, the link rules again
        prefs.set('display.drawing', 'auto');
        setLive(scene, 'stochastic', false);
        expect(linkOf(scene)).toEqual(OWNER);
        expect(drawn(prefs, scene)).toMatchObject({ stochastic: true, from: { stochastic: 'link' } });
    });

    it('the budget the same way, and each field on its own', () => {
        const prefs = mkStore();
        const scene: AskedScene = { render: OWNER };
        prefs.set('display.budget', '2');
        setLive(scene, 'budget', true);
        expect(linkOf(scene)).toEqual({ stochastic: true });
        expect(drawn(prefs, scene)).toMatchObject({ stochastic: true, budgetM: 2, from: { stochastic: 'link', budget: 'setting' } });
        setLive(scene, 'stochastic', true);
        expect(linkOf(scene)).toBeUndefined();
    });

    it('only for THAT scene: the next scene (another object) starts clean (control: a reader that keeps one global flag)', () => {
        const a: AskedScene = { render: OWNER };
        const b: AskedScene = { render: OWNER };
        setLive(a, 'stochastic', true);
        expect(linkOf(a)).toEqual({ budgetM: 8 });
        expect(linkOf(b)).toEqual(OWNER);
        const globalFlag = { stochastic: true };
        const naive = (s: AskedScene) => (globalFlag.stochastic && s.render ? { budgetM: s.render.budgetM } : s.render);
        expect(naive(b)).not.toEqual(OWNER); // the global flag would have switched the next scene's link off too
    });

    it('control: without the live choice a Sorted setting would never beat a link, and the control would look dead', () => {
        const prefs = mkStore();
        prefs.set('display.drawing', 'sorted');
        const scene: AskedScene = { render: OWNER };
        expect(drawn(prefs, scene).stochastic).toBe(true);
        setLive(scene, 'stochastic', true);
        expect(drawn(prefs, scene).stochastic).toBe(false);
    });
});

describe('F3\'s drawing line', () => {
    it('names what draws and who decided each answer', () => {
        const prefs = mkStore();
        expect(drawingLine(drawn(prefs, {}), say)).toBe(`Render: stochastic (this device) · budget ${STOCHASTIC_BUDGET_M} M splats (this device)`);
        expect(drawingLine(drawn(prefs, { render: OWNER }), say)).toBe('Render: stochastic (the link) · budget 8 M splats (the link)');
        prefs.set('display.drawing', 'sorted');
        expect(drawingLine(drawn(prefs, {}), say)).toBe(`Render: sorted (your setting) · budget ${DEFAULT_BUDGET_M} M splats (this device)`);
        expect(drawingLine(drawn(mkStore(), { meta: { render: { stochastic: false, budgetM: 6 } } }), say)).toBe('Render: sorted (the scene\'s entry) · budget 6 M splats (the scene\'s entry)');
    });

    it('control: a key without a text would show as ?key (the dictionary has every source and mode)', () => {
        expect(say('drawing.from.nobody')).toBe('?drawing.from.nobody');
        for (const k of ['link', 'setting', 'scene', 'device']) expect(say(`drawing.from.${k}`)).not.toMatch(/^\?/);
        for (const k of ['stochastic', 'sorted']) expect(say(`drawing.mode.${k}`)).not.toMatch(/^\?/);
    });
});
