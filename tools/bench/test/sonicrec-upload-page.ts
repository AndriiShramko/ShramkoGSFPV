// The page of tools/bench/src/sonicrec-upload.ts: the REAL session side of Fly by Sound (the recorder, the registry, the helper's panel, the
// sending control and the upload client of apps/fly/src/sonic-session) on the browser's real OPFS, DOM, fetch and keys, talking to a LOCAL copy
// of the API (apps/api/tests/rig_server.py) through tools/bench/scripts/serve-csp.mjs. Stand-ins: the sound mode's runtime (ctx.sonic: an
// engine that records the lines it is asked to say), the flight's samples, the key router (a keydown on T or U calls the handler the feature
// registered, as KeyRouter does) and the browser's speech recognition (injected by the harness before this script loads: window.__sr).
// A recording is written into the real OPFS by the sound package's own SessionWriter, so a package of several chunks can be had at once.
import { SessionWriter, createAnalyticWorld, defaultPrefs, getLesson, resolveTheme } from '../../../packages/sonic-fpv/src';
import type { SonicEngine, SonicRuntime, SpeechLine } from '../../../packages/sonic-fpv/src';
import { Bus } from '../../../apps/fly/src/app/context';
import type { AppEvents, FlightContext } from '../../../apps/fly/src/app/context';
import { buildManifestInput } from '../../../apps/fly/src/sonic-session/manifest-input';
import { consentFor, newProfile } from '../../../apps/fly/src/sonic-session/consent';
import { listSessions, packageOf } from '../../../apps/fly/src/sonic-session/registry';
import { holdSessionLock, sessionIsLocked } from '../../../apps/fly/src/sonic-session/platform';
import { createSonicSession } from '../../../apps/fly/src/sonic-session/session';
import type { SonicSession } from '../../../apps/fly/src/sonic-session/session';

const spoken: SpeechLine[] = [];
let session: SonicSession | null = null;
let ctx: (FlightContext & { sonic?: SonicRuntime }) | null = null;
let runtime: SonicRuntime | null = null;
const handlers = new Map<string, (e: KeyboardEvent, source: 'key' | 'switch') => void>();

