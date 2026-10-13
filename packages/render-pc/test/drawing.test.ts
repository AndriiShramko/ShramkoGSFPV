// The drawing policy (v0.7 lane R): which devices get SuperSplat's stochastic drawing and a link's
// budget, that the choice reaches the engine's gsplat params, and the governor's top budget. Each part
// has a control that must fail: a policy that ignores the device, an apply that ignores the renderer,
// a governor that is not told the top.
import { describe, it, expect } from 'vitest';
import { resolveDrawing, isHandheld, applyDrawing, DEFAULT_BUDGET_M, DRAWING_MODES } from '../src/drawing';
import type { Drawing, DrawingDevice, DrawingMode, DrawingRequest } from '../src/drawing';
import { FrameGovernor, DEFAULT_STEPS } from '../src/governor';

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
    // phones and tablets: nothing of the request, a note
    ['auto', OWNER, PHONE, { stochastic: false, budgetM: DEFAULT_BUDGET_M, note: 'handheld' }],
    ['stochastic', undefined, PHONE, { stochastic: false, budgetM: DEFAULT_BUDGET_M, note: 'handheld' }],
    ['auto', undefined, PHONE, { stochastic: false, budgetM: DEFAULT_BUDGET_M, note: null }],
    ['sorted', undefined, PHONE, { stochastic: false, budgetM: DEFAULT_BUDGET_M, note: null }],
    // WebGL (no WebGPU, or the engine fell back): the CPU-sort renderer cannot draw it
    ['auto', OWNER, DESKTOP_GL, { stochastic: false, budgetM: DEFAULT_BUDGET_M, note: 'webgl' }],
    ['stochastic', undefined, DESKTOP_GL, { stochastic: false, budgetM: DEFAULT_BUDGET_M, note: 'webgl' }],
    ['auto', undefined, DESKTOP_GL, { stochastic: false, budgetM: DEFAULT_BUDGET_M, note: null }]
];

function failures(policy: Policy): string[] {
    return ROWS.filter(([m, r, d, want]) => JSON.stringify(policy(m, r, d)) !== JSON.stringify(want)).map(([m, r, d]) => `${m} ${JSON.stringify(r)} ${JSON.stringify(d)}`);
}

describe('resolveDrawing: setting x request x device', () => {
    it('every row', () => {
        expect(failures(resolveDrawing)).toEqual([]);
        expect(DRAWING_MODES).toEqual(['auto', 'stochastic', 'sorted']);
    });

    it('control: a policy that follows the request on every device fails the phone and WebGL rows', () => {
        const blind: Policy = (m, r) => ({ stochastic: m === 'stochastic' || (m === 'auto' && r?.stochastic === true), budgetM: r?.budgetM ?? DEFAULT_BUDGET_M, note: null });
        const f = failures(blind);
        expect(f.length).toBe(4);
        expect(f.every((x) => x.includes('"handheld":true') || x.includes('"webgpu":false'))).toBe(true);
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
