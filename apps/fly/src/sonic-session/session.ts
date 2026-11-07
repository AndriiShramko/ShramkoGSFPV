// Fly by Sound's session side in the flight page (docs/wip/v12-plan.md section 4.3): builds the recorder out of what the
// page has (the key router, the bus, the sound mode's runtime ctx.sonic, the origin private file system, the microphone)
// and wires it in. app/builtin/sonic-session.ts installs this; it is a no-op while the sound mode is off:
//   - keys T and U do nothing without ctx.sonic,
//   - the bus listeners return at once unless a recording runs,
//   - nothing is fetched, stored or asked of the browser before the pilot presses T and says yes.
import type { SessionStores } from './recorder';
import { Recorder } from './recorder';
import { DICTS, MemorySink, createTranslator } from '@shramko/sonic-fpv';
import type { ChunkStore, Locale, SonicRuntime } from '@shramko/sonic-fpv';
import { locale, t } from '../i18n';
import type { FlightContext } from '../app/context';
import { loadProfile, saveProfile, withProfile, type PilotProfile } from './consent';
import { formatWhen } from './format';
import { sceneTransformOf, type RecorderEnv } from './manifest-input';
import { freeBytes, holdSendLock, holdSessionLock, persistStorage, sayVia, sessionIsLocked } from './platform';
import { createPanel } from './panel';
import type { RecPanel } from './panel';
import { ReplayControl } from './replay-control';
import { createReplayHost } from './replay-host';
import { ResumeOffer } from './resume';
import { SendControl } from './send-control';
import { runSurvey } from './survey';
import { captureSurveyKeys } from './survey-keys';
import { createSurveyDialog } from './survey-view';
import type { SurveyDialog } from './survey-view';
import { listSessionIds, openSessionsRoot, openSessionStore, opfsAvailable, removeSession, type DirectoryLike } from './store';
import { VoiceCapture, browserMic } from './voice';
import { VoiceCommands, browserRecognizer, splitPhrases } from './voice-command';

/** Where the sessions are kept: the origin private file system, or memory when the browser has none (then nothing survives the tab). */
export function browserStores(): SessionStores {
    const durable = opfsAvailable();
    let root: Promise<DirectoryLike> | null = null;
    const rootOnce = (): Promise<DirectoryLike> => (root ??= openSessionsRoot());
    const memory = new Map<string, MemorySink>();
    return {
        durable,
        async create(id): Promise<ChunkStore> {
            if (!durable) {
                const sink = new MemorySink();
                memory.set(id, sink);
                return sink;
            }
            return openSessionStore(await rootOnce(), id);
        },
        async open(id): Promise<ChunkStore> {
            if (!durable) {
                const sink = memory.get(id);
                if (sink === undefined) throw new Error(`no session ${id} in memory`);
                return sink;
            }
            return openSessionStore(await rootOnce(), id, false);
        },
        async list() {
            return durable ? listSessionIds(await rootOnce()) : [...memory.keys()];
        },
        async remove(id) {
            if (durable) await removeSession(await rootOnce(), id);
            else memory.delete(id);
        }
    };
}

/** The spoken name of a key for a line's {key}: a letter or digit as it is, the others from the dictionary. */
export function keyLabel(code: string): string {
    const letter = /^Key([A-Z])$/.exec(code);
    if (letter !== null) return letter[1] as string;
    const digit = /^(?:Digit|Numpad)(\d)$/.exec(code);
    if (digit !== null) return digit[1] as string;
    const named = t(`sonicrec.key.${code}`);
    return named === `sonicrec.key.${code}` ? code : named;
}

interface ReleaseInfo {
    readonly sha: string;
    readonly sonic: string;
}

let releaseCache: Promise<ReleaseInfo> | null = null;

/** release.json of the static release: the simulator's commit and the sound package's; 'dev' on a dev server. Fetched once, and only when a recording starts. */
function releaseInfo(): Promise<ReleaseInfo> {
    releaseCache ??= (async (): Promise<ReleaseInfo> => {
        try {
            const r = await fetch('/release.json', { cache: 'no-store' });
            if (r.ok) {
                const j = (await r.json()) as { sha?: unknown; sonic?: unknown };
                return { sha: typeof j.sha === 'string' ? j.sha : 'dev', sonic: typeof j.sonic === 'string' ? j.sonic : 'unknown' };
            }
        } catch {
            // offline or a dev server
        }
        return { sha: 'dev', sonic: 'unknown' };
    })();
    return releaseCache;
}

interface AudioLike {
    readonly sampleRate?: number;
    readonly baseLatency?: number;
    readonly outputLatency?: number;
}

/** The engine's AudioContext, reached through the node every Web Audio node carries (the engine's auxInput). */
function audioOf(rt: SonicRuntime | null): AudioLike | null {
    const node = rt?.engine.auxInput as { context?: AudioLike } | null | undefined;
    return node?.context ?? null;
}

