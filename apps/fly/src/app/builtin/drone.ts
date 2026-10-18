// The menu's "Change drone": the drone picker (ui/drone.ts). Another drone is the pilot's choice
// (drone.current, stored for good) and a new flight model with THAT drone's own values: its camera,
// crash threshold, motors, PID, rates (W2-1, review findings C1/C10: v0.2 handed the old drone's
// overrides to the next one, and a reload forgot the drone). The model comes from the store
// (app/prefs.ts applyModel), so the picker, the settings screen and the next visit agree; a craft in
// the air goes on from where it is (A.7). Esc, the picker's x and the current drone's own card keep
// the drone and fly on: no new flight model, no respawn.
import { DronePicker } from '../../ui/drone';
import { h } from '../../ui/dom';
import { reducedMotion } from '../../ui/motion';
import { DEFAULT_PRESET, PRESETS } from '../../presets';
import type { Stage } from '../../drones3d';
import { PauseMenu } from '../menu';
import { applyCamera, applyModel, pilotSet } from '../prefs';
import { isPayloadId } from '../../drones3d/payloads';
import type { PayloadId } from '../../drones3d/payloads';
import { openFeedback } from './feedback';
import type { Feature, FlightContext } from '../context';

/** The camera load the store keeps for a drone (the drone.payload setting), as the stage and the cards read it. */
function payloadOf(ctx: FlightContext, drone: string): PayloadId {
    const v = ctx.prefs.get<string>('drone.payload', { drone });
    return isPayloadId(v) ? v : 'komodo';
}

/** What a stage of `id` is told about the camera: the drone's own load when it carries one (the cinelifter), else nothing. */
const payloadFor = (ctx: FlightContext, id: string): PayloadId | undefined => (PRESETS[id]?.fields.payload_g ? payloadOf(ctx, id) : undefined);

/** The pilot's Reduced motion setting, asked by a stage every frame (so a change on the settings screen shows at once). */
const calm = (ctx: FlightContext) => (): boolean => reducedMotion(ctx.prefs.get<string>('display.reducedMotion'));

/**
 * The settings screen's picture of the drone under its Drone row (v0.9 lane D): a small turntable of the drone the
 * Drone setting names, with the numbers that matter, above the row's own line (`inner`: the "Help tune it" row).
 * The 3D chunk is loaded and a graphics device made only when the row scrolls into view, and both go with the screen.
 */
export function droneRow(ctx: FlightContext, inner: { el: HTMLElement; refresh(): void }): { el: HTMLElement; refresh(): void } {
    const host = h('div', { class: 'd3-host d3-settings', 'data-testid': 'settings-drone-card' });
    let stage: Stage | null = null;
    let shown = '';
    const current = (): string => { const id = ctx.prefs.get<string>('drone.current'); return PRESETS[id] ? id : DEFAULT_PRESET; };
    const payload = (id: string): PayloadId | undefined => payloadFor(ctx, id);
    const io = typeof IntersectionObserver === 'function' ? new IntersectionObserver((es) => {
        if (stage || !es.some((e) => e.isIntersecting)) return;
        io?.disconnect();
        void import('../../drones3d').then((m) => {
            if (!host.isConnected) return;
            shown = current();
            stage = m.mountStage(host, { presets: PRESETS, droneId: shown, mode: 'card', payload: payload(shown), reducedMotion: calm(ctx) });
        }).catch((e) => console.warn('settings drone card not loaded', e));
    }) : null;
    io?.observe(host);
    return {
        el: h('div', { class: 'd3-settings-row' }, host, inner.el),
        refresh: () => {
            inner.refresh();
            const id = current();
            if (stage && id !== shown) { shown = id; stage.setDrone(id, payload(id)); }
        }
    };
}

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
                        // the camera the pilot flies the cinelifter with (read as the menu opens), so the card's model and numbers are the flight model's
                        presets: PRESETS, droneId: id, mode: 'card', payload: payloadFor(ctx, id), reducedMotion: calm(ctx),
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
                const d = new DronePicker(ctx.ui, session.presetId, { store: ctx.prefs, tune: true, payload, reducedMotion: calm(ctx) });
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
                    // a camera load chosen a moment ago is stored: it reaches the flight model here too (as on close), not at some later close
                    applyModel(ctx.session, ctx.prefs);
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
