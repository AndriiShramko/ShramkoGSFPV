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
import { S } from '@gsfpv/sim-core';
import type { TrackFile } from '@shramko/sonic-fpv';
import { t } from '../../i18n';
import type { Feature, FlightContext } from '../context';
import type { CourseHook } from '../../course/hook';
import { CourseRun } from '../../course/run';
import { CourseStage } from '../../course/view';
import { CourseHud, lapClock } from '../../course/hud';
import { bestKey, readBest, seedOfLink, withCourse, writeBest } from '../../course/link';
import { CourseStore, type CourseRow } from '../../course/store';
import type { CheckJob, CourseGrid, CourseJob, FromCourseWorker } from '../../course/worker';

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
            beaconPoints: 0, problem: null, serverTracks: -1, saved: null
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
        let linkSeed = seedOfLink(location.search);
        let pending: number | null = null;
        let checking: TrackFile | null = null;

        const drone = (): string => ctx.session.presetId;
        const tick = (): number => ctx.session.runner.sim.tick;
        const keyOf = (tr: TrackFile): string => bestKey(tr.id, tr.version, drone());

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
            run = track ? new CourseRun(track, ctx.session.transform, readBest(keyOf(track))) : null;
            hook.source = track ? source : 'none';
            hook.track = track ? { id: track.id, version: track.version } : null;
            hook.seed = track ? seed : null;
            hook.on = !!track;
            hook.saved = null;
            draw();
        };

        const frame = (): void => {
            if (!run || !hook.on) return;
            const sim = ctx.session.runner.sim;
            const ev = run.feed(sim.tick, [sim.s[S.px], sim.s[S.py], sim.s[S.pz]]);
            const v = run.view(sim.tick);
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

        const onWorker = (e: MessageEvent<FromCourseWorker>): void => {
            const m = e.data;
            if (m.job !== job) return;
            busy = false;
            if (m.t === 'error') {
                checking = null;
                return fail(m.message.slice(0, 200), t('course.failed', { msg: m.message.slice(0, 120) }));
            }
            if (m.t === 'checked') {
                const tr = checking;
                checking = null;
                if (!tr) return;
                // a course that does not fit the pilot's own walls is never shown (the server cannot see walls)
                if (!m.ok) return fail(`refused: ${m.issues.join('; ') || 'not clear'}`.slice(0, 200), t('course.server.refused'));
                setTrack(tr, 'server', tr.generator?.seed ?? null);
                ctx.hud.flash(t('course.server.loaded', { n: tr.gates.length }), 4000);
                return;
            }
            if (!m.track) return fail('nothing fits', t('course.none'));
            setTrack(m.track, 'generated', pending);
            history.replaceState(history.state, '', withCourse(location.href, m.track.id));
            ctx.hud.flash(t('course.ready', { n: m.track.gates.length }), 4000);
        };

        const ensureWorker = (): Worker => {
            if (!worker) {
                worker = new Worker(new URL('../../course/worker.ts', import.meta.url), { type: 'module' });
                worker.onmessage = onWorker;
                worker.onerror = (e) => {
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
        };

        /** The newest course the server keeps for this scene: fetched, held to the contract, proven on our walls, then shown. */
        const loadServer = async (): Promise<void> => {
            const row = rows[0];
            if (!row || busy) return;
            const w = walls();
            if (!w) return fail('no walls', t('course.noWalls'));
            busy = true;
            hook.problem = null;
            ctx.hud.flash(t('course.server.loading'), 2500);
            const mine = ++job;
            const got = await store.load(row);
            if (mine !== job) return;
            if (!got.ok) {
                busy = false;
                return fail(got.problem, t('course.server.failed', { msg: got.problem.slice(0, 120) }));
            }
            if (got.track.scene.id !== ctx.session.scene.id) {
                busy = false;
                return fail('another scene', t('course.server.refused'));
            }
            checking = got.track;
            const msg: CheckJob = { t: 'check', job: mine, ...w, track: got.track, transform: flownTransform() };
            ensureWorker().postMessage(msg, [w.nodes.buffer, w.leaf.buffer]);
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
            void refresh();
        };

        const refresh = async (): Promise<void> => {
            const scene = ctx.session.scene.id;
            const got = await store.list(scene);
            if (ctx.session.scene.id !== scene) return;
            const had = hook.serverTracks;
            rows = got;
            hook.serverTracks = got.length;
            if (had <= 0 && got.length > 0 && !run) ctx.hud.flash(t('course.server.offer'), 4000);
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

        ctx.keys.on('course.toggle', (e) => {
            if (e.repeat) return;
            toggle();
        });
        ctx.keys.on('course.generate', (e) => {
            if (e.repeat) return;
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

        ctx.events.on('frame', () => frame());
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
            job++;
            busy = false;
            checking = null;
            rows = [];
            hook.serverTracks = -1;
            setTrack(null, 'none', null);
            void refresh();
            if (linkSeed !== null) tryLink();
        });
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