const ms = (seconds: number | undefined): number | null => (typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * 10000) / 10 : null);

/** The adapter the simulator draws on, as a line for the manifest; null when the browser will not say within a second. */
async function gpuLine(ctx: FlightContext): Promise<string | null> {
    try {
        const nav = navigator as Navigator & { gpu?: { requestAdapter(): Promise<{ info?: { vendor?: string; architecture?: string; description?: string } } | null> } };
        const adapter = await Promise.race([nav.gpu?.requestAdapter() ?? Promise.resolve(null), new Promise<null>((resolve) => setTimeout(() => resolve(null), 1000))]);
        const info = adapter?.info;
        const text = [ctx.renderer.isWebGPU ? 'webgpu' : 'webgl2', info?.vendor, info?.architecture, info?.description].filter((x): x is string => typeof x === 'string' && x !== '').join(' ');
        return text === '' ? null : text;
    } catch {
        return null;
    }
}

const SOURCE_KIND = { hid: 'radio', gamepad: 'gamepad', touch: 'touch', keyboard: 'keyboard' } as const;

async function readEnv(ctx: FlightContext): Promise<RecorderEnv> {
    const [release, gpu] = await Promise.all([releaseInfo(), gpuLine(ctx)]);
    const ac = audioOf(ctx.sonic ?? null);
    const source = ctx.controls.source;
    return {
        release,
        locale: locale as Locale,
        userAgent: navigator.userAgent,
        audio: { sampleRate: typeof ac?.sampleRate === 'number' ? ac.sampleRate : 48000, baseLatencyMs: ms(ac?.baseLatency), outputLatencyMs: ms(ac?.outputLatency) },
        input: source !== null && source in SOURCE_KIND ? SOURCE_KIND[source as keyof typeof SOURCE_KIND] : 'keyboard',
        inputName: ctx.controls.profile?.deviceName ?? null,
        gpu,
        sceneTransform: sceneTransformOf(ctx.session?.transform)
    };
}

function storage(): Storage | null {
    try {
        return globalThis.localStorage;
    } catch {
        return null; // blocked in a private window
    }
}

export interface SonicSession {
    readonly recorder: Recorder;
    readonly stores: SessionStores;
    readonly resume: ResumeOffer;
    /** the replay of a recording (replay-control.ts): a file or a session kept here, with the cues and the voice */
    readonly replay: ReplayControl;
    /** the sending of a recording to the author (send-control.ts): key U, the panel's Send, the voice command, resuming at the next start */
    readonly send: SendControl;
    /** the helper's panel, made when the sound mode first runs; null before */
    panel(): RecPanel | null;
    profile(): PilotProfile;
    setProfile(change: Partial<Omit<PilotProfile, 'id'>>): PilotProfile;
    dispose(): void;
}

