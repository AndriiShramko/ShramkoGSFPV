// The wind of the place (v0.7, the owner's item 10; docs/wip/v07-e.md): a mean wind from a weather
// report's numbers, turned into the scene frame by the scene's compass heading, gusts from seeded
// deterministic noise, and a wind gradient with height above the ground. The flight model feels it as
// drag on the airspeed (sim.ts: velocity minus wind, through the existing drag terms).
//
// Frames. The scene frame is the flown world: +Y up, heading 0 = the scene's forward axis -z, heading
// grows turning right (clockwise seen from above), so heading psi points along (sin psi, 0, -cos psi)
// (sim.ts attitude().yaw). compassDeg is the compass bearing of heading 0: bearing B is scene heading
// B - compassDeg. fromDeg is where the wind comes FROM (the weather-report convention): the mean
// wind blows toward fromDeg + 180.
//
// Units. Wind is the drone's air: real m/s around the real-size drone, never scaled with the scene
// (E.7 scales the scene around the drone; physics stays in metres). Heights above the ground are flown
// metres; the ground is a height in the scan's own coordinates (groundM), so it follows the scene
// transform (Sim.setSceneFrame).
//
// Determinism. Only + - * /, Math.sqrt, Math.floor, Math.imul and dmath (no Math.sin, no clock, no
// Math.random). The gusts are a pure function of (seed, axis, tick): no state, so every frame split,
// a rewind, and a replay from a trimmed life's snapshot see the same gusts, and the hashed state of
// the model is unchanged (a model without wind hashes exactly as before).

import { dcos, dsin, DEG2RAD } from './dmath';

/** Height above the ground the mean wind and the gusts are given at, m (weather reports: 10 m). */
export const WIND_REF_HEIGHT_M = 10;
/** The gradient's clamp: below this the wind no longer weakens (x0.69 of the 10 m wind), m. */
export const WIND_MIN_HEIGHT_M = 0.5;
/** ... and above this it no longer grows (x1.45), m. */
export const WIND_MAX_HEIGHT_M = 200;
/** The catalogue's ranges (packages/scenes catalog.ts readWind): mean speed and gust amplitude, m/s. */
export const WIND_SPEED_MAX = 30;
export const WIND_GUST_MAX = 20;
/** Gust amplitudes across the wind and vertical, as a share of the along-wind one [estimate]. */
export const GUST_CROSS = 0.6;
export const GUST_VERTICAL = 0.3;
/**
 * The gust noise: knots every `ticks` (1 kHz ticks), weights summing to 1. Large slow swells, the
 * gusts a pilot fights, and a little chop [estimate; Dryden's low-altitude length scale ~70 m passes
 * a hovering craft in ~15 s at 5 m/s, the shorter ones are what a small drone feels].
 */
export const GUST_OCTAVES: readonly { ticks: number; weight: number }[] = [
    { ticks: 4000, weight: 0.55 },
    { ticks: 1300, weight: 0.3 },
    { ticks: 400, weight: 0.15 }
];
/** The largest seed (seeds are integers 0..2^31-1, so a log's JSON holds them exactly). */
export const WIND_SEED_MAX = 0x7fffffff;

/**
 * The wind a flight model flies in: ParamOverrides.wind, so it is in every life header and its
 * configHash, and a replay rebuilds the same wind from the log alone.
 */
