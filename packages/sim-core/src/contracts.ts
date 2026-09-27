// v0.3 contracts (docs/architecture-v03.md B.1, C.2-C.9): the types and tiny pure helpers the
// wave-1 owners of sim.ts, params.ts, runner.ts, history.ts and director.ts code against in
// parallel. The lead owns this file; an owner who needs a change asks rather than forks a copy.

import type { ParamOverrides, PresetJson } from './params';

// ---------------------------------------------------------------- flight modes (B.1)

export type FlightMode = 'acro' | 'angle' | 'horizon';

/**
 * The value the page writes to ch[5] for each mode. The mode is an input channel, so it is in the
 * log and replays exactly. Acro stays at -1, which is what v0.2's keyboard and radio mapping send
 * for "not angle".
 */
export const MODE_CHANNEL: Readonly<Record<FlightMode, number>> = { acro: -1, horizon: 0, angle: 1 };

/** Thresholds halfway between the MODE_CHANNEL values, so a noisy switch still reads one mode. */
export function modeFromChannel(v: number): FlightMode {
    return v > 0.5 ? 'angle' : v > -0.5 ? 'horizon' : 'acro';
}

/**
 * Self-level tuning (Betaflight 4.5.1 pidLevel(), from formulas). ParamOverrides gains
 * `level?: Partial<LevelParams>` (params.ts). The two strengths use Betaflight's own units, so a
 * Betaflight diff and the settings map to them one to one.
 */
export interface LevelParams {
    /** angle limit, deg (Betaflight angle_limit; v0.3 default 60, v0.2 used 55) */
    limitDeg: number;
    /** Betaflight angle strength, 0-200 (default 50): rate setpoint = (target - current) x gain / 10 */
    gain: number;
    /** angle feed-forward multiplier on d(target)/dt (0.5) */
    ffGain: number;
    /** PT3 smoothing of the angle feed-forward, ms (80) */
    ffSmoothMs: number;
    /** Betaflight horizon strength, 0-200 (default 75); the level share is scaled by it / 100 */
    horizonStrength: number;
    /** stick deflection, as a fraction of full stick, where horizon stops levelling (0.75) */
    horizonLimitSticks: number;
    /** inclination, deg, where horizon stops levelling (135) */
    horizonLimitDeg: number;
    /** PT1 that delays rises of the horizon level share, ms (500) */
    horizonDelayMs: number;
}

// ---------------------------------------------------------------- respawns (C.4, C.6, C.8)

/** Why a life started. A respawn record in the log carries it as a code (C.9). */
export type RespawnReason = 'crash' | 'stuck-flipped' | 'stuck-wedged' | 'manual-start' | 'manual-rewind' | 'settings' | 'scene' | 'world';

/** Options of Sim.reset / Sim.respawn / Runner.respawn. Every field is logged, so replays stay exact. */
export interface RespawnOpts {
    /** start on the invisible one-way platform (C.2) */
    platform?: boolean;
    /** platform radius, m (0.4 when omitted) */
    platformR?: number;
    /** respawn armed if the last applied arm channel is on (C.3) */
    keepArmed?: boolean;
    /** battery state of charge 0-1; undefined keeps the current pack (C.8) */
    soc?: number;
}

// ---------------------------------------------------------------- logs and lives (C.9, E.7)

/** A scene-transform record (log kind 2): T(w) = s * w + t, plus the floater filter. */
export interface WorldEvent {
    s: number;
    t: [number, number, number];
    floaterMinBlocks: number;
}

/**
 * Header of one life in format gsfpv-input-log/2. A life is self-contained: the replay compiles
 * its params from this header (presetSha256 + overrides), never from the session (D-g).
 */
export interface LifeHeader {
    format: 'gsfpv-input-log/2';
    simCore: string;
    preset: string;
    presetSha256: string;
    /** embedded in saved files, so a log survives later preset edits */
    presetJson?: PresetJson;
    /** JSON-safe; camera fields no longer belong here (D-h) */
    overrides: ParamOverrides;
    /** sha256(canonical { presetSha256, overrides, simCore }) */
    configHash: string;
    /** hash of the collision file's original bytes */
    collisionSha256: string | null;
    /** transform = [s, tx, ty, tz] at the start of the life */
    scene: { id: string; version: number; transform: [number, number, number, number]; floaterMinBlocks: number } | null;
    /** at = [x, y, z, yawDeg]; ch = the last applied channels; the tick continues across lives */
    life: { index: number; startTick: number; at: [number, number, number, number]; opts: RespawnOpts; soc: number; ch: number[]; reason: RespawnReason | 'start' };
    seed: 0;
}
