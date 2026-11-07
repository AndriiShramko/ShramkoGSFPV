// The page of tools/bench/src/sonicrec-local.ts: the REAL session side of Fly by Sound (apps/fly/src/sonic-session: the recorder, the
// registry, the resume offer, the helper's panel) on the browser's real OPFS, MediaRecorder, DOM and downloads, with the pieces
// the flight lane has not built yet replaced by stand-ins: the sound mode's runtime (ctx.sonic), the flight's samples, the key
// router (a keydown on T calls the handler the feature registered, as KeyRouter does, and ignores typing in a text field) and the
// bus's `frame` event. Bundled by esbuild (i18n.ts is replaced by sonicrec-i18n-shim.ts) and served under the live headers.
import { createAnalyticWorld, defaultPrefs, getLesson, resolveTheme } from '../../../packages/sonic-fpv/src';
import type { FlightSample, SonicEngine, SonicRuntime, SpeechLine } from '../../../packages/sonic-fpv/src';
import { Bus } from '../../../apps/fly/src/app/context';
import type { AppEvents, FlightContext } from '../../../apps/fly/src/app/context';
import { createSonicSession } from '../../../apps/fly/src/sonic-session/session';
import type { SonicSession } from '../../../apps/fly/src/sonic-session/session';
import { listSessions } from '../../../apps/fly/src/sonic-session/registry';
import { sessionIsLocked } from '../../../apps/fly/src/sonic-session/platform';

const spoken: SpeechLine[] = [];
let session: SonicSession | null = null;
let ctx: (FlightContext & { sonic?: SonicRuntime }) | null = null;
let runtime: SonicRuntime | null = null;
let flyTimer: ReturnType<typeof setInterval> | null = null;
let frameTimer: ReturnType<typeof setInterval> | null = null;
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

function sample(t: number): FlightSample {
    const a = t / 1700;
    return { t, tick: Math.round(t), pos: [Math.cos(a) * 3, 2.5, Math.sin(a) * 3], vel: [-Math.sin(a) * 2, 0, Math.cos(a) * 2], quat: [1, 0, 0, 0], rate: [0, 0, 0], yawDeg: 0, pitchDeg: 0, rollDeg: 0, sticks: [0.1, -0.2, 0, 0.05], armed: true, touched: false, paused: false };
}

const text = (el: Element | null): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

