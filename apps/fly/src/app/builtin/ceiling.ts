// The collision ceiling in flight (v0.7 lane E, the owner's item 10: "maybe turn the collision effect
// off above a certain Z level for outdoor scans"; docs/wip/v07-e.md sections 4-6). prefs scene.ceiling
// (per scan: the scan's own height, off, or the pilot's scene.ceilingM) says where; the session flies
// it (session.setCeiling: the walls lose the voxels above it, the log gets a world record; the craft
// flies on, its path and the respawn rules untouched). Heights are stored in the scan's own
// coordinates (scale 1, as the catalogue's ceilingM) and shown as metres above the start at the size
// flown: c (scan) = (spawn y + h - t_y) / s.
//
// The "Ignore collisions above" panel (ui/ceiling.ts): from the Settings row or the test hook; the
// voxel grid previews the slider's height (VoxelController.previewCeiling: voxels above in violet, a
// translucent plane), Apply / Off / the scan's own height store the choice.
import { blockAboveCut, ceilingCut, componentsOf } from '@gsfpv/collision';
import type { FlightSession } from '../../session';
import { aboveStart, sceneCeiling, scanHeight, storedCeiling } from '../../session/ceiling-source';
import { ceilingPanel, ceilingRowExtra } from '../../ui/ceiling';
import type { CeilingPanel } from '../../ui/ceiling';
import { t } from '../../i18n';
import { pilotReset, pilotSet } from '../prefs';
import type { Feature, FlightContext } from '../context';

// window.__gsfpv.ceiling (test-hook.ts is the shell's; this feature adds its part)
declare module '../test-hook' {
    interface TestHook {
        /** v0.7 collision ceiling: the height flown (scan metres and above the start), the stored choice, the panel */
        ceiling?: {
            state(): { ceilingM: number | null; aboveStartM: number | null; mode: string; stored: number | null; flownY: number | null };
            /** as Settings would: 'scene', 'off', or a height above the start (m) */
            set(choice: 'scene' | 'off' | number): void;
            open(): void;
            panel(): { value: number; preview: number | null } | null;
        };
    }
}

/** Blocks of the scan's walls per block row (a histogram), for "how many go above h". */
function blockRows(ses: FlightSession): { rows: Map<number, number>; total: number } | null {
    const base = ses.baseCollision;
    if (!base) return null;
    const c = componentsOf(base);
    const [nbx, nby] = c.dims;
    const rows = new Map<number, number>();
    for (let i = 0; i < c.keys.length; i++) {
        const by = Math.floor(c.keys[i] / nbx) % nby;
        rows.set(by, (rows.get(by) ?? 0) + 1);
    }
    return { rows, total: c.keys.length };
}

let open: { panel: CeilingPanel; session: FlightSession } | null = null;

/** The panel beside the flight, which goes on (as "Clean floating voxels"); a second call keeps the one up. */
export function openCeilingPanel(ctx: FlightContext): void {
    if (open?.panel.root.isConnected) return;
    const ses = ctx.session;
    const base = ses.baseCollision;
    if (!base || !ses.collision) {
        ctx.hud.flash(t('walls.none'), 3500);
        return;
    }
    // one panel at the panels' place at a time
    ctx.ui.querySelector<HTMLButtonElement>('[data-action="floaters-close"]')?.click();
    const sceneId = ctx.scene.id;
    const hist = blockRows(ses);
    // the walls' bottom and top in the flown world, as metres above the start
    const tr = ses.transform;
    const y0 = base.flipXY ? -(base.gridMinY + base.numVoxelsY * base.voxelResolution) : base.gridMinY;
    const y1 = y0 + base.numVoxelsY * base.voxelResolution;
    const lo = Math.floor(aboveStart(ses, y0)), hi = Math.ceil(aboveStart(ses, y1));
    const step = Math.max(0.1, Math.round(tr.s * base.voxelResolution * 10) / 10);
    const def = sceneCeiling(ctx.prefs, sceneId);
    const panel = ceilingPanel(ctx.ui, {
        range: { lo, hi, step },
        sceneDefault: def === null ? null : aboveStart(ses, def),
        applied: () => (ses.ceilingM === null ? null : aboveStart(ses, ses.ceilingM)),
        count: (h) => {
            if (!hist) return { above: 0, total: 0 };
            const cut = ceilingCut(base, scanHeight(ses, h));
            let above = 0;
            for (const [by, n] of hist.rows) if (blockAboveCut(cut, by)) above += n;
            return { above, total: hist.total };
        },
        preview: (h) => ctx.voxels.previewCeiling(h === null ? null : scanHeight(ses, h)),
        apply: (choice) => {
            const scene = { scene: sceneId };
            if (choice === 'scene') {
                pilotReset(ctx.prefs, 'scene.ceiling', scene);
                pilotReset(ctx.prefs, 'scene.ceilingM', scene);
            } else if (choice === 'off') pilotSet(ctx.prefs, 'scene.ceiling', 'off', scene);
            else {
                pilotSet(ctx.prefs, 'scene.ceilingM', scanHeight(ses, choice), scene);
                pilotSet(ctx.prefs, 'scene.ceiling', 'custom', scene);
            }
        },
        onClose: () => { open = null; }
    });
    open = { panel, session: ses };
}