function makeRuntime(): SonicRuntime {
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

const text = (el: Element | null): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const hex = (b: ArrayBuffer): string => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');

const api = {
    init(options: { mode?: boolean; profile?: Record<string, unknown> } = {}): void {
        runtime = makeRuntime();
        const events = new Bus<AppEvents>();
        ctx = {
            events,
            keys: { on: (action: string, h: (e: KeyboardEvent, s: 'key' | 'switch') => void) => { handlers.set(action, h); return () => handlers.delete(action); } },
            sonic: options.mode === false ? undefined : runtime,
            pause: () => undefined,
            resume: () => undefined,
            session: { transform: { s: 1, t: [0, 0, 0] } },
            controls: { source: 'keyboard', profile: null },
            renderer: { isWebGPU: false }
        } as unknown as FlightContext & { sonic?: SonicRuntime };
        if (options.profile !== undefined) localStorage.setItem('gsfpv.sonicrec.profile', JSON.stringify({ ...newProfile(), ...options.profile }));
        session = createSonicSession(ctx);
        // the router's rule: a key typed into a text field is a letter, not a shortcut
        addEventListener('keydown', (e) => {
            const target = e.target;
            if (target instanceof HTMLInputElement && target.type === 'text') return;
            if (target instanceof HTMLTextAreaElement) return;
            if (e.code === 'KeyT') handlers.get('sonic.record')?.(e, 'key');
            if (e.code === 'KeyU') handlers.get('sonic.send')?.(e, 'key');
        });
        setInterval(() => events.emit('frame', { now: performance.now() }), 16);
    },

    /** A finished recording in the real OPFS, written by the sound package's writer: `voiceBytes` of opaque voice make a package of several chunks. */
    async makeSession(o: { id?: string; voiceBytes?: number; minor?: boolean; guardian?: boolean; at?: string; speech?: boolean } = {}): Promise<string> {
        if (session === null || runtime === null) throw new Error('init first');
        const at = o.at ?? new Date().toISOString();
        const id = o.id ?? `up${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
        const profile = { ...newProfile(), minor: o.minor === true, guardianConfirmed: o.minor === true && o.guardian === true };
        const store = await session.stores.create(id);
        // as the recorder does: a session being written is held, so the start-up scan does not take it for one a crash left
        const release = await holdSessionLock(id);
        const manifest = buildManifestInput({
            runtime,
            env: { release: { sha: 'test', sonic: 'test' }, locale: 'en', userAgent: navigator.userAgent, audio: { sampleRate: 48000, baseLatencyMs: null, outputLatencyMs: null }, input: 'keyboard', inputName: null, gpu: null, sceneTransform: [1, 0, 0, 0] },
            consent: consentFor(profile, { voice: true, at }),
            profile,
            startIso: at,
            id
        });
        const w = await SessionWriter.start({ sink: store, manifest, chunkFrames: 30 });
        w.setVoiceOffset(5);
        for (let i = 0; i < 90; i++) {
            const t = i * (1000 / 30);
            w.frame({ t, tick: Math.round(t), p: [Math.cos(t / 900) * 3, 2.5, Math.sin(t / 900) * 3], v: [0, 0, 1], q: [1, 0, 0, 0], s: [0, 0, 0, 0], c: ['height.tone'] });
        }
        w.event({ t: 100, kind: 'checkpoint', id: 'cp' });
        const total = o.voiceBytes ?? 3000;
        for (let sent = 0; sent < total; sent += 60000) {
            const part = new Uint8Array(Math.min(60000, total - sent));
            crypto.getRandomValues(part);
            w.voice(part);
        }
        await w.finish({ ended: new Date(Date.parse(at) + 3000).toISOString() });
        await release();
        return id;
    },

    /** SHA-256 and size of the package as it packs now (the local copy). */
    async packageInfo(id: string): Promise<{ sha256: string; bytes: number }> {
        if (session === null) throw new Error('init first');
        const blob = await packageOf(session.stores, id);
        const buf = await blob.arrayBuffer();
        return { sha256: hex(await crypto.subtle.digest('SHA-256', buf)), bytes: buf.byteLength };
    },

    spoken(): { key: string; params?: unknown }[] {
        return spoken.map((l) => ({ key: l.key, ...(l.params === undefined ? {} : { params: l.params }) }));
    },

    clearSpoken(): void {
        spoken.length = 0;
    },

    async offerSend(id: string): Promise<void> {
        await session?.send.offerSend(id);
    },

    /** The helper's button without the panel: the consent is the caller's. */
    async sendByHelper(id: string): Promise<string | null> {
        return (await session?.send.sendByHelper(id)) ?? null;
    },

    async resume(): Promise<number> {
        return (await session?.send.resume()) ?? 0;
    },

    setProfile(change: Record<string, unknown>): unknown {
        return session?.setProfile(change as never);
    },

    openPanel(): void {
        session?.panel()?.open();
    },

    async entries(): Promise<unknown[]> {
        if (session === null) return [];
        const list = await listSessions(session.stores, sessionIsLocked);
        return list.map((e) => ({ id: e.id, state: e.state, bytes: e.bytes, minor: e.manifest?.consent.minor ?? null, guardian: e.manifest?.consent.guardianConfirmed ?? null, transfer: e.transfer }));
    },

    live(): Record<string, unknown> {
        return session === null ? {} : Object.fromEntries(session.send.live());
    },

    asking(): boolean {
        return session?.send.asking ?? false;
    },

    state(): Record<string, unknown> {
        const rows = [...document.querySelectorAll('.sonicrec-session')].map((li) => ({
            id: li.getAttribute('data-id'),
            line: text(li.querySelector('.sonicrec-line')),
            state: text(li.querySelector('.sonicrec-state')),
            transfer: text(li.querySelector('.sonicrec-transfer')),
            transferLive: li.querySelector('.sonicrec-transfer')?.getAttribute('aria-live') ?? null,
            buttons: [...li.querySelectorAll('button')].map((b) => ({ text: text(b), action: b.getAttribute('data-action'), disabled: (b as HTMLButtonElement).disabled })),
            consent: li.querySelector('.sonicrec-send') === null ? null : { heading: text(li.querySelector('.sonicrec-send h4')), body: text(li.querySelector('.sonicrec-send')), link: li.querySelector('.sonicrec-send a')?.getAttribute('href') ?? null, tickDisabled: false }
        }));
        return {
            panelOpen: session?.panel()?.isOpen ?? false,
            panelMessage: text(document.querySelector('.sonicrec-message')),
            rows,
            profile: session?.profile() ?? null,
            speechTick: (() => {
                const el = document.getElementById('sonicrec-speech') as HTMLInputElement | null;
                return el === null ? null : { checked: el.checked, disabled: el.disabled, help: text(document.getElementById('sonicrec-speech-help')) };
            })()
        };
    }
};

(window as unknown as { __up: typeof api }).__up = api;
document.title = 'sonicrec upload ready';