export interface WindConfig {
    /** compass bearing the wind blows FROM, deg (0 north, 90 east, clockwise), 0..360 */
    fromDeg: number;
    /** mean speed at WIND_REF_HEIGHT_M above the ground, m/s, 0..WIND_SPEED_MAX */
    speed: number;
    /** amplitude of the gusts around the mean (the along-wind peak is speed + gust), m/s, 0..WIND_GUST_MAX */
    gust: number;
    /** compass bearing of the scene's heading 0 (-z); 0 when the scene has none (its forward counts as north) */
    compassDeg: number;
    /** the gust noise's seed, an integer 0..WIND_SEED_MAX (the page picks one per flight) */
    seed: number;
    /** the ground the gradient measures from: a height in the scan's own coordinates (scale 1, up axis), m */
    groundM: number;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Why `w` is not a WindConfig the model can fly, or null. */
export function windProblem(w: unknown): string | null {
    if (!w || typeof w !== 'object' || Array.isArray(w)) return 'wind must be an object';
    const o = w as Record<string, unknown>;
    const range = (k: string, lo: number, hi: number): string | null => (finite(o[k]) && (o[k] as number) >= lo && (o[k] as number) <= hi ? null : `wind.${k} must be a number ${lo}..${hi}, got ${String(o[k])}`);
    return range('fromDeg', 0, 360) ?? range('speed', 0, WIND_SPEED_MAX) ?? range('gust', 0, WIND_GUST_MAX) ?? range('compassDeg', 0, 360)
        ?? (Number.isInteger(o.seed) && (o.seed as number) >= 0 && (o.seed as number) <= WIND_SEED_MAX ? null : `wind.seed must be an integer 0..${WIND_SEED_MAX}, got ${String(o.seed)}`)
        ?? range('groundM', -100000, 100000);
}

/** The unit vector [x, z] of the scene frame a compass bearing points along. */
export function bearingToScene(bearingDeg: number, compassDeg: number): [number, number] {
    const psi = (bearingDeg - compassDeg) * DEG2RAD;
    return [dsin(psi), -dcos(psi)];
}

/**
 * The wind gradient: the wind at height h (m above the ground) over the wind at 10 m. A power law
 * with the Hellmann exponent 1/8 (neutral air over open terrain; three square roots, so the step needs
 * no log or pow), h clamped to WIND_MIN_HEIGHT_M..WIND_MAX_HEIGHT_M.
 */
export function windProfile(h: number): number {
    const c = h < WIND_MIN_HEIGHT_M ? WIND_MIN_HEIGHT_M : h > WIND_MAX_HEIGHT_M ? WIND_MAX_HEIGHT_M : h;
    return Math.sqrt(Math.sqrt(Math.sqrt(c / WIND_REF_HEIGHT_M)));
}

/** murmur3's 32-bit finaliser: an unsigned 32-bit integer from one. */
function mix32(x: number): number {
    x ^= x >>> 16;
    x = Math.imul(x, 0x85ebca6b);
    x ^= x >>> 13;
    x = Math.imul(x, 0xc2b2ae35);
    x ^= x >>> 16;
    return x >>> 0;
}

/** The noise value at knot k of stream `stream`, uniform in [-1, 1]. */
function knot(seed: number, stream: number, k: number): number {
    const a = mix32((seed ^ Math.imul(stream + 1, 0x9e3779b9)) >>> 0);
    const b = mix32((a ^ Math.imul(k | 0, 0x27d4eb2f)) >>> 0);
    return b * (2 / 4294967295) - 1;
}

/**
 * One octave of the same noise: seeded knots every `periodTicks` ticks, Catmull-Rom between them, in
 * about [-1, 1] (a spline may overshoot a knot a little; the caller scales it). A pure function of
 * its arguments, for any deterministic disturbance of the model (wake.ts: the turbulence of prop wash).
 */
export function smoothNoise(seed: number, stream: number, tick: number, periodTicks: number): number {
    const k = Math.floor(tick / periodTicks);
    const f = (tick - k * periodTicks) / periodTicks;
    const p0 = knot(seed, stream, k - 1), p1 = knot(seed, stream, k), p2 = knot(seed, stream, k + 1), p3 = knot(seed, stream, k + 2);
    return p1 + 0.5 * f * (p2 - p0 + f * (2 * p0 - 5 * p1 + 4 * p2 - p3 + f * (3 * (p1 - p2) + p3 - p0)));
}

/**
 * Gust noise of one axis (0 along the wind, 1 across, 2 vertical) at a tick, in [-1, 1]: knots of
 * seeded hash values, Catmull-Rom between them (smooth, no corners), three octaves (GUST_OCTAVES).
 * A pure function of its arguments.
 */
export function gustNoise(seed: number, axis: number, tick: number): number {
    let n = 0;
    for (let o = 0; o < GUST_OCTAVES.length; o++) {
        const P = GUST_OCTAVES[o].ticks;
        const k = Math.floor(tick / P);
        const f = (tick - k * P) / P;
        const stream = axis * GUST_OCTAVES.length + o;
        const p0 = knot(seed, stream, k - 1), p1 = knot(seed, stream, k), p2 = knot(seed, stream, k + 1), p3 = knot(seed, stream, k + 2);
        const cr = p1 + 0.5 * f * (p2 - p0 + f * (2 * p0 - 5 * p1 + 4 * p2 - p3 + f * (3 * (p1 - p2) + p3 - p0)));
        n += GUST_OCTAVES[o].weight * cr;
    }
    return n < -1 ? -1 : n > 1 ? 1 : n;
}

/**
 * A WindConfig compiled for the step: the downwind and cross-wind unit vectors once, then the wind
 * at any tick and height. Still air (speed and gust 0) never becomes a field (compileWind gives null).
 */
export class WindField {
    readonly cfg: Readonly<WindConfig>;
    /** where the mean wind blows to, scene frame (x, z) */
    readonly dx: number;
    readonly dz: number;
    /** to the right of it, looking downwind */
    readonly cx: number;
    readonly cz: number;

    constructor(cfg: WindConfig) {
        const p = windProblem(cfg);
        if (p) throw new RangeError(p);
        this.cfg = { ...cfg };
        const [x, z] = bearingToScene(cfg.fromDeg + 180, cfg.compassDeg);
        this.dx = x;
        this.dz = z;
        this.cx = -z;
        this.cz = x;
    }

    /** the ground height in the scan's own coordinates (WindConfig.groundM) */
    get groundM(): number {
        return this.cfg.groundM;
    }

    /**
     * The wind at `tick` and `h` metres above the ground, written to out[0..2] (world frame, m/s):
     * the along-wind speed (never blowing back) and the gusts across and up, all times the gradient.
     */
    at(tick: number, h: number, out: Float64Array | number[]): void {
        const c = this.cfg;
        const g = windProfile(h);
        let along = c.speed;
        let cross = 0, up = 0;
        if (c.gust > 0) {
            along += c.gust * gustNoise(c.seed, 0, tick);
            cross = GUST_CROSS * c.gust * gustNoise(c.seed, 1, tick);
            up = GUST_VERTICAL * c.gust * gustNoise(c.seed, 2, tick);
        }
        if (along < 0) along = 0;
        out[0] = g * (along * this.dx + cross * this.cx);
        out[1] = g * up;
        out[2] = g * (along * this.dz + cross * this.cz);
    }
}

/** The field a config flies with: null for no config, or still air (exactly the model without wind). */
export function compileWind(w: WindConfig | undefined | null): WindField | null {
    if (w === undefined || w === null) return null;
    const f = new WindField(w);
    return w.speed === 0 && w.gust === 0 ? null : f;
}
