// A crash (docs/architecture-v03.md C.10): the crash camera takes the view (crashview.ts) and plays
// while the respawn waits. Automatic respawn on (the default): a toast counts down to it, nothing to
// click; Enter keeps the wreck and opens the panel. Automatic respawn off: the crash panel 1.5 s
// later (the crash camera first). Any new life (the respawn, R, Y, a restart) takes all of it away
// (app/builtin/respawn.ts calls ctx.clearCrash()).
import type { SimEvent } from '@gsfpv/sim-core';
import { CrashToast, CrashPanel } from '../../ui/crash-overlay';
import { beacon } from '../env';
import { saveLog } from '../logs';
import type { Feature, FlightContext } from '../context';

/** The panel waits this long after a crash when nothing respawns by itself: the crash camera plays first. */
const PANEL_AFTER_MS = 1500;

type Crash = Extract<SimEvent, { type: 'crash' }>;

export const crash: Feature = {
    id: 'crash',
    install(ctx) {
        const view = ctx.crash;
        let toast: CrashToast | null = null;
        let panel: CrashPanel | null = null;
        let panelTimer = 0;
        let last: Crash | null = null;
        /** the crash panel's Replay is playing: the panel comes back when it ends */
        let replaying = false;

        const takeDown = (): void => {
            toast?.remove();
            toast = null;
            panel?.remove();
            panel = null;
            clearTimeout(panelTimer);
        };
        ctx.events.on('crashCleared', () => {
            takeDown();
            last = null;
            replaying = false;
        });

        const showPanel = (): void => {
            const e = last;
            const session = ctx.session;
            // gone after a respawn; after the panel's Replay it comes back while the wreck is still there
            if (!e || panel || !session.sim.crashed) return;
            const sp = `${e.speed.toFixed(1)} m/s`;
            const life = session.stats.life();
            const settings = ctx.menu.items().find((m) => m.action === 'settings.open' || m.id === 'pause.settings');
            panel = new CrashPanel(ctx.ui, view.info ?? { speed: e.speed, tick: e.tick, engine: 'sim-core', debris: 0, maxAngularSpeed: 0, staticBoxes: 0 }, sp,
                { timeS: life.airtimeS, distM: life.distance, topSpeed: life.maxSpeed },
                {
                    rewind: { run: () => session.rewind(), keys: ctx.keys.caps('respawn.rewind'), backS: session.policy.rewindTicks / 1000 },
                    start: { run: () => session.respawnStart(), keys: ctx.keys.caps('respawn.start') },
                    replay: () => replay(ctx, e),
                    save: () => saveLog(session, `crash ${sp}`),
                    settings: settings ? { run: () => settings.run(), keys: ctx.keys.caps('settings.open') } : null
                });
        };

        const replay = (c: FlightContext, e: Crash): void => {
            const s = c.session;
            panel?.remove();
            panel = null;
            view.clear();
            s.cameraOverride = false;
            replaying = s.startReplay([s.log], Math.max(s.log.header.life.startTick, e.tick - 10000), e.tick + 1500);
        };

        ctx.events.on('sim', (e) => {
            if (e.type !== 'crash') return;
            const session = ctx.session;
            beacon('crash');
            takeDown();
            last = e;
            session.cameraOverride = true;
            ctx.hook.lastCrash = { speed: e.speed, tick: e.tick, pending: true };
            void view.onCrash(e).then(() => { ctx.hook.lastCrash = { ...view.info!, event: e }; });
            const p = session.pendingRespawn();
            if (p) {
                toast = new CrashToast(ctx.ui, `${e.speed.toFixed(1)} m/s`, { backS: p.backS, target: p.target, keys: { keep: ctx.keys.caps('crash.keep'), start: ctx.keys.caps('respawn.start') } });
                toast.update(p.inTicks / 1000, p.delayTicks / 1000);
            } else panelTimer = window.setTimeout(showPanel, PANEL_AFTER_MS);
        });

        ctx.events.on('frame', () => {
            const s = ctx.session;
            if (toast) {
                const p = s.pendingRespawn();
                if (p) toast.update(p.inTicks / 1000, p.delayTicks / 1000);
            }
            if (replaying && !s.replaying) {
                replaying = false;
                showPanel();
            }
        });

        // Enter: stay here. The respawn waiting to happen is cancelled and the panel opens at once.
        ctx.keys.on('crash.keep', () => {
            if (!toast) return;
            ctx.session.keepWreck();
            toast.remove();
            toast = null;
            showPanel();
        });
    }
};
