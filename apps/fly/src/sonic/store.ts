// Fly by Sound's saved state in the page (v0.12, docs/wip/v12-plan.md section 1 and 4.2 step 7): the pilot's sound
// settings and the progress of every lesson, kept in the prefs collection 'sonic' (packages/prefs doc.ts), so they
// travel with the settings file and need no catalogue rows. The sound package reads and repairs its own document
// (readPrefs: a missing field takes its default, a bad one is replaced), the collection only bounds it. Since v0.13 a lesson's
// progress keeps `skipped` (packages/prefs doc.ts validSonicProgress, W7), and the start screen can reset the progress.
import { defaultPrefs, readPrefs } from '@shramko/sonic-fpv';
import type { LessonProgress, SonicPrefs } from '@shramko/sonic-fpv';
import type { PrefsStore } from '@gsfpv/prefs';

/** What the sonic store needs of the page's PrefsStore (a fake in tests). */
export type SonicHost = Pick<PrefsStore, 'collection' | 'updateCollection'>;

const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** The pilot's sound settings: the saved document, repaired field by field, else the defaults. Never throws. */
export function loadSonicPrefs(host: SonicHost): SonicPrefs {
    try {
        return readPrefs(host.collection('sonic').prefs).prefs;
    } catch {
        return defaultPrefs();
    }
}

/** Saves the sound settings (only when they changed). */
export function saveSonicPrefs(host: SonicHost, prefs: SonicPrefs): void {
    if (sameJson(host.collection('sonic').prefs, prefs)) return;
    host.updateCollection('sonic', (d) => {
        d.prefs = JSON.parse(JSON.stringify(prefs)) as Record<string, unknown>;
    });
}

/** The saved progress of a lesson, or null when the pilot has not begun it. */
export function savedProgress(host: SonicHost, lessonId: string): LessonProgress | null {
    const p = host.collection('sonic').progress[lessonId];
    return p ? { ...p } : null;
}

/** The saved progress of every lesson begun, by lesson id. */
export function allProgress(host: SonicHost): Record<string, LessonProgress> {
    const out: Record<string, LessonProgress> = {};
    for (const [id, p] of Object.entries(host.collection('sonic').progress)) out[id] = { ...p };
    return out;
}

/** Saves a lesson's progress (only when it changed: the runner's lastAt moves with every event). */
export function saveProgress(host: SonicHost, p: LessonProgress): void {
    const had = host.collection('sonic').progress[p.lessonId];
    if (had && sameJson({ ...had, lastAt: 0 }, { ...p, lastAt: 0 })) return;
    host.updateCollection('sonic', (d) => {
        d.progress[p.lessonId] = { ...p };
    });
}

/** The lesson the pilot is on (the Continue button), or null. */
export function currentLesson(host: SonicHost): string | null {
    return host.collection('sonic').current;
}

export function setCurrentLesson(host: SonicHost, lessonId: string | null): void {
    if (host.collection('sonic').current === lessonId) return;
    host.updateCollection('sonic', (d) => {
        d.current = lessonId;
    });
}

/**
 * "Reset my progress" (v0.13, the owner's M41-2): every lesson's progress and the lesson the pilot is on are cleared, so every lesson is
 * new again and Continue goes; his sound settings (the document's `prefs`) stay as they are.
 */
export function resetProgress(host: SonicHost): void {
    const c = host.collection('sonic');
    if (Object.keys(c.progress).length === 0 && c.current === null) return;
    host.updateCollection('sonic', (d) => {
        d.progress = {};
        d.current = null;
    });
}
