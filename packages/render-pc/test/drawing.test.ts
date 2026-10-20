// The drawing policy (v0.7 lane R, rewritten for v0.9 items 7 and 13 and again for v0.10 items 3 and 4): the answer
// comes from, in this order, the link, the pilot's settings (Render and Splat budget), the owner's scene entry, the
// device's class preset (sorted by default since v0.10, the owner's own numbers from the admin over the built-in
// ones). Which devices get stochastic and a budget, that the choice reaches the engine's gsplat params, and the
// governor's top budget. Each part has a control that must fail: a policy that ignores the device, one with the
// v0.9 defaults (stochastic on a desktop), one with the old order (the setting beating the link), one that
// ignores the owner's preset, one blind to the class, one that lets the owner's entry beat the pilot, one that
// lets the pilot beat the link, an apply that ignores the renderer, a governor that is not told the top.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { resolveDrawing, isHandheld, isViewerMobile, applyDrawing, drawOnDevice, defaultBudgetM, canDrawStochastic, pilotBudgetM, DEFAULT_BUDGET_M, MOBILE_BUDGET_M, STOCHASTIC_BUDGET_M, BUDGET_OPTIONS, DRAWING_MODES, DRAWING_NOTES } from '../src/drawing';
import type { Drawing, DrawingAsk, DrawingDevice, DrawingRequest, PilotDrawing } from '../src/drawing';
import { BUILTIN_PRESETS } from '../src/presets';
import type { DrawingPresets } from '../src/presets';
import { DEVICE_CLASSES, impliedClass } from '../src/device-class';
import type { GpuInfo } from '../src/device-class';
import { FrameGovernor, DEFAULT_STEPS } from '../src/governor';
// the Display settings' definitions (packages/prefs is pure data; render-pc does not depend on it at run time)
import { DISPLAY_DEFS } from '../../prefs/src/defs/display';

const DESKTOP: DrawingDevice = { webgpu: true, handheld: false, mobile: false };
const DESKTOP_GL: DrawingDevice = { webgpu: false, handheld: false, mobile: false };
const PHONE: DrawingDevice = { webgpu: true, handheld: true, mobile: true };
/** iPadOS Safari: says "Macintosh", has touch points; a tablet to us (no stochastic, the tablet preset). */
const IPAD_OS: DrawingDevice = { webgpu: true, handheld: true, mobile: false };
const OWNER: DrawingRequest = { budgetM: 8, stochastic: true }; // superspl.at/scene/2f1ddf5f?budget=8&stochastic

// the built-in presets of the classes the flags above imply (impliedClass): the numbers every default row expects
const STRONG = BUILTIN_PRESETS['desktop-strong'];
const WEAK = BUILTIN_PRESETS['desktop-weak'];
const TABLET = BUILTIN_PRESETS.tablet;
const PHONE_P = BUILTIN_PRESETS.phone;
/** What the owner may do in the admin: a stochastic 8 M preset for the strong desktop, and for a phone (which cannot draw it). */
const OWNER_STRONG: DrawingDevice = { ...DESKTOP, class: 'desktop-strong', preset: { drawing: 'stochastic', budgetM: 8, renderScale: 1 } };
const OWNER_PHONE: DrawingDevice = { ...PHONE, class: 'phone', preset: { drawing: 'stochastic', budgetM: 1.5, renderScale: 0.6 } };

const AUTO: PilotDrawing = { mode: 'auto' };
const ask = (o: { link?: DrawingRequest; pilot?: PilotDrawing; scene?: DrawingRequest }): DrawingAsk => ({ ...(o.link ? { link: o.link } : {}), pilot: o.pilot ?? AUTO, ...(o.scene ? { scene: o.scene } : {}) });

type Policy = (a: DrawingAsk, d: DrawingDevice) => Pick<Drawing, 'stochastic' | 'budgetM' | 'note'>;
interface Row { name: string; ask: DrawingAsk; device: DrawingDevice; want: Pick<Drawing, 'stochastic' | 'budgetM' | 'note'> }
const row = (name: string, a: DrawingAsk, device: DrawingDevice, stochastic: boolean, budgetM: number, note: Drawing['note'] = null): Row => ({ name, ask: a, device, want: { stochastic, budgetM, note } });

