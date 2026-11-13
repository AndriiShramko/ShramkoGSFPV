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
import type { CourseHook } from '../../course/hook';
import { CourseRun } from '../../course/run';
import { CourseStage } from '../../course/view';
import { CourseHud, lapClock } from '../../course/hud';
import { bestKey, editOfLink, firstOffer, readBest, seedOfLink, serverOfLink, withCourse, writeBest } from '../../course/link';
import { CourseStore, type CourseRow } from '../../course/store';
import type { CheckJob, CourseGrid, CourseJob, FromCourseWorker } from '../../course/worker';
import { S } from '@gsfpv/sim-core';
import { canSave, edit, openEditor, toTrackV1, upgradeTrack, wallsCheck } from '@gsfpv/tracks';
import type { CourseCheck, EditorState } from '@gsfpv/tracks';
import { myVotes, rememberVote, voterId } from '../../course/store';
import { EditorPanel } from '../../course/editor/panel';
import { editorKey, forwardOf } from '../../course/editor/keys';
import type { EditorCommand, KeyPress } from '../../course/editor/keys';
import { ACTION_KEYS, gateLine, problemsLine, refusalText } from '../../course/editor/words';

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
            editor: { open: false, selected: 0, changed: false, problems: 0, refused: null, said: '', votes: myVotes() }
        };
        ctx.hook.course = hook;
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
        let linkServer = serverOfLink(liveSearch());
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
        let checkFn: CourseCheck = () => [];
        /** the course the editing started from or was last saved as (the base of a fork or of a new version) */
        let edSource: TrackFile | null = null;
        let edChanged = false;
        let leaveAsked = false;
        let reopenAfter = false;
        let unblock: (() => void) | null = null;
        /** edit tokens of the pilot's own courses saved in this tab (only in memory: after a reload a save forks instead) */
        const tokens = new Map<string, string>();
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

        const frame = (): void => {
            if (!run || !hook.on || ed) return;
            const { ev, view: v } = run.fromSim(ctx.session.runner.sim);
            if (ev === 'lap' || ev === 'done') {
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
            hud.update(v, run.gates.length);
            sync();
        };

        const fail = (problem: string, text: string): void => {
            hook.problem = problem;
            ctx.hud.flash(text, 4000);
        };

        // lane review TR-3: a job that does not answer in time (a hostile course kept the worker in the sweeps for minutes) ends
        // the worker, so Shift+G and Shift+T work again. ESTIMATES: a check took 1.9 s in the page (run 5), a course 15-31 s
        const CHECK_LIMIT_MS = 20_000;
        const GENERATE_LIMIT_MS = 150_000; // up to three tries of enoughGates
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
                fail('timeout', t('course.failed', { msg: 'timeout' }));
            }, ms);
        };

        const onWorker = (e: MessageEvent<FromCourseWorker>): void => {
            const m = e.data;
            if (m.job !== job) return;
            busy = false;
            disarm();
            if (m.t === 'error') {
                checking = null;
                return fail(m.message.slice(0, 200), t('course.failed', { msg: m.message.slice(0, 120) }));
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
            setTrack(m.track, 'generated', m.track.generator?.seed ?? pending);
            history.replaceState(history.state, '', withCourse(location.href, m.track.id));
            ctx.hud.flash(t('course.ready', { n: m.track.gates.length }), 4000);
        };

        const ensureWorker = (): Worker => {
            if (!worker) {
                worker = new Worker(new URL('../../course/worker.ts', import.meta.url), { type: 'module' });
                worker.onmessage = onWorker;
                worker.onerror = (e) => {
                    disarm();
                    busy = false;
                    checking = null;
                    fail(e.message || 'worker error', t('course.failed', { msg: e.message || 'worker error' }));
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

        const generate = (seed: number): void => {
            const s = ctx.session;
            const w = walls();
            if (!w) return fail('no walls', t('course.noWalls'));
            if (busy) return;
            busy = true;
            hook.problem = null;
            ctx.hud.flash(t('course.generating'), 2500);
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
        const loadServer = async (index = 0, only = false): Promise<void> => {
            const row = rows[index];
            if (!row || (busy && index === 0)) return;
            const w = walls();
            if (!w) return fail('no walls', t('course.noWalls'));
            busy = true;
            hook.problem = null;
            ctx.hud.flash(t('course.server.loading'), 2500);
            const mine = ++job;
            const got = await store.load(row);
            if (mine !== job) return;
            if (!got.ok || got.track.scene.id !== ctx.session.scene.id) {
                busy = false;
                if (!only && index + 1 < rows.length) return loadServer(index + 1);
                if (!got.ok) return fail(got.problem, t('course.server.failed', { msg: got.problem.slice(0, 120) }));
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
            if (!r.ok) return fail(`save: ${r.problem}`, t('course.save.failed', { msg: r.problem.slice(0, 120) }));
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
                const i = rows.findIndex((r) => r.id === want);
                if (i < 0) return fail(`link: ${want} not listed`, t('course.link.missing'));
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
            if (ed) return;
            // TR-5: the scale feature (session.setTransform) and the walls switch fire no 'session' event
            if (run && !busy && (run.stale(ctx.session.transform) || ctx.session.collision !== provenOn)) return proveAgain();
            frame();
        });
        ctx.events.on('sim', (e) => {
            if (e.type === 'respawn' || e.type === 'crash') run?.reset();
        });
        ctx.events.on('life', () => run?.reset());
        ctx.events.on('pause', ({ on }) => {
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
        };
        const renderList = (): void => {
            edHook.votes = myVotes();
            panel?.list(rows, edHook.votes, hook.saved ?? hook.track?.id ?? null);
        };
        const showEd = (): void => {
            if (!ed || !panel) return;
            const track = toTrackV1(ed.course);
            run = new CourseRun(track, ctx.session.transform, null);
            provenOn = ctx.session.collision;
            hook.on = true;
            stage.show(run.gates);
            stage.setNext(ed.selected, run.path, track.laps > 1);
            shownNext = ed.selected;
            hud.update(null, 0);
            panel.status(gateLine(ed, scale()), problemsLine(ed), ed.problems.length > 0);
            panel.buttons(!edChanged && hook.source === 'generated' && hook.saved === null);
            edHook.open = true;
            edHook.selected = ed.selected;
            edHook.changed = edChanged;
            edHook.problems = ed.problems.length;
            sync();
        };
        const openEdit = (): void => {
            if (ed || ctx.sonic) return;
            const col = ctx.session.collision;
            if (!col) return fail('no walls', t('course.noWalls'));
            if (!run) {
                hook.problem = 'no course';
                ctx.hud.flash(t('course.edit.noCourse'), 4000);
                return;
            }
            checkFn = wallsCheck(col, flownTransform());
            edSource = run.track;
            ed = openEditor(upgradeTrack(run.track), checkFn, 0);
            edChanged = false;
            leaveAsked = false;
            edHook.refused = null;
            ctx.pause('panel');
            unblock = ctx.keys.block(() => ed !== null);
            panel = new EditorPanel(ctx.ui, { key: (p) => applyKey(p), saveMine: (n, ti) => void saveMine(n, ti), saveAll: () => void saveAll(), vote: (id, v) => void vote(id, v), open: (id) => openRow(id) });
            panel.defaults('', run.track.title);
            showEd();
            say(t('course.edit.opened'));
            renderList();
            void refresh(true).then(renderList);
        };
        /** `quiet`: the course is replaced right after (no redraw for flight) */
        function closeEdit(quiet = false): void {
            if (!ed) return;
            ed = null;
            panel?.destroy();
            panel = null;
            unblock?.();
            unblock = null;
            edHook.open = false;
            ctx.resume('panel');
            if (!quiet && run) {
                run.reset();
                draw();
            }
        }
        const viewForward = (): [number, number] => {
            const s = ctx.session.runner.sim.s;
            return forwardOf(s[S.qw] ?? 1, s[S.qx] ?? 0, s[S.qy] ?? 0, s[S.qz] ?? 0);
        };
        const applyKey = (press: KeyPress): void => {
            if (!ed || !panel) return;
            const k = editorKey(press, viewForward());
            if (!k) return;
            if ('cmd' in k) return command(k.cmd);
            leaveAsked = false;
            const out = edit(ed, k.edit, checkFn);
            ed = out.state;
            if (out.ok) {
                if (k.edit.kind !== 'select' && k.edit.kind !== 'select-step') edChanged = true;
                edHook.refused = null;
                showEd();
                say(t('course.edit.did', { what: t(ACTION_KEYS[out.action]), gate: gateLine(ed, scale()) }));
            } else {
                edHook.refused = out.reason.code;
                showEd();
                say(refusalText(ed.course, out.reason), true);
            }
        };
        const command = (c: EditorCommand): void => {
            if (!ed || !panel) return;
            if (c === 'exit') {
                if (edChanged && !leaveAsked) {
                    leaveAsked = true;
                    return say(t('course.edit.unsaved'), true);
                }
                return closeEdit();
            }
            if (c === 'regen' || c === 'regen-same') {
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
        const saveMine = async (nameIn: string, titleIn: string): Promise<void> => {
            if (!ed || !edSource || saving) return;
            if (!canSave(ed)) return say(t('course.edit.saveRefused', { why: problemsLine(ed) }), true);
            const name = nameIn.trim().normalize('NFC');
            const title = titleIn.trim().normalize('NFC');
            const edited = toTrackV1(ed.course);
            const serverId = hook.saved ?? (hook.source === 'server' ? edSource.id : null);
            const baseVersion = hook.track?.version ?? edSource.version;
            const token = serverId ? tokens.get(serverId) ?? null : null;
            const author = { kind: 'person' as const, name };
            const body: TrackFile = token && serverId
                ? { ...edited, id: serverId, version: baseVersion + 1, parent: { id: serverId, version: baseVersion }, author, title }
                : { ...edited, id: serverId ? freshId(serverId) : edited.id, version: 1, parent: serverId ? { id: serverId, version: baseVersion } : null, author, title };
            saving = true;
            const r = await store.saveMine(body, token);
            saving = false;
            if (!r.ok) {
                hook.problem = `save: ${r.problem}`;
                return say(t('course.save.failed', { msg: r.problem.slice(0, 120) }), true);
            }
            if (r.token) tokens.set(r.id, r.token);
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
        const vote = async (id: string, v: 1 | -1): Promise<void> => {
            const had = myVotes()[id] ?? 0;
            const nv = had === v ? 0 : v;
            const r = await store.vote(id, nv, voterId());
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
            reopenAfter = true;
            void loadServer(i);
        };
        addEventListener('keydown', (e: KeyboardEvent) => {
            if (!ed || !panel) return;
            if (panel.typing(e.target)) {
                if (e.code === 'Escape') (e.target as HTMLElement).blur();
                else if (e.code === 'Enter') command('save-mine');
                else return;
                e.preventDefault();
                e.stopPropagation();
                return;
            }
            // a button of the window keeps Enter and Space (a click)
            if ((e.code === 'Enter' || e.code === 'Space') && e.target instanceof HTMLButtonElement && panel.root.contains(e.target)) return;
            if (!editorKey(e, [0, -1])) return;
            e.preventDefault();
            e.stopPropagation();
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
