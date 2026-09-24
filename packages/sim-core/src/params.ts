// Compile a preset JSON (every field has value + source) into the flat numbers the model uses.

import type { RatesConfig, RatesType, ThrottleCurve } from './rates';

export type FieldSource = 'manufacturer' | 'estimate' | 'bf-default' | `measured:${string}`;

export interface PresetField<T = unknown> {
    value: T;
    source: FieldSource;
    ref?: string;
    note?: string;
    min?: number;
    max?: number;
}

export interface PresetJson {
    id: string;
    name: string;
    class: string;
    notes?: string;
    fields: Record<string, PresetField>;
}

export type GravityMode = 'honest' | 'same-twr' | 'auto-throttle';

export interface SimParams {
    presetId: string;
    mass: number; // kg
    inertia: [number, number, number]; // body x (pitch), y (yaw), z (roll), kg m^2
    twr: number;
    tmaxMotorNom: number; // N per motor at vNom
    vNom: number; // pack voltage under full load, fresh pack
    cells: number;
    capacityAs: number; // ampere-seconds
    rPack: number; // ohm
    eta: number;
    omegaMaxPerVolt: number; // rad/s per volt, loaded
    tau: number; // s
    kappa: number; // m
    idle: number;
    motorPos: Float64Array; // 4 x (x, y, z) body frame, m
    motorYaw: Float64Array; // +1 = CW prop (reaction yaw left, +y torque), -1 = CCW
    cda: [number, number, number]; // m^2 along body x, y, z
    spheres: Float64Array; // n x (x, y, z, r) body frame, m
    boundRadius: number; // body origin -> farthest sphere surface, m
    vBounce: number;
    vCrash: number;
    rates: RatesConfig;
    pid: { roll: number[]; pitch: number[]; yaw: number[] };
    throttle: ThrottleCurve;
    gravity: number; // m/s^2
    gravityMode: GravityMode;
    rho: number;
    cameraUptiltDeg: number;
    cameraFovDeg: number;
}

export const EARTH_G = 9.81;

export interface ParamOverrides {
    twr?: number;
    tauMs?: number;
    cdaScale?: number;
    gravity?: number;
    gravityMode?: GravityMode;
    rates?: RatesConfig;
    vCrash?: number;
    vBounce?: number;
    pid?: { roll?: number[]; pitch?: number[]; yaw?: number[] };
    uptiltDeg?: number;
    fovDeg?: number;
}

function num(p: PresetJson, key: string): number {
    const f = p.fields[key];
    if (!f || typeof f.value !== 'number') throw new Error(`preset ${p.id}: numeric field ${key} missing`);
    return f.value;
}

function voc(soc: number): number {
    // per cell, piecewise linear 4.2 / 3.7 / 3.3 V at SoC 1 / 0.5 / 0
    return soc >= 0.5 ? 3.7 + (soc - 0.5) * 1.0 : 3.3 + soc * 0.8;
}
export { voc as cellVoc };

