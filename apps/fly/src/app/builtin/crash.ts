// A crash: the crash camera takes the view (crashview.ts), and 1.5 s later the crash panel
// (ui/crash-overlay.ts): respawn at the start or at the last safe point, replay the last 10 s, save
// the log. The panel goes with ctx.clearCrash() (respawn, restart, walls switch, a new drone...).
import { CrashOverlay } from '../../ui/crash-overlay';
import { beacon } from '../env';
import { saveLog } from '../logs';
import type { Feature } from '../context';

export const crash: Feature = {
    id: 'crash',
    install(ctx) {
        const view = ctx.crash;
        let overlay: CrashOverlay | null = null;
        ctx.events.on('crashCleared', () => {
            overlay?.remove();
            overlay = null;
        });
        ctx.events.on('sim', (e) => {
            if (e.type !== 'crash') return;
            const session = ctx.session;
            beacon('crash');
            session.cameraOverride = true;
            ctx.hook.lastCrash = { speed: e.speed, tick: e.tick, pending: true };
            void view.onCrash(e).then(() => { ctx.hook.lastCrash = { ...view.info!, event: e }; });
            setTimeout(() => {
                if (!view.active) return;
                const sp = `${e.speed.toFixed(1)} m/s`;
                overlay = new CrashOverlay(ctx.ui, view.info ?? { speed: e.speed, tick: e.tick, engine: 'sim-core', debris: 0, maxAngularSpeed: 0, staticBoxes: 0 }, sp);
                overlay.onRespawn = () => { ctx.clearCrash(); session.respawn(false); ctx.input.touch?.setArmed(false); };
                overlay.onSafe = () => { ctx.clearCrash(); session.respawn(true); ctx.input.touch?.setArmed(false); };
                overlay.onReplay = () => {
                    overlay?.remove();
                    overlay = null;
                    view.clear();
                    session.cameraOverride = false;
                    session.startReplay(session.log, Math.max(0, e.tick - 10000), e.tick + 1500);
                };
                overlay.onSave = () => saveLog(session, `crash ${sp}`);
            }, 1500);
        });
    }
};
