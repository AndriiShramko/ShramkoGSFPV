// The motor sound in a flight (v0.7 lane D1; docs/wip/v07-d1.md section 4). ../../audio/motor-sound.ts
// makes it; this feature owns its AudioContext and feeds it the flight model once a frame.
//  - The browser lets a page make sound only after a click or a key press (a gamepad or radio is
//    not a user activation): the context is made at the first one, or at once when the page had one
//    already (the scene card, the Fly button).
//  - Each frame: motorMix() of sim-core's motor outputs, pack voltage and airspeed (read, never
//    written: the A6 hash and the input path are untouched), the pause, the tab, the settings.
//  - Silent when disarmed, crashed, paused, in a menu, the tab hidden, or sound.motors off; the
//    context sleeps while the tab is hidden or the sound is off.
//  - The pause menu's "Motor sound: on / off" flips sound.motors; Settings -> Sound has it and the volume.
// Not in recordings (the recorder writes video only).
import { S } from '@gsfpv/sim-core';
import { t } from '../../i18n';
import { PRESETS } from '../../presets';
import { MotorSound, bladesOf, motorMix } from '../../audio/motor-sound';
import type { AudioLike, Mix, MotorState } from '../../audio/motor-sound';
import type { Feature, FlightContext } from '../context';

// window.__gsfpv.sound: the graph's state and the last mix, for the acceptance
declare module '../test-hook' {
    interface TestHook {
        sound?: () => { context: string | null; mix: Mix | null; blades: number };
    }
}

/** The flight model's numbers the sound follows, or null before there is one. */
function motorState(ctx: FlightContext): MotorState | null {
    const sim = ctx.session?.sim;
    if (!sim) return null;
    const s = sim.s;
    return {
        motors: [s[S.m0], s[S.m0 + 1], s[S.m0 + 2], s[S.m0 + 3]],
        volt: s[S.volt],
        omegaMaxPerVolt: sim.p.omegaMaxPerVolt,
        armed: sim.armed,
        crashed: sim.crashed,
        speed: Math.hypot(s[S.vx], s[S.vy], s[S.vz])
    };
}

export const sound: Feature = {
    id: 'sound',
    install(ctx) {
        let graph: MotorSound | null = null;
        let blades = 3;
        let paused = false;
        let last: Mix | null = null;
        const enabled = (): boolean => ctx.prefs.get<boolean>('sound.motors') !== false;
        const presetBlades = (): number => bladesOf(PRESETS[ctx.session.presetId]?.fields.prop?.value);

        /** Builds the graph (inside a click or a key, or after one): Web Audio missing, nothing happens. */
        const start = (): void => {
            if (graph || !enabled()) return;
            const Ctor = (globalThis as { AudioContext?: new (o?: AudioContextOptions) => AudioContext }).AudioContext;
            if (!Ctor) return;
            try {
                blades = presetBlades();
                graph = new MotorSound(new Ctor({ latencyHint: 'interactive' }) as unknown as AudioLike, blades);
                void graph.resume().catch(() => undefined);
            } catch (e) {
                console.warn('motor sound', e);
                graph = null;
            }
        };
        const onGesture = (): void => {
            start();
            // keyboard flying presses keys all the time: only a sleeping context is woken
            if (graph && graph.ac.state !== 'running' && enabled() && document.visibilityState === 'visible') void graph.resume().catch(() => undefined);
        };
        addEventListener('pointerdown', onGesture, { capture: true });
        addEventListener('keydown', onGesture, { capture: true });
        if ((navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive) start();

        ctx.events.on('frame', () => {
            if (!graph) return;
            last = motorMix({ state: motorState(ctx), paused, hidden: document.visibilityState === 'hidden', enabled: enabled(), volume: ctx.prefs.get<number>('sound.volume') });
            graph.apply(last);
        });
        ctx.events.on('pause', ({ on }) => {
            paused = on;
            // at once, not at the next frame: a paused page may draw none
            if (graph) graph.apply(last = motorMix({ state: motorState(ctx), paused, hidden: document.visibilityState === 'hidden', enabled: enabled(), volume: ctx.prefs.get<number>('sound.volume') }));
        });
        // another drone or scene: the prop's blade count may differ (the harmonics are built with the graph)
        const rebuildForProp = (): void => {
            if (graph && presetBlades() !== blades) {
                void graph.close();
                graph = null;
                start();
            }
        };
        ctx.events.on('session', rebuildForProp);
        ctx.events.on('life', rebuildForProp);
        document.addEventListener('visibilitychange', () => {
            if (!graph) return;
            if (document.visibilityState === 'hidden') void graph.suspend().catch(() => undefined);
            else if (enabled()) void graph.resume().catch(() => undefined);
        });
        ctx.prefs.onChange((c) => {
            if (c.id !== 'sound.motors') return;
            if (!enabled()) { if (graph) void graph.suspend().catch(() => undefined); }
            else if (graph) void graph.resume().catch(() => undefined);
            else start();
        });

        ctx.menu.add({
            id: 'pause.sound', action: null, labelKey: 'sound.menu', order: 104, section: 'tools',
            run: () => ctx.prefs.set('sound.motors', !enabled()),
            label: () => t(enabled() ? 'sound.menu.on' : 'sound.menu.off')
        });
        ctx.hook.sound = () => ({ context: graph ? graph.ac.state : null, mix: last, blades });
    }
};
