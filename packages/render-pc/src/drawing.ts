// How the scan is drawn (v0.7 lane R, the owner's item 1; v0.9 items 7 and 13; v0.10 items 3 and 4): sorted (the
// engine's classic drawing, every splat blended back to front) or stochastic (SuperSplat's beta: no sorting, each
// splat kept per pixel with the probability of its opacity against a blue-noise pattern, opaque blending,
// depth writes). Pure policy, no engine and no DOM, so it runs in Node tests; renderer.ts applies its result.
//
// SORTED is the default on every class of device (v0.10): the engine's stochastic drawing takes one dithered sample
// per pixel and never converges to the sorted picture (docs/wip/v10-r.md measured 17 to 22 dB against it, worst in
// interiors), so a pilot who asked nothing gets the clean picture. Stochastic stays one choice away: a link's
// ?stochastic, the pilot's Render setting, the owner's per-scene entry, or the owner's preset of a class.
//
// Who decides each of the two answers (stochastic or not, the splat budget), the first that says
// something wins:
//   1. the LINK: a pasted SuperSplat link's ?budget= and ?stochastic, or this page's own deep link
//      (/fly/?scene=<id>&budget=8&stochastic): the link is explicit and written for this very scene;
//   2. the PILOT's settings: Display -> Render (display.drawing: auto, stochastic, sorted) and Display ->
//      Splat budget (display.budget), when they are not on 'auto';
//   3. the OWNER's per-scene render (the admin's catalogue entry `render`);
//   4. the DEVICE's preset: the class of the device (device-class.ts: desktop-strong, desktop-weak, tablet, phone)
//      has a preset (presets.ts: drawing, top splat budget, top render scale), the owner's from the admin or the
//      built-in one. Auto in Settings means this.
// A pilot who changes a setting while flying wins over the link for the rest of that scene (the caller
// drops the link's field then: app/builtin/drawing.ts), so a control never looks dead.
//
// The device decides what is possible: the engine draws stochastic only with its GPU-sort renderer, i.e.
// WebGPU. SuperSplat shows it on desktop browsers only, so on phones and tablets a request for it is
// ignored too, and so is the link's or the scene's budget (a desktop number). The budget a refused device
// draws under is its class's preset (v0.10; until then SuperSplat's viewer's own rule, isViewerMobile: 2 M on
// Android, iPhone, iPad and iPod, else 4 M) unless the PILOT set one in Display -> Splat budget: that number
// is his machine's power and holds on every device, up or down (v0.10 review: it used to go only down).
// The HUD's short note then says who asked (the scene or the pilot's setting) and what was refused
// (stochastic, or only the budget): DrawingNote. Nobody asked, nothing refused: no note (a phone's default
// is not news).
// The splat budget becomes the quality governor's top level (governor.ts setTopBudget); missed frames
// lower the budget from there and never switch stochastic off.

import { BUILTIN_PRESETS } from './presets';
import type { DrawingPreset } from './presets';
import { impliedClass, isHandheld } from './device-class';
import type { DeviceClass, GpuInfo } from './device-class';

export { isHandheld };

/** The Display setting display.drawing (packages/prefs defs/display.ts), shown as "Render". */
export type DrawingMode = 'auto' | 'stochastic' | 'sorted';
export const DRAWING_MODES: readonly DrawingMode[] = ['auto', 'stochastic', 'sorted'];

/** What a link or a catalogue entry asks (the shape of @gsfpv/scenes SceneRender; this package does not depend on it). */
export interface DrawingRequest {
    /** splat budget, millions */
    budgetM?: number;
    /** true: stochastic asked; false: sorted asked explicitly (stochastic=0); absent: nothing said */
    stochastic?: boolean;
}

export interface DrawingDevice {
    /** the renderer runs on WebGPU (its GPU-sort renderer) */
    webgpu: boolean;
    /** a phone or a tablet (isHandheld): no stochastic drawing, no scene budget */
    handheld: boolean;
    /** what SuperSplat's viewer calls mobile (isViewerMobile): picks the class when none is given (impliedClass) */
    mobile: boolean;
    /** the class of this device (device-class.ts classifyDevice, or the pilot's own choice); absent: impliedClass of the flags above */
    class?: DeviceClass;
    /** the preset of that class (presets.ts presetFor: the owner's over the built-in); absent: the built-in preset of the class */
    preset?: DrawingPreset;
}

/** The pilot's own choices (Display -> Render and Display -> Splat budget); both 'automatic' by default. */
export interface PilotDrawing {
    mode: DrawingMode;
    /** the pilot's splat budget, millions; undefined = automatic */
    budgetM?: number;
}

/** Everything that may say how a scene is drawn (see the header for the order). */
export interface DrawingAsk {
    link?: DrawingRequest;
    pilot: PilotDrawing;
    scene?: DrawingRequest;
}

/** Who gave an answer: the link, the pilot's setting, the owner's scene entry, or the device's default. */
export type DrawingSource = 'link' | 'setting' | 'scene' | 'device';

