// Scene size around the drone (docs/architecture-v03.md E.7; the owner's item 11: "if the scene's
// size is wrong, the pilot must be able to change its scale, centred on the drone"). A scan is
// often not in true metres, so the drone feels too big or too small; physics stays in metres and
// the scene scales instead. [ and ] divide or multiply the size by 1.1, applied 300 ms after the
// last press (a held key goes on stepping); the summary panel has a row "Scene size x1.00 [-]
// slider [+] reset" with the voxel size it gives the walls; Settings -> Scenes holds the same value.
// Every change rescales around the craft (session.setTransform: the craft stays where it is, the
// walls and the splats follow, the log gets a world record) and is kept per scene (prefs
// scene.transform), so it survives a reload. A change made elsewhere (the Settings row, a reset,
// an import) is taken as the new size and applied around the craft the same way.
import { SCALE_MAX, SCALE_MIN } from '@gsfpv/prefs';
import type { PrefsStore, SceneTransform as StoredTransform } from '@gsfpv/prefs';
import { rescaleAround } from '@gsfpv/collision';
import type { FlightSession } from '../../session';
import { PauseMenu } from '../menu';
import { h } from '../../ui/dom';
import { t } from '../../i18n';
import type { Feature, FlightContext } from '../context';
import './scale.css';

/** One press of [ or ]. */
export const SCALE_STEP = 1.1;
/** A key's size applies this long after the last press (E.7: on release, debounced). */
export const SCALE_APPLY_MS = 300;
/** Above this voxel size the walls get coarse enough to feel (E.7). */
export const COARSE_VOXEL_M = 0.1;

// window.__gsfpv.scale (test-hook.ts is the shell's; this feature adds its part, like the others)
declare module '../test-hook' {
    interface TestHook {
        /** E.7: the scene size now, and the same changes the row and the keys make */
        scale?: { size(): number; set(s: number): void; reset(): void; pending(): number };
    }
}

/** The size a scene starts with: the pilot's for this scene, else the curated scale, else 1 (prefs default). */
export function storedTransform(prefs: PrefsStore, scene: string): StoredTransform | null {
    try {
        return prefs.get<StoredTransform | null>('scene.transform', { scene });
    } catch {
        return null;
    }
}

export const clampSize = (s: number): number => (s < SCALE_MIN ? SCALE_MIN : s > SCALE_MAX ? SCALE_MAX : s);

/** The walls' block size at scene size s, in metres (null: the scan has no walls). */
export function voxelAt(session: FlightSession, s: number): number | null {
    const base = session.baseCollision;
    return base ? base.voxelResolution * s : null;
}

const fmt = (s: number): string => s.toFixed(2);

