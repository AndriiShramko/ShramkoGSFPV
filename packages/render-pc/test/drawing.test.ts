// The drawing policy (v0.7 lane R): which devices get SuperSplat's stochastic drawing and a link's
// budget, that the choice reaches the engine's gsplat params, and the governor's top budget. Each part
// has a control that must fail: a policy that ignores the device, an apply that ignores the renderer,
// a governor that is not told the top.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveDrawing, isHandheld, applyDrawing, drawOnDevice, DEFAULT_BUDGET_M, DRAWING_MODES, DRAWING_NOTES } from '../src/drawing';
import type { Drawing, DrawingDevice, DrawingMode, DrawingRequest } from '../src/drawing';
import { FrameGovernor, DEFAULT_STEPS } from '../src/governor';
// the Display setting's definition (packages/prefs is pure data; render-pc does not depend on it at run time)
import { DISPLAY_DEFS } from '../../prefs/src/defs/display';

const DESKTOP: DrawingDevice = { webgpu: true, handheld: false };
const DESKTOP_GL: DrawingDevice = { webgpu: false, handheld: false };
const PHONE: DrawingDevice = { webgpu: true, handheld: true };
const OWNER: DrawingRequest = { budgetM: 8, stochastic: true }; // superspl.at/scene/2f1ddf5f?budget=8&stochastic

type Policy = (m: DrawingMode, r: DrawingRequest | undefined, d: DrawingDevice) => Drawing;

/** [mode, request, device, expected] */
const ROWS: [DrawingMode, DrawingRequest | undefined, DrawingDevice, Drawing][] = [
    ['auto', OWNER, DESKTOP, { stochastic: true, budgetM: 8, note: null }],
    ['auto', undefined, DESKTOP, { stochastic: false, budgetM: DEFAULT_BUDGET_M, note: null }],
    ['auto', { budgetM: 6 }, DESKTOP, { stochastic: false, budgetM: 6, note: null }],
    ['auto', { stochastic: false, budgetM: 2 }, DESKTOP, { stochastic: false, budgetM: 2, note: null }],
    ['sorted', OWNER, DESKTOP, { stochastic: false, budgetM: 8, note: null }],
    ['stochastic', undefined, DESKTOP, { stochastic: true, budgetM: DEFAULT_BUDGET_M, note: null }],
    ['stochastic', { stochastic: false }, DESKTOP, { stochastic: true, budgetM: DEFAULT_BUDGET_M, note: null }],
    // phones and tablets: nothing of the request; the note says who asked and what was refused
    ['auto', OWNER, PHONE, { stochastic: false, budgetM: DEFAULT_BUDGET_M, note: 'scene-handheld' }],
    ['stochastic', undefined, PHONE, { stochastic: false, budgetM: DEFAULT_BUDGET_M, note: 'setting-handheld' }],
    ['stochastic', OWNER, PHONE, { stochastic: false, budgetM: DEFAULT_BUDGET_M, note: 'setting-handheld' }], // the pilot's choice is named, not the scene's
    ['auto', { budgetM: 8 }, PHONE, { stochastic: false, budgetM: DEFAULT_BUDGET_M, note: 'budget-handheld' }], // a budget only: no word about stochastic
    ['auto', { stochastic: false, budgetM: 2 }, PHONE, { stochastic: false, budgetM: DEFAULT_BUDGET_M, note: 'budget-handheld' }],
    ['sorted', OWNER, PHONE, { stochastic: false, budgetM: DEFAULT_BUDGET_M, note: 'budget-handheld' }], // sorted chosen: only the budget was refused
    ['sorted', { stochastic: true }, PHONE, { stochastic: false, budgetM: DEFAULT_BUDGET_M, note: null }], // sorted chosen, nothing refused
    ['auto', { budgetM: DEFAULT_BUDGET_M }, PHONE, { stochastic: false, budgetM: DEFAULT_BUDGET_M, note: null }], // the default budget is not refused
    ['auto', undefined, PHONE, { stochastic: false, budgetM: DEFAULT_BUDGET_M, note: null }],
    ['sorted', undefined, PHONE, { stochastic: false, budgetM: DEFAULT_BUDGET_M, note: null }],
    // WebGL (no WebGPU, or the engine fell back): the CPU-sort renderer cannot draw it
    ['auto', OWNER, DESKTOP_GL, { stochastic: false, budgetM: DEFAULT_BUDGET_M, note: 'scene-webgl' }],
    ['stochastic', undefined, DESKTOP_GL, { stochastic: false, budgetM: DEFAULT_BUDGET_M, note: 'setting-webgl' }],
    ['auto', { budgetM: 8 }, DESKTOP_GL, { stochastic: false, budgetM: DEFAULT_BUDGET_M, note: 'budget-webgl' }],
    ['sorted', OWNER, DESKTOP_GL, { stochastic: false, budgetM: DEFAULT_BUDGET_M, note: 'budget-webgl' }],
    ['sorted', { stochastic: true }, DESKTOP_GL, { stochastic: false, budgetM: DEFAULT_BUDGET_M, note: null }],
    ['auto', undefined, DESKTOP_GL, { stochastic: false, budgetM: DEFAULT_BUDGET_M, note: null }]
];

