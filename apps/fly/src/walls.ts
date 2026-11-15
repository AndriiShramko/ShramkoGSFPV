// The walls box on the flight view (hidden while flying): which walls fly and how fine; for a scan
// without walls the phase C build button; for coarse shipped walls a refine to 1.6 cm, started by
// itself when it is short and this machine's bake speed is known, offered otherwise; walls built
// before come from the browser's store without a rebuild, and the store travels to another PC as a
// zip. New walls never land under a flying craft: they go in while it is parked at the spawn, else
// at the next respawn or restart (session.queueCollision). With the walls switched off (the pilot's
// C, or the scan's default in showcase.json) nothing is offered or baked: a refine waits until the
// walls come back on (WallsHook.switched).
import type { FlightSession } from './session';
import { t } from './i18n';
import { h } from './ui/dom';
import { BASE_VOXEL_M, BakeRefusedError, DEFAULT_S_PER_MILLION, LADDER_S_PER_MILLION, bakeBase, bakeCollision, gpuLimitsOf, isRough, outOfRoom, memCapGb, planRefine, sceneSize, stepTimeoutMs } from './bake';
import { bakeOffThread, lastBakeWhere, offThreadStoppable } from './bake-off-thread';
import type { BakeResult, GpuLimits, RefinePlan, SceneSize } from './bake';
import { WallCache, keepBuilt, keepThenUse, keptLine, loadBakeSpeed, saveBakeSpeed, wallsKey, wallsSha } from './wallcache';
import type { ImportReport, KeepResult, WallsKeyInput, WallsRow } from './wallcache';
import { ensureWalls } from './walls-first';
import { FREEZE_NOTE_S, PROGRESS_TICK_MS, ProgressClock, SpeechPacer, mayFreeze, progressLine, spokenLine, wallsSteps } from './course/progress';
import type { ProgressWhat } from './course/progress';

/** auto: the plan decides (a short refine starts by itself); offer: never by itself; off: test modes */
export type RefineMode = 'auto' | 'offer' | 'off';

export interface WallsHook {
    /** parked: a refine was due, but the walls are switched off */
    state: 'checking' | 'none' | 'offer' | 'parked' | 'baking' | 'queued' | 'in-use' | 'refused' | 'failed';
    source: 'shipped' | 'published' | 'bake' | 'cache' | 'import' | 'none';
    voxelM: number | null;
    readonly sha: string | null;
    plan: RefinePlan | null;
    size: SceneSize | null;
    key: string | null;
    keyInput: WallsKeyInput | null;
    cacheKind: 'idb' | 'memory' | null;
    cacheMiss: string | null;
    /** bakes run in this tab (a cache hit leaves it at 0) */
    bakes: number;
    lastBake: Record<string, unknown> | null;
    /** test: the store write of walls built here runs now */
    storing: boolean;
    /** test: what the last store write of walls built here did (key, ms, bytes, error) */
    lastStore: KeepResult | null;
    lastImport: ImportReport | null;
    /** resolves when the store was asked and the plan made */
    ready: Promise<void>;
    refine(): Promise<void>;
    /**
     * Walls for this scan in use, for any feature that needs them (the course, C, V, free flight by
     * sound): shipped or published at once, else the browser's store, else the build here with its
     * progress line in the walls box. `lead`: one line in the box above the progress that says what comes
     * after the walls ("First the walls of this scan, then the course."). Resolves true when the session has walls.
     */
    build(lead?: string, next?: string): Promise<boolean>;
    /** stage G1-progress: the build's progress line while it runs (course/progress.ts), else null */
    readonly progress: string | null;
    /**
     * The action that waited for a build that failed: it runs when walls come in later (the pilot pressed
     * the button again), so the lead line in the box stays true. One slot: the latest action wins.
     */
    whenIn(f: () => void): void;
    /** the walls box's line now (the build's progress or its result) */
    readonly line: string;
    exportZip(): Promise<Uint8Array>;
    importZip(bytes: Uint8Array): Promise<ImportReport>;
    /** the scene was switched (E.4): the box and the walls line go, the timers stop */
    dispose(): void;
    /** test: put these walls in now (the path a bake, the store and an import take) */
    install(json: Uint8Array, bin: Uint8Array): { ok: boolean; sha: string | null; error?: string };
    /** test: pretend the GPU has these limits (undefined: the real ones) */
    fakeLimits(l: GpuLimits | null | undefined): void;
    rows(): Promise<WallsRow[]>;
    clear(): Promise<void>;
    /** the walls were switched on or off (session.setWallsOn): prompts go or come back, the line says so */
    switched(on: boolean): void;
}

