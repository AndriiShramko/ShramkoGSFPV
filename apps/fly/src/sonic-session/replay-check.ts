// The replay check of a recording (docs/wip/v12-plan.md section 4.3 step 5): the sound package's replay core re-derives the lesson's
// events and the cues from the recorded frames, and its comparer holds them to what the recording says, with its tolerances. This file
// runs the same computation as the package's `checkSession` (a test holds the two equal), in pieces: a ten-minute flight is 18 000 frames,
// and the page must stay alive while they are re-played, so the work yields to the browser every few hundred frames.
//
// A recording of several lessons (v12-int step 5) is checked lesson by lesson: replay-segments.ts cuts it at its `lesson open` events,
// each piece is rebuilt with its own lesson and world and compared on its own, and the results are added up into one ReplayCheck (every
// event and every frame of every lesson counted once). A package of one lesson is one piece: the same computation as before.
// The lead of a recording of several lessons (the lesson that ran when it started, its `lesson open` not in it) is replayed but not
// compared: its state then (the attempt, the goals met, what was said) is not in the package, so its events cannot be worked out
// again. A recording now starts its lesson again (session.ts, LessonHost.reopen), so a new one has no lead.
import { DEFAULT_TOLERANCES, ReplayError, Replayer, compareReplay, formatReplayCheck, getLesson, rebuildSession } from '@shramko/sonic-fpv';
import type { CheckOptions, ComparedKind, FlightFrame, KindCount, LessonDef, Pose, ReplayCheck, ReplayNote, ReplaySetup, SessionEvent, SessionManifest, SonicObject, SonicWorld } from '@shramko/sonic-fpv';
import { lessonSegments } from './replay-segments';
import type { LessonSegment } from './replay-segments';

export interface CheckedPackage {
    readonly manifest: SessionManifest;
    readonly frames: readonly FlightFrame[];
    readonly events: readonly SessionEvent[];
}

/** One lesson of the recording, ready to replay: its piece of the package, the setup it was rebuilt with, and its own check (null: not compared, the lead). */
export interface CheckedSegment {
    readonly segment: LessonSegment;
    readonly setup: ReplaySetup;
    readonly check: ReplayCheck | null;
}

export interface ReplayOutcome {
    /** null when the session could not be rebuilt at all (an unknown lesson, a scan with no world given, no frames); the first lesson's otherwise */
    readonly setup: ReplaySetup | null;
    /** every lesson of the recording with frames, in order (one for a package of one lesson) */
    readonly segments: readonly CheckedSegment[];
    readonly check: ReplayCheck | null;
    /** the package's own one-line report of the check, one per lesson (English; the panel shows a sentence of its own and keeps this for the details) */
    readonly line: string;
    readonly error: { readonly code: string; readonly message: string } | null;
    /** how long the check took, ms */
    readonly tookMs: number;
}

/** A scan lesson's world as the page flies it now (its gates, start and floor), or null to replay that lesson without one. */
export type ScanWorldOf = (lesson: LessonDef) => { readonly world: SonicWorld; readonly objects: readonly SonicObject[]; readonly start: Pose; readonly floorY: number } | null;

export interface CheckRun extends CheckOptions {
    /** frames between two looks at the browser (default 240) */
    readonly yieldEvery?: number;
    readonly yieldFn?: () => Promise<void>;
    readonly now?: () => number;
    /** the world of a scan lesson in the recording (the page's, when it flies that scan); without it a scan lesson replays with no world */
    readonly scanWorld?: ScanWorldOf;
}

const nextTask = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** The options a piece is rebuilt with: the run's own; for a scan lesson the world the page flies now (its gates, start and floor) when it is that scan, else none. */
function optionsFor(seg: LessonSegment, run: CheckRun): CheckOptions {
    const { scanWorld, ...rest } = run;
    const id = seg.manifest.lesson?.id;
    if (seg.manifest.scene.kind !== 'scan' || scanWorld === undefined || id === undefined) return rest;
    let lesson: LessonDef;
    try {
        lesson = getLesson(id);
    } catch {
        return rest; // rebuildSession names it: unknown-lesson
    }
    if (lesson.world.kind !== 'scan') return rest;
    const got = scanWorld(lesson);
    return got === null ? { ...rest, world: null } : { ...rest, world: got.world, objects: got.objects, start: got.start, floorY: got.floorY };
}

const KINDS: readonly ComparedKind[] = ['lesson', 'goal', 'gate', 'touch', 'checkpoint', 'reset', 'answer', 'speech'];