/** The rows a policy gets wrong. */
const failingRows = (policy: Policy) => ROWS.filter(([m, r, d, want]) => JSON.stringify(policy(m, r, d)) !== JSON.stringify(want));
function failures(policy: Policy): string[] {
    return failingRows(policy).map(([m, r, d]) => `${m} ${JSON.stringify(r)} ${JSON.stringify(d)}`);
}

describe('resolveDrawing: setting x request x device', () => {
    it('every row', () => {
        expect(failures(resolveDrawing)).toEqual([]);
        expect(DRAWING_MODES).toEqual(['auto', 'stochastic', 'sorted']);
    });

    it('the Display setting display.drawing offers exactly these modes, auto by default, live', () => {
        const d = DISPLAY_DEFS.find((x) => x.id === 'display.drawing');
        expect(d && d.type === 'enum' ? [...d.options] : null).toEqual([...DRAWING_MODES]);
        expect(d?.default).toBe('auto');
        expect(d?.apply).toBe('live');
    });

    it('control: a policy that follows the request on every device fails the phone and WebGL rows', () => {
        const blind: Policy = (m, r) => ({ stochastic: m === 'stochastic' || (m === 'auto' && r?.stochastic === true), budgetM: r?.budgetM ?? DEFAULT_BUDGET_M, note: null });
        const f = failures(blind);
        expect(f.length).toBe(10);
        expect(f.every((x) => x.includes('"handheld":true') || x.includes('"webgpu":false'))).toBe(true);
    });

    it('control: the old note (any request = "this scene asks for stochastic") fails every setting and budget row', () => {
        const old: Policy = (m, r, d) => {
            const real = resolveDrawing(m, r, d);
            if (d.webgpu && !d.handheld) return real;
            const asked = m === 'stochastic' || (m === 'auto' && r?.stochastic === true) || r?.budgetM !== undefined;
            return { ...real, note: asked ? (d.handheld ? 'scene-handheld' : 'scene-webgl') : null };
        };
        const wrong = failingRows(old);
        expect(wrong.length).toBe(9);
        // what it got wrong: the pilot's own choice, a budget-only refusal, and a default budget it called a refusal
        expect(wrong.map(([, , , want]) => want.note ?? 'none').sort()).toEqual(['budget-handheld', 'budget-handheld', 'budget-handheld', 'budget-webgl', 'budget-webgl', 'none', 'setting-handheld', 'setting-handheld', 'setting-webgl']);
    });
});

