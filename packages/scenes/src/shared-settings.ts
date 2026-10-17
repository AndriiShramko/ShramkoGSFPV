// The scene settings a shared link carries (v0.9 lane C, item 15 of the owner's message 22): "people who
// open the link fly with the same settings". A share link is the simulator's deep link of the scene
// (/en/fly/?scene=<id>, plus lane R's &budget=<M>&stochastic for how the scene is drawn) and, after that,
// the sharer's scene settings that differ from the scene's own defaults, as compact parameters:
//
//   sz=3          Scene size x3                         0.25..100, up to 3 decimals
//   wl=0          walls off (1: on)                      0 or 1
//   fl=4          floating-wall cleanup: pieces under 4 blocks dropped   0..64 (0: the filter is off)
//   wd=270,4,2    wind from 270 deg, 4 m/s, gusts 2      off, or fromDeg 0..360, speed 0..30, gust 0..20 (1 decimal)
//   ce=12.5       collisions off above 12.5 m (scan coordinates)    off, or metres -10000..10000 (2 decimals)
//   drone=<id>    the drone preset (the simulator's own ?drone=, read by the prefs URL layer)
//
// Strict reading: every parameter on its own, a plain decimal in its range or it is ignored (the rest of
// the link still counts); anything else in the query is not ours. The sender (apps/fly share/shared.ts)
// writes only what differs from the scene's defaults; the receiver (boot.ts, builtin/shared-settings.ts)
// flies with them for that visit without touching his saved settings, until he presses Keep.
// Two writers must agree on the text: this file and apps/api/server.py shared_query (the /s/<id> page's
// link); packages/scenes/test/fixtures/fly-deep-links.json holds the table both tests read.
// Pure: no DOM, no fetch, no setting ids (the mapping to the prefs store is the fly app's).
import { CATALOG_SCALE_MAX, CATALOG_SCALE_MIN } from './catalog';

/** The wind a link carries: the sharer's own numbers (compass degrees it blows from, mean m/s, gust amplitude m/s). */
export interface SharedWind {
    fromDeg: number;
    speed: number;
    gust: number;
}

/**
 * The scene settings of a share, each present only when it differs from the scene's defaults.
 * `ceiling`: 'off' (no collision ceiling although the scene has one) or the height in scan metres.
 * `wind`: 'off' (still air although the scene has wind) or the sharer's own wind.
 */
export interface SharedSettings {
    size?: number;
    walls?: 'on' | 'off';
    floaters?: number;
    wind?: 'off' | SharedWind;
    ceiling?: 'off' | number;
    drone?: string;
}

/** The query parameter of each setting, in the order they are written. `drone` is the simulator's own parameter. */
export const SHARED_PARAMS = { size: 'sz', walls: 'wl', floaters: 'fl', wind: 'wd', ceiling: 'ce', drone: 'drone' } as const;

/** The parameters only this module reads (not `drone`, which the prefs URL layer owns): what a scene switch removes from the address. */
export const SHARED_OWN_PARAMS: readonly string[] = [SHARED_PARAMS.size, SHARED_PARAMS.walls, SHARED_PARAMS.floaters, SHARED_PARAMS.wind, SHARED_PARAMS.ceiling];

/** The ranges (also the server's, apps/api/server.py shared_settings). */
export const SHARED_LIMITS = {
    size: [CATALOG_SCALE_MIN, CATALOG_SCALE_MAX],
    floaters: [0, 64],
    fromDeg: [0, 360],
    speed: [0, 30],
    gust: [0, 20],
    ceiling: [-10000, 10000]
} as const;

/** A drone preset id as the presets name them (the prefs enum decides which exist). */
const DRONE_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
/** A plain decimal: optional minus, digits, at most one point; no exponent, hex, spaces or units. */
const DECIMAL = /^-?\d{1,6}(?:\.\d{1,6})?$/;

/** `v` as a number in [lo, hi] rounded to `places` decimals, or undefined (not a plain decimal, or out of range). */
function dec(v: unknown, lo: number, hi: number, places: number): number | undefined {
    const n = typeof v === 'string' ? (DECIMAL.test(v) ? Number(v) : NaN) : typeof v === 'number' ? v : NaN;
    if (!Number.isFinite(n) || n < lo || n > hi) return undefined;
    const r = Number(n.toFixed(places));
    return r >= lo && r <= hi ? r : undefined;
}

/** A number as a link writes it: at most `places` decimals, no trailing zeros, never an exponent. */
export function sharedNumber(n: number, places: number): string {
    return String(Number(n.toFixed(places)));
}

function windOf(v: unknown): 'off' | SharedWind | undefined {
    if (v === 'off') return 'off';
    const parts = typeof v === 'string' ? v.split(',') : null;
    if (!parts || parts.length !== 3) return undefined;
    const fromDeg = dec(parts[0], ...SHARED_LIMITS.fromDeg, 1);
    const speed = dec(parts[1], ...SHARED_LIMITS.speed, 1);
    const gust = dec(parts[2], ...SHARED_LIMITS.gust, 1);
    return fromDeg === undefined || speed === undefined || gust === undefined ? undefined : { fromDeg, speed, gust };
}

/**
 * The settings a page's query carries: `get` is URLSearchParams.get. Each parameter is read on its own
 * and an unusable one is ignored. Never throws.
 */
