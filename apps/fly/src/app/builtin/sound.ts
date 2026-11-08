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
// Fly by Sound (v0.12, docs/wip/v12-plan.md 2.2): on a page entered through ?sonic= (sonic/entry.ts) the sound engine owns
// the one AudioContext. The motors are off there unless the pilot's sound settings ask for them (SonicPrefs.motorSound,
// default off: they mask the cues), and when on they play into the engine's input node (SonicEngine.auxInput), through
// its limiter, on its context; sound.motors is not read (the engine's setting decides), the level is sound.volume as ever,
// and no context of this feature's own is made.
import { S } from '@gsfpv/sim-core';
import { t } from '../../i18n';
import { h } from '../../ui/dom';
import { PRESETS } from '../../presets';
import { MotorSound, bladesOf, motorMix } from '../../audio/motor-sound';
import type { AudioLike, Mix, MotorState, NodeLike } from '../../audio/motor-sound';
import type { Feature, FlightContext } from '../context';
import { sonicEntry } from '../../sonic/entry-state';

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
        /** The page was entered through ?sonic=: the engine's sound settings decide, the engine's context is the one. */
        const inMode = (): boolean => sonicEntry() !== null;
        const enabled = (): boolean => (inMode() ? ctx.sonic?.prefs.motorSound === true : ctx.prefs.get<boolean>('sound.motors') !== false);
        /** Flips the motors: the engine's setting in the mode (it is saved with the pilot's sound settings), else sound.motors. */
        const toggle = (): void => {
            if (inMode()) {
                sonicEntry()?.setup.update({ motorSound: !enabled() });
                drawSpeaker();
            } else ctx.prefs.set('sound.motors', !enabled());
        };
        const presetBlades = (): number => bladesOf(PRESETS[ctx.session.presetId]?.fields.prop?.value);

        /** Builds the graph (inside a click or a key, or after one): Web Audio missing, nothing happens. */
        const start = (): void => {
            if (graph || !enabled()) return;
            if (inMode()) {
                startOnEngine();
                return;
            }
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
        /** In the mode: the graph on the engine's context, into its input node (null until the engine has started). */
        const startOnEngine = (): void => {
            const aux = ctx.sonic?.engine.auxInput as ({ context?: unknown } & object) | null | undefined;
            if (!aux?.context) return;
            try {
                blades = presetBlades();
                graph = new MotorSound(aux.context as AudioLike, blades, aux as unknown as NodeLike);
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
            // in the mode the engine comes up (and the pilot may turn the motors on) after this feature installed
            if (!graph && inMode() && enabled()) start();
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
            if (document.visibilityState === 'hidden') {
                // a context that is the engine's is not put to sleep here: the motors fall silent by their own mix
                graph.apply(last = motorMix({ state: motorState(ctx), paused, hidden: true, enabled: enabled(), volume: ctx.prefs.get<number>('sound.volume') }));
                void graph.suspend().catch(() => undefined);
            } else if (enabled()) void graph.resume().catch(() => undefined);
        });
        ctx.prefs.onChange((c) => {
            if (c.id !== 'sound.motors' || inMode()) return;
            if (!enabled()) { if (graph) void graph.suspend().catch(() => undefined); }
            else if (graph) void graph.resume().catch(() => undefined);
            else start();
        });

        ctx.menu.add({
            id: 'pause.sound', action: null, labelKey: 'sound.menu', order: 104, section: 'tools',
            run: () => toggle(),
            label: () => t(enabled() ? 'sound.menu.on' : 'sound.menu.off')
        });

        // v0.8 (the owner's message 21, item 3): the quick mute on the top bar, one tap on a phone
        // (no keyboard there) and one click on a computer; it flips sound.motors like the pause menu
        const speakerBtn = h('button', { type: 'button', class: 'btn icon speaker', 'data-action': 'sound-toggle', onclick: () => toggle() });
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
