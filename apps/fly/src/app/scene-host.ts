// In-page scene switching (docs/architecture-v03.md E.4, E.5; the owner's items 10 and 5): the next
// scene loads in the same page, so the radio, the gamepad and the keyboard stay connected (no
// Controls screen again) and every setting stays as it is. The page keeps one renderer; a switch:
//   1. holds the flight paused (reason 'scene') and shows a small loading card with the progress;
//   2. disposes the old session (its splats unloaded, walls, flight model and replay dropped);
//   3. starts the new one on the same renderer, paused, with the drone, physics, respawn rules and
//      crash rule of the old one, its first life a C.4 'scene' start: on the platform, armed when
//      the switch is still on and respawn.keepArmed keeps it;
//   4. hands it to the page (Flight.swapSession: every feature follows the 'session' event),
//      keeps ?scene= current with history.replaceState, records the open in the library, resumes.
// A scene picked from a SuperSplat link keeps the drawing the link asked for (?budget=, ?stochastic;
// v0.7 lane R, app/drawing.ts): the new session loads with it and the deep link carries it.
// A scene that fails to load is noted (the rotation skips it for a day) and the scene left comes
// back. Which scene N and the scene after a crash load comes from the tour (@gsfpv/scenes tour.ts, wired in
// app/tour.ts): the owner's catalogue in his order, then SuperSplat, no scene twice until all were seen;
// from the pilot's own sources (settings: favourites, history) and for Shift+N and F, from the rotation
// (@gsfpv/scenes rotation.ts).
// The pause menu's "Change scan" opens the scene picker over the flight (openPicker): a scene picked
// there loads the same way, so changing the scan by hand keeps the radio too (item 5).
import { SUPERSPLAT_READ_MS, SceneError, SceneRotation, flyQueryString, getLibrary, legacyLibraryStore, mergeLibraries, orderFor, parseSceneLink, recordFailure, recordOpen, sameRender, useLibraryStore, writeSceneQuery } from '@gsfpv/scenes';
import type { CatalogCollection, RotationRules, RotationSource, RotationOrder, SceneLibraryData, SceneRender, SceneTour, TourFrom } from '@gsfpv/scenes';
import type { PrefsStore } from '@gsfpv/prefs';
import { FlightSession, FlyNow } from '../session';
import type { SessionOptions } from '../session';
import { LoadingScreen } from '../ui/loading';
import { ScenePicker } from '../ui/scenes';
import type { ShowcaseScene } from '../ui/scenes';
import { h } from '../ui/dom';
import { wallsWanted } from '../flightwalls';
import { storedTransform } from './builtin/scale';
import { storedDropFloaters } from './builtin/floaters';
import { storedCeiling } from '../session/ceiling-source';
import { windFor } from '../session/wind-source';
import { t } from '../i18n';
import { beacon, q } from './env';
import { hook } from './test-hook';
import type { FlightContext, SceneRef, SceneSwitchReason, SceneSwitcher } from './context';
import { drawingFor } from './drawing';
import { noteNextUsed } from './next-used';
import { pageTour } from './tour';

/** A SuperSplat read that has taken this long says "looking for the next scene" (an answer in the blink of an eye says nothing). */
const LOOKING_AFTER_MS = 600;
/** How long that note stays: the read is over by SUPERSPLAT_READ_MS at the latest. */
const LOOKING_FLASH_MS = SUPERSPLAT_READ_MS - LOOKING_AFTER_MS + 400;

/** What the shell gives the host: the page's context with the swap, the canvas, the curated list. */
export interface SceneHostDeps {
    ctx: FlightContext & { swapSession(next: FlightSession, scene: SceneRef): void };
    canvas: HTMLCanvasElement;
    showcase: readonly ShowcaseScene[];
    /** the catalogue's collections (the picker's chips) */
    collections?: readonly CatalogCollection[];
    /** how this page flies whatever scene (the URL's test switches): the same for every scene */
    base: Pick<SessionOptions, 'drawScan' | 'latencyMarker' | 'lagFrames' | 'renderScale'>;
}

/** The switches so far, for the acceptance (window.__gsfpv.scenes). */
export interface SwitchRecord { from: string; to: string; reason: SceneSwitchReason; ok: boolean; ms: number; code?: string }

