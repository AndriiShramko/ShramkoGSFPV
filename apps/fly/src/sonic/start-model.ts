// What the start screen shows, as data (v0.12, docs/wip/v12-plan.md 4.2 step 8; spec sections 3 and 6): the lessons by
// module with where the pilot stands in each, the lesson Start and Continue open, and what ?sonic= asked for. Pure, so
// Node tests hold it; the DOM is start-screen.ts. Every lesson can be opened directly (the ladder only recommends), so
// the model lists all of them whatever the path; the path decides only which lesson the Start buttons open and which
// lessons are marked as being on it.
// v0.13 (lane v13-host C2, the owner's M41-2; W7): a lesson left without passing is 'skipped' (the runner's progress.skipped, which the
// prefs keep since v0.13), and every lesson has its place, "Lesson N of 28", counted as the runner's view counts it (on the pilot's path
// when the lesson is on it, else on the full one), so the screen and the lesson say the same number.
import { SCAN_FREE_ID, SHIPPED_LESSON_IDS, getLesson, isShippedLesson, lessonPaths, scanFreeLesson } from '@shramko/sonic-fpv';
import { SHARED_LIMITS } from '@gsfpv/scenes';
import type { LessonDef, LessonProgress, ModuleId, SpeechLine } from '@shramko/sonic-fpv';

/** Where the pilot stands in a lesson: passed, in progress, left without passing (v0.13), or new. */
export type LessonState = 'new' | 'current' | 'skipped' | 'passed';

/** What of a lesson's saved progress decides its state. */
export type ProgressOf = Pick<LessonProgress, 'passed' | 'attempts' | 'skipped'>;

/** A lesson's place: lesson `n` of `total`. */
export interface LessonPlace {
    readonly n: number;
    readonly total: number;
}

export interface LessonRow {
    readonly id: string;
    readonly title: SpeechLine;
    readonly module: ModuleId;
    readonly fastPath: boolean;
    readonly state: LessonState;
    /** "Lesson N of 28" (lessonPlace) */
    readonly place: LessonPlace;
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

/**
 * A lesson's state: passed; in progress when it is the one the pilot left off on; skipped when he went on without passing it (N, the
 * lesson menu's Next lesson, or a lesson that let him go on after its failures: the runner keeps it so until it is passed); in progress
 * when begun; else new.
 */
export function stateOf(id: string, progress: Readonly<Record<string, ProgressOf>>, current: string | null): LessonState {
    const p = progress[id];
    if (p?.passed) return 'passed';
    if (id === current) return 'current';
    if (p?.skipped === true) return 'skipped';
    if (p !== undefined && p.attempts > 0) return 'current';
    return 'new';
}

/**
 * A lesson's place, "Lesson N of 28": on the pilot's path when the lesson is on it, else on the full path (the rule of the runner's
 * view, LessonView.lessonIndex and lessonCount, which I and the progress panel say).
 */
export function lessonPlace(id: string, path: 'full' | 'fast'): LessonPlace {
    const paths = lessonPaths();
    const list = paths[path].includes(id) ? paths[path] : paths.full;
    const i = list.indexOf(id);
    return i < 0 ? { n: 1, total: 1 } : { n: i + 1, total: list.length };
}

/** The lesson to continue with on `path`: the one the pilot left off on if it is not passed, else the first of the path not passed; null before any lesson was begun. */
export function continueLesson(progress: Readonly<Record<string, ProgressOf>>, current: string | null, path: 'full' | 'fast'): string | null {
    const begun = Object.values(progress).some((p) => p.attempts > 0 || p.passed) || current !== null;
    if (!begun) return null;
    if (current !== null && isShippedLesson(current) && !progress[current]?.passed) return current;
    const list = lessonPaths()[path];
    return list.find((id) => !progress[id]?.passed) ?? list[list.length - 1] ?? null;
}

export function buildModel(progress: Readonly<Record<string, ProgressOf & { readonly bestTimeMs?: number | null }>>, current: string | null, path: 'full' | 'fast'): StartModel {
    const byModule = new Map<ModuleId, LessonRow[]>();
    for (const l of ladder()) {
        const timed = l.goals.some((g) => g.kind === 'timed-course');
        const best = progress[l.id]?.bestTimeMs;
        const row: LessonRow = { id: l.id, title: l.title, module: l.module, fastPath: l.fastPath, state: stateOf(l.id, progress, current), place: lessonPlace(l.id, path), scan: l.world.kind === 'scan', bestTimeMs: timed && typeof best === 'number' ? best : null };
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
export type SonicRequest =
    | { readonly kind: 'start' }
    | { readonly kind: 'lesson'; readonly id: string }
    | { readonly kind: 'scan'; readonly sceneId: string; readonly size: number }
    | { readonly kind: 'unknown'; readonly raw: string };

/** A scene id as the catalogue and the links write it (letters, digits, dash, underscore), bounded. */
const SCENE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * ?sonic=scan&scene=<id>&sz=<size> (train 2, the pause item of an ordinary page, app/builtin/sonic-flight.ts modeScanPage): free flight
 * over that scan at that size (no sz: x1). 'scan-free' (the template's id, which the address of a running free flight carries) reads the
 * same. A size outside the catalogue's bounds (shared-settings SHARED_LIMITS.size) or a missing scene is the start screen with the note.
 */
export function parseSonicParam(raw: string | null, query?: { get(name: string): string | null }): SonicRequest {
    const v = (raw ?? '').trim();
    if (v === '' || v === 'start' || v === 'menu') return { kind: 'start' };
    if (v === 'scan' || v === SCAN_FREE_ID) {
        const sceneId = (query?.get('scene') ?? '').trim();
        const szRaw = (query?.get('sz') ?? '').trim();
        const size = /^\d+(\.\d+)?$/.test(szRaw) ? Number(szRaw) : szRaw === '' ? 1 : NaN;
        const [lo, hi] = SHARED_LIMITS.size;
        if (SCENE_ID.test(sceneId) && Number.isFinite(size) && size >= lo && size <= hi) return { kind: 'scan', sceneId, size: Number(size.toFixed(3)) };
        return { kind: 'unknown', raw: v.slice(0, 64) };
    }
    return isShippedLesson(v) ? { kind: 'lesson', id: v } : { kind: 'unknown', raw: v.slice(0, 64) };
}

/**
 * Who the start screen of a scan link puts the scan first for (train 2): a pilot who has begun any lesson (saved progress) or once
 * said "I already fly by sound" (store.ts fliesBySound). Anyone else is a first-timer: the lessons first.
 */
export function experiencedPilot(progress: Readonly<Record<string, unknown>>, saidFlies: boolean): boolean {
    return saidFlies || Object.keys(progress).length > 0;
}

/**
 * The free flight a press asks for (train 2): SCAN_FREE_ID on a scan link's screen is the template over that link's scan at its size
 * (scanFreeLesson, transform [size, 0, 0, 0]), else null (a shipped lesson). Pure, here and not in start.ts, so a test loads it in Node.
 */
export function freeLessonOf(request: SonicRequest, id: string): LessonDef | null {
    if (id !== SCAN_FREE_ID || request.kind !== 'scan') return null;
    return scanFreeLesson(request.sceneId, [request.size, 0, 0, 0]);
}

/** The start screen's actions in order for a scan link: 'scan' (fly this scan by sound) and 'lessons' (Continue and the course). */
export function scanStartOrder(experienced: boolean): readonly ('scan' | 'lessons')[] {
    return experienced ? ['scan', 'lessons'] : ['lessons', 'scan'];
}
