// One flight: load the scan behind the loading screen, build the FlightContext, install FEATURES,
// then start the input (a test mode, or the pilot's own). docs/architecture-v03.md 1.1.
import type { ParamOverrides } from '@gsfpv/sim-core';
import type { PrefsStore } from '@gsfpv/prefs';
import { recordOpen, SceneError } from '@gsfpv/scenes';
import type { SplatRenderer } from '@gsfpv/render-pc';
import { GSPLAT_RENDERER_RASTER_GPU_SORT } from 'playcanvas';
import { FlightSession } from '../session';
import { Controls } from '../controls';
import { CrashView } from '../crashview';
import { VoxelController } from '../voxels';
import { initialWallsOn, loadWallsChoice } from '../flightwalls';
import { Hud } from '../ui/hud';
import { LoadingScreen } from '../ui/loading';
import type { ShowcaseScene } from '../ui/scenes';
import { t, locale } from '../i18n';
import { Bus } from './context';
import type { AppEvents, FlightContext, PauseReason, SceneRef, WallsHost } from './context';
import { PauseStack } from './pause-stack';
import { KeyRouter } from './keys';
import { PauseMenu } from './menu';
import { InputHost, expectResume, ownInput, resumeInput, release } from './input';
import { Quality } from './quality';
import { wallsHost } from './walls';
import { FEATURES } from './features';
import { startTestMode, latencyHarness, voxelSwitches } from './test-modes';
import { hook, keepEvent } from './test-hook';
import { saveLog, verifyLastLog, trajectoryText } from './logs';
import { beacon, hasHid, isTouch, q } from './env';

/** The "radios over USB need Chrome or Edge" note stays this long into a flight. */
const HID_NOTE_FLIGHT_MS = 8000;

class Flight implements FlightContext {
    readonly ui: HTMLElement;
    readonly canvas: HTMLCanvasElement;
    readonly renderer: SplatRenderer;
    /** wired by the lead before wave 2 (context.ts) */
    readonly prefs: PrefsStore | null = null;
    session: FlightSession;
    scene: SceneRef;
    readonly events = new Bus<AppEvents>();
    readonly keys: KeyRouter;
    readonly controls: Controls;
    readonly crash: CrashView;
    readonly hud = new Hud();
    readonly menu: PauseMenu;
    readonly input: InputHost;
    readonly quality: Quality;
    readonly walls: WallsHost;
    readonly voxels: VoxelController;
    readonly hook = hook;
    /** every screen's pause; the session has one holder for all of them ('menu'), the reasons live here */
    private readonly stack = new PauseStack<PauseReason>((on, reasons) => {
        this.session.pause(on, 'menu');
        this.events.emit('pause', { on, reasons });
    });

    constructor(ui: HTMLElement, canvas: HTMLCanvasElement, session: FlightSession, scene: SceneRef) {
        this.ui = ui;
        this.canvas = canvas;
        this.session = session;
        this.scene = scene;
        this.renderer = session.renderer;
        this.voxels = new VoxelController(session);
        this.walls = wallsHost({ session: () => this.session, scene: () => this.scene, events: this.events, clearCrash: () => this.clearCrash() });
        this.controls = new Controls(session);
        this.crash = new CrashView(session);
        this.quality = new Quality(session.renderer);
        // the Controls screen has its own keys (it stops Esc, P, R and Space itself)
        this.keys = new KeyRouter({ state: () => (this.crash.active ? 'crash' : 'flight') });
        this.keys.block(() => !!document.querySelector('.screen.radio'));
        this.menu = new PauseMenu(ui, this.keys, this);
        this.input = new InputHost(this);
    }

    pause(reason: PauseReason): void {
        this.stack.hold(reason);
    }

    resume(reason: PauseReason): void {
        this.stack.release(reason);
    }

    clearCrash(): void {
        this.events.emit('crashCleared', null);
        this.crash.clear();
        this.session.cameraOverride = false;
        this.session.stopReplay();
    }

    /** Every frame, in this order: quality, the input's tick, the voxel grid, the crash view, the OSD; then the features' frame work. */
    frame(): void {
        const now = performance.now();
        const s = this.session;
        this.quality.frame(now);
        this.controls.tick(now);
        this.voxels.frame(now);
        if (!this.crash.active) this.crash.trackCamera();
        this.crash.frame(now);
        this.hud.update(s, this.controls.block, s.frameStats(), this.controls.view());
        this.events.emit('frame', { now });
    }
}

