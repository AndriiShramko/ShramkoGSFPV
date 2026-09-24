// /fly entry: preflight -> scene picker -> flight (HUD, controls, crash, pause, settings).
// URL: ?scene=<id|link>&drone=<preset>&g=<m/s2>&gm=<honest|same-twr|auto-throttle>
// Test-only switches (never linked): ?simradio=scenario|open|raw, ?lat=1, ?lagFrames=N.
import { S, InputLog, parseBetaflightDiff } from '@gsfpv/sim-core';
import type { SimEvent, ParamOverrides } from '@gsfpv/sim-core';
import { parseSceneInput, recordOpen, recordFlight, SceneError } from '@gsfpv/scenes';
import { Scenario, makePlan, makeTourPlan } from '@gsfpv/input/sim';
import { findSphereSpawn, VoxelContactWorld, syntheticOpen } from '@gsfpv/collision';
import { GSPLAT_RENDERER_RASTER_GPU_SORT } from 'playcanvas';
import { FrameGovernor } from '@gsfpv/render-pc';
import type { CinemaRecorder, RecorderInfo } from './cinema';
import { FlightSession } from './session';
import { KeyboardSource } from './devices/keyboard';
import { TouchSticks } from './devices/touch';
import { FakeEdgeTx } from './devices/fakehid';
import { LatencyProbe } from './latency';
import { Controls } from './controls';
import { CrashView } from './crashview';
import { t, locale } from './i18n';
import { h, clear, panel } from './ui/dom';
import { ScenePicker, loadShowcase } from './ui/scenes';
import type { ShowcaseScene } from './ui/scenes';
import { DronePicker } from './ui/drone';
import { RadioScreen } from './ui/radio';
import type { RadioChoice } from './ui/radio';
import { Hud, CrashOverlay, pauseMenu, settingsPanel, measurePanel, replaysPanel, warningModal } from './ui/flight';
import type { SettingsValues } from './ui/flight';

const q = new URLSearchParams(location.search);
const ui = document.getElementById('ui')!;
const canvas = document.getElementById('view') as HTMLCanvasElement;
document.title = t('app.title');

interface SavedLog {
    label: string;
    header: InputLog['header'];
    bytes: Uint8Array;
    endTick: number;
    hash: string;
}

interface TestHook {
    status: 'loading' | 'picker' | 'ready' | 'error';
    error?: string;
    errorCode?: string;
    session?: FlightSession;
    scenario?: Scenario;
    controls?: Controls;
    radio?: RadioScreen;
    fake?: FakeEdgeTx;
    touch?: TouchSticks;
    crash?: CrashView;
    info?: Record<string, unknown>;
    lastCrash?: Record<string, unknown> | null;
    events: SimEvent[];
    savedLogs: SavedLog[];
    saveLog?: (label: string) => SavedLog;
    /** B15: replay the log saved in localStorage (optionally with one LSB flipped) in this tab */
    verifyLastLog?: (tamper?: { record: number; channel: number }) => { saved: string; endTick: number; hash: string; track: number[]; tampered: number | null } | null;
    loops?: number;
    /** phase C: result of building collision in this tab */
    bake?: Record<string, unknown>;
    bakedBytes?: { json: Uint8Array; bin: Uint8Array };
    runBake?: () => Promise<void>;
    /** save the baked collision as two downloads (acceptance runs the Node tunnelling harness on it) */
    downloadBaked?: () => boolean;
    /** phase D: the exported trajectory as text (the same text the export button saves) */
    trajectoryText?: (kind: 'csv' | 'json') => string;
    governor?: FrameGovernor;
    setFrameDelay?: (ms: number) => void;
    /** phase D: import rates and PID from a Betaflight CLI diff (the same path as the import panel) */
    importDiff?: (text: string) => { ok: boolean; firmware?: string | null; ratesType?: string; warnings?: string[]; errors?: string[] };
    /** phase D: cinema mode and the recorder */
    cinema?: { on: () => boolean; toggle: () => void; canRecord: boolean; start: () => Promise<string>; stop: () => Promise<RecorderInfo | null>; last: RecorderInfo | null; lastBytes: Uint8Array | null; creditStripStd: () => number };
}
const hook: TestHook = { status: 'loading', events: [], savedLogs: [] };
(window as unknown as { __gsfpv: TestHook }).__gsfpv = hook;

const hasWebGPU = typeof navigator !== 'undefined' && !!(navigator as Navigator & { gpu?: unknown }).gpu;
const hasHid = typeof navigator !== 'undefined' && 'hid' in navigator;
const isTouch = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;

