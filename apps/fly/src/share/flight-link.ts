// The one place that writes a flight's address (lane n-share, the owner's wish 2 of 2026-11-20: "I flew by sound in a scene
// with gates, copied the Share address and sent it to a friend; the friend got the sound lessons, not the scene to fly").
// Every Share of a flight calls flightLink: the pause menu's and the top bar's Share of a normal flight (share/links.ts
// shareLink, when the place has a course or no scene page fits), the mode's Share in a flight by sound (sonic/feature.ts
// ctx.sonicShare through sonic/mode-keys.ts soundPlace), and the course chip (lane n-level). readFlightLink is how a browser
// that has never opened the site reads such an address: the table of tools/bench/test/share-links-table.test.ts holds both.
//
// An address says three things, each by a parameter the page already reads:
//   scene=<id>       the scan (and sz=<size> in a flight by sound; a normal flight carries its size in its shared settings)
//   course=<link>    the course (course/link.ts): a saved course `<id>.v<n>` (servedOfLink), a generated one `g1.`/`g2.`/`g3.`
//                    as the course feature wrote it (an opaque token here: never rebuilt, so the level inside it rides along)
//   sonic=<what>     the way of flying: absent, a normal flight; `fly`, a free flight by sound in that scene; a lesson id, that
//                    lesson (the scan lesson names its scan); `start`, the mode's start screen
// A course the pilot built by hand and never saved ('unsaved') cannot travel: the address carries the scene alone and the
// Share says so (S2). Pure: no DOM, no clock.
import { appendShared, flyDeepLink, parseSharedSettings, SCENE_ID_RE } from '@gsfpv/scenes';
import type { SceneRender, SharedSettings } from '@gsfpv/scenes';
import { COURSE_TOKEN, parseSonicLink, sonicLinkPath } from '@gsfpv/scenes/sonic-link';
import type { SonicLinkSound } from '@gsfpv/scenes/sonic-link';
import { servedOfLink } from '../course/link';
import type { PagePlace } from './links';

/** The course of a place: a saved one (version 0: the link names none, the newest is flown), a generated one's link, one never saved, none. */
export type LinkCourse = { kind: 'served'; id: string; version: number } | { kind: 'generated'; link: string } | { kind: 'unsaved' } | null;

/** Where a pilot flies: the scene, its size, the course, the way of flying, the lesson (a flight by sound). */
export interface FlightPlace {
    sceneId: string;
    /** the Scene size a flight by sound names (sz=); a normal flight carries it in `shared` */
    size?: number;
    course: LinkCourse;
    /** 'test': a test flight from the editor, shared as the normal flight of that course */
    mode: 'normal' | 'sound' | 'test';
    /** a flight by sound: the lesson flown (absent: the free flight in the scene; 'start': the mode's start screen) */
    lesson?: string;
    /** a normal flight: how the scene's link asked it to be drawn (lane R; never the owner's entry) */
    render?: SceneRender;
    /** a normal flight: the sharer's scene settings that differ from the scene's (share/shared.ts) */
    shared?: SharedSettings;
    /** a flight by sound: the sound settings the pilot changed from the defaults (linkSound) */
    sound?: SonicLinkSound;
}

/** The `sonic=` value of a free flight by sound in the linked scene (start-model.ts parseSonicParam reads it as a scan request). */
export const SOUND_FREE = 'fly';

/** The `sonic=` values that name no lesson: the free flight (the template's own id and the older `scan` included) and the start screen. */
const NO_LESSON: ReadonlySet<string> = new Set([SOUND_FREE, 'scan', 'scan-free', 'start']);

/** A generated course's link token: `g<n>.` and the rest as the course feature wrote it (lane w1-anchor: a 'g2.' link's
 *  anchor may be negative, `g2.7.mc.12.-3.-540`, so '-' is part of the token; lane w1-dialog: a course with Add here parts
 *  joins them with '_', `g2.7.mc.12.-3.-540_zz.pc.40.2.-500`, at most MAX_ADDS of them) */
const GENERATED = /^g[0-9]\.[0-9a-z._-]{1,240}$/;

