// What two of the page's keys do inside Fly by Sound (v0.12 v12-optin), as data (Node tests hold it; sonic/feature.ts wires it):
//
//   L  (share.open) copies a link that opens this lesson in the mode for the one it is sent to (@gsfpv/scenes sonic-link.ts):
//      the lesson, the scan and Scene size a scan lesson flies, and the sound settings the pilot changed from the defaults.
//      Outside the mode L opens the share panel with a picture of the view; inside it a blind pilot gets a link to paste. The top
//      bar's and the pause menu's Share do the same there (review R3), and show the link in a field (shareLesson).
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

/**
 * What the mode's Share says once the link is copied, or not (review R1): copied, where to paste it; refused by the browser, that the
 * link is selected in a field and which keys copy it, naming the lesson (so it can at least be told). Never "the captions": they may
 * be off, and the link is not put there any more. `lesson`: the running lesson's title, null on the start screen.
 */
export function shareLine(copied: boolean, lesson: string | null, copyKeys: string): SpeechLine {
    if (copied) return { key: lesson !== null ? 'sonic.say.linkCopied' : 'sonic.say.linkCopiedStart' };
    return lesson !== null ? { key: 'sonic.say.linkSelected', params: { lesson, copy: copyKeys } } : { key: 'sonic.say.linkSelectedStart', params: { copy: copyKeys } };
}

/** What the mode's Share needs of the page (sonic/feature.ts wires the real ones; Node tests pass fakes). */
export interface ShareDeps {
    /** the link's whole address */
    readonly url: string;
    /** the running lesson's title, or null on the start screen */
    readonly lesson: string | null;
    /** 'key': L, a blind pilot's (copied and said; the field only when the browser refuses); 'button': a visible Share (the field always) */
    readonly via: 'key' | 'button';
    /** the words for the copy keys on this computer ("Control and C") */
    readonly copyKeys: string;
    copy(text: string): Promise<boolean>;
    /** the link in a focused, selected, read-only field of its own, labelled, outside the captions (sonic/link-panel.ts) */
    field(url: string, copied: boolean): void;
    say(line: SpeechLine): Promise<void>;
}

/**
 * The mode's Share (L, and the top bar's and the pause menu's Share there): the lesson's link to the clipboard, then the field when it
 * must be seen or copied by hand, then the line. A refused clipboard still gives the link: selected in a focused field a screen reader
 * reads and Control and C copy, said with the lesson's name, whatever the captions and the voice are set to. Resolves with `copied`.
 */
export async function shareLesson(d: ShareDeps): Promise<boolean> {
    const copied = await d.copy(d.url);
    if (!copied || d.via === 'button') d.field(d.url, copied);
    await d.say(shareLine(copied, d.lesson, d.copyKeys));
    return copied;
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
