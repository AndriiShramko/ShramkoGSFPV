// The lesson host (v0.12, docs/wip/v12-plan.md 4.2 step 9; spec sections 3 and 5): the sound package's lessons run in the
// flight page. A lesson is data (world, assists, layers, goals, checkpoints, spoken lines); the package's LessonRunner
// is the pure state machine that plays it; this file is the host the runner's header describes:
//
//   open       builds the lesson's world (src/sonic/lesson-world.ts), swaps the flown session when the walls differ,
//              draws the helper's view (primitives.ts), makes the runner with the pilot's saved progress, resets the engine
//              (v0.13: it forgets the last lesson's sounds before the clock starts again), and enters the mode (assists to
//              the input, layers to the bridge, crash off, R, N, [ ]): the runner begins and its first actions are taken at
//              once.
//   frame      once per rendered frame while the flight runs: runner.step(sample, world), its events out (ctx.events
//              'sonicEvent'), its actions carried out, and what the engine hears this frame: a module-0 scene's demo
//              frame, or the craft in its world with the runner's next gate. A paused flight is not stepped (the
//              lesson's clock waits with it, and the recorder keeps no paused frames).
//   actions    say -> the bridge's speech queue (interrupt passed on; when the queue runs empty the bridge reports the
//              speech.end marker and runner.spoken), cue -> the engine, place -> the mode's respawn path (a logged
//              'manual-start' life), ask -> digits answer it (0 skips), scene -> the demo frames feed the engine.
//   progress   saved in the prefs collection at every attempt and block and at the pass; the lesson the pilot is on is
//              saved as current.
//   after      a passed lesson is followed (once its pass line is spoken) by the next lesson on the pilot's path, the
//              full ladder's when it was opened off the path, and by the start screen at the end of the ladder. G opens
//              the sound glossary and comes back to the lesson it left; I says where the pilot is; Z says the step's task
//              again (v0.13: the runner's repeat, its sounds three times; it was the last line).
//   go         (v0.13 W4) the runner's way out of a lesson: N from its last step (flying, the last sound, after the pass) and
//              the lesson menu's next lesson give 'go next', B from its first step and the menu's previous lesson 'go
//              previous'. 'next' is the way on after a pass (advance: the lesson G left first, then the lesson after this one
//              on the pilot's path); 'previous' the lesson G left too, else the lesson before on the path, else the start
//              screen. A runner moves the pilot once: a 'go' after the pass's own move (or a second 'go') changes nothing.
// Every call into the runner goes out as the events the replay needs (the bridge's markers), so a recorded lesson re-derives.
import { SCAN_FREE_ID, createLessonRunner, getLesson, isShippedLesson, lessonAfter, lessonBefore } from '@shramko/sonic-fpv';
import type { DemoScene, FlightSample, LessonDef, LessonSession, Locale, Pose, Question, RunnerAction, RunnerOptions, SessionEvent, SonicObject, SonicWorld, SpeechLine } from '@shramko/sonic-fpv';
import { lessonQuery } from '@gsfpv/scenes/sonic-link';
import type { SonicLinkSound } from '@gsfpv/scenes/sonic-link';
import type { FlightSession } from '../session';
import { writeAddress } from './address';
import { pageLink } from './mode-keys';
import { lessonFlightWorld } from './lesson-world';
import type { LessonWorld } from './lesson-world';
import type { SonicMode } from './mode';
import { worldPrims } from './primitives';
import type { Prim } from './primitives';
import { isScanCourse, scanCourseLesson, voxelCm, wallsAreCoarse } from './scan-lesson';
import type { ScanLesson } from './scan-lesson';
import type { CourseAnswer } from './course-ask';
import { savedProgress, saveProgress, setCurrentLesson } from './store';
import type { SonicHost } from './store';
import { DEFAULT_LESSON_START_KEYS } from './key-names';
import type { LessonStartKeys, RunnerKeys } from './key-names';

/** After a pass the next lesson opens when the speech queue has been empty this long, ms. */
export const NEXT_AFTER_MS = 1500;
/** The events the page keeps for the test hook, at most. */
export const EVENT_LOG_CAP = 600;

/** What the host draws the helper's view with (PrimitiveStage; a recorder in tests). */
export interface StagePort {
    show(prims: readonly Prim[]): void;
    setTarget(id: string | null): void;
    clear(): void;
}

