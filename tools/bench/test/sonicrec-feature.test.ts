// Fly by Sound, step 2 (docs/wip/v12-feedback.md): the recorder as the flight page wires it
// (apps/fly/src/sonic-session/session.ts, installed by app/builtin/sonic-session.ts). The rule of the lane is that every
// hook is a no-op while the sound mode is off, so ordinary flight is unchanged: key T does nothing without ctx.sonic, and
// the bus listeners write nothing unless a recording runs. The page is emulated just far enough for the real key router,
// the real bus and the real dictionaries (the few DOM globals src/i18n.ts reads at import).
import { readFileSync } from 'node:fs';
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
        // struck again before the engine has finished the question: not the pilot's answer
        press(keys, 'KeyT');
        expect(s.recorder.phase).toBe('asking');
        await new Promise((r) => setTimeout(r, 5)); // the engine says the line and settles: now a press is the answer
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
        // after "saved" the pilot is told how to send it (step 8): the invitation comes after the recorder's own line, never before it
        const t2 = Date.now();
        while (fake.spoken.length < 5 && Date.now() - t2 < 3000) await new Promise((r) => setTimeout(r, 5));
        expect(fake.spoken.map((l) => l.key)).toEqual(['rec.ask', 'rec.started', 'rec.stopped', 'rec.saved', 'send.ask']);
        expect(fake.spoken[4]?.params).toEqual({ key: 'U' });
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

    // a held key (repeat) is routed to the session's handler and does nothing there: a probe for "is the session installed" with no effect
    const installed = (keys: KeyRouter): boolean => press(keys, 'KeyT', { repeat: true }) === 'sonic.record';
    async function until(pred: () => boolean, what: string, ms = 3000): Promise<void> {
        const t0 = Date.now();
        while (!pred()) {
            if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
            await new Promise((r) => setTimeout(r, 5));
        }
    }

    it('the feature installs through the same path as every other, brings the session in when the mode starts, and takes itself out again', async () => {
        const fake = fakeRuntime('walls-hall');
        const { ctx, keys, events } = page(fake);
        const off = feature.sonicSession.install(ctx);
        expect(typeof off).toBe('function');
        expect(feature.sonicSession.id).toBe('sonic-session');
        events.emit('frame', { now: 16 });
        await until(() => installed(keys), 'the session side to load');
        expect(press(keys, 'KeyT')).toBe('sonic.record');
        (off as () => void)();
        expect(press(keys, 'KeyT')).toBeNull();
    });

    it('with the sound mode off the feature loads and registers nothing (ordinary flight does not pay for the session side); when the mode starts it does', async () => {
        const fake = fakeRuntime('walls-hall');
        const { ctx, keys, events } = page(null);
        const off = feature.sonicSession.install(ctx);
        for (let i = 0; i < 6; i++) events.emit('frame', { now: i * 16 });
        await new Promise((r) => setTimeout(r, 60)); // time enough for a load that was wrongly started to finish
        expect(press(keys, 'KeyT', { repeat: true })).toBeNull(); // T and U are nobody's: no handler, no bus listener of the session
        expect(press(keys, 'KeyU', { repeat: true })).toBeNull();
        // the mode starts: ctx.sonic appears, the next frame brings the session side in
        (ctx as unknown as { sonic?: unknown }).sonic = fake.runtime;
        events.emit('frame', { now: 200 });
        await until(() => installed(keys), 'the session side to load once the mode runs');
        expect(press(keys, 'KeyU', { repeat: true })).toBe('sonic.send');
        // and it is the whole thing: T asks, the second T (once the question has been read out) records
        expect(press(keys, 'KeyT')).toBe('sonic.record');
        await new Promise((r) => setTimeout(r, 10));
        press(keys, 'KeyT');
        events.emit('sonicSample', sampleAt(performance.now()));
        (off as () => void)();
        expect(press(keys, 'KeyT', { repeat: true })).toBeNull();
    });

    it('a mode that starts and a feature that is taken out before the session side has loaded leave nothing behind', async () => {
        const fake = fakeRuntime('walls-hall');
        const { ctx, keys, events } = page(fake);
        const off = feature.sonicSession.install(ctx);
        events.emit('frame', { now: 16 });
        (off as () => void)(); // gone in the same breath: the load that is on its way must not install a session afterwards
        await new Promise((r) => setTimeout(r, 80));
        expect(press(keys, 'KeyT', { repeat: true })).toBeNull();
    });

    it('the feature file imports the session side only through import(), so the main script of the simulator does not carry it', () => {
        const text = readFileSync(new URL('../../../apps/fly/src/app/builtin/sonic-session.ts', import.meta.url), 'utf8');
        expect(text).toMatch(/import\('\.\.\/\.\.\/sonic-session\/session'\)/);
        const staticImports = [...text.matchAll(/^import\s+(?!type\b)[^;]*from\s+'([^']+)';?/gm)].map((m) => m[1]);
        expect(staticImports.filter((from) => /sonic-session|@shramko\/sonic-fpv/.test(from as string))).toEqual([]);
        // control: the file as the lane wrote it first imported it statically
        expect("import { createSonicSession } from '../../sonic-session/session';").toMatch(/^import\s+(?!type\b)[^;]*from\s+'[^']*sonic-session[^']*'/);
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
