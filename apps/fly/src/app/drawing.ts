// How this page draws the scan (v0.7 lane R, the owner's item 1; v0.9 items 7 and 13; v0.10 items 3 and 4). Four
// inputs, one rule (@gsfpv/render-pc drawing.ts resolveDrawing: link > the pilot's settings > the owner's scene
// entry > the device's class preset, sorted unless the owner's preset says otherwise):
//   - the scene's LINK: a pasted SuperSplat link's ?budget= and ?stochastic, or this page's own deep link
//     /fly/?scene=<id>&budget=<M>&stochastic (SceneRef.render);
//   - the Display settings Render (display.drawing: auto, stochastic, sorted) and Splat budget
//     (display.budget), when they are not on auto;
//   - the owner's per-scene render in the catalogue (SceneRef.meta.render, set in the admin);
//   - the device: what class it is (render-pc classifyDevice from the browser's answers and the WebGPU adapter, or
//     the pilot's own Device class setting) and that class's preset, the owner's from the admin (the catalogue's
//     `drawing`, setDrawingDefaults at boot) over the built-in table; stochastic only on desktop WebGPU, phones,
//     tablets and WebGL get the sorted drawing and a note when someone asked for more.
// fly() and the scene host hand drawingFor() to the session, which asks it once its renderer's device
// exists and before the scan loads (render-pc drawOnDevice), so the scan streams with the budget this
// device gets and draws stochastic from its first frame; the drawing feature (builtin/drawing.ts) applies it again
// once the flight is built (the governor's top budget), on every scene switch and setting change.
// The part that reads no browser state (the settings, the link less the pilot's live choice, the F3 line) is
// drawing-ask.ts, tested in Node; this file holds what needs `location` and `navigator`.
import { classifyDevice, isHandheld, isViewerMobile, presetFor, readDrawingDefaults, resolveDrawing } from '@gsfpv/render-pc';
import type { DeviceReading, DeviceSignals, Drawing, DrawingDefaults, DrawingPreset, GpuInfo } from '@gsfpv/render-pc';
import { renderParams } from '@gsfpv/scenes';
import type { SceneRender } from '@gsfpv/scenes';
import type { PrefsStore } from '@gsfpv/prefs';
import { q } from './env';
import type { SceneRef } from './context';
import { askFor, chooseDevice } from './drawing-ask';
import type { DeviceChoice } from './drawing-ask';

export { askFor, chooseDevice, deviceClassSetting, drawingBudget, drawingLine, drawingMode, linkOf, setLive } from './drawing-ask';
export type { DeviceChoice } from './drawing-ask';

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

/** The owner's drawing defaults (the published catalogue's `drawing`, set at boot); none = the built-in table. */
let ownerDefaults: DrawingDefaults | undefined;

/** Boot: the catalogue's `drawing` document, read strictly (render-pc readDrawingDefaults); anything else clears it. */
export function setDrawingDefaults(raw: unknown): void {
    ownerDefaults = readDrawingDefaults(raw);
}

/** The owner's drawing defaults now (the settings line says when the class's preset is his). */
export function drawingDefaults(): DrawingDefaults | undefined {
    return ownerDefaults;
}

/** What the browser says about this device (render-pc DeviceSignals); `webgpu` and `gpu` come from the renderer. */
export function deviceSignals(webgpu: boolean, gpu: GpuInfo | null): DeviceSignals {
    const nav = navigator as Navigator & { deviceMemory?: number };
    return {
        userAgent: navigator.userAgent,
        maxTouchPoints: navigator.maxTouchPoints ?? 0,
        uaMobile: (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData?.mobile,
        screenShortSide: Math.min(screen.width, screen.height) || 0,
        webgpu,
        gpu,
        memoryGb: nav.deviceMemory,
        cores: navigator.hardwareConcurrency
    };
}

/** The class of device this page is on: the pilot's naming over the browser's reading (render-pc classifyDevice). */
export function deviceFor(prefs: PrefsStore, webgpu: boolean, gpu: GpuInfo | null): DeviceChoice {
    const auto: DeviceReading = classifyDevice(deviceSignals(webgpu, gpu));
    return chooseDevice(prefs, auto);
}

/** The preset of this device's class: the owner's fields over the built-in ones. */
export function presetOf(choice: DeviceChoice): DrawingPreset {
    return presetFor(choice.cls, ownerDefaults);
}

/**
 * The drawing for this scene. `webgpu` and `gpu`: the renderer's real device and adapter (SplatRenderer.isWebGPU,
 * .gpuInfo), never the browser's navigator.gpu: the engine can fall back to WebGL where the browser offers WebGPU,
 * and that device gets neither stochastic nor the link's budget (the session asks once its renderer exists).
 */
export function drawingFor(prefs: PrefsStore, scene: SceneRef, webgpu: boolean, gpu: GpuInfo | null = null): Drawing {
    const dev = deviceFor(prefs, webgpu, gpu);
    return resolveDrawing(askFor(prefs, scene), { webgpu, handheld, mobile, class: dev.cls, preset: presetOf(dev) });
}
