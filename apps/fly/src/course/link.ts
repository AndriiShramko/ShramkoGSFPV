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

/** A served course the link names: `course=<scene hex>-<8 hex>` (the server's id, tracks.py SERVER_ID; the admin's
 *  "Open in the editor", stage T4-admin), or null. */
export function serverOfLink(search: string): string | null {
    return servedOfLink(search)?.id ?? null;
}

/** The same with the version the admin's link names (`course=<id>.v<n>`, tracks-plan 2.10; review TK-5: the page loads that
 *  version directly, the scene's list holds only the first page of sort=top), version null when the link names none. */
export function servedOfLink(search: string): { id: string; version: number | null } | null {
    const v = new URLSearchParams(search).get(PARAM);
    const m = v === null ? null : /^([0-9a-f]{6,32}-[0-9a-f]{8})(?:\.v([1-9][0-9]{0,5}))?$/.exec(v);
    return m ? { id: m[1]!, version: m[2] ? Number(m[2]) : null } : null;
}

/** `edit=1`: the linked course opens in the editor once it is shown. */
export function editOfLink(search: string): boolean {
    return new URLSearchParams(search).get('edit') === '1';
}

/** The address with `course=<id>` (or without it for null). */
export function withCourse(href: string, id: string | null): string {
    const u = new URL(href);
    if (id === null) u.searchParams.delete(PARAM);
    else u.searchParams.set(PARAM, id);
    return u.toString();
}

const BEST_KEY = 'gsfpv.course.best';

/** The best lap's key: the track, the scene and the walls it was laid on (lane review TR-10: a link's seed on another
 *  scene, scale or walls is another course, so the walls' digest and the transform go into the key), and the drone. */
export function bestKey(
    tr: { readonly id: string; readonly version: number; readonly scene: { readonly id: string; readonly version?: number }; readonly transform?: readonly number[] | null; readonly generator?: { readonly params?: Record<string, unknown> } | null },
    drone: string
): string {
    const digest = tr.generator?.params?.['freeDigest'];
    const placed = Array.isArray(tr.transform) ? tr.transform.join(',') : '-';
    return `${tr.id}.v${tr.version}.${tr.scene.id}.${tr.scene.version ?? 0}.${typeof digest === 'string' ? digest.slice(0, 16) : '-'}.${placed}.${drone}`;
}

const OFFERED_KEY = 'gsfpv.course.offered';

/** Lane review TR-14 a: the offer of a scene's saved course is flashed once per scene and profile; true the first time. */
export function firstOffer(scene: string): boolean {
    try {
        const raw = globalThis.localStorage?.getItem(OFFERED_KEY);
        const v: unknown = raw ? JSON.parse(raw) : [];
        const seen = Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
        if (seen.includes(scene)) return false;
        // the newest 200 scenes (estimate: more than the catalogue holds)
        globalThis.localStorage?.setItem(OFFERED_KEY, JSON.stringify([...seen, scene].slice(-200)));
        return true;
    } catch {
        return true;
    }
}

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
