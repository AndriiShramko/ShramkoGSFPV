// The look of every part, as data (v0.9 lane D): physically based values for the materials a drone is made of
// (carbon fibre, anodised and bare aluminium, rubber, PA12 / TPU / ABS plastic, lens glass, circuit board, LiPo
// wrap). studio.ts turns each into a pc.StandardMaterial; nothing here touches the engine, so a test can check
// that every part names a material that exists. Colours are linear-ish sRGB triplets 0..1. Finishes are stylised:
// no maker's livery or logo is reproduced.

export type MaterialId =
    | 'carbon' | 'alu-black' | 'alu-silver' | 'accent' | 'rubber' | 'pa12' | 'tpu' | 'plastic' | 'glass' | 'pcb'
    | 'lipo' | 'label' | 'connector' | 'wire-red' | 'wire-black' | 'copper' | 'prop' | 'screen' | 'cine-body' | 'led';

export interface MaterialSpec {
    color: readonly [number, number, number];
    /** 0 = dielectric (plastic, rubber, glass), 1 = metal */
    metal: number;
    /** 0 = rough, 1 = mirror */
    gloss: number;
    /** clear lacquer layer on top (carbon fibre, glass) */
    clearcoat?: number;
    /** a procedural surface: the weave of carbon fibre, the fine lines of brushed metal */
    texture?: 'carbon' | 'brushed';
    /** texture repeats per 20 mm of surface */
    tiling?: number;
    emissive?: readonly [number, number, number];
}

export const MATERIALS: Readonly<Record<MaterialId, MaterialSpec>> = {
    carbon: { color: [0.16, 0.165, 0.175], metal: 0, gloss: 0.78, clearcoat: 1, texture: 'carbon', tiling: 3 },
    'alu-black': { color: [0.055, 0.057, 0.062], metal: 1, gloss: 0.62, texture: 'brushed', tiling: 1 },
    'alu-silver': { color: [0.82, 0.83, 0.85], metal: 1, gloss: 0.72, texture: 'brushed', tiling: 1 },
    // the colour of the anodised bells, standoffs and rings: set per drone from Model.accent
    accent: { color: [0.2, 0.35, 0.8], metal: 1, gloss: 0.78 },
    rubber: { color: [0.025, 0.025, 0.028], metal: 0, gloss: 0.22 },
    pa12: { color: [0.075, 0.078, 0.085], metal: 0, gloss: 0.42 },
    tpu: { color: [0.05, 0.052, 0.058], metal: 0, gloss: 0.34 },
    plastic: { color: [0.11, 0.115, 0.125], metal: 0, gloss: 0.5 },
    glass: { color: [0.004, 0.006, 0.012], metal: 0, gloss: 0.99, clearcoat: 1 },
    pcb: { color: [0.02, 0.075, 0.05], metal: 0, gloss: 0.6 },
    lipo: { color: [0.035, 0.05, 0.095], metal: 0, gloss: 0.5 },
    label: { color: [0.62, 0.64, 0.68], metal: 0, gloss: 0.3 },
    connector: { color: [0.82, 0.58, 0.04], metal: 0, gloss: 0.5 },
    'wire-red': { color: [0.55, 0.02, 0.02], metal: 0, gloss: 0.45 },
    'wire-black': { color: [0.03, 0.03, 0.035], metal: 0, gloss: 0.45 },
    copper: { color: [0.86, 0.46, 0.3], metal: 1, gloss: 0.7 },
    prop: { color: [0.09, 0.095, 0.105], metal: 0, gloss: 0.6, clearcoat: 0.6 },
    screen: { color: [0.008, 0.01, 0.014], metal: 0, gloss: 0.95, clearcoat: 1, emissive: [0.012, 0.016, 0.026] },
    'cine-body': { color: [0.075, 0.077, 0.082], metal: 1, gloss: 0.5, texture: 'brushed', tiling: 1 },
    led: { color: [0.05, 0.05, 0.05], metal: 0, gloss: 0.5, emissive: [0.9, 0.95, 1] }
};

export const MATERIAL_IDS = Object.keys(MATERIALS) as MaterialId[];