/** What the lesson host needs of the page. */
export interface LessonPage {
    readonly mode: SonicMode;
    readonly store: SonicHost;
    readonly locale: Locale;
    readonly stage: StagePort;
    /**
     * Every event of the mode, as the bridge sends it (ctx.events 'sonicEvent'): the runner's own, the host's markers. The
     * host watches all of them, not only the ones its own frames produce: an answer skipped by N, the events of a reset or
     * of a line that ended, come through the bridge without passing the host's frame.
     */
    onEvent(cb: (e: SessionEvent) => void): () => void;
    /** the pilot's path (SonicPrefs.path) */
    path(): 'full' | 'fast';
    /** the session flown now */
    session(): FlightSession;
    /** Replaces the flown session with one on this world (a lesson with other walls); resolves when it flies. */
    swapTo(world: LessonWorld): Promise<void>;
    /**
     * A scan lesson's world over the scan the page flies, with the track's gates and start (module 7): the page brings the
     * scan to the lesson's size first (it may load it, which takes a while), and resolves when the craft flies it; null
     * when the page cannot fly a scan. A scan that does not load rejects, and the lesson does not open.
     */
    scanLesson(lesson: LessonDef): Promise<ScanLesson | null>;
    /**
     * A course of gates in the scan flown now, for the free flight over a scan (train 2, S3: N there asks for one; course-ask.ts),
     * and the name of that key as the pilot's keyboard types it. Absent: N in a free flight goes to the menu, as before.
     */
    course?: { ask(): Promise<CourseAnswer>; key(): string };
    /** The start screen over the flight. */
    showMenu(): void;
    /** Milliseconds, for the pause between a pass and the next lesson (performance.now). */
    clock(): number;
    /** the sound settings a shared link set that still stand (SonicSetup.visit), which the address of a lesson keeps (review R2) */
    visit?(): SonicLinkSound;
    /** the names of the pilot's keys N, B and Z as his keyboard layout types them (key-names.ts); absent: N, B and Z */
    keyNames?(): RunnerKeys;
    /** the pilot's speaking speed (SonicPrefs.speechRate); absent: 1 */
    speechRate?(): number;
    /** the names of the keys the line at every step's start says (key-names.ts lessonStart); absent: N, B, Z, Escape, X */
    lessonKeys?(): LessonStartKeys;
    /** the pilot's "Key hints" (SonicState.keyHints, key-hints.ts): false leaves the line of keys out; absent: on */
    keyHints?(): boolean;
}

/** Where a lesson is opened from and with what: its start and floor (a scan lesson's own), a scan's gates, the way back of G. */
export interface RunnerPlace {
    readonly start: Pose;
    readonly floorY: number;
    readonly objects: readonly SonicObject[] | null;
    /** the lesson the pilot left with G (this one is the glossary, a detour), or null */
    readonly returnTo: string | null;
}

/**
 * What the sound package's runner of a lesson is made with (v0.13 W3, the package's RunnerOptions): the pilot's saved progress,
 * his path (the lesson's place on it, "Lesson 6 of 28", and the lesson a pass names next), his speaking speed (how long a line is
 * waited for when no end of speech comes), the names of his keys (the lines say "Press N"), and the lesson G left: the glossary
 * opened from a lesson is a detour whose ways out lead back there, and leaving it forward does not mark it skipped (review R3).
 */
export function runnerOptions(page: Pick<LessonPage, 'locale' | 'store' | 'path' | 'keyNames' | 'speechRate'>, lessonId: string, place: RunnerPlace, sessionStartMs: number): RunnerOptions {
    return {
        locale: page.locale,
        progress: savedProgress(page.store, lessonId),
        sessionStartMs,
        start: place.start,
        floorY: place.floorY,
        ...(place.objects ? { objects: place.objects } : {}),
        path: page.path(),
        speechRate: page.speechRate?.() ?? 1,
        ...(page.keyNames ? { keys: page.keyNames() } : {}),
        returnTo: place.returnTo
    };
}

