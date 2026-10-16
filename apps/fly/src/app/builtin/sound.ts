// The motor sound in a flight (v0.7 lane D1; docs/wip/v07-d1.md section 4). ../../audio/motor-sound.ts
// makes it; this feature owns its AudioContext and feeds it the flight model once a frame.
//  - The browser lets a page make sound only after a click or a key press (a gamepad or radio is
//    not a user activation): the context is made at the first one, or at once when the page had one
//    already (the scene card, the Fly button).
//  - Each frame: motorMix() of sim-core's motor outputs, pack voltage and airspeed (read, never
//    written: the A6 hash and the input path are untouched), the pause, the tab, the settings.
//  - Silent when disarmed, crashed, paused, in a menu, the tab hidden, or sound.motors off; the
//    context sleeps while the tab is hidden or the sound is off.
//  - The pause menu's "Motor sound: on / off" and the speaker on the top bar (v0.8) flip sound.motors;
//    Settings -> Sound has it and the volume (15 % by default since v0.8: prefs defs/sound.ts).
// Not in recordings (the recorder writes video only).
import { S } from '@gsfpv/sim-core';
import { t } from '../../i18n';
import { h } from '../../ui/dom';
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

/**
 * A speaker drawn as SVG (an emoji glyph turns colourful on some systems, see top.ts's gear): with
 * sound waves when the motors are heard, crossed out when the sound is off.
 */
function speakerIcon(on: boolean): SVGSVGElement {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '20');
    svg.setAttribute('height', '20');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const body = document.createElementNS(NS, 'path');
    body.setAttribute('fill', 'currentColor');
    body.setAttribute('d', 'M4 9h4l5-4v14l-5-4H4z');
    const mark = document.createElementNS(NS, 'path');
    mark.setAttribute('fill', 'none');
    mark.setAttribute('stroke', 'currentColor');
    mark.setAttribute('stroke-width', '2');
    mark.setAttribute('stroke-linecap', 'round');
    mark.setAttribute('d', on ? 'M16 9.5a3.5 3.5 0 0 1 0 5M18.5 7a7 7 0 0 1 0 10' : 'M16 9l5 6M21 9l-5 6');
    svg.append(body, mark);
    return svg;
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

/** The motor sound in a flight: its AudioContext, started at the first click or key, fed once a frame. */
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

        // v0.8 (the owner's message 21, item 3): the quick mute on the top bar, one tap on a phone
        // (no keyboard there) and one click on a computer; it flips sound.motors like the pause menu
        const speakerBtn = h('button', { type: 'button', class: 'btn icon speaker', 'data-action': 'sound-toggle', onclick: () => ctx.prefs.set('sound.motors', !enabled()) });
        const drawSpeaker = (): void => {
            const on = enabled();
            const label = t(on ? 'sound.menu.on' : 'sound.menu.off');
            speakerBtn.setAttribute('aria-label', label);
            speakerBtn.title = label;
            speakerBtn.setAttribute('aria-pressed', String(!on));
            speakerBtn.classList.toggle('muted', !on);
            speakerBtn.replaceChildren(speakerIcon(on));
        };
        drawSpeaker();
        // the row is built by the top-actions feature, installed before this one: first in the row
        ctx.ui.querySelector(':scope > .top-actions')?.prepend(speakerBtn);
        ctx.prefs.onChange((c) => { if (c.id === 'sound.motors') drawSpeaker(); });
        ctx.hook.sound = () => ({ context: graph ? graph.ac.state : null, mix: last, blades });
    }
};
