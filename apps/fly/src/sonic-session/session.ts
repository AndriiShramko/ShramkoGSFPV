// Fly by Sound's session side in the flight page (docs/wip/v12-plan.md section 4.3): builds the recorder out of what the
// page has (the key router, the bus, the sound mode's runtime ctx.sonic, the origin private file system, the microphone)
// and wires it in. app/builtin/sonic-session.ts installs this; it is a no-op while the sound mode is off:
//   - key T does nothing without ctx.sonic,
//   - the bus listeners return at once unless a recording runs,
//   - nothing is fetched, stored or asked of the browser before the pilot presses T and says yes.
import type { SessionStores } from './recorder';
import { Recorder } from './recorder';
import { MemorySink } from '@shramko/sonic-fpv';
import type { ChunkStore, Locale, SonicRuntime } from '@shramko/sonic-fpv';
import { locale, t } from '../i18n';
import type { FlightContext } from '../app/context';
import { loadProfile, saveProfile, withProfile, type PilotProfile } from './consent';
import { sceneTransformOf, type RecorderEnv } from './manifest-input';
import { freeBytes, holdSessionLock, persistStorage, sayVia } from './platform';
import { openSessionsRoot, openSessionStore, opfsAvailable, removeSession, type DirectoryLike } from './store';
import { VoiceCapture, browserMic } from './voice';

/** Where the sessions are kept: the origin private file system, or memory when the browser has none (then nothing survives the tab). */
export function browserStores(): SessionStores {
    const durable = opfsAvailable();
    let root: Promise<DirectoryLike> | null = null;
    const rootOnce = (): Promise<DirectoryLike> => (root ??= openSessionsRoot());
    return {
        durable,
        async create(id): Promise<ChunkStore> {
            if (!durable) return new MemorySink();
            return openSessionStore(await rootOnce(), id);
        },
        async remove(id) {
            if (durable) await removeSession(await rootOnce(), id);
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
    profile(): PilotProfile;
    setProfile(change: Partial<Omit<PilotProfile, 'id'>>): PilotProfile;
    dispose(): void;
}

/** Builds the recorder from the page and wires it in; returns what the other parts of this lane (the panel, the survey) use. */
export function createSonicSession(ctx: FlightContext): SonicSession {
    let profile = loadProfile(storage());
    const voice = new VoiceCapture(browserMic());
    const say = sayVia(() => ctx.sonic ?? null);
    const recorder = new Recorder({
        nowMs: () => performance.now(),
        nowIso: () => new Date().toISOString(),
        runtime: () => ctx.sonic ?? null,
        env: () => readEnv(ctx),
        stores: browserStores(),
        voice,
        profile: () => profile,
        say: (line) => void say(line),
        keyLabel,
        persist: persistStorage,
        freeBytes,
        holdLock: holdSessionLock
    });

    const offs: (() => void)[] = [];
    // T: ask, confirm, stop. Nothing happens without the sound mode, and a held key is one press.
    offs.push(
        ctx.keys.on('sonic.record', (e) => {
            if (ctx.sonic === undefined || e.repeat) return;
            e.preventDefault();
            recorder.pressRecord();
        })
    );
    // the flight's data, while a recording runs
    offs.push(ctx.events.on('sonicSample', (s) => recorder.onSample(s)));
    offs.push(ctx.events.on('sonicEvent', (e) => recorder.onEvent(e)));
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
        profile: () => profile,
        setProfile(change) {
            profile = withProfile(profile, change);
            saveProfile(storage(), profile);
            return profile;
        },
        dispose() {
            for (const off of offs.splice(0)) off();
            recorder.dispose();
        }
    };
}