export function parseSharedSettings(q: { get(name: string): string | null }): SharedSettings {
    const out: SharedSettings = {};
    const size = dec(q.get(SHARED_PARAMS.size), ...SHARED_LIMITS.size, 3);
    if (size !== undefined) out.size = size;
    const walls = q.get(SHARED_PARAMS.walls);
    if (walls === '0') out.walls = 'off';
    else if (walls === '1') out.walls = 'on';
    const floaters = q.get(SHARED_PARAMS.floaters);
    if (floaters !== null && /^\d{1,2}$/.test(floaters)) {
        const n = Number(floaters);
        if (n >= SHARED_LIMITS.floaters[0] && n <= SHARED_LIMITS.floaters[1]) out.floaters = n;
    }
    const wind = windOf(q.get(SHARED_PARAMS.wind));
    if (wind !== undefined) out.wind = wind;
    const ceiling = q.get(SHARED_PARAMS.ceiling);
    if (ceiling === 'off') out.ceiling = 'off';
    else {
        const c = dec(ceiling, ...SHARED_LIMITS.ceiling, 2);
        if (c !== undefined) out.ceiling = c;
    }
    const drone = q.get(SHARED_PARAMS.drone);
    if (drone !== null && DRONE_ID.test(drone)) out.drone = drone;
    return out;
}

/**
 * The same settings from an object (the body of POST /api/share, the sender's own value), read as strictly:
 * a field of the wrong type or out of range is dropped, unknown fields are ignored, numbers are rounded to
 * what a link carries. Never throws.
 */
export function readShared(v: unknown): SharedSettings {
    const out: SharedSettings = {};
    if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
    const o = v as Record<string, unknown>;
    const size = typeof o.size === 'number' ? dec(o.size, ...SHARED_LIMITS.size, 3) : undefined;
    if (size !== undefined) out.size = size;
    if (o.walls === 'on' || o.walls === 'off') out.walls = o.walls;
    if (typeof o.floaters === 'number' && Number.isInteger(o.floaters) && o.floaters >= SHARED_LIMITS.floaters[0] && o.floaters <= SHARED_LIMITS.floaters[1]) out.floaters = o.floaters;
    if (o.wind === 'off') out.wind = 'off';
    else if (o.wind && typeof o.wind === 'object' && !Array.isArray(o.wind)) {
        const w = o.wind as Record<string, unknown>;
        const fromDeg = typeof w.fromDeg === 'number' ? dec(w.fromDeg, ...SHARED_LIMITS.fromDeg, 1) : undefined;
        const speed = typeof w.speed === 'number' ? dec(w.speed, ...SHARED_LIMITS.speed, 1) : undefined;
        const gust = typeof w.gust === 'number' ? dec(w.gust, ...SHARED_LIMITS.gust, 1) : undefined;
        if (fromDeg !== undefined && speed !== undefined && gust !== undefined) out.wind = { fromDeg, speed, gust };
    }
    if (o.ceiling === 'off') out.ceiling = 'off';
    else if (typeof o.ceiling === 'number') {
        const c = dec(o.ceiling, ...SHARED_LIMITS.ceiling, 2);
        if (c !== undefined) out.ceiling = c;
    }
    if (typeof o.drone === 'string' && DRONE_ID.test(o.drone)) out.drone = o.drone;
    return out;
}

/** Nothing to carry. */
export function isEmptyShared(s: SharedSettings): boolean {
    return Object.keys(s).length === 0;
}

/** The query text of the settings, in the fixed order, without a leading `&` or `?`; '' when there are none. */
export function sharedQuery(s: SharedSettings): string {
    const p: string[] = [];
    if (s.size !== undefined) p.push(`${SHARED_PARAMS.size}=${sharedNumber(s.size, 3)}`);
    if (s.walls !== undefined) p.push(`${SHARED_PARAMS.walls}=${s.walls === 'off' ? 0 : 1}`);
    if (s.floaters !== undefined) p.push(`${SHARED_PARAMS.floaters}=${s.floaters}`);
    if (s.wind !== undefined) p.push(`${SHARED_PARAMS.wind}=${s.wind === 'off' ? 'off' : [sharedNumber(s.wind.fromDeg, 1), sharedNumber(s.wind.speed, 1), sharedNumber(s.wind.gust, 1)].join(',')}`);
    if (s.ceiling !== undefined) p.push(`${SHARED_PARAMS.ceiling}=${s.ceiling === 'off' ? 'off' : sharedNumber(s.ceiling, 2)}`);
    if (s.drone !== undefined) p.push(`${SHARED_PARAMS.drone}=${s.drone}`);
    return p.join('&');
}

/** A fly deep link (flyDeepLink) with the settings after its own parameters. */
export function appendShared(link: string, s: SharedSettings): string {
    const q = sharedQuery(s);
    return q ? `${link}${link.includes('?') ? '&' : '?'}${q}` : link;
}

/** Takes the parameters only this module reads out of a query (a scene switch, Keep, Reset). */
export function stripSharedParams(q: URLSearchParams): void {
    for (const k of SHARED_OWN_PARAMS) q.delete(k);
}

/** Two sets of settings say the same (after rounding). */
export function sameShared(a: SharedSettings, b: SharedSettings): boolean {
    return sharedQuery(a) === sharedQuery(b);
}
