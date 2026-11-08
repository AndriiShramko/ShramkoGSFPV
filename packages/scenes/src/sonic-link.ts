// The link that carries Fly by Sound (v0.12 v12-optin; the owner's message 40: blind pilots share links with blind pilots, and an
// ordinary page never shows the mode). A sonic link is the simulator's page with ?sonic=, which opens the mode's keyboard-only
// start screen (a lesson starts on a key press or a click: the sound needs the user's activation), and after it what makes the
// lesson sound the same to the one who opens it:
//
//   sonic=<lesson>     the lesson (an id of the sound package's lessons), or `start`: the start screen
//   scene=<id>&sz=<s>  the scan a lesson flies and its Scene size, written for a lesson that flies a scan (the lesson's own world
//                      decides what is flown, so they name it; the reader of `sz` is the shared settings' own, shared-settings.ts)
//   st=<theme>         the sound theme
//   sc=1               calm mode (0: off)
//   sh=up-lower        the height tone: up is a lower tone (up-higher: the usual)
//   sf=body            the sound turns with the whole drone, tilt included (heading: the way the pilot faces, the usual)
//
// The writer puts a sound setting in only when it is not the sound package's default (SONIC_LINK_DEFAULTS, held equal to the
// package's defaultPrefs by tools/bench/test/sonic-optin.test.ts), so a link carries what the sharer chose; the one who opens it
// hears them for that visit, his own saved settings untouched (apps/fly sonic/entry.ts SonicSetup.visit).
//
// It carries nothing of the person: no recording, no name, no address, nothing of his voice, and nothing that depends on the
// listener rather than on the lesson (the speaking speed, the screen reader, the captions, each sound's volume). Strict reading:
// each parameter on its own, an unusable one ignored; anything else in the query is not this module's. Written without a
// language by default (/fly/?...): the server sends the visitor to the page in his own language (deploy/nginx.conf
// `location = /fly/`), so a lesson a Polish pilot shares is spoken in Spanish to a Spanish one. Pure: no DOM, no lessons, no
// themes (the page that opens it checks that the lesson and the theme exist).
import { SCENE_ID_RE } from './link';
import { SHARED_PARAMS, parseSharedSettings, sharedNumber } from './shared-settings';

/** The sound settings a link may carry (each only when it is not the default). */
export interface SonicLinkSound {
    theme?: string;
    calm?: boolean;
    heightPolarity?: 'up-higher' | 'up-lower';
    listenerFrame?: 'heading' | 'body';
}

/** What a sonic link says. */
export interface SonicLink {
    /** a lesson id, or 'start' (the start screen) */
    lesson: string;
    /** the scan a scan lesson flies, and its Scene size */
    scene?: string;
    size?: number;
    sound: SonicLinkSound;
}

/** The query parameter of each part, in the order they are written (the size is the shared settings' own `sz`). */
export const SONIC_LINK_PARAMS = { lesson: 'sonic', scene: 'scene', size: SHARED_PARAMS.size, theme: 'st', calm: 'sc', height: 'sh', frame: 'sf' } as const;

/** The sound package's defaults of the settings a link carries (contract SonicPrefs, prefs.ts defaultPrefs). */
export const SONIC_LINK_DEFAULTS: Required<SonicLinkSound> = { theme: 'soft', calm: false, heightPolarity: 'up-higher', listenerFrame: 'heading' };

/** A lesson id or a theme id: lower-case letters and digits joined by single hyphens (the sound package's own rule for ids). */
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const LESSON_MAX = 64;
const THEME_MAX = 40;

/**
 * The link the page's query carries, or null when it has no `sonic` parameter (not a sonic link). `get` is URLSearchParams.get.
 * A `sonic` value that is not an id (empty, `menu`, anything else) reads as `start`. Never throws.
 */
export function parseSonicLink(q: { get(name: string): string | null }): SonicLink | null {
    const raw = q.get(SONIC_LINK_PARAMS.lesson);
    if (raw === null) return null;
    const v = raw.trim();
    const out: SonicLink = { lesson: v.length <= LESSON_MAX && ID.test(v) ? v : 'start', sound: {} };
    const scene = q.get(SONIC_LINK_PARAMS.scene);
    if (scene !== null && SCENE_ID_RE.test(scene)) out.scene = scene.toLowerCase();
    // the size as a shared link reads it (a plain decimal in the Scene size range), and nothing else of the shared settings
    const size = parseSharedSettings({ get: (n) => (n === SONIC_LINK_PARAMS.size ? q.get(n) : null) }).size;
    if (size !== undefined) out.size = size;
    const theme = q.get(SONIC_LINK_PARAMS.theme);
    if (theme !== null && theme.length <= THEME_MAX && ID.test(theme)) out.sound.theme = theme;
    const calm = q.get(SONIC_LINK_PARAMS.calm);
    if (calm === '1' || calm === '0') out.sound.calm = calm === '1';
    const height = q.get(SONIC_LINK_PARAMS.height);
    if (height === 'up-higher' || height === 'up-lower') out.sound.heightPolarity = height;
    const frame = q.get(SONIC_LINK_PARAMS.frame);
    if (frame === 'heading' || frame === 'body') out.sound.listenerFrame = frame;
    return out;
}

/** The settings of `prefs` a link carries: those that are not the defaults (a whole SonicPrefs may be passed). */
export function linkSound(prefs: Required<SonicLinkSound>): SonicLinkSound {
    const out: SonicLinkSound = {};
    if (prefs.theme !== SONIC_LINK_DEFAULTS.theme) out.theme = prefs.theme;
    if (prefs.calm !== SONIC_LINK_DEFAULTS.calm) out.calm = prefs.calm;
    if (prefs.heightPolarity !== SONIC_LINK_DEFAULTS.heightPolarity) out.heightPolarity = prefs.heightPolarity;
    if (prefs.listenerFrame !== SONIC_LINK_DEFAULTS.listenerFrame) out.listenerFrame = prefs.listenerFrame;
    return out;
}

/** The query text of a link, in the fixed order, without a leading `?`. */
export function sonicLinkQuery(link: SonicLink): string {
    const P = SONIC_LINK_PARAMS;
    const p: string[] = [`${P.lesson}=${encodeURIComponent(link.lesson)}`];
    if (link.scene !== undefined && SCENE_ID_RE.test(link.scene)) {
        p.push(`${P.scene}=${link.scene}`);
        if (link.size !== undefined) p.push(`${P.size}=${sharedNumber(link.size, 3)}`);
    }
    const s = link.sound;
    if (s.theme !== undefined) p.push(`${P.theme}=${encodeURIComponent(s.theme)}`);
    if (s.calm !== undefined) p.push(`${P.calm}=${s.calm ? 1 : 0}`);
    if (s.heightPolarity !== undefined) p.push(`${P.height}=${s.heightPolarity}`);
    if (s.listenerFrame !== undefined) p.push(`${P.frame}=${s.listenerFrame}`);
    return p.join('&');
}

/** The link's address under `flyPath`: `/fly/` (no language: the server picks the visitor's own) or a page's own `/{lang}/fly/`. */
export function sonicLinkPath(link: SonicLink, flyPath = '/fly/'): string {
    return `${flyPath}?${sonicLinkQuery(link)}`;
}
