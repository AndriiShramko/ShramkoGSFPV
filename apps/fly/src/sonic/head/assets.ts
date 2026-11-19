// The files the face tracker downloads (lane head4, stage H3), served from our own origin under /fly/headtrack/, never from
// a CDN. One list for the page (face-tracker.ts, face-worker.ts) and the build (apps/fly/vite-headtrack.ts, which copies the
// wasm from the pinned npm package @mediapipe/tasks-vision and the model from Google's model store, checked by its hash).
// Pure constants: no browser or Node code, so both sides import it.

/** The path under the app's base (Vite base '/fly/') where the files live. */
export const HEAD_ASSET_DIR = 'headtrack/';

export interface HeadAsset {
    /** the file name under HEAD_ASSET_DIR */
    readonly name: string;
    /** where the build takes it: a file of the npm package, or a URL checked by sha256 */
    readonly from: { readonly npm: string } | { readonly url: string };
    readonly bytes: number;
    readonly sha256: string;
}

/**
 * The module build of the wasm runtime: a module worker cannot importScripts, so MediaPipe's loader falls back to a dynamic
 * import(), which needs this ES module variant (it sets globalThis.ModuleFactory). Only the SIMD build is shipped: every
 * browser that runs the simulator has wasm SIMD.
 */
export const HEAD_WASM_LOADER: HeadAsset = {
    name: 'vision_wasm_module_internal.js',
    from: { npm: '@mediapipe/tasks-vision/wasm/vision_wasm_module_internal.js' },
    bytes: 336_662,
    sha256: 'd29996249490361715c769c6a49b43ad47e6ac9a28a8e8bce8d02b238e897851'
};

export const HEAD_WASM_BINARY: HeadAsset = {
    name: 'vision_wasm_module_internal.wasm',
    from: { npm: '@mediapipe/tasks-vision/wasm/vision_wasm_module_internal.wasm' },
    bytes: 14_665_738,
    sha256: 'a269e84b12aefc93c9d6a4d62b01f41e5434a9fa941533bb8e75b1e3d1669e46'
};

/** Face Landmarker float16, version 1 (Apache-2.0 model card: docs/wip/sonic-headtrack-plan.md 1.2). */
export const HEAD_MODEL: HeadAsset = {
    name: 'face_landmarker.task',
    from: { url: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task' },
    bytes: 3_758_596,
    sha256: '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff'
};

export const HEAD_ASSETS: readonly HeadAsset[] = [HEAD_WASM_LOADER, HEAD_WASM_BINARY, HEAD_MODEL];