interface PhaseCHook {
    bake?: Record<string, unknown>;
    bakedBytes?: { json: Uint8Array; bin: Uint8Array };
    runBake?: () => Promise<void>;
    /** probes only: one bake at a given level and cell, nothing installed; the bytes go to bakedBytes */
    /** F1-no-freeze: `page` builds on the page's main thread (the old way), else in the worker */
    bakeTrial?: (o: { level: number; voxelM: number; page?: boolean }) => Promise<Record<string, unknown>>;
    downloadBaked?: () => boolean;
    walls?: WallsHook;
    info?: Record<string, unknown>;
}

export interface WallsOptions {
    ui: HTMLElement;
    session: FlightSession;
    sceneId: string;
    mode: RefineMode;
    /** ?bake=1: build walls for a scan without them at once */
    bakeNow: boolean;
    beacon: (e: string, p?: Record<string, string | number | boolean>) => void;
    hook: PhaseCHook;
    /** the walls switch and voxel controls (ui/voxels.ts), first in the walls menu */
    controls?: HTMLElement;
    /** the pilot asked for walls (the build button): the switch goes on, for every scan (app/walls.ts) */
    switchOn(): void;
    /** stage G1-progress: a line for Fly by Sound's speech (the spoken-line hook, app/say-via.ts); absent: nothing is spoken */
    speak?: (text: string, kind?: 'failed' | 'wait') => void;
}

/** the owner's rule: anything longer than 2 s shows what runs (a rule, not a measurement) */
const KEEP_NOTE_MS = 2000;
/**
 * Review FX-1: how long built walls wait for their store write before they go in use anyway. A design choice, not a
 * measurement: the measured writes of Wroclaw's 58 MB walls took 0.34 and 0.65 s (walls-store-probe, docs/wip/fix3a.md).
 */
const KEEP_WAIT_MS = 5000;
const cm = (m: number): string => String(Math.round(m * 1000) / 10);
const aboutS = (s: number): number => Math.max(5, Math.round(s / 5) * 5);
const aboutMin = (s: number): number => Math.max(1, Math.round(s / 60));

function saveFile(bytes: Uint8Array, name: string, type: string): void {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}