describe('the HUD notes: a text for each in en, es, pl and ru', () => {
    const LANGS = ['en', 'es', 'pl', 'ru'];
    const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'i18n', 'locales', 'fly', 'drawing');
    const dict = (l: string) => JSON.parse(readFileSync(join(DIR, `${l}.json`), 'utf8')) as Record<string, string>;
    const missing = (notes: readonly string[]) => LANGS.flatMap((l) => notes.filter((n) => typeof dict(l)[`drawing.note.${n}`] !== 'string').map((n) => `${l} ${n}`));

    it('every note the policy gives, no text for a note that does not exist, numbers only in the budget notes', () => {
        expect(missing(DRAWING_NOTES)).toEqual([]);
        expect([...new Set(ROWS.map((r) => r[3].note).filter((n) => n !== null))].sort()).toEqual([...DRAWING_NOTES].sort());
        for (const l of LANGS) {
            const keys = Object.keys(dict(l)).filter((k) => k.startsWith('drawing.note.')).map((k) => k.slice('drawing.note.'.length));
            expect(keys.sort()).toEqual([...DRAWING_NOTES].sort());
            for (const n of DRAWING_NOTES) {
                const s = dict(l)[`drawing.note.${n}`];
                expect([s.includes('{budget}'), s.includes('{top}')]).toEqual(n.startsWith('budget-') ? [true, true] : [false, false]);
            }
        }
    });

    it('control: a note without texts is reported in every language', () => {
        expect(missing(['scene-vr'])).toEqual(['en scene-vr', 'es scene-vr', 'pl scene-vr', 'ru scene-vr']);
    });
});

describe('isHandheld: phones and tablets, from the user agent', () => {
    const UA = {
        androidPhone: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
        androidTablet: 'Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
        iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
        ipadOS: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
        windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
        linux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
        cros: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
    };

    it('handheld', () => {
        expect(isHandheld(UA.androidPhone, 5)).toBe(true);
        expect(isHandheld(UA.androidTablet, 10)).toBe(true);
        expect(isHandheld(UA.iphone, 5)).toBe(true);
        expect(isHandheld(UA.ipadOS, 5)).toBe(true); // iPadOS Safari says Macintosh, but has touch points
        expect(isHandheld(UA.windows, 0, true)).toBe(true); // Client Hints win
    });

    it('desktop, a touch-screen Windows laptop included', () => {
        expect(isHandheld(UA.ipadOS, 0)).toBe(false); // a real Mac
        expect(isHandheld(UA.windows, 0)).toBe(false);
        expect(isHandheld(UA.windows, 10)).toBe(false);
        expect(isHandheld(UA.linux, 0)).toBe(false);
        expect(isHandheld(UA.cros, 0)).toBe(false);
        expect(isHandheld(UA.windows, 0, false)).toBe(false);
    });

    it('control: touch points alone would make the Windows laptop a tablet', () => {
        const byTouch = (_ua: string, tp: number) => tp > 0;
        expect(byTouch(UA.windows, 10)).not.toBe(isHandheld(UA.windows, 10));
    });
});

describe('applyDrawing: the choice reaches the engine\'s gsplat params', () => {
    it('GPU sort (WebGPU): stochastic on and off', () => {
        const g = { stochastic: false, splatBudget: 4_000_000 };
        expect(applyDrawing(g, true, true)).toBe(true);
        expect(g.stochastic).toBe(true);
        expect(applyDrawing(g, false, true)).toBe(false);
        expect(g.stochastic).toBe(false);
        expect(g.splatBudget).toBe(4_000_000); // nothing else is touched
    });

    it('CPU sort (WebGL): never on, and switched off if it was', () => {
        const g = { stochastic: true };
        expect(applyDrawing(g, true, false)).toBe(false);
        expect(g.stochastic).toBe(false);
    });

    it('control: writing the wish without the renderer check leaves a WebGL page claiming stochastic', () => {
        const g = { stochastic: false };
        const naive = (p: { stochastic: boolean }, on: boolean) => { p.stochastic = on; return on; };
        naive(g, true);
        expect(g.stochastic).not.toBe(applyDrawing({ stochastic: false }, true, false));
    });
});

