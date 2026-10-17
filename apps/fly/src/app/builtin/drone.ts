// The menu's "Change drone": the drone picker (ui/drone.ts). Another drone is the pilot's choice
// (drone.current, stored for good) and a new flight model with THAT drone's own values: its camera,
// crash threshold, motors, PID, rates (W2-1, review findings C1/C10: v0.2 handed the old drone's
// overrides to the next one, and a reload forgot the drone). The model comes from the store
// (app/prefs.ts applyModel), so the picker, the settings screen and the next visit agree; a craft in
// the air goes on from where it is (A.7). Esc, the picker's x and the current drone's own card keep
// the drone and fly on: no new flight model, no respawn.
import { DronePicker } from '../../ui/drone';
import { h } from '../../ui/dom';
import { PRESETS } from '../../presets';
import { PauseMenu } from '../menu';
import { applyCamera, applyModel, pilotSet } from '../prefs';
import { isPayloadId } from '../../drones3d/payloads';
import type { PayloadId } from '../../drones3d/payloads';
import { openFeedback } from './feedback';
import type { Feature } from '../context';

export const drone: Feature = {
    id: 'drone',
    install(ctx) {
        // v0.9 lane D: "Your drone" in the pause menu, a small turntable of the drone in use with the numbers that matter.
        // The 3D models are their own chunk (drones3d): loaded when the menu opens, drawn only while it is open, freed
        // with it (the stage disposes itself when its element leaves the page).
        if (ctx.menu instanceof PauseMenu) {
            ctx.menu.addRow(() => {
                const host = h('section', { class: 'sum-row d3-host', 'data-testid': 'your-drone' });
                const id = ctx.session.presetId;
                void import('../../drones3d').then((m) => {
                    if (!host.isConnected || !PRESETS[id]) return;
                    m.mountStage(host, {
                        presets: PRESETS, droneId: id, mode: 'card',
                        // the same button as the menu's own "Change drone": the menu closes, the picker opens
                        onChange: () => host.closest('.pause-menu')?.querySelector<HTMLElement>('[data-action="pause.drone"]')?.click()
                    });
                }).catch((e) => console.warn('your-drone card not loaded', e));
                return host;
            });
        }
        ctx.menu.add({
            id: 'pause.drone', action: null, labelKey: 'pause.drone', order: 40, section: 'setup',
            run: () => {
                const session = ctx.session;
                ctx.pause('panel');
                // v0.9: the cinelifter's camera load is the drone.payload setting of the drone it is chosen for
                const payload = {
                    get: (drone: string): PayloadId => { const v = ctx.prefs.get<string>('drone.payload', { drone }); return isPayloadId(v) ? v : 'komodo'; },
                    set: (drone: string, id: PayloadId): void => { pilotSet(ctx.prefs, 'drone.payload', id, { drone }); }
                };
                const d = new DronePicker(ctx.ui, session.presetId, { store: ctx.prefs, tune: true, payload });
                // the picker is a screen, not a panel: while it is up, Esc is its close (P does nothing)
                const unEsc = ctx.keys.on('pause.toggle', (e) => { if (e.code === 'Escape') close(); });
                let open = true;
                const gone = (): void => { open = false; unEsc(); d.remove(); };
                function close(): void {
                    if (!open) return;
                    gone();
                    // a camera load chosen for the drone in use reaches its flight model (a craft in the air goes on from where it is)
                    applyModel(ctx.session, ctx.prefs);
                    ctx.resume('panel');
                }
                d.onClose = close;
                // v0.8 help us tune this drone: the picker goes, the feedback form takes the pause over (the same reason)
                d.onTune = (id) => {
                    if (!open) return;
                    gone();
                    openFeedback(ctx, 'drone', { drone: id });
                };
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
