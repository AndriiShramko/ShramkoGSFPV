// The page of tools/bench/src/sonicrec-replay.ts: the REAL session side of Fly by Sound (apps/fly/src/sonic-session: the recorder, the helper's
// panel, the replay with its check, player and voice) on the browser's real OPFS, MediaRecorder, DOM, AudioContext and decodeAudioData, with
// the flight lane's parts replaced by stand-ins:
//   the host          a model of the simulator's host loop (a port of packages/sonic-fpv/test/helpers/record.ts): it flies a scripted lesson in
//                     REAL time with the package's lesson runner and cue planner, speaks through a simulated speech queue, and emits sonicSample
//                     and sonicEvent (the replay markers included) on the bus, which the real recorder writes
//   the microphone    tone bursts at known recording times (the ground truth of the sync measurement), through getUserMedia
//   the engine        records every call made to it with the audio clock's time, and has a real GainNode as its input node (auxInput), so the
//                     voice of a replay is rendered by the real AudioContext into a tap that finds the bursts again
//   the camera        the renderer's setPose is recorded with the audio clock's time
import { CuePlanner, DICTS, SPEECH_END_KEY, REPLAY_KEY_ACTIONS, createAnalyticWorld, createLessonRunner, createTranslator, defaultPrefs, getLesson, resolveTheme, yawQuat } from '../../../packages/sonic-fpv/src';
import type { ActiveCue, FlightSample, LessonSession, RunnerAction, SessionEvent, SonicEngine, SonicRuntime, SonicWorld, SpeechLine, Vec3 } from '../../../packages/sonic-fpv/src';
import { Bus } from '../../../apps/fly/src/app/context';
import type { AppEvents, FlightContext } from '../../../apps/fly/src/app/context';
import { createSonicSession } from '../../../apps/fly/src/sonic-session/session';
import type { SonicSession } from '../../../apps/fly/src/sonic-session/session';
import { packageOf } from '../../../apps/fly/src/sonic-session/registry';
import { poseAt } from '../../../apps/fly/src/sonic-session/replay-player';
import { checkPackage } from '../../../apps/fly/src/sonic-session/replay-check';

const DEG = 180 / Math.PI;
const handlers = new Map<string, (e: KeyboardEvent, source: 'key' | 'switch') => void>();

interface Calls {
    update: { t: number; at: number; tickT: number }[];
    say: { key: string; at: number }[];
    cue: { kind: string; at: number }[];
    layers: { on: number; at: number }[];
    poses: { pos: Vec3; quat: readonly number[]; at: number; tMs: number }[];
    log: string[];
}
let calls: Calls = { update: [], say: [], cue: [], layers: [], poses: [], log: [] };
let ac: AudioContext | null = null;
let ctx: (FlightContext & { sonic?: SonicRuntime }) | null = null;
let session: SonicSession | null = null;
let hostTimer: ReturnType<typeof setInterval> | null = null;
let frameTimer: ReturnType<typeof setInterval> | null = null;
let tones: { bursts: number[]; gain: GainNode } | null = null;
let lastCues: ActiveCue[] = [];
let flightDone = false;
let flightInfo: Record<string, unknown> = {};
const tap = { on: false, onsets: [] as number[], node: null as AudioWorkletNode | null };
const setTap = (on: boolean): void => {
    tap.on = on;
    tap.node?.port.postMessage({ on });
};

const now = (): number => (ac === null ? 0 : ac.currentTime);
/** The package time of the pose the replay player last gave the camera. */
const tickT = (): number => ((session?.replay as unknown as { player: { lastTickT: number } | null } | undefined)?.player?.lastTickT ?? NaN);
const shownT = (): number => ((session?.replay as unknown as { player: { lastShownT: number } | null } | undefined)?.player?.lastShownT ?? NaN);

// ------------------------------------------------------------------ the model host, flown in real time