/** The checks of the lessons of one recording added up: every event, frame and difference counted once; ok only when every lesson is. */
export function mergeChecks(checks: readonly ReplayCheck[]): ReplayCheck {
    if (checks.length === 1) return checks[0] as ReplayCheck;
    const sum = (f: (c: ReplayCheck) => number): number => checks.reduce((a, c) => a + f(c), 0);
    const byKind = {} as Record<ComparedKind, KindCount>;
    for (const k of KINDS) byKind[k] = { recorded: sum((c) => c.events.byKind[k]?.recorded ?? 0), derived: sum((c) => c.events.byKind[k]?.derived ?? 0), matched: sum((c) => c.events.byKind[k]?.matched ?? 0) };
    const frames = sum((c) => c.cues.frames);
    const agreeing = sum((c) => c.cues.agreeing);
    const classAgreeing = sum((c) => c.cues.classShare * c.cues.frames);
    const notes: ReplayNote[] = [];
    for (const n of checks.flatMap((c) => c.notes)) if (!notes.some((m) => m.code === n.code && m.message === n.message)) notes.push(n);
    return {
        ok: checks.every((c) => c.ok),
        tolerances: (checks[0] as ReplayCheck).tolerances,
        events: {
            recorded: sum((c) => c.events.recorded),
            derived: sum((c) => c.events.derived),
            matched: sum((c) => c.events.matched),
            hostOnly: sum((c) => c.events.hostOnly),
            maxDeltaMs: Math.max(0, ...checks.map((c) => c.events.maxDeltaMs)),
            byKind,
            diffs: checks.flatMap((c) => c.events.diffs)
        },
        cues: {
            frames,
            identical: sum((c) => c.cues.identical),
            agreeing,
            share: frames === 0 ? 1 : agreeing / frames,
            classShare: frames === 0 ? 1 : classAgreeing / frames,
            mismatches: checks.flatMap((c) => c.cues.mismatches).slice(0, 20)
        },
        exact: checks.every((c) => c.exact),
        notes
    };
}

export async function checkPackage(pkg: CheckedPackage, run: CheckRun = {}): Promise<ReplayOutcome> {
    const now = run.now ?? ((): number => performance.now());
    const t0 = now();
    const failed = (code: string, message: string): ReplayOutcome => ({ setup: null, segments: [], check: null, line: '', error: { code, message }, tookMs: now() - t0 });
    if (pkg.frames.length === 0) return failed('frames', 'the recording has no flight frames');
    const pieces = lessonSegments(pkg).filter((s) => s.frames.length > 0);
    const every = Math.max(1, run.yieldEvery ?? 240);
    const yieldFn = run.yieldFn ?? nextTask;
    const done: CheckedSegment[] = [];
    const lines: string[] = [];
    let n = 0;
    for (const seg of pieces) {
        const compared = !(seg.lead && pieces.length > 1);
        let setup: ReplaySetup;
        try {
            setup = rebuildSession(seg.manifest, optionsFor(seg, run));
        } catch (e) {
            if (e instanceof ReplayError) return failed(e.code, e.message);
            throw e;
        }
        if (!compared) {
            done.push({ segment: seg, setup, check: null });
            lines.push(`${seg.lessonId ?? '-'}: began before the recording (its lesson open is not in it): replayed, not compared`);
            continue;
        }
        const part = { manifest: seg.manifest, frames: seg.frames, events: seg.events };
        const replayer = new Replayer({ setup, frames: part.frames, events: part.events, ...(run.progress === undefined ? {} : { progress: run.progress }), ...(run.seed === undefined ? {} : { seed: run.seed }) });
        while (replayer.step() !== null) if (++n % every === 0) await yieldFn();
        const check = compareReplay(part, replayer.result(), setup.exact, { ...DEFAULT_TOLERANCES, ...run.tolerances });
        done.push({ segment: seg, setup, check });
        lines.push(pieces.length === 1 ? formatReplayCheck(check) : `${seg.lessonId ?? '-'}: ${formatReplayCheck(check)}`);
    }
    const first = done[0];
    const checks = done.flatMap((d) => (d.check === null ? [] : [d.check]));
    if (first === undefined || checks.length === 0) return failed('frames', 'the recording has no flight frames');
    return { setup: first.setup, segments: done, check: mergeChecks(checks), line: lines.join('\n'), error: null, tookMs: now() - t0 };
}
