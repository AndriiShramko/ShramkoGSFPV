// What two of the page's keys do inside Fly by Sound (v0.12 v12-optin), as data (Node tests hold it; sonic/feature.ts wires it):
//
//   L  (share.open) copies a link that opens this lesson in the mode for the one it is sent to (@gsfpv/scenes sonic-link.ts):
//      the lesson, the scan and Scene size a scan lesson flies, and the sound settings the pilot chose that are not the defaults.
//      Outside the mode L opens the share panel with a picture of the view; inside it a blind pilot gets a link to paste.
//   K  (help.keys) says the mode's keys, each with the key this page has for it (the sound package's own help lines, and the
//      page's line for L): a blind pilot cannot read the key list of the pause menu. Outside the mode K opens the "How to fly" card.
import type { LessonDef, SonicPrefs, SpeechLine } from '@shramko/sonic-fpv';
import { linkSound } from '@gsfpv/scenes/sonic-link';
import type { SonicLink } from '@gsfpv/scenes/sonic-link';
import type { ActionId } from '@gsfpv/prefs';

/** The link that opens `lesson` (null: the start screen) with `sound`; a scan lesson's link names its scan at its size. */
function linkOf(lesson: Pick<LessonDef, 'id' | 'world'> | null, sound: SonicLink['sound']): SonicLink {
    const link: SonicLink = { lesson: lesson?.id ?? 'start', sound };
    // the scan a scan lesson flies, at its size: the lesson's own (what the link opens), named in the link
    if (lesson?.world.kind === 'scan') {
        link.scene = lesson.world.sceneId;
        link.size = lesson.world.transform[0];
    }
    return link;
}

/** The link that opens `lesson` (null: the start screen) with the pilot's sound settings that are not the defaults (what L copies). */
export function lessonLink(lesson: Pick<LessonDef, 'id' | 'world'> | null, prefs: SonicPrefs): SonicLink {
    return linkOf(lesson, linkSound(prefs));
}

/**
 * The address of the page while `lesson` runs (review R2, sonic/address.ts): that lesson's own link with only the settings a shared
 * link set that still stand (`visit`), never the pilot's own, so a reload offers this lesson with what stood and nothing else.
 */
export function pageLink(lesson: Pick<LessonDef, 'id' | 'world'>, visit: SonicLink['sound']): SonicLink {
    return linkOf(lesson, { ...visit });
}

/** What L says once the link is copied (or not): `cap` is the key's cap for "press it again". */
export function linkLine(copied: boolean, inLesson: boolean, cap: string): SpeechLine {
    if (!copied) return { key: 'sonic.say.linkFailed', params: { key: cap } };
    return { key: inLesson ? 'sonic.say.linkCopied' : 'sonic.say.linkCopiedStart' };
}

/** The mode's keys K says, in this order, each line with the key of its action (help.* are the sound package's lines). */
export const KEY_HELP: readonly (readonly [line: string, action: ActionId])[] = [
    ['help.record', 'sonic.record'],
    ['help.send', 'sonic.send'],
    ['help.status', 'sonic.status'],
    ['help.repeat', 'sonic.repeat'],
    ['help.glossary', 'sonic.glossary'],
    ['sonic.say.helpShare', 'share.open'],
    ['help.reset', 'respawn.start'],
    ['help.next', 'scene.next']
];

/** The lines K says: the intro, one per key with the page's cap (an action with no key on the page is left out), the digits. */
export function keyHelpLines(cap: (action: ActionId) => string): SpeechLine[] {
    const lines: SpeechLine[] = [{ key: 'help.intro' }];
    for (const [key, action] of KEY_HELP) {
        const c = cap(action);
        if (c !== '') lines.push({ key, params: { key: c } });
    }
    lines.push({ key: 'help.digits' });
    return lines;
}
