// How this page draws the scan (v0.7 lane R, the owner's item 1; v0.9 items 7 and 13). Four inputs, one
// rule (@gsfpv/render-pc drawing.ts resolveDrawing: link > the pilot's settings > the owner's scene entry >
// the device's default, which on a desktop WebGPU browser is stochastic):
//   - the scene's LINK: a pasted SuperSplat link's ?budget= and ?stochastic, or this page's own deep link
//     /fly/?scene=<id>&budget=<M>&stochastic (SceneRef.render);
//   - the Display settings Render (display.drawing: auto, stochastic, sorted) and Splat budget
//     (display.budget), when they are not on auto;
//   - the owner's per-scene render in the catalogue (SceneRef.meta.render, set in the admin);
//   - the device: desktop WebGPU only; phones, tablets and WebGL get the sorted drawing and a note when
//     someone asked for more.
// fly() and the scene host hand drawingFor() to the session, which asks it once its renderer's device
// exists and before the scan loads (render-pc drawOnDevice), so the scan streams with the budget this
// device gets and draws stochastic from its first frame; the drawing feature (builtin/drawing.ts) applies it again
// once the flight is built (the governor's top budget), on every scene switch and setting change.
import { isHandheld, isViewerMobile, pilotBudgetM, resolveDrawing } from '@gsfpv/render-pc';
import type { Drawing, DrawingAsk, DrawingMode } from '@gsfpv/render-pc';
import { renderParams } from '@gsfpv/scenes';
import type { SceneRender } from '@gsfpv/scenes';
import type { PrefsStore } from '@gsfpv/prefs';
import { q } from './env';
import type { SceneRef } from './context';

/** This page's own drawing parameters (its deep link): they belong to the scene of the page's ?scene=. */
export const pageRender: SceneRender | undefined = renderParams(q.get('budget'), q.get('stochastic'));

/** A phone or a tablet (render-pc isHandheld): User-Agent Client Hints when the browser has them, else the user agent. */
export const handheld: boolean = isHandheld(
    navigator.userAgent,
    navigator.maxTouchPoints ?? 0,
    (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData?.mobile
);

/** What SuperSplat's viewer calls mobile (render-pc isViewerMobile): it sets the top splat budget, 2 M or 4 M. */
export const mobile: boolean = isViewerMobile(navigator.userAgent);

/** The pilot's Display setting Render (anything unknown reads as auto). */
export function drawingMode(prefs: PrefsStore): DrawingMode {
    const v = prefs.get<string>('display.drawing');
    return v === 'stochastic' || v === 'sorted' ? v : 'auto';
}

/** The pilot's Display setting Splat budget, millions; undefined = auto (or anything unknown). */
export function drawingBudget(prefs: PrefsStore): number | undefined {
    return pilotBudgetM(prefs.get<string>('display.budget'));
}

/**
 * What the pilot changed in the Render settings while flying THIS scene: it wins over the scene's link
 * for the rest of that scene, so a control never looks dead (a link asked for stochastic, the pilot
 * picks Sorted: sorted draws). Kept per scene object, so the next scene starts clean.
 */
export interface LiveChoice { stochastic?: boolean; budget?: boolean }
const live = new WeakMap<SceneRef, LiveChoice>();

/** Note that the pilot just changed the Render mode (`on`: to something other than auto) or the budget on this scene. */
export function setLive(scene: SceneRef, what: keyof LiveChoice, on: boolean): void {
    const c = live.get(scene) ?? {};
    if (on) c[what] = true; else delete c[what];
    live.set(scene, c);
}

/** What the scene's link asks: its fields, less what the pilot overrode while flying it. */
export function linkOf(scene: SceneRef): SceneRender | undefined {
    const l = scene.render;
    if (!l) return undefined;
    const c = live.get(scene);
    if (!c?.stochastic && !c?.budget) return l;
    const r: SceneRender = {};
    if (!c.budget && l.budgetM !== undefined) r.budgetM = l.budgetM;
    if (!c.stochastic && l.stochastic !== undefined) r.stochastic = l.stochastic;
    return r.budgetM === undefined && r.stochastic === undefined ? undefined : r;
}

/** Everything that says how this scene is drawn (render-pc DrawingAsk): its link, the pilot's settings, the owner's entry. */
export function askFor(prefs: PrefsStore, scene: SceneRef): DrawingAsk {
    const link = linkOf(scene);
    const budgetM = drawingBudget(prefs);
    return { ...(link ? { link } : {}), pilot: { mode: drawingMode(prefs), ...(budgetM !== undefined ? { budgetM } : {}) }, ...(scene.meta?.render ? { scene: scene.meta.render } : {}) };
}

/**
 * The drawing for this scene. `webgpu`: the renderer's real device (SplatRenderer.isWebGPU), never the
 * browser's navigator.gpu: the engine can fall back to WebGL where the browser offers WebGPU, and that
 * device gets neither stochastic nor the link's budget (the session asks once its renderer exists).
 */
export function drawingFor(prefs: PrefsStore, scene: SceneRef, webgpu: boolean): Drawing {
    return resolveDrawing(askFor(prefs, scene), { webgpu, handheld, mobile });
}

/**
 * The F3 line about the drawing: what it is and who decided it ("Render: stochastic (this device) · budget
 * 8 M splats (the link)"), the answer to "is it on, and why" that the owner could not get in v0.7.
 */
export function drawingLine(d: Drawing, say: (key: string, vars?: Record<string, string | number>) => string): string {
    return say('drawing.line', {
        mode: say(`drawing.mode.${d.stochastic ? 'stochastic' : 'sorted'}`),
        modeFrom: say(`drawing.from.${d.from.stochastic}`),
        budget: Math.round(d.budgetM * 100) / 100,
        budgetFrom: say(`drawing.from.${d.from.budget}`)
    });
}