export class LessonHost {
    lesson: LessonDef | null = null;
    runner: LessonSession | null = null;
    world: SonicWorld | null = null;
    /**
     * The world the engine and the runner are given each frame: the lesson's own; NONE for module 0 (its sources are placed by the lesson
     * alone, and the replay rebuilds the lesson with no world). The floor the page flies the craft over (`world`, for the craft and the
     * helper's view) is not heard there: it would make the engine voice a hazard (`safety.floor:down`) between the glossary's previews
     * that no replay can re-derive, so a recording of ears-glossary replayed with 0 % of its sounds the same (v12-int step 7).
     */
    private soundWorld: SonicWorld | null = null;
    /** the scan lesson running now (module 7): its world over the scan, gates, start and floor; null for any other lesson */
    scan: ScanLesson | null = null;
    /** what the helper's view shows for the lesson running now (drawn again after a replay drew other lessons: redraw) */
    private shownPrims: readonly Prim[] = [];
    private readonly p: LessonPage;
    private readonly worlds = new Map<string, LessonWorld>();
    private floorY = 0;
    private question: Question | null = null;
    private demo: DemoScene | null = null;
    private busy = false;
    /**
     * Set while a lesson is being entered with lines of the one left still in the speech queue: the new lesson's first line
     * interrupts them (open()). Never set otherwise: after a pass the queue is empty and nothing is cut.
     */
    private cutSpeech = false;
    /** a lesson is being left through G: it comes back after the glossary */
    private returnTo: string | null = null;
    private passedAt: number | null = null;
    /**
     * The runner the pilot was moved on from (its 'go', or the move after its pass): nothing moves him from it again (W4). A 'go'
     * pressed while the pass's own move opens the next lesson would otherwise open a lesson (or the start screen) over it.
     */
    private movedFrom: LessonSession | null = null;
    /**
     * The line of keys (v0.13 B6, M41-3; lane sonic-hints, the owner's complaint of 2026-11-10): said right after the first line of
     * every step (a lesson's first line is its title), never again inside that step: "Next, key N. Back, key B. Repeat, key Z.
     * Menu, key Escape. Main menu, key X." with the pilot's names of those keys. `hintStep` is the step it was last said for (null: a lesson just opened). The
     * pilot's "Key hints: off" (SonicState.keyHints false) leaves it out.
     */
    private hintStep: string | null = null;
    /**
     * The runner whose counts the pilot reset (v13-int step 5: "Reset my progress" answered Yes on the start screen shown over this
     * lesson). The screen cleared the saved progress, but this runner still holds the lesson's old counts: nothing of it is saved again
     * (at its next attempt, block or pass, nor when it is left), and the lesson starts again from nothing (restartAfterScreen) when the
     * flight goes on, or another lesson opens. Null otherwise.
     */
    private forgotten: LessonSession | null = null;
    /**
     * The runner that left for the start screen (review F3): its 'go' had nowhere to lead (B at the first step of the path's first lesson,
     * N at its last lesson not passed, the menu's Next lesson there) or the ladder ended after its pass. Once left, a runner ignores every
     * key, so when the screen is closed without a lesson chosen, the lesson starts again from its beginning (restartAfterScreen) instead
     * of staying dead behind its progress panel. Null otherwise.
     */
    private stranded: LessonSession | null = null;

    constructor(page: LessonPage) {
        this.p = page;
        page.mode.bridge.afterRunner = () => this.drain();
        page.onEvent((e) => this.observe(e));
    }

    /** The free flight over a scan link's scan (train 2, start.ts freeLessonOf): opened by its id SCAN_FREE_ID, never on a path. */
    private free: LessonDef | null = null;
    /** The free flight as it was opened, without a course: what a course is made from and what a failed ask goes back to. */
    private freeBase: LessonDef | null = null;

    /** Opens the free flight over a scan (scanFreeLesson): no track, no target, the scan's own spawn, the walls and height heard. */
    openFree(lesson: LessonDef): Promise<boolean> {
        if (lesson.id !== SCAN_FREE_ID) return Promise.resolve(false);
        this.free = lesson;
        this.freeBase = lesson;
        return this.open(SCAN_FREE_ID);
    }