function banner(text: string): void {
    ui.append(h('div', { class: 'banner', role: 'note', 'data-testid': 'banner' }, text));
}

function beacon(e: string, p: Record<string, string | number | boolean> = {}): void {
    try {
        navigator.sendBeacon?.('/api/e', JSON.stringify({ e, p }));
    } catch {
        /* offline / blocked */
    }
}

function settingsFrom(s: FlightSession): SettingsValues {
    const o = s.overrides;
    return {
        fov: o.fovDeg ?? s.params.cameraFovDeg,
        uptilt: o.uptiltDeg ?? s.params.cameraUptiltDeg,
        hud: true,
        units: 'metric',
        quality: 0.7,
        gravity: o.gravity ?? 9.81,
        gravityMode: o.gravityMode ?? 'honest',
        vCrash: o.vCrash ?? s.params.vCrash,
        tauMs: o.tauMs ?? s.params.tau * 1000,
        cdaScale: o.cdaScale ?? 1,
        reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
        pid: { roll: [...s.params.pid.roll], pitch: [...s.params.pid.pitch], yaw: [...s.params.pid.yaw] }
    };
}

let picker: ScenePicker | null = null;

function showPicker(showcase: ShowcaseScene[], errorCode: string | null, msg?: string): void {
    picker?.remove();
    picker = new ScenePicker(ui, showcase);
    picker.onPick = (raw, src) => go(raw, src, showcase);
    if (errorCode) picker.showError(errorCode, msg);
    hook.status = 'picker';
    hook.errorCode = errorCode ?? undefined;
}

function go(raw: string, source: 'showcase' | 'paste' | 'history', showcase: ShowcaseScene[]): void {
    const id = parseSceneInput(raw);
    if (!id) {
        hook.errorCode = 'invalid-link';
        showPicker(showcase, 'invalid-link');
        return;
    }
    const u = new URL(location.href);
    u.searchParams.set('scene', id);
    history.replaceState(null, '', u);
    beacon('scene_open', { source });
    void fly(id, showcase);
}

async function boot(): Promise<void> {
    if (!hasWebGPU) banner(t('banner.noWebgpu'));
    else if (!hasHid) banner(t('banner.noHid'));
    const showcase = await loadShowcase();
    let first = true;
    try { first = localStorage.getItem('gsfpv.warned') !== '1'; } catch { first = true; }
    const sceneParam = q.get('scene');
    const start = () => {
        if (sceneParam) go(sceneParam, 'paste', showcase);
        else showPicker(showcase, null);
    };
    if (first && !q.get('simradio') && q.get('lat') !== '1' && q.get('nowarn') !== '1') {
        warningModal(ui, () => { try { localStorage.setItem('gsfpv.warned', '1'); } catch { /* ignore */ } start(); });
    } else start();
}

