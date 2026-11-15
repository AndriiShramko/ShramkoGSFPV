// Train 1, lane tracks (docs/wip/train1-plan.md): the course in a scan: generated obstacles in the free space, the arrows,
// the lap timer, on and off in flight, saved on the server for the scene. Owner: lane tracks. The feature is registered in
// app/features.ts on the train base, so the lane fills install() here (its code lives in apps/fly/src/course/) and never
// edits features.ts. The page hook it fills is CourseHook (apps/fly/src/course/hook.ts, window.__gsfpv.course).
//
// T2: Shift+G or the pause menu builds a random course in a worker (course/worker.ts) from the flown walls; Shift+T shows
// and hides it; the lap timer (course/run.ts) reads the craft's position and the sim's clock once per drawn frame and
// writes nothing anywhere in the flight (gates are not solid; the trace hash stays: tools/bench/test/tracks-a6.test.ts).
// The course is off until the pilot asks for it. A link `&course=g1.<seed>` rebuilds the same course on the same walls.
// T3: on scene load the server's list for the scene is fetched (course/store.ts); Shift+T without a course (or the pause
// menu) loads the newest saved course, proves it on the pilot's own walls in the worker (checkTrack) and refuses it with
// hook.problem when it does not fit; "Save for everyone" in the pause menu posts the course the pilot generated.
// Train 2, T3-editor-ui (tracks-plan 2.11): Shift+B or the pause menu opens the editor over the paused flight (its own key
// table, course/editor/keys.ts; its window, course/editor/panel.ts): select, move, turn, shape, size, add and delete gates,
// every change re-proven on the walls (packages/tracks editor.ts); "Save as my course" posts a pilot's course (a fork of a
// saved one, or a new version of the pilot's own with the token kept in this tab), the scene's courses with marks and votes.
import type { TrackFile } from '@shramko/sonic-fpv';
import { t } from '../../i18n';
import { liveSearch } from '../env';
import type { Feature, FlightContext } from '../context';
import { withWalls } from '../../walls-first';
import type { CourseHook } from '../../course/hook';
import { CourseRun, courseLife } from '../../course/run';
import { CourseStage } from '../../course/view';
import { CourseHud, lapClock } from '../../course/hud';
import { coveredBy } from '../../course/cover';
import { bestKey, editOfLink, firstOffer, readBest, seedOfLink, servedOfLink, withCourse, writeBest } from '../../course/link';
import { CourseStore, type CourseRow } from '../../course/store';
import type { CheckJob, CourseGrid, CourseJob, FromCourseWorker } from '../../course/worker';
import { COURSE_WARN_MS, PROGRESS_TICK_MS, ProgressClock, SpeechPacer, courseSteps, isParked, progressLine, spokenLine } from '../../course/progress';
import { sayVia } from '../say-via';
import { S } from '@gsfpv/sim-core';
import { MAX_GATES_EDIT, canSave, edit, flownCollision, marginOf, openEditor, toTrackV1, upgradeTrack } from '@gsfpv/tracks';
import { CheckQueue, checkOnPage } from '../../course/editor/check-core';
import type { FromCheckWorker } from '../../course/editor/check-core';
import { aimAt, gateCamera, type GateView } from '../../course/editor/camera';
import type { RayFn } from '../../course/editor/camera';
import { EditView } from '../../course/editor/view-mouse';
import { GateBar } from '../../course/editor/gate-bar';
import { TopBar } from '../../course/editor/top-bar';
import { ADD_RAY_M, addAction, addFacing, addLift, addPoint } from '../../course/editor/add-place';
import { flyShows, modeStep, type EditMode } from '../../course/editor/fly-mode';
import type { Ray } from '../../course/editor/pick';
import { camFrom } from '../../course/editor/fly-cam';
import { gateFlownPose, placeGate, placeInState, type FlownPose } from '../../course/editor/drag';
import type { CourseCheck, EditorState } from '@gsfpv/tracks';
import { myTokens, myVotes, rememberToken, rememberVote, voterId } from '../../course/store';
import { EditorPanel } from '../../course/editor/panel';
import { editorKey, forwardOf, keyRoute } from '../../course/editor/keys';
import type { EditorCommand, KeyPress } from '../../course/editor/keys';
import { ACTION_KEYS, actionKey, gateLine, problemsLine, refusalText } from '../../course/editor/words';
import { ADD_FIX_KEY, SAVE_FIX_KEY, firstWrong } from '../../course/editor/texts';
import { adminVersionBody, editPaints, lapOf, lappedIds, mayVote } from '../../course/editor/rules';
import { readBests } from '../../course/link';
import { AdminClient, ApiError, adminHinted } from '../../admin/api';
import { TracksAdminClient } from '../../admin/tracks/api';

function randomSeed(): number {
    const a = new Uint32Array(1);
    crypto.getRandomValues(a);
    return a[0]! & 0x7fffffff;
}