/** Builds the recorder from the page and wires it in; returns what the other parts of this lane (the survey, the upload) use. */
export function createSonicSession(ctx: FlightContext): SonicSession {
    let profile = loadProfile(storage());
    const voice = new VoiceCapture(browserMic());
    const say = sayVia(() => ctx.sonic ?? null);
    const stores = browserStores();
    const nowIso = (): string => new Date().toISOString();
    let panel: RecPanel | null = null;
    let surveyDialog: SurveyDialog | null = null;
    let lastShown: string | null = null;
    let send: SendControl | null = null;
    const setProfile = (change: Partial<Omit<PilotProfile, 'id'>>): PilotProfile => {
        profile = withProfile(profile, change);
        saveProfile(storage(), profile);
        return profile;
    };
    const recorder = new Recorder({
        nowMs: () => performance.now(),
        nowIso,
        runtime: () => ctx.sonic ?? null,
        env: () => readEnv(ctx),
        stores,
        voice,
        profile: () => profile,
        // the promise settles when the line has been said: the recorder waits for it only for the question that asks for consent
        say: (line) => say(line),
        keyLabel,
        persist: persistStorage,
        freeBytes,
        holdLock: holdSessionLock,
        // after every stop the pilot is offered the short survey, by voice and by number keys, with the voice still recording
        survey: async (env) => {
            const translator = createTranslator(locale as Locale, DICTS);
            const dialog = (surveyDialog ??= createSurveyDialog({ text: (line) => translator.text(line), keyLabel }));
            const answers = await runSurvey({
                say: (line, options) => say(line, options),
                text: (line) => translator.text(line),
                keyLabel,
                now: env.now,
                profile: env.profile,
                // the microphone still records: the pilot hears so before the offer (survey.mic-on). A spoken number is not taken here
                // (numbersByVoice stays off): nothing is listened to while a recording runs, so the how-to names the keys only
                micOn: env.voiceOn,
                view: dialog,
                listen: (handler) => {
                    const offKeys = captureSurveyKeys(handler);
                    const offDialog = dialog.onInput(handler);
                    return () => {
                        offKeys();
                        offDialog();
                    };
                },
                holdFlight: () => {
                    ctx.pause('panel');
                    return () => ctx.resume('panel');
                }
            });
            // a survey that was answered is not offered as the first flight's again; one that was declined is
            if (!answers.skipped && !profile.surveysSeen.includes(answers.surveyId)) setProfile({ surveysSeen: [...profile.surveysSeen, answers.surveyId] });
            return answers;
        },
        onStatus: (s) => {
            panel?.onStatus(s);
            // a recording runs or is being asked for: nothing is listened to or asked about sending meanwhile (the microphone is the recorder's)
            send?.onRecorderStatus(s);
            // a recording has just ended: the helper's panel opens on it, so the Save button is in front of them
            if (s.lastSessionId !== null && s.lastSessionId !== lastShown) {
                lastShown = s.lastSessionId;
                panel?.open();
                panel?.notify(t('sonicrec.msg.recorded'));
                // and the pilot is told how to send it, after the recorder's own "saved" line (which it says right after this status)
                const id = s.lastSessionId;
                setTimeout(() => void send?.offerSend(id), 0);
            }
        }
    });
    const recognizer = browserRecognizer();
    send = new SendControl({
        stores,
        recorder: { get phase() { return recorder.phase; } },
        profile: () => profile,
        isLocked: sessionIsLocked,
        say: (line, options) => say(line, options),
        keyLabel,
        nowIso,
        voice: new VoiceCommands({ create: recognizer, lang: t('sonicrec.voice.lang') }),
        phrases: (kind) => splitPhrases(t(`sonicrec.voice.phrases.${kind}`)),
        holdSendLock,
        onChange: () => panel?.onTransfer(),
        onNotice: (n) => panel?.notify(t(`sonicrec.send.notice.${n}`))
    });
    const sender = send;
    const replay = new ReplayControl({
        host: createReplayHost(ctx),
        stores,
        formatWhen: (iso) => formatWhen(iso, locale),
        onChange: (s) => panel?.onReplay(s)
    });
    const resume = new ResumeOffer({ stores, isLocked: sessionIsLocked, nowIso, say: (line) => void say(line), keyLabel, onChange: () => void panel?.refresh() });
    const ensurePanel = (): RecPanel =>
        (panel ??= createPanel({ recorder, stores, resume, replay, send: sender, speechAvailable: recognizer !== null, profile: () => profile, setProfile, isLocked: sessionIsLocked, nowIso }));

    const offs: (() => void)[] = [];
    // T: ask, confirm, stop. Nothing happens without the sound mode, and a held key is one press. While an unfinished
    // recording from an earlier visit waits for an answer ("Press T to keep it"), T answers that first.
    offs.push(
        ctx.keys.on('sonic.record', (e) => {
            if (ctx.sonic === undefined || e.repeat) return;
            e.preventDefault();
            if (recorder.phase === 'idle' && resume.pending.length > 0) void resume.keepNext();
            else recorder.pressRecord();
        })
    );
    // U: send the recording to the author. The app asks first and a second press, after the question was read out, is the pilot's yes.
    offs.push(
        ctx.keys.on('sonic.send', (e) => {
            if (ctx.sonic === undefined || e.repeat) return;
            e.preventDefault();
            sender.pressSend();
        })
    );
    // the flight's data, while a recording runs
    offs.push(ctx.events.on('sonicSample', (s) => recorder.onSample(s)));
    offs.push(ctx.events.on('sonicEvent', (e) => recorder.onEvent(e)));
    // The sound mode starts (ctx.sonic appears): the toggle button of the helper's panel shows, and the unfinished recordings
    // of earlier visits are looked for and offered, once. One property read a frame while the mode is off.
    let modeOn = false;
    offs.push(
        ctx.events.on('frame', () => {
            const on = ctx.sonic !== undefined;
            if (on === modeOn) return;
            modeOn = on;
            if (on) {
                ensurePanel().setVisible(true);
                void resume.scan();
                // a sending that was started and not finished goes on (its consent and token are in its upload.json)
                void sender.resume();
            } else panel?.setVisible(false);
        })
    );
    // a tab that is hidden or closing writes what it has (a best effort: the write may not finish; the next start recovers)
    const flush = (): void => recorder.flushNow();
    const onVisibility = (): void => {
        if (document.visibilityState === 'hidden') flush();
    };
    addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    offs.push(() => {
        removeEventListener('pagehide', flush);
        document.removeEventListener('visibilitychange', onVisibility);
    });

    return {
        recorder,
        stores,
        resume,
        replay,
        send: sender,
        panel: () => panel,
        profile: () => profile,
        setProfile,
        dispose() {
            for (const off of offs.splice(0)) off();
            replay.close();
            sender.dispose();
            recorder.dispose();
            panel?.dispose();
            panel = null;
            surveyDialog?.dispose();
            surveyDialog = null;
        }
    };
}