async function fly(sceneId: string, showcase: ShowcaseScene[]): Promise<void> {
    picker?.remove();
    const loading = h('div', { class: 'loading' }, h('div', {}, h('div', {}, t('loading.scene')), h('div', { class: 'bar' }, h('i'))));
    ui.append(loading);
    const g = q.get('g');
    const gm = q.get('gm') as ParamOverrides['gravityMode'] | null;
    let session: FlightSession;
    try {
        session = await FlightSession.start(canvas, {
            sceneId,
            preset: q.get('drone') ?? undefined,
            overrides: { gravity: g ? Number(g) : undefined, gravityMode: gm ?? undefined },
            latencyMarker: q.get('lat') === '1',
            lagFrames: Number(q.get('lagFrames') ?? 0),
            renderScale: q.get('scale') ? Number(q.get('scale')) : 1
        });
    } catch (e) {
        loading.remove();
        const code = e instanceof SceneError ? e.code : 'generic';
        hook.error = String((e as Error)?.message ?? e);
        showPicker(showcase, code, hook.error);
        hook.status = 'error';
        hook.errorCode = code;
        return;
    }
    hook.session = session;
    await session.visible;
    loading.remove();
    document.body.classList.add('flying');
    const meta = showcase.find((s) => s.id === sceneId);
    recordOpen(sceneId, !!session.collision, meta?.title);
    beacon('scene_loaded', { has_collision: !!session.collision, load_ms_bucket: Math.round((session.timings.visibleMs ?? 0) / 1000) });

    // attribution: showcase scenes carry title/author/licence; pasted scenes link to the original
    const attr = h('div', { class: 'attribution interactive', 'data-testid': 'attribution' });
    if (meta) attr.append(t('scenes.attribution', { title: meta.title, author: meta.author, license: meta.license }), ' · ', h('a', { href: `https://superspl.at/scene/${sceneId}`, target: '_blank', rel: 'noopener' }, 'SuperSplat'));
    else attr.append(h('a', { href: `https://superspl.at/scene/${sceneId}`, target: '_blank', rel: 'noopener' }, t('scenes.byAuthor')));
    // takedown path: the landing's contact form opens with role "takedown" and the scene id filled in
    attr.append(' · ', h('a', { href: `/${locale}/?report=${sceneId}#contact`, target: '_blank', rel: 'noopener', 'data-testid': 'report-scene' }, t('scenes.report')));
    ui.append(attr);
    if (!session.collision) {
        // phase C: walls can be built right here from the splats (same tool and defaults as SuperSplat)
        const badge = h('div', { class: 'badge-nowalls', role: 'status', 'data-testid': 'no-collision' }, t('scenes.noCollisionBadge'));
        const status = h('div', { class: 'bake-status', role: 'status', 'aria-live': 'polite', 'data-testid': 'bake-status' });
        const bakeBtn = h('button', { type: 'button', class: 'btn', 'data-action': 'bake', onclick: () => void runBake() }, t('bake.button')) as HTMLButtonElement;
        const box = h('div', { class: 'bake-box interactive' }, badge, bakeBtn, status);
        ui.append(box);
        const runBake = async (): Promise<void> => {
            bakeBtn.disabled = true;
            session.pause(true);
            try {
                const { bakeCollision, BakeRefusedError, BAKE_MAX_GAUSSIANS } = await import('./bake');
                try {
                    const r = await bakeCollision(session.scene.contentUrl, session.scene.contentKind, session.renderer.app.graphicsDevice, (st) => { status.textContent = t('bake.working', { stage: t(`bake.stage.${st}`) }); });
                    session.installCollision(r.json, r.bin);
                    hook.bake = { ok: true, gaussians: r.gaussians, solidVoxels: r.solidVoxels, ms: r.ms, peakJsHeapMb: r.peakJsHeapMb, binBytes: r.bin.length, collisionSha256: session.collisionSha256 };
                    hook.bakedBytes = { json: r.json, bin: r.bin };
                    if (hook.info) hook.info.hasCollision = true;
                    badge.remove();
                    bakeBtn.remove();
                    status.textContent = t('bake.done', { voxels: (r.solidVoxels / 1e6).toFixed(1), s: (r.ms.total / 1000).toFixed(0) });
                    beacon('bake_done');
                } catch (e) {
                    if (e instanceof BakeRefusedError) {
                        hook.bake = { ok: false, refused: true, gaussians: e.size.gaussians, limit: BAKE_MAX_GAUSSIANS };
                        status.textContent = t('bake.refused', { n: (e.size.gaussians / 1e6).toFixed(1), max: (BAKE_MAX_GAUSSIANS / 1e6).toFixed(0) });
                        bakeBtn.remove();
                    } else {
                        hook.bake = { ok: false, error: String((e as Error)?.message ?? e) };
                        status.textContent = t('bake.failed', { msg: String((e as Error)?.message ?? e).slice(0, 160) });
                        bakeBtn.disabled = false;
                    }
                }
            } finally {
                session.pause(false);
            }
        };
        hook.runBake = runBake;
        hook.downloadBaked = () => {
            const b = hook.bakedBytes;
            if (!b) return false;
            for (const [name, bytes] of [['baked.voxel.json', b.json], ['baked.voxel.bin', b.bin]] as const) {
                const a = document.createElement('a');
                a.href = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/octet-stream' }));
                a.download = `${sceneId}-${name}`;
                a.click();
            }
            return true;
        };
        if (q.get('bake') === '1') void runBake();
    }
    // S5: another world with the same motors -> say what that does to thrust / weight before flying
    const gNow = session.params.gravity;
    if (gNow > 0 && gNow < 9.8 && (session.overrides.gravityMode ?? 'honest') === 'honest') {
        const warn = h('div', { class: 'banner', role: 'note', 'data-testid': 'gravity-warning' }, t('settings.gravityWarning', { g: gNow.toFixed(2), x: (9.81 / gNow).toFixed(1) }));
        ui.append(warn);
        setTimeout(() => warn.remove(), 12000);
    }

    const controls = new Controls(session);
    hook.controls = controls;
    const crash = new CrashView(session);
    hook.crash = crash;
    const hud = new Hud(ui);
    // quality governor: holds the display's frame rate; the settings "quality" is its ceiling
    const governor = new FrameGovernor();
    governor.enabled = q.get('governor') !== '0';
    hook.governor = governor;
    hook.setFrameDelay = (ms: number) => { frameDelay = Math.max(0, Math.min(200, ms)); };
    let userMaxScale = session.renderer.renderScale;
    let userBudget = 4;
    let cinemaOn = false;
    let frameDelay = 0; // test only (hook.setFrameDelay): burn CPU in each frame to simulate overload mid-flight
    const applyQuality = (): void => {
        if (cinemaOn) {
            session.renderer.setRenderScale(userMaxScale);
            session.renderer.setSplatBudgetMillions(16);
            return;
        }
        const st = governor.current;
        session.renderer.setRenderScale(Math.min(userMaxScale, st.renderScale));
        session.renderer.setSplatBudgetMillions(Math.min(userBudget, st.splatBudgetMillions));
    };
    new KeyboardSource(session);
    let overlay: CrashOverlay | null = null;
    let touch: TouchSticks | null = null;
    let closePause: (() => void) | null = null;

    ui.append(h('div', { class: 'top-actions' },
        h('button', { type: 'button', class: 'btn', 'data-action': 'open-controls', onclick: () => openRadio() }, t('top.controls')),
        h('button', { type: 'button', class: 'btn', 'data-action': 'pause', onclick: () => openPause() }, t('top.pause'))));

    function afterCrashCleared(): void {
        overlay?.remove();
        overlay = null;
        crash.clear();
        session.cameraOverride = false;
        session.stopReplay();
    }

    hook.saveLog = (label: string) => saveLog(session, label);
    hook.verifyLastLog = (tamper) => verifyLastLog(session, tamper);
    hook.trajectoryText = (kind) => trajectoryText(session, kind);

    session.onEvent = (e) => {
        hook.events.push(e);
        if (hook.events.length > 500) hook.events.shift();
        if (e.type === 'arm') { beacon('arm'); recordFlight(sceneId); }
        if (e.type === 'crash') {
            beacon('crash');
            session.cameraOverride = true;
            hook.lastCrash = { speed: e.speed, tick: e.tick, pending: true };
            void crash.onCrash(e).then(() => { hook.lastCrash = { ...crash.info!, event: e }; });
            setTimeout(() => {
                if (!crash.active) return;
                const sp = `${e.speed.toFixed(1)} m/s`;
                overlay = new CrashOverlay(ui, crash.info ?? { speed: e.speed, tick: e.tick, engine: 'sim-core', debris: 0, maxAngularSpeed: 0, staticBoxes: 0 }, sp);
                overlay.onRespawn = () => { afterCrashCleared(); session.respawn(false); touch?.setArmed(false); };
                overlay.onSafe = () => { afterCrashCleared(); session.respawn(true); touch?.setArmed(false); };
                overlay.onReplay = () => {
                    overlay?.remove();
                    overlay = null;
                    crash.clear();
                    session.cameraOverride = false;
                    session.startReplay(session.log, Math.max(0, e.tick - 10000), e.tick + 1500);
                };
                overlay.onSave = () => saveLog(session, `crash ${sp}`);
            }, 1500);
        }
    };

    session.onFrame = (s) => {
        const now = performance.now();
        if (frameDelay > 0) { const end = now + frameDelay; while (performance.now() < end) { /* simulated overload */ } }
        if (!cinemaOn && governor.onFrame(now)) applyQuality();
        controls.tick(now);
        if (!crash.active) crash.trackCamera();
        crash.frame(now);
        hud.update(s, controls.block, s.frameStats());
    };

    function openRadio(): void {
        session.pause(true);
        const r = new RadioScreen(ui);
        hook.radio = r;
        r.onDone = (c) => { r.remove(); session.pause(false); useChoice(c); };
    }

    function useChoice(c: RadioChoice): void {
        touch?.dispose();
        touch = null;
        controls.profile = c.profile;
        controls.source = c.kind;
        if (c.kind === 'hid' && c.hid) c.hid.onFrame = (f) => controls.raw(f);
        if (c.kind === 'gamepad' && c.gamepad) c.gamepad.onFrame = (f) => controls.raw(f);
        if (c.kind === 'touch') {
            touch = new TouchSticks(session, ui, controls);
            hook.touch = touch;
        }
        beacon('input_connected', { kind: c.kind });
    }

    function openPause(): void {
        if (closePause) return;
        session.pause(true);
        closePause = pauseMenu(ui, {
            resume: () => { closePause = null; session.pause(false); },
            restart: () => { closePause = null; afterCrashCleared(); session.rebuildSim(session.presetId, session.overrides); session.pause(false); },
            scene: () => { location.search = ''; },
            drone: () => {
                closePause = null;
                const d = new DronePicker(ui, session.presetId);
                d.onPick = (id) => {
                    d.remove();
                    afterCrashCleared();
                    session.rebuildSim(id, session.overrides);
                    const u = new URL(location.href);
                    u.searchParams.set('drone', id);
                    history.replaceState(null, '', u);
                    session.pause(false);
                };
            },
            radio: () => { closePause = null; openRadio(); },
            settings: () => {
                closePause = null;
                settingsPanel(ui, settingsFrom(session), session.params.twr, (v) => {
                    hud.visible = v.hud;
                    crash.reducedMotion = v.reducedMotion;
                    userMaxScale = 0.5 + v.quality * 0.5;
                    userBudget = 1 + v.quality * 3;
                    applyQuality();
                    const o: ParamOverrides = { ...session.overrides, fovDeg: v.fov, uptiltDeg: v.uptilt, gravity: v.gravity, gravityMode: v.gravityMode, vCrash: v.vCrash, tauMs: v.tauMs, cdaScale: v.cdaScale, pid: v.pid };
                    afterCrashCleared();
                    session.rebuildSim(session.presetId, o);
                    session.pause(false);
                }, () => session.pause(false));
            },
            replays: () => {
                closePause = null;
                replaysPanel(ui, hook.savedLogs.map((l) => ({
                    label: l.label,
                    play: () => { session.pause(false); session.startReplay(InputLog.fromBytes(l.header, l.bytes), 0, l.endTick); },
                    exportCsv: () => exportTrajectory(session, 'csv'),
                    exportJson: () => exportTrajectory(session, 'json')
                })), () => session.pause(false));
            },
            measure: () => {
                closePause = null;
                measurePanel(ui, measureReport(session, controls), () => session.pause(false));
            },
            cinema: () => {
                closePause = null;
                toggleCinema();
                session.pause(false);
            },
            import: () => {
                closePause = null;
                openImport();
            }
        });
    }

    // ------------------------------------------------------------ Betaflight diff import (phase D)
    function importDiff(text: string): ReturnType<NonNullable<TestHook['importDiff']>> {
        const r = parseBetaflightDiff(text);
        if (r.errors.length || (!r.rates && !r.pid)) return { ok: false, errors: r.errors.length ? r.errors : ['nothing to import'], warnings: r.warnings };
        const o: ParamOverrides = { ...session.overrides };
        if (r.rates) o.rates = r.rates;
        if (r.pid) o.pid = { roll: [...r.pid.roll], pitch: [...r.pid.pitch], yaw: [...r.pid.yaw] };
        if (r.throttle) o.throttle = { mid: r.throttle.mid, expo: r.throttle.expo };
        afterCrashCleared();
        session.rebuildSim(session.presetId, o);
        const v = r.firmware.version;
        return { ok: true, firmware: v ? `${r.firmware.name ?? 'Betaflight'} ${v.major}.${v.minor}.${v.patch}` : null, ratesType: r.rates?.type, warnings: r.warnings };
    }
    hook.importDiff = importDiff;
    function openImport(): void {
        session.pause(true);
        const p = panel(t('import.title'), () => { p.close(); session.pause(false); });
        const area = h('textarea', { class: 'import-text', rows: 10, spellcheck: 'false', 'aria-label': t('import.title'), placeholder: '# version … Betaflight / STM32F405 (S405) 4.5.1 …' }) as HTMLTextAreaElement;
        const out = h('div', { class: 'import-out', role: 'status', 'aria-live': 'polite' });
        const apply = h('button', { type: 'button', class: 'btn primary', 'data-action': 'import-apply', onclick: () => {
            const r = importDiff(area.value);
            clear(out);
            out.append(h('p', {}, r.ok ? t('import.ok', { fw: r.firmware ?? '?', type: r.ratesType ?? '—', w: String(r.warnings?.length ?? 0) }) : t('import.refused', { msg: (r.errors ?? []).join(' · ') })));
            // every warning in full: a success with warnings must not read as a clean success
            if (r.warnings?.length) out.append(h('ul', { class: 'import-warnings' }, ...r.warnings.map((w) => h('li', {}, w))));
        } }, t('import.apply'));
        p.body.append(h('p', { class: 'muted' }, t('import.hint')), area, apply, out);
        ui.append(p.root);
        area.focus();
    }

    // ------------------------------------------------------------ cinema mode (phase D)
    const credit = meta ? `${meta.title} — ${meta.author}, ${meta.license} · gsfpv.flyreelstudio.eu` : '';
    let recorder: CinemaRecorder | null = null;
    const recBtn = h('button', { type: 'button', class: 'btn rec', 'data-action': 'cinema-rec', hidden: true, onclick: () => void (recorder?.recording ? stopRec() : startRec()) }, t('cinema.rec')) as HTMLButtonElement;
    const cinemaNote = h('div', { class: 'cinema-note', role: 'status', 'data-testid': 'cinema-note', hidden: true });
    ui.append(h('div', { class: 'cinema-bar interactive' }, recBtn, cinemaNote));
    session.renderer.app.on('frameend', () => { if (recorder?.recording) recorder.addFrame(canvas, performance.now()); });
    function toggleCinema(): void {
        cinemaOn = !cinemaOn;
        document.body.classList.toggle('cinema', cinemaOn);
        governor.enabled = !cinemaOn && q.get('governor') !== '0';
        session.renderer.setDetail(cinemaOn ? 'final' : 'auto');
        applyQuality();
        recBtn.hidden = !cinemaOn || !meta;
        cinemaNote.hidden = !cinemaOn;
        cinemaNote.textContent = cinemaOn ? (meta ? t('cinema.on') : t('cinema.noRec')) : '';
        if (!cinemaOn && recorder?.recording) void stopRec();
    }
    async function startRec(): Promise<string> {
        if (!meta) throw new Error('recording is only for showcase scenes');
        const { CinemaRecorder } = await import('./cinema');
        if (!CinemaRecorder.supported) { cinemaNote.textContent = t('cinema.unsupported'); throw new Error('WebCodecs unavailable'); }
        recorder = new CinemaRecorder(canvas.width, canvas.height, credit);
        const codec = await recorder.start();
        recBtn.textContent = t('cinema.stop');
        recBtn.classList.add('on');
        return codec;
    }
    async function stopRec(): Promise<RecorderInfo | null> {
        if (!recorder) return null;
        const { bytes, info } = await recorder.stop();
        recBtn.textContent = t('cinema.rec');
        recBtn.classList.remove('on');
        hookCinema.last = info;
        hookCinema.lastBytes = bytes;
        cinemaNote.textContent = t('cinema.saved', { s: info.seconds.toFixed(1), mb: (info.bytes / 1048576).toFixed(1) });
        if (!q.get('simradio')) {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'video/mp4' }));
            a.download = `gsfpv-${sceneId}-${Date.now()}.mp4`;
            a.click();
        }
        return info;
    }
    const hookCinema: NonNullable<TestHook['cinema']> = { on: () => cinemaOn, toggle: toggleCinema, canRecord: !!meta, start: startRec, stop: stopRec, last: null, lastBytes: null, creditStripStd: () => recorder?.lastCreditStripStd ?? 0 };
    hook.cinema = hookCinema;

    addEventListener('keydown', (e) => {
        if (e.code === 'KeyP' || e.code === 'Escape') { if (closePause) { closePause(); closePause = null; session.pause(false); } else openPause(); }
        if (e.code === 'KeyR') { afterCrashCleared(); session.respawn(false); }
        if (e.code === 'F3') { hud.toggleFrameStats(); e.preventDefault(); }
    });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden' && !closePause && !q.get('simradio') && q.get('lat') !== '1') openPause();
    });

    // ------------------------------------------------------------ test modes
    const simMode = q.get('simradio');
    if (simMode === 'scenario' || simMode === 'open') {
        if (!session.collision) throw new Error('the bot scenario needs a scene with collision');
        const col = session.collision;
        const p = session.params;
        const cam = session.scene.camera!;
        const plan = q.get('tour') === '1'
            ? makeTourPlan(col, p.boundRadius, [session.spawn[0], session.spawn[1], session.spawn[2]], cam.target, Number(q.get('dash') ?? 2 * p.vCrash))
            : makePlan(col, p.boundRadius, [session.spawn[0], session.spawn[1], session.spawn[2]], cam.target, Number(q.get('dash') ?? 2 * p.vCrash),
                (x, y, z, r, o) => findSphereSpawn(col, x, y, z, r, o));
        if (q.get('quick') === '1') plan.box = [plan.spawn]; // crash loops: hover, aim, dash
        if (q.get('flip') === '1') {
            // flip point: straight above the spawn with 0.6 m of air above the craft (at most +1.5 m)
            const up = col.queryRay(plan.spawn[0], plan.spawn[1], plan.spawn[2], 0, 1, 0, 3);
            const room = up ? up.y - plan.spawn[1] - 0.6 - p.boundRadius : 1.5;
            plan.flipAt = [plan.spawn[0], plan.spawn[1] + Math.max(0, Math.min(1.5, room)), plan.spawn[2]];
        }
        session.runner.respawn(plan.spawn[0], plan.spawn[1], plan.spawn[2], plan.spawnYawDeg);
        if (simMode === 'open') session.sim.world = new VoxelContactWorld(syntheticOpen(0.05, 1000));
        hook.scenario = new Scenario(session.runner, plan);
        controls.source = 'sim';
        // B17: crash loop — after each crash settles, respawn and fly the same plan again
        let loopsLeft = Number(q.get('loop') ?? 0);
        hook.loops = 0;
        let restSince = 0;
        if (loopsLeft > 0) {
            const prevFrame = session.onFrame;
            session.onFrame = (s, dt) => {
                prevFrame?.(s, dt);
                const sc = hook.scenario;
                if (!sc || !sc.finished || loopsLeft <= 0) { restSince = 0; return; }
                const now = performance.now();
                if (!restSince) restSince = now;
                if (now - restSince < 2500) return; // crash camera and overlay play out first
                restSince = 0;
                loopsLeft--;
                hook.loops = (hook.loops ?? 0) + 1;
                afterCrashCleared();
                session.runner.respawn(plan.spawn[0], plan.spawn[1], plan.spawn[2], plan.spawnYawDeg);
                hook.scenario = new Scenario(session.runner, plan);
            };
        }
    } else if (simMode === 'raw') {
        // simulated EdgeTX radio (raw 19-byte reports) running the calibration wizard like a person
        const fake = new FakeEdgeTx({
            order: q.get('order') ?? 'TAER',
            invert: Object.fromEntries((q.get('inv') ?? 'E').split('').filter(Boolean).map((k) => [k, true])),
            centerOffset: Number(q.get('offset') ?? 0.03),
            noise: Number(q.get('noise') ?? 0.01),
            armChannel: 4,
            rateHz: Number(q.get('rate') ?? 250),
            seed: 7,
            brokenStick: (q.get('broken') as 'A' | 'E' | 'T' | 'R' | null) ?? undefined
        });
        hook.fake = fake;
        session.pause(true);
        const r = new RadioScreen(ui);
        hook.radio = r;
        fake.follow = () => r.wizard?.state ?? null;
        r.runWizard(fake.key, 'SimRadio EdgeTX Classic', (cb) => { fake.onFrame = cb; }, () => fake.cfg.rateHz, 'hid');
        r.onDone = (c) => {
            r.remove();
            session.pause(false);
            controls.profile = c.profile;
            controls.source = 'hid';
            fake.follow = null;
            fake.onFrame = (f) => controls.raw(f);
        };
        fake.start();
    } else if (q.get('lat') === '1') {
        controls.source = 'keyboard';
    } else if (isTouch && !hasHid) {
        useChoice({ kind: 'touch', profile: null });
    } else if (q.get('input') === 'touch') {
        useChoice({ kind: 'touch', profile: null });
    } else {
        openRadio();
    }

    if (q.get('lat') === '1') {
        const probe = new LatencyProbe(session);
        const nonce = q.get('nonce') ?? '';
        document.title = `GSFPV-LAT ${nonce} ready dpr=${devicePixelRatio}`;
        addEventListener('keydown', (e) => {
            if (e.code === 'F20' || e.key === 'F20') {
                session.lagFrames = session.lagFrames === 0 ? 2 : 0;
                document.title = `GSFPV-LAT ${nonce} ready dpr=${devicePixelRatio} lag=${session.lagFrames}`;
                return;
            }
            if (e.code !== 'F24' && e.key !== 'F24') return;
            fetch('/report', { method: 'POST', body: JSON.stringify({ page: 'fly', lagFrames: session.lagFrames, records: probe.summary(), framePeriod: probe.framePeriod(), frames: session.frames, hitches: session.runner.hitches, renderer: session.renderer.currentRenderer, visibility: document.visibilityState, userAgent: navigator.userAgent }) })
                .then(() => { document.title = `GSFPV-LAT ${nonce} reported`; });
        });
    }

    hook.info = {
        webgpu: session.renderer.isWebGPU,
        currentRenderer: session.renderer.currentRenderer,
        gpuSort: session.renderer.currentRenderer === GSPLAT_RENDERER_RASTER_GPU_SORT,
        hasCollision: !!session.collision,
        collisionSha256: session.collisionSha256,
        timings: session.timings,
        spawn: session.spawn,
        preset: session.presetId,
        locale
    };
    if (q.get('clean') === '1') document.body.classList.add('clean'); // recording: flight view + OSD only
    hook.status = 'ready';
    void S;
}

