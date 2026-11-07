// What a recording says about itself (docs/wip/v12-plan.md section 4.3 step 2): the start of its manifest.json, built from
// what the flight lane's runtime exposes (ctx.sonic: the lesson, the world, the theme, the pilot's sound settings) and
// from what the page knows (the release, the language, the input device, the audio latency). No name is in it: a random
// session id, a random pilot id, an optional nickname.
import type { Consent, DeviceInfo, Locale, ManifestInput, SceneTransform, SessionManifest, SonicPrefs, SonicRuntime, TrackRef } from '@shramko/sonic-fpv';
import { defaultPrefs } from '@shramko/sonic-fpv';
import type { PilotProfile } from './consent';

/** What the page contributes: read once when a recording starts. */
export interface RecorderEnv {
    /** the simulator's release id (release.json sha, 'dev' on a dev server) and the sound package's commit */
    readonly release: { readonly sha: string; readonly sonic: string };
    readonly locale: Locale;
    readonly userAgent: string;
    readonly audio: DeviceInfo['audio'];
    readonly input: DeviceInfo['input'];
    readonly inputName: string | null;
    readonly gpu: string | null;
    /** the scene transform the scan is flown through, [s, tx, ty, tz]; the identity for a lesson world */
    readonly sceneTransform: SceneTransform;
}

export const APP_NAME = 'ShramkoGSFPV';
const IDENTITY: SceneTransform = [1, 0, 0, 0];

const clip = (s: string, max: number): string => (s.length > max ? s.slice(0, max) : s);

/** The scene transform of the simulator's session as [s, tx, ty, tz]: `{ s, t: [x, y, z] }` or the array form; the identity when unreadable. */
export function sceneTransformOf(raw: unknown): SceneTransform {
    if (Array.isArray(raw) && raw.length === 4 && raw.every((x) => typeof x === 'number' && Number.isFinite(x)) && (raw[0] as number) > 0) return [raw[0], raw[1], raw[2], raw[3]] as SceneTransform;
    const o = raw as { s?: unknown; t?: unknown } | null;
    if (o !== null && typeof o === 'object' && typeof o.s === 'number' && Number.isFinite(o.s) && o.s > 0 && Array.isArray(o.t) && o.t.length === 3 && o.t.every((x) => typeof x === 'number' && Number.isFinite(x))) {
        return [o.s, o.t[0] as number, o.t[1] as number, o.t[2] as number];
    }
    return IDENTITY;
}

function sceneOf(rt: SonicRuntime | null, env: RecorderEnv): SessionManifest['scene'] {
    const w = rt?.world ?? null;
    if (w === null) return { kind: 'none', id: 'none', version: 1, transform: IDENTITY };
    if (w.kind === 'analytic') return { kind: 'analytic', id: clip(w.id, 80), version: Math.max(0, Math.trunc(w.version)), transform: IDENTITY };
    return { kind: 'scan', id: clip(w.id, 80), version: Math.max(0, Math.trunc(w.version)), transform: env.sceneTransform };
}

function trackOf(rt: SonicRuntime | null): TrackRef | null {
    const world = rt?.lesson?.world;
    return world !== undefined && world.kind === 'scan' ? world.track : null;
}

export interface ManifestParts {
    readonly runtime: SonicRuntime | null;
    readonly env: RecorderEnv;
    readonly consent: Consent;
    readonly profile: PilotProfile;
    /** ISO 8601 of t = 0 of the recording */
    readonly startIso: string;
    /** the session id (the name of its folder) */
    readonly id: string;
}

/** The manifest of a recording that has just started, for SessionWriter.start. */
export function buildManifestInput(p: ManifestParts): ManifestInput {
    const rt = p.runtime;
    const settings: SonicPrefs = rt?.prefs ?? defaultPrefs();
    const lesson = rt?.lesson ?? null;
    return {
        id: p.id,
        created: p.startIso,
        app: { name: APP_NAME, release: clip(p.env.release.sha, 80), sonic: clip(p.env.release.sonic, 80) },
        scene: sceneOf(rt, p.env),
        track: trackOf(rt),
        lesson: lesson === null ? null : { id: lesson.id, version: lesson.version, path: settings.path },
        theme: rt === null ? { id: settings.theme, version: 1 } : { id: rt.theme.id, version: rt.theme.version },
        settings,
        assists: lesson?.assists ?? null,
        device: {
            userAgent: clip(p.env.userAgent, 500),
            locale: p.env.locale,
            audio: p.env.audio,
            input: p.env.input,
            inputName: p.env.inputName === null ? null : clip(p.env.inputName, 120),
            headphones: p.profile.headphones,
            gpu: p.env.gpu === null ? null : clip(p.env.gpu, 200)
        },
        consent: p.consent,
        pilot: { id: p.profile.id, nickname: p.profile.nickname },
        clock: { startIso: p.startIso, frameHz: 30, voiceOffsetMs: null }
    };
}
