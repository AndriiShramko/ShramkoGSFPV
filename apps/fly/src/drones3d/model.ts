// One entry for the viewer: the Build of a preset in, a Model (parts, anchors, bounds) out (v0.9 lane D).
import type { PresetJson } from '@gsfpv/sim-core';
import { buildFor } from './build';
import type { Build } from './build';
import { openX } from './family-open-x';
import { tinyWhoop, cinewhoop } from './family-whoop';
import { x8 } from './family-x8';
import type { Model } from './kit';
import type { PayloadId } from './payloads';

export type { Model, Part, Anchor, CalloutId } from './kit';

/** The model of a build, by its family. */
export function modelOf(b: Build): Model {
    switch (b.family) {
        case 'open-x': return openX(b);
        case 'cinewhoop': return cinewhoop(b);
        case 'tiny-whoop': return tinyWhoop(b);
        case 'x8': return x8(b);
    }
}

/** The model of a preset (the cinelifter's camera load optional). */
export function modelForPreset(preset: PresetJson, payload?: PayloadId): { build: Build; model: Model } {
    const build = buildFor(preset, payload);
    return { build, model: modelOf(build) };
}