/**
 * What this device did not do and who asked for it: the HUD's short note (i18n `drawing.note.<note>`,
 * packages/i18n/locales/fly/drawing). `<who>-<why>`:
 *   - who: `scene` = the link or the owner's scene entry asked for stochastic; `setting` = the pilot chose
 *     stochastic in Display -> Render; `budget` = nothing asked for stochastic here, only a scene's splat
 *     budget (a number other than the one this device draws anyway) was refused;
 *   - why: `handheld` = a phone or a tablet; `webgl` = no WebGPU (the engine's CPU-sort renderer).
 */
export type DrawingNote = 'scene-handheld' | 'scene-webgl' | 'setting-handheld' | 'setting-webgl' | 'budget-handheld' | 'budget-webgl';
export const DRAWING_NOTES: readonly DrawingNote[] = ['scene-handheld', 'scene-webgl', 'setting-handheld', 'setting-webgl', 'budget-handheld', 'budget-webgl'];

/** SuperSplat's viewer's desktop budget, millions (its `budgets.desktop.high`; governor.ts DEFAULT_STEPS' top): the desktop-strong preset's. */
export const DEFAULT_BUDGET_M = 4;

/**
 * Kept for the v0.7 and v0.9 benches that name it: the budget the stochastic drawing had on a desktop in v0.9
 * (4 M, SuperSplat's viewer's desktop budget; docs/wip/v09-r.md "Load cost"). It is no longer a rule of its
 * own: the budget a device draws with when nothing asks is its class's preset (presets.ts), whatever the drawing.
 */
export const STOCHASTIC_BUDGET_M = 4;

/**
 * The top of the splat budget on a device SuperSplat's viewer calls mobile (isViewerMobile), millions
 * (v0.8 item 8): the viewer's `budgets.mobile.high` (@playcanvas/supersplat-viewer 1.35-1.37). The phone and
 * tablet built-in presets start from it; the levels of detail stream on every device, and the governor
 * still lowers the budget from there.
 */
export const MOBILE_BUDGET_M = 2;

/** The range a budget may be asked for, millions (the link contract, @gsfpv/scenes BUDGET_MIN_M / BUDGET_MAX_M). */
export const BUDGET_RANGE_M = { min: 0.25, max: 32 } as const;

/**
 * The values of the pilot's budget control (display.budget): 'auto' or millions of splats. A list, not a
 * free field: the same few budgets SuperSplat's own viewer offers (its low / default / high), plus the two
 * the owner's links use.
 */
export const BUDGET_OPTIONS: readonly string[] = ['auto', '1', '2', '4', '8', '16', '32'];

/** The pilot's budget control as a number of millions; undefined for 'auto' and for anything unknown. */
export function pilotBudgetM(v: unknown): number | undefined {
    if (typeof v !== 'string' || v === 'auto') return undefined;
    const m = Number(v);
    return BUDGET_OPTIONS.includes(v) && m >= BUDGET_RANGE_M.min && m <= BUDGET_RANGE_M.max ? m : undefined;
}

/**
 * SuperSplat's viewer's own "mobile" (it picks `budgets.mobile` by PlayCanvas `platform.mobile`, which
 * is Android, iPad, iPhone or iPod in the user agent, any case). Not isHandheld: an iPad whose Safari
 * says "Macintosh" is desktop here (the viewer gives it 4 M), and Client Hints or a bare "Mobile" do
 * not count. Used only for the budget, so a scan draws with the detail superspl.at shows on that device.
 */
export function isViewerMobile(userAgent: string): boolean {
    return /android|ip(?:[ao]d|hone)/i.test(userAgent);
}

/** The top splat budget SuperSplat's viewer gives a device by its own rule, millions (v0.8; the presets' starting point, no longer the policy). */
export function defaultBudgetM(device: Pick<DrawingDevice, 'mobile'>): number {
    return device.mobile ? MOBILE_BUDGET_M : DEFAULT_BUDGET_M;
}

/** This device can draw stochastic: a desktop browser whose renderer runs on WebGPU. */
export function canDrawStochastic(device: Pick<DrawingDevice, 'webgpu' | 'handheld'>): boolean {
    return device.webgpu && !device.handheld;
}

export interface Drawing {
    stochastic: boolean;
    /** the governor's top splat budget, millions */
    budgetM: number;
    /** the top render scale of the class's preset (Quality.setPresetScale); the governor lowers it from there */
    renderScale: number;
    /** the class of device the preset came from */
    deviceClass: DeviceClass;
    /** set when the scene or the setting asked for something this device does not get (who and what: DrawingNote) */
    note: DrawingNote | null;
    /**
     * Who decided each answer (the test hook, F3): a refusal is the device's. The budget of a request the
     * device refused outright is the device's too.
     */
    from: { stochastic: DrawingSource; budget: DrawingSource };
}

