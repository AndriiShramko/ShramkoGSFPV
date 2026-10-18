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
// The part that reads no browser state (the settings, the link less the pilot's live choice, the F3 line) is
// drawing-ask.ts, tested in Node; this file holds what needs `location` and `navigator`.
import { isHandheld, isViewerMobile, resolveDrawing } from '@gsfpv/render-pc';
import type { Drawing } from '@gsfpv/render-pc';
import { renderParams } from '@gsfpv/scenes';
import type { SceneRender } from '@gsfpv/scenes';
import type { PrefsStore } from '@gsfpv/prefs';
import { q } from './env';
import type { SceneRef } from './context';
import { askFor } from './drawing-ask';

export { askFor, drawingBudget, drawingLine, drawingMode, linkOf, setLive } from './drawing-ask';

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

/**
 * The drawing for this scene. `webgpu`: the renderer's real device (SplatRenderer.isWebGPU), never the
 * browser's navigator.gpu: the engine can fall back to WebGL where the browser offers WebGPU, and that
 * device gets neither stochastic nor the link's budget (the session asks once its renderer exists).
 */
export function drawingFor(prefs: PrefsStore, scene: SceneRef, webgpu: boolean): Drawing {
    return resolveDrawing(askFor(prefs, scene), { webgpu, handheld, mobile });
}