const ROWS: Row[] = [
    // ---- a desktop with WebGPU: the class's preset is sorted (v0.10: good quality by default)
    row('desktop: nobody asks -> the preset: sorted at the strong desktop budget', ask({}), DESKTOP, false, STRONG.budgetM),
    row('desktop: the owner\'s link', ask({ link: OWNER }), DESKTOP, true, 8),
    row('desktop: a link\'s budget alone keeps the preset\'s drawing (sorted)', ask({ link: { budgetM: 6 } }), DESKTOP, false, 6),
    row('desktop: a link asking sorted (stochastic=0) with its budget', ask({ link: { stochastic: false, budgetM: 2 } }), DESKTOP, false, 2),
    row('desktop: a link asking sorted gets the preset budget', ask({ link: { stochastic: false } }), DESKTOP, false, STRONG.budgetM),
    row('desktop: the pilot chose sorted', ask({ pilot: { mode: 'sorted' } }), DESKTOP, false, STRONG.budgetM),
    row('desktop: the pilot chose stochastic', ask({ pilot: { mode: 'stochastic' } }), DESKTOP, true, STRONG.budgetM),
    // ---- the order: link > the pilot's settings > the owner's entry > the device's preset
    row('link beats the pilot: sorted setting, stochastic link', ask({ link: OWNER, pilot: { mode: 'sorted' } }), DESKTOP, true, 8),
    row('link beats the pilot: stochastic setting, sorted link', ask({ link: { stochastic: false }, pilot: { mode: 'stochastic' } }), DESKTOP, false, STRONG.budgetM),
    row('link beats the pilot\'s budget', ask({ link: { budgetM: 8 }, pilot: { mode: 'auto', budgetM: 16 } }), DESKTOP, false, 8),
    row('the pilot beats the owner\'s entry: sorted setting, stochastic entry', ask({ pilot: { mode: 'sorted' }, scene: { stochastic: true, budgetM: 6 } }), DESKTOP, false, 6),
    row('the pilot beats the owner\'s entry: stochastic setting, sorted entry', ask({ pilot: { mode: 'stochastic' }, scene: { stochastic: false } }), DESKTOP, true, STRONG.budgetM),
    row('the pilot\'s budget beats the owner\'s entry', ask({ pilot: { mode: 'auto', budgetM: 16 }, scene: { budgetM: 6 } }), DESKTOP, false, 16),
    row('the owner\'s entry beats the device: a stochastic scene', ask({ scene: { stochastic: true } }), DESKTOP, true, STRONG.budgetM),
    row('the owner\'s entry beats the device: its own budget', ask({ scene: { stochastic: true, budgetM: 12 } }), DESKTOP, true, 12),
    row('a link field by field: the link\'s budget, the owner\'s stochastic', ask({ link: { budgetM: 3 }, scene: { stochastic: true } }), DESKTOP, true, 3),
    row('the pilot\'s budget alone, the preset\'s drawing', ask({ pilot: { mode: 'auto', budgetM: 2 } }), DESKTOP, false, 2),
    // ---- the owner's preset (admin) is the device's answer: below the entry, the pilot and the link
    row('owner\'s preset (stochastic 8 M): nobody asks', ask({}), OWNER_STRONG, true, 8),
    row('owner\'s preset: the pilot chose sorted -> sorted, at the preset\'s budget', ask({ pilot: { mode: 'sorted' } }), OWNER_STRONG, false, 8),
    row('owner\'s preset: a link asking sorted', ask({ link: { stochastic: false } }), OWNER_STRONG, false, 8),
    row('owner\'s preset: the scene\'s entry says sorted, 5 M', ask({ scene: { stochastic: false, budgetM: 5 } }), OWNER_STRONG, false, 5),
    row('owner\'s preset: the pilot\'s own budget', ask({ pilot: { mode: 'auto', budgetM: 3 } }), OWNER_STRONG, true, 3),
    // ---- phones and tablets: nothing of the request; the note says who asked and what was refused, none when nobody asked
    row('phone: nobody asks -> sorted, the phone preset, no note (the default is not news)', ask({}), PHONE, false, PHONE_P.budgetM),
    row('phone: the owner\'s link', ask({ link: OWNER }), PHONE, false, PHONE_P.budgetM, 'scene-handheld'),
    row('phone: the owner\'s entry asks stochastic', ask({ scene: OWNER }), PHONE, false, PHONE_P.budgetM, 'scene-handheld'),
    row('phone: the pilot chose stochastic', ask({ pilot: { mode: 'stochastic' } }), PHONE, false, PHONE_P.budgetM, 'setting-handheld'),
    row('phone: the pilot chose stochastic, the entry too -> the pilot\'s choice is named', ask({ pilot: { mode: 'stochastic' }, scene: OWNER }), PHONE, false, PHONE_P.budgetM, 'setting-handheld'),
    row('phone: a link\'s budget only', ask({ link: { budgetM: 8 } }), PHONE, false, PHONE_P.budgetM, 'budget-handheld'),
    row('phone: a link asking sorted with a small budget', ask({ link: { stochastic: false, budgetM: 1 } }), PHONE, false, PHONE_P.budgetM, 'budget-handheld'),
    row('phone: the pilot chose sorted, the owner\'s link asks stochastic', ask({ link: OWNER, pilot: { mode: 'sorted' } }), PHONE, false, PHONE_P.budgetM, 'scene-handheld'),
    row('phone: sorted chosen, the entry asks stochastic: nothing refused', ask({ pilot: { mode: 'sorted' }, scene: { stochastic: true } }), PHONE, false, PHONE_P.budgetM),
    row('phone: the phone\'s own budget is not refused', ask({ link: { budgetM: PHONE_P.budgetM } }), PHONE, false, PHONE_P.budgetM),
    row('phone: the desktop\'s 4 M asked by a link is a refusal (v0.8)', ask({ link: { budgetM: DEFAULT_BUDGET_M } }), PHONE, false, PHONE_P.budgetM, 'budget-handheld'),
    row('phone: the pilot\'s lighter budget is kept', ask({ pilot: { mode: 'auto', budgetM: 1 } }), PHONE, false, 1),
    // v0.10 review: the pilot sets the budget to the power of his machine, so his own number holds on a handheld or WebGL
    // too, up as well as down, without a note (it is his own number); only a link's or a scene's number is refused
    row('phone: the pilot\'s heavier budget is kept, without a note (their own number)', ask({ pilot: { mode: 'auto', budgetM: 16 } }), PHONE, false, 16),
    row('phone: the pilot\'s budget beats the owner\'s link budget, which is still named as refused', ask({ link: { budgetM: 8 }, pilot: { mode: 'auto', budgetM: 4 } }), PHONE, false, 4, 'budget-handheld'),
    row('phone: the pilot\'s budget beats the scene\'s entry budget, nothing named (the entry was outranked, not refused)', ask({ pilot: { mode: 'auto', budgetM: 4 }, scene: { budgetM: 8 } }), PHONE, false, 4),
    row('phone: the pilot\'s budget with the pilot choosing stochastic: the drawing is refused and named, the budget kept', ask({ pilot: { mode: 'stochastic', budgetM: 8 } }), PHONE, false, 8, 'setting-handheld'),
    row('owner\'s preset on a phone: stochastic 1.5 M -> the budget is kept, the drawing refused without a note', ask({}), OWNER_PHONE, false, 1.5),
    // an iPad whose Safari says "Macintosh": the tablet class; stochastic is refused, the tablet preset's budget
    row('ipad: nobody asks', ask({}), IPAD_OS, false, TABLET.budgetM),
    row('ipad: the owner\'s link', ask({ link: OWNER }), IPAD_OS, false, TABLET.budgetM, 'scene-handheld'),
    row('ipad: a link\'s budget only', ask({ link: { budgetM: 8 } }), IPAD_OS, false, TABLET.budgetM, 'budget-handheld'),
    row('ipad: the tablet\'s own budget is not refused', ask({ link: { budgetM: TABLET.budgetM } }), IPAD_OS, false, TABLET.budgetM),
    row('ipad: the pilot\'s heavier budget is kept (an iPad Pro is not a phone)', ask({ pilot: { mode: 'auto', budgetM: 8 } }), IPAD_OS, false, 8),
    row('ipad: the pilot\'s lighter budget is kept', ask({ pilot: { mode: 'auto', budgetM: 1 } }), IPAD_OS, false, 1),
    // WebGL (no WebGPU, or the engine fell back): the CPU-sort renderer cannot draw it; the weak desktop's preset
    row('webgl: nobody asks', ask({}), DESKTOP_GL, false, WEAK.budgetM),
    row('webgl: the owner\'s link', ask({ link: OWNER }), DESKTOP_GL, false, WEAK.budgetM, 'scene-webgl'),
    row('webgl: the pilot chose stochastic', ask({ pilot: { mode: 'stochastic' } }), DESKTOP_GL, false, WEAK.budgetM, 'setting-webgl'),
    row('webgl: a link\'s budget only', ask({ link: { budgetM: 8 } }), DESKTOP_GL, false, WEAK.budgetM, 'budget-webgl'),
    row('webgl: the pilot chose sorted, the link asks 8 M stochastic', ask({ link: OWNER, pilot: { mode: 'sorted' } }), DESKTOP_GL, false, WEAK.budgetM, 'scene-webgl'),
    row('webgl: sorted asked by the entry', ask({ scene: { stochastic: false } }), DESKTOP_GL, false, WEAK.budgetM),
    row('webgl: the pilot\'s lighter budget is kept', ask({ pilot: { mode: 'auto', budgetM: 1 } }), DESKTOP_GL, false, 1),
    row('webgl: the pilot\'s heavier budget is kept (a strong GPU on a browser without WebGPU can lift the weak class\'s preset)', ask({ pilot: { mode: 'auto', budgetM: 4 } }), DESKTOP_GL, false, 4),
    row('webgl: the pilot\'s heavier budget beats the link\'s, which is named as refused', ask({ link: { budgetM: 8 }, pilot: { mode: 'auto', budgetM: 4 } }), DESKTOP_GL, false, 4, 'budget-webgl')
];

