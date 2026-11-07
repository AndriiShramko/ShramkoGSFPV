// The page of tools/bench/src/sonicrec-recorder.ts: the REAL recorder of Fly by Sound's session side
// (apps/fly/src/sonic-session) on the browser's real OPFS and real MediaRecorder, with the two things the flight lane has
// not built yet replaced by stand-ins: the sound mode's runtime (ctx.sonic, a lesson in its analytic world, an engine that
// records what it says) and the flight's samples (synthetic, at the rate of a display). A key T press does what it does
// in the simulator: the page's keydown handler calls recorder.pressRecord() inside the key press.
// Bundled by esbuild and served under the live headers by tools/bench/scripts/serve-csp.mjs.
import { createAnalyticWorld, defaultPrefs, getLesson, packSession, readPackage, recoverSession, resolveTheme } from '../../../packages/sonic-fpv/src';
import type { FlightSample, SonicEngine, SonicRuntime, SpeechLine, SurveyAnswers } from '../../../packages/sonic-fpv/src';
import { Recorder } from '../../../apps/fly/src/sonic-session/recorder';
import type { RecorderStatus, SessionStores } from '../../../apps/fly/src/sonic-session/recorder';
import { newProfile } from '../../../apps/fly/src/sonic-session/consent';
import { openSessionStore, openSessionsRoot, removeSession } from '../../../apps/fly/src/sonic-session/store';
import type { DirectoryLike } from '../../../apps/fly/src/sonic-session/store';
import { VoiceCapture, browserMic } from '../../../apps/fly/src/sonic-session/voice';
import type { MicDeps, StreamLike } from '../../../apps/fly/src/sonic-session/voice';

interface InitOptions {
    flushMs?: number;
    chunkFrames?: number;
    chunkMs?: number;
    /** 'device': the browser's (fake) microphone; 'tones': a stream made of tone bursts at known recording times */
    mic?: 'device' | 'tones';
    /** recording-clock times of the tone bursts, ms */
    bursts?: number[];
    hostOffsetMs?: number;
}

const spoken: SpeechLine[] = [];
let recorder: Recorder | null = null;
let sampleTimer: ReturnType<typeof setInterval> | null = null;
let lastEmittedT = 0;
let hostOffset = 7000;
let tones: { ac: AudioContext; bursts: number[]; gain: GainNode } | null = null;
const costs: number[] = [];
const statuses: RecorderStatus[] = [];

function runtime(): SonicRuntime {
    const lesson = getLesson('walls-hall');
    const world = lesson.world.kind === 'analytic' ? createAnalyticWorld(lesson.world.spec) : null;
    const engine = {
        state: 'running',
        async start() {},
        async suspend() {},
        async resume() {},
        async close() {},
        setTheme() {},
        setPrefs() {},
        setLayers() {},
        update() {},
        cue() {},
        async say(line: SpeechLine) {
            spoken.push(line);
        },
        activeCues: () => [{ id: 'height.tone', layer: 'height', dir: null, distance: null, rateHz: null, pitchHz: null, rough: 0 }],
        onSpeech: null,
        auxInput: null
    } as unknown as SonicEngine;
    return { engine, prefs: defaultPrefs(), theme: resolveTheme('soft', {}), world, lesson, runner: null, playback() {} };
}

/** A microphone that is a stream of tone bursts at known recording times: the ground truth of the sync measurement. */
function tonesMic(bursts: number[]): MicDeps {
    const real = browserMic();
    return {
        available: () => real.available(),
        async getUserMedia(): Promise<StreamLike> {
            const ac = new AudioContext();
            const dest = ac.createMediaStreamDestination();
            // silence until the bursts are scheduled (scheduleBursts, once the recorder runs)
            const osc = ac.createOscillator();
            osc.frequency.value = 1000;
            const gain = ac.createGain();
            gain.gain.value = 0;
            osc.connect(gain).connect(dest);
            osc.start();
            tones = { ac, bursts, gain };
            await ac.resume();
            return dest.stream as unknown as StreamLike;
        },
        createRecorder: (s, bps) => real.createRecorder(s, bps)
    };
}

/** Schedules the bursts on the AudioContext clock so each starts at its recording-clock time. */
function scheduleBursts(): void {
    if (tones === null || recorder === null) return;
    const gain = tones.gain.gain;
    const now = recorder.now();
    const at = tones.ac.currentTime;
    for (const b of tones.bursts) {
        const when = at + (b - now) / 1000;
        gain.setValueAtTime(0, Math.max(at, when - 0.01));
        gain.setValueAtTime(0.8, when);
        gain.setValueAtTime(0, when + 0.15);
    }
}

