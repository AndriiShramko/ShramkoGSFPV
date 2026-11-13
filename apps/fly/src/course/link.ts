// The course as a link (train 1, lane tracks, T2): `&course=g1.<seed in base 36>`. The deterministic generator rebuilds
// the same course from the seed on the same walls; on other walls it builds another one (or none), and the page says so.
// The local best lap per track id, version and drone lives in localStorage (one small JSON object).

const PARAM = 'course';
const RE = /^g1\.([0-9a-z]{1,7})$/;

/** The seed a link names, or null. */
export function seedOfLink(search: string): number | null {
    const v = new URLSearchParams(search).get(PARAM);
    const m = v === null ? null : RE.exec(v);
    if (!m) return null;
    const seed = parseInt(m[1]!, 36);
    return Number.isFinite(seed) && seed >= 0 && seed <= 0xffffffff ? seed : null;
}

/** The address with `course=<id>` (or without it for null). */
export function withCourse(href: string, id: string | null): string {
    const u = new URL(href);
    if (id === null) u.searchParams.delete(PARAM);
    else u.searchParams.set(PARAM, id);
    return u.toString();
}

const BEST_KEY = 'gsfpv.course.best';

export const bestKey = (id: string, version: number, drone: string): string => `${id}.v${version}.${drone}`;

function bests(): Record<string, number> {
    try {
        const raw = globalThis.localStorage?.getItem(BEST_KEY);
        const v: unknown = raw ? JSON.parse(raw) : {};
        return v && typeof v === 'object' ? (v as Record<string, number>) : {};
    } catch {
        return {};
    }
}

export function readBest(key: string): number | null {
    const v = bests()[key];
    return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

export function writeBest(key: string, ms: number): void {
    try {
        const all = bests();
        all[key] = Math.round(ms);
        globalThis.localStorage?.setItem(BEST_KEY, JSON.stringify(all));
    } catch {
        // a full or blocked storage keeps the best for this tab only
    }
}