function verifyLastLog(s: FlightSession, tamper?: { record: number; channel: number }): ReturnType<NonNullable<TestHook['verifyLastLog']>> {
    let raw: string | null = null;
    try { raw = localStorage.getItem('gsfpv.lastLog'); } catch { raw = null; }
    if (!raw) return null;
    const j = JSON.parse(raw) as { header: InputLog['header']; endTick: number; hash: string; b64: string };
    const bin = atob(j.b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    let tampered: number | null = null;
    if (tamper) {
        // least significant byte of a little-endian float32 channel value: 1 LSB of the mantissa
        const off = tamper.record * InputLog.REC + 4 + tamper.channel * 4;
        tampered = new DataView(bytes.buffer).getFloat32(off, true);
        bytes[off] ^= 1;
    }
    const r = s.replayTrack(InputLog.fromBytes(j.header, bytes), j.endTick);
    return { saved: j.hash, endTick: j.endTick, hash: r.hash, track: r.track, tampered };
}

function saveLog(s: FlightSession, label: string): SavedLog {
    const bytes = new Uint8Array(s.log.bytes());
    const entry: SavedLog = { label, header: s.log.header, bytes, endTick: s.sim.tick, hash: s.runner.traceHash() };
    hook.savedLogs.push(entry);
    try {
        // the latest saved log survives a reload / a new tab
        let bin = '';
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        localStorage.setItem('gsfpv.lastLog', JSON.stringify({ label, header: entry.header, endTick: entry.endTick, hash: entry.hash, b64: btoa(bin) }));
    } catch { /* quota: keep it in memory */ }
    if (!q.get('simradio')) {
        const blob = new Blob([JSON.stringify(entry.header), '\n', bytes], { type: 'application/octet-stream' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `gsfpv-flight-${Date.now()}.gsfpvlog`;
        a.click();
    }
    return entry;
}

/** Trajectory as text: 100 samples per sim second, straight from the flight model's state. */
function trajectoryText(s: FlightSession, kind: 'csv' | 'json'): string {
    const tr = s.runner.trajectory ?? [];
    if (kind === 'json') return JSON.stringify({ header: s.log.header, samplesHz: 100, points: tr }, null, 1);
    return 't,px,py,pz,qw,qx,qy,qz,vx,vy,vz,m1,m2,m3,m4,throttle,armed,crashed\n' + tr.map((p) => [p.t, ...p.p, ...p.q, ...p.v, ...p.motors, p.throttle, p.armed ? 1 : 0, p.crashed ? 1 : 0].join(',')).join('\n');
}

function exportTrajectory(s: FlightSession, kind: 'csv' | 'json'): void {
    const text = trajectoryText(s, kind);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: kind === 'json' ? 'application/json' : 'text/csv' }));
    a.download = `gsfpv-trajectory-${Date.now()}.${kind}`;
    a.click();
}