/** The rows a policy gets wrong. */
const failingRows = (policy: Policy) => ROWS.filter((r) => JSON.stringify(policy(r.ask, r.device)) !== JSON.stringify(r.want));
const failures = (policy: Policy): string[] => failingRows(policy).map((r) => r.name);
const real: Policy = (a, d) => { const { stochastic, budgetM, note } = resolveDrawing(a, d); return { stochastic, budgetM, note }; };

/**
 * The v0.9 defaults as presets, for the control: stochastic at 4 M on a desktop with WebGPU, sorted at 4 M on WebGL
 * and on an iPadOS Safari (SuperSplat's viewer's rule), sorted at 2 M on a phone. Same order, other defaults.
 */
const V09_PRESETS: DrawingPresets = {
    'desktop-strong': { drawing: 'stochastic', budgetM: 4, renderScale: 1 },
    'desktop-weak': { drawing: 'sorted', budgetM: 4, renderScale: 1 },
    tablet: { drawing: 'sorted', budgetM: 4, renderScale: 1 },
    phone: { drawing: 'sorted', budgetM: 2, renderScale: 1 }
};
const v09: Policy = (a, d) => real(a, { ...d, class: impliedClass(d), preset: V09_PRESETS[impliedClass(d)] });

/** The v0.8 order, for the control: the setting beat the link, the device's default was sorted at 4 M. */
const v08: Policy = (a, d) => {
    const request = { budgetM: a.link?.budgetM ?? a.scene?.budgetM, stochastic: a.link?.stochastic ?? a.scene?.stochastic };
    const sceneAsks = a.pilot.mode === 'auto' && request.stochastic === true;
    const wants = a.pilot.mode === 'stochastic' || sceneAsks;
    if (d.webgpu && !d.handheld) return { stochastic: wants, budgetM: request.budgetM ?? DEFAULT_BUDGET_M, note: null };
    const top = defaultBudgetM(d);
    const who = a.pilot.mode === 'stochastic' ? 'setting' : sceneAsks ? 'scene' : request.budgetM !== undefined && request.budgetM !== top ? 'budget' : null;
    return { stochastic: false, budgetM: top, note: who ? `${who}-${d.handheld ? 'handheld' : 'webgl'}` as Drawing['note'] : null };
};

