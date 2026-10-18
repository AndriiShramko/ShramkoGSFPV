// "Save as this scan's default" in the pause menu, for the owner only (v0.7 lane E, item 3 of the
// lane; docs/wip/v07-e.md section 6). Where this browser signed in to the admin page (the hint
// admin/api.ts keeps) and GET /api/admin/session answers, the scene section of the pause menu gets
// one item: what is flown now (walls, floater filter, Scene size, collision ceiling, wind) goes into
// this scan's entry of the admin's catalogue DRAFT (app/scene-default.ts has the rules and the save);
// the admin page publishes it. A visitor's page never asks the admin API anything.
import { AdminClient, adminHinted } from '../../admin/api';
import type { FlightSession } from '../../session';
import { flownWind, saveSceneDefault } from '../scene-default';
import type { FlownDefaults, SaveDefaultResult } from '../scene-default';
import { customWind, windMode } from '../../session/wind-source';
import type { PrefsStore } from '@gsfpv/prefs';
import { t } from '../../i18n';
import type { Feature } from '../context';

// window.__gsfpv.sceneDefault (test-hook.ts is the shell's; this feature adds its part)
declare module '../test-hook' {
    interface TestHook {
        /** v0.7 admin action: is it offered, what it would save, and the save itself */
        sceneDefault?: {
            offered(): boolean;
            flown(): FlownDefaults;
            save(): Promise<SaveDefaultResult>;
        };
    }
}

/**
 * What the session flies now, in the terms of the catalogue's defaults; the pilot's wind.mode and this
 * scan's custom numbers tell still air picked for the scan from wind switched off (flownWind).
 */
export function flownDefaults(ses: FlightSession, prefs: Pick<PrefsStore, 'get'>, sceneId: string): FlownDefaults {
    return {
        walls: ses.baseCollision ? (ses.wallsOn ? 'on' : 'off') : null,
        dropFloaters: ses.floaterMinBlocks,
        scale: ses.transform.s,
        ceilingM: ses.ceilingM,
        wind: flownWind(ses.windSpec, windMode(prefs.get('wind.mode', { scene: sceneId })), customWind(prefs, sceneId))
    };
}

/** The pilot's words for a result. */
function resultText(r: SaveDefaultResult, scale: number): string {
    if (!r.ok) return t(`scenedefault.fail.${r.why}`);
    const notes = [t('scenedefault.saved')];
    if (r.patch.kept.includes('scale')) notes.push(t('scenedefault.keptScale', { s: scale.toFixed(2).replace(/\.?0+$/, '') }));
    if (r.patch.kept.includes('wind-live')) notes.push(t('scenedefault.keptWind'));
    if (r.patch.kept.includes('wind-off') && r.entry.wind) notes.push(t('scenedefault.keptWindOff'));
    return notes.join(' ');
}

export const sceneDefault: Feature = {
    id: 'scene-default',
    install(ctx) {
        let offItem: (() => void) | null = null;
        let gone = false;
        const client = new AdminClient();
        const save = async (): Promise<SaveDefaultResult> => {
            const flown = flownDefaults(ctx.session, ctx.prefs, ctx.scene.id);
            const r = await saveSceneDefault(client, ctx.scene.id, flown);
            if (!gone) ctx.hud.flash(resultText(r, flown.scale), 7000);
            return r;
        };
        ctx.hook.sceneDefault = {
            offered: () => offItem !== null,
            flown: () => flownDefaults(ctx.session, ctx.prefs, ctx.scene.id),
            save
        };
        // the hint first: without it no request at all; with it, the session decides
        if (adminHinted()) {
            void client.resume().then((live) => {
                if (live !== true || gone) return;
                offItem = ctx.menu.add({ id: 'pause.sceneDefault', action: null, labelKey: 'scenedefault.menu', order: 38, section: 'scene', run: () => void save() });
            });
        }
        return () => {
            gone = true;
            offItem?.();
            offItem = null;
            delete ctx.hook.sceneDefault;
        };
    }
};
