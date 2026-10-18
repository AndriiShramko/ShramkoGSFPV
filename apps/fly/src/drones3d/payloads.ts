// The camera load of the cinelifter (v0.9 lane D, docs/research/drone-models.md sections 1 and 4). iFlight sells the
// Taurus X8 without a camera ("DSLR or cinema cameras ... Red Komodo, Zcam, BMPCC", maximum payload 3 kg); the preset's
// mass (4872 g) carries a 2 kg Komodo-class rig, the load of iFlight's own hover-time figure. The pilot may choose
// another load: the motors stay the same, so the mass change moves the thrust-to-weight, hover throttle and inertia
// together (sim-core ParamOverrides.payloadG). The default is the preset's own, so nothing changes unless it is chosen.
import { compileParams } from '@gsfpv/sim-core';
import type { PresetJson } from '@gsfpv/sim-core';
import type { Basis } from './equipment';

export type PayloadId = 'komodo' | 'bmpcc6kpro' | 'gopro13' | 'none';

/** In the order the setting lists them: the preset's own first. */
export const PAYLOAD_IDS: readonly PayloadId[] = ['komodo', 'bmpcc6kpro', 'gopro13', 'none'];
export const DEFAULT_PAYLOAD: PayloadId = 'komodo';

/**
 * Lens, media, ND filter and mounting plate of a cinema rig: the preset's 2000 g load minus the RED Komodo 6K body
 * (950 g). The preset's own estimate (docs/research/drones-v08.md), not a maker figure.
 */
export const RIG_ALLOWANCE_G = 1050;

export interface Payload {
    id: PayloadId;
    /** the camera as its maker names it; null for no load */
    name: string | null;
    kind: 'cinema' | 'action' | 'none';
    /** the camera body alone, grams (the maker's figure or the listing's) */
    bodyG: number;
    /** the whole load the drone carries, grams */
    loadG: number;
    /** body size w x h x d, mm (RED: 4 x 4 x 4 in; Blackmagic: 7.08 x 4.41 x 4.84 in; GoPro HERO13) */
    sizeMm: readonly [number, number, number] | null;
    basis: Basis;
    ref?: string;
}

export const PAYLOADS: Readonly<Record<PayloadId, Payload>> = {
    komodo: {
        id: 'komodo', name: 'RED KOMODO 6K', kind: 'cinema', bodyG: 950, loadG: 950 + RIG_ALLOWANCE_G, sizeMm: [101.6, 101.6, 101.6], basis: 'listing',
        ref: 'https://www.abelcine.com/buy/cameras-accessories/digital-cinema-cameras/red-komodo-6k-digital-cinema-camera-rf-mount-2'
    },
    bmpcc6kpro: {
        id: 'bmpcc6kpro', name: 'Blackmagic Pocket Cinema Camera 6K Pro', kind: 'cinema', bodyG: 1238, loadG: 1238 + RIG_ALLOWANCE_G, sizeMm: [180, 112, 123], basis: 'listing',
        ref: 'https://www.blackmagicdesign.com/products/blackmagicpocketcinemacamera/techspecs/W-CIN-12'
    },
    // GoPro's own support article "HERO13 Black: Camera Size And Weight" (read 2026-10-18): "Weight: 157g. Of this, the battery
    // accounts for 33g"; its text says 71.0 W x 55.0 H x 33.6 D mm ("values may be rounded"), its drawing 71.8 x 50.8 mm, the size
    // the retailers copy; the model keeps the drawing's. (v0.9 first cut took 154 g from retailers, who also print 159 g.)
    gopro13: {
        id: 'gopro13', name: 'GoPro HERO13 Black', kind: 'action', bodyG: 157, loadG: 157, sizeMm: [71.8, 50.8, 33.6], basis: 'maker',
        ref: 'https://community.gopro.com/s/article/HERO13-Black-Camera-Size-And-Weight?language=en_US'
    },
    none: { id: 'none', name: null, kind: 'none', bodyG: 0, loadG: 0, sizeMm: null, basis: 'maker', ref: 'https://shop.iflight.com/Taurus-X8-V3-O3-HD-Cinelifter-BNF-Pro1973' }
};

export const isPayloadId = (v: unknown): v is PayloadId => typeof v === 'string' && (PAYLOAD_IDS as readonly string[]).includes(v);

/**
 * The all-up weight (grams) and the thrust-to-weight a camera load makes of a preset, as the picker's cards and the 3D stage print
 * them. At the load the preset assumes (the cinelifter's default RED Komodo rig) and for a drone with no camera load these are the
 * preset's own figures, as written; for another load they are sim-core's own arithmetic (compileParams with payloadG), the very
 * numbers the flight model runs with, so a model never shows one camera and weighs another.
 */
export function loadedNumbers(preset: PresetJson, payload: PayloadId | null | undefined): { weight: string; twr: string } {
    const own = { weight: String(preset.fields.auw_g?.value ?? ''), twr: String(preset.fields.twr?.value ?? '') };
    const choice = payload ? PAYLOADS[payload] : undefined;
    const base = preset.fields.payload_g;
    if (!choice || base === undefined || choice.loadG === Number(base.value)) return own;
    const sp = compileParams(preset, { payloadG: choice.loadG });
    return { weight: String(Math.round(sp.mass * 1000)), twr: sp.twr.toFixed(1) };
}
