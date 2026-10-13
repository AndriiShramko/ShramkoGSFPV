// Which wind a flight flies in (v0.7 lane E, the owner's item 10; docs/wip/v07-e.md section 6): the
// pilot's wind.mode over the scene's catalogue entry (its `wind` and `compassDeg`), the live wind of
// the place (lane A's GET /api/wind/<sceneId>?mode=now), and the pilot's own numbers for this scan.
// No DOM: fetch is injected, so tools/bench/test/wind-ceiling-app.test.ts runs it in Node. The session
// turns the result into sim-core's WindConfig (it adds the gust seed and the ground's height).
import type { CatalogScene } from '@gsfpv/scenes';
import type { PrefsStore } from '@gsfpv/prefs';

export type WindMode = 'off' | 'scene' | 'now' | 'custom';
export type WindSource = 'scene' | 'now' | 'custom';

/** The catalogue's (and sim-core's) ranges: compass degrees, mean m/s, gust amplitude m/s. */
const SPEED_MAX = 30;
const GUST_MAX = 20;

/** The wind a flight flies in, before the session adds its seed and ground. */
export interface WindSpec {
    /** compass bearing the wind blows FROM, deg 0..360 */
    fromDeg: number;
    /** mean at 10 m above the ground, m/s */
    speed: number;
    /** gust amplitude around the mean, m/s */
    gust: number;
    /** the scene's compass heading of its forward axis; 0 when it has none (its forward counts as north) */
    compassDeg: number;
    /** the scene has a compass heading (the HUD shows N only then) */
    hasCompass: boolean;
    source: WindSource;
    /** when the live wind was measured (ISO time), source 'now' only */
    at?: string;
}

/** Lane A's answer for a scene with a location: the wind there now. */
export interface LiveWind {
    fromDeg: number;
    speed: number;
    gust: number;
    at: string;
}

/**
 * What the pilot is told about the choice: the live wind could not be had (no location, no answer),
 * so the scan's own wind, or none, flies instead.
 */
export type WindNote = 'now-fallback-scene' | 'now-none' | null;

export interface WindChoice {
    mode: WindMode;
    /** null: still air (wind off, or no wind to be had) */
    spec: WindSpec | null;
    note: WindNote;
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** wind.mode as stored, or 'scene' (the default) for anything else. */
export function windMode(v: unknown): WindMode {
    return v === 'off' || v === 'scene' || v === 'now' || v === 'custom' ? v : 'scene';
}

function spec(w: { fromDeg: number; speed: number; gust: number }, scene: Pick<CatalogScene, 'compassDeg'> | undefined, source: WindSource, at?: string): WindSpec | null {
    const speed = clamp(w.speed, 0, SPEED_MAX), gust = clamp(w.gust, 0, GUST_MAX);
    if (speed === 0 && gust === 0) return null; // still air flies as no wind at all
    const compass = scene?.compassDeg;
    const out: WindSpec = { fromDeg: clamp(w.fromDeg, 0, 360), speed, gust, compassDeg: finite(compass) ? clamp(compass, 0, 360) : 0, hasCompass: finite(compass), source };
    if (at !== undefined) out.at = at;
    return out;
}

/**
 * The wind for `mode`: off -> none; scene -> the scan's catalogue wind (none without one); now -> the
 * live wind, else the scan's own (note 'now-fallback-scene'), else none ('now-none'); custom -> the
 * pilot's numbers for this scan. Still air (0 m/s, no gusts) is none.
 */
export function chooseWind(mode: WindMode, scene: Pick<CatalogScene, 'wind' | 'compassDeg'> | undefined, custom: { fromDeg: number; speed: number; gust: number }, live: LiveWind | null): WindChoice {
    const own = scene?.wind ? spec(scene.wind, scene, 'scene') : null;
    switch (mode) {
        case 'off':
            return { mode, spec: null, note: null };
        case 'scene':
            return { mode, spec: own, note: null };
        case 'now':
            if (live) return { mode, spec: spec(live, scene, 'now', live.at), note: null };
            return { mode, spec: own, note: own ? 'now-fallback-scene' : 'now-none' };
        case 'custom':
            return { mode, spec: spec(custom, scene, 'custom'), note: null };
    }
}

/** Lane A's answer read strictly: {"ok": true, "fromDeg", "speed", "gust", "at", "source": "now"}; null otherwise. */
export function parseLiveWind(j: unknown): LiveWind | null {
    if (!j || typeof j !== 'object') return null;
    const o = j as Record<string, unknown>;
    if (o.ok !== true || o.source !== 'now' || typeof o.at !== 'string') return null;
    if (!finite(o.fromDeg) || !finite(o.speed) || !finite(o.gust)) return null;
    if (o.fromDeg < 0 || o.fromDeg > 360 || o.speed < 0 || o.speed > SPEED_MAX || o.gust < 0 || o.gust > GUST_MAX) return null;
    return { fromDeg: o.fromDeg, speed: o.speed, gust: o.gust, at: o.at.slice(0, 40) };
}

const SCENE_ID = /^[0-9a-f]{6,32}$/;

/** How long a flight start waits for the live wind before it flies the scan's own, ms. */
export const LIVE_WIND_TIMEOUT_MS = 4000;

/**
 * The live wind at the scan's place, or null (no location: 404; no answer in time; anything else).
 * `fetchFn`: the page's fetch (tests pass a fake).
 */
export async function fetchLiveWind(sceneId: string, fetchFn: typeof fetch, timeoutMs = LIVE_WIND_TIMEOUT_MS): Promise<LiveWind | null> {
    if (!SCENE_ID.test(sceneId)) return null;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
        const r = await fetchFn(`/api/wind/${sceneId}?mode=now`, { signal: ctl.signal, headers: { Accept: 'application/json' } });
        if (!r.ok) return null;
        return parseLiveWind(await r.json());
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

/** The pilot's own wind for this scan (prefs wind.fromDeg / speed / gust). */
export function customWind(prefs: Pick<PrefsStore, 'get'>, scene: string): { fromDeg: number; speed: number; gust: number } {
    const ctx = { scene };
    return { fromDeg: prefs.get<number>('wind.fromDeg', ctx), speed: prefs.get<number>('wind.speed', ctx), gust: prefs.get<number>('wind.gust', ctx) };
}

/**
 * The wind `sceneId` starts with, from the store: none, the scan's own (catalogue), the live one at
 * its place (lane A's /api/wind; the scan's own when there is none), or the pilot's. The flight shell
 * and the scene host pass the promise to FlightSession.start, so the request runs while the scan loads.
 */
export async function windFor(prefs: Pick<PrefsStore, 'get'>, sceneId: string, meta: Pick<CatalogScene, 'wind' | 'compassDeg'> | undefined, fetchFn: typeof fetch | null = typeof fetch === 'function' ? fetch.bind(globalThis) : null): Promise<WindSpec | null> {
    let mode: WindMode;
    try {
        mode = windMode(prefs.get('wind.mode'));
    } catch {
        return null;
    }
    const live = mode === 'now' && fetchFn ? await fetchLiveWind(sceneId, fetchFn) : null;
    return chooseWind(mode, meta, customWind(prefs, sceneId), live).spec;
}