describe('v0.10: the device\'s default is the class\'s preset, and the preset is sorted (good quality by default)', () => {
    it('every built-in preset draws sorted, at a budget the viewer\'s own rule would give that class or less', () => {
        for (const c of DEVICE_CLASSES) expect(BUILTIN_PRESETS[c].drawing, c).toBe('sorted');
        expect(STRONG.budgetM).toBe(DEFAULT_BUDGET_M);
        for (const p of [WEAK, TABLET, PHONE_P]) expect(p.budgetM).toBeLessThanOrEqual(DEFAULT_BUDGET_M);
        expect(PHONE_P.budgetM).toBeLessThanOrEqual(MOBILE_BUDGET_M);
    });

    it('a desktop that nobody asked draws sorted at its preset budget; asking stochastic (a link, the setting, the entry) still gets it', () => {
        expect(resolveDrawing(ask({}), DESKTOP)).toMatchObject({ stochastic: false, budgetM: STRONG.budgetM, deviceClass: 'desktop-strong', renderScale: STRONG.renderScale, from: { stochastic: 'device', budget: 'device' } });
        expect(resolveDrawing(ask({ link: OWNER }), DESKTOP)).toMatchObject({ stochastic: true, budgetM: 8 });
        expect(resolveDrawing(ask({ pilot: { mode: 'stochastic' } }), DESKTOP).stochastic).toBe(true);
        expect(resolveDrawing(ask({ scene: { stochastic: true } }), DESKTOP).stochastic).toBe(true);
    });

    it('control: the v0.9 defaults (stochastic on a desktop, 4 M on WebGL and iPadOS) fail exactly the rows that depend on the default', () => {
        const f = failures(v09);
        expect(f).toContain('desktop: nobody asks -> the preset: sorted at the strong desktop budget');
        expect(f).toContain('desktop: a link\'s budget alone keeps the preset\'s drawing (sorted)');
        expect(f).toContain('the pilot\'s budget alone, the preset\'s drawing');
        expect(f).toContain('webgl: nobody asks');
        expect(f).toContain('ipad: nobody asks');
        // an explicit ask (a link, the pilot's setting, the entry) never depended on the default's drawing
        expect(f).not.toContain('desktop: the owner\'s link');
        expect(f).not.toContain('desktop: the pilot chose sorted');
        expect(f).not.toContain('desktop: the pilot chose stochastic');
        expect(f).not.toContain('phone: nobody asks -> sorted, the phone preset, no note (the default is not news)');
    });
});