describe('drawOnDevice: a scan\'s drawing is decided with the device the renderer really got', () => {
    /** A renderer as the session sees it: its device, its budget, and stochastic only on WebGPU (as applyDrawing). */
    const renderer = (webgpu: boolean) => {
        const r = { isWebGPU: webgpu, budgetM: DEFAULT_BUDGET_M, stochastic: false, asked: [] as boolean[],
            setSplatBudgetMillions(m: number) { r.budgetM = m; },
            setStochastic(on: boolean) { r.stochastic = on && webgpu; return r.stochastic; } };
        return r;
    };
    const owner = (r: { asked: boolean[] }) => (webgpu: boolean) => { r.asked.push(webgpu); return resolveDrawing('auto', OWNER, { webgpu, handheld: false }); };

    it('WebGPU: the link\'s budget and stochastic before the scan loads', () => {
        const r = renderer(true);
        expect(drawOnDevice(r, owner(r))).toEqual({ stochastic: true, budgetM: 8, note: null });
        expect([r.budgetM, r.stochastic, r.asked]).toEqual([8, true, [true]]);
    });

    it('a browser that offers WebGPU but whose engine fell back to WebGL: the default budget, sorted', () => {
        const r = renderer(false);
        drawOnDevice(r, owner(r));
        expect([r.budgetM, r.stochastic, r.asked]).toEqual([DEFAULT_BUDGET_M, false, [false]]);
    });

    it('control: deciding with the browser\'s navigator.gpu before the device exists streams the WebGL fallback at the link\'s 8 M', () => {
        const r = renderer(false);
        const guess = resolveDrawing('auto', OWNER, { webgpu: true, handheld: false }); // what fly() did before
        r.setSplatBudgetMillions(guess.budgetM);
        r.setStochastic(guess.stochastic);
        expect(r.budgetM).toBe(8);
        expect(r.stochastic).toBe(false); // stochastic itself was always kept off by the renderer
    });
});

describe('the governor\'s top budget (a link\'s ?budget=)', () => {
    it('the default top is the old steps exactly', () => {
        const g = new FrameGovernor();
        expect(g.steps).toEqual(DEFAULT_STEPS);
        expect(g.topBudgetMillions).toBe(DEFAULT_BUDGET_M);
        expect(g.setTopBudget(DEFAULT_BUDGET_M)).toBe(false);
    });

    it('8 M: every step scales, the render scales and the step stay', () => {
        const g = new FrameGovernor();
        g.step = 2;
        expect(g.setTopBudget(8)).toBe(true);
        expect(g.steps.map((s) => s.splatBudgetMillions)).toEqual([8, 6, 5, 4, 3]);
        expect(g.steps.map((s) => s.renderScale)).toEqual(DEFAULT_STEPS.map((s) => s.renderScale));
        expect(g.step).toBe(2);
        expect(g.current.splatBudgetMillions).toBe(5);
        // back to the default top: the old numbers again, not a compounding scale
        g.setTopBudget(4);
        expect(g.steps).toEqual(DEFAULT_STEPS);
    });

    it('missed frames lower the budget from the new top', () => {
        const g = new FrameGovernor();
        g.setTopBudget(8);
        const p = 1000 / 60;
        let t = 0, k = 0;
        g.onFrame(t);
        while (t < 3000) { t += p * (k++ % 2 ? 2 : 1); g.onFrame(t); }
        expect(g.step).toBeGreaterThan(0);
        expect(g.current.splatBudgetMillions).toBeLessThan(8);
        expect(g.current.splatBudgetMillions).toBeGreaterThan(DEFAULT_STEPS[g.step].splatBudgetMillions);
    });

    it('control: without setTopBudget the governor never gives more than 4 M', () => {
        const g = new FrameGovernor();
        expect(Math.max(...g.steps.map((s) => s.splatBudgetMillions))).toBe(4);
        expect(() => g.setTopBudget(0)).toThrow(RangeError);
        expect(() => g.setTopBudget(Number.NaN)).toThrow(RangeError);
    });
});
