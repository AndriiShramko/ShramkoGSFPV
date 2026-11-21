// The pilot's "Guide: Full / Short / New sounds only" (train 4, lane tutor-say; the first outside feedback of 2026-11-20 "too much
// at once", the owner's "short explanations, the lesson at once"; plan Part C 2). How much the narrator says around a lesson:
//   full  - the lesson lines as written; a moment says what the sound is, plays it, says what to do, and a hint when it is late;
//   short - (the default) a moment says what, plays the sound, says what to do; no hint line (the success sound only);
//   new   - a moment says only the new sound's name and plays it; no other lesson line.
// The narrator off (Shift+V) stays as it is and is the guide off (the lead's decision 1 of Part D): no fourth value here.
// Kept in the prefs collection 'sonic' beside keyHints (packages/prefs doc.ts SonicState.guide: absent means short), like
// key-hints.ts. GuideLevel is the sound package's own union (tutor-moment); until the package's pin exports it, it is declared
// here with the same members, and the import switches when the pin has it.
import type { GuideLevel } from '@shramko/sonic-fpv';
import type { SonicHost } from './store';

export type { GuideLevel };
export const GUIDE_LEVELS: readonly GuideLevel[] = ['full', 'short', 'new'];
export const DEFAULT_GUIDE: GuideLevel = 'short';

/** The pilot's guide level: the saved one, else short. */
export function guideLevel(host: SonicHost): GuideLevel {
    const g = host.collection('sonic').guide;
    return g !== undefined && GUIDE_LEVELS.includes(g) ? g : DEFAULT_GUIDE;
}

/** Sets the level (saved only when it changes). */
export function setGuide(host: SonicHost, level: GuideLevel): void {
    if (!GUIDE_LEVELS.includes(level) || guideLevel(host) === level) return;
    host.updateCollection('sonic', (d) => {
        d.guide = level;
    });
}
