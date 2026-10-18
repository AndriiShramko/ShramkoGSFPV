// How the scan is drawn (v0.7 lane R, the owner's item 1; v0.9 items 7 and 13): sorted (the engine's
// classic drawing, every splat blended back to front) or stochastic (SuperSplat's beta: no sorting, each
// splat kept per pixel with the probability of its opacity against a blue-noise pattern, opaque blending,
// depth writes). Pure policy, no engine and no DOM, so it runs in Node tests; renderer.ts applies its result.
//
// Stochastic drawing is the DEFAULT on a desktop browser with WebGPU (v0.9): a pilot who asked nothing,
// on a scene nobody configured, gets it, as a SuperSplat link with ?stochastic would. Phones, tablets and
// WebGL keep the sorted drawing with their lighter budget.
//
// Who decides each of the two answers (stochastic or not, the splat budget), the first that says
// something wins:
//   1. the LINK: a pasted SuperSplat link's ?budget= and ?stochastic, or this page's own deep link
//      (/fly/?scene=<id>&budget=8&stochastic): the link is explicit and written for this very scene;
//   2. the PILOT's settings: Display -> Render (display.drawing: auto, stochastic, sorted) and Display ->
//      Splat budget (display.budget), when they are not on 'auto';
//   3. the OWNER's per-scene render (the admin's catalogue entry `render`);
//   4. the DEVICE's default: stochastic where the device can (STOCHASTIC_BUDGET_M), else sorted under the
//      device's own budget (DEFAULT_BUDGET_M, MOBILE_BUDGET_M).
// A pilot who changes a setting while flying wins over the link for the rest of that scene (the caller
// drops the link's field then: app/builtin/drawing.ts), so a control never looks dead.
//
// The device decides what is possible: the engine draws stochastic only with its GPU-sort renderer, i.e.
// WebGPU. SuperSplat shows it on desktop browsers only, so on phones and tablets a request for it is
// ignored too, and so is the scene's budget (a desktop number). The budget a refused device draws under
// is the one SuperSplat's viewer gives it, by the viewer's own rule (isViewerMobile, v0.8):
// MOBILE_BUDGET_M (2 M) on Android, iPhone, iPad and iPod, else DEFAULT_BUDGET_M (4 M) - so an iPad whose
// Safari says "Macintosh" is refused stochastic (isHandheld) but draws 4 M as on superspl.at. The HUD's
// short note then says who asked (the scene or the pilot's setting) and what was refused (stochastic, or
// only the budget): DrawingNote. Nobody asked, nothing refused: no note (a phone's default is not news).
// The splat budget becomes the quality governor's top level (governor.ts setTopBudget); missed frames
// lower the budget from there and never switch stochastic off.

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
    /** what SuperSplat's viewer calls mobile (isViewerMobile): the top budget is MOBILE_BUDGET_M */
    mobile: boolean;
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

/** The top of the splat budget of the sorted drawing on a desktop, millions (governor.ts DEFAULT_STEPS; SuperSplat's viewer's desktop budget). */
export const DEFAULT_BUDGET_M = 4;

/**
 * The top of the splat budget of the stochastic drawing on a desktop when nobody asks for another one,
 * millions. The same 4 M as the sorted drawing's, SuperSplat's viewer's desktop budget: a link that loses
 * `?budget=8&stochastic` the day SuperSplat makes stochastic its default must draw what a link without
 * parameters draws, and a desktop must not stream or hold more than it did. Measured (docs/wip/v09-r.md
 * "Numbers" and "Load cost"; evidence v09-r-cost-*.json, v09-r-load.json): at the same budget stochastic costs
 * 25 to 45 % less GPU time at 4K than sorted, so 4 M is cheaper than before; 8 M would draw the same GPU time
 * as the old default but stream 65 % more bytes (Opole 300 -> 502 MB, `2f1ddf5f` 98 -> 162 MB) and hold about
 * 1.7x the VRAM, for a gain nobody has shown. A pilot or a link asks for more (Splat budget, `?budget=8`).
 */
export const STOCHASTIC_BUDGET_M = 4;

/**
 * The top of the splat budget on a device SuperSplat's viewer calls mobile (isViewerMobile), millions
 * (v0.8 item 8): the viewer's `budgets.mobile.high` (@playcanvas/supersplat-viewer 1.35-1.37; 4 M is its
 * `budgets.desktop.high`, DEFAULT_BUDGET_M). The levels of detail stream on every device; a phone gets
 * them under a smaller budget, and the governor still lowers it from there.
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

/** The top splat budget a device gets when nothing asks for another one and it draws sorted, millions (SuperSplat's viewer's). */
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
    // stochastic: the first that says something; the device's default is yes
    let wants: boolean;
    let stochasticFrom: DrawingSource;
    if (link?.stochastic !== undefined) { wants = link.stochastic; stochasticFrom = 'link'; }
    else if (pilot.mode !== 'auto') { wants = pilot.mode === 'stochastic'; stochasticFrom = 'setting'; }
    else if (scene?.stochastic !== undefined) { wants = scene.stochastic; stochasticFrom = 'scene'; }
    else { wants = true; stochasticFrom = 'device'; }
    // the budget: the link's, the pilot's, the scene's, else the device's
    let asked: number | undefined;
    let budgetFrom: DrawingSource;
    if (link?.budgetM !== undefined) { asked = link.budgetM; budgetFrom = 'link'; }
    else if (pilot.budgetM !== undefined) { asked = pilot.budgetM; budgetFrom = 'setting'; }
    else if (scene?.budgetM !== undefined) { asked = scene.budgetM; budgetFrom = 'scene'; }
    else { asked = undefined; budgetFrom = 'device'; }

    if (canDrawStochastic(device)) {
        const stochastic = wants;
        return { stochastic, budgetM: asked ?? (stochastic ? STOCHASTIC_BUDGET_M : DEFAULT_BUDGET_M), note: null, from: { stochastic: stochasticFrom, budget: budgetFrom } };
    }
    // refused here. Stochastic asked by someone (not the device's default) is named, the pilot's own choice
    // before the scene's; a budget alone is named only when it differs from what this device gets anyway
    // (defaultBudgetM: 2 M where SuperSplat's viewer says mobile, else 4 M) and was not the pilot's own.
    const top = defaultBudgetM(device);
    const why = device.handheld ? 'handheld' : 'webgl';
    const refusedStochastic = wants && stochasticFrom !== 'device';
    const who = refusedStochastic ? (stochasticFrom === 'setting' ? 'setting' : 'scene')
        : asked !== undefined && budgetFrom !== 'setting' && asked !== top ? 'budget' : null;
    // the pilot's own budget is kept here when it is lighter than the device's; a heavier one is refused
    // like a scene's (a phone that asked for 16 M is not helped by getting it)
    const own = pilot.budgetM;
    const lighter = own !== undefined && own < top;
    return { stochastic: false, budgetM: lighter ? own : top, note: who ? `${who}-${why}` : null, from: { stochastic: 'device', budget: lighter ? 'setting' : 'device' } };
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
