// Back to the start. R respawns at the spawn now (crash or not); the menu's Restart (R while the
// menu is up) starts a fresh flight model at the spawn.
import { V02_PAUSE_ITEMS } from '@gsfpv/prefs';
import type { Feature } from '../context';

export const respawn: Feature = {
    id: 'respawn',
    install(ctx) {
        ctx.menu.add({
            id: 'pause.restart', action: V02_PAUSE_ITEMS.restart, labelKey: 'pause.restart', order: 20, section: 'flight',
            run: () => {
                ctx.clearCrash();
                ctx.session.rebuildSim(ctx.session.presetId, ctx.session.overrides);
            }
        });
        ctx.keys.on('respawn.start', () => {
            ctx.clearCrash();
            ctx.session.respawn(false);
        });
    }
};