export function mountWalls(o: WallsOptions): WallsHook {
    const s = o.session;
    const device = s.renderer.app.graphicsDevice;
    const shipped = s.collision ? { voxelM: s.collision.voxelResolution, nodes: s.collision.nodes.length, sha: s.collisionSha256 ?? 'unknown' } : null;
    let fake: GpuLimits | null | undefined;
    const limits = (): GpuLimits | null => (fake !== undefined ? fake : gpuLimitsOf(device));
    const cacheP = WallCache.open();
    let busy = false;
    let pollTimer = 0;
    let hideTimer = 0;

    // ---- DOM: the phase C badge and button come at once (the acceptance clicks them right after ready)
    const badge = shipped ? null : h('div', { class: 'badge-nowalls', role: 'status', 'data-testid': 'no-collision' }, t('scenes.noCollisionBadge'));
    const action = h('button', { type: 'button', class: 'btn', hidden: true }) as HTMLButtonElement;
    const status = h('div', { class: 'bake-status', role: 'status', 'aria-live': 'polite', 'data-testid': 'bake-status' });
    const summary = h('summary', { 'data-testid': 'walls-summary' });
    const inUse = h('div', { 'data-testid': 'walls-in-use' });
    const storeInfo = h('div', { 'data-testid': 'walls-store' });
    const file = h('input', { type: 'file', accept: '.zip,application/zip', hidden: true, 'data-testid': 'walls-import-file' }) as HTMLInputElement;
    const more = h('details', { 'data-testid': 'walls-more' }, summary,
        // narrow: on a desktop the keyboard card sits right of the credit line, bottom middle
        h('div', { class: 'walls-menu', style: 'display: flex; flex-direction: column; align-items: flex-start; gap: 8px; margin: 4px 0 8px; max-width: min(250px, 70vw)' },
            o.controls ?? null,
            inUse,
            storeInfo,
            h('div', { style: 'display: flex; flex-wrap: wrap; gap: 8px' },
                h('button', { type: 'button', class: 'btn', 'data-action': 'walls-export', onclick: () => void exportToFile() }, t('bake.store.export')),
                h('button', { type: 'button', class: 'btn', 'data-action': 'walls-import', onclick: () => file.click() }, t('bake.store.import')),
                h('button', { type: 'button', class: 'btn', 'data-action': 'walls-clear', onclick: () => void clearStore() }, t('bake.store.clear'))),
            file));
    // top middle: only what needs the pilot (a build or refine button, progress, the result); empty
    // otherwise, so it covers nothing (on a phone the pad hint sits there)
    // CR-2: while a build runs, a bar that moves on the compositor (it keeps moving when the main thread is held by the
    // bake) and a note before the steps that may stop the picture
    const busyBar = h('div', { style: 'width: 40%; height: 100%; border-radius: 2px; background: #6cf' });
    const busyBox = h('div', { 'aria-hidden': 'true', 'data-testid': 'walls-busy', hidden: true, style: 'width: 180px; height: 4px; border-radius: 2px; overflow: hidden; background: rgba(255,255,255,.15)' }, busyBar);
    const note = h('div', { class: 'bake-status', 'data-testid': 'walls-note' });
    const box = h('div', { class: 'bake-box interactive', 'data-testid': 'walls-box' }, badge, action, status, busyBox, note);
    o.ui.append(box);
    // "Walls 5 cm" rides on the credit line (bottom left; under the pad hint on a phone): always
    // visible, small, and it opens the store (export for another PC, import, clear)
    const credit = o.ui.querySelector('[data-testid="attribution"]');
    (credit ?? box).append(more);

    const w: WallsHook = {
        state: 'checking',
        source: shipped ? (s.wallsFrom === 'published' ? 'published' : 'shipped') : 'none',
        voxelM: shipped?.voxelM ?? null,
        get sha() { return s.collisionSha256; },
        plan: null,
        size: null,
        key: null,
        keyInput: null,
        cacheKind: null,
        cacheMiss: null,
        bakes: 0,
        lastBake: null,
        storing: false,
        lastStore: null,
        lastImport: null,
        ready: Promise.resolve(),
        refine: () => (w.plan?.voxelM ? runRefine(w.plan.voxelM) : Promise.resolve()),
        build: (lead, next) => {
            if (lead && badge && !s.collision) badge.textContent = lead;
            if (next && !s.collision) after = next;
            return ensureAll();
        },
        get progress() { return prog ? progressLine(prog.view(), t) : null; },
        whenIn: (f) => { if (s.collision) f(); else afterIn = f; },
        get line() { return status.textContent ?? ''; },
        exportZip: async () => (await cacheP).exportZip(),
        importZip: (bytes) => importBytes(bytes),
        install: (json, bin) => {
            try {
                const sha = s.installCollision(json, bin);
                onSwap('import')(sha);
                return { ok: true, sha };
            } catch (e) {
                say(e instanceof BakeRefusedError && e.reason === 'empty' ? t('bake.empty') : t('bake.failed'));
                return { ok: false, sha: s.collisionSha256, error: e instanceof BakeRefusedError ? e.reason : String((e as Error)?.message ?? e) };
            }
        },
        fakeLimits: (l) => { fake = l; },
        dispose: () => {
            clearInterval(progTimer);
            clearInterval(pollTimer);
            clearTimeout(hideTimer);
            clearTimeout(keepTimer);
            box.remove();
            more.remove();
        },
        rows: async () => (await cacheP).rows(),
        clear: () => clearStore(),
        switched: (on) => {
            showSummary();
            if (!on) {
                // an offered refine goes away with the walls; one already running finishes
                if (w.state === 'offer' && action.dataset.action === 'refine' && w.plan) {
                    parked = w.plan;
                    w.state = 'parked';
                    action.hidden = true;
                }
                return;
            }
            const p = parked;
            parked = null;
            if (p && !busy) prompt(p);
        }
    };
    o.hook.walls = w;

    /** WallsHook.build without its lead line: shipped or published, the store, else one build here */
    const ensureAll = ensureWalls({
        has: () => !!s.collision,
        ready: () => w.ready,
        takeQueued: () => {
            // walls from the store wait for the craft to park: an action that needs them takes them now
            const q = queued;
            if (!q || !s.wallsPending) return false;
            clearInterval(pollTimer);
            s.installCollision(q.json, q.bin, q.sha);
            onSwap(q.source)(q.sha);
            return true;
        },
        build: () => startBase()
    });
    /** walls waiting in session.queueCollision for the craft to park (build() takes them at once) */
    let queued: { json: Uint8Array; bin: Uint8Array; sha: string; source: WallsHook['source'] } | null = null;
    /** the action left waiting by a failed build (whenIn); runs at the next walls swap */
    let afterIn: (() => void) | null = null;
    /** the base build now running (the button, ?bake=1, C and build() share it) */
    let running: Promise<void> | null = null;
    function startBase(): Promise<void> {
        if (!running) running = runBase().finally(() => { running = null; });
        return running;
    }
    /** The box stays in sight while it holds the build offer or its progress, in flight too (fly.css .bake-box.keep). */
    function keep(on: boolean): void {
        box.classList.toggle('keep', on);
    }

    function say(text: string, hideAfterMs = 0): void {
        status.textContent = text;
        clearTimeout(hideTimer);
        if (hideAfterMs > 0) hideTimer = window.setTimeout(() => { status.textContent = ''; }, hideAfterMs);
    }

    // ---- stage G1-progress: the build's line in the box every PROGRESS_TICK_MS (step, n of m, percent, time so far, what is
    // left), spoken to Fly by Sound at the pacer's pace; `after` says what comes once the walls are in (the course)
    let prog: ProgressClock | null = null;
    let progTimer = 0;
    let pacer = new SpeechPacer(() => performance.now());
    let after: string | null = null;
    function tickProgress(): void {
        if (!prog) return;
        const v = prog.view();
        say(progressLine(v, t));
        if (pacer.due(v)) o.speak?.(spokenLine(v, t));
    }
    function startProgress(what: ProgressWhat, gaussians: number, sPerMillion: number): void {
        clearInterval(progTimer);
        prog = new ProgressClock(what, wallsSteps(gaussians, sPerMillion), () => performance.now());
        pacer = new SpeechPacer(() => performance.now());
        progTimer = window.setInterval(tickProgress, PROGRESS_TICK_MS);
        busyBox.hidden = false;
        if (!busyAnim && typeof busyBar.animate === 'function') {
            busyAnim = busyBar.animate([{ transform: 'translateX(-100%)' }, { transform: 'translateX(250%)' }], { duration: 1400, iterations: Infinity, easing: 'ease-in-out' });
        }
        noteSaid = false;
        tickProgress();
    }
    let busyAnim: Animation | null = null;
    let noteSaid = false;
    function stopBusy(): void {
        busyBox.hidden = true;
        busyAnim?.cancel();
        busyAnim = null;
        note.textContent = '';
    }
    /** the build ended: the last line (with what comes next) stays in the box and is spoken */
    function endProgress(text: string, hideAfterMs = 0, ok = true): void {
        clearInterval(progTimer);
        prog = null;
        stopBusy();
        // a failed build keeps what comes next for the build that the button starts again
        const next = ok ? after : null;
        if (ok) after = null;
        const line = next ? `${text} ${next}` : text;
        say(line, hideAfterMs);
        // lane quiet2 (review QW-2): a failed build is told to the speaker, so with the narrator off it has a sound
        o.speak?.(line, ok ? undefined : 'failed');
    }
    function onStageOf(st: string): void {
        if (!prog) return;
        prog.enter(st);
        // F1-no-freeze: only a build on the page itself (a worker without WebGPU) may stop the picture
        const n = mayFreeze(st) && lastBakeWhere === 'page' ? t('progress.mayStop', { s: FREEZE_NOTE_S }) : '';
        note.textContent = n;
        // said once a build, before the first step that may stop the picture (Fly by Sound hears it before the silence)
        if (n && !noteSaid) {
            noteSaid = true;
            o.speak?.(n, 'wait'); // review QW-6: with the narrator off the "wait" sound comes before the picture may stop
        }
        tickProgress();
    }

    function showSummary(): void {
        // the arrow: the line opens the store; the page's CSS hides the default marker
        const off = !!s.collision && !s.wallsOn;
        summary.textContent = `${off ? t('walls.offSummary') : w.voxelM ? t('bake.walls', { cm: cm(w.voxelM) }) : t('bake.wallsNone')} ▾`;
        summary.classList.toggle('walls-off', off);
        inUse.textContent = w.voxelM && w.source !== 'none' ? t('bake.inUse', { cm: cm(w.voxelM), source: t(`bake.source.${w.source}`) }) : t('bake.inUseNone');
    }
    showSummary();

    async function showStore(): Promise<void> {
        const c = await cacheP;
        const rows = await c.rows().catch(() => [] as WallsRow[]);
        const mb = rows.reduce((a, r) => a + r.bytesStored, 0) / 1048576;
        storeInfo.textContent = c.kind === 'memory' ? t('bake.store.memory') : rows.length ? t('bake.store.info', { n: new Set(rows.map((r) => r.sceneId)).size, mb: mb.toFixed(1) }) : t('bake.store.empty');
    }
    more.addEventListener('toggle', () => { if (more.open) void showStore(); });

    /** The walls went in (now, or at the respawn that took them). */
    function onSwap(source: WallsHook['source'], was: number | null = w.voxelM) {
        return (sha: string): void => {
            w.state = 'in-use';
            w.source = source;
            w.voxelM = s.collision?.voxelResolution ?? w.voxelM;
            queued = null;
            badge?.remove();
            if (action.dataset.action === 'bake') action.hidden = true;
            keep(false);
            if (o.hook.info) { o.hook.info.hasCollision = true; o.hook.info.collisionSha256 = sha; }
            showSummary();
            // the action that waited for a failed build goes on now (after this swap has finished)
            const next = afterIn;
            afterIn = null;
            if (next) window.setTimeout(next, 0);
            if (source === 'bake' && was && shipped) say(t('bake.refine.swapped', { cm: cm(w.voxelM!), was: cm(was) }), 15000);
        };
    }

    function queue(json: Uint8Array, bin: Uint8Array, sha: string, source: WallsHook['source']): void {
        w.state = 'queued';
        queued = { json, bin, sha, source };
        s.queueCollision(json, bin, sha, onSwap(source));
        if (!s.wallsPending) return;
        // not parked (armed once since the last reset): the next respawn or restart takes them
        clearInterval(pollTimer);
        pollTimer = window.setInterval(() => {
            if (!s.wallsPending) { clearInterval(pollTimer); return; }
            s.swapWallsIfParked();
        }, 250);
    }

    /** the key input of walls built here: the one made before the build, else made now (the size request failed then) */
    async function keyInputNow(voxelM: number): Promise<WallsKeyInput | null> {
        if (w.keyInput) return w.keyInput;
        const size = w.size ?? await sceneSize(s.scene.contentUrl, s.scene.contentKind);
        w.size = size;
        const input: WallsKeyInput = { sceneId: o.sceneId, version: s.scene.version, etag: size.etag, base: shipped?.sha ?? 'none', voxelM };
        w.key = await wallsKey(input);
        w.keyInput = input;
        return input;
    }

    /**
     * Lane fix3a: the store write starts the moment the walls exist, before they go in use, so a reload
     * right after "built" finds them. The test modes (mode off) never made a key and keep nothing, as before.
     */
    let keepTimer = 0;
    function startKeep(r: BakeResult, sha: string, voxelM: number): Promise<KeepResult> {
        if (o.mode === 'off' && !w.keyInput) return Promise.resolve({ ok: false, key: null, ms: 0, bytes: 0, error: 'off' });
        w.storing = true;
        return keepBuilt({
            input: w.keyInput,
            makeInput: () => keyInputNow(voxelM),
            put: async (input) => {
                const c = await cacheP;
                const row = await c.put(input, r.json, r.bin, { gaussians: r.gaussians, bakeMs: r.ms.total, sha256: sha, binGz: r.binGz });
                return { ...row, memory: c.kind === 'memory' };
            },
            now: () => performance.now()
        }).then(async (res) => {
            w.storing = false;
            w.lastStore = res;
            // ask once for storage that the browser does not clear under pressure; refused is fine
            if (res.ok) await navigator.storage?.persist?.().catch(() => false);
            else console.warn('walls not stored', res.error);
            return res;
        });
    }
    /** the done line stays; a write past KEEP_NOTE_MS adds that the walls are being kept, a failed one that they are not */
    function showKeep(p: Promise<KeepResult>): void {
        const done = status.textContent ?? '';
        const keeping = `${done} ${t('bake.keeping')}`;
        clearTimeout(keepTimer);
        keepTimer = window.setTimeout(() => { if (w.storing && status.textContent === done) say(keeping); }, KEEP_NOTE_MS);
        void p.then((res) => {
            clearTimeout(keepTimer);
            // review FX-3: kept, another line keeps the box; not kept, the pilot hears it whatever the box shows
            const line = keptLine(status.textContent ?? '', done, keeping, res, t('bake.notKept'));
            if (line === null) return;
            say(line);
            if (!res.ok) o.speak?.(t('bake.notKept'));
        });
    }

    function refusedText(e: BakeRefusedError, refine: boolean): string {
        if (e.reason === 'empty') return t('bake.empty');
        if (e.reason === 'no-webgpu') return t('bake.noWebgpu');
        // the pilot never sees a Gaussian count or a limit: a finer refine is simply not built
        if (e.reason === 'gpu-buffer' || e.reason === 'memory') return refine ? t('bake.refine.refused') : t('bake.noRoom');
        return t(refine ? 'bake.refine.failed' : 'bake.failed', { was: cm(w.voxelM ?? BASE_VOXEL_M) });
    }

    // ---- phase C: walls for a scan without any. The flight is never held meanwhile (a running step
    // cannot be stopped, splat-transform has no abort): the pilot flies on without walls, and they go
    // in at once if the drone sits parked, else at its next start (queue); an action that waits for
    // them (course, sound flight) takes them at once (ensureWalls takeQueued).
    async function runBase(): Promise<void> {
        if (busy) return;
        busy = true;
        // the box holds only the lead line and the progress meanwhile (no dead button under them)
        action.disabled = true;
        action.hidden = true;
        w.state = 'baking';
        keep(true);
        try {
            // never a refusal: the ladder takes a lighter way by itself until one fits this device,
            // and skips a step that would run too long before it starts (planBase, STEP_MAX_S)
            // the line's estimate: this machine's own speed when it was slower than the trials (planBase's rule)
            const spm = Math.max(loadBakeSpeed() ?? 0, LADDER_S_PER_MILLION);
            startProgress('walls', w.size?.gaussians ?? 0, spm);
            const r = await bakeBase(s.scene.contentUrl, s.scene.contentKind, device, onStageOf, {
                size: w.size ?? undefined, limits: fake, sPerMillion: loadBakeSpeed(),
                // F1-no-freeze: in a worker (the page stays free), and a step past its limit gives way to the next, lighter one
                bake: bakeOffThread,
                stepTimeout: (step) => (offThreadStoppable() ? stepTimeoutMs(step, spm) : undefined),
                onStep: (step, i) => { prog?.replan(wallsSteps(step.gaussians, spm), i > 0 ? 'wallsLighter' : 'walls'); tickProgress(); }
            });
            w.bakes++;
            saveBakeSpeed(r.ms.total / 1000, r.gaussians);
            const sha = r.sha256 ?? await wallsSha(r.json, r.bin);
            const kept = startKeep(r, sha, BASE_VOXEL_M);
            // review FX-1: in use only once kept (0.3 to 0.65 s measured on Wroclaw), so "built" also means "kept"
            note.textContent = t('bake.keeping');
            await keepThenUse(kept, () => {
                // the pilot asked for walls on a scan without any: they fly with them, whatever the switch said
                o.switchOn();
                queue(r.json, r.bin, sha, 'bake');
            }, KEEP_WAIT_MS);
            o.hook.bake = { ok: true, kind: 'base', where: lastBakeWhere, voxelM: r.voxelM, level: r.level, tried: r.tried, rough: isRough(r), gaussians: r.gaussians, solidVoxels: r.solidVoxels, ms: r.ms, peakJsHeapMb: r.peakJsHeapMb, binBytes: r.bin.length, collisionSha256: sha };
            o.hook.bakedBytes = { json: r.json, bin: r.bin };
            w.lastBake = o.hook.bake;
            action.remove();
            // a large scan may have needed a lighter way: one plain line, no numbers of the technique
            // a course waiting for the walls takes them at once (ensureWalls takeQueued): its line says what comes, not the respawn
            endProgress(t(s.wallsPending && !after ? 'bake.doneNext' : isRough(r) ? 'bake.doneRough' : 'bake.done', { s: (r.ms.total / 1000).toFixed(0) }));
            o.beacon('bake_done');
            showKeep(kept);
        } catch (e) {
            w.state = 'failed';
            if (e instanceof BakeRefusedError) {
                o.hook.bake = { ok: false, refused: true, reason: e.reason, gaussians: e.size?.gaussians ?? 0, limit: e.maxGaussians };
                endProgress(refusedText(e, false), 0, false);
                // only a browser without WebGPU has no way on here; out of room and empty walls keep the button
                if (e.reason === 'no-webgpu') action.remove();
                else action.disabled = false;
            } else {
                o.hook.bake = { ok: false, error: String((e as Error)?.message ?? e), noRoom: outOfRoom(e) };
                // every lighter way ran out of room too: a plain line and the same button again
                // the library's own words stay in the hook and the console, the pilot gets the way on
                console.warn('walls build', e);
                endProgress(outOfRoom(e) ? t('bake.noRoom') : t('bake.failed'), 0, false);
                action.disabled = false;
            }
            // the button comes back (enabled) with the line that says to press it, and stays in sight
            if (action.isConnected) { action.hidden = false; action.disabled = false; }
            keep(action.isConnected);
            w.lastBake = o.hook.bake;
        } finally {
            busy = false;
        }
    }

    // ---- refine: finer walls beside the shipped ones; the flight goes on on the old walls meanwhile
    async function runRefine(voxelM: number): Promise<void> {
        if (busy || !shipped) return;
        busy = true;
        action.hidden = true;
        w.state = 'baking';
        const was = w.voxelM;
        try {
            // the refine's estimate is planRefine's: this machine's speed, else the first guess
            startProgress('refine', w.size?.gaussians ?? 0, loadBakeSpeed() ?? DEFAULT_S_PER_MILLION);
            const r = await bakeOffThread(s.scene.contentUrl, s.scene.contentKind, device, onStageOf, { voxelM, size: w.size ?? undefined, shipped, limits: fake });
            w.bakes++;
            saveBakeSpeed(r.ms.total / 1000, r.gaussians);
            const sha = r.sha256 ?? await wallsSha(r.json, r.bin);
            o.hook.bake = { ok: true, kind: 'refine', where: lastBakeWhere, voxelM, gaussians: r.gaussians, solidVoxels: r.solidVoxels, ms: r.ms, peakJsHeapMb: r.peakJsHeapMb, binBytes: r.bin.length, collisionSha256: sha };
            o.hook.bakedBytes = { json: r.json, bin: r.bin };
            w.lastBake = o.hook.bake;
            const kept = startKeep(r, sha, voxelM);
            // review FX-1: in use only once kept (or after KEEP_WAIT_MS), as in runBase
            note.textContent = t('bake.keeping');
            await keepThenUse(kept, () => queue(r.json, r.bin, sha, 'bake'), KEEP_WAIT_MS);
            if (s.wallsPending) endProgress(t('bake.refine.done', { cm: cm(voxelM), was: cm(was ?? shipped.voxelM), s: (r.ms.total / 1000).toFixed(0) }));
            else endProgress(t('bake.refine.swapped', { cm: cm(voxelM), was: cm(was ?? shipped.voxelM) }), 15000);
            o.beacon('refine_done', { cm: cm(voxelM) });
            showKeep(kept);
        } catch (e) {
            w.state = 'failed';
            o.hook.bake = e instanceof BakeRefusedError ? { ok: false, kind: 'refine', refused: true, reason: e.reason } : { ok: false, kind: 'refine', error: String((e as Error)?.message ?? e) };
            w.lastBake = o.hook.bake;
            endProgress(e instanceof BakeRefusedError ? refusedText(e, true) : t('bake.refine.failed', { was: cm(was ?? shipped.voxelM) }));
            // a failure that is not a refusal (a lost device, a network drop) may pass on a second try
            if (!(e instanceof BakeRefusedError) && w.plan?.voxelM) prompt({ ...w.plan, action: w.plan.action === 'offer-long' ? 'offer-long' : 'offer' });
        } finally {
            busy = false;
        }
    }

    /** A refine to start or offer, unless the walls are switched off: then it waits for them. */
    let parked: RefinePlan | null = null;
    function prompt(plan: RefinePlan): void {
        if (!s.wallsOn) {
            parked = plan;
            w.state = 'parked';
            return;
        }
        if (plan.action === 'auto') void runRefine(plan.voxelM!);
        else offer(plan);
    }

    function offer(plan: RefinePlan): void {
        const v = plan.voxelM!;
        w.state = 'offer';
        action.dataset.action = 'refine';
        action.hidden = false;
        action.disabled = false;
        if (plan.action === 'offer-long') {
            // minutes of full GPU and CPU: a second click, after the cost is spelled out
            let armed = false;
            action.textContent = t('bake.refine.long', { cm: cm(v), min: aboutMin(plan.estimateS) });
            action.onclick = () => {
                if (!armed) { armed = true; action.textContent = t('bake.refine.confirm', { min: aboutMin(plan.estimateS) }); return; }
                void runRefine(v);
            };
        } else {
            action.textContent = t('bake.refine.button', { cm: cm(v), s: aboutS(plan.estimateS) });
            action.onclick = () => void runRefine(v);
        }
    }

    // ---- the store
    async function exportToFile(): Promise<void> {
        const c = await cacheP;
        if (!(await c.rows()).length) { storeInfo.textContent = t('bake.store.empty'); return; }
        saveFile(await c.exportZip(), `gsfpv-walls-${new Date().toISOString().slice(0, 10)}.zip`, 'application/zip');
    }

    async function importBytes(bytes: Uint8Array): Promise<ImportReport> {
        const c = await cacheP;
        let rep: ImportReport;
        try {
            rep = await c.importZip(bytes);
        } catch (e) {
            storeInfo.textContent = t('bake.store.importFailed');
            throw e;
        }
        w.lastImport = rep;
        const why = [...new Set(rep.rejected.map((r) => t(`bake.reason.${r.reason}`)))].join(', ') || '—';
        storeInfo.textContent = t('bake.store.imported', { n: rep.imported.length, bad: rep.rejected.length, why });
        // the walls for this very scene came with it: use them (queued like any new walls)
        if (w.key && rep.imported.some((r) => r.key === w.key) && !busy) {
            const hit = await c.get(w.key);
            if (hit) { action.hidden = true; queue(hit.json, hit.bin, hit.row.sha256, 'import'); say(t('bake.cached', { cm: cm(hit.row.voxelM) }), 10000); }
        }
        return rep;
    }
    file.addEventListener('change', () => {
        const f = file.files?.[0];
        file.value = '';
        if (f) void f.arrayBuffer().then((b) => importBytes(new Uint8Array(b))).catch(() => { /* reported above */ });
    });

    async function clearStore(): Promise<void> {
        await (await cacheP).clear();
        storeInfo.textContent = t('bake.store.cleared');
    }

    // probes compare ways of building (walls stage W1): the device's real limit, not the estimate
    o.hook.bakeTrial = async ({ level, voxelM, page }) => {
        try {
            const r = await (page ? bakeCollision : bakeOffThread)(s.scene.contentUrl, s.scene.contentKind, device, () => {}, { level, voxelM, coarsenOnOctree: true, size: w.size ?? undefined, capGb: Number.POSITIVE_INFINITY, limits: null });
            o.hook.bakedBytes = { json: r.json, bin: r.bin };
            return { ok: true, where: page ? 'page' : lastBakeWhere, level: r.level, voxelM: r.voxelM, gaussians: r.gaussians, solidVoxels: r.solidVoxels, ms: r.ms, peakJsHeapMb: r.peakJsHeapMb, binBytes: r.bin.length };
        } catch (e) {
            return { ok: false, level, voxelM, error: String((e as Error)?.message ?? e).slice(0, 200), noRoom: outOfRoom(e) };
        }
    };

    // ---- phase C button, shown at once
    if (!shipped) {
        action.dataset.action = 'bake';
        action.textContent = t('bake.button');
        action.hidden = false;
        action.onclick = () => void startBase();
        o.hook.runBake = startBase;
        // the offer itself does not hang over the flight (the keys build by themselves): the box keeps in
        // sight in flight only while a build runs or after one failed (runBase)
        o.hook.downloadBaked = () => {
            const b = o.hook.bakedBytes;
            if (!b) return false;
            saveFile(b.json, `${o.sceneId}-baked.voxel.json`, 'application/octet-stream');
            saveFile(b.bin, `${o.sceneId}-baked.voxel.bin`, 'application/octet-stream');
            return true;
        };
    }

    // ---- what walls this scene should fly on, and are they in the store already
    async function decide(): Promise<void> {
        const c = await cacheP;
        w.cacheKind = c.kind;
        // `ready` means "decided": a bake started here runs on after it
        if (o.mode === 'off') { w.state = shipped ? 'none' : 'offer'; if (!shipped && o.bakeNow) void startBase(); return; }
        try {
            w.size = await sceneSize(s.scene.contentUrl, s.scene.contentKind);
        } catch {
            w.state = shipped ? 'none' : 'offer';
            if (!shipped && o.bakeNow) void startBase();
            return; // offline: the button still bakes, it reads the size itself
        }
        let voxelM: number | null = BASE_VOXEL_M;
        if (shipped) {
            const measured = loadBakeSpeed();
            w.plan = planRefine({ shipped, size: w.size, limits: limits(), capGb: memCapGb(), webgpu: s.renderer.isWebGPU, sPerMillion: measured ?? DEFAULT_S_PER_MILLION, visibleMs: s.timings.visibleMs });
            // the first bake on a machine is its calibration: started by the pilot, never by itself
            if (w.plan.action === 'auto' && (o.mode === 'offer' || measured === null)) w.plan = { ...w.plan, action: 'offer' };
            voxelM = w.plan.voxelM;
        }
        if (voxelM === null) { w.state = 'none'; return; }
        w.keyInput = { sceneId: o.sceneId, version: s.scene.version, etag: w.size.etag, base: shipped?.sha ?? 'none', voxelM };
        w.key = await wallsKey(w.keyInput);
        const hit = await c.get(w.key).catch(() => null);
        w.cacheMiss = hit ? null : c.lastMiss;
        if (hit && !busy) {
            action.hidden = true;
            queue(hit.json, hit.bin, hit.row.sha256, 'cache');
            say(t('bake.cached', { cm: cm(hit.row.voxelM) }), 10000);
            return;
        }
        void c.markStale(w.keyInput, w.key).catch(() => 0);
        if (!shipped) { w.state = 'offer'; if (o.bakeNow) void startBase(); return; }
        const plan = w.plan!;
        if (plan.action === 'auto' || plan.action === 'offer' || plan.action === 'offer-long') prompt(plan);
        else w.state = plan.action === 'refused' ? 'refused' : 'none';
    }
    w.ready = decide().catch((e) => { w.state = 'failed'; console.warn('walls', e); });
    return w;
}
