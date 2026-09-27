// The menu's "Change drone": the drone picker (ui/drone.ts). Another drone is a new flight model at
// the spawn and goes into the URL; Esc, the picker's x and the current drone's own card keep the
// drone and fly on from where it was: no new flight model, no respawn.
import { DronePicker } from '../../ui/drone';
import type { Feature } from '../context';

export const drone: Feature = {
    id: 'drone',
    install(ctx) {
        ctx.menu.add({
            id: 'pause.drone', action: null, labelKey: 'pause.drone', order: 40, section: 'setup',
            run: () => {
                const session = ctx.session;
                ctx.pause('panel');
                const d = new DronePicker(ctx.ui, session.presetId);
                // the picker is a screen, not a panel: while it is up, Esc is its close (P does nothing)
                const unEsc = ctx.keys.on('pause.toggle', (e) => { if (e.code === 'Escape') close(); });
                let open = true;
                const gone = (): void => { open = false; unEsc(); d.remove(); };
                function close(): void {
                    if (!open) return;
                    gone();
                    ctx.resume('panel');
                }
                d.onClose = close;
                d.onPick = (id) => {
                    if (id === session.presetId) { close(); return; }
                    if (!open) return;
                    gone();
                    ctx.clearCrash();
                    session.rebuildSim(id, session.overrides);
                    const u = new URL(location.href);
                    u.searchParams.set('drone', id);
                    history.replaceState(null, '', u);
                    ctx.resume('panel');
                };
            }
        });
    }
};