export class SceneHost implements SceneSwitcher {
    private readonly d: SceneHostDeps;
    readonly rotation: SceneRotation;
    /** N and the scene after a crash from the owner's catalogue: his scenes, then SuperSplat (app/tour.ts) */
    readonly tour: SceneTour;
    private busyNow = false;
    /** go() is deciding which scene (SuperSplat may have to be asked): no second decision meanwhile */
    private picking = false;
    /** the "looking for the next scene" note is due when this fires (searching) */
    private lookingTimer: ReturnType<typeof setTimeout> | undefined;
    readonly log: SwitchRecord[] = [];
    private picker: ScenePicker | null = null;

    constructor(d: SceneHostDeps) {
        this.d = d;
        this.rotation = new SceneRotation({ curated: () => d.showcase.map((s) => ({ id: s.id, collision: s.collision })), library: getLibrary });
        this.tour = pageTour(d.showcase, d.ctx.prefs, { onSearch: () => this.searching() });
        // the scene the page opened with is seen: N does not bring it back this round
        this.tour.noteFlown(d.ctx.scene.id);
    }

    /**
     * The tour is asking SuperSplat for a page (the owner's scenes are used up). The wait is bounded
     * (SUPERSPLAT_READ_MS) but N is ignored while it lasts, so a slow answer says what is going on.
     */
    private searching(): void {
        if (this.lookingTimer !== undefined) return;
        this.lookingTimer = setTimeout(() => this.d.ctx.hud.flash(t('rotation.looking'), LOOKING_FLASH_MS), LOOKING_AFTER_MS);
    }

    get busy(): boolean {
        return this.busyNow || this.picking;
    }

    private rules(): RotationRules {
        return { allowNoWalls: this.d.ctx.prefs.get<boolean>('scenes.allowNoWalls') === true };
    }

    /**
     * The scene N (or a crash with scenes.autoSwitch), Shift+N or F would load now, and where it came from
     * (`again`: every scene was seen, a new round began); id null: none. N and the crash go through the tour
     * when the source is the author's list (the default), through the rotation for the pilot's own sources.
     */
    async pick(kind: 'next' | 'random' | 'favourite' | 'auto'): Promise<{ id: string | null; from?: TourFrom }> {
        const prefs = this.d.ctx.prefs;
        const cur = this.d.ctx.scene.id;
        if (kind === 'random') return { id: this.rotation.random(cur, this.rules()) };
        if (kind === 'favourite') return { id: this.rotation.nextFavourite(cur, this.rules()) };
        const src = prefs.get<string>('scenes.rotation');
        if (src === 'favourites' || src === 'history') {
            const source: RotationSource = src;
            return { id: this.rotation.next(source, cur, orderFor(source, this.chosenOrder()), this.rules()) };
        }
        const step = await this.tour.next(cur, orderFor('curated', this.chosenOrder()));
        return step ? { id: step.id, from: step.from } : { id: null };
    }

    /** scenes.order when the pilot set it (stored, even equal to the default, or by the URL); null: never touched. */
    private chosenOrder(): RotationOrder | null {
        const prefs = this.d.ctx.prefs;
        const v = prefs.get<string>('scenes.order');
        const set = prefs.isExplicit('scenes.order') || v !== prefs.defaultOf<string>('scenes.order');
        return set ? (v === 'random' ? 'random' : 'sequential') : null;
    }