    /**
     * N in a free scan flight (train 2, S3): a course of gates in this scan (the page's course.ask), flown by sound as a timed course
     * (scanCourseLesson); N in it asks for another. No course (no walls, none fits, the worker failed): said, and the free flight again.
     * False when the page asks for none (the caller goes to the menu).
     */
    private async flyCourse(): Promise<boolean> {
        const course = this.p.course;
        const base = this.freeBase;
        if (!course || !base) return false;
        const say = (line: SpeechLine): void => void this.p.mode.bridge.say(line, false, { lesson: true });
        say({ key: 'sonic.say.courseMaking' });
        const a = await course.ask();
        if (!a.ok) {
            say({ key: a.why === 'no walls' ? 'sonic.say.scanNoWalls' : 'sonic.say.courseNone' });
            this.free = base;
            return this.open(SCAN_FREE_ID, { keepSpeech: true });
        }
        this.free = scanCourseLesson(base, a.track);
        const ok = await this.open(SCAN_FREE_ID);
        if (ok) say({ key: 'sonic.say.courseReady', params: { n: a.track.gates.length, laps: a.track.laps, key: course.key() } });
        return ok;
    }

    /** A lesson world built before the page (the entry's first flight is made on it), so the first open does not build it again. */
    seed(lessonId: string, world: LessonWorld): void {
        this.worlds.set(lessonId, world);
    }

    /** A lesson is running (its runner exists and the mode is on). */
    get active(): boolean {
        return this.runner !== null;
    }

    /** A question waits for digits. */
    get asking(): boolean {
        return this.question !== null;
    }

    get pending(): Question | null {
        return this.question;
    }

    /** The module-0 scene on now, if any. */
    get scene(): DemoScene | null {
        return this.demo;
    }

    private worldOf(lesson: LessonDef): LessonWorld {
        let w = this.worlds.get(lesson.id);
        if (!w) {
            const built = lessonFlightWorld(lesson);
            if (!built) throw new Error(`lesson ${lesson.id} has no world of its own`);
            w = built;
            this.worlds.set(lesson.id, w);
        }
        return w;
    }

    // ------------------------------------------------------------------ opening a lesson

    /** Opens a lesson: its world flown, the helper's view drawn, the runner begun. Never throws for the pilot's sake: the reason goes to the console. */
    async open(lessonId: string, o: { returnTo?: string | null; keepSpeech?: boolean } = {}): Promise<boolean> {
        const free = lessonId === SCAN_FREE_ID ? this.free : null;
        if (this.busy || !(free || isShippedLesson(lessonId))) return false;
        this.busy = true;
        try {
            const lesson = free ?? getLesson(lessonId);
            this.finish();
            let world: SonicWorld;
            let floorY = 0;
            let start: Pose = lesson.start;
            let objects: readonly SonicObject[] | null = null;
            let scan: ScanLesson | null = null;
            if (lesson.world.kind === 'scan') {
                scan = await this.p.scanLesson(lesson);
                if (!scan) throw new Error(`lesson ${lessonId} flies a scan and the page flies none`);
                world = scan.world;
                floorY = scan.floorY;
                start = scan.start;
                objects = scan.objects;
                // the track's gates over the scan: what a helper sees of what the pilot hears
                this.p.stage.show(scan.prims);
                this.shownPrims = scan.prims;
            } else {
                const lw = this.worldOf(lesson);
                const ses = this.p.session();
                if (!ses.builtin || ses.collisionSha256 !== lw.builtin.sha256) await this.p.swapTo(lw);
                world = lw.world;
                floorY = lw.world.floorY;
                this.shownPrims = worldPrims(lw.world);
                this.p.stage.show(this.shownPrims);
            }
            const runner = createLessonRunner(lesson, runnerOptions(this.p, lessonId, { start, floorY, objects, returnTo: o.returnTo ?? null }, Date.now()));
            this.lesson = lesson;
            this.runner = runner;
            // a new runner is made from what is saved now: its counts are the pilot's again, and it runs
            this.forgotten = null;
            this.stranded = null;
            this.world = world;
            this.soundWorld = lesson.world.kind === 'none' ? null : world;
            this.scan = scan;
            this.floorY = floorY;
            this.question = null;
            this.demo = null;
            this.passedAt = null;
            this.returnTo = o.returnTo ?? null;
            // the free flight is no lesson of the course: Continue keeps its lesson, and the address stays the scan link it came from
            if (!free) {
                setCurrentLesson(this.p.store, lessonId);
                this.url(lesson);
            }
            // G, or a lesson chosen on the start screen, while the lesson left is still talking: its queued lines (a lesson says
            // four to six at once when it opens) would be heard first, a minute of them, before this lesson's own. The new
            // lesson's first line cuts them, as N and an answer do inside a lesson; the bridge counts lines per run (review D2)
            this.cutSpeech = o.keepSpeech !== true && this.p.mode.bridge.speechQueue > 0;
            this.hintStep = null;
            // the bridge's clock starts at 0 for this lesson: the engine first forgets what it heard on the last one's clock (v13-int step
            // 1, v13-host's need 2: its scene sampler keeps an active sector 0.3 s on when the clock goes back, so the first frames of this
            // lesson voiced the last one's sectors with these walls, which the replay, a new planner per lesson, does not derive). Before
            // enter(): the runner's first actions (a sound of its first step) go to the engine after it, on the new clock
            this.p.mode.bridge.engine?.reset?.();
            try {
                // enter() starts the bridge (the clock at 0), begins the runner and, through afterRunner, takes its first actions
                this.p.mode.enter({ lesson, runner, world, floorY });
            } finally {
                this.cutSpeech = false;
            }
            if (scan) {
                // a scan's craft waits at the scan's own spawn: it goes to the track's start now, not when the first attempt begins
                this.p.mode.place(start);
                // the walls are as fine as the scan's file: said plainly, after the intro
                if (wallsAreCoarse(scan.voxelM)) void this.p.mode.bridge.say({ key: 'sonic.say.wallsCoarse', params: { cm: voxelCm(scan.voxelM as number) } }, false, { lesson: true });
                // a free flight over a scan that has no walls (train 2): no wall can warn, said and shown (the captions), with the way to get them
                if (free && scan.voxelM === null) void this.p.mode.bridge.say({ key: 'sonic.say.scanNoWalls' }, false, { lesson: true });
                // train 2, S3: the free flight with walls names the key that asks for a course of gates in this scan (flyCourse)
                else if (free && !isScanCourse(lesson) && this.p.course) void this.p.mode.bridge.say({ key: 'sonic.say.courseOffer', params: { key: this.p.course.key() } }, false, { lesson: true });
            }
            return true;
        } catch (e) {
            console.warn('fly by sound: the lesson did not open', e);
            return false;
        } finally {
            this.busy = false;
        }
    }

