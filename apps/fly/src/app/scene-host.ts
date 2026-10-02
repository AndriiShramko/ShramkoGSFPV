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
// A scene that fails to load is noted (the rotation skips it for a day) and the scene left comes
// back. Which scene N, Shift+N and F load comes from the rotation (@gsfpv/scenes rotation.ts).
// The pause menu's "Change scan" opens the scene picker over the flight (openPicker): a scene picked
// there loads the same way, so changing the scan by hand keeps the radio too (item 5).
import { SceneError, SceneRotation, getLibrary, legacyLibraryStore, mergeLibraries, parseSceneInput, recordFailure, recordOpen, useLibraryStore } from '@gsfpv/scenes';
import type { RotationRules, RotationSource, RotationOrder, SceneLibraryData } from '@gsfpv/scenes';
import type { PrefsStore } from '@gsfpv/prefs';
import { FlightSession } from '../session';
import type { SessionOptions } from '../session';
import { LoadingScreen } from '../ui/loading';
import { ScenePicker } from '../ui/scenes';
import type { ShowcaseScene } from '../ui/scenes';
import { h } from '../ui/dom';
import { wallsWanted } from '../flightwalls';
import { storedTransform } from './builtin/scale';
import { storedDropFloaters } from './builtin/floaters';
import { t } from '../i18n';
import { beacon, q } from './env';
import { hook } from './test-hook';
import type { FlightContext, SceneRef, SceneSwitchReason, SceneSwitcher } from './context';

/** What the shell gives the host: the page's context with the swap, the canvas, the curated list. */
export interface SceneHostDeps {
    ctx: FlightContext & { swapSession(next: FlightSession, scene: SceneRef): void };
    canvas: HTMLCanvasElement;
    showcase: readonly ShowcaseScene[];
    /** how this page flies whatever scene (the URL's test switches): the same for every scene */
    base: Pick<SessionOptions, 'drawScan' | 'latencyMarker' | 'lagFrames' | 'renderScale'>;
}

/** The switches so far, for the acceptance (window.__gsfpv.scenes). */
export interface SwitchRecord { from: string; to: string; reason: SceneSwitchReason; ok: boolean; ms: number; code?: string }

export class SceneHost implements SceneSwitcher {
    private readonly d: SceneHostDeps;
    readonly rotation: SceneRotation;
    private busyNow = false;
    readonly log: SwitchRecord[] = [];
    private picker: ScenePicker | null = null;

    constructor(d: SceneHostDeps) {
        this.d = d;
        this.rotation = new SceneRotation({ curated: () => d.showcase.map((s) => ({ id: s.id, collision: s.collision })), library: getLibrary });
    }

    get busy(): boolean {
        return this.busyNow;
    }

    private rules(): RotationRules {
        return { allowNoWalls: this.d.ctx.prefs.get<boolean>('scenes.allowNoWalls') === true };
    }

    /** The scene N (or a crash with scenes.autoSwitch), Shift+N or F would load now; null: none. */
    pick(kind: 'next' | 'random' | 'favourite' | 'auto'): string | null {
        const prefs = this.d.ctx.prefs;
        const cur = this.d.ctx.scene.id;
        if (kind === 'random') return this.rotation.random(cur, this.rules());
        if (kind === 'favourite') return this.rotation.nextFavourite(cur, this.rules());
        const src = prefs.get<string>('scenes.rotation');
        const source: RotationSource = src === 'favourites' || src === 'history' ? src : 'curated';
        const order: RotationOrder = prefs.get<string>('scenes.order') === 'sequential' ? 'sequential' : 'random';
        return this.rotation.next(source, cur, order, this.rules());
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
        const picker = new ScenePicker(ctx.ui, [...showcase]);
        this.picker = picker;
        picker.root.classList.add('in-flight');
        picker.root.dataset.testid = 'scenes-in-flight';
        // the flight's keys wait while it is up (its field takes letters); Esc closes it
        const offKeys = ctx.keys.block(() => true);
        const onKey = (e: KeyboardEvent): void => {
            if (e.key !== 'Escape') return;
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
            const id = parseSceneInput(raw);
            if (!id) { picker.showError('invalid-link'); return; }
            // the same scene: back to it as it was
            if (id === ctx.scene.id) { close(true); return; }
            close(false); // the 'scene' pause stays: load() holds it and releases it when the new scene flies
            beacon('scene_open', { source });
            void this.load(id, 'pick');
        };
    }

    async go(kind: 'next' | 'random' | 'favourite' | 'auto'): Promise<boolean> {
        if (this.busyNow) return false;
        const id = this.pick(kind);
        if (!id) {
            this.d.ctx.hud.flash(t(kind === 'favourite' ? 'rotation.noFavourite' : 'rotation.none'), 3500);
            return false;
        }
        return this.load(id, kind);
    }

    async load(id: string, reason: SceneSwitchReason): Promise<boolean> {
        const { ctx, canvas, showcase, base } = this.d;
        if (this.busyNow || (id === ctx.scene.id && reason !== 'back')) return false;
        this.busyNow = true;
        const t0 = performance.now();
        const from = ctx.scene.id;
        hook.sceneSwitch = { state: 'loading', from, to: id, reason };
        ctx.pause('scene');
        if (ctx.menu.isOpen) ctx.menu.close();
        ctx.clearCrash();
        const old = ctx.session;
        const meta = showcase.find((s) => s.id === id);
        const loading = new LoadingScreen(ctx.ui, {
            sceneId: id,
            title: meta?.title,
            next: null,
            compact: true,
            onRetry: () => location.reload(),
            onBack: () => { location.search = ''; }
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
            onProgress: (p) => loading.update(p)
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
                await this.load(from, 'back');
                ctx.hud.flash(t('rotation.failed', { id }), 5000);
                return false;
            }
            location.search = '';
            return false;
        }
        if (base.drawScan !== false) next.renderer.startLatencyGuard(q.get('guard') !== '0');
        if (q.get('inflight') !== null) next.renderer.maxFramesInFlight = Number(q.get('inflight'));
        await loading.finish();
        ctx.swapSession(next, { id, meta });
        const u = new URL(location.href);
        u.searchParams.set('scene', id);
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
