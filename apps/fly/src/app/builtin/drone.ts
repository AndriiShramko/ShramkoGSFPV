// The pause menu's Drone: pick another drone preset. Esc, the picker's close and the current
// drone's own card keep the drone and fly on from where it was: no new flight model, no respawn.
import { DronePicker } from '../../ui/drone';
import { newLife } from '../lives';
import type { Feature } from '../context';

export const drone: Feature = {
    id: 'drone',
    install(ctx) {
        ctx.menu.add({
            id: 'pause.drone', action: null, labelKey: 'pause.drone', order: 40, section: 'setup',
            run: () => {
                ctx.pause('panel');
                const d = new DronePicker(ctx.ui, ctx.session.presetId);
                let up = true;
                // the picker is not a panel: it owns Esc while it is up (P does nothing over it)
                const unbind = ctx.keys.on('pause.toggle', (e) => { if (e.code === 'Escape') close(); });
                const takeDown = (): boolean => {
                    if (!up) return false;
                    up = false;
                    unbind();
                    d.remove();
                    return true;
                };
                const close = (): void => { if (takeDown()) ctx.resume('panel'); };
                d.onClose = close;
                d.onPick = (id) => {
                    if (id === ctx.session.presetId) { close(); return; }
                    if (!takeDown()) return;
                    newLife(ctx, 'settings', () => ctx.session.rebuildSim(id, ctx.session.overrides));
                    const u = new URL(location.href);
                    u.searchParams.set('drone', id);
                    history.replaceState(null, '', u);
                    ctx.resume('panel');
                };
            }
        });
    }
};
