// How the scan is drawn (v0.7 lane R, the owner's item 1): sorted (the engine's default, every splat
// blended back to front) or stochastic (SuperSplat's beta: no sorting, each splat kept per pixel with
// the probability of its opacity against a blue-noise pattern, opaque blending, depth writes). Pure
// policy, no engine and no DOM, so it runs in Node tests; renderer.ts applies its result.
//
// Who decides, in this order:
//   1. the pilot's Display setting display.drawing: 'sorted' or 'stochastic' wins; 'auto' (the
//      default) does what the scene's link or the catalogue asks (packages/scenes link.ts sceneRender);
//   2. the device: the engine draws stochastic only with its GPU-sort renderer, i.e. WebGPU. SuperSplat
//      shows it on desktop browsers only, so on phones and tablets the request is ignored too, and so
//      is the scene's budget (a desktop number). The HUD's short note then says who asked (the scene
//      or the pilot's setting) and what was refused (stochastic, or only the budget): DrawingNote.
// The splat budget of a request becomes the quality governor's top level (governor.ts setTopBudget);
// missed frames lower the budget from there and never switch stochastic off.

/** The Display setting display.drawing (packages/prefs defs/display.ts). */
export type DrawingMode = 'auto' | 'stochastic' | 'sorted';
export const DRAWING_MODES: readonly DrawingMode[] = ['auto', 'stochastic', 'sorted'];

/** What a scene asks for (the shape of @gsfpv/scenes SceneRender; this package does not depend on it). */
export interface DrawingRequest {
    /** splat budget, millions */
    budgetM?: number;
    /** true: stochastic asked; false: sorted asked explicitly (stochastic=0); absent: nothing said */
    stochastic?: boolean;
}

export interface DrawingDevice {
    /** the renderer runs on WebGPU (its GPU-sort renderer) */
    webgpu: boolean;
    /** a phone or a tablet (isHandheld) */
    handheld: boolean;
}

/**
 * What this device did not do and who asked for it: the HUD's short note (i18n `drawing.note.<note>`,
 * packages/i18n/locales/fly/drawing). `<who>-<why>`:
 *   - who: `scene` = the scene asked for stochastic (its link or the catalogue, with the setting on
 *     auto); `setting` = the pilot chose stochastic in Display -> Drawing; `budget` = nothing asked for
 *     stochastic here, only the scene's splat budget (a number other than the default) was refused;
 *   - why: `handheld` = a phone or a tablet; `webgl` = no WebGPU (the engine's CPU-sort renderer).
 */
export type DrawingNote = 'scene-handheld' | 'scene-webgl' | 'setting-handheld' | 'setting-webgl' | 'budget-handheld' | 'budget-webgl';
export const DRAWING_NOTES: readonly DrawingNote[] = ['scene-handheld', 'scene-webgl', 'setting-handheld', 'setting-webgl', 'budget-handheld', 'budget-webgl'];

/** The top of the splat budget when nothing asks for another one, millions (governor.ts DEFAULT_STEPS). */
export const DEFAULT_BUDGET_M = 4;

export interface Drawing {
    stochastic: boolean;
    /** the governor's top splat budget, millions */
    budgetM: number;
    /** set when the scene or the setting asked for something this device does not get (who and what: DrawingNote) */
    note: DrawingNote | null;
}

/** The drawing for a setting, a scene's request and a device (see the header for the rules). */
export function resolveDrawing(mode: DrawingMode, request: DrawingRequest | undefined, device: DrawingDevice): Drawing {
    const sceneAsks = mode === 'auto' && request?.stochastic === true;
    const wantsStochastic = mode === 'stochastic' || sceneAsks;
    const budget = request?.budgetM;
    if (device.webgpu && !device.handheld) {
        return { stochastic: wantsStochastic, budgetM: budget ?? DEFAULT_BUDGET_M, note: null };
    }
    // refused here: the pilot's own choice outranks the scene's; a budget alone is named only when it differs
    const who = mode === 'stochastic' ? 'setting' : sceneAsks ? 'scene' : budget !== undefined && budget !== DEFAULT_BUDGET_M ? 'budget' : null;
    const why = device.handheld ? 'handheld' : 'webgl';
    return { stochastic: false, budgetM: DEFAULT_BUDGET_M, note: who ? `${who}-${why}` : null };
}

/**
 * A phone or a tablet, from what the browser says: User-Agent Client Hints' `mobile` when present;
 * Android, iPhone, iPad, iPod or "Mobile" in the user agent; or iPadOS, whose Safari presents itself
 * as a Mac ("Macintosh") but has touch points (a Mac has none). A Windows laptop with a touch screen
 * is a desktop.
 */
export function isHandheld(userAgent: string, maxTouchPoints: number, uaDataMobile?: boolean): boolean {
    if (uaDataMobile === true) return true;
    if (/Android|iPhone|iPad|iPod|Mobile/i.test(userAgent)) return true;
    return /Macintosh/.test(userAgent) && maxTouchPoints > 1;
}

/** The two numbers a scan is drawn with (a Drawing without its note). */
export type DrawingChoice = Pick<Drawing, 'stochastic' | 'budgetM'>;

/** What drawOnDevice needs of a renderer (SplatRenderer; a plain object in tests). */
export interface DrawingTarget {
    /** the device the renderer really got (the engine may fall back to WebGL where the browser offers WebGPU) */
    readonly isWebGPU: boolean;
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
export function drawOnDevice(target: DrawingTarget, decide: (webgpu: boolean) => DrawingChoice): DrawingChoice {
    const d = decide(target.isWebGPU);
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