    /**
     * The scene picker over the flight (paused, reason 'scene'): every tab, the link field, the
     * Continue card. A pick loads in the page; x or Esc closes it and the flight goes on.
     */
    openPicker(): void {
        const { ctx, showcase } = this.d;
        if (this.picker || this.busyNow) return;
        ctx.pause('scene');
        if (ctx.menu.isOpen) ctx.menu.close();
        const picker = new ScenePicker(ctx.ui, [...showcase], [...(this.d.collections ?? [])]);
        this.picker = picker;
        picker.root.classList.add('in-flight');
        picker.root.dataset.testid = 'scenes-in-flight';
        // the flight's keys wait while it is up (its field takes letters); Esc closes it
        const offKeys = ctx.keys.block(() => true);
        const onKey = (e: KeyboardEvent): void => {
            // a share panel over the picker (a card's Share) closes itself on Esc; the picker stays
            if (e.key !== 'Escape' || document.querySelector('.panel.share')) return;
            e.preventDefault();
            e.stopPropagation();
            close(true);
        };
        const close = (resume: boolean): void => {
            picker.remove();
            this.picker = null;
            offKeys();
            removeEventListener('keydown', onKey, true);
            if (resume) ctx.resume('scene');
        };
        addEventListener('keydown', onKey, true);
        picker.root.prepend(h('button', { type: 'button', class: 'panel-x', 'data-action': 'scenes-close', 'aria-label': t('common.close'), 'aria-keyshortcuts': 'Escape', title: `${t('common.close')} (Esc)`, onclick: () => close(true) }, '×'));
        picker.onPick = (raw, source) => {
            const link = parseSceneLink(raw);
            if (!link) { picker.showError('invalid-link'); return; }
            // the same scene with the same drawing: back to it as it was (a link asking another
            // drawing for it loads it again with that drawing)
            if (link.id === ctx.scene.id && sameRender(link.render, ctx.scene.render)) { close(true); return; }
            close(false); // the 'scene' pause stays: load() holds it and releases it when the new scene flies
            beacon('scene_open', { source });
            void this.load(link.id, 'pick', link.render);
        };
    }

    async go(kind: 'next' | 'random' | 'favourite' | 'auto'): Promise<boolean> {
        if (this.busy) return false;
        // N and Shift+N, whatever pressed them (key, radio switch, panel button, the crash hint): the pilot knows N now
        if (kind === 'next' || kind === 'random') noteNextUsed();
        this.picking = true;
        let chosen: { id: string | null; from?: TourFrom };
        try {
            chosen = await this.pick(kind);
        } finally {
            this.picking = false;
            clearTimeout(this.lookingTimer);
            this.lookingTimer = undefined;
        }
        if (!chosen.id) {
            this.d.ctx.hud.flash(t(kind === 'favourite' ? 'rotation.noFavourite' : 'rotation.none'), 3500);
            return false;
        }
        // every scene was seen, or SuperSplat did not answer: the owner's scenes come round again
        if (chosen.from === 'again') this.d.ctx.hud.flash(t('rotation.again'), 4500);
        return this.load(chosen.id, kind);
    }

