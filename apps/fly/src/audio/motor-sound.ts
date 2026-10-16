// The drone's motor sound (v0.7 lane D1; a pilot's idea from Telegram: "an option to have the drone's
// working sound, flying is nicer then"). Procedural Web Audio from the simulated motors:
//  - one voice per motor: an oscillator at the rotor's turning frequency with its harmonics, the
//    blade-pass harmonic (3 on a 3-blade prop) the strongest, so the four motors beat against each
//    other the way a real quad's do when they run at different speeds;
//  - prop wash: looped noise through a band-pass whose centre follows the mean rotor speed, louder
//    with thrust and with airspeed.
// The rotor's frequency is the model's own: motor output (0..1, sim-core S.m0..m3) x KV-derived
// rad/s per volt (SimParams.omegaMaxPerVolt) x the pack voltage / 2 pi.
//
// It only reads the flight model once a frame (app/builtin/sound.ts) and never writes it, so the
// simulation stays deterministic (the A6 hash) and the stick-to-motor path is untouched. Silent
// (master gain 0) when disarmed, crashed, paused or in a menu, on a hidden tab, or switched off.
//
// motorMix() is pure (no Web Audio, no DOM): what every gain and frequency should be now.
// MotorSound builds the graph on an AudioContext the caller makes (a fake one in the tests,
// tools/bench/test/flight-ux.test.ts) and glides the params toward a mix.

/** The flight model's numbers the sound follows (read from sim-core's state each frame). */
export interface MotorState {
    /** the four motor outputs after the motor lag, 0..1 (S.m0..S.m3) */
    motors: readonly number[];
    /** the pack's loaded voltage, V (S.volt) */
    volt: number;
    /** rotor speed per volt at full output, rad/s/V (SimParams.omegaMaxPerVolt) */
    omegaMaxPerVolt: number;
    armed: boolean;
    crashed: boolean;
    /** airspeed, m/s */
    speed: number;
}

/** Everything the mix depends on: the model (null before a flight model exists) and the page. */
export interface MixInput {
    state: MotorState | null;
    /** the flight is paused (the pause menu, a panel, the picker over the flight) */
    paused: boolean;
    /** the tab is hidden */
    hidden: boolean;
    /** sound.motors */
    enabled: boolean;
    /** sound.volume, 0..100 */
    volume: number;
}

/** One motor's voice: its fundamental (Hz) and its gain (before the master). */
export interface Voice { freq: number; gain: number }

/** Target values of every param of the graph. */
export interface Mix {
    /** the master gain: 0 is silence */
    master: number;
    voices: Voice[];
    /** the prop wash: its gain and the band-pass centre (Hz) */
    wash: { gain: number; freq: number };
}

/** The master gain at volume 100: the voices and the wash add up to at most about 1.4, so full throttle stays under clipping. */
export const MASTER_MAX = 0.7;
/** The audible band a voice's fundamental is kept in: its lowest frequency, Hz. */
export const VOICE_MIN_HZ = 25;
/** The audible band a voice's fundamental is kept in: its highest frequency, Hz. */
export const VOICE_MAX_HZ = 3000;

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const TWO_PI = 2 * Math.PI;

/** The rotor's turning frequency (Hz) at motor output `m` (0..1). */
export function rotorHz(m: number, s: Pick<MotorState, 'volt' | 'omegaMaxPerVolt'>): number {
    return (clamp(m, 0, 1) * s.omegaMaxPerVolt * Math.max(0, s.volt)) / TWO_PI;
}

/** True when the motors should be heard: armed, not crashed, flying, the tab shown, switched on. */
export function audible(i: MixInput): boolean {
    return !!i.state && i.enabled && !i.paused && !i.hidden && i.state.armed && !i.state.crashed && i.volume > 0;
}

/** What every param should be now. */
export function motorMix(i: MixInput): Mix {
    const st = i.state;
    const vol = clamp(i.volume, 0, 100) / 100;
    // a slider that sounds even: loudness grows faster than the amplitude (40 % is about -15 dB, the default 15 % about -28 dB)
    const master = audible(i) ? Math.pow(vol, 1.5) * MASTER_MAX : 0;
    const voices: Voice[] = [0, 1, 2, 3].map((k) => {
        const m = st ? clamp(st.motors[k] ?? 0, 0, 1) : 0;
        return { freq: st ? clamp(rotorHz(m, st), VOICE_MIN_HZ, VOICE_MAX_HZ) : VOICE_MIN_HZ, gain: 0.18 * Math.pow(m, 0.8) };
    });
    const mean = st ? st.motors.slice(0, 4).reduce((a, b) => a + clamp(b, 0, 1), 0) / 4 : 0;
    const meanHz = st ? rotorHz(mean, st) : 0;
    const air = st ? clamp(st.speed / 25, 0, 1) : 0;
    return {
        master,
        voices,
        wash: { gain: 0.45 * mean * mean + 0.25 * air * air, freq: clamp(400 + 2.2 * meanHz, 300, 6000) }
    };
}

/** The blade count a preset's prop text names ("Gemfan 2218, 3-blade"), else 3 (most whoops). */
export function bladesOf(prop: unknown): number {
    const m = typeof prop === 'string' ? /(\d+)\s*-?\s*blade/i.exec(prop) : null;
    const n = m ? Number(m[1]) : 3;
    return n >= 2 && n <= 8 ? n : 3;
}

/**
 * The harmonic amplitudes of a rotor's voice (index 1 = the fundamental): the blade-pass harmonic
 * and its double carry the tone, the turning frequency itself a little hum, a few others fill it.
 */
