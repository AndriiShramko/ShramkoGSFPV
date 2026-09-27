// After a crash: the chase camera and the wreck (crashview.ts), then the crash panel. R respawns at
// the start; the pause menu's Restart builds a fresh flight model there. Every new life clears it all.
import { V02_PAUSE_ITEMS } from '@gsfpv/prefs';
import { CrashOverlay } from '../../ui/crash-overlay';
import { beacon } from '../env';
import { newLife } from '../lives';
import { saveLog } from '../logs';
import type { Feature } from '../context';

/** The chase camera plays this long before the crash panel comes up. */
const PANEL_AFTER_MS = 1500;

export const crash: Feature = {
    id: 'crash',
    install(ctx) {
        const hook = ctx.hook;
        let overlay: CrashOverlay | null = null;
        const removeOverlay = (): void => {
            overlay?.remove();
            overlay = null;
            ctx.keys.state = 'flight';
        };
        // leaving the crash: the panel, the wreck and the chase camera go; a replay stops
        ctx.events.on('life', () => {
            removeOverlay();
            ctx.crash.clear();
            ctx.session.cameraOverride = false;
            ctx.session.stopReplay();
        });

        ctx.events.on('frame', ({ now }) => {
            if (!ctx.crash.active) ctx.crash.trackCamera();
            ctx.crash.frame(now);
        });

        ctx.events.on('sim', (e) => {
            if (e.type !== 'crash') return;
            const session = ctx.session;
            const crash = ctx.crash;
            beacon('crash');
            session.cameraOverride = true;
            hook.lastCrash = { speed: e.speed, tick: e.tick, pending: true };
            void crash.onCrash(e).then(() => { hook.lastCrash = { ...crash.info!, event: e }; });
            setTimeout(() => {
                if (!crash.active) return;
                const sp = `${e.speed.toFixed(1)} m/s`;
                overlay = new CrashOverlay(ctx.ui, crash.info ?? { speed: e.speed, tick: e.tick, engine: 'sim-core', debris: 0, maxAngularSpeed: 0, staticBoxes: 0 }, sp);
                ctx.keys.state = 'crash';
                overlay.onRespawn = () => { newLife(ctx, 'manual-start', () => session.respawn(false)); ctx.input.touch?.setArmed(false); };
                overlay.onSafe = () => { newLife(ctx, 'manual-rewind', () => session.respawn(true)); ctx.input.touch?.setArmed(false); };
                overlay.onReplay = () => {
                    removeOverlay();
                    crash.clear();
                    session.cameraOverride = false;
                    session.startReplay(session.log, Math.max(0, e.tick - 10000), e.tick + 1500);
                };
                overlay.onSave = () => saveLog(session, `crash ${sp}`);
            }, PANEL_AFTER_MS);
        });

        ctx.keys.on('respawn.start', () => newLife(ctx, 'manual-start', () => ctx.session.respawn(false)));
        ctx.menu.add({
            id: 'pause.restart', action: V02_PAUSE_ITEMS.restart, labelKey: 'pause.restart', order: 20, section: 'flight',
            // back to the start with a fresh flight model (R while the menu is up)
            run: () => newLife(ctx, 'manual-start', () => ctx.session.rebuildSim(ctx.session.presetId, ctx.session.overrides))
        });
    }
};
