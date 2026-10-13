// How this page draws the scan (v0.7 lane R, the owner's item 1). Three inputs, one rule
// (@gsfpv/render-pc drawing.ts resolveDrawing):
//   - the Display setting display.drawing: auto (what the scene asks), stochastic, sorted;
//   - what the scene asks: its link's ?budget= and ?stochastic (SceneRef.render: a pasted SuperSplat
//     link, or this page's own deep link /fly/?scene=<id>&budget=<M>&stochastic) field by field over
//     the catalogue's render (the admin's choice, @gsfpv/scenes sceneRender);
//   - the device: desktop WebGPU only; phones, tablets and WebGL get the sorted drawing and a note.
// fly() and the scene host ask drawingFor() before a scene loads, so the scan streams with its budget
// and draws stochastic from its first frame; the drawing feature (builtin/drawing.ts) applies it again
// once the flight is built (the governor's top budget), on every scene switch and setting change.
import { isHandheld, resolveDrawing } from '@gsfpv/render-pc';
import type { Drawing, DrawingMode } from '@gsfpv/render-pc';
import { renderParams, sceneRender } from '@gsfpv/scenes';
import type { SceneRender } from '@gsfpv/scenes';
import type { PrefsStore } from '@gsfpv/prefs';
import { hasWebGPU, q } from './env';
import type { SceneRef } from './context';

/** This page's own drawing parameters (its deep link): they belong to the scene of the page's ?scene=. */
export const pageRender: SceneRender | undefined = renderParams(q.get('budget'), q.get('stochastic'));

/** A phone or a tablet (render-pc isHandheld): User-Agent Client Hints when the browser has them, else the user agent. */
export const handheld: boolean = isHandheld(
    navigator.userAgent,
    navigator.maxTouchPoints ?? 0,
    (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData?.mobile
);

/** The pilot's Display setting (anything unknown reads as auto). */
export function drawingMode(prefs: PrefsStore): DrawingMode {
    const v = prefs.get<string>('display.drawing');
    return v === 'stochastic' || v === 'sorted' ? v : 'auto';
}

/** What the scene asks: its link's fields over the catalogue's render. */
export function requestOf(scene: SceneRef): SceneRender | undefined {
    return sceneRender(scene.render, scene.meta?.render);
}

/**
 * The drawing for this scene. `webgpu`: the renderer's real device once it exists; before the first
 * scene loads, whether the browser offers WebGPU at all (the engine may still fall back to WebGL, and
 * then the renderer keeps stochastic off by itself and the feature shows the note).
 */
export function drawingFor(prefs: PrefsStore, scene: SceneRef, webgpu: boolean = hasWebGPU): Drawing {
    return resolveDrawing(drawingMode(prefs), requestOf(scene), { webgpu, handheld });
}