function sample(t: number): FlightSample {
    const a = t / 1700;
    return {
        t: t + hostOffset,
        tick: Math.round(t),
        pos: [Math.cos(a) * 3, 2.5, Math.sin(a) * 3],
        vel: [-Math.sin(a) * 2, 0, Math.cos(a) * 2],
        quat: [1, 0, 0, 0],
        rate: [0, 0, 0],
        yawDeg: 0,
        pitchDeg: 0,
        rollDeg: 0,
        sticks: [0.1, -0.2, 0, 0.05],
        armed: true,
        touched: false,
        paused: false
    };
}

async function root(): Promise<DirectoryLike> {
    return openSessionsRoot();
}

const api = {
    init(o: InitOptions = {}): void {
        hostOffset = o.hostOffsetMs ?? 7000;
        const stores: SessionStores = {
            durable: true,
            async create(id) {
                return openSessionStore(await root(), id);
            },
            async remove(id) {
                await removeSession(await root(), id);
            }
        };
        const rt = runtime();
        const profile = newProfile();
        recorder = new Recorder({
            nowMs: () => performance.now(),
            nowIso: () => new Date().toISOString(),
            runtime: () => rt,
            env: () => ({ release: { sha: 'probe', sonic: 'probe' }, locale: 'en', userAgent: navigator.userAgent, audio: { sampleRate: 48000, baseLatencyMs: null, outputLatencyMs: null }, input: 'keyboard', inputName: null, gpu: null, sceneTransform: [1, 0, 0, 0] }),
            stores,
            voice: new VoiceCapture(o.mic === 'tones' ? tonesMic(o.bursts ?? []) : browserMic()),
            profile: () => profile,
            say: (line) => spoken.push(line),
            keyLabel: (c) => c.replace('Key', ''),
            persist: async () => (await navigator.storage?.persist?.().catch(() => null)) ?? null,
            freeBytes: async () => {
                const e = await navigator.storage?.estimate?.();
                return e?.quota !== undefined && e.usage !== undefined ? e.quota - e.usage : null;
            },
            holdLock: (id) => new Promise((held) => void navigator.locks.request(`gsfpv-sonic-session:${id}`, { mode: 'exclusive' }, () => new Promise<void>((release) => held(() => release())))),
            onStatus: (s) => {
                statuses.push(s);
                if (statuses.length > 200) statuses.shift();
            },
            ...(o.flushMs === undefined ? {} : { flushMs: o.flushMs }),
            ...(o.chunkFrames === undefined ? {} : { chunkFrames: o.chunkFrames }),
            ...(o.chunkMs === undefined ? {} : { chunkMs: o.chunkMs })
        });
        // key T: the same handler the simulator's key router would run, in the key press itself
        addEventListener('keydown', (e) => {
            if (e.code === 'KeyT' && !e.repeat) recorder?.pressRecord();
        });
    },

    status(): RecorderStatus | null {
        return recorder?.status() ?? null;
    },

    spoken(): string[] {
        return spoken.map((l) => l.key);
    },

    /** Starts feeding samples at about 60 Hz on the page's own timer (a display's rate), until stopSamples. */
    startSamples(hz = 60): void {
        const t0 = recorder?.now() ?? 0;
        const p0 = performance.now();
        sampleTimer = setInterval(() => {
            const t = t0 + (performance.now() - p0);
            lastEmittedT = recorder?.now() ?? t;
            const a = performance.now();
            recorder?.onSample(sample(lastEmittedT));
            costs.push(performance.now() - a);
        }, 1000 / hz);
        if (tones !== null) scheduleBursts();
    },

    stopSamples(): void {
        if (sampleTimer !== null) clearInterval(sampleTimer);
        sampleTimer = null;
    },

    lastEmitted(): number {
        return lastEmittedT;
    },

    /** What one onSample call cost in this page, ms: the recorder runs inside the render loop. */
    cost(): { calls: number; p50: number; p95: number; max: number } {
        const sorted = [...costs].sort((a, b) => a - b);
        const at = (q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0;
        return { calls: sorted.length, p50: at(0.5), p95: at(0.95), max: sorted[sorted.length - 1] ?? 0 };
    },

    async stop(survey = false): Promise<{ id: string; frames: number } | null> {
        if (recorder === null) return null;
        const answers: SurveyAnswers = { format: 'shramko-sonic-answers/1', surveyId: 'first-flight', version: 1, skipped: false, answers: [] };
        const done = await recorder.stop(survey ? { survey: async () => answers } : {});
        return done === null ? null : { id: done.id, frames: done.frames };
    },

    async sessions(): Promise<{ id: string; files: string[] }[]> {
        const out: { id: string; files: string[] }[] = [];
        const dir = await root();
        for await (const [name, h] of dir.entries()) {
            if (h.kind !== 'directory') continue;
            const files: string[] = [];
            for await (const [fn] of (h as DirectoryLike).entries()) files.push(fn);
            out.push({ id: name, files: files.sort() });
        }
        return out;
    },

    /** Recovers (when unfinished), packs and reads the session strictly; the voice decoded for its length. */
    async analyze(id: string, recover = false): Promise<Record<string, unknown>> {
        console.log('analyze: opening', id);
        const store = await openSessionStore(await root(), id);
        let recovered: Record<string, unknown> | null = null;
        if (recover) {
            const r = await recoverSession(store);
            recovered = { frames: r.frames, events: r.events, lastT: r.lastT, droppedFlightBytes: r.droppedFlightBytes, notes: r.notes };
        }
        const markBytes = await store.read('voice-sync.jsonl');
        const marks = markBytes === null ? [] : new TextDecoder().decode(markBytes).trim().split(String.fromCharCode(10)).filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
        console.log('analyze: packing');
        const parts = await packSession(store);
        const zip = new Uint8Array(await new Blob(parts as BlobPart[]).arrayBuffer());
        console.log('analyze: reading, zip bytes', zip.length);
        const pkg = readPackage(zip);
        console.log('analyze: read, voice bytes', pkg.voice?.length ?? 0);
        const first = pkg.frames[0];
        const last = pkg.frames[pkg.frames.length - 1];
        let voiceMs: number | null = null;
        let burstOnsetsMs: number[] = [];
        if (pkg.voice !== null) {
            const ac = new OfflineAudioContext(1, 1, 48000);
            console.log('analyze: decoding');
            const buf = await ac.decodeAudioData(pkg.voice.slice().buffer);
            console.log('analyze: decoded', buf.length);
            voiceMs = (buf.length / buf.sampleRate) * 1000;
            // the onsets of tone bursts: the first sample above a threshold after at least 0.3 s of quiet
            const data = buf.getChannelData(0);
            const quiet = Math.round(buf.sampleRate * 0.3);
            let lastLoud = -quiet * 2;
            for (let i = 0; i < data.length; i++) {
                if (Math.abs(data[i] as number) > 0.2) {
                    if (i - lastLoud > quiet) burstOnsetsMs.push((i / buf.sampleRate) * 1000);
                    lastLoud = i;
                }
            }
            burstOnsetsMs = burstOnsetsMs.map((x) => Math.round(x * 10) / 10);
        }
        return {
            id,
            recovered,
            complete: pkg.manifest.complete,
            frames: pkg.frames.length,
            firstT: first?.t ?? null,
            lastT: last?.t ?? null,
            flightLenMs: first !== undefined && last !== undefined ? last.t - first.t : null,
            events: pkg.events.map((e) => `${e.kind}:${(e as { what?: string }).what ?? ''}`),
            voiceBytes: pkg.voice?.length ?? 0,
            voiceMs,
            voiceOffsetMs: pkg.manifest.clock.voiceOffsetMs,
            burstOnsetsMs,
            zipBytes: zip.length,
            problems: pkg.problems,
            consent: pkg.manifest.consent,
            files: pkg.manifest.files.map((f) => f.name),
            voiceSyncMarks: marks.length,
            voiceStartMark: marks.find((m) => 'start' in m) ?? null
        };
    },

    async clearAll(): Promise<void> {
        const dir = await root();
        const ids: string[] = [];
        for await (const [name, h] of dir.entries()) if (h.kind === 'directory') ids.push(name);
        for (const id of ids) await removeSession(dir, id);
    },

    storage(): Promise<{ usage: number | null; quota: number | null; persisted: boolean | null }> {
        return (async () => {
            const e = await navigator.storage.estimate();
            return { usage: e.usage ?? null, quota: e.quota ?? null, persisted: await navigator.storage.persisted() };
        })();
    }
};

(window as unknown as { __rec: typeof api }).__rec = api;
document.title = 'sonicrec ready';