    /**
     * The address names the lesson that runs (a reload reopens the start screen offering it): its own link, with its scan and size
     * only when it flies one and only the link's sound settings that still stand (review R2: never the scene, size or sound of the
     * link or lesson it came from, nor a setting the pilot kept, changed or let go of).
     */
    private url(lesson: LessonDef): void {
        const link = pageLink(lesson, this.p.visit?.() ?? {});
        writeAddress((search) => lessonQuery(search, link));
    }

    /** What the pilot did in the lesson being left is saved (not when he reset his progress over it: its counts are void). */
    private finish(): void {
        if (this.runner && this.runner !== this.forgotten) saveProgress(this.p.store, this.runner.progress());
    }

    /**
     * "Reset my progress" over the lesson running now (v13-int step 5): the start screen has cleared every lesson's saved progress; this
     * lesson's runner, which holds the old counts, saves nothing more, and the lesson starts again from nothing when the flight goes on
     * (restartAfterScreen) or another lesson is opened. Nothing when no lesson runs.
     */
    progressReset(): void {
        this.forgotten = this.runner;
    }

    /**
     * The start screen is closed over the flight (Escape, Back): a lesson whose progress was reset under it (v13-int step 5), or whose
     * runner left for the screen (review F3), starts again from its beginning, a new runner from the progress saved now, the way back of G
     * kept. False when the lesson under the screen still runs (it goes on where it was) or none does.
     */
    restartAfterScreen(): Promise<boolean> {
        const id = this.lesson?.id;
        const run = this.runner;
        if (run === null || id === undefined || (run !== this.forgotten && run !== this.stranded)) return Promise.resolve(false);
        return this.open(id, { returnTo: this.returnTo });
    }

    /** The runner left and nothing comes after it: the start screen, and the lesson starts again if the pilot closes it (review F3). */
    private toMenu(): void {
        this.stranded = this.runner;
        this.p.showMenu();
    }

    /** The lesson ends and the mode with it (the page is going to the menu or away). */
    close(): void {
        this.finish();
        this.forgotten = null;
        this.stranded = null;
        this.runner = null;
        this.lesson = null;
        this.world = null;
        this.soundWorld = null;
        this.scan = null;
        this.shownPrims = [];
        this.question = null;
        this.demo = null;
        this.p.stage.clear();
        this.p.mode.leave();
    }