describe('resolveDrawing: link x pilot x owner\'s entry x the class\'s preset', () => {
    it('every row', () => {
        expect(failures(real)).toEqual([]);
        expect(DRAWING_MODES).toEqual(['auto', 'stochastic', 'sorted']);
    });

    it('the owner\'s example link on a desktop: stochastic at 8 M', () => {
        expect(resolveDrawing(ask({ link: OWNER }), DESKTOP)).toMatchObject({ stochastic: true, budgetM: 8, from: { stochastic: 'link', budget: 'link' } });
    });

    it('who decided each answer: the link, the setting, the entry, the device', () => {
        const from = (a: DrawingAsk, d = DESKTOP) => resolveDrawing(a, d).from;
        expect(from(ask({}))).toEqual({ stochastic: 'device', budget: 'device' });
        expect(from(ask({ link: OWNER, pilot: { mode: 'sorted', budgetM: 2 }, scene: { stochastic: false, budgetM: 1 } }))).toEqual({ stochastic: 'link', budget: 'link' });
        expect(from(ask({ pilot: { mode: 'sorted', budgetM: 2 }, scene: { stochastic: true, budgetM: 1 } }))).toEqual({ stochastic: 'setting', budget: 'setting' });
        expect(from(ask({ scene: { stochastic: false, budgetM: 1 } }))).toEqual({ stochastic: 'scene', budget: 'scene' });
        expect(from(ask({ link: { budgetM: 3 }, scene: { stochastic: false } }))).toEqual({ stochastic: 'scene', budget: 'link' });
        // a refusal is the device's; so is the budget of a request it refused
        expect(from(ask({ link: OWNER }), PHONE)).toEqual({ stochastic: 'device', budget: 'device' });
        expect(from(ask({ pilot: { mode: 'auto', budgetM: 1 } }), PHONE)).toEqual({ stochastic: 'device', budget: 'setting' });
    });

    it('control: the v0.8 order (the setting beats the link) fails the link-vs-pilot rows', () => {
        const f = failures(v08);
        expect(f).toContain('link beats the pilot: sorted setting, stochastic link');
        expect(f).toContain('link beats the pilot: stochastic setting, sorted link');
        expect(f).toContain('the pilot\'s budget beats the owner\'s entry'); // it had no budget setting
        expect(f.length).toBeGreaterThanOrEqual(8);
    });

    it('control: a policy that lets the owner\'s entry beat the pilot fails exactly the pilot-vs-entry rows', () => {
        const entryFirst: Policy = (a, d) => real({ ...a, pilot: a.scene?.stochastic !== undefined ? { ...a.pilot, mode: 'auto' } : a.pilot }, d);
        const f = failures(entryFirst);
        expect(f).toContain('the pilot beats the owner\'s entry: sorted setting, stochastic entry');
        expect(f).toContain('the pilot beats the owner\'s entry: stochastic setting, sorted entry');
        expect(f).not.toContain('desktop: nobody asks -> the preset: sorted at the strong desktop budget');
    });

    it('control: a policy that lets the pilot beat the link fails exactly the link-vs-pilot rows', () => {
        const pilotFirst: Policy = (a, d) => real(a.pilot.mode !== 'auto' ? { ...a, link: a.link ? { ...a.link, stochastic: undefined } : a.link } : a, d);
        const f = failures(pilotFirst);
        expect(f).toContain('link beats the pilot: sorted setting, stochastic link');
        expect(f).toContain('link beats the pilot: stochastic setting, sorted link');
        expect(f).not.toContain('desktop: the owner\'s link');
    });

    it('the pilot\'s own splat budget holds on every device, up as well as down (v0.10 review of item 3)', () => {
        expect(resolveDrawing(ask({ pilot: { mode: 'auto', budgetM: 16 } }), PHONE)).toMatchObject({ stochastic: false, budgetM: 16, note: null, from: { stochastic: 'device', budget: 'setting' } });
        expect(resolveDrawing(ask({ pilot: { mode: 'auto', budgetM: 8 } }), IPAD_OS)).toMatchObject({ budgetM: 8, from: { budget: 'setting' } });
        expect(resolveDrawing(ask({ pilot: { mode: 'auto', budgetM: 4 } }), DESKTOP_GL)).toMatchObject({ budgetM: 4, from: { budget: 'setting' } });
        // a link's or a scene's number is still the desktop's, refused; nobody setting a budget means the class's preset
        expect(resolveDrawing(ask({ link: { budgetM: 8 } }), PHONE)).toMatchObject({ budgetM: PHONE_P.budgetM, note: 'budget-handheld', from: { budget: 'device' } });
        expect(resolveDrawing(ask({ scene: { budgetM: 8 } }), IPAD_OS)).toMatchObject({ budgetM: TABLET.budgetM, from: { budget: 'device' } });
        // control: the v0.10 first cut, the pilot's number kept only when lighter than the class's preset, fails exactly these rows
        const lighterOnly: Policy = (a, d) => {
            const r = real(a, d);
            if (canDrawStochastic(d)) return r;
            const top = (d.preset ?? BUILTIN_PRESETS[d.class ?? impliedClass(d)]).budgetM;
            const own = a.pilot.budgetM;
            return { ...r, budgetM: own !== undefined && own < top ? own : top };
        };
        const f = failures(lighterOnly);
        expect(f).toContain('phone: the pilot\'s heavier budget is kept, without a note (their own number)');
        expect(f).toContain('ipad: the pilot\'s heavier budget is kept (an iPad Pro is not a phone)');
        expect(f).toContain('webgl: the pilot\'s heavier budget is kept (a strong GPU on a browser without WebGPU can lift the weak class\'s preset)');
        expect(f).toContain('phone: the pilot\'s budget with the pilot choosing stochastic: the drawing is refused and named, the budget kept');
        expect(f.length).toBe(7);
        // the lighter-than-preset rows and every desktop row were right before and stay right
        expect(f).not.toContain('phone: the pilot\'s lighter budget is kept');
        expect(f).not.toContain('ipad: the pilot\'s lighter budget is kept');
        expect(f.some((n) => n.startsWith('desktop'))).toBe(false);
    });

    it('the owner\'s preset sits below the scene\'s entry, the pilot and the link, and above the built-in table', () => {
        // the preset is the device's answer: a stochastic 8 M preset, and each stronger voice still wins its own field
        expect(resolveDrawing(ask({}), OWNER_STRONG)).toMatchObject({ stochastic: true, budgetM: 8, from: { stochastic: 'device', budget: 'device' } });
        expect(resolveDrawing(ask({ scene: { stochastic: false } }), OWNER_STRONG)).toMatchObject({ stochastic: false, budgetM: 8, from: { stochastic: 'scene', budget: 'device' } });
        expect(resolveDrawing(ask({ pilot: { mode: 'sorted' }, scene: { stochastic: true } }), OWNER_STRONG)).toMatchObject({ stochastic: false, from: { stochastic: 'setting' } });
        expect(resolveDrawing(ask({ link: { stochastic: false, budgetM: 2 } }), OWNER_STRONG)).toMatchObject({ stochastic: false, budgetM: 2, from: { stochastic: 'link', budget: 'link' } });
        // control: a policy that ignores the owner's preset (the built-in table only) fails the preset rows and no other
        const builtinOnly: Policy = (a, d) => real(a, { ...d, preset: undefined });
        const f = failures(builtinOnly);
        expect(f).toContain('owner\'s preset (stochastic 8 M): nobody asks');
        expect(f).toContain('owner\'s preset: a link asking sorted');
        expect(f.every((n) => n.startsWith('owner\'s preset'))).toBe(true);
    });

    it('a class\'s preset reaches the answer: the class, the budget, the render scale', () => {
        const strong = resolveDrawing(ask({}), DESKTOP);
        const phone = resolveDrawing(ask({}), PHONE);
        const weak = resolveDrawing(ask({}), DESKTOP_GL);
        const tablet = resolveDrawing(ask({}), IPAD_OS);
        expect([strong.deviceClass, phone.deviceClass, weak.deviceClass, tablet.deviceClass]).toEqual(['desktop-strong', 'phone', 'desktop-weak', 'tablet']);
        expect([strong.renderScale, phone.renderScale, weak.renderScale, tablet.renderScale]).toEqual([STRONG.renderScale, PHONE_P.renderScale, WEAK.renderScale, TABLET.renderScale]);
        expect(new Set([strong.budgetM, phone.budgetM, weak.budgetM]).size).toBeGreaterThan(1);
        // a class named by the pilot (class) with the owner's preset beats the flags' implied class
        expect(resolveDrawing(ask({}), { ...DESKTOP, class: 'phone' }).budgetM).toBe(PHONE_P.budgetM);
        // control: a policy blind to the class gives every device the strong desktop's numbers and fails the other classes' rows
        const blindToClass: Policy = (a, d) => real(a, { ...d, class: 'desktop-strong', preset: STRONG });
        const f = failingRows(blindToClass);
        expect(f.some((r) => r.device === PHONE)).toBe(true);
        expect(f.some((r) => r.device === IPAD_OS)).toBe(true);
        expect(f.some((r) => r.device === DESKTOP_GL)).toBe(true);
        expect(f.some((r) => r.device === DESKTOP)).toBe(false);
    });

    it('the Display settings Render and Splat budget: exactly these values, auto by default, live', () => {
        const d = DISPLAY_DEFS.find((x) => x.id === 'display.drawing');
        expect(d && d.type === 'enum' ? [...d.options] : null).toEqual([...DRAWING_MODES]);
        expect(d?.default).toBe('auto');
        expect(d?.apply).toBe('live');
        const b = DISPLAY_DEFS.find((x) => x.id === 'display.budget');
        expect(b && b.type === 'enum' ? [...b.options] : null).toEqual([...BUDGET_OPTIONS]);
        expect(b?.default).toBe('auto');
        expect(b?.apply).toBe('live');
    });

    it('pilotBudgetM: a number of millions from the control, undefined for auto and for anything else', () => {
        expect(BUDGET_OPTIONS.map((o) => pilotBudgetM(o))).toEqual([undefined, 1, 2, 4, 8, 16, 32]);
        for (const bad of [undefined, null, 8, '', '3', '0', '64', 'NaN', '8M', ' 8']) expect(pilotBudgetM(bad), String(bad)).toBeUndefined();
    });

    it('SuperSplat\'s viewer budgets (2 M mobile, 4 M desktop) are where the presets start (defaultBudgetM keeps the viewer\'s rule)', () => {
        expect([MOBILE_BUDGET_M, DEFAULT_BUDGET_M]).toEqual([2, 4]);
        expect(defaultBudgetM(PHONE)).toBe(2);
        expect(defaultBudgetM(DESKTOP)).toBe(4);
        expect(defaultBudgetM(DESKTOP_GL)).toBe(4);
        expect(defaultBudgetM(IPAD_OS)).toBe(DEFAULT_BUDGET_M);
        // the presets are the policy now: the phone class and the tablet class are not the viewer's mobile flag
        expect(resolveDrawing(ask({}), PHONE).budgetM).toBe(PHONE_P.budgetM);
        expect(resolveDrawing(ask({}), IPAD_OS).budgetM).toBe(TABLET.budgetM);
    });

    it('control: a policy that follows the asks on every device fails the phone and WebGL rows, and only those', () => {
        const blind: Policy = (a, d) => {
            const r = resolveDrawing(a, DESKTOP);
            void d;
            return { stochastic: r.stochastic, budgetM: r.budgetM, note: null };
        };
        const f = failingRows(blind);
        expect(f.length).toBeGreaterThanOrEqual(15);
        // the owner's strong-desktop preset is a desktop too, but a blind policy cannot know its numbers
        expect(f.every((r) => r.device.handheld || !r.device.webgpu || r.device === OWNER_STRONG)).toBe(true);
    });

    it('control: noting every request as "the scene asks" fails the setting rows, the budget-only rows and the default rows', () => {
        const old: Policy = (a, d) => {
            const x = real(a, d);
            if (d.webgpu && !d.handheld) return x;
            const asked = a.pilot.mode === 'stochastic' || a.link?.stochastic === true || a.scene?.stochastic === true || a.link?.budgetM !== undefined;
            return { ...x, note: asked ? (d.handheld ? 'scene-handheld' : 'scene-webgl') : null };
        };
        const wrong = failingRows(old);
        const notes = wrong.map((r) => r.want.note ?? 'none');
        expect(notes).toContain('setting-handheld');
        expect(notes).toContain('setting-webgl');
        expect(notes).toContain('budget-handheld');
        expect(notes).toContain('budget-webgl');
    });

    it('canDrawStochastic: a desktop browser whose renderer runs on WebGPU', () => {
        expect([canDrawStochastic(DESKTOP), canDrawStochastic(DESKTOP_GL), canDrawStochastic(PHONE), canDrawStochastic(IPAD_OS)]).toEqual([true, false, false, false]);
    });
});

