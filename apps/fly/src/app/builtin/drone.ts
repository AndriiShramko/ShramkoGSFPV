// The menu's "Change drone": the drone picker (ui/drone.ts). Another drone is the pilot's choice
// (drone.current, stored for good) and a new flight model with THAT drone's own values: its camera,
// crash threshold, motors, PID, rates (W2-1, review findings C1/C10: v0.2 handed the old drone's
// overrides to the next one, and a reload forgot the drone). The model comes from the store
// (app/prefs.ts applyModel), so the picker, the settings screen and the next visit agree; a craft in
// the air goes on from where it is (A.7). Esc, the picker's x and the current drone's own card keep
// the drone and fly on: no new flight model, no respawn.
import { DronePicker } from '../../ui/drone';
import { applyCamera, applyModel, pilotSet } from '../prefs';
import type { Feature } from '../context';

export const drone: Feature = {
    id: 'drone',
    install(ctx) {
        ctx.menu.add({
            id: 'pause.drone', action: null, labelKey: 'pause.drone', order: 40, section: 'setup',
            run: () => {
                const session = ctx.session;
                ctx.pause('panel');
                const d = new DronePicker(ctx.ui, session.presetId, { store: ctx.prefs });
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
                    pilotSet(ctx.prefs, 'drone.current', id);
                    applyModel(ctx.session, ctx.prefs);
                    applyCamera(ctx.session, ctx.prefs);
                    ctx.resume('panel');
                };
            }
        });
    }
};