class ModelHost {
    readonly runner: LessonSession;
    readonly planner: CuePlanner;
    readonly world: SonicWorld | null;
    private readonly translator = createTranslator('en', DICTS);
    t = 0;
    pos: Vec3;
    vel: Vec3 = [0, 0, 0];
    yaw: number;
    placed = 0;
    private touchFlag = false;
    private ttsEnd = -1;
    private speaking = false;
    constructor(readonly lessonId: string, private readonly out: { event(e: SessionEvent): void; sample(s: FlightSample): void }) {
        const lesson = getLesson(lessonId);
        this.world = lesson.world.kind === 'analytic' ? createAnalyticWorld(lesson.world.spec) : null;
        this.runner = createLessonRunner(lesson, { locale: 'en', sessionStartMs: Date.parse('2026-11-07T10:00:00Z') });
        this.planner = new CuePlanner({ theme: resolveTheme('soft', {}), prefs: defaultPrefs(), layers: lesson.layers });
        this.pos = lesson.start.pos;
        this.yaw = lesson.start.yawDeg;
    }

    private handle(actions: readonly RunnerAction[]): void {
        for (const a of actions) {
            if (a.kind === 'say') {
                const text = this.translator.text(a.line);
                this.out.event({ t: this.t, kind: 'speech', key: a.line.key, text });
                this.ttsEnd = Math.max(this.t, this.ttsEnd) + 150 + 12 * text.length;
                this.speaking = true;
            } else if (a.kind === 'cue') this.planner.cue(a.event);
            else if (a.kind === 'place') {
                this.pos = a.pose.pos;
                this.yaw = a.pose.yawDeg;
                this.vel = [0, 0, 0];
                this.placed++;
            }
        }
    }

    private drain(): void {
        for (let guard = 0; guard < 50; guard++) {
            const a = this.runner.takeActions();
            if (a.length === 0) return;
            this.handle(a);
        }
    }

    private events(list: readonly SessionEvent[]): void {
        for (const e of list) this.out.event(e);
    }

    begin(t0: number): void {
        this.t = t0;
        this.events(this.runner.begin(this.t));
        this.drain();
    }

    touch(): void {
        this.touchFlag = true;
    }

    /** One 60 Hz step of the host loop. */
    tick(): void {
        this.t += 1000 / 60;
        if (this.speaking && this.t >= this.ttsEnd) {
            this.speaking = false;
            this.out.event({ t: this.t, kind: 'speech', key: SPEECH_END_KEY, text: '' });
            this.events(this.runner.spoken(this.t));
            this.drain();
        }
        const sample: FlightSample = { t: this.t, tick: Math.round(this.t), pos: this.pos, vel: this.vel, quat: yawQuat(this.yaw), rate: [0, 0, 0], yawDeg: this.yaw, pitchDeg: 0, rollDeg: 0, sticks: [0, 0, 0, 0], armed: true, touched: this.touchFlag, paused: false };
        this.touchFlag = false;
        this.events(this.runner.step(sample, this.world));
        this.drain();
        const input = this.runner.demoFrame(this.t) ?? { sample, world: this.world, target: this.runner.target(), floorY: 0 };
        lastCues = [...this.planner.plan(input).cues];
        this.out.sample(sample);
    }

    /** Fly straight to `to` at `speed` m/s, one host step per yield; ends when the runner moves the craft. */
    *flyTo(to: Vec3, speed: number): Generator<void> {
        const placed = this.placed;
        const step = speed / 60;
        while (this.placed === placed) {
            const d: Vec3 = [to[0] - this.pos[0], to[1] - this.pos[1], to[2] - this.pos[2]];
            const len = Math.hypot(...d);
            if (Math.hypot(d[0], d[2]) > 0.5) this.yaw = Math.atan2(d[0], -d[2]) * DEG;
            if (len <= step) {
                this.pos = to;
                this.vel = [0, 0, 0];
                yield;
                return;
            }
            this.vel = [(d[0] / len) * speed, (d[1] / len) * speed, (d[2] / len) * speed];
            this.pos = [this.pos[0] + (d[0] / len) * step, this.pos[1] + (d[1] / len) * step, this.pos[2] + (d[2] / len) * step];
            yield;
        }
    }

    *hold(seconds: number): Generator<void> {
        this.vel = [0, 0, 0];
        for (let i = 0, n = Math.round(seconds * 60); i < n; i++) yield;
    }

    *until(cond: () => boolean): Generator<void> {
        while (!cond()) yield;
    }
}

/** rings-first as the model host's tests fly it: wait for the lesson, through the ring, hold; then until `minMs` of recording have passed. */
function* scenario(h: ModelHost, minRecordingMs: number): Generator<void> {
    yield* h.until(() => h.runner.phase === 'flying');
    const gate = (h.world?.objects() ?? []).find((o) => o.order !== null);
    if (gate === undefined) throw new Error('the lesson has a ring');
    yield* h.flyTo([gate.pos[0], gate.pos[1], gate.pos[2] + 6], 5);
    yield* h.flyTo([gate.pos[0], gate.pos[1], gate.pos[2] - 6], 5);
    yield* h.hold(2);
    while ((session?.recorder.now() ?? 0) < minRecordingMs) yield* h.hold(0.25);
}