export function compileParams(p: PresetJson, o: ParamOverrides = {}): SimParams {
    const mass = num(p, 'auw_g') / 1000;
    const twr = o.twr ?? num(p, 'twr');
    const gravity = o.gravity ?? EARTH_G;
    const gravityMode = o.gravityMode ?? 'honest';
    // thrust is defined on Earth: T_max = TWR * m * 9.81; "same TWR" rescales it with g
    let tmaxTotal = twr * mass * EARTH_G;
    if (gravityMode === 'same-twr') tmaxTotal *= gravity / EARTH_G;
    const tmaxMotorNom = tmaxTotal / 4;

    const cells = num(p, 'battery_cells');
    const capacityAs = (num(p, 'battery_capacity_mah') / 1000) * 3600;
    const rPack = num(p, 'pack_resistance_per_cell_ohm') * cells;
    const eta = num(p, 'efficiency');
    const kv = num(p, 'motor_kv');
    const rpmFrac = num(p, 'rpm_loaded_fraction');
    const omegaMaxPerVolt = kv * rpmFrac * 0.10471975511965977; // rpm -> rad/s
    const kappa = num(p, 'motor_kappa_m');

    // V_nom: loaded pack voltage at full throttle with a fresh pack (fixed point, deterministic).
    const vOc = cells * voc(1);
    let v = vOc;
    for (let i = 0; i < 60; i++) {
        const tNow = tmaxMotorNom; // at V = V_nom thrust is nominal by definition
        const omega = omegaMaxPerVolt * v;
        const current = (4 * kappa * tNow * omega) / (eta * v);
        v = vOc - current * rPack;
    }
    const vNom = v;

    const wb = num(p, 'wheelbase_mm');
    void wb;
    const off = num(p, 'collider_duct_offset_mm') / 1000;
    const ductR = num(p, 'collider_duct_radius_mm') / 1000;
    const bodyR = num(p, 'collider_body_radius_mm') / 1000;
    // motor positions follow the wheelbase diagonal
    const arm = num(p, 'wheelbase_mm') / 2000 / Math.SQRT2;
    // Betaflight quad X order: M1 rear-right, M2 front-right, M3 rear-left, M4 front-left.
    // Body frame: x right, y up, z back (forward is -z).
    const motorPos = new Float64Array([arm, 0, arm, arm, 0, -arm, -arm, 0, arm, -arm, 0, -arm]);
    // props-in default: M1 CW, M2 CCW, M3 CCW, M4 CW (seen from above)
    const motorYaw = new Float64Array([1, -1, -1, 1]);

    let spheres: Float64Array;
    if (ductR > 0) {
        spheres = new Float64Array([
            off, 0, off, ductR,
            off, 0, -off, ductR,
            -off, 0, off, ductR,
            -off, 0, -off, ductR,
            0, 0, 0, bodyR
        ]);
    } else {
        spheres = new Float64Array([0, 0, 0, bodyR]);
    }
    let boundRadius = 0;
    for (let i = 0; i < spheres.length; i += 4) {
        const d = Math.sqrt(spheres[i] * spheres[i] + spheres[i + 1] * spheres[i + 1] + spheres[i + 2] * spheres[i + 2]) + spheres[i + 3];
        if (d > boundRadius) boundRadius = d;
    }

    const rj = p.fields.rates.value as { type: RatesType; roll: number[]; pitch: number[]; yaw: number[]; rate_limit: number };
    const rates: RatesConfig = o.rates ?? {
        type: rj.type,
        roll: { rcRate: rj.roll[0], rate: rj.roll[1], expo: rj.roll[2] },
        pitch: { rcRate: rj.pitch[0], rate: rj.pitch[1], expo: rj.pitch[2] },
        yaw: { rcRate: rj.yaw[0], rate: rj.yaw[1], expo: rj.yaw[2] },
        rateLimit: rj.rate_limit
    };
    const thr = p.fields.throttle.value as { mid: number; expo: number };
    const cdaScale = o.cdaScale ?? 1;
    const cdaH = (num(p, 'cda_horizontal_cm2') / 10000) * cdaScale;
    const cdaV = (num(p, 'cda_vertical_cm2') / 10000) * cdaScale;

    const ipr = num(p, 'inertia_roll_pitch_kgm2');
    const iy = num(p, 'inertia_yaw_kgm2');

    return {
        presetId: p.id,
        mass,
        inertia: [ipr, iy, ipr],
        twr,
        tmaxMotorNom,
        vNom,
        cells,
        capacityAs,
        rPack,
        eta,
        omegaMaxPerVolt,
        tau: (o.tauMs ?? num(p, 'motor_tau_ms')) / 1000,
        kappa,
        idle: num(p, 'motor_idle'),
        motorPos,
        motorYaw,
        cda: [cdaH, cdaV, cdaH],
        spheres,
        boundRadius,
        vBounce: o.vBounce ?? num(p, 'v_bounce_ms'),
        vCrash: o.vCrash ?? num(p, 'v_crash_ms'),
        rates,
        pid: {
            roll: o.pid?.roll ?? (p.fields.pid_roll.value as number[]),
            pitch: o.pid?.pitch ?? (p.fields.pid_pitch.value as number[]),
            yaw: o.pid?.yaw ?? (p.fields.pid_yaw.value as number[])
        },
        throttle: { mid: thr.mid, expo: thr.expo },
        gravity,
        gravityMode,
        rho: 1.225,
        cameraUptiltDeg: o.uptiltDeg ?? num(p, 'camera_uptilt_deg'),
        cameraFovDeg: o.fovDeg ?? num(p, 'camera_fov_deg')
    };
}

/** Throttle stick (0..1) that hovers at nominal voltage: u = (1/sqrt(TWR_local) - idle) / (1 - idle). */
export function hoverThrottle(sp: SimParams): number {
    const twrLocal = (4 * sp.tmaxMotorNom) / (sp.mass * sp.gravity);
    if (twrLocal <= 0) return 0;
    return (1 / Math.sqrt(twrLocal) - sp.idle) / (1 - sp.idle);
}

/**
 * Hover motor output and stick including battery sag at the given state of charge
 * (fixed point of thrust -> current -> voltage). Returns NaN outputs if it cannot hover.
 */
export function hoverSolve(sp: SimParams, soc = 1): { motor: number; stick: number; volts: number } {
    const need = (sp.mass * sp.gravity) / 4; // N per motor
    const vOc = sp.cells * voc(soc);
    let v = vOc;
    let w = 0;
    for (let i = 0; i < 80; i++) {
        const tmax = sp.tmaxMotorNom * (v / sp.vNom) * (v / sp.vNom);
        w = Math.sqrt(need / tmax);
        const omega = w * sp.omegaMaxPerVolt * v;
        const current = (4 * sp.kappa * need * omega) / (sp.eta * v);
        v = vOc - current * sp.rPack;
    }
    if (!(w <= 1)) return { motor: NaN, stick: NaN, volts: v };
    return { motor: w, stick: (w - sp.idle) / (1 - sp.idle), volts: v };
}