    /**
     * The lesson running now, opened again from its beginning: a recording has just started (v12-int step 5). The replay re-derives
     * a lesson from its `lesson open`; a lesson that began before the recording has no open in it, and its state then (the attempt,
     * the goals met, what was said) is not in the package, so it could not be heard again as the pilot heard it. Opened again, the
     * whole lesson is in the recording. Its lines queue behind what is being said ("Recording started."), they do not cut it.
     * Saved progress stays (the new runner starts from it), and so does the way back from the glossary (G): it is the pilot's, not the
     * lesson's (review I3: opened again without it, a glossary entered by G went on along the path instead of back to the lesson G left).
     * Nothing when no lesson runs.
     */
    reopen(): Promise<boolean> {
        const id = this.lesson?.id;
        return id === undefined ? Promise.resolve(false) : this.open(id, { keepSpeech: true, returnTo: this.returnTo });
    }

    /** The helper's view of the lesson running now, drawn again (a replay drew the lessons of a recording over it); cleared while none runs. */
    redraw(): void {
        if (this.shownPrims.length === 0) {
            this.p.stage.clear();
            return;
        }
        this.p.stage.show(this.shownPrims);
        const target = this.runner?.target();
        this.p.stage.setTarget(target ? target.id : null);
    }

    // ------------------------------------------------------------------ frames

    /** One rendered frame of the flight (a paused one is not stepped: the lesson waits with the flight). */
    frame(sample: FlightSample): void {
        const run = this.runner;
        if (!run || this.p.mode.inPlayback) return;
        if (sample.paused) return;
        // the runner's events go out through the bridge (the bus), and the host sees them there (observe)
        this.p.mode.bridge.events(run.step(sample, this.soundWorld));
        this.drain();
        const target = run.target();
        // a module-0 scene is the engine's input in place of the craft; else the craft in its world, the next gate its target
        // lane sonic-beacon: and where the target hum points (the target, or the next track point where the goal has no gate or zone)
        const input = run.demoFrame(sample.t) ?? { sample, world: this.soundWorld, target, ...(run.beaconTarget ? { beacon: run.beaconTarget() } : {}), floorY: this.floorY };
        this.p.mode.hear(sample, input);
        this.p.stage.setTarget(target ? target.id : null);
        this.checkPassed();
    }

    /** The line of keys with the pilot's names of them now (a layout may change between steps). */
    keysLine(): SpeechLine {
        return { key: 'sonic.say.lessonKeys', params: { ...(this.p.lessonKeys?.() ?? DEFAULT_LESSON_START_KEYS) } };
    }

    /** What the runner asked of the host, carried out in order. */
    private drain(): void {
        const run = this.runner;
        if (!run) return;
        for (const a of run.takeActions()) this.act(a, run);
    }

    private act(a: RunnerAction, run: LessonSession): void {
        const mode = this.p.mode;
        switch (a.kind) {
            case 'go':
                // the pilot leaves this lesson (the runner is done: its event 'leave' is out). Once per runner, and not while another
                // lesson is being opened; the other lesson opens once this runner has handed out the rest of its actions
                if (this.movedFrom === run) break;
                this.movedFrom = run;
                queueMicrotask(() => {
                    if (this.runner === run && !this.busy) void this.go(a.to);
                });
                break;
            case 'say': {
                // the lesson's own lines (review F1): a host line that cuts them (the lesson menu, K, I, the start screen) has them said again
                void mode.bridge.say(a.line, a.interrupt || this.cutSpeech, { lesson: true });
                // only the first line cuts: the lines after it queue behind it, as the runner meant them to
                this.cutSpeech = false;
                // the first line of a step (a lesson's first line is its title): the step's keys follow it, once a step
                const v = run.view();
                const step = `${v.step}/${v.steps}`;
                if (step !== this.hintStep) {
                    this.hintStep = step;
                    if (this.p.keyHints?.() !== false) void mode.bridge.say(this.keysLine(), false, { lesson: true });
                }
                break;
            }
            case 'cue':
                mode.bridge.engine?.cue(a.event);
                break;
            case 'place':
                mode.place(a.pose);
                break;
            case 'ask':
                this.question = a.question;
                break;
            case 'scene':
                this.demo = a.scene;
                break;
        }
    }

