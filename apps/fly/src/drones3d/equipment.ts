// What each drone preset carries, beyond the numbers the preset already holds (v0.9 lane D, item 3a of the
// owner's message 22). docs/research/drone-models.md has the sources, section 2 per drone, section 1 the cinelifter.
// Rules of this table:
//  - nothing here repeats a preset number (wheelbase, prop diameter, cells, mAh, KV, masses): build.ts reads those
//    from the preset, and a test pins that the two never disagree;
//  - every fact has a `basis`: 'maker' (the maker's own page), 'listing' (a retailer copying the maker's sheet, the
//    maker's page being unreachable) or 'typical' (not stated; what builds of the class usually carry). The callouts
//    say "typical" for the last;
//  - brand and model names are not translated; the words around them are (packages/i18n/locales/fly/drones3d).

export type Family = 'open-x' | 'cinewhoop' | 'tiny-whoop' | 'x8';
export type Basis = 'maker' | 'listing' | 'typical';
export type FrameMaterial = 'carbon' | 'pa12' | 'tpu' | 'plastic' | 'aluminium';
export type Connector = 'XT30' | 'XT60' | 'XT90' | 'BT2.0';

/** A fact and where it comes from. */
export interface Sourced {
    basis: Basis;
    /** the page that says it (absent for 'typical') */
    ref?: string;
}

export interface FrameSpec extends Sourced {
    /** the frame's name as the maker writes it */
    name: string;
    /** 'x' = four arms at 45 degrees; the preset flies every drone as such a symmetric X */
    geometry: 'x';
    /** which parts are made of what, as callout words */
    materials: readonly FrameMaterial[];
    /** open-x only: how the drone is dressed; a freestyle quad has a camera cage and a deep stack, a racer a canopy */
    style?: 'freestyle' | 'racer';
}

export interface MotorSpec extends Sourced {
    /** maker and model without the KV, e.g. "XING2 2207" */
    name: string;
    /** stator diameter and height from the model name, mm (2207 = 22 x 7) */
    stator: readonly [number, number];
    /** the motor's outer diameter and height, mm; absent = stator plus the usual margin */
    can?: readonly [number, number];
    /** where the can size comes from, when it is given */
    canBasis?: Basis;
}

export interface PropSpec extends Sourced {
    name: string;
    blades: number;
    /** pitch / diameter, drawn only (the maker's pitch where the name has one: 5.1 x 3.5 is 0.69) */
    pitchRatio: number;
    /** tip to tip, mm, when the preset has no `prop_diameter_mm` (named by the prop: 2218 = 2.2 in) */
    diameterMm?: number;
}

export type VideoKind = 'dji-o4-pro' | 'dji-o3' | 'analog';

export interface VideoSpec extends Sourced {
    kind: VideoKind;
    /** the unit (digital) or the camera (analog) as the maker names it */
    name: string;
    /** analog only: the transmitter */
    vtx?: string;
    /** the transmitter's basis when it differs from the camera's (the racer's camera is not named, its VTX is) */
    vtxBasis?: Basis;
    /** the camera mount's tilt range, degrees */
    tilt?: readonly [number, number];
    /** the unit records video itself (a DJI Air Unit does: it is not an extra camera) */
    records: boolean;
}

export interface Equipment {
    family: Family;
    frame: FrameSpec;
    motor: MotorSpec;
    prop: PropSpec;
    battery: Sourced & { connector: Connector; mount: 'top' | 'bottom' };
    video: VideoSpec;
    antennas: number;
    /** the pilot may choose the camera load (the cinelifter only; payloads.ts) */
    payload?: boolean;
}