export const course: Feature = {
    id: 'course',
    install(ctx: FlightContext) {
        const hook: CourseHook = {
            on: false, source: 'none', track: null, seed: null, gates: 0, next: -1, drawn: 0, laps: 0, lastLapMs: null, bestLapMs: null,
            beaconPoints: 0, problem: null, serverTracks: -1, saved: null,
            editor: { open: false, selected: 0, changed: false, problems: 0, refused: null, said: '', votes: myVotes(), paints: [], admin: false, lapped: [] }
        };
        // stage F1-finish: an admin signed in on this browser (the hint, then the session decides, as scene-default.ts does) saves
        // the edited gates as an admin version; a visitor's page never calls the admin API
        const adminClient = new AdminClient();
        let adminLive = false;
        ctx.hook.course = hook;
        // stage G4-prove: the probes read where the gates stand (flown frame) to fly through them and draw them from above
        hook.gatePoses = () => (run ? run.gates.map((g) => ({ pos: [g.pos[0], g.pos[1], g.pos[2]], quat: [g.quat[0], g.quat[1], g.quat[2], g.quat[3]] })) : []);
        hook.clockText = () => document.querySelector('[data-testid=course-hud]')?.textContent?.trim() ?? null;
        const stage = new CourseStage(ctx.renderer);
        const hud = new CourseHud(ctx.ui);
        const store = new CourseStore();
        let rows: CourseRow[] = [];
        let run: CourseRun | null = null;
        let shownNext = -2;
        let worker: Worker | null = null;
        let job = 0;
        let busy = false;
        let saving = false;
        let linkSeed = seedOfLink(liveSearch());
        /** a served course the link names (the admin's "Open in the editor", T4-admin) and whether its editor opens */
        let linkServer = servedOfLink(liveSearch());
        const linkEdit = editOfLink(liveSearch());
        let pending: number | null = null;
        let checking: TrackFile | null = null;
        /** what a 'check' job is for: the server's row `index`, or a course already shown that is re-proven (TR-5) */
        let checkFor: { kind: 'server'; index: number; only?: boolean } | { kind: 'again'; source: CourseHook['source']; seed: number | null } = { kind: 'server', index: 0 };
        /** the walls the shown course was proven on (a new walls object: re-prove, lane review TR-5) */
        let provenOn: unknown = null;
        let watchdog: ReturnType<typeof setTimeout> | null = null;
        // the editor (T3-editor-ui)
        let ed: EditorState | null = null;
        let panel: EditorPanel | null = null;
        // lane editor3 E2.1: the walls check of the editor runs in course/editor/check-worker.ts (5.1-5.5 s per change on
        // Wroclaw on this thread froze the page); an edit keeps the problems it had until the worker's answer repaints them
        const keepProblems: CourseCheck = () => (ed ? [...ed.problems] : []);
        let checks: CheckQueue | null = null;
        /** review ED-5: the course that got an ok answer from the check (a save checks again when it is not the course now) */
        let okCourse: unknown = null;
        let checkWorker: Worker | null = null;
        let checkWalls: unknown = null;
        let edMargin = 0;
        /** stage K2: the walls as a ray for the editor's camera, and that camera's forward on the floor */
        let camRay: RayFn | null = null;
        let camForward: readonly [number, number] | null = null;
        let camView: GateView | null = null;
        /** stage K2.6: the camera looks right of the gate by the share of the width the editor's window covers, so the gate is in the free part */
        /** lane editor3 E2: the free edit camera, the click selection and the handles (course/editor/view-mouse.ts) */
        let view: EditView | null = null;
        /** lane editor3 E2.4: the small bar next to the selected gate (kind, insert, delete, previous, next) */
        let bar: GateBar | null = null;
        /** lane editor3 E3: the top bar (Add gate, Undo, Redo, Exit) and whether the drone flies inside the mode */
        let top: TopBar | null = null;
        let mode: EditMode = 'edit';
        /** review ED-3: a crash in flight holds the edit view until the drone is seen disarmed (fly-mode.ts modeStep) */
        let crashHold = false;
        /** the editor's state when a handle drag began (the drag is one undo step on it) */
        let dragBase: EditorState | null = null;
        let dragFrame = 0;
        /** G2 measurement: the last Add gate click (ray, wall hit, the point, the selected gate, the flown transform) */
        let lastPlace: Record<string, unknown> | null = null;
        let camTaken = { n: 0, override: true, crash: false, t: 0 };
        let crashCleared = 0;
        /** a key selected a gate: the edit camera glides to see it (stage K2's view of the gate, now as the free camera's start) */
        const aim = (): void => {
            if (!camView || !panel) return;
            const w = window.innerWidth;
            const left = panel.root.getBoundingClientRect().left;
            const free = w > 0 ? left / w : 1;
            const cc = ctx.renderer.camera.camera;
            const fov = cc?.fov ?? 115;
            const h = cc && !cc.horizontalFov ? (2 * Math.atan(Math.tan((fov * Math.PI) / 360) * (w / Math.max(1, window.innerHeight))) * 180) / Math.PI : fov;
            const look = aimAt(camView.eye, camView.at, free, h);
            if (view) view.setCam(camFrom(camView.eye, look, view.cam.speed));
        };
        /** the course the editing started from or was last saved as (the base of a fork or of a new version) */
        let edSource: TrackFile | null = null;
        let edChanged = false;
        /** the step that dropping unsaved changes was asked for ('exit', 'regen', 'row:<id>'); doing it again goes on */
        let askedFor: string | null = null;
        let reopenAfter = false;
        let unblock: (() => void) | null = null;
        // the edit tokens of the pilot's own courses live in localStorage (store.ts myTokens, review TK-7)
        const edHook = hook.editor!;

        const drone = (): string => ctx.session.presetId;
        const tick = (): number => ctx.session.runner.sim.tick;
        const keyOf = (tr: TrackFile): string => bestKey(tr, drone());
        /** the course= link names a course only until the scene changes or a served course is shown (lane review TR-14 b) */
        const dropLink = (): void => {
            if (new URLSearchParams(liveSearch()).has('course')) history.replaceState(history.state, '', withCourse(location.href, null));
        };

        const sync = (): void => {
            const v = run?.view() ?? null;
            hook.on = !!run && hook.on;
            hook.gates = run?.gates.length ?? 0;
            hook.next = run && v ? v.next : -1;
            hook.drawn = stage.drawn;
            hook.laps = v?.laps ?? 0;
            hook.lastLapMs = v?.lastLapMs ?? null;
            hook.bestLapMs = v?.bestLapMs ?? null;
            hook.beaconPoints = run?.path.length ?? 0;
        };

        const draw = (): void => {
            if (!run || !hook.on) {
                stage.hide();
                hud.update(null, 0);
                shownNext = -2;
                sync();
                return;
            }
            stage.show(run.gates);
            shownNext = -2;
            frame();
        };

        const setTrack = (track: TrackFile | null, source: CourseHook['source'], seed: number | null): void => {
            const wasEditing = ed !== null;
            if (wasEditing) closeEdit(true);
            setRun(track, source, seed);
            if (track && (wasEditing || reopenAfter)) {
                reopenAfter = false;
                openEdit();
            }
        };
        const setRun = (track: TrackFile | null, source: CourseHook['source'], seed: number | null): void => {
            run = track ? new CourseRun(track, ctx.session.transform, readBest(keyOf(track))) : null;
            provenOn = track ? ctx.session.collision : null;
            hook.source = track ? source : 'none';
            hook.track = track ? { id: track.id, version: track.version } : null;
            hook.seed = track ? seed : null;
            hook.on = !!track;
            hook.saved = null;
            draw();
        };

        const frame = (editing = false): void => {
            if (!run || !hook.on || (ed && !editing)) return;
            // lane editor3 E3: flown inside the edit mode the next gate lights up; the lap clock and the best lap stay off
            const shows = flyShows(editing);
            const { ev, view: v } = run.fromSim(ctx.session.runner.sim);
            if (shows.writeBest && (ev === 'lap' || ev === 'done')) {
                const last = v.lastLapMs ?? 0;
                const before = readBest(keyOf(run.track));
                if (before === null || last < before) {
                    writeBest(keyOf(run.track), last);
                    ctx.hud.flash(t('course.best', { time: lapClock(last) }), 3000);
                } else ctx.hud.flash(t('course.lapDone', { time: lapClock(last) }), 2500);
            }
            const next = v.running || v.next >= 0 ? v.next : -1;
            if (next !== shownNext) {
                stage.setNext(next, run.path, run.track.laps > 1);
                shownNext = next;
            }
            if (shows.lapClock) hud.update(v, run.gates.length);
            sync();
        };

        // stage G1-progress: the generation's line on the HUD every PROGRESS_TICK_MS, spoken to Fly by Sound at the pacer's pace
        let prog: ProgressClock | null = null;
        let pacer = new SpeechPacer(() => performance.now());
        let progTimer = 0;
        const speak = sayVia(() => ctx.sonic ?? null);
        const sayLine = (text: string): void => {
            if (ctx.sonic) void speak({ key: 'sonic.say.text', params: { text } });
        };
        const showProgress = (): void => {
            if (!prog) return;
            const v = prog.view();
            hook.progress = progressLine(v, t);
            ctx.hud.flash(hook.progress, PROGRESS_TICK_MS * 2);
            if (pacer.due(v)) sayLine(spokenLine(v, t));
        };
        const startProgress = (): void => {
            clearInterval(progTimer);
            prog = new ProgressClock('course', courseSteps(null), () => performance.now());
            pacer = new SpeechPacer(() => performance.now());
            progTimer = window.setInterval(showProgress, PROGRESS_TICK_MS);
            showProgress();
        };
        const stopProgress = (): void => {
            clearInterval(progTimer);
            prog = null;
            hook.progress = null;
        };

        const fail = (problem: string, text: string): void => {
            stopProgress();
            hook.problem = problem;
            reopenAfter = false; // review TK-4: a failed load or generation does not open the editor later
            ctx.hud.flash(text, 4000);
        };

        // lane review TR-3: a job that does not answer in time (a hostile course kept the worker in the sweeps for minutes) ends
        // the worker, so Shift+G and Shift+T work again. ESTIMATES: a check took 1.9 s in the page (run 5), a course 15-31 s
        const CHECK_LIMIT_MS = 20_000;
        // up to 9 tries of fitCourse; the worker stops by FIT_BUDGET_MS (120 s, packages/tracks fit.ts) once it has a course
        const GENERATE_LIMIT_MS = 150_000;
        const disarm = (): void => {
            if (watchdog !== null) clearTimeout(watchdog);
            watchdog = null;
        };
        const arm = (ms: number): void => {
            disarm();
            watchdog = setTimeout(() => {
                watchdog = null;
                worker?.terminate();
                worker = null;
                job++;
                busy = false;
                checking = null;
                fail('timeout', t('course.failed'));
            }, ms);
        };

        const onWorker = (e: MessageEvent<FromCourseWorker>): void => {
            const m = e.data;
            if (m.job !== job) return;
            if (m.t === 'progress') {
                prog?.enter(m.step, m.estMs);
                showProgress();
                return;
            }
            stopProgress();
            busy = false;
            disarm();
            if (m.t === 'error') {
                checking = null;
                return fail(m.message.slice(0, 200), t('course.failed'));
            }
            if (m.t === 'checked') {
                const tr = checking;
                const why = checkFor;
                checking = null;
                if (!tr) return;
                if (why.kind === 'again') {
                    // TR-5: the scene was rescaled or its walls changed under a shown course
                    if (!m.ok) return fail(`moved: ${m.issues.join('; ') || 'not clear'}`.slice(0, 200), t('course.server.refused'));
                    setTrack(tr, why.source, why.seed);
                    return;
                }
                // a course that does not fit the pilot's own walls is never shown (the server cannot see walls); TR-3: the next
                // saved course is tried instead of stopping at the newest
                if (!m.ok) {
                    if (!why.only && why.index + 1 < rows.length) return void loadServer(why.index + 1);
                    return fail(`refused: ${m.issues.join('; ') || 'not clear'}`.slice(0, 200), t('course.server.refused'));
                }
                setTrack(tr, 'server', tr.generator?.seed ?? null);
                dropLink();
                ctx.hud.flash(t('course.server.loaded', { n: tr.gates.length }), 4000);
                return;
            }
            if (!m.track) return fail(m.short ? 'too few gates' : 'nothing fits', t('course.none'));
            const tr = m.track;
            const mine = job;
            const show = (): void => {
                if (mine !== job) return;
                hook.progress = null;
                setTrack(tr, 'generated', tr.generator?.seed ?? pending);
                history.replaceState(history.state, '', withCourse(location.href, tr.id));
                ctx.hud.flash(t('course.ready', { n: tr.gates.length }), 4000);
                sayLine(t('course.ready', { n: tr.gates.length }));
            };
            // G1-progress: a course that arrives while the drone flies is announced before its gates appear
            if (isParked(ctx.session.runner.sim.s, ctx.session.spawn)) return show();
            const soon = t('progress.course.soon', { n: tr.gates.length, s: Math.round(COURSE_WARN_MS / 1000) });
            hook.progress = soon;
            ctx.hud.flash(soon, COURSE_WARN_MS);
            sayLine(soon);
            window.setTimeout(show, COURSE_WARN_MS);
        };

        const ensureWorker = (): Worker => {
            if (!worker) {
                worker = new Worker(new URL('../../course/worker.ts', import.meta.url), { type: 'module' });
                worker.onmessage = onWorker;
                worker.onerror = (e) => {
                    disarm();
                    busy = false;
                    checking = null;
                    fail(e.message || 'worker error', t('course.failed'));
                };
            }
            return worker;
        };

        /** A copy of the flown walls for the worker (its buffers are transferred). */
        const walls = (): { grid: CourseGrid; nodes: Uint32Array; leaf: Uint32Array } | null => {
            const col = ctx.session.collision;
            if (!col) return null;
            return {
                grid: { flip: col.flipXY, min: [col.gridMinX, col.gridMinY, col.gridMinZ], res: col.voxelResolution, n: [col.numVoxelsX, col.numVoxelsY, col.numVoxelsZ], leafSize: col.leafSize, treeDepth: col.treeDepth },
                nodes: col.nodes.slice(), leaf: col.leafData.slice()
            };
        };
        const flownTransform = (): [number, number, number, number] => {
            const tr = ctx.session.transform;
            return [tr.s, tr.t[0] ?? 0, tr.t[1] ?? 0, tr.t[2] ?? 0];
        };
        /** lane editor3 E2.1: the editor's check worker, given these walls once (again only when the walls change) */
        const checksOn = (col: object): CheckQueue | null => {
            if (!checkWorker || !checks) {
                const wk = new Worker(new URL('../../course/editor/check-worker.ts', import.meta.url), { type: 'module' });
                const q = new CheckQueue((m, transfer) => wk.postMessage(m, transfer));
                wk.onmessage = (e: MessageEvent<FromCheckWorker>) => {
                    const got = q.answer(e.data);
                    if (!got || !ed) return;
                    if (!got.ok) {
                        hook.problem = `check: ${got.message}`.slice(0, 200);
                        return;
                    }
                    ed = { ...ed, problems: got.problems };
                    // review ED-5: an ok answer counts only when no newer course is still asked
                    okCourse = q.pending ? null : ed.course;
                    showEd();
                    // train 3 H1: a floor-added gate the check refuses says why and what to do, and stays selected
                    if (addedId !== null && !q.pending) {
                        const id = addedId;
                        addedId = null;
                        showWrong(ADD_FIX_KEY, id);
                    }
                };
                wk.onerror = (e) => {
                    hook.problem = `check: ${e.message || 'worker error'}`.slice(0, 200);
                    wk.terminate();
                    if (checkWorker === wk) {
                        checkWorker = null;
                        checks = null;
                        checkWalls = null;
                    }
                    q.drop();
                };
                checkWorker = wk;
                checks = q;
                checkWalls = null;
            }
            if (checkWalls !== col) {
                const w = walls();
                if (!w) return null;
                checks.walls(w.grid, w.nodes, w.leaf);
                checkWalls = col;
            }
            return checks;
        };

        /**
         * Walls W3 (the owner's rule): a course needs walls, so on a scan without them they come first (published at once,
         * else the build with its progress line in the walls box), then `go` runs; no line that says walls are missing.
         */
        let wallsWait = false;
        const wallsFirst = (go: () => void): void => {
            if (wallsWait) return;
            wallsWait = true;
            hook.problem = null;
            const wh = ctx.hook.walls;
            void withWalls({
                has: () => !!ctx.session.collision,
                // the lead line goes into the walls box above the progress (a HUD note would cover the box)
                build: wh ? () => wh.build(t('course.wallsFirst'), t('progress.walls.thenCourse')) : null,
                scene: () => ctx.session.scene.id,
                // a failed build keeps the course waiting: the walls button brings the walls and then the course
                later: wh ? (f) => wh.whenIn(f) : undefined
            }, go).then((r) => {
                wallsWait = false;
                // the walls box says what to press (out of room: close tabs and press again)
                if (r === 'failed') fail('walls not built', wh?.line || t('bake.failed'));
            });
        };

        const generate = (seed: number): void => {
            const s = ctx.session;
            const w = walls();
            if (!w) return wallsFirst(() => generate(seed));
            if (busy) return;
            busy = true;
            hook.problem = null;
            startProgress();
            pending = seed;
            const msg: CourseJob = {
                t: 'generate', job: ++job, ...w,
                spawn: [s.spawn[0], s.spawn[1], s.spawn[2]],
                seed, scene: { id: s.scene.id, version: s.scene.version },
                transform: flownTransform(),
                created: new Date().toISOString()
            };
            ensureWorker().postMessage(msg, [w.nodes.buffer, w.leaf.buffer]);
            arm(GENERATE_LIMIT_MS);
        };

        /** A course on the screen proven again on the walls and scale of now (lane review TR-5); hidden until it holds. */
        const proveAgain = (): void => {
            const tr = run?.track;
            const w = walls();
            if (!tr) return;
            const again = { kind: 'again' as const, source: hook.source, seed: hook.seed };
            setTrack(null, 'none', null);
            if (!w) return;
            job++;
            busy = true;
            checking = tr;
            checkFor = again;
            const msg: CheckJob = { t: 'check', job, ...w, track: tr, transform: flownTransform() };
            ensureWorker().postMessage(msg, [w.nodes.buffer, w.leaf.buffer]);
            arm(CHECK_LIMIT_MS);
        };

        /** The newest course the server keeps for this scene (or the next when it is refused): fetched, held to the contract, proven on our walls, then shown. */
        /** `only`: the course a link named; when it fails, the next saved course is NOT tried instead */
        /** `direct`: a course and version a link names, loaded without the list (review TK-5) */
        const loadServer = async (index = 0, only = false, direct?: { id: string; version: number }): Promise<void> => {
            const row = direct ?? rows[index];
            if (!row || (busy && index === 0)) return;
            const w = walls();
            if (!w) return wallsFirst(() => void loadServer(index, only, direct));
            busy = true;
            hook.problem = null;
            ctx.hud.flash(t('course.server.loading'), 2500);
            const mine = ++job;
            const got = await store.load(row);
            if (mine !== job) return;
            if (!got.ok || got.track.scene.id !== ctx.session.scene.id) {
                busy = false;
                if (!only && index + 1 < rows.length) return loadServer(index + 1);
                if (!got.ok) return fail(got.problem, t('course.server.failed'));
                return fail('another scene', t('course.server.refused'));
            }
            checking = got.track;
            checkFor = { kind: 'server', index, only };
            const msg: CheckJob = { t: 'check', job: mine, ...w, track: got.track, transform: flownTransform() };
            ensureWorker().postMessage(msg, [w.nodes.buffer, w.leaf.buffer]);
            arm(CHECK_LIMIT_MS);
        };

        const save = async (): Promise<void> => {
            if (!run || hook.source !== 'generated' || hook.saved || saving) return;
            saving = true;
            const tr = run.track;
            const r = await store.save(tr);
            saving = false;
            if (!r.ok) return fail(`save: ${r.problem}`, t('course.save.failed'));
            if (run?.track === tr) hook.saved = r.id;
            hook.problem = null;
            ctx.hud.flash(t('course.save.done'), 4000);
            void refresh(true);
        };

        const refresh = async (fresh = false): Promise<void> => {
            const scene = ctx.session.scene.id;
            const got = await store.list(scene, fresh);
            if (ctx.session.scene.id !== scene) return;
            const had = hook.serverTracks;
            rows = got;
            hook.serverTracks = got.length;
            if (had <= 0 && got.length > 0 && !run && firstOffer(scene)) ctx.hud.flash(t('course.server.offer'), 4000);
            // the link's served course, once the walls are there (a refresh before them leaves it for the next one)
            if (linkServer !== null && ctx.session.collision) {
                const want = linkServer;
                linkServer = null;
                // review TK-5: the list holds only the first page of sort=top (no course with broken reports): a link with
                // its version loads the course directly
                if (want.version !== null) {
                    reopenAfter = linkEdit;
                    return void loadServer(-1, true, { id: want.id, version: want.version });
                }
                const i = rows.findIndex((r) => r.id === want.id);
                if (i < 0) return fail(`link: ${want.id} not listed`, t('course.link.missing'));
                reopenAfter = linkEdit;
                void loadServer(i, true);
            }
        };

        const toggle = (): void => {
            if (!run) {
                if (rows.length > 0) return void loadServer();
                return generate(randomSeed());
            }
            hook.on = !hook.on;
            run.reset();
            if (!hook.on) ctx.hud.flash(t('course.off'), 2500);
            draw();
        };

        // lane review TR-7: the sound mode cannot fly a visual course yet (train 2), and Shift is its keyboard's 'down', so the
        // keys do nothing while the mode is on (ctx.sonic is set only then); the routing itself is the lead's (keymap.test.ts:160)
        ctx.keys.on('course.toggle', (e) => {
            if (e.repeat || ctx.sonic) return;
            toggle();
        });
        ctx.keys.on('course.generate', (e) => {
            if (e.repeat || ctx.sonic) return;
            generate(randomSeed());
        });
        ctx.menu.add({ id: 'pause.course', action: 'course.generate', labelKey: 'course.menu.generate', order: 72, section: 'tools', run: () => generate(randomSeed()) });
        ctx.menu.add({
            id: 'pause.course.toggle', action: 'course.toggle', labelKey: 'course.menu.off', order: 73, section: 'tools',
            run: () => toggle(), enabled: () => run !== null, label: () => t(hook.on ? 'course.menu.off' : 'course.menu.on')
        });
        ctx.menu.add({
            id: 'pause.course.load', action: null, labelKey: 'course.menu.load', order: 74, section: 'tools',
            run: () => void loadServer(), enabled: () => rows.length > 0 && !busy
        });
        ctx.menu.add({
            id: 'pause.course.save', action: null, labelKey: 'course.menu.save', order: 75, section: 'tools',
            run: () => void save(), enabled: () => run !== null && hook.source === 'generated' && hook.saved === null && !saving
        });

        ctx.events.on('frame', () => {
            if (ed) return editFrame();
            // TR-5: the scale feature (session.setTransform) and the walls switch fire no 'session' event
            if (run && !busy && (run.stale(ctx.session.transform) || ctx.session.collision !== provenOn)) return proveAgain();
            frame();
        });
        // stage G3-respawn (message 51): a crash no longer ends the attempt; the new life decides (course/run.ts courseLife)
        ctx.events.on('life', (l) => {
            if (!run) return;
            const now = tick();
            run.afterLife(courseLife(l.reason, ctx.session.director?.last ?? null, now), now);
        });
        ctx.events.on('pause', ({ on, reasons }) => {
            // the pause menu and every other full window hide the lap clock and its lines (course/cover.ts coveredBy)
            hud.cover(coveredBy(reasons));
            if (!run) return;
            if (on) run.pause(tick());
            else run.resume(tick());
        });
        // a new scene: its walls are others, so the course goes (a link's seed is for the scene the page opened with)
        ctx.events.on('session', () => {
            closeEdit(true);
            job++;
            disarm();
            busy = false;
            checking = null;
            rows = [];
            hook.serverTracks = -1;
            setTrack(null, 'none', null);
            void refresh();
            if (linkSeed !== null) tryLink();
            else dropLink();
        });
        // ---------------- the editor (T3-editor-ui)
        const scale = (): number => ctx.session.transform.s;
        const say = (text: string, refused = false): void => {
            edHook.said = text;
            panel?.say(text, refused);
            // lane editor3 H1: the window opens closed: the top bar's line says it, a refusal also on the HUD
            top?.tell(text, refused);
            if (refused) ctx.hud.flash(text, 5000);
        };
        /** train 3 H1: the gate a floor add put in, until the check's answer on it came */
        let addedId: string | null = null;
        /** train 3 H1, the probe's record of the last "this gate is wrong" (index from 0, the sentence's key) */
        let lastWrong: { index: number; key: string; lead: string } | null = null;
        /**
         * train 3 H1 (the lead's decision): the first wrong gate (or the focused one) is selected, the edit view turns to it with its
         * handles, and one sentence names it from 1 and says what to do. False when no problem points at a gate.
         */
        const showWrong = (lead: string, focus: string | null = null): boolean => {
            if (!ed) return false;
            const w = firstWrong(ed.course, ed.problems, focus);
            if (!w) return false;
            ed = { ...ed, selected: w.index };
            lastWrong = { index: w.index, key: w.key, lead };
            showEd();
            aim();
            say(t(lead, { fix: t(w.key, w.args) }), true);
            return true;
        };
        const refusedSave = (): void => {
            if (!ed || showWrong(SAVE_FIX_KEY)) return;
            say(t('course.edit.saveRefused', { why: problemsLine(ed) }), true);
        };
        const renderList = (): void => {
            edHook.votes = myVotes();
            const lapped = lappedIds(readBests());
            edHook.lapped = [...lapped];
            panel?.list(rows, edHook.votes, hook.saved ?? hook.track?.id ?? null, lapped);
        };
        const showEd = (): void => {
            // lane editor3 E3: while the drone flies the course stays as it was armed; the edit view comes back on disarm
            if (!ed || !panel || mode === 'fly') return;
            // review TK-6: the edited gates on the source's identity (after a save: the saved id, version, author, title)
            const v1 = toTrackV1(ed.course);
            const track: TrackFile = edSource
                ? { ...v1, id: edSource.id, version: edSource.version, parent: edSource.parent, author: edSource.author, title: edSource.title, generator: edSource.generator }
                : v1;
            run = new CourseRun(track, ctx.session.transform, null);
            provenOn = ctx.session.collision;
            hook.on = true;
            stage.show(run.gates);
            stage.setNext(ed.selected, run.path, track.laps > 1);
            // stage F1-finish: the selected gate magenta, a failing gate red (tracks-plan 2.11)
            const paints = editPaints(ed.course.gates.map((g) => g.id), ed.selected, ed.problems);
            stage.paintEdit(paints);
            edHook.paints = paints;
            shownNext = ed.selected;
            // stage K2: the selected gate in view (the paused drone may face away from it)
            const sg = run.gates[ed.selected];
            if (sg) {
                const s = ctx.session.runner.sim.s;
                camView = gateCamera(sg.pos, [s[S.px] ?? 0, s[S.py] ?? 0, s[S.pz] ?? 0], camRay);
                camForward = camView.forward;
            }
            hud.update(null, 0);
            panel.status(gateLine(ed, scale()), problemsLine(ed), ed.problems.length > 0);
            panel.buttons(!edChanged && hook.source === 'generated' && hook.saved === null);
            const eg = ed.course.gates[ed.selected];
            view?.put(eg ? gateFlownPose(eg, flownTransform()) : null, eg ? eg.id : null);
            edHook.open = true;
            (edHook as { flying?: boolean }).flying = false;
            edHook.selected = ed.selected;
            edHook.changed = edChanged;
            edHook.problems = ed.problems.length;
            sync();
        };
        const openEdit = (): void => {
            if (ed || ctx.sonic) return;
            const col = ctx.session.collision;
            // walls W3: no walls or no course yet: both come by themselves and the editor opens on the new course
            if (!col || !run) {
                // review T2-4: pressed while a course is being made, the editor opens on it when it arrives
                if (busy) {
                    reopenAfter = true;
                    if (!checking) ctx.hud.flash(t('course.generating'), 2500);
                    return;
                }
                hook.problem = null;
                reopenAfter = true;
                return generate(randomSeed());
            }
            // review T2-1: a smaller course (K1.2) is edited at the margin it was laid with, as the worker proves it
            edMargin = marginOf(run.track);
            const q = checksOn(col);
            const fc = flownCollision(col, flownTransform());
            camRay = (o, d, max) => {
                const h = fc.queryRay(o[0], o[1], o[2], d[0], d[1], d[2], max);
                return h ? Math.hypot(h.x - o[0], h.y - o[1], h.z - o[2]) : null;
            };
            edSource = run.track;
            ed = openEditor(upgradeTrack(run.track), keepProblems, 0);
            q?.ask(ed.course, flownTransform(), edMargin);
            edChanged = false;
            askedFor = null;
            edHook.refused = null;
            // lane editor3 E3: no pause; the flight goes on in the mode (armed: the drone's view, disarmed: the edit view)
            mode = 'edit';
            crashHold = false;
            unblock = ctx.keys.block(() => ed !== null && mode === 'edit');
            panel = new EditorPanel(ctx.ui, { key: (p) => applyKey(p), saveMine: (n, ti) => void saveMine(n, ti), saveAll: () => void saveAll(), saveAdmin: (ti) => void saveAdmin(ti), vote: (id, v) => void vote(id, v), open: (id) => openRow(id) });
            panel.defaults('', run.track.title);
            panel.adminOn(adminLive);
            // lane editor3 E2: the edit camera starts where the flight camera is, looking its way
            const ce = ctx.renderer.camera;
            const ep = ce.getPosition();
            const ef = ce.forward;
            ctx.session.cameraOverride = true;
            view = new EditView({
                app: ctx.renderer.app,
                camera: ce,
                gates: () => run?.gates ?? [],
                onCamera: (eye, at) => {
                    ctx.session.cameraOverride = true;
                    ctx.renderer.setCameraLookAt(eye[0], eye[1], eye[2], at[0], at[1], at[2]);
                    edHook.view = { eye: [...eye], at: [...at], look: [...at], free: 1 };
                },
                onPick: (i) => pickAt(i),
                onPlace: (ray) => placeAt(ray),
                onDrag: (p, end) => dragTo(p, end),
                onSpeed: (s) => ctx.hud.flash(t('course.edit.camSpeed', { v: s.toFixed(1) }), 1200),
                typing: (target) => panel?.typing(target) ?? false
            }, camFrom([ep.x, ep.y, ep.z], [ep.x + ef.x, ep.y + ef.y, ep.z + ef.z]));
            bar = new GateBar(ctx.ui, { key: (p) => applyKey(p), where: () => view?.standScreen() ?? null, tool: () => view?.tool ?? 'move', setTool: (tl) => view?.setTool(tl), dragging: () => view?.isDragging() ?? false });
            top = new TopBar(ctx.ui, { key: (p) => applyKey(p), add: () => toggleAdd(), show: (part) => panel?.reveal(part) });
            // read only, for the page probes (tools/bench/src/editor3-smoke.ts)
            (window as unknown as { __gsfpvEditView?: () => unknown }).__gsfpvEditView = () => (view ? { ...view.debug(), mode, bar: bar?.debug() ?? null, place: lastPlace, wrong: lastWrong, course: ed ? { gates: ed.course.gates, start: (ed.course as { start?: unknown }).start ?? null, problems: ed.problems } : null, camTaken, crashCleared, crashActive: ctx.crash.active, override: ctx.session.cameraOverride } : null);
            // lane editor3 H1, read only: the shown handles' shape under a page point (the probe finds the ring it presses)
            (window as unknown as { __gsfpvEditHit?: (x: number, y: number) => unknown }).__gsfpvEditHit = (x, y) => view?.hitAt(x, y) ?? null;
            if (!adminLive && adminHinted()) {
                void adminClient.resume().then((live) => {
                    adminLive = live === true;
                    edHook.admin = adminLive;
                    panel?.adminOn(adminLive);
                });
            }
            showEd();
            say(t('course.edit.opened'));
            renderList();
            void refresh(true).then(renderList);
        };
        /** `quiet`: the course is replaced right after (no redraw for flight) */
        function closeEdit(quiet = false): void {
            if (!ed) return;
            ed = null;
            reopenAfter = false; // review TK-4: a generation or load asked from the editor does not reopen it after Esc
            panel?.destroy();
            panel = null;
            unblock?.();
            unblock = null;
            edHook.open = false;
            edHook.view = null;
            camForward = null;
            camView = null;
            view?.dispose();
            view = null;
            bar?.destroy();
            bar = null;
            top?.destroy();
            top = null;
            mode = 'edit';
            (edHook as { flying?: boolean }).flying = false;
            dragBase = null;
            cancelAnimationFrame(dragFrame);
            ctx.session.cameraOverride = false;
            // review TK-1: unsaved changes are dropped, the course flown is the one editing started from (or was saved as)
            if (!quiet && edSource) {
                run = new CourseRun(edSource, ctx.session.transform, readBest(keyOf(edSource)));
                provenOn = ctx.session.collision;
            }
            if (!quiet && run) {
                run.reset();
                draw();
            }
        }
        /** lane editor3 E2: a click took gate `i` (the camera stays: the pilot put it there) */
        const pickAt = (i: number): void => {
            if (!ed || dragBase || i === ed.selected) return;
            const out = edit(ed, { kind: 'select', index: i }, keepProblems);
            ed = out.state;
            showEd();
            if (out.ok) say(t('course.edit.did', { what: t(actionKey({ kind: 'select', index: i })), gate: gateLine(ed, scale()) }));
        };
        /** lane editor3 E3: Add gate pressed: the next click on the scene puts a gate (pressed again: no more) */
        const toggleAdd = (): void => {
            if (!view || mode === 'fly') return;
            // lane editor3 H1, the owner's rule: no refusal with a number; a full course says in words what to delete
            if (!view.adding && ed && ed.course.gates.length >= MAX_GATES_EDIT) return say(t('course.edit.r.maxGates'), true);
            view.adding = !view.adding;
            top?.adding(view.adding);
            if (view.adding) say(t('course.edit.bar.addHint'));
        };
        /** lane editor3 E3: a click with Add gate armed: a gate at the wall that ray hits (or ahead), after the selected one */
        const placeAt = (ray: Ray): void => {
            top?.adding(false);
            if (!ed) return;
            const hit = camRay ? camRay(ray.o, ray.d, ADD_RAY_M) : null;
            const at = addPoint(ray.o, ray.d, hit, addLift(ed, flownTransform(), edMargin));
            // G1: lane course3's EditAction add (after the selected gate, its kind and opening, one undo step)
            // G2: facing along the course, from the selected gate (course frame -> flown: s * pos + offset)
            const tr = flownTransform();
            const sel = ed.course.gates[ed.selected];
            const prev: [number, number, number] | null = sel ? [sel.pos[0] * tr[0] + tr[1], sel.pos[1] * tr[0] + tr[2], sel.pos[2] * tr[0] + tr[3]] : null;
            const out = edit(ed, addAction(at, addFacing(ray.o, at, prev), tr), keepProblems);
            // G2 measurement: what the floor click gave (read by the probe through __gsfpvEditView().place)
            lastPlace = { o: ray.o, d: ray.d, hit, at, prev, tr: [tr[0], tr[1], tr[2], tr[3]], camEye: camView ? [...camView.eye] : null };
            if (!out.ok) {
                ed = out.state;
                edHook.refused = out.reason.code;
                showEd();
                return say(refusalText(ed.course, out.reason), true);
            }
            const st = out.state;
            ed = st;
            edChanged = true;
            askedFor = null;
            edHook.refused = null;
            addedId = st.course.gates[st.selected]?.id ?? null;
            checks?.ask(st.course, flownTransform(), edMargin);
            showEd();
            // G2: the camera stays where the pilot clicked from (the gate stands where he clicked, in his view). The H2 aim()
            // here moved the edit eye to gateCamera's pose, which starts at the drone and stops at the first wall: g2/full3
            // measured the eye 2 m from the drone on the floor (Tunis viewAfter [1.53, 0.45, 0.87]): the drone's view, no gate.
            say(t('course.edit.did', { what: t('course.edit.bar.add'), gate: gateLine(st, scale()) }));
        };
        /** lane editor3 E3: armed flies (the drone's camera, the course from gate 1), disarmed or crashed edits again */
        const editFrame = (): void => {
            if (!ed) return;
            const sim = ctx.session.sim;
            const st = modeStep(mode, !!sim?.armed, !!sim?.crashed, crashHold);
            crashHold = st.hold;
            // G3: the edit view holds the renderer's camera every frame. g2/full5 drew the drone's crash view after a floor add
            // while the edit eye stood still (crashview.ts frame() poses its chase camera each frame while a crash is active,
            // before the features' frame work); camTaken counts the frames another writer had moved it (read by the probes).
            if (mode === 'edit' && view && !view.isSuspended()) {
                const cp = ctx.renderer.camera.getPosition();
                const e = view.cam.pos;
                if (!ctx.session.cameraOverride || Math.hypot(cp.x - e[0], cp.y - e[1], cp.z - e[2]) > 0.01) {
                    camTaken = { n: camTaken.n + 1, override: ctx.session.cameraOverride, crash: ctx.crash.active, t: Math.round(performance.now()) };
                    view.setCam(view.cam);
                }
            }
            if (st.change === 'to-fly') {
                mode = 'fly';
                (edHook as { flying?: boolean }).flying = true;
                // review ED-2: devices/keyboard.ts gives the flying keys back to the flight (EDIT_MODE)
                panel?.root.classList.add('ce-flying');
                dragBase = null;
                view?.suspend(true);
                bar?.hide(true);
                top?.flying(true);
                if (panel) panel.root.style.display = 'none';
                ctx.session.cameraOverride = false;
                stage.paintEdit([]);
                run?.reset();
                shownNext = -2;
            } else if (st.change === 'to-edit') {
                mode = 'edit';
                (edHook as { flying?: boolean }).flying = false;
                panel?.root.classList.remove('ce-flying');
                if (panel) panel.root.style.display = '';
                bar?.hide(false);
                top?.flying(false);
                // the edit camera comes back where it was (its onCamera takes the renderer's camera again)
                // G3: a crash of the test flight takes its chase camera and its stats window away (g2 pictures showed the
                // stats window over the edit view): ctx.clearCrash is the page's own "back from a crash" (context.ts)
                if (ctx.crash.active) { ctx.clearCrash(); crashCleared++; }
                view?.suspend(false);
                showEd();
            }
            if (mode === 'fly') frame(true);
        };
        /** lane editor3 E2: a handle drag; the gate follows live, the release is one undo step and asks the walls check */
        const dragTo = (p: FlownPose, end: boolean): void => {
            if (!ed) return;
            const base = dragBase ?? ed;
            dragBase = base;
            const old = base.course.gates[base.selected];
            if (!old) return;
            const g = placeGate(old, p, flownTransform());
            if (!end) {
                const gates = [...base.course.gates];
                gates[base.selected] = g;
                ed = { ...base, course: { ...base.course, gates } };
                // one redraw per frame however fast the pointer moves
                if (!dragFrame) dragFrame = requestAnimationFrame(() => { dragFrame = 0; if (ed && dragBase) showEd(); });
                return;
            }
            cancelAnimationFrame(dragFrame);
            dragFrame = 0;
            dragBase = null;
            const st = placeInState(base, base.selected, g, keepProblems);
            ed = st ?? base;
            askedFor = null;
            if (st) {
                edChanged = true;
                checks?.ask(st.course, flownTransform(), edMargin);
            }
            showEd();
            if (st) say(t('course.edit.did', { what: t(ACTION_KEYS.move), gate: gateLine(st, scale()) }));
        };
        const viewForward = (): [number, number] => {
            // lane editor3 E2: the arrows follow the free edit camera
            if (view) return view.floorForward();
            // stage K2: the arrows follow the camera that shows the gate, not the drone's heading
            if (camForward) return [camForward[0], camForward[1]];
            const s = ctx.session.runner.sim.s;
            return forwardOf(s[S.qw] ?? 1, s[S.qx] ?? 0, s[S.qy] ?? 0, s[S.qz] ?? 0);
        };
        const applyKey = (press: KeyPress): void => {
            if (!ed || !panel) return;
            const k = editorKey(press, viewForward());
            if (!k) return;
            if ('cmd' in k) return command(k.cmd);
            askedFor = null;
            const count = ed.course.gates.length;
            const out = edit(ed, k.edit, keepProblems);
            ed = out.state;
            if (out.ok) {
                if (k.edit.kind !== 'select' && k.edit.kind !== 'select-step') {
                    edChanged = true;
                    checks?.ask(ed.course, flownTransform(), edMargin);
                }
                edHook.refused = null;
                showEd();
                // lane editor3 E2: a key that selects a gate takes the view to it; the mouse and the other keys leave the view
                // review ED-1: a delete or a duplicate selects another gate too, so the view goes to it
                if (k.edit.kind === 'select' || k.edit.kind === 'select-step' || ed.course.gates.length !== count) aim();
                say(t('course.edit.did', { what: t(actionKey(k.edit)), gate: gateLine(ed, scale()) }));
            } else {
                edHook.refused = out.reason.code;
                showEd();
                say(refusalText(ed.course, out.reason), true);
            }
        };
        /** unsaved changes: the first time a step that drops them is asked, it says so (true) and does nothing; again goes on */
        const ask = (what: string, text: string): boolean => {
            if (!edChanged || askedFor === what) return false;
            askedFor = what;
            say(text, true);
            return true;
        };
        const command = (c: EditorCommand): void => {
            if (!ed || !panel) return;
            if (c === 'exit') {
                if (ask('exit', t('course.edit.unsaved'))) return;
                return closeEdit();
            }
            if (c === 'focus-window') return panel.focusName();
            if (c === 'regen' || c === 'regen-same') {
                // review TK-4: G drops the changes only when asked twice, like Esc
                if (busy || ask('regen', t('course.edit.unsavedAgain'))) return;
                reopenAfter = true;
                return generate(c === 'regen-same' && hook.seed !== null ? hook.seed : randomSeed());
            }
            if (c === 'save-all') return void saveAll();
            if (panel.askName()) return say(t('course.edit.name'));
            const { name, title } = panel.names();
            void saveMine(name, title);
        };
        const freshId = (like: string): string => {
            const a = new Uint32Array(1);
            crypto.getRandomValues(a);
            return `${like.split('-')[0]}-${a[0]!.toString(16).padStart(8, '0')}`;
        };
        /** a save waits for the worker's answer on the course as it stands (no press is lost: the save goes on after it) */
        const checked = async (): Promise<void> => {
            if (checks?.pending) {
                saving = true;
                try {
                    await checks.settled();
                } finally {
                    saving = false;
                }
            }
            // review ED-5: the worker failed or never answered this course: it is checked here, once, before the save
            const col = ctx.session.collision;
            if (ed && ed.course !== okCourse && col) {
                ed = { ...ed, problems: checkOnPage(col, flownTransform(), edMargin, ed.course) };
                okCourse = ed.course;
                showEd();
            }
        };
        const saveMine = async (nameIn: string, titleIn: string): Promise<void> => {
            if (!ed || !edSource || saving) return;
            await checked();
            if (!ed || !edSource) return;
            if (!canSave(ed)) return refusedSave();
            const name = nameIn.trim().normalize('NFC');
            const title = titleIn.trim().normalize('NFC');
            const edited = toTrackV1(ed.course);
            const serverId = hook.saved ?? (hook.source === 'server' ? edSource.id : null);
            // review TK-10: an unchanged course already on the server is not posted again (a new title is a change)
            if (!edChanged && serverId !== null && title === edSource.title) return say(t('course.edit.nothing'), true);
            const baseVersion = hook.track?.version ?? edSource.version;
            const token = serverId ? myTokens()[serverId] ?? null : null;
            const author = { kind: 'person' as const, name };
            // review TK-11 b: a person's file carries no generator block (it described the gates before the edit)
            const body: TrackFile = token && serverId
                ? { ...edited, id: serverId, version: baseVersion + 1, parent: { id: serverId, version: baseVersion }, author, title, generator: null }
                : { ...edited, id: serverId ? freshId(serverId) : edited.id, version: 1, parent: serverId ? { id: serverId, version: baseVersion } : null, author, title, generator: null };
            saving = true;
            const r = await store.saveMine(body, token);
            saving = false;
            if (!r.ok) {
                hook.problem = `save: ${r.problem}`;
                return say(t('course.save.failed', { msg: r.problem.slice(0, 120) }), true);
            }
            if (r.token) rememberToken(r.id, r.token);
            hook.saved = r.id;
            hook.source = 'server';
            hook.track = { id: r.id, version: r.version };
            hook.problem = null;
            edSource = { ...body, id: r.id, version: r.version };
            edChanged = false;
            showEd();
            say(t('course.edit.savedMine', { title, v: r.version }));
            await refresh(true);
            renderList();
        };
        const saveAll = async (): Promise<void> => {
            if (!ed) return;
            if (edChanged) return say(t('course.edit.allEdited'), true);
            if (hook.source !== 'generated' || hook.saved !== null) return say(t('course.edit.allDone'), true);
            await save();
            if (hook.saved) {
                say(t('course.save.done'));
                showEd();
                renderList();
            } else say(t('course.save.failed', { msg: hook.problem ?? '' }), true);
        };
        /** stage F1-finish (R6/R8): the admin's edit of the gates as a new version of the served course, marked edited by the admin */
        const saveAdmin = async (titleIn: string): Promise<void> => {
            if (!ed || !edSource || saving || !adminLive) return;
            await checked();
            if (!ed || !edSource) return;
            if (!canSave(ed)) return refusedSave();
            const serverId = hook.saved ?? (hook.source === 'server' ? edSource.id : null);
            if (serverId === null) return say(t('course.edit.adminFirst'), true);
            const title = titleIn.trim().normalize('NFC') || edSource.title;
            if (!edChanged && title === edSource.title) return say(t('course.edit.nothing'), true);
            const base = hook.track?.version ?? edSource.version;
            const body = adminVersionBody(toTrackV1(ed.course), serverId, base, title);
            saving = true;
            let r: { id: string; version: number };
            try {
                r = await new TracksAdminClient(adminClient).version(serverId, body as unknown as Record<string, unknown>);
            } catch (e) {
                const msg = e instanceof ApiError ? e.reason || `HTTP ${e.status}` : String(e);
                hook.problem = `admin save: ${msg}`;
                return say(t('course.save.failed', { msg: msg.slice(0, 120) }), true);
            } finally {
                saving = false;
            }
            hook.saved = serverId;
            hook.source = 'server';
            hook.track = { id: serverId, version: r.version };
            hook.problem = null;
            edSource = { ...(body as unknown as TrackFile), id: serverId, version: r.version };
            edChanged = false;
            showEd();
            say(t('course.edit.savedAdmin', { title: body.title, v: r.version }));
            await refresh(true);
            renderList();
        };
        const vote = async (id: string, v: 1 | -1): Promise<void> => {
            // tracks-plan 2.9: voting only after a completed lap on that course (a UI rule, not a proof)
            if (!mayVote(id, lappedIds(readBests()))) return say(t('course.edit.voteAfterLap'), true);
            const had = myVotes()[id] ?? 0;
            const nv = had === v ? 0 : v;
            const r = await store.vote(id, nv, voterId(), lapOf(id, readBests()));
            if (!r.ok) {
                hook.problem = `vote: ${r.problem}`;
                return say(t('course.edit.voteFailed', { msg: r.problem.slice(0, 120) }), true);
            }
            rememberVote(id, nv);
            const row = rows.find((x) => x.id === id);
            if (row) {
                row.up = r.up;
                row.down = r.down;
            }
            say(t('course.edit.voted'));
            renderList();
        };
        const openRow = (id: string): void => {
            const i = rows.findIndex((x) => x.id === id);
            if (i < 0 || busy) return;
            // review TK-4: a row's Edit drops unsaved changes only when clicked twice; the clicked course or none (only)
            if (ask(`row:${id}`, t('course.edit.unsavedAgain'))) return;
            reopenAfter = true;
            void loadServer(i, true);
        };
        // review TK-3: Tab walks the window's buttons when the focus is in it (gates when on the canvas), F6 enters the window,
        // Esc inside it gives the focus back first (course/editor/keys.ts keyRoute)
        addEventListener('keydown', (e: KeyboardEvent) => {
            // lane editor3 E3: while the drone flies the keys belong to the flight
            if (!ed || !panel || mode === 'fly') return;
            if (e.code === 'Escape' && view?.adding) {
                e.preventDefault();
                e.stopPropagation();
                view.adding = false;
                top?.adding(false);
                return;
            }
            const target = e.target;
            const inWindow = target instanceof Node && panel.root.contains(target);
            const route = keyRoute(e, { typing: panel.typing(target), inWindow, onButton: target instanceof HTMLButtonElement });
            if (route === 'pass') return;
            e.preventDefault();
            e.stopPropagation();
            if (route === 'blur') return void (target as HTMLElement).blur?.();
            if (route === 'save') return command('save-mine');
            applyKey(e);
        }, true);
        ctx.keys.on('course.edit', (e) => {
            if (e.repeat || ctx.sonic) return;
            openEdit();
        });
        ctx.menu.add({ id: 'pause.course.edit', action: 'course.edit', labelKey: 'course.edit.menu', order: 76, section: 'tools', run: () => openEdit(), enabled: () => run !== null && !busy });

        const tryLink = (): void => {
            if (linkSeed === null || !ctx.session.collision) return;
            const seed = linkSeed;
            linkSeed = null;
            generate(seed);
        };
        tryLink();
        if (ctx.session.scene) void refresh();
    }
};