/** A `course=` value an address may carry: a generated course's link or a saved course's `<id>[.v<n>]`. */
export function isCourseToken(v: string): boolean {
    return GENERATED.test(v) || COURSE_TOKEN.test(v);
}

/**
 * What the Share of a place says besides "the link is ready": a course built by hand and never saved cannot travel, so the link
 * opens the scene alone and the pilot is told so in one line, with the way on (save it, share again). Null when nothing is lost.
 */
export function shareNoteKey(c: LinkCourse): 'share.unsaved' | null {
    return c !== null && c.kind === 'unsaved' ? 'share.unsaved' : null;
}

/** The `course=` value of a course that travels, or null (none, or never saved). */
export function courseToken(c: LinkCourse): string | null {
    if (c === null || c.kind === 'unsaved') return null;
    if (c.kind === 'generated') return GENERATED.test(c.link) ? c.link : null;
    const token = c.version > 0 ? `${c.id}.v${c.version}` : c.id;
    return COURSE_TOKEN.test(token) ? token : null;
}

/** The address of a place. A flight by sound has no language in it (the server sends the visitor to his own, deploy/nginx.conf). */
export function flightLink(p: FlightPlace, at: PagePlace): string {
    const course = courseToken(p.course) ?? undefined;
    if (p.mode === 'sound') {
        const scene = SCENE_ID_RE.test(p.sceneId) ? p.sceneId : undefined;
        return `${at.origin}${sonicLinkPath({ lesson: p.lesson ?? SOUND_FREE, scene, size: scene ? p.size : undefined, course: scene ? course : undefined, sound: p.sound ?? {} })}`;
    }
    const deep = appendShared(flyDeepLink(`/${at.locale}/fly/`, p.sceneId, p.render), p.shared ?? {});
    return `${at.origin}${deep}${course !== undefined ? `&course=${course}` : ''}`;
}

/** The course an address names: a saved course by servedOfLink, a generated one as an opaque token, else null. */
function linkCourseOf(q: URLSearchParams, search: string): LinkCourse {
    const served = servedOfLink(search);
    if (served) return { kind: 'served', id: served.id, version: served.version ?? 0 };
    const v = q.get('course');
    return v !== null && GENERATED.test(v) ? { kind: 'generated', link: v } : null;
}

/** What an address says, as a browser that never opened the site reads it; null without a scene (nothing to fly there). */
export function readFlightLink(search: string): FlightPlace | null {
    const q = new URLSearchParams(search);
    const scene = q.get('scene');
    if (scene === null || !SCENE_ID_RE.test(scene)) return null;
    const sonic = parseSonicLink(q);
    const size = parseSharedSettings(q).size;
    const place: FlightPlace = { sceneId: scene.toLowerCase(), course: linkCourseOf(q, search), mode: sonic ? 'sound' : 'normal' };
    if (size !== undefined) place.size = size;
    if (sonic && !NO_LESSON.has(sonic.lesson)) place.lesson = sonic.lesson;
    return place;
}

/** The course hook as the place needs it (course/hook.ts CourseHook): where the course came from, its track, the editor's state. */
export interface FlownCourse {
    readonly source: 'none' | 'generated' | 'server' | 'new';
    readonly track: { readonly id: string; readonly version: number } | null;
    readonly editor?: { readonly changed: boolean };
}

/**
 * The course of the flight now: a saved course unchanged in the editor travels by id and version; a generated one by the link the
 * course feature wrote in the address (`search`); one built by hand and never saved, or changed since its save, is 'unsaved'.
 */
export function courseOfFlight(c: FlownCourse | null | undefined, search: string): LinkCourse {
    if (!c || c.source === 'none' || !c.track) return null;
    if (c.source === 'new' || c.editor?.changed === true) return { kind: 'unsaved' };
    if (c.source === 'server') return { kind: 'served', id: c.track.id, version: c.track.version };
    const v = new URLSearchParams(search).get('course');
    return v !== null && GENERATED.test(v) ? { kind: 'generated', link: v } : { kind: 'unsaved' };
}