/** Under Settings' row of scene.ceiling: what is ignored now, and the panel (Settings closes first). */
export function ceilingRow(ctx: FlightContext, closeSettings: () => void): { el: HTMLElement; refresh(): void } {
    return ceilingRowExtra({
        applied: () => {
            const c = storedCeiling(ctx.prefs, ctx.scene.id);
            return c === null ? null : aboveStart(ctx.session, c);
        },
        hasWalls: () => !!ctx.session.baseCollision,
        open: () => { closeSettings(); openCeilingPanel(ctx); }
    });
}

export const ceiling: Feature = {
    id: 'ceiling',
    install(ctx) {
        let scheduled = false;
        /** The stored ceiling on the flight now ('live': a world record, the craft flies on). */
        const apply = (): void => {
            scheduled = false;
            const ses = ctx.session;
            if (!ses?.renderer || ses.disposed) return;
            const c = storedCeiling(ctx.prefs, ctx.scene.id);
            if (!ses.setCeiling(c)) return;
            ctx.renderer.renderOnce();
            ctx.hud.flash(c === null ? t('ceiling.note.off') : t('ceiling.note.on', { h: aboveStart(ses, c).toFixed(1) }), 3500);
        };
        // the Settings rows, the panel, an import, another tab: the store says, the flight follows; the
        // panel's two writes (height, then 'custom') go on as one change
        const offPrefs = ctx.prefs.onChange((c) => {
            if (c.id !== 'scene.ceiling' && c.id !== 'scene.ceilingM') return;
            if (c.key !== null && c.key !== ctx.scene.id) return;
            if (scheduled) return;
            scheduled = true;
            queueMicrotask(apply);
        });
        ctx.hook.ceiling = {
            state: () => {
                const ses = ctx.session;
                const c = ses.ceilingM;
                return {
                    ceilingM: c,
                    aboveStartM: c === null ? null : aboveStart(ses, c),
                    mode: ctx.prefs.get<string>('scene.ceiling', { scene: ctx.scene.id }),
                    stored: storedCeiling(ctx.prefs, ctx.scene.id),
                    flownY: c === null ? null : ses.transform.s * c + ses.transform.t[1]
                };
            },
            set: (choice) => {
                const scene = { scene: ctx.scene.id };
                if (choice === 'scene') { ctx.prefs.reset('scene.ceiling', scene); ctx.prefs.reset('scene.ceilingM', scene); }
                else if (choice === 'off') ctx.prefs.set('scene.ceiling', 'off', scene);
                else { ctx.prefs.set('scene.ceilingM', scanHeight(ctx.session, choice), scene); ctx.prefs.set('scene.ceiling', 'custom', scene); }
            },
            open: () => openCeilingPanel(ctx),
            panel: () => (open ? { value: open.panel.value(), preview: ctx.voxels.ceilingPreview } : null)
        };
        // a new scene: a panel of the old one goes (its heights were of the old scan)
        const offSession = ctx.events.on('session', () => open?.panel.close());
        return () => {
            offSession();
            open?.panel.close();
            offPrefs();
            delete ctx.hook.ceiling;
        };
    }
};