/** The drawing for a scene's asks and a device (see the header for the order and the rules). */
export function resolveDrawing(ask: DrawingAsk, device: DrawingDevice): Drawing {
    const { link, pilot, scene } = ask;
    const deviceClass = device.class ?? impliedClass(device);
    const preset = device.preset ?? BUILTIN_PRESETS[deviceClass];
    // stochastic: the first that says something; else the class's preset
    let wants: boolean;
    let stochasticFrom: DrawingSource;
    if (link?.stochastic !== undefined) { wants = link.stochastic; stochasticFrom = 'link'; }
    else if (pilot.mode !== 'auto') { wants = pilot.mode === 'stochastic'; stochasticFrom = 'setting'; }
    else if (scene?.stochastic !== undefined) { wants = scene.stochastic; stochasticFrom = 'scene'; }
    else { wants = preset.drawing === 'stochastic'; stochasticFrom = 'device'; }
    // the budget: the link's, the pilot's, the scene's, else the class's preset
    let asked: number | undefined;
    let budgetFrom: DrawingSource;
    if (link?.budgetM !== undefined) { asked = link.budgetM; budgetFrom = 'link'; }
    else if (pilot.budgetM !== undefined) { asked = pilot.budgetM; budgetFrom = 'setting'; }
    else if (scene?.budgetM !== undefined) { asked = scene.budgetM; budgetFrom = 'scene'; }
    else { asked = undefined; budgetFrom = 'device'; }

    if (canDrawStochastic(device)) {
        return { stochastic: wants, budgetM: asked ?? preset.budgetM, renderScale: preset.renderScale, deviceClass, note: null, from: { stochastic: stochasticFrom, budget: budgetFrom } };
    }
    // refused here. Stochastic asked by someone (not the device's default) is named, the pilot's own choice
    // before the scene's; a budget alone is named only when it differs from what this device gets anyway
    // (its class's preset budget) and was not the pilot's own.
    const top = preset.budgetM;
    const why = device.handheld ? 'handheld' : 'webgl';
    const refusedStochastic = wants && stochasticFrom !== 'device';
    const who = refusedStochastic ? (stochasticFrom === 'setting' ? 'setting' : 'scene')
        : asked !== undefined && budgetFrom !== 'setting' && asked !== top ? 'budget' : null;
    // the pilot's own budget (Display -> Splat budget) is kept here whatever its size (v0.10 owner item 3: the pilot
    // sets it to the power of his computer, tablet or phone, and an iPad Pro or a strong GPU on Firefox must be able
    // to go above the class's preset); the quality governor still lowers it when frames are missed. Only a link's
    // or a scene's number is refused: those are desktop numbers written for somebody else's machine.
    const own = pilot.budgetM;
    return { stochastic: false, budgetM: own ?? top, renderScale: preset.renderScale, deviceClass, note: who ? `${who}-${why}` : null, from: { stochastic: 'device', budget: own !== undefined ? 'setting' : 'device' } };
}

/** The two numbers a scan is drawn with (a Drawing without its note). */
export type DrawingChoice = Pick<Drawing, 'stochastic' | 'budgetM'>;

/** What drawOnDevice needs of a renderer (SplatRenderer; a plain object in tests). */
export interface DrawingTarget {
    /** the device the renderer really got (the engine may fall back to WebGL where the browser offers WebGPU) */
    readonly isWebGPU: boolean;
    /** what the WebGPU adapter says about itself (device-class.ts); null on WebGL or when the browser hides it */
    readonly gpuInfo?: GpuInfo | null;
    setSplatBudgetMillions(m: number): void;
    /** returns what the engine now draws with (applyDrawing) */
    setStochastic(on: boolean): boolean;
}

/**
 * Decide a scan's drawing with the renderer's real device and write it to the renderer, before the
 * scan's splats load, so it streams with the budget this device gets. `decide` is asked only here,
 * once the device exists: a browser that offers WebGPU (navigator.gpu) can still end up on WebGL (no
 * adapter, a blocked GPU), and that device must not stream at a link's desktop budget.
 */
export function drawOnDevice(target: DrawingTarget, decide: (webgpu: boolean, gpu: GpuInfo | null) => DrawingChoice): DrawingChoice {
    const d = decide(target.isWebGPU, target.gpuInfo ?? null);
    target.setSplatBudgetMillions(d.budgetM);
    target.setStochastic(d.stochastic);
    return d;
}

/** The engine's gsplat parameters this module writes (playcanvas GSplatParams; a plain object in tests). */
export interface GsplatDrawingParams {
    stochastic: boolean;
}

/**
 * Write the drawing to the engine (app.scene.gsplat). The engine reads `stochastic` only in its GPU-sort
 * renderer, so on the CPU-sort one (WebGL) it is kept false and the caller's state never says
 * "stochastic" while the screen is sorted. Returns what the engine now draws with.
 */
export function applyDrawing(params: GsplatDrawingParams, stochastic: boolean, gpuSort: boolean): boolean {
    const on = stochastic && gpuSort;
    if (params.stochastic !== on) params.stochastic = on;
    return on;
}
