// What says how a scene is drawn, read from the page's state (v0.9 lane R, apps/fly/src/app/drawing-ask.ts), in
// Node on the real modules and the real settings store: the pilot's two Display settings reach the policy, a
// setting changed while flying beats the scene's link for THAT scene only (and Auto hands over to the link
// again), hostile setting values read as auto, and F3's line names what draws and who decided it.
// Each claim has a control that must fail: a reader that ignores the live choice, one that keeps it for the
// next scene, one that takes the setting's text at its word.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveDrawing, DEFAULT_BUDGET_M } from '../../../packages/render-pc/src/drawing';
import type { DrawingDevice } from '../../../packages/render-pc/src/drawing';
import { BUILTIN_PRESETS, presetFor } from '../../../packages/render-pc/src/presets';
import { classifyDevice } from '../../../packages/render-pc/src/device-class';
import type { DeviceSignals } from '../../../packages/render-pc/src/device-class';
import { mkStore } from '../../../packages/prefs/test/helpers';
import { askFor, chooseDevice, deviceClassSetting, deviceLine, drawingBudget, drawingLine, drawingMode, linkOf, setLive } from '../../../apps/fly/src/app/drawing-ask';
import type { AskedScene } from '../../../apps/fly/src/app/drawing-ask';
import { SortedHold } from '../../../apps/fly/src/app/clean-draw';
import { REPO } from '../src/evidence';

const DESKTOP: DrawingDevice = { webgpu: true, handheld: false, mobile: false };
const EN = JSON.parse(readFileSync(join(REPO, 'packages', 'i18n', 'locales', 'fly', 'drawing', 'en.json'), 'utf8')) as Record<string, string>;
const say = (key: string, vars: Record<string, string | number> = {}): string => (EN[key] ?? `?${key}`).replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k]));
const OWNER = { budgetM: 8, stochastic: true };
const drawn = (prefs: Parameters<typeof askFor>[0], scene: AskedScene) => resolveDrawing(askFor(prefs, scene), DESKTOP);

describe('the pilot\'s settings reach the policy', () => {
    it('a fresh store asks for nothing: the desktop default is the class\'s preset, sorted (v0.10)', () => {
        const prefs = mkStore();
        expect(askFor(prefs, {})).toEqual({ pilot: { mode: 'auto' } });
        expect(drawn(prefs, {})).toMatchObject({ stochastic: false, budgetM: BUILTIN_PRESETS['desktop-strong'].budgetM, from: { stochastic: 'device', budget: 'device' } });
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
        expect(drawingLine(drawn(prefs, {}), say)).toBe(`Render: sorted (this device) · budget ${DEFAULT_BUDGET_M} M splats (this device) · desktop, strong graphics`);
        expect(drawingLine(drawn(prefs, { render: OWNER }), say)).toBe('Render: stochastic (the link) · budget 8 M splats (the link) · desktop, strong graphics');
        prefs.set('display.drawing', 'stochastic');
        expect(drawingLine(drawn(prefs, {}), say)).toBe(`Render: stochastic (your setting) · budget ${DEFAULT_BUDGET_M} M splats (this device) · desktop, strong graphics`);
        expect(drawingLine(drawn(mkStore(), { meta: { render: { stochastic: false, budgetM: 6 } } }), say)).toBe('Render: sorted (the scene\'s entry) · budget 6 M splats (the scene\'s entry) · desktop, strong graphics');
    });

    it('v0.10: while a recording runs the line says sorted and who decided it: the recording (control: the line without the hold still says stochastic)', () => {
        const prefs = mkStore();
        prefs.set('display.drawing', 'stochastic');
        const d = drawn(prefs, {});
        expect(drawingLine(d, say, true)).toBe(`Render: sorted (recording) · budget ${DEFAULT_BUDGET_M} M splats (this device) · desktop, strong graphics`);
        expect(drawingLine(d, say, false)).toMatch(/^Render: stochastic \(your setting\)/);
        // a drawing that was sorted anyway keeps its own source when a recording runs
        expect(drawingLine(drawn(mkStore(), {}), say, true)).toMatch(/^Render: sorted \(this device\)/);
    });

    it('control: a key without a text would show as ?key (the dictionary has every source and mode)', () => {
        expect(say('drawing.from.nobody')).toBe('?drawing.from.nobody');
        for (const k of ['link', 'setting', 'scene', 'device', 'rec']) expect(say(`drawing.from.${k}`)).not.toMatch(/^\?/);
        for (const k of ['desktop-strong', 'desktop-weak', 'tablet', 'phone']) expect(say(`drawing.class.${k}`)).not.toMatch(/^\?/);
        for (const k of ['stochastic', 'accumulating', 'sorted']) expect(say(`drawing.mode.${k}`)).not.toMatch(/^\?/);
    });

    it('v0.11: F3 says "accumulating" when the SuperSplat renderer with its temporal history draws, plain "stochastic" for the engine\'s own dither', () => {
        const prefs = mkStore();
        prefs.set('display.drawing', 'stochastic');
        const d = drawn(prefs, {});
        expect(drawingLine(d, say, false, 'accum')).toBe(`Render: stochastic, accumulating (your setting) · budget ${DEFAULT_BUDGET_M} M splats (this device) · desktop, strong graphics`);
        expect(drawingLine(d, say, false, 'engine')).toBe(`Render: stochastic (your setting) · budget ${DEFAULT_BUDGET_M} M splats (this device) · desktop, strong graphics`);
        // the renderer's own answer is not asked: the old line (the v0.10 callers)
        expect(drawingLine(d, say)).toMatch(/^Render: stochastic \(your setting\)/);
        // control: a line that took `drawn` at its word would claim accumulating while a recording or a sorted preset draws sorted
        expect(drawingLine(d, say, true, 'accum')).toMatch(/^Render: sorted \(recording\)/);
        expect(drawingLine(drawn(mkStore(), {}), say, false, 'accum')).toMatch(/^Render: sorted \(this device\)/);
    });

    it('v0.11: the new mode text exists in every language, apart from the English one', () => {
        for (const lang of ['en', 'es', 'pl', 'ru']) {
            const d = JSON.parse(readFileSync(join(REPO, 'packages', 'i18n', 'locales', 'fly', 'drawing', `${lang}.json`), 'utf8')) as Record<string, string>;
            expect(d['drawing.mode.accumulating'], lang).toBeTruthy();
            if (lang !== 'en') expect(d['drawing.mode.accumulating'], lang).not.toBe(EN['drawing.mode.accumulating']);
        }
    });
});