    /** An event of the mode: progress is saved at every attempt, block and pass; an answer (or a skip) closes the question. */
    private observe(e: SessionEvent): void {
        const run = this.runner;
        if (!run) return;
        if (e.kind === 'answer') this.question = null;
        else if (e.kind === 'lesson' && (e.what === 'attempt-pass' || e.what === 'attempt-fail' || e.what === 'block-pass' || e.what === 'passed')) {
            // a runner whose counts the pilot reset saves nothing (v13-int step 5)
            if (run !== this.forgotten) saveProgress(this.p.store, run.progress());
            if (e.what === 'passed') this.passedAt = null;
        }
    }

    /** The lesson is passed and its pass line has been said: the next lesson (or the menu at the end); not after a 'go' of its own. */
    private checkPassed(): void {
        const run = this.runner;
        if (!run || run.phase !== 'passed' || this.busy || this.movedFrom === run) return;
        const bridge = this.p.mode.bridge;
        if (bridge.speechQueue > 0) {
            this.passedAt = null;
            return;
        }
        const now = this.p.clock();
        this.passedAt ??= now;
        if (now - this.passedAt < NEXT_AFTER_MS) return;
        this.passedAt = null;
        void this.advance();
    }

    /**
     * After a pass, and 'go next': the lesson left for the glossary, else the lesson after this one on the pilot's path (the full
     * ladder's when this one is off the path: lessonAfter, the lesson the runner's pass line names), else the menu.
     */
    async advance(): Promise<void> {
        const id = this.lesson?.id;
        if (!id) return;
        this.movedFrom = this.runner;
        if (this.returnTo) {
            const back = this.returnTo;
            this.returnTo = null;
            if (await this.open(back)) return;
        }
        // the free flight over a scan has no lesson after it on any path: N asks for a course in it (S3), else the menu
        if (id === SCAN_FREE_ID && (await this.flyCourse())) return;
        const next = id === SCAN_FREE_ID ? null : lessonAfter(id, this.p.path());
        if (next && (await this.open(next.id))) return;
        this.toMenu();
    }

    /**
     * A runner's 'go' (W4): 'next' is advance(); 'previous' is the way back too (the lesson G left: B on a detour goes back where the
     * pilot came from, not to the lesson before the glossary on the ladder), else the lesson before this one on the path, else the menu.
     */
    private async go(to: 'next' | 'previous'): Promise<void> {
        if (to === 'next') return this.advance();
        const id = this.lesson?.id;
        if (!id) return;
        this.movedFrom = this.runner;
        if (this.returnTo) {
            const back = this.returnTo;
            this.returnTo = null;
            if (await this.open(back)) return;
        }
        const before = id === SCAN_FREE_ID ? null : lessonBefore(id, this.p.path());
        if (before && (await this.open(before.id))) return;
        this.toMenu();
    }

    // ------------------------------------------------------------------ the pilot's keys

    /**
     * A digit goes to the runner whenever a lesson runs (sonic-keys): it answers the question asked, or the one after the sound
     * playing now (the headphone check), and the runner acknowledges it ("Taken" or "Not taken", with its sound). False with no lesson.
     */
    answer(n: number): boolean {
        const run = this.runner;
        if (!run) return false;
        const bridge = this.p.mode.bridge;
        bridge.events(run.answer(n, 'key', bridge.now()));
        this.drain();
        return true;
    }

    /**
     * I (v0.13 W6, M41-7): where the pilot is, as the runner says it: "Lesson 6 of 28: Hold your height. Step 2 of 2. Attempt 2.
     * Counted 0 of 3." (its lesson and step only in a lesson without a world); "No lesson is running." when none runs.
     */
    status(): SpeechLine {
        const run = this.runner;
        return run ? run.statusLine() : { key: 'status.none' };
    }

    /** Z (v0.13 W5): the step's whole task again, its named sounds three times, through the runner (recorded as the key 'repeat'). */
    repeat(): void {
        this.p.mode.repeat('KeyZ');
    }

    /** G: the sound glossary, and back to the lesson it interrupted. */
    glossary(): Promise<boolean> {
        const back = this.lesson && this.lesson.id !== 'ears-glossary' ? this.lesson.id : this.returnTo;
        return this.open('ears-glossary', { returnTo: back });
    }
}