const BETA = {
    pavo20: 'https://betafpv.com/products/pavo20-pro-brushless-whoop-quadcopter',
    pavo20ii: 'https://betafpv.com/products/pavo20-pro-ii-brushless-whoop-quadcopter',
    pico: 'https://betafpv.com/products/pavo-pico-brushless-whoop-quadcopter',
    air65: 'https://betafpv.com/products/air65-brushless-whoop-quadcopter',
    meteor: 'https://www.getfpv.com/drone-brands/betafpv/betafpv-meteor65-pro-brushless-whoop-quadcopter-2022.html'
};
const IFLIGHT = {
    evoque: 'https://shop.iflight.com/Nazgul-Evoque-F5-V3-O4-6S-HD-Pro2397',
    mach: 'https://fpv24.com/en/iflight/iflight-mach-r5-sport-6s-race-drone-copter-fpv-pnp',
    taurus: 'https://shop.iflight.com/Taurus-X8-V3-O3-HD-Cinelifter-BNF-Pro1973',
    xing2207: 'https://www.getfpv.com/iflight-xing2-2207-motor-w-logos-1750kv.html',
    xing3110: 'https://rcdrone.top/pl/products/iflight-xing2-3110-fpv-motor'
};

const pavo20Pro = (name: string, ref: string, motor: string): Equipment => ({
    family: 'cinewhoop',
    frame: { name, geometry: 'x', materials: ['pa12', 'carbon'], basis: 'maker', ref },
    motor: { name: motor, stator: [11, 4], basis: 'maker', ref },
    prop: { name: 'Gemfan 2218', blades: 3, pitchRatio: 0.8, diameterMm: 55.9, basis: 'maker', ref },
    battery: { connector: 'XT30', mount: 'top', basis: 'maker', ref },
    video: { kind: 'dji-o4-pro', name: 'DJI O4 Air Unit Pro', tilt: [0, 40], records: true, basis: 'maker', ref },
    antennas: 1
});

