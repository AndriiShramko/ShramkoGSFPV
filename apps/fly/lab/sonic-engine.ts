// Lab page for the sound engine in the page (v0.12 lane v12-flight step 7, docs/wip/v12-plan.md 4.2): the real
// SonicSetup (the one AudioContext made by a click, the sound package's engine, the captions region, the saved
// settings) with no flight: a Start button, a synthetic frame loop in the walls-hall world, the motor sound plugged into
// the engine's input node. /fly/lab/sonic-engine.html on the dev server (not in the production inputs of vite.config.ts);
// window.__engineLab is what tools/bench/src/sonic-engine-probe.ts drives, and it measures the output through the tap
// the probe installs before the page loads (window.__tap, a node in front of the destination).
import { MemoryBackend, PrefsStore, SCHEMA } from '@gsfpv/prefs';
import { createAnalyticWorld, getLesson } from '@shramko/sonic-fpv';
import type { AnalyticWorldSpec, LessonLayers, SpeechLine } from '@shramko/sonic-fpv';
import { locale } from '../src/i18n';
import { Captions } from '../src/sonic/captions';
import { SonicSetup } from '../src/sonic/entry';
import { MotorSound, motorMix } from '../src/audio/motor-sound';
import type { AudioLike, NodeLike } from '../src/audio/motor-sound';

const store = new PrefsStore(SCHEMA, new MemoryBackend(), { field: () => undefined, curatedScale: () => undefined, curated: () => undefined }, { debounceMs: 0 });
const captions = new Captions();
const setup = new SonicSetup(store, locale, captions);
const spec = (getLesson('walls-hall').world as { spec: AnalyticWorldSpec }).spec;
const world = createAnalyticWorld(spec);

document.getElementById('start')!.addEventListener('click', () => {
    // the press itself: the context, the speech unlock and the engine start are made inside it
    void setup.audio.start();
});

let timer: ReturnType<typeof setInterval> | undefined;
let t = 0;
/** Frames at 62 Hz of a craft 3 m from the front wall closing at 3 m/s (the wall's pulses are the sound), or none. */
function frames(on: boolean, o: { z?: number; vz?: number } = {}): void {
    clearInterval(timer);
    timer = undefined;
    if (!on) return;
    timer = setInterval(() => {
        t += 16;
        setup.audio.engine.update({
            sample: { t, tick: t, pos: [0, 1.5, o.z ?? -27], vel: [0, 0, o.vz ?? -3], quat: [1, 0, 0, 0], rate: [0, 0, 0], yawDeg: 0, pitchDeg: 0, rollDeg: 0, sticks: [0, 0, 0, 0], armed: true, touched: false, paused: false },
            world,
            target: null,
            floorY: 0
        });
    }, 16);
}

let motor: MotorSound | null = null;
let osc: OscillatorNode | null = null;

(window as unknown as { __engineLab: unknown }).__engineLab = {
    ready: true,
    state: () => ({ engine: setup.audio.engine.state, ac: setup.audio.ac ? (setup.audio.ac as unknown as { state: string }).state : null, currentTime: setup.audio.ac?.currentTime ?? null, available: setup.audio.available, auxReady: setup.audio.engine.auxInput !== null }),
    frames,
    setLayers: (l: LessonLayers) => setup.audio.engine.setLayers(l),
    say: (line: SpeechLine, interrupt = false) => void setup.audio.engine.say(line, { interrupt }),
    update: (patch: Record<string, unknown>) => setup.update(patch as never),
    prefs: () => setup.prefs,
    captionLines: () => captions.lines(),
    captionRoot: () => ({ live: captions.root.getAttribute('aria-live'), hidden: captions.root.hidden, srOnly: captions.root.classList.contains('sonic-sr-only'), label: captions.root.getAttribute('aria-label'), role: captions.root.getAttribute('role') }),
    activeCues: () => setup.audio.engine.activeCues().map((c) => c.id),
    /** a loud sine into the engine's input node (through its limiter), or straight to the destination (the control) */
    loud(into: 'aux' | 'destination' | 'off'): void {
        osc?.stop();
        osc?.disconnect();
        osc = null;
        if (into === 'off') return;
        const ac = (setup.audio.ac as unknown as AudioContext);
        osc = ac.createOscillator();
        osc.frequency.value = 440;
        const g = ac.createGain();
        g.gain.value = 8;
        osc.connect(g);
        g.connect(into === 'aux' ? (setup.audio.engine.auxInput as AudioNode) : ac.destination);
        osc.start();
        (osc as unknown as { __g: GainNode }).__g = g;
    },
    /** the simulated motors on the engine's input node (as app/builtin/sound.ts does in the mode) */
    motor(on: boolean): void {
        if (!on) {
            void motor?.close();
            motor = null;
            return;
        }
        const aux = setup.audio.engine.auxInput as AudioNode;
        motor = new MotorSound(aux.context as unknown as AudioLike, 3, aux as unknown as NodeLike);
        motor.apply(motorMix({ state: { motors: [0.55, 0.57, 0.54, 0.56], volt: 11.4, omegaMaxPerVolt: 400, armed: true, crashed: false, speed: 3 }, paused: false, hidden: false, enabled: true, volume: 60 }));
    }
};