export const scale: Feature = {
    id: 'scale',
    install(ctx: FlightContext) {
        const sceneCtx = () => ({ scene: ctx.scene.id });
        const size = (): number => ctx.session.transform.s;
        const defaultSize = (): number => (ctx.prefs.defaultOf<StoredTransform | null>('scene.transform', sceneCtx())?.s ?? 1);
        let writing = false;
        let row: { out: HTMLElement; slider: HTMLInputElement; vox: HTMLElement; reset: HTMLButtonElement } | null = null;

        const refresh = (preview?: number): void => {
            if (!row || !row.out.isConnected) { row = null; return; }
            const s = preview ?? size();
            row.out.textContent = `x${fmt(s)}`;
            if (preview === undefined) row.slider.value = String(Math.log2(s));
            row.slider.setAttribute('aria-valuetext', `x${fmt(s)}`);
            row.reset.disabled = Math.abs(s - defaultSize()) < 5e-4;
            const v = voxelAt(ctx.session, s);
            row.vox.hidden = v === null;
            if (v !== null) {
                const cm = (v * 100).toFixed(1);
                const coarse = v > COARSE_VOXEL_M + 1e-9;
                row.vox.textContent = coarse ? t('scale.voxelCoarse', { cm }) : t('scale.voxel', { cm });
                row.vox.classList.toggle('warn', coarse);
            }
        };

        /** The scene at size s around the craft, kept for this scene. */
        const setSize = (want: number): void => {
            const ses = ctx.session;
            if (!ses?.renderer || ses.disposed) return;
            let s = clampSize(want);
            if (Math.abs(s - 1) < 1e-6) s = 1; // ] ] ] [ [ [ lands on 1, not 0.9999999
            const cur = ses.transform;
            if (s === cur.s) { refresh(); return; }
            const next = rescaleAround(cur, s / cur.s, ses.pivot());
            next.s = s;
            const r = ses.setTransform(next);
            writing = true;
            try {
                ctx.prefs.set('scene.transform', { s: r.transform.s, t: [...r.transform.t], v: ses.scene.version }, sceneCtx());
            } finally {
                writing = false;
            }
            ctx.renderer.renderOnce();
            if (r.pushed) ctx.hud.flash(t('scale.pushed'), 3500);
            refresh();
        };

        // ---- [ and ]: each press steps the size; it applies 300 ms after the last one
        let pending = 1;
        let timer = 0;
        let lastStep = -Infinity;
        const flushKeys = (): void => {
            clearTimeout(timer);
            timer = 0;
            const k = pending;
            pending = 1;
            if (k !== 1) setSize(size() * k);
        };
        // over a screen or a panel (settings, drones, the picker) the keys are theirs; the summary panel is ours
        const blocked = (): boolean => !!document.querySelector('#ui .screen, #ui .panel:not(.pause-menu)');
        const step = (k: number, e: KeyboardEvent): void => {
            if (blocked()) return;
            e.preventDefault();
            const now = performance.now();
            if (e.repeat && now - lastStep < 100) return; // a held key: ten steps a second
            lastStep = now;
            const target = clampSize(size() * pending * k);
            pending = target / size();
            const shown = Math.abs(target - 1) < 1e-6 ? 1 : target;
            ctx.hud.flash(t(target === SCALE_MIN || target === SCALE_MAX ? 'scale.toastLimit' : 'scale.toast', { x: fmt(shown) }), 1500);
            refresh(shown);
            clearTimeout(timer);
            timer = window.setTimeout(flushKeys, SCALE_APPLY_MS);
        };
        const offDown = ctx.keys.on('scale.down', (e) => step(1 / SCALE_STEP, e));
        const offUp = ctx.keys.on('scale.up', (e) => step(SCALE_STEP, e));

        // ---- the summary panel's row
        let slideTimer = 0;
        const btn = (label: string, aria: string, run: () => void, action: string) => h('button', { type: 'button', class: 'btn sc-btn', 'aria-label': aria, title: aria, 'data-action': action, onclick: run }, label) as HTMLButtonElement;
        const makeRow = (): HTMLElement => {
            const id = 'sum-scale-h';
            const out = h('output', { class: 'sc-value', 'data-testid': 'scene-size-value', 'aria-live': 'polite' });
            const slider = h('input', { type: 'range', class: 'sc-slider', min: Math.log2(SCALE_MIN), max: Math.log2(SCALE_MAX), step: 0.01, 'aria-labelledby': id, 'data-testid': 'scene-size-slider' }) as HTMLInputElement;
            slider.addEventListener('input', () => {
                const s = clampSize(2 ** Number(slider.value));
                refresh(s);
                clearTimeout(slideTimer);
                slideTimer = window.setTimeout(() => setSize(s), 120);
            });
            const minus = btn('−', t('scale.smaller'), () => setSize(size() / SCALE_STEP), 'scale-down');
            const plus = btn('+', t('scale.larger'), () => setSize(size() * SCALE_STEP), 'scale-up');
            const reset = btn(t('scale.reset'), t('scale.resetAria'), () => setSize(defaultSize()), 'scale-reset');
            const vox = h('span', { class: 'sc-vox', 'data-testid': 'scene-size-voxel' });
            row = { out, slider, vox, reset };
            const el = h('section', { class: 'sum-row sc-row', role: 'group', 'aria-labelledby': id, 'data-testid': 'scene-size' },
                h('span', { class: 'sc-label', id }, t('scale.title')), out, minus, slider, plus, reset, vox);
            queueMicrotask(() => refresh());
            return el;
        };
        const offRow = ctx.menu instanceof PauseMenu ? ctx.menu.addRow(makeRow) : () => undefined;

        // ---- a change made elsewhere: the Settings row, its reset, an import, another tab
        const offPrefs = ctx.prefs.onChange((c) => {
            if (c.id !== 'scene.transform' || writing) return;
            const v = storedTransform(ctx.prefs, ctx.scene.id);
            if (!v) return;
            const cur = ctx.session.transform;
            if (Math.abs(v.s - cur.s) > 1e-6) setSize(v.s);
            else if (v.t.some((x, i) => Math.abs(x - cur.t[i]) > 1e-6)) {
                // the same size, another place (a reset at the default size, an import): as given
                const r = ctx.session.setTransform(v);
                ctx.renderer.renderOnce();
                if (r.pushed) ctx.hud.flash(t('scale.pushed'), 3500);
                refresh();
            }
        });

        // a new scene (E.4) starts with its own stored size; a key's step for the old one is dropped
        const offSession = ctx.events.on('session', () => {
            clearTimeout(timer);
            timer = 0;
            pending = 1;
            refresh();
        });

        ctx.hook.scale = { size, set: (s) => setSize(s), reset: () => setSize(defaultSize()), pending: () => pending };
        return () => {
            clearTimeout(timer);
            clearTimeout(slideTimer);
            offDown();
            offUp();
            offRow();
            offPrefs();
            offSession();
            delete ctx.hook.scale;
        };
    }
};
