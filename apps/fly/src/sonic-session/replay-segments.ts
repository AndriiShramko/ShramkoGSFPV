// A recording lesson by lesson (v0.12, docs/wip/v12-int.md step 5). A recording usually spans several lessons: a pass
// moves the pilot on along the path, N and the start screen move on too. Each lesson is a new enter() of the mode, a new
// clock of the bridge and a new `lesson open` event, while the recorder keeps ONE package (one consent, one voice track
// without a gap, one survey, one upload) and carries the host clock's jumps onto its own clock. The sound package's
// replay core runs one lesson; so a package is cut here, at replay time, at its `lesson open` events, and each piece is
// replayed against its own lesson and world (replay-check.ts, replay-player.ts), on the package's one clock with its one
// voice.
//
//   lead      the frames before the first `lesson open` belong to the lesson that ran when the recording started (the
//             manifest's: a recording begun in the middle of a lesson has no open event of it)
//   segment   from each `lesson open` to the next one (its frames by time, its events by their place in events.jsonl,
//             which is the order the host sent them in), with a manifest that names that lesson and its world
import type { FlightFrame, LessonDef, SessionEvent, SessionManifest } from '@shramko/sonic-fpv';
import { createAnalyticWorld, getLesson } from '@shramko/sonic-fpv';

export interface LessonSegment {
    /** 0-based, in the order flown */
    readonly index: number;
    /** the lesson of the piece (null: the recording started with no lesson running) */
    readonly lessonId: string | null;
    /** true for the lead: the lesson that ran when the recording started, whose open is not in the recording */
    readonly lead: boolean;
    /** package time the piece starts at (its `lesson open`; the first frame for the lead) */
    readonly fromT: number;
    /** index of its first frame among the package's frames */
    readonly firstFrame: number;
    readonly frames: readonly FlightFrame[];
    readonly events: readonly SessionEvent[];
    /** the package's manifest with this piece's lesson, scene and track (the lead's is the package's own) */
    readonly manifest: SessionManifest;
}

export interface SegmentedPackage {
    readonly manifest: SessionManifest;
    readonly frames: readonly FlightFrame[];
    readonly events: readonly SessionEvent[];
}

const IDENTITY = [1, 0, 0, 0] as const;

/** The manifest as if the package held only this lesson: its id and version, its world as the scene, its track. */
function manifestOf(base: SessionManifest, lessonId: string, version: number): SessionManifest {
    let lesson: LessonDef | null = null;
    try {
        lesson = getLesson(lessonId);
    } catch {
        // an unknown lesson: the replay core refuses it by name (rebuildSession: unknown-lesson), with today's sentence
    }
    const path = base.lesson?.path ?? base.settings.path;
    if (lesson === null) return { ...base, lesson: { id: lessonId, version, path } };
    const w = lesson.world;
    let scene: SessionManifest['scene'];
    if (w.kind === 'analytic') {
        const world = createAnalyticWorld(w.spec);
        scene = { kind: 'analytic', id: world.id, version: world.version, transform: IDENTITY };
    } else if (w.kind === 'scan') {
        scene = { kind: 'scan', id: w.sceneId, version: base.scene.kind === 'scan' && base.scene.id === w.sceneId ? base.scene.version : (w.sceneVersion ?? 0), transform: w.transform };
    } else scene = { kind: 'none', id: 'none', version: 1, transform: IDENTITY };
    return { ...base, lesson: { id: lessonId, version, path }, scene, track: w.kind === 'scan' ? w.track : null, assists: lesson.assists };
}

/** The pieces of a package, one per lesson flown in it, in order. A package of one lesson is one piece, the package itself. */
export function lessonSegments(pkg: SegmentedPackage): LessonSegment[] {
    const { manifest, frames, events } = pkg;
    const opens: { at: number; t: number; lessonId: string; version: number }[] = [];
    events.forEach((e, at) => {
        if (e.kind === 'lesson' && e.what === 'open') opens.push({ at, t: e.t, lessonId: e.lessonId, version: e.version });
    });
    const own = manifest.lesson;
    const firstT = frames[0]?.t ?? 0;
    type Start = { at: number; t: number; lessonId: string | null; version: number; lead: boolean };
    const starts: Start[] = opens.map((o) => ({ ...o, lead: false }));
    // the lead: frames before the first open (or no open at all) are the lesson that ran when the recording started
    if (starts.length === 0 || firstT < (starts[0] as Start).t) starts.unshift({ at: 0, t: -Infinity, lessonId: own?.id ?? null, version: own?.version ?? 0, lead: true });
    // a package of one lesson stays the package itself, its manifest naming the lesson as before (the events before its open, session
    // and recording start, are its)
    if (starts.length === 1) {
        const only = starts[0] as Start;
        return [{ index: 0, lessonId: own?.id ?? null, lead: only.lead, fromT: firstT, firstFrame: 0, frames, events, manifest }];
    }
    // the events before the first open go with the first piece (they are the host's: session and recording start)
    (starts[0] as Start).at = 0;
    const out: LessonSegment[] = [];
    let f = 0;
    starts.forEach((s, k) => {
        const next = starts[k + 1];
        const endT = next === undefined ? Infinity : next.t;
        const from = f;
        while (f < frames.length && (frames[f] as FlightFrame).t < endT) f++;
        out.push({
            index: k,
            lessonId: s.lessonId,
            lead: s.lead,
            fromT: s.lead ? firstT : s.t,
            firstFrame: from,
            frames: frames.slice(from, f),
            events: events.slice(s.at, next === undefined ? events.length : next.at),
            manifest: s.lead ? manifest : manifestOf(manifest, s.lessonId as string, s.version)
        });
    });
    return out;
}