function measureReport(s: FlightSession, c: Controls): Record<string, unknown> {
    const fs = s.frameStats();
    const tt = s.collision ? s.tunnelSelfTest(5, 25) : null;
    return {
        renderer: s.renderer.currentRenderer === GSPLAT_RENDERER_RASTER_GPU_SORT ? 'WebGPU, GPU sort' : `renderer ${s.renderer.currentRenderer}`,
        outputHz: fs.hz,
        frameP50: fs.p50,
        frameP99: fs.p99,
        physicsHz: 1000,
        inputSource: c.source,
        inputHz: null,
        pipelineMs: null,
        loadMs: s.timings.visibleMs,
        collision: s.collision ? `voxel ${Math.round(s.collision.voxelResolution * 1000) / 10} cm, ${s.collision.flipXY ? 'format 1.0' : 'format 1.1'}` : 'none',
        tunnelSelfTest: tt ? t('tunnel.pass', { n: tt.passes, v: tt.speed, bad: tt.penetrations }) : '—',
        simCore: s.log.header.simCore,
        preset: s.presetId,
        date: new Date().toISOString()
    };
}

boot().catch((e) => {
    hook.status = 'error';
    hook.error = String(e?.message ?? e);
    clear(ui);
    ui.append(h('div', { class: 'center-msg' }, h('div', { class: 'error' }, hook.error)));
    console.error(e);
});