describe('v0.10: the class of this device and its preset', () => {
    const SIG: DeviceSignals = { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/155.0.0.0 Safari/537.36', maxTouchPoints: 0, screenShortSide: 1080, webgpu: true, gpu: { vendor: 'nvidia', architecture: 'lovelace', device: '', description: '', isFallback: false, maxBufferSize: 2 ** 31 }, memoryGb: 8, cores: 16 };
    const PHONE_SIG: DeviceSignals = { ...SIG, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148 Safari/604.1', maxTouchPoints: 5, screenShortSide: 390, gpu: null };

    it('the Device class setting: a class the pilot named, auto and anything unknown read as "not named"', () => {
        const prefs = mkStore();
        expect(deviceClassSetting(prefs)).toBeUndefined();
        for (const c of ['desktop-strong', 'desktop-weak', 'tablet', 'phone']) {
            prefs.set('display.deviceClass', c);
            expect(deviceClassSetting(prefs), c).toBe(c);
        }
        for (const bad of ['Phone', 'laptop', '', null, undefined, 3]) expect(deviceClassSetting({ get: () => bad as never }), String(bad)).toBeUndefined();
    });

    it('what the browser says is used until the pilot names a class; his naming wins, the reading is kept', () => {
        const prefs = mkStore();
        const reading = classifyDevice(SIG);
        expect(chooseDevice(prefs, reading)).toEqual({ cls: 'desktop-strong', auto: reading, picked: false });
        prefs.set('display.deviceClass', 'phone');
        expect(chooseDevice(prefs, reading)).toEqual({ cls: 'phone', auto: reading, picked: true });
        // control: a chooser that ignores the setting would keep the browser's class
        expect(chooseDevice(prefs, reading).cls).not.toBe(reading.cls);
    });

    it('the named class reaches what is drawn: a desktop that names itself a phone gets the phone preset (budget, resolution), still able to draw stochastic', () => {
        const prefs = mkStore();
        const dev = (cls?: string): DrawingDevice => {
            if (cls) prefs.set('display.deviceClass', cls);
            const c = chooseDevice(prefs, classifyDevice(SIG));
            return { webgpu: true, handheld: false, mobile: false, class: c.cls, preset: presetFor(c.cls) };
        };
        expect(resolveDrawing(askFor(prefs, {}), dev())).toMatchObject({ deviceClass: 'desktop-strong', budgetM: BUILTIN_PRESETS['desktop-strong'].budgetM, renderScale: 1 });
        const named = resolveDrawing(askFor(prefs, {}), dev('phone'));
        expect(named).toMatchObject({ deviceClass: 'phone', budgetM: BUILTIN_PRESETS.phone.budgetM, renderScale: BUILTIN_PRESETS.phone.renderScale, stochastic: false });
        prefs.set('display.drawing', 'stochastic');
        expect(resolveDrawing(askFor(prefs, {}), dev('phone')).stochastic).toBe(true); // the class is a preset, not a capability
    });

    it('a phone reading and its line: "Auto draws sorted, up to 2 M splats, at 70 %" with the notes in order', () => {
        const prefs = mkStore();
        const choice = chooseDevice(prefs, classifyDevice(PHONE_SIG));
        const text = deviceLine({ choice, preset: presetFor(choice.cls), canStochastic: false, gpu: '', ownerChanged: false, held: false }, say);
        expect(text.line).toBe(`This device: phone. Auto draws sorted, up to ${BUILTIN_PRESETS.phone.budgetM} M splats, at ${Math.round(BUILTIN_PRESETS.phone.renderScale * 100)} % of the screen's resolution.`);
        expect(text.notes).toEqual([]);
    });

    it('the line names the GPU, a class the pilot named, the owner\'s change and a running recording', () => {
        const prefs = mkStore();
        prefs.set('display.deviceClass', 'tablet');
        const choice = chooseDevice(prefs, classifyDevice(SIG));
        const out = deviceLine({ choice, preset: { drawing: 'stochastic', budgetM: 3, renderScale: 0.8 }, canStochastic: true, gpu: 'nvidia lovelace', ownerChanged: true, held: true }, say);
        expect(out.line).toBe('This device: tablet (nvidia lovelace). Auto draws stochastic, up to 3 M splats, at 80 % of the screen\'s resolution.');
        expect(out.notes).toEqual(['You named this class; the browser says: desktop, strong graphics.', 'The site\'s owner changed this preset.', 'Recording is on: the picture is drawn sorted until it stops.']);
        // a preset that says stochastic on a device that cannot draw it reads sorted (control: the line must not promise it)
        const cannot = deviceLine({ choice, preset: { drawing: 'stochastic', budgetM: 3, renderScale: 0.8 }, canStochastic: false, gpu: '', ownerChanged: false, held: false }, say);
        expect(cannot.line).toMatch(/Auto draws sorted,/);
    });

    it('every text of the line, the notes and the settings exists in all four languages with the same placeholders', () => {
        const DIR = join(REPO, 'packages', 'i18n', 'locales', 'fly', 'drawing');
        const dicts = ['en', 'es', 'pl', 'ru'].map((l) => JSON.parse(readFileSync(join(DIR, `${l}.json`), 'utf8')) as Record<string, string>);
        const keys = ['drawing.row.line', 'drawing.row.gpu', 'drawing.row.picked', 'drawing.row.owner', 'drawing.row.held', 'drawing.rec.clean', 'drawing.line', 'drawing.from.rec',
            'set.display.deviceClass', 'set.display.deviceClass.help', ...['auto', 'desktop-strong', 'desktop-weak', 'tablet', 'phone'].map((c) => `set.display.deviceClass.opt.${c}`),
            ...['desktop-strong', 'desktop-weak', 'tablet', 'phone'].map((c) => `drawing.class.${c}`)];
        const holes = (x: string): string => [...x.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
        for (const k of keys) {
            for (const d of dicts) expect(typeof d[k], k).toBe('string');
            for (const d of dicts.slice(1)) expect(holes(d[k]), k).toBe(holes(dicts[0][k]));
        }
        // control: a key nobody wrote is reported, not silently empty
        expect(dicts.every((d) => typeof d['drawing.row.nobody'] === 'string')).toBe(false);
    });
});

describe('v0.10: REC draws sorted while it runs (the hold the recorder takes)', () => {
    it('a hold is held until it is let go; letting go twice does nothing; two holds need two lets', () => {
        const hold = new SortedHold();
        expect(hold.held).toBe(false);
        const a = hold.acquire();
        expect(hold.held).toBe(true);
        const b = hold.acquire();
        a();
        expect(hold.held).toBe(true);
        a(); // again: nothing, and it must not take the other recording's hold with it
        expect(hold.held).toBe(true);
        b();
        expect(hold.held).toBe(false);
        // control: a plain flag (the obvious implementation) lets go at the first recording's end while a second still runs
        let flag = false;
        const take = () => { flag = true; return () => { flag = false; }; };
        const x = take(); take(); x();
        expect(flag).toBe(false);
    });

    it('listeners hear every change and can leave', () => {
        const hold = new SortedHold();
        const seen: boolean[] = [];
        const off = hold.onChange(() => seen.push(hold.held));
        const release = hold.acquire();
        release();
        off();
        hold.acquire();
        expect(seen).toEqual([true, false]);
    });
});