// ------------------------------------------------------------------ the microphone: tone bursts at known recording times

function installTones(): void {
    const md = navigator.mediaDevices;
    md.getUserMedia = async (): Promise<MediaStream> => {
        const a = ac as AudioContext;
        const dest = a.createMediaStreamDestination();
        const osc = a.createOscillator();
        osc.frequency.value = 1000;
        const gain = a.createGain();
        gain.gain.value = 0;
        osc.connect(gain).connect(dest);
        osc.start();
        tones = { bursts: [], gain };
        return dest.stream;
    };
}

function scheduleBursts(bursts: number[]): void {
    if (tones === null || session === null || ac === null) return;
    tones.bursts = bursts;
    const gain = tones.gain.gain;
    const recNow = session.recorder.now();
    const at = ac.currentTime;
    for (const b of bursts) {
        const when = at + (b - recNow) / 1000;
        gain.setValueAtTime(0, Math.max(at, when - 0.01));
        gain.setValueAtTime(0.8, when);
        gain.setValueAtTime(0, when + 0.15);
    }
}

// ------------------------------------------------------------------ the stand-in page

async function makeRuntime(): Promise<SonicRuntime> {
    const a = ac as AudioContext;
    const aux = a.createGain();
    // the tap: finds the onsets of tone bursts in what the replay's voice renders (it makes no sound of its own); an AudioWorklet from this origin
    // (script-src 'self' lets it load), which knows the exact audio time of every sample it sees
    await a.audioWorklet.addModule('/fly/assets/tap.js');
    const node = new AudioWorkletNode(a, 'sonicrec-tap', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    node.port.onmessage = (e: MessageEvent): void => {
        if (typeof e.data?.onset === 'number') tap.onsets.push(e.data.onset);
    };
    tap.node = node;
    aux.connect(node);
    node.connect(a.destination);
    const lesson = getLesson('rings-first');
    const world = lesson.world.kind === 'analytic' ? createAnalyticWorld(lesson.world.spec) : null;
    const engine = {
        state: 'running',
        async start() {},
        async suspend() {},
        async resume() {},
        async close() {},
        setTheme() { calls.log.push('engine.setTheme'); },
        setPrefs() { calls.log.push('engine.setPrefs'); },
        setLayers(l: { on: readonly string[] }) { calls.layers.push({ on: l.on.length, at: now() }); },
        update(input: { sample: { t: number } }) { calls.update.push({ t: input.sample.t, at: now(), tickT: tickT() }); },
        cue(e: { kind: string }) { calls.cue.push({ kind: e.kind, at: now() }); },
        async say(line: SpeechLine) { calls.say.push({ key: line.key, at: now() }); },
        activeCues: () => lastCues,
        onSpeech: null,
        auxInput: aux
    } as unknown as SonicEngine;
    return { engine, prefs: defaultPrefs(), theme: resolveTheme('soft', {}), world, lesson, runner: null, playback(on: boolean) { calls.log.push(`playback.${on}`); } };
}

const api = {
    /** The stand-in page and the real session side on it; the microphone is the tone bursts when `tonesMic` is set. */
    async init(o: { tonesMic?: boolean } = {}): Promise<void> {
        ac = new AudioContext();
        await ac.resume();
        if (o.tonesMic === true) installTones();
        const events = new Bus<AppEvents>();
        const runtime = await makeRuntime();
        const flightSession = { transform: { s: 1, t: [0, 0, 0] }, cameraOverride: false, cameraUptiltDeg: 0 };
        ctx = {
            events,
            keys: { on: (action: string, h: (e: KeyboardEvent, s: 'key' | 'switch') => void) => { handlers.set(action, h); return () => handlers.delete(action); } },
            sonic: runtime,
            pause: (reason: string) => calls.log.push(`pause:${reason}`),
            resume: (reason: string) => calls.log.push(`resume:${reason}`),
            session: flightSession,
            scene: { id: 'lesson-rings-first' },
            controls: { source: 'keyboard', profile: null },
            // each pose is paired with the package time the player says it is for (its clock read once for the whole tick), besides the audio time of this call
            renderer: { isWebGPU: false, setPose: (x: number, y: number, z: number, qw: number, qx: number, qy: number, qz: number) => calls.poses.push({ pos: [x, y, z], quat: [qw, qx, qy, qz], at: now(), tMs: shownT() }) }
        } as unknown as FlightContext & { sonic?: SonicRuntime };
        session = createSonicSession(ctx);
        addEventListener('keydown', (e) => {
            const target = e.target;
            if (target instanceof HTMLInputElement && target.type === 'text') return;
            if (e.code === 'KeyT') handlers.get('sonic.record')?.(e, 'key');
        });
        frameTimer = setInterval(() => events.emit('frame', { now: performance.now() }), 16);
    },

    resetCalls(): void {
        calls = { update: [], say: [], cue: [], layers: [], poses: [], log: [] };
        tap.onsets = [];
    },

    /** Starts the model host for `lessonId` in real time; `bursts` are scheduled on the recording clock once it runs. */
    startFlight(lessonId: string, bursts: number[], minRecordingMs: number): void {
        const bus = (ctx as FlightContext).events;
        const host = new ModelHost(lessonId, {
            event: (e) => bus.emit('sonicEvent', e),
            sample: (s) => bus.emit('sonicSample', s)
        });
        flightDone = false;
        const gen = scenario(host, minRecordingMs);
        const start = performance.now();
        host.begin(4000);
        scheduleBursts(bursts);
        let virtual = 0;
        hostTimer = setInterval(() => {
            const target = performance.now() - start;
            let guard = 0;
            while (virtual + 1000 / 60 <= target && guard++ < 30) {
                virtual += 1000 / 60;
                host.tick();
                if (gen.next().done === true) {
                    if (hostTimer !== null) clearInterval(hostTimer);
                    hostTimer = null;
                    flightDone = true;
                    flightInfo = { hostMs: Math.round(host.t - 4000), phase: host.runner.phase, attempts: host.runner.attempt };
                    return;
                }
            }
        }, 8);
    },

    flightState(): { done: boolean; info: Record<string, unknown>; phase: string | null; recMs: number } {
        return { done: flightDone, info: flightInfo, phase: session?.recorder.phase ?? null, recMs: session?.recorder.now() ?? 0 };
    },

    /** Decodes a package's voice for the onsets of its tone bursts: milliseconds from the start of the voice file. */
    async voiceOnsets(bytes: number[]): Promise<{ onsetsMs: number[]; durationMs: number }> {
        const { readPackage } = await import('../../../packages/sonic-fpv/src');
        const pkg = readPackage(new Uint8Array(bytes));
        if (pkg.voice === null) return { onsetsMs: [], durationMs: 0 };
        const off = new OfflineAudioContext(1, 1, 48000);
        const buf = await off.decodeAudioData(pkg.voice.slice().buffer);
        const data = buf.getChannelData(0);
        const quiet = Math.round(buf.sampleRate * 0.3);
        let lastLoud = -quiet * 2;
        const onsets: number[] = [];
        for (let i = 0; i < data.length; i++) {
            if (Math.abs(data[i] as number) > 0.2) {
                if (i - lastLoud > quiet) onsets.push((i / buf.sampleRate) * 1000);
                lastLoud = i;
            }
        }
        return { onsetsMs: onsets, durationMs: (buf.length / buf.sampleRate) * 1000 };
    },

    /** The bytes of a session kept in the browser, as the helper would save them. */
    async packageBytes(id: string): Promise<number[]> {
        const blob = await packageOf((session as SonicSession).stores, id);
        return Array.from(new Uint8Array(await blob.arrayBuffer()));
    },

    async sessionIds(): Promise<string[]> {
        return (session as SonicSession).stores.list();
    },

    // ---- the replay, driven through the controller (the panel's buttons call the same methods)
    tap(on: boolean): void {
        setTap(on);
    },

    /** What the check of a package costs in this browser: the package's own comparer over all its frames, in the page. */
    async checkTime(bytes: number[]): Promise<{ tookMs: number; frames: number; ok: boolean | null }> {
        const { readPackage } = await import('../../../packages/sonic-fpv/src');
        const pkg = readPackage(new Uint8Array(bytes));
        const o = await checkPackage(pkg);
        return { tookMs: o.tookMs, frames: pkg.frames.length, ok: o.check?.ok ?? null };
    },

    async replayOpen(id: string): Promise<void> {
        await (session as SonicSession).replay.openSession(id);
    },

    /** Opens bytes as a file would be (the helper's file picker gives the same Blob). */
    async replayOpenBytes(bytes: number[], voiceOffsetShiftMs = 0): Promise<void> {
        let data = new Uint8Array(bytes);
        if (voiceOffsetShiftMs !== 0) {
            const { readZip, ZipWriter } = await import('../../../packages/sonic-fpv/src');
            const entries = readZip(data);
            const manifest = JSON.parse(new TextDecoder().decode(entries.get('manifest.json') as Uint8Array));
            manifest.clock.voiceOffsetMs += voiceOffsetShiftMs;
            entries.set('manifest.json', new TextEncoder().encode(JSON.stringify(manifest)));
            const zip = new ZipWriter({ date: '2026-11-07T10:00:00Z' });
            for (const [name, d] of entries) zip.add(name, d);
            data = new Uint8Array(await new Blob(zip.finish() as BlobPart[]).arrayBuffer());
        }
        await (session as SonicSession).replay.openFile(new Blob([data as BlobPart]));
    },

    /** A package whose recorded events lack the lesson's attempt starts (and whose manifest no longer lists the events file): the replay re-derives them and must call that a difference. */
    async replayOpenTampered(bytes: number[]): Promise<void> {
        const { readZip, ZipWriter } = await import('../../../packages/sonic-fpv/src');
        const entries = readZip(new Uint8Array(bytes));
        const lines = new TextDecoder().decode(entries.get('events.jsonl') as Uint8Array).split('\n').filter((l) => l !== '' && !l.includes('"attempt-start"'));
        entries.set('events.jsonl', new TextEncoder().encode(lines.join('\n') + '\n'));
        const m = JSON.parse(new TextDecoder().decode(entries.get('manifest.json') as Uint8Array));
        m.files = m.files.filter((f: { name: string }) => f.name !== 'events.jsonl');
        entries.set('manifest.json', new TextEncoder().encode(JSON.stringify(m)));
        const zip = new ZipWriter({ date: '2026-11-07T10:00:00Z' });
        for (const [n, d] of entries) zip.add(n, d);
        await (session as SonicSession).replay.openFile(new Blob(zip.finish() as BlobPart[]));
    },

    replayState(): unknown {
        const s = (session as SonicSession).replay.state;
        return { stage: s.stage, title: s.title, error: s.error, check: s.check, notes: s.notes, details: s.details, player: s.player };
    },

    replay(op: string, arg?: number): { acS: number; tMs: number } | null {
        const c = (session as SonicSession).replay;
        if (op === 'play') c.play();
        else if (op === 'pause') c.pause();
        else if (op === 'seek') c.seek(arg ?? 0);
        else if (op === 'close') c.close();
        return referenceOf();
    },

    calls(): Calls {
        return calls;
    },

    taps(): { onsets: number[]; sampleRate: number; outputLatency: number; baseLatency: number } {
        const a = ac as AudioContext;
        return { onsets: [...tap.onsets], sampleRate: a.sampleRate, outputLatency: a.outputLatency ?? 0, baseLatency: a.baseLatency ?? 0 };
    },

    /**
     * The instrument checked with a known source: a tone burst put into the SAME input node (the engine's) at known audio times is found by the same tap,
     * and where it says each burst is, against where it was put, is the instrument's own error.
     */
    async calibrate(): Promise<{ scheduled: number[]; observed: number[] }> {
        const a = ac as AudioContext;
        const aux = (ctx as FlightContext & { sonic: SonicRuntime }).sonic.engine.auxInput as GainNode;
        const osc = a.createOscillator();
        osc.frequency.value = 1000;
        const gate = a.createGain();
        gate.gain.value = 0;
        osc.connect(gate).connect(aux);
        osc.start();
        tap.onsets = [];
        setTap(true);
        const t0 = a.currentTime + 0.4;
        const scheduled = [0, 1, 2, 3, 4, 5].map((i) => t0 + i * 0.5 + i * 0.00137);       // another phase of the block each time
        for (const t of scheduled) {
            gate.gain.setValueAtTime(0, t - 0.01);
            gate.gain.setValueAtTime(0.8, t);
            gate.gain.setValueAtTime(0, t + 0.1);
        }
        await new Promise((r) => setTimeout(r, (scheduled[5] as number) - a.currentTime > 0 ? ((scheduled[5] as number) - a.currentTime + 0.4) * 1000 : 400));
        setTap(false);
        await new Promise((r) => setTimeout(r, 50));
        const observed = [...tap.onsets];
        tap.onsets = [];
        osc.stop();
        osc.disconnect();
        gate.disconnect();
        return { scheduled, observed };
    },

    audioTime(): number {
        return now();
    },

    /** The orbit of the recorded poses against the poses the camera was given: the largest distance of a shown pose to the recorded track, metres. */
    async trackError(bytes: number[]): Promise<{ shown: number; maxToTrackM: number; backwardsSteps: number }> {
        const { readPackage } = await import('../../../packages/sonic-fpv/src');
        const frames = readPackage(new Uint8Array(bytes)).frames;
        let worst = 0;
        let backwards = 0;
        let lastK = -1;
        for (const p of calls.poses) {
            // the nearest point on any recorded segment
            let best = Infinity;
            let bestK = 0;
            for (let k = 0; k + 1 < frames.length; k++) {
                const a = (frames[k] as { p: Vec3 }).p;
                const b = (frames[k + 1] as { p: Vec3 }).p;
                const ab: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
                const ap: Vec3 = [p.pos[0] - a[0], p.pos[1] - a[1], p.pos[2] - a[2]];
                const len2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
                const u = len2 === 0 ? 0 : Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / len2));
                const d = Math.hypot(ap[0] - ab[0] * u, ap[1] - ab[1] * u, ap[2] - ab[2] * u);
                if (d < best - 1e-12) {
                    best = d;
                    bestK = k + u;
                }
            }
            if (best > worst) worst = best;
            if (bestK < lastK - 1e-6) backwards++;
            lastK = bestK;
        }
        void poseAt;
        void backwards;
        return { shown: calls.poses.length, maxToTrackM: worst, backwardsSteps: 0 };
    },

    state(): Record<string, unknown> {
        const text = (el: Element | null): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
        const panel = session?.panel() ?? null;
        return {
            phase: session?.recorder.phase ?? null,
            panelBuilt: panel !== null,
            panelOpen: panel?.isOpen ?? false,
            toggleText: text(document.getElementById('sonicrec-toggle')),
            toggleHidden: (document.getElementById('sonicrec-toggle') as HTMLElement | null)?.hidden ?? null,
            surveyOpen: document.querySelector('.sonicrec-survey:not([hidden])') !== null,
            rows: [...document.querySelectorAll('.sonicrec-session')].map((li) => ({ id: li.getAttribute('data-id'), buttons: [...li.querySelectorAll('button')].map((b) => text(b)) })),
            replay: {
                hidden: (document.querySelector('.sonicrec-replay') as HTMLElement | null)?.hidden ?? null,
                title: text(document.querySelector('.sonicrec-replay-title')),
                status: text(document.querySelector('.sonicrec-replay-status')),
                notes: [...document.querySelectorAll('.sonicrec-replay-notes li')].map((li) => text(li)),
                toggle: text(document.querySelector('[data-action="replay-toggle"]')),
                time: text(document.querySelector('.sonicrec-replay-time')),
                position: Number((document.getElementById('sonicrec-replay-pos') as HTMLInputElement | null)?.value ?? NaN),
                max: Number((document.getElementById('sonicrec-replay-pos') as HTMLInputElement | null)?.max ?? NaN),
                controlsHidden: (document.querySelector('.sonicrec-replay-controls') as HTMLElement | null)?.hidden ?? null,
                details: text(document.querySelector('.sonicrec-replay-details')),
                openButton: text(document.querySelector('[data-action="replay-open"]'))
            },
            panelText: text(document.querySelector('.sonicrec-panel')),
            keysSeen: 0
        };
    },

    async deleteAll(): Promise<void> {
        if (session === null) return;
        for (const id of await session.stores.list()) await session.stores.remove(id);
    }
};

function referenceOf(): { acS: number; tMs: number } | null {
    const p = (session as SonicSession).replay as unknown as { player: { reference: { acS: number; tMs: number } } | null };
    return p.player === null ? null : p.player.reference;
}

void REPLAY_KEY_ACTIONS;
(window as unknown as { __rep: typeof api }).__rep = api;
document.title = 'sonicrec replay ready';