/** Load `sceneId` and fly it; a scan that fails to load goes back to the picker through `onFail`. */
export async function fly(ui: HTMLElement, canvas: HTMLCanvasElement, sceneId: string, showcase: ShowcaseScene[], onFail: (code: string, msg: string) => void): Promise<void> {
    const meta = showcase.find((s) => s.id === sceneId);
    // the Controls screen follows the loading screen unless a test mode or touch sticks take over
    const sim = q.get('simradio');
    // no test mode, no forced input: the input from last time is looked for while the scan loads
    const own = ownInput();
    const resumed = own ? resumeInput().catch(() => null) : Promise.resolve(null);
    const controlsNext = own ? !expectResume() : sim === 'raw' && q.get('lat') !== '1' && q.get('input') !== 'touch' && !(isTouch && !hasHid);
    const loading = new LoadingScreen(ui, {
        sceneId,
        title: meta?.title,
        next: controlsNext ? t('loading.next') : null,
        onRetry: () => location.reload(),
        onBack: () => { location.search = ''; }
    });
    const tLoad = performance.now();
    hook.loading = { stage: 'connect', loaded: 0, total: 0, fraction: 0, exact: false, elapsedMs: 0 };
    const g = q.get('g');
    const gm = q.get('gm') as ParamOverrides['gravityMode'] | null;
    let session: FlightSession;
    // walls on or off: ?walls= (tests, this load only), the pilot's own choice for this scan, the scan's default
    const wallsOn = initialWallsOn(meta?.walls, loadWallsChoice(sceneId), q.get('walls'));
    try {
        session = await FlightSession.start(canvas, {
            sceneId,
            wallsOn,
            preset: q.get('drone') ?? undefined,
            overrides: { gravity: g ? Number(g) : undefined, gravityMode: gm ?? undefined },
            latencyMarker: q.get('lat') === '1',
            lagFrames: Number(q.get('lagFrames') ?? 0),
            renderScale: q.get('scale') ? Number(q.get('scale')) : 1,
            onProgress: (p) => {
                loading.update(p);
                hook.loading = { stage: p.stage, loaded: p.loaded, total: p.total, fraction: p.fraction, exact: p.exact, elapsedMs: Math.round(performance.now() - tLoad) };
            }
        });
    } catch (e) {
        loading.remove();
        const code = e instanceof SceneError ? e.code : 'generic';
        hook.error = String((e as Error)?.message ?? e);
        onFail(code, hook.error);
        void resumed.then(release);
        hook.status = 'error';
        hook.errorCode = code;
        return;
    }
    hook.session = session;
    await session.visible;
    // loading leaves Chrome's compositor 2 frames behind: the guard measures and skips out of it
    // while "ready" is still on screen, then keeps watching (?guard=0: measure only, never skip)
    session.renderer.startLatencyGuard(q.get('guard') !== '0');
    // "The scan is ready" for a moment, then the scan fades in: no jump straight into another screen
    await loading.finish();
    document.body.classList.add('flying');
    // the USB note is about choosing a browser; over the flight it covers the OSD's top line and
    // shows through the Controls screen (a phone has no room to move either), so it goes by itself
    const hidNote = ui.querySelector('.banner[data-kind="no-hid"]');
    if (hidNote) setTimeout(() => hidNote.remove(), HID_NOTE_FLIGHT_MS);
    recordOpen(sceneId, !!session.collision, meta?.title);
    beacon('scene_loaded', { has_collision: !!session.collision, load_ms_bucket: Math.round((session.timings.visibleMs ?? 0) / 1000) });

    const ctx = new Flight(ui, canvas, session, { id: sceneId, meta });
    hook.controls = ctx.controls;
    hook.crash = ctx.crash;
    hook.governor = ctx.quality.governor;
    hook.setFrameDelay = (ms: number) => ctx.quality.setFrameDelay(ms);
    hook.saveLog = (label: string) => saveLog(ctx.session, label);
    hook.verifyLastLog = (tamper) => verifyLastLog(ctx.session, tamper);
    hook.trajectoryText = (kind) => trajectoryText(ctx.session, kind);
    ctx.events.on('sim', keepEvent);
    session.onEvent = (e) => ctx.events.emit('sim', e);
    session.onFrame = () => ctx.frame();
    for (const f of FEATURES) f.install(ctx);
    ctx.keys.attach();

    if (!startTestMode(ctx)) await ctx.input.start(resumed);
    latencyHarness(ctx);
    voxelSwitches(ctx);

    hook.info = {
        webgpu: session.renderer.isWebGPU,
        currentRenderer: session.renderer.currentRenderer,
        gpuSort: session.renderer.currentRenderer === GSPLAT_RENDERER_RASTER_GPU_SORT,
        hasCollision: !!session.collision,
        collisionSha256: session.collisionSha256,
        walls: session.walls,
        timings: session.timings,
        spawn: session.spawn,
        preset: session.presetId,
        locale
    };
    if (q.get('clean') === '1') document.body.classList.add('clean'); // recording: flight view + OSD only
    hook.status = 'ready';
}