/** Keyed by preset id (packages/sim-core/presets); a test keeps the keys equal to DRONE_IDS. */
export const EQUIPMENT: Readonly<Record<string, Equipment>> = {
    'pavo20pro-3s': pavo20Pro('Pavo20 Pro', BETA.pavo20, 'LAVA 1104'),
    'pavo20pro2-3s': { ...pavo20Pro('Pavo20 Pro II', BETA.pavo20ii, 'LAVA 1104'), prop: { name: 'Gemfan D2.2', blades: 3, pitchRatio: 0.8, diameterMm: 55.9, basis: 'maker', ref: BETA.pavo20ii } },
    'pavo20pro2-4s': { ...pavo20Pro('Pavo20 Pro II', BETA.pavo20ii, 'LAVA 1104'), prop: { name: 'Gemfan D2.2', blades: 3, pitchRatio: 0.8, diameterMm: 55.9, basis: 'maker', ref: BETA.pavo20ii } },
    'pavopico-2s': {
        family: 'cinewhoop',
        frame: { name: 'Pavo Pico', geometry: 'x', materials: ['pa12', 'carbon'], basis: 'maker', ref: BETA.pico },
        motor: { name: '1102', stator: [11, 2], basis: 'maker', ref: BETA.pico },
        prop: { name: 'Gemfan 45 mm', blades: 3, pitchRatio: 0.8, diameterMm: 45, basis: 'maker', ref: BETA.pico },
        battery: { connector: 'XT30', mount: 'top', basis: 'typical' },
        video: { kind: 'dji-o3', name: 'DJI O3 Air Unit', tilt: [0, 30], records: true, basis: 'maker', ref: BETA.pico },
        antennas: 1
    },
    'meteor65pro-1s': {
        family: 'tiny-whoop',
        frame: { name: 'Meteor65 Pro', geometry: 'x', materials: ['plastic'], basis: 'listing', ref: BETA.meteor },
        motor: { name: '0802SE', stator: [8, 2], basis: 'listing', ref: BETA.meteor },
        prop: { name: '35 mm', blades: 3, pitchRatio: 0.8, diameterMm: 35, basis: 'listing', ref: BETA.meteor },
        battery: { connector: 'BT2.0', mount: 'bottom', basis: 'listing', ref: BETA.meteor },
        video: { kind: 'analog', name: 'C03', vtx: 'M03 25-350 mW', tilt: [20, 30], records: false, basis: 'listing', ref: BETA.meteor },
        antennas: 1
    },
    'air65-1s': {
        family: 'tiny-whoop',
        frame: { name: 'Air65', geometry: 'x', materials: ['plastic'], basis: 'maker', ref: BETA.air65 },
        motor: { name: '0702SE II', stator: [7, 2], basis: 'maker', ref: BETA.air65 },
        prop: { name: 'HQ 31 mm Ultralight', blades: 3, pitchRatio: 0.8, diameterMm: 31, basis: 'maker', ref: BETA.air65 },
        battery: { connector: 'BT2.0', mount: 'bottom', basis: 'maker', ref: BETA.air65 },
        video: { kind: 'analog', name: 'C03', vtx: '5.8G 25-400 mW', tilt: [25, 50], records: false, basis: 'maker', ref: BETA.air65 },
        antennas: 1
    },
    'nazgulf5v3-6s': {
        family: 'open-x',
        frame: { name: 'Nazgul Evoque F5 V3', geometry: 'x', materials: ['plastic', 'carbon'], style: 'freestyle', basis: 'maker', ref: IFLIGHT.evoque },
        motor: { name: 'XING2 2207', stator: [22, 7], can: [29, 19.25], canBasis: 'listing', basis: 'maker', ref: IFLIGHT.xing2207 },
        prop: { name: 'Nazgul F5 5.1 x 3.5', blades: 3, pitchRatio: 3.5 / 5.1, basis: 'maker', ref: IFLIGHT.evoque },
        battery: { connector: 'XT60', mount: 'top', basis: 'typical' },
        video: { kind: 'dji-o4-pro', name: 'DJI O4 Air Unit Pro', tilt: [10, 45], records: true, basis: 'maker', ref: IFLIGHT.evoque },
        antennas: 2
    },
    'machr5sport-6s': {
        family: 'open-x',
        frame: { name: 'Mach R5 Sport', geometry: 'x', materials: ['carbon', 'tpu'], style: 'racer', basis: 'maker', ref: IFLIGHT.mach },
        motor: { name: 'R5 2207', stator: [22, 7], basis: 'maker', ref: IFLIGHT.mach },
        prop: { name: 'Nazgul R5 V2 5.1 x 3.8', blades: 3, pitchRatio: 3.8 / 5.1, basis: 'maker', ref: IFLIGHT.mach },
        battery: { connector: 'XT60', mount: 'top', basis: 'typical' },
        video: { kind: 'analog', name: 'FPV camera (model not named)', vtx: 'BLITZ Force VTX 600 mW', tilt: [30, 40], records: false, basis: 'typical', vtxBasis: 'maker', ref: IFLIGHT.mach },
        antennas: 1
    },
    'taurusx8-komodo-6s': {
        family: 'x8',
        frame: { name: 'Taurus X8 V3', geometry: 'x', materials: ['carbon', 'aluminium', 'tpu'], basis: 'maker', ref: IFLIGHT.taurus },
        motor: { name: 'XING2 3110', stator: [31, 10], can: [38.72, 24.6], canBasis: 'listing', basis: 'maker', ref: IFLIGHT.xing3110 },
        prop: { name: 'HQ 8x4x3', blades: 3, pitchRatio: 0.5, basis: 'maker', ref: IFLIGHT.taurus },
        battery: { connector: 'XT90', mount: 'top', basis: 'maker', ref: IFLIGHT.taurus },
        video: { kind: 'dji-o4-pro', name: 'DJI O4 Air Unit Pro', tilt: [5, 35], records: true, basis: 'maker', ref: IFLIGHT.taurus },
        antennas: 2,
        payload: true
    }
};

/** Stator plus the usual margin for a motor whose can size is not published (a bell is about 1.5 mm wider and a shaft base adds height). */
export function canSize(m: MotorSpec): readonly [number, number] {
    if (m.can) return m.can;
    const [d, h] = m.stator;
    return [d + (d >= 20 ? 6 : 1.6), h + (d >= 20 ? 12 : 5)];
}