export function voiceHarmonics(blades: number): Float32Array {
    const n = blades * 2 + 2;
    const a = new Float32Array(n + 1);
    for (let k = 1; k <= n; k++) a[k] = 0.12 / k;
    a[1] = 0.35;
    a[blades] = 1;
    a[blades * 2] = 0.45;
    return a;
}

// ------------------------------------------------------------------ the graph

/** An AudioParam as this module drives it. */
export interface ParamLike { value: number; setTargetAtTime(v: number, startTime: number, timeConstant: number): unknown }
/** A node as this module wires it. */
export interface NodeLike { connect(to: NodeLike): unknown; disconnect(): void }
/** A GainNode as this module uses it (the master, each voice, the wash). */
export interface GainLike extends NodeLike { gain: ParamLike }
/** An OscillatorNode as this module uses it: one per motor, its wave the rotor's harmonics. */
export interface OscLike extends NodeLike { frequency: ParamLike; setPeriodicWave(w: unknown): void; start(): void; stop(): void }
/** A BiquadFilterNode as this module uses it: the band-pass over the prop-wash noise. */
export interface FilterLike extends NodeLike { type: string; frequency: ParamLike; Q: ParamLike }
/** An AudioBuffer as this module fills it: the looped noise. */
export interface BufferLike { getChannelData(c: number): Float32Array }
/** An AudioBufferSourceNode as this module uses it: the noise, looped. */
export interface SourceLike extends NodeLike { buffer: unknown; loop: boolean; start(): void; stop(): void }
/** The part of an AudioContext this module uses (a real one, or the tests' fake). */
export interface AudioLike {
    readonly currentTime: number;
    readonly sampleRate: number;
    readonly state: string;
    readonly destination: NodeLike;
    createGain(): GainLike;
    createOscillator(): OscLike;
    createBiquadFilter(): FilterLike;
    createBuffer(channels: number, length: number, rate: number): BufferLike;
    createBufferSource(): SourceLike;
    createPeriodicWave(real: Float32Array, imag: Float32Array, o?: { disableNormalization: boolean }): unknown;
    resume(): Promise<void>;
    suspend(): Promise<void>;
    close(): Promise<void>;
}

/** How fast params glide to a new target (s): smooth, and a stop is heard within a frame or two. */
const GLIDE_S = 0.03;

/**
 * The motor sound's Web Audio graph on one AudioContext: four motor voices and the prop wash into a
 * master gain, built once (started silent). app/builtin/sound.ts owns it and calls apply() with
 * motorMix() of the flight model every frame; close() ends it for good.
 */
export class MotorSound {
    private master: GainLike;
    private oscs: OscLike[] = [];
    private gains: GainLike[] = [];
    private wash: GainLike;
    private band: FilterLike;
    private noise: SourceLike;
    private closedNow = false;

    /** Builds the graph on `ac` and starts its sources (silent: the master starts at 0). */
    constructor(readonly ac: AudioLike, blades = 3) {
        this.master = ac.createGain();
        this.master.gain.value = 0;
        this.master.connect(ac.destination);
        const h = voiceHarmonics(blades);
        const wave = ac.createPeriodicWave(new Float32Array(h.length), h, { disableNormalization: false });
        for (let k = 0; k < 4; k++) {
            const o = ac.createOscillator();
            o.setPeriodicWave(wave);
            o.frequency.value = VOICE_MIN_HZ;
            const g = ac.createGain();
            g.gain.value = 0;
            o.connect(g);
            g.connect(this.master);
            o.start();
            this.oscs.push(o);
            this.gains.push(g);
        }
        // two seconds of white noise, looped
        const len = Math.max(1, Math.round(ac.sampleRate * 2));
        const buf = ac.createBuffer(1, len, ac.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        this.noise = ac.createBufferSource();
        this.noise.buffer = buf;
        this.noise.loop = true;
        this.band = ac.createBiquadFilter();
        this.band.type = 'bandpass';
        this.band.Q.value = 0.9;
        this.wash = ac.createGain();
        this.wash.gain.value = 0;
        this.noise.connect(this.band);
        this.band.connect(this.wash);
        this.wash.connect(this.master);
        this.noise.start();
    }

    get closed(): boolean {
        return this.closedNow;
    }

    /** Glides every param toward `m` (called once a frame). */
    apply(m: Mix): void {
        if (this.closedNow) return;
        const t = this.ac.currentTime;
        this.master.gain.setTargetAtTime(m.master, t, GLIDE_S);
        for (let k = 0; k < 4; k++) {
            const v = m.voices[k];
            if (!v) continue;
            this.oscs[k].frequency.setTargetAtTime(v.freq, t, GLIDE_S);
            this.gains[k].gain.setTargetAtTime(v.gain, t, GLIDE_S);
        }
        this.wash.gain.setTargetAtTime(m.wash.gain, t, GLIDE_S);
        this.band.frequency.setTargetAtTime(m.wash.freq, t, GLIDE_S);
    }

    /** The context runs (after a click or a key: the browser's rule). */
    resume(): Promise<void> {
        return this.closedNow ? Promise.resolve() : this.ac.resume();
    }

    /** The context sleeps (a hidden tab, the sound switched off): no audio work at all. */
    suspend(): Promise<void> {
        return this.closedNow ? Promise.resolve() : this.ac.suspend();
    }

    /** Stops every source and closes the context; nothing plays or runs after this. */
    async close(): Promise<void> {
        if (this.closedNow) return;
        this.closedNow = true;
        for (const o of this.oscs) { try { o.stop(); } catch { /* never started */ } o.disconnect(); }
        try { this.noise.stop(); } catch { /* never started */ }
        this.noise.disconnect();
        this.master.disconnect();
        await this.ac.close();
    }
}