describe('the HUD notes: a text for each in en, es, pl and ru', () => {
    const LANGS = ['en', 'es', 'pl', 'ru'];
    const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'i18n', 'locales', 'fly', 'drawing');
    const dict = (l: string) => JSON.parse(readFileSync(join(DIR, `${l}.json`), 'utf8')) as Record<string, string>;
    const missing = (notes: readonly string[]) => LANGS.flatMap((l) => notes.filter((n) => typeof dict(l)[`drawing.note.${n}`] !== 'string').map((n) => `${l} ${n}`));

    it('every note the policy gives, no text for a note that does not exist, numbers only in the budget notes', () => {
        expect(missing(DRAWING_NOTES)).toEqual([]);
        expect([...new Set(ROWS.map((r) => r.want.note).filter((n) => n !== null))].sort()).toEqual([...DRAWING_NOTES].sort());
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

    it('the settings and the F3 line have a text in every language (the same keys, placeholders kept)', () => {
        const keys = ['set.display.drawing', 'set.display.drawing.help', 'set.display.budget', 'set.display.budget.help', ...DRAWING_MODES.map((m) => `set.display.drawing.opt.${m}`), ...BUDGET_OPTIONS.map((o) => `set.display.budget.opt.${o}`), 'drawing.on', 'drawing.line', 'drawing.mode.stochastic', 'drawing.mode.sorted', 'drawing.from.link', 'drawing.from.setting', 'drawing.from.scene', 'drawing.from.device'];
        for (const l of LANGS) for (const k of keys) expect(typeof dict(l)[k], `${l} ${k}`).toBe('string');
        for (const l of LANGS) {
            expect(dict(l)['drawing.line'], l).toMatch(/\{mode\}.*\{modeFrom\}.*\{budget\}.*\{budgetFrom\}/);
            expect(dict(l)['drawing.on'], l).toContain('{budget}');
        }
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

    it('review R5: isViewerMobile is SuperSplat\'s viewer\'s rule (PlayCanvas platform.mobile) on every user agent', () => {
        // the engine's own rule, read from the playcanvas build this repo ships (platform.js): mobile is
        // platformName android or ios, decided from the user agent in this order
        const build = readFileSync(createRequire(import.meta.url).resolve('playcanvas'), 'utf8');
        const rule = build.match(/platformName = (\/android\/i)\.test\(ua\) \? "android" : (\/ip\(\?:\[ao\]d\|hone\)\/i)\.test\(ua\) \? "ios"/);
        expect(rule, 'the engine\'s platform rule moved: re-read playcanvas platform.js').not.toBeNull();
        const engineMobile = (ua: string) => /android/i.test(ua) || /ip(?:[ao]d|hone)/i.test(ua);
        for (const ua of Object.values(UA)) expect(isViewerMobile(ua), ua).toBe(engineMobile(ua));
        expect(isViewerMobile(UA.ipadOS)).toBe(false); // the viewer gives an iPadOS Safari the desktop budget
        expect(isViewerMobile(UA.androidTablet)).toBe(true);
        // control: isHandheld differs from the viewer exactly on iPadOS
        expect(Object.values(UA).filter((ua) => isHandheld(ua, 5) !== isViewerMobile(ua))).toEqual([UA.ipadOS]);
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
    const owner = (r: { asked: boolean[] }) => (webgpu: boolean, _gpu?: GpuInfo | null) => { r.asked.push(webgpu); return resolveDrawing(ask({ link: OWNER }), { webgpu, handheld: false, mobile: false }); };

    it('WebGPU: the link\'s budget and stochastic before the scan loads', () => {
        const r = renderer(true);
        expect(drawOnDevice(r, owner(r))).toMatchObject({ stochastic: true, budgetM: 8, note: null });
        expect([r.budgetM, r.stochastic, r.asked]).toEqual([8, true, [true]]);
    });

    it('a browser that offers WebGPU but whose engine fell back to WebGL: the weak desktop\'s budget, sorted', () => {
        const r = renderer(false);
        drawOnDevice(r, owner(r));
        expect([r.budgetM, r.stochastic, r.asked]).toEqual([WEAK.budgetM, false, [false]]);
    });

    it('v0.10: the renderer\'s adapter goes to the decision, so the class can be read from it (and a missing adapter is null, not undefined)', () => {
        const gpu: GpuInfo = { vendor: 'nvidia', architecture: 'lovelace', device: '', description: '', isFallback: false, maxBufferSize: 2 ** 31 };
        const seen: (GpuInfo | null)[] = [];
        const decide = (webgpu: boolean, g: GpuInfo | null) => { seen.push(g); return resolveDrawing(ask({}), { webgpu, handheld: false, mobile: false }); };
        drawOnDevice({ ...renderer(true), gpuInfo: gpu }, decide);
        drawOnDevice(renderer(false), decide);
        expect(seen).toEqual([gpu, null]);
        // control: a target that offers no adapter and a decision that wants one gets null, never a stale object
        expect(seen[1]).toBeNull();
    });

    it('control: deciding with the browser\'s navigator.gpu before the device exists streams the WebGL fallback at the link\'s 8 M', () => {
        const r = renderer(false);
        const guess = resolveDrawing(ask({ link: OWNER }), { webgpu: true, handheld: false, mobile: false }); // what fly() did before
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

    it('v0.9: the desktop default top (STOCHASTIC_BUDGET_M) on a 30 Hz display: on-time frames never lower it', () => {
        // the owner's 4K monitor runs 30 Hz over HDMI; the default top is above the old 4 M, so the governor must
        // treat a calm 30 Hz as calm at the new top too (steps 8, 6, 5, 4, 3 M)
        const g = new FrameGovernor();
        g.setTopBudget(STOCHASTIC_BUDGET_M);
        expect(g.steps.map((s) => s.splatBudgetMillions)).toEqual(DEFAULT_STEPS.map((s) => s.splatBudgetMillions * STOCHASTIC_BUDGET_M / DEFAULT_BUDGET_M));
        const p = 1000 / 30;
        let t = 0;
        for (let i = 0; i < 30 * 40; i++) { t += p; g.onFrame(t); }
        expect([g.step, g.changes, g.current.splatBudgetMillions]).toEqual([0, 0, STOCHASTIC_BUDGET_M]);
        // control: the same governor with every other frame late does step down, so the calm above is the frames' and not a dead governor
        const h = new FrameGovernor();
        h.setTopBudget(STOCHASTIC_BUDGET_M);
        let u = 0, k = 0;
        h.onFrame(u);
        while (u < 8000) { u += p * (k++ % 2 ? 3 : 1); h.onFrame(u); }
        expect(h.step).toBeGreaterThan(0);
    });

    it('control: without setTopBudget the governor never gives more than 4 M', () => {
        const g = new FrameGovernor();
        expect(Math.max(...g.steps.map((s) => s.splatBudgetMillions))).toBe(4);
        expect(() => g.setTopBudget(0)).toThrow(RangeError);
        expect(() => g.setTopBudget(Number.NaN)).toThrow(RangeError);
    });
});
