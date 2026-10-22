// GSFPV: stand-in for upstream `src/picker.ts` (the stochastic renderer's only import that leaves its own
// folder). Upstream's file is a 42 KB GPU picker with engine shader-chunk patches that this simulator does not use;
// the renderer needs only the camera snapshot type and its two helpers, copied here from upstream lines 325-332
// (the type) and 435-452 (the helpers), commit 88482a6e4a145520cddf4d9c3d9e00481ae558c1.
// Source: https://github.com/playcanvas/supersplat-viewer, MIT License, Copyright (c) 2011-2026 PlayCanvas Ltd.
// (LICENSE-supersplat-viewer in this folder; list of local changes: UPSTREAM.md).
import { Mat4, Vec3 } from 'playcanvas';
import type { Entity } from 'playcanvas';

type PickCameraSnapshot = {
    position: Vec3;
    viewMatrix: Mat4;
    projectionMatrix: Mat4;
    nearClip: number;
    farClip: number;
    projection: number;
};

const createPickCameraSnapshot = (): PickCameraSnapshot => ({
    position: new Vec3(),
    viewMatrix: new Mat4(),
    projectionMatrix: new Mat4(),
    nearClip: 0,
    farClip: 0,
    projection: 0
});

const captureCameraSnapshot = (camera: Entity, out: PickCameraSnapshot) => {
    const cam = camera.camera;
    if (!cam) return; // GSFPV: strict config; an entity without a camera component keeps the snapshot as it was
    out.position.copy(camera.getPosition());
    out.viewMatrix.copy(cam.viewMatrix);
    out.projectionMatrix.copy(cam.projectionMatrix);
    out.nearClip = cam.nearClip;
    out.farClip = cam.farClip;
    out.projection = cam.projection;
};

export { captureCameraSnapshot, createPickCameraSnapshot };
export type { PickCameraSnapshot };
