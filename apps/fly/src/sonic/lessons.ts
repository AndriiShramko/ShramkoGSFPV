// The lesson host (v0.12, docs/wip/v12-plan.md 4.2 step 9; spec sections 3 and 5): the sound package's lessons run in the
// flight page. A lesson is data (world, assists, layers, goals, checkpoints, spoken lines); the package's LessonRunner
// is the pure state machine that plays it; this file is the host the runner's header describes:
//
//   open       builds the lesson's world (src/sonic/lesson-world.ts), swaps the flown session when the walls differ,
//              draws the helper's view (primitives.ts), makes the runner with the pilot's saved progress, and enters
//              the mode (assists to the input, layers to the bridge, crash off, R, N, [ ]): the runner begins and its
//              first actions are taken at once.
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
//              the sound glossary and comes back to the lesson it left; I says where the pilot is; Z says the last line.
// Every call into the runner goes out as the events the replay needs (the bridge's markers), so a recorded lesson re-derives.
import { DICTS, createLessonRunner, createTranslator, getLesson, isShippedLesson, nextLesson } from '@shramko/sonic-fpv';
import type { DemoScene, FlightSample, LessonDef, LessonSession, Locale, Pose, Question, RunnerAction, SessionEvent, SonicObject, SonicWorld, SpeechLine } from '@shramko/sonic-fpv';
import type { FlightSession } from '../session';
import { lessonFlightWorld } from './lesson-world';
import type { LessonWorld } from './lesson-world';
import type { SonicMode } from './mode';
import { worldPrims } from './primitives';
import type { Prim } from './primitives';
import { voxelCm, wallsAreCoarse } from './scan-lesson';
import type { ScanLesson } from './scan-lesson';
import { savedProgress, saveProgress, setCurrentLesson } from './store';
import type { SonicHost } from './store';

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
    /** The start screen over the flight. */
    showMenu(): void;
    /** Milliseconds, for the pause between a pass and the next lesson (performance.now). */
    clock(): number;
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
    private readonly tr: ReturnType<typeof createTranslator>;

    constructor(page: LessonPage) {
        this.p = page;
        this.tr = createTranslator(page.locale, DICTS);
        page.mode.bridge.afterRunner = () => this.drain();
        page.onEvent((e) => this.observe(e));
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
        if (this.busy || !isShippedLesson(lessonId)) return false;
        this.busy = true;
        try {
            const lesson = getLesson(lessonId);
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
            const runner = createLessonRunner(lesson, {
                locale: this.p.locale,
                progress: savedProgress(this.p.store, lessonId),
                sessionStartMs: Date.now(),
                start,
                floorY,
                ...(objects ? { objects } : {})
            });
            this.lesson = lesson;
            this.runner = runner;
            this.world = world;
            this.soundWorld = lesson.world.kind === 'none' ? null : world;
            this.scan = scan;
            this.floorY = floorY;
            this.question = null;
            this.demo = null;
            this.passedAt = null;
            this.returnTo = o.returnTo ?? null;
            setCurrentLesson(this.p.store, lessonId);
            this.url(lessonId);
            // G, or a lesson chosen on the start screen, while the lesson left is still talking: its queued lines (a lesson says
            // four to six at once when it opens) would be heard first, a minute of them, before this lesson's own. The new
            // lesson's first line cuts them, as N and an answer do inside a lesson; the bridge counts lines per run (review D2)
            this.cutSpeech = o.keepSpeech !== true && this.p.mode.bridge.speechQueue > 0;
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
                if (wallsAreCoarse(scan.voxelM)) void this.p.mode.bridge.say({ key: 'sonic.say.wallsCoarse', params: { cm: voxelCm(scan.voxelM as number) } });
            }
            return true;
        } catch (e) {
            console.warn('fly by sound: the lesson did not open', e);
            return false;
        } finally {
            this.busy = false;
        }
    }

    private url(lessonId: string): void {
        try {
            const u = new URL(location.href);
            u.searchParams.set('sonic', lessonId);
            history.replaceState(history.state, '', u);
        } catch {
            /* no history (a test): the address stays */
        }
    }

    /** What the pilot did in the lesson being left is saved. */
    private finish(): void {
        if (this.runner) saveProgress(this.p.store, this.runner.progress());
    }

    /** The lesson ends and the mode with it (the page is going to the menu or away). */
    close(): void {
        this.finish();
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
        const input = run.demoFrame(sample.t) ?? { sample, world: this.soundWorld, target, floorY: this.floorY };
        this.p.mode.hear(sample, input);
        this.p.stage.setTarget(target ? target.id : null);
        this.checkPassed();
    }

    /** What the runner asked of the host, carried out in order. */
    private drain(): void {
        const run = this.runner;
        if (!run) return;
        for (const a of run.takeActions()) this.act(a);
    }

    private act(a: RunnerAction): void {
        const mode = this.p.mode;
        switch (a.kind) {
            case 'say':
                void mode.bridge.say(a.line, a.interrupt || this.cutSpeech);
                // only the first line cuts: the lines after it queue behind it, as the runner meant them to
                this.cutSpeech = false;
                break;
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
            saveProgress(this.p.store, run.progress());
            if (e.what === 'passed') this.passedAt = null;
        }
    }

    /** The lesson is passed and its pass line has been said: the next lesson (or the menu at the end). */
    private checkPassed(): void {
        const run = this.runner;
        if (!run || run.phase !== 'passed' || this.busy) return;
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

    /** After a pass: the lesson left for the glossary, else the next on the path, else the full ladder's, else the menu. */
    async advance(): Promise<void> {
        const id = this.lesson?.id;
        if (!id) return;
        if (this.returnTo) {
            const back = this.returnTo;
            this.returnTo = null;
            if (await this.open(back)) return;
        }
        const next = nextLesson(id, this.p.path()) ?? nextLesson(id, 'full');
        if (next && (await this.open(next.id))) return;
        this.p.showMenu();
    }

    // ------------------------------------------------------------------ the pilot's keys

    /** A digit answers the question asked; 0 skips it. False when nothing was asked (the key is not ours). */
    answer(n: number): boolean {
        const run = this.runner;
        if (!run || !this.question) return false;
        const bridge = this.p.mode.bridge;
        bridge.events(run.answer(n, 'key', bridge.now()));
        this.drain();
        return true;
    }

    /** I: where the pilot is, as a line to say. */
    status(): SpeechLine {
        const run = this.runner;
        const lesson = this.lesson;
        if (!run || !lesson) return { key: 'status.none' };
        return { key: 'status.lesson', params: { title: this.tr.text(lesson.title), n: Math.max(1, run.attempt) } };
    }

    /** Z: the last line again. */
    repeat(): Promise<void> {
        return this.p.mode.bridge.repeat();
    }

    /** G: the sound glossary, and back to the lesson it interrupted. */
    glossary(): Promise<boolean> {
        const back = this.lesson && this.lesson.id !== 'ears-glossary' ? this.lesson.id : this.returnTo;
        return this.open('ears-glossary', { returnTo: back });
    }
}
