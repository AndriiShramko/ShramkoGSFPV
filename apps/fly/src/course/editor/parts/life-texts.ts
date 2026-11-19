// Lane edit4b, the course's life (design edit4 section 3): the words of the questions before a step that drops the
// pilot's gates, the Course menu's items and the empty course's lines. Pure: no DOM, no i18n import, so a Node test holds
// the keys to the four languages (packages/i18n/locales/fly/course-life/*.json).
import type { TrackFile } from '@shramko/sonic-fpv';
import type { LossQuestion } from '../seam';

/** One question as the dialog shows it: the locale keys and their values. */
export interface AskText {
    readonly titleKey: string;
    readonly bodyKey: string;
    readonly vars?: Record<string, string | number>;
    readonly yesKey: string;
    readonly noKey: string;
}

/** The Course menu's items of this part, in the menu's order (ids are the probes' handles). */
export const LIFE_MENU = [
    { id: 'new', labelKey: 'course.life.menu.new' },
    { id: 'clear', labelKey: 'course.life.menu.clear' },
    { id: 'generate', labelKey: 'course.life.menu.generate' },
    { id: 'overview', labelKey: 'course.life.menu.overview' }
] as const;

export type LifeMenuId = (typeof LIFE_MENU)[number]['id'];

/** The question for a step that drops work; null when nothing would be lost (no gate and nothing unsaved). */
export function lossText(q: LossQuestion): AskText | null {
    // the owner (brief 555): Generate always asks while the course has a gate, saved or not
    if (q.gates === 0 && !q.unsaved) return null;
    const vars = { n: q.gates };
    const tail = q.unsaved ? 'Unsaved' : 'Saved';
    switch (q.what) {
        case 'clear':
            return { titleKey: 'course.life.ask.clearTitle', bodyKey: 'course.life.ask.clearBody', vars, yesKey: 'course.life.ask.clearYes', noKey: 'course.life.ask.no' };
        case 'new':
            return { titleKey: 'course.life.ask.newTitle', bodyKey: `course.life.ask.new${tail}`, vars, yesKey: 'course.life.ask.newYes', noKey: 'course.life.ask.no' };
        case 'generate':
            return { titleKey: 'course.life.ask.genTitle', bodyKey: `course.life.ask.gen${tail}`, vars, yesKey: 'course.life.ask.genYes', noKey: 'course.life.ask.no' };
        case 'open-other':
        case 'restore':
            return { titleKey: 'course.life.ask.otherTitle', bodyKey: `course.life.ask.other${tail}`, vars, yesKey: 'course.life.ask.otherYes', noKey: 'course.life.ask.no' };
    }
}

/** A new empty course of the same scene: its frame and its start kept, no gate, one lap, the pilot's own title. */
export function emptyCourse(like: TrackFile, title: string): TrackFile {
    return { ...like, gates: [], laps: 1, title, parent: null, generator: null, author: { kind: 'person', name: like.author.kind === 'person' ? like.author.name : '' } };
}

/** The lines this part says on the top bar */
export const LIFE_LINES = {
    empty: 'course.life.empty',
    kept: 'course.life.kept',
    newTitle: 'course.life.newTitle',
    saveEmpty: 'course.life.saveEmpty',
    flySwitch: 'course.life.flySwitch',
    flyEmpty: 'course.life.flyEmpty',
    backSwitch: 'course.life.backSwitch',
    close: 'course.life.ask.close'
} as const;

/** every locale key of this part (the test checks all four languages have each, and no other) */
export function lifeLocaleKeys(): string[] {
    const ask: string[] = [];
    for (const what of ['clear', 'new', 'generate', 'open-other'] as const) {
        for (const unsaved of [false, true]) {
            const a = lossText({ what, gates: 3, unsaved });
            if (a) ask.push(a.titleKey, a.bodyKey, a.yesKey, a.noKey);
        }
    }
    return [...new Set([...LIFE_MENU.map((m) => m.labelKey), ...ask, ...Object.values(LIFE_LINES)])].sort();
}
