// Lane edit4b, the course's life (design edit4 section 3): the words of the questions before a step that drops the
// pilot's gates, the Course menu's items and the empty course's lines. Pure: no DOM, no i18n import, so a Node test holds
// the keys to the four languages (packages/i18n/locales/fly/course-life/*.json).
import type { Pose, SceneTransform, TrackFile } from '@shramko/sonic-fpv';
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

/**
 * A new empty course of the same scene: no gate, one lap, the pilot's own title. int4 car 3: it is laid out for the scene
 * as the pilot flies it now (the seam's flown(): a Scene size changed since the old course counts) and starts at
 * the scene's own spawn (start null; the page's startNew writes it as a pose with startAtSpawn, the editor's checks need
 * one): an asked course's start may stand far off on its gate 1's approach (gap-gen), and the gates the pilot clicks into
 * the view would meet a wall on the way from there.
 */
export function emptyCourse(like: TrackFile, title: string, flown: SceneTransform): TrackFile {
    return { ...like, transform: [flown[0], flown[1], flown[2], flown[3]], start: null, gates: [], laps: 1, title, parent: null, generator: null, author: { kind: 'person', name: like.author.kind === 'person' ? like.author.name : '' } };
}

/**
 * The scene's spawn (the session's spawn: flown metres and yaw degrees) as a course start in the course's own units:
 * flown = s * p + t (packages/tracks check.ts flownStart), so p = (flown - t) / s, rounded to 1e-6 like the editor's gates.
 */
export function startAtSpawn(spawn: readonly [number, number, number, number], transform: SceneTransform): Pose {
    const s = transform[0];
    const r6 = (v: number): number => Math.round(v * 1e6) / 1e6;
    return { pos: [r6((spawn[0] - transform[1]) / s), r6((spawn[1] - transform[2]) / s), r6((spawn[2] - transform[3]) / s)], yawDeg: r6(spawn[3]) };
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
    pointArrow: 'course.life.point.arrow',
    pointBehind: 'course.life.point.behind',
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