    /**
     * Load `id` in place of the scene flown. `render`: the drawing a pasted link asked for (SuperSplat's
     * ?budget= and ?stochastic); the rotation and the cards pass none, so the catalogue's render applies.
     */
    async load(id: string, reason: SceneSwitchReason, render?: SceneRender): Promise<boolean> {
        const { ctx, canvas, showcase, base } = this.d;
        if (this.busyNow || (id === ctx.scene.id && reason !== 'back' && sameRender(render, ctx.scene.render))) return false;
        this.busyNow = true;
        const t0 = performance.now();
        const from = ctx.scene.id;
        const fromRender = ctx.scene.render;
        hook.sceneSwitch = { state: 'loading', from, to: id, reason };
        ctx.pause('scene');
        if (ctx.menu.isOpen) ctx.menu.close();
        ctx.clearCrash();
        const old = ctx.session;
        const meta = showcase.find((s) => s.id === id);
        const ref: SceneRef = render ? { id, meta, render } : { id, meta };
        // the card's Fly now shows the first view at once (session/reveal.ts)
        const flyNow = new FlyNow();
        const loading = new LoadingScreen(ctx.ui, {
            sceneId: id,
            title: meta?.title,
            next: null,
            compact: true,
            onRetry: () => location.reload(),
            onBack: () => { location.search = ''; },
            onFlyNow: () => flyNow.press()
        });
        // the channels the craft flies with now: the new scene's first life starts with them (C.4 'scene')
        const ch = old.sim ? Array.from(old.sim.ch) : null;
        const opts: SessionOptions = {
            ...base,
            sceneId: id,
            renderer: old.renderer,
            paused: true,
            preset: old.presetId,
            overrides: old.overrides,
            policy: old.policy,
            crashOn: old.crashOn,
            sceneStart: ch ? { ch } : undefined,
            wallsOn: wallsWanted(ctx.prefs, id),
            transform: storedTransform(ctx.prefs, id),
            dropFloaters: storedDropFloaters(ctx.prefs, id),
            drawing: (webgpu, gpu) => drawingFor(ctx.prefs, ref, webgpu, gpu),
            ceilingM: storedCeiling(ctx.prefs, id),
            wind: windFor(ctx.prefs, id, meta),
            // the gusts go on with the same seed in the next scene
            windSeed: old.windSeed,
            flyNow,
            onProgress: (p) => {
                loading.update(p);
                hook.loading = { stage: p.stage, loaded: p.loaded, total: p.total, fraction: p.fraction, exact: p.exact, elapsedMs: Math.round(performance.now() - t0), view: p.view, reveal: p.reveal, canFlyNow: p.canFlyNow, revealInMs: p.revealInMs };
            }
        };
        old.dispose();
        let next: FlightSession;
        try {
            next = await FlightSession.start(canvas, opts);
            await next.visible;
        } catch (e) {
            loading.remove();
            const code = e instanceof SceneError ? e.code : 'generic';
            recordFailure(id, code);
            this.log.push({ from, to: id, reason, ok: false, ms: Math.round(performance.now() - t0), code });
            hook.sceneSwitch = { state: 'failed', from, to: id, reason, code };
            this.busyNow = false;
            console.warn(`scene ${id} did not load`, e);
            // the scene left loaded a moment ago: back to it; when even that fails, the picker
            if (reason !== 'back' && from !== id) {
                await this.load(from, 'back', fromRender);
                ctx.hud.flash(t('rotation.failed', { id }), 5000);
                return false;
            }
            location.search = '';
            return false;
        }
        if (base.drawScan !== false) next.renderer.startLatencyGuard(q.get('guard') !== '0');
        if (q.get('inflight') !== null) next.renderer.maxFramesInFlight = Number(q.get('inflight'));
        await loading.finish();
        ctx.swapSession(next, ref);
        this.tour.noteFlown(id);
        // the deep link follows the scene: its own budget and flag, none left from the scene before
        const u = new URL(location.href);
        writeSceneQuery(u.searchParams, id, render);
        u.search = flyQueryString(u.searchParams);
        history.replaceState(history.state, '', u);
        recordOpen(id, !!next.collision, meta?.title, next.scene.version);
        if (hook.info) Object.assign(hook.info, { hasCollision: !!next.collision, collisionSha256: next.collisionSha256, walls: next.walls, timings: next.timings, spawn: next.spawn });
        const ms = Math.round(performance.now() - t0);
        this.log.push({ from, to: id, reason, ok: true, ms });
        hook.sceneSwitch = { state: 'done', from, to: id, reason, ms };
        beacon('scene_switch', { reason, has_collision: !!next.collision, load_ms_bucket: Math.round(ms / 1000) });
        this.busyNow = false;
        ctx.resume('scene');
        return true;
    }
}

/** The v0.2 keys were merged into the store's library once (set after the merge). */
const MERGED_KEY = 'gsfpv.library.merged.v1';

/**
 * The scene library lives in the page's preferences store from now on (E.1: the collection
 * `sceneLibrary`, exported and imported with the settings). The first v0.3 boot moved v0.2's keys
 * into it; scenes opened since then went to the old keys, so they are merged in once more
 * (mergeLibraries: nothing is counted twice), then the store is the only place.
 */
export function useStoreLibrary(prefs: PrefsStore): void {
    let merged = false;
    try { merged = localStorage.getItem(MERGED_KEY) === '1'; } catch { merged = true; }
    const read = (): SceneLibraryData => prefs.collection('sceneLibrary') as SceneLibraryData;
    const write = (d: SceneLibraryData): void => prefs.updateCollection('sceneLibrary', (draft) => {
        draft.history = d.history;
        draft.favourites = d.favourites;
        draft.filter = d.filter;
        draft.versions = d.versions;
    });
    if (!merged) {
        const old = legacyLibraryStore.read();
        if (old.history.length || old.favourites.length) write(mergeLibraries(read(), old));
        try { localStorage.setItem(MERGED_KEY, '1'); } catch { /* blocked storage: the store is in memory anyway */ }
    }
    useLibraryStore({ read, write });
}
