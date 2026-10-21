// GSFPV: stand-in for upstream `src/render/splat-source-direct.ts` (754 lines) and `shaders/packed-source.ts`, which are
// NOT vendored: upstream's default data path destroys the engine's own splat textures and patches its work buffer, and
// this simulator hands the splats back to the engine's sorted drawing (REC, video export, share picture), which would
// then need inverse compute passes over every resident file. The adapter (../../../accum.ts) always passes
// `source: 'workbuffer'`, so this class is never constructed; it only keeps the vendored renderer's import and its
// `source === 'workbuffer' ? ... : new DirectSplatSource(device)` expression compiling unchanged.
// Upstream: https://github.com/playcanvas/supersplat-viewer commit 88482a6e4a145520cddf4d9c3d9e00481ae558c1,
// MIT License, Copyright (c) 2011-2026 PlayCanvas Ltd. (LICENSE-supersplat-viewer; changes: UPSTREAM.md).
import type { GraphicsDevice } from 'playcanvas';

import type { SplatSource } from './splat-source';

const DirectSplatSource = class {
    constructor(_device: GraphicsDevice) {
        throw new Error('GSFPV: the direct splat source is not vendored; use source: "workbuffer"');
    }
} as unknown as new (device: GraphicsDevice) => SplatSource;

export { DirectSplatSource };