const api = {
    /** Builds the session side as the feature does, on a stand-in context. */
    init(options: { mode?: boolean } = {}): void {
        runtime = makeRuntime();
        (window as unknown as { __pauses: string[] }).__pauses = [];
        const events = new Bus<AppEvents>();
        ctx = {
            events,
            keys: { on: (action: string, h: (e: KeyboardEvent, s: 'key' | 'switch') => void) => { handlers.set(action, h); return () => handlers.delete(action); } },
            sonic: options.mode === false ? undefined : runtime,
            // the pause stack: the survey holds the flight with 'panel' and lets it go (recorded here for the probe)
            pause: (reason: string) => (window as unknown as { __pauses: string[] }).__pauses.push(`pause:${reason}`),
            resume: (reason: string) => (window as unknown as { __pauses: string[] }).__pauses.push(`resume:${reason}`),
            session: { transform: { s: 1, t: [0, 0, 0] } },
            controls: { source: 'keyboard', profile: null },
            renderer: { isWebGPU: false }
        } as unknown as FlightContext & { sonic?: SonicRuntime };
        session = createSonicSession(ctx);
        // the router's rule: a key typed into a text field is a letter, not a shortcut
        addEventListener('keydown', (e) => {
            const target = e.target;
            if (target instanceof HTMLInputElement && target.type === 'text') return;
            if (target instanceof HTMLTextAreaElement) return;
            if (e.code === 'KeyT') handlers.get('sonic.record')?.(e, 'key');
        });
        // what the page's own (bubble-phase) key listeners hear: while the survey runs, nothing may reach them
        (window as unknown as { __keysSeen: string[] }).__keysSeen = [];
        addEventListener('keydown', (e) => (window as unknown as { __keysSeen: string[] }).__keysSeen.push(e.code));
        // the page's frame loop: one `frame` a display refresh
        frameTimer = setInterval(() => events.emit('frame', { now: performance.now() }), 16);
    },

    mode(on: boolean): void {
        if (ctx === null || runtime === null) return;
        ctx.sonic = on ? runtime : undefined;
    },

    fly(on: boolean): void {
        if (flyTimer !== null) clearInterval(flyTimer);
        flyTimer = null;
        if (on && ctx !== null) {
            const events = ctx.events;
            flyTimer = setInterval(() => events.emit('sonicSample', sample(performance.now() + 4000)), 1000 / 60);
        }
    },

    spoken(): { key: string; params?: unknown }[] {
        return spoken.map((l) => ({ key: l.key, ...(l.params === undefined ? {} : { params: l.params }) }));
    },

    state(): Record<string, unknown> {
        const panel = session?.panel() ?? null;
        const rows = [...document.querySelectorAll('.sonicrec-session')].map((li) => ({
            id: li.getAttribute('data-id'),
            line: text(li.querySelector('.sonicrec-line')),
            state: text(li.querySelector('.sonicrec-state')),
            buttons: [...li.querySelectorAll('button')].map((b) => text(b))
        }));
        return {
            phase: session?.recorder.phase ?? null,
            status: session?.recorder.status() ?? null,
            pending: session?.resume.pending ?? [],
            panelBuilt: panel !== null,
            toggleHidden: (document.getElementById('sonicrec-toggle') as HTMLElement | null)?.hidden ?? null,
            toggleText: text(document.getElementById('sonicrec-toggle')),
            panelOpen: panel?.isOpen ?? false,
            panelStatus: text(document.querySelector('.sonicrec-status')),
            panelVoice: text(document.querySelector('.sonicrec-voice')),
            panelMessage: text(document.querySelector('.sonicrec-message')),
            panelNote: text(document.querySelector('.sonicrec-note')),
            rows,
            startDisabled: (document.querySelector('[data-action="start"]') as HTMLButtonElement | null)?.disabled ?? null,
            surveyOpen: document.querySelector('.sonicrec-survey:not([hidden])') !== null,
            surveyProgress: text(document.querySelector('.sonicrec-survey .sonicrec-progress')),
            surveyQuestion: text(document.querySelector('.sonicrec-survey .sonicrec-q')),
            surveyListening: text(document.querySelector('.sonicrec-survey .sonicrec-listening')),
            surveyButtons: [...document.querySelectorAll('.sonicrec-survey button')].map((b) => ({ text: text(b), label: b.getAttribute('aria-label'), digit: b.getAttribute('data-digit'), action: b.getAttribute('data-action') })),
            keysSeen: (window as unknown as { __keysSeen?: string[] }).__keysSeen ?? [],
            pauses: (window as unknown as { __pauses?: string[] }).__pauses ?? [],
            profile: session?.profile() ?? null
        };
    },

    async entries(): Promise<unknown[]> {
        if (session === null) return [];
        const list = await listSessions(session.stores, sessionIsLocked);
        return list.map((e) => ({ id: e.id, state: e.state, complete: e.complete, locked: e.locked, durationMs: e.durationMs, bytes: e.bytes, voice: e.voice, notes: e.notes, frames: null }));
    },

    async deleteAll(): Promise<void> {
        if (session === null) return;
        for (const id of await session.stores.list()) await session.stores.remove(id);
    },

    /** What the page's localStorage holds of the pilot's profile (the helper's answers survive a reload). */
    profileStored(): string | null {
        return localStorage.getItem('gsfpv.sonicrec.profile');
    },

    /** Everything the stub file picker was asked to write, as byte arrays. */
    picked(): number[][] {
        return (window as unknown as { __picked?: number[][] }).__picked ?? [];
    }
};

(window as unknown as { __loc: typeof api }).__loc = api;
document.title = 'sonicrec local ready';
