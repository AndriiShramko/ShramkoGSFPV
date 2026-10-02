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
import { BASE_VOXEL_M, BakeRefusedError, DEFAULT_S_PER_MILLION, bakeCollision, gpuLimitsOf, maxGaussians, memCapGb, planRefine, sceneSize } from './bake';
import type { BakeResult, GpuLimits, RefinePlan, SceneSize } from './bake';
import { WallCache, loadBakeSpeed, saveBakeSpeed, wallsKey, wallsSha } from './wallcache';
import type { ImportReport, WallsKeyInput, WallsRow } from './wallcache';

/** auto: the plan decides (a short refine starts by itself); offer: never by itself; off: test modes */
export type RefineMode = 'auto' | 'offer' | 'off';

export interface WallsHook {
    /** parked: a refine was due, but the walls are switched off */
    state: 'checking' | 'none' | 'offer' | 'parked' | 'baking' | 'queued' | 'in-use' | 'refused' | 'failed';
    source: 'shipped' | 'bake' | 'cache' | 'import' | 'none';
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
    lastImport: ImportReport | null;
    /** resolves when the store was asked and the plan made */
    ready: Promise<void>;
    refine(): Promise<void>;
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
}

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
    const box = h('div', { class: 'bake-box interactive', 'data-testid': 'walls-box' }, badge, action, status);
    o.ui.append(box);
    // "Walls 5 cm" rides on the credit line (bottom left; under the pad hint on a phone): always
    // visible, small, and it opens the store (export for another PC, import, clear)
    const credit = o.ui.querySelector('[data-testid="attribution"]');
    (credit ?? box).append(more);

    const w: WallsHook = {
        state: 'checking',
        source: shipped ? 'shipped' : 'none',
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
        lastImport: null,
        ready: Promise.resolve(),
        refine: () => (w.plan?.voxelM ? runRefine(w.plan.voxelM) : Promise.resolve()),
        exportZip: async () => (await cacheP).exportZip(),
        importZip: (bytes) => importBytes(bytes),
        install: (json, bin) => {
            try {
                const sha = s.installCollision(json, bin);
                onSwap('import')(sha);
                return { ok: true, sha };
            } catch (e) {
                say(e instanceof BakeRefusedError && e.reason === 'empty' ? t('bake.empty') : t('bake.failed', { msg: String((e as Error)?.message ?? e).slice(0, 160) }));
                return { ok: false, sha: s.collisionSha256, error: e instanceof BakeRefusedError ? e.reason : String((e as Error)?.message ?? e) };
            }
        },
        fakeLimits: (l) => { fake = l; },
        dispose: () => {
            clearInterval(pollTimer);
            clearTimeout(hideTimer);
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

    function say(text: string, hideAfterMs = 0): void {
        status.textContent = text;
        clearTimeout(hideTimer);
        if (hideAfterMs > 0) hideTimer = window.setTimeout(() => { status.textContent = ''; }, hideAfterMs);
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
            badge?.remove();
            if (action.dataset.action === 'bake') action.hidden = true;
            if (o.hook.info) { o.hook.info.hasCollision = true; o.hook.info.collisionSha256 = sha; }
            showSummary();
            if (source === 'bake' && was && shipped) say(t('bake.refine.swapped', { cm: cm(w.voxelM!), was: cm(was) }), 15000);
        };
    }

    function queue(json: Uint8Array, bin: Uint8Array, sha: string, source: WallsHook['source']): void {
        w.state = 'queued';
        s.queueCollision(json, bin, sha, onSwap(source));
        if (!s.wallsPending) return;
        // not parked (armed once since the last reset): the next respawn or restart takes them
        clearInterval(pollTimer);
        pollTimer = window.setInterval(() => {
            if (!s.wallsPending) { clearInterval(pollTimer); return; }
            s.swapWallsIfParked();
        }, 250);
    }

    async function remember(input: WallsKeyInput | null, r: BakeResult, sha: string): Promise<void> {
        if (!input) return;
        try {
            const c = await cacheP;
            await c.put(input, r.json, r.bin, { gaussians: r.gaussians, bakeMs: r.ms.total, sha256: sha });
            // ask once for storage that the browser does not clear under pressure; refused is fine
            await navigator.storage?.persist?.().catch(() => false);
        } catch (e) {
            console.warn('walls not stored', e);
        }
    }

    function refusedText(e: BakeRefusedError, refine: boolean): string {
        if (e.reason === 'empty') return t('bake.empty');
        if (e.reason === 'no-webgpu') return t('bake.noWebgpu');
        const n = ((e.size?.gaussians ?? 0) / 1e6).toFixed(1);
        const max = ((e.maxGaussians || maxGaussians(limits(), memCapGb())) / 1e6).toFixed(1);
        if (e.reason === 'gpu-buffer' || e.reason === 'memory') return refine ? t('bake.refine.refused', { n, max }) : t('bake.refused', { n, max });
        return t(refine ? 'bake.refine.failed' : 'bake.failed', { msg: e.message.slice(0, 160), was: cm(w.voxelM ?? BASE_VOXEL_M) });
    }

    // ---- phase C: walls for a scan without any (the flight holds still meanwhile, as before)
    async function runBase(): Promise<void> {
        if (busy) return;
        busy = true;
        action.disabled = true;
        w.state = 'baking';
        s.pause(true, 'bake');
        try {
            const r = await bakeCollision(s.scene.contentUrl, s.scene.contentKind, device, (st) => say(t('bake.working', { stage: t(`bake.stage.${st}`) })), { voxelM: BASE_VOXEL_M, size: w.size ?? undefined, limits: fake, coarsenOnOctree: true });
            w.bakes++;
            saveBakeSpeed(r.ms.total / 1000, r.gaussians);
            const sha = await wallsSha(r.json, r.bin);
            // the pilot asked for walls on a scan without any: they fly with them, whatever the switch said
            o.switchOn();
            s.installCollision(r.json, r.bin, sha);
            onSwap('bake')(sha);
            o.hook.bake = { ok: true, kind: 'base', voxelM: r.voxelM, gaussians: r.gaussians, solidVoxels: r.solidVoxels, ms: r.ms, peakJsHeapMb: r.peakJsHeapMb, binBytes: r.bin.length, collisionSha256: sha };
            o.hook.bakedBytes = { json: r.json, bin: r.bin };
            w.lastBake = o.hook.bake;
            action.remove();
            // a very large scan may have needed a coarser grid than 5 cm: say which
            say(r.voxelM > BASE_VOXEL_M + 1e-6
                ? t('bake.doneCoarse', { voxels: (r.solidVoxels / 1e6).toFixed(1), s: (r.ms.total / 1000).toFixed(0), cm: cm(r.voxelM) })
                : t('bake.done', { voxels: (r.solidVoxels / 1e6).toFixed(1), s: (r.ms.total / 1000).toFixed(0) }));
            o.beacon('bake_done');
            void remember(w.keyInput, r, sha);
        } catch (e) {
            w.state = 'failed';
            if (e instanceof BakeRefusedError) {
                o.hook.bake = { ok: false, refused: true, reason: e.reason, gaussians: e.size?.gaussians ?? 0, limit: e.maxGaussians };
                say(refusedText(e, false));
                if (e.reason !== 'empty') action.remove();
                else action.disabled = false;
            } else {
                o.hook.bake = { ok: false, error: String((e as Error)?.message ?? e) };
                say(t('bake.failed', { msg: String((e as Error)?.message ?? e).slice(0, 160) }));
                action.disabled = false;
            }
            w.lastBake = o.hook.bake;
        } finally {
            s.pause(false, 'bake');
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
            const r = await bakeCollision(s.scene.contentUrl, s.scene.contentKind, device, (st) => say(t('bake.refine.working', { cm: cm(voxelM), stage: t(`bake.stage.${st}`) })), { voxelM, size: w.size ?? undefined, shipped, limits: fake });
            w.bakes++;
            saveBakeSpeed(r.ms.total / 1000, r.gaussians);
            const sha = await wallsSha(r.json, r.bin);
            o.hook.bake = { ok: true, kind: 'refine', voxelM, gaussians: r.gaussians, solidVoxels: r.solidVoxels, ms: r.ms, peakJsHeapMb: r.peakJsHeapMb, binBytes: r.bin.length, collisionSha256: sha };
            o.hook.bakedBytes = { json: r.json, bin: r.bin };
            w.lastBake = o.hook.bake;
            void remember(w.keyInput, r, sha);
            queue(r.json, r.bin, sha, 'bake');
            if (s.wallsPending) say(t('bake.refine.done', { cm: cm(voxelM), was: cm(was ?? shipped.voxelM), s: (r.ms.total / 1000).toFixed(0) }));
            else say(t('bake.refine.swapped', { cm: cm(voxelM), was: cm(was ?? shipped.voxelM) }), 15000);
            o.beacon('refine_done', { cm: cm(voxelM) });
        } catch (e) {
            w.state = 'failed';
            o.hook.bake = e instanceof BakeRefusedError ? { ok: false, kind: 'refine', refused: true, reason: e.reason } : { ok: false, kind: 'refine', error: String((e as Error)?.message ?? e) };
            w.lastBake = o.hook.bake;
            say(e instanceof BakeRefusedError ? refusedText(e, true) : t('bake.refine.failed', { msg: String((e as Error)?.message ?? e).slice(0, 160), was: cm(was ?? shipped.voxelM) }));
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
            storeInfo.textContent = t('bake.store.importFailed', { msg: String((e as Error)?.message ?? e).slice(0, 160) });
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

    // ---- phase C button, shown at once
    if (!shipped) {
        action.dataset.action = 'bake';
        action.textContent = t('bake.button');
        action.hidden = false;
        action.onclick = () => void runBase();
        o.hook.runBake = runBase;
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
        if (o.mode === 'off') { w.state = shipped ? 'none' : 'offer'; if (!shipped && o.bakeNow) void runBase(); return; }
        try {
            w.size = await sceneSize(s.scene.contentUrl, s.scene.contentKind);
        } catch {
            w.state = shipped ? 'none' : 'offer';
            if (!shipped && o.bakeNow) void runBase();
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
        if (!shipped) { w.state = 'offer'; if (o.bakeNow) void runBase(); return; }
        const plan = w.plan!;
        if (plan.action === 'auto' || plan.action === 'offer' || plan.action === 'offer-long') prompt(plan);
        else w.state = plan.action === 'refused' ? 'refused' : 'none';
    }
    w.ready = decide().catch((e) => { w.state = 'failed'; console.warn('walls', e); });
    return w;
}
