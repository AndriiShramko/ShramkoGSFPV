// A drone preset plus its equipment table row (equipment.ts) = one Build: everything a model needs, with each number
// read from the preset where the preset has it (v0.9 lane D). No engine.
import type { PresetJson } from '@gsfpv/sim-core';
import { canSize, EQUIPMENT } from './equipment';
import type { Equipment, Family } from './equipment';
import { DEFAULT_PAYLOAD, PAYLOADS } from './payloads';
import type { PayloadId } from './payloads';

/** The pack's box, mm: l along the drone's forward axis, w across, h high. */
export interface PackDims {
    l: number;
    w: number;
    h: number;
}

export interface Build {
    id: string;
    /** the preset's display name */
    name: string;
    /** the preset's class line ("2.2-inch brushless cinewhoop") */
    cls: string;
    equipment: Equipment;
    family: Family;
    /** motor to motor, diagonal (the preset's wheelbase_mm) */
    wheelbaseMm: number;
    motorKv: number;
    /** can diameter and height, mm */
    canMm: readonly [number, number];
    propDiameterMm: number;
    cells: number;
    mah: number;
    pack: PackDims;
    /** the flown FPV camera's up-tilt (the preset's camera_uptilt_deg), kept inside the maker's tilt range */
    tiltDeg: number;
    /** the camera load, for the cinelifter only */
    payload: PayloadId | null;
    /** the preset's all-up weight, grams (with the camera load it assumes) */
    auwG: number;
    /** the camera load inside that weight, grams (the cinelifter's 2000), or null */
    presetPayloadG: number | null;
}

/** Volumetric energy density used to size a pack from its capacity, Wh per cm^3 (a 6S 1400 mAh racing pack: 31 Wh in about 105 cm^3). */
export const PACK_WH_PER_CM3 = 0.3;
/** length : width : height of a pack in each family (a tall 1S whoop cell, a 5-inch flat stick, an X8 brick) */
const PACK_SHAPE: Readonly<Record<Family, readonly [number, number, number]>> = {
    'tiny-whoop': [3.0, 1, 0.8],
    cinewhoop: [2.4, 1, 1.0],
    'open-x': [2.2, 1, 1.15],
    x8: [2.7, 1, 1.0]
};

/** The pack's box from cells and capacity (nominal 3.7 V a cell): same volume whatever the shape. Typical, not a maker's size. */
export function packDims(cells: number, mah: number, family: Family): PackDims {
    const wh = (cells * 3.7 * mah) / 1000;
    const mm3 = (wh / PACK_WH_PER_CM3) * 1000;
    const [a, , c] = PACK_SHAPE[family];
    const w = Math.cbrt(mm3 / (a * c));
    return { l: w * a, w, h: w * c };
}

function num(p: PresetJson, key: string): number | undefined {
    const v = p.fields[key]?.value;
    return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function need(p: PresetJson, key: string): number {
    const v = num(p, key);
    if (v === undefined) throw new Error(`preset ${p.id}: ${key} missing`);
    return v;
}

export const hasEquipment = (id: string): boolean => Object.hasOwn(EQUIPMENT, id);

/** The build of a preset; `payload` picks the cinelifter's camera (default: what the preset assumes). */
export function buildFor(preset: PresetJson, payload?: PayloadId): Build {
    const eq = EQUIPMENT[preset.id];
    if (!eq) throw new Error(`no equipment for preset ${preset.id}`);
    const prop = num(preset, 'prop_diameter_mm') ?? eq.prop.diameterMm;
    if (prop === undefined) throw new Error(`preset ${preset.id}: no prop diameter in the preset or the equipment`);
    const cells = need(preset, 'battery_cells'), mah = need(preset, 'battery_capacity_mah');
    const tilt = eq.video.tilt;
    const uptilt = num(preset, 'camera_uptilt_deg') ?? 0;
    return {
        id: preset.id,
        name: preset.name,
        cls: preset.class,
        equipment: eq,
        family: eq.family,
        wheelbaseMm: need(preset, 'wheelbase_mm'),
        motorKv: need(preset, 'motor_kv'),
        canMm: canSize(eq.motor),
        propDiameterMm: prop,
        cells,
        mah,
        pack: packDims(cells, mah, eq.family),
        tiltDeg: tilt ? Math.max(tilt[0], Math.min(tilt[1], uptilt)) : uptilt,
        payload: eq.payload ? (payload ?? DEFAULT_PAYLOAD) : null,
        auwG: need(preset, 'auw_g'),
        presetPayloadG: num(preset, 'payload_g') ?? null
    };
}

/** True when the preset's own mass is the default payload's (the cinelifter's 2000 g): the default choice changes nothing. */
export const presetPayloadG = (preset: PresetJson): number | undefined => num(preset, 'payload_g');

/** The grams a payload choice adds to (or takes from) the preset's mass. */
export function payloadDeltaG(preset: PresetJson, payload: PayloadId): number {
    return PAYLOADS[payload].loadG - (presetPayloadG(preset) ?? 0);
}
