// Fly by Sound, step 2 (docs/wip/v12-feedback.md): the recorder as the flight page wires it
// (apps/fly/src/sonic-session/session.ts, installed by app/builtin/sonic-session.ts). The rule of the lane is that every
// hook is a no-op while the sound mode is off, so ordinary flight is unchanged: key T does nothing without ctx.sonic, and
// the bus listeners write nothing unless a recording runs. The page is emulated just far enough for the real key router,
// the real bus and the real dictionaries (the few DOM globals src/i18n.ts reads at import).
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Bus } from '../../../apps/fly/src/app/context';
import type { AppEvents, FlightContext } from '../../../apps/fly/src/app/context';
import { KeyRouter } from '../../../apps/fly/src/app/keys';
import { fakeRuntime, lessonOpen, sampleAt } from './sonicrec-fixtures';
import type { FakeRuntime } from './sonicrec-fixtures';

type Mod = typeof import('../../../apps/fly/src/sonic-session/session');
type Feature = typeof import('../../../apps/fly/src/app/builtin/sonic-session');
let mod: Mod;
let feature: Feature;

beforeAll(async () => {
    class FakeElement { isContentEditable = false; }
    vi.stubGlobal('HTMLElement', FakeElement);
    vi.stubGlobal('HTMLInputElement', class extends FakeElement { type = 'text'; });
    vi.stubGlobal('HTMLTextAreaElement', class extends FakeElement {});
    vi.stubGlobal('HTMLSelectElement', class extends FakeElement {});
    vi.stubGlobal('location', { pathname: '/en/fly/', search: '' });
    vi.stubGlobal('document', { cookie: '', documentElement: { lang: '' }, visibilityState: 'visible', addEventListener() {}, removeEventListener() {} });
    vi.stubGlobal('addEventListener', () => undefined);
    vi.stubGlobal('removeEventListener', () => undefined);
    mod = await import('../../../apps/fly/src/sonic-session/session');
    feature = await import('../../../apps/fly/src/app/builtin/sonic-session');
});

afterEach(() => {
    vi.restoreAllMocks();
});

const press = (keys: KeyRouter, code: string, extra: object = {}): string | null =>
    keys.route({ code, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, repeat: false, target: null, preventDefault() {}, ...extra } as unknown as KeyboardEvent);

function page(fake: FakeRuntime | null) {
    const keys = new KeyRouter();
    const events = new Bus<AppEvents>();
    const ctx = { keys, events, sonic: fake?.runtime, session: { transform: { s: 5, t: [0, 0, 0] } }, controls: { source: 'keyboard', profile: null }, renderer: { isWebGPU: false } } as unknown as FlightContext;
    return { ctx, keys, events };
}

describe('the session feature in the flight page', () => {
    it('with the sound mode off, T, the samples and the events change nothing', () => {
        const { ctx, keys, events } = page(null);
        const s = mod.createSonicSession(ctx);
        expect(press(keys, 'KeyT')).toBe('sonic.record'); // the key is routed, the handler returns at once
        expect(s.recorder.phase).toBe('idle');
        events.emit('sonicSample', sampleAt(1000));
        events.emit('sonicEvent', lessonOpen(1000));
        expect(s.recorder.status()).toMatchObject({ phase: 'idle', frames: 0, events: 0, sessionId: null });
        s.dispose();
        // a feature that was never given ctx.sonic touches no storage, no microphone, no speech
        expect(s.recorder.status().durable).toBe(false); // memory only in Node: nothing was opened either way
    });

    it('with the mode on, T asks by voice, a second T starts, the bus feeds it, a third T stops and saves', async () => {
        const fake = fakeRuntime('walls-hall');
        const { ctx, keys, events } = page(fake);
        const s = mod.createSonicSession(ctx);
        expect(press(keys, 'KeyT')).toBe('sonic.record');
        expect(s.recorder.phase).toBe('asking');
        expect(fake.spoken.map((l) => l.key)).toEqual(['rec.ask']);
        expect(fake.spoken[0]?.params).toEqual({ key: 'T' });
        press(keys, 'KeyT');
        const t0 = Date.now();
        while (s.recorder.phase !== 'recording' && Date.now() - t0 < 3000) await new Promise((r) => setTimeout(r, 5));
        expect(s.recorder.phase).toBe('recording'); // no microphone in Node: it records the flight without a voice
        const base = performance.now();
        for (let i = 0; i < 90; i++) events.emit('sonicSample', sampleAt(base + i * (1000 / 60)));
        events.emit('sonicEvent', lessonOpen(base + 10));
        expect(s.recorder.status().frames).toBeGreaterThan(0);
        expect(s.recorder.status().events).toBeGreaterThanOrEqual(3); // session start, recording start, lesson open
        press(keys, 'KeyT');
        const t1 = Date.now();
        while (s.recorder.status().lastSessionId === null && Date.now() - t1 < 3000) await new Promise((r) => setTimeout(r, 5));
        expect(s.recorder.status().lastSessionId).toMatch(/^[A-Za-z0-9_-]{22}$/);
        expect(fake.spoken.map((l) => l.key)).toEqual(['rec.ask', 'rec.started', 'rec.stopped', 'rec.saved']);
        s.dispose();
    });

    it('a held key is one press, and after dispose T is nobody\'s', () => {
        const fake = fakeRuntime('walls-hall');
        const { ctx, keys } = page(fake);
        const s = mod.createSonicSession(ctx);
        press(keys, 'KeyT', { repeat: true });
        expect(s.recorder.phase).toBe('idle');
        press(keys, 'KeyT');
        expect(s.recorder.phase).toBe('asking');
        press(keys, 'KeyT', { repeat: true });
        expect(s.recorder.phase).toBe('asking'); // the held key did not say yes
        s.dispose();
        expect(press(keys, 'KeyT')).toBeNull();
    });

    it('the feature installs through the same path as every other and takes itself out again', () => {
        const fake = fakeRuntime('walls-hall');
        const { ctx, keys } = page(fake);
        const off = feature.sonicSession.install(ctx);
        expect(typeof off).toBe('function');
        expect(feature.sonicSession.id).toBe('sonic-session');
        expect(press(keys, 'KeyT')).toBe('sonic.record');
        (off as () => void)();
        expect(press(keys, 'KeyT')).toBeNull();
    });

    it('key labels: a letter or digit as it is, the named keys from the dictionary', () => {
        expect(mod.keyLabel('KeyT')).toBe('T');
        expect(mod.keyLabel('Digit5')).toBe('5');
        expect(mod.keyLabel('Numpad0')).toBe('0');
        expect(mod.keyLabel('Escape')).toBe('Escape');
        expect(mod.keyLabel('Enter')).toBe('Enter');
        expect(mod.keyLabel('F13')).toBe('F13'); // unknown: the code itself
    });
});
