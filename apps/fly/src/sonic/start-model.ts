// What the start screen shows, as data (v0.12, docs/wip/v12-plan.md 4.2 step 8; spec sections 3 and 6): the lessons by
// module with where the pilot stands in each, the lesson Start and Continue open, and what ?sonic= asked for. Pure, so
// Node tests hold it; the DOM is start-screen.ts. Every lesson can be opened directly (the ladder only recommends), so
// the model lists all of them whatever the path; the path decides only which lesson the Start buttons open and which
// lessons are marked as being on it.
import { SHIPPED_LESSON_IDS, getLesson, isShippedLesson, lessonPaths } from '@shramko/sonic-fpv';
import type { LessonDef, LessonProgress, ModuleId, SpeechLine } from '@shramko/sonic-fpv';

/** Where the pilot stands in a lesson. */
export type LessonState = 'new' | 'current' | 'passed';

export interface LessonRow {
    readonly id: string;
    readonly title: SpeechLine;
    readonly module: ModuleId;
    readonly fastPath: boolean;
    readonly state: LessonState;
    /** the lesson has no analytic world (module 7 flies a scan) */
    readonly scan: boolean;
    /** the timed lesson's best time, ms, or null (none yet, or not a timed lesson) */
    readonly bestTimeMs: number | null;
}

export interface ModuleRow {
    readonly module: ModuleId;
    readonly name: SpeechLine;
    readonly lessons: readonly LessonRow[];
}

export interface StartModel {
    readonly modules: readonly ModuleRow[];
    /** the lesson "Start from the beginning" opens: the first of the path */
    readonly beginningId: string;
    /** the lesson "Continue where I stopped" opens, or null when the pilot has not begun */
    readonly continueId: string | null;
}

/** The lessons in ladder order (each lesson's `order`, its place on the full path: 28 lessons since v0.13), each once. */
export function ladder(): LessonDef[] {
    return SHIPPED_LESSON_IDS.map((id) => getLesson(id)).sort((a, b) => a.order - b.order);
}

/** A lesson's state: passed, in progress (begun, or the one the pilot left off on), or new. */
export function stateOf(id: string, progress: Readonly<Record<string, Pick<LessonProgress, 'passed' | 'attempts'>>>, current: string | null): LessonState {
    const p = progress[id];
    if (p?.passed) return 'passed';
    if (id === current || (p !== undefined && p.attempts > 0)) return 'current';
    return 'new';
}

/** The lesson to continue with on `path`: the one the pilot left off on if it is not passed, else the first of the path not passed; null before any lesson was begun. */
export function continueLesson(progress: Readonly<Record<string, Pick<LessonProgress, 'passed' | 'attempts'>>>, current: string | null, path: 'full' | 'fast'): string | null {
    const begun = Object.values(progress).some((p) => p.attempts > 0 || p.passed) || current !== null;
    if (!begun) return null;
    if (current !== null && isShippedLesson(current) && !progress[current]?.passed) return current;
    const list = lessonPaths()[path];
    return list.find((id) => !progress[id]?.passed) ?? list[list.length - 1] ?? null;
}

export function buildModel(progress: Readonly<Record<string, Pick<LessonProgress, 'passed' | 'attempts'> & { readonly bestTimeMs?: number | null }>>, current: string | null, path: 'full' | 'fast'): StartModel {
    const byModule = new Map<ModuleId, LessonRow[]>();
    for (const l of ladder()) {
        const timed = l.goals.some((g) => g.kind === 'timed-course');
        const best = progress[l.id]?.bestTimeMs;
        const row: LessonRow = { id: l.id, title: l.title, module: l.module, fastPath: l.fastPath, state: stateOf(l.id, progress, current), scan: l.world.kind === 'scan', bestTimeMs: timed && typeof best === 'number' ? best : null };
        const list = byModule.get(l.module) ?? [];
        list.push(row);
        byModule.set(l.module, list);
    }
    const modules = [...byModule.entries()].sort((a, b) => a[0] - b[0]).map(([module, lessons]) => ({ module, name: { key: `module.${module}.name` }, lessons }));
    return { modules, beginningId: (lessonPaths()[path][0] ?? ladder()[0]!.id), continueId: continueLesson(progress, current, path) };
}

/**
 * What a pilot is told when the flight of the lesson he chose did not open at the entry: the scan of a scan lesson did not load
 * (the connection), else the lesson did not open. A line of the dictionary in his language (the engine says it, the captions
 * and the live region carry it), never the raw message of the exception (English, technical, spoken to nobody).
 */
export function launchFailureLine(scan: boolean): SpeechLine {
    return { key: scan ? 'sonic.say.scanFailed' : 'sonic.say.lessonFailed' };
}

/** What ?sonic= asked for: the start screen, one lesson, or something that is neither (the start screen with a note). */
export type SonicRequest = { readonly kind: 'start' } | { readonly kind: 'lesson'; readonly id: string } | { readonly kind: 'unknown'; readonly raw: string };

export function parseSonicParam(raw: string | null): SonicRequest {
    const v = (raw ?? '').trim();
    if (v === '' || v === 'start' || v === 'menu') return { kind: 'start' };
    return isShippedLesson(v) ? { kind: 'lesson', id: v } : { kind: 'unknown', raw: v.slice(0, 64) };
}
