// The course as a link (train 1, lane tracks, T2): `&course=g1.<seed in base 36>`. The deterministic generator rebuilds
// the same course from the seed on the same walls; on other walls it builds another one (or none), and the page says so.
// The local best lap per track id, version and drone lives in localStorage (one small JSON object).
import { parseCourseLink } from '@gsfpv/tracks/request';
import type { CourseLink } from '@gsfpv/tracks/request';

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

/** Lane gen4b B2: the generated course a link names: 'g1.<seed>' (the old generator, legacy) or 'g2.<seed>.<level><spread>'
 *  (the course the pilot asked for, packages/tracks request.ts), or null. */
export function courseOfLink(search: string): CourseLink | null {
    const v = new URLSearchParams(search).get(PARAM);
    return v === null ? null : parseCourseLink(v);
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
    tr: { readonly id: string; readonly version: number; readonly scene: { readonly id: string; readonly version?: number }; readonly transform?: readonly number[] | null; readonly generator?: { readonly version?: string; readonly params?: Record<string, unknown> } | null },
    drone: string
): string {
    const digest = tr.generator?.params?.['freeDigest'];
    const placed = Array.isArray(tr.transform) ? tr.transform.join(',') : '-';
    // review FX-5: a ring turned to start near the spawn (generator.version '<v>.s<n>', packages/tracks generatorVersion)
    // is another course; an unturned course keeps the key it had
    const gv = tr.generator?.version;
    const turned = typeof gv === 'string' ? /\.(s\d+)$/.exec(gv)?.[1] : undefined;
    // review FY-2: generator 3 lays another course for the same seed (gates at eye level, none over a poor scan): its best
    // laps get '.g<major>'; the keys of versions 1 and 2 stay as they were
    const major = typeof gv === 'string' ? Number(/^(\d+)/.exec(gv)?.[1] ?? 0) : 0;
    // course4 review CU-3: a course composed of competition elements ('<v>.e<n>') is another course than the single gates of
    // the same seed: its best laps get '.e<n>' after '.g<major>'
    const elements = typeof gv === 'string' ? /\.(e\d+)(?:\.|$)/.exec(gv)?.[1] : undefined;
    // course train 3 decision A4: a course laid at another size step (generator.params.scale, smaller gates in a small
    // room) is another course for its best laps: '.k<scale>' from generator 4 on; versions up to 3 keep their keys
    const scale = tr.generator?.params?.['scale'];
    const step = major >= 4 && typeof scale === 'number' && Number.isFinite(scale) && scale !== 1 ? `.k${scale}` : '';
    const gen = (major >= 3 ? `.g${major}` : '') + (elements ? `.${elements}` : '') + step;
    return `${tr.id}.v${tr.version}.${tr.scene.id}.${tr.scene.version ?? 0}.${typeof digest === 'string' ? digest.slice(0, 16) : '-'}.${placed}${turned ? `.${turned}` : ''}${gen}.${drone}`;
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

/** every best lap this browser keeps, by bestKey (stage F1-finish: who may vote, course/editor/rules.ts lappedIds) */
export function readBests(): Record<string, number> {
    return bests();
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
