// v0.12 v12-int step 3 (docs/wip/v12-int.md): key I (sonic.status) says, in one press, the lesson's line and then the recording's.
// The key router runs only the LAST handler registered for an action, so the flight side (lesson) and the session side
// (recording) cannot each register I: they add providers to the page's status board (apps/fly/src/app/sonic-status.ts) and the
// flight side's one handler says them in order. Here: the board, the order and the queueing of the lines, and the session side
// as the page builds it (createSonicSession: the recording's line follows the recorder, and it takes no handler of I).
// The flight side's handler is checked in the real page (tools/bench/src/sonic-int-status.ts).
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { SpeechLine } from '../../../packages/sonic-fpv/src';
import { Bus } from '../../../apps/fly/src/app/context';
import type { AppEvents, FlightContext } from '../../../apps/fly/src/app/context';
import { KeyRouter } from '../../../apps/fly/src/app/keys';
import { STATUS_ORDER, StatusBoard, sayStatus, statusBoard } from '../../../apps/fly/src/app/sonic-status';
import { fakeRuntime, sampleAt } from './sonicrec-fixtures';
import type { FakeRuntime } from './sonicrec-fixtures';

type Mod = typeof import('../../../apps/fly/src/sonic-session/session');
let mod: Mod;

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
});

afterEach(() => {
    vi.restoreAllMocks();
});

const line = (key: string): SpeechLine => ({ key });
const keysOf = (l: readonly SpeechLine[]): string[] => l.map((x) => x.key);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function until(what: string, pred: () => boolean, ms = 3000): Promise<void> {
    const t0 = Date.now();
    while (!pred()) {
        if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
        await sleep(5);
    }
}

describe('the status board', () => {
    it('gives every provider\'s line in order of `order`, whatever the order they were added in; equal orders keep the order of adding', () => {
        const b = new StatusBoard();
        b.add({ order: STATUS_ORDER.recording, line: () => line('status.recording-off') });
        b.add({ order: STATUS_ORDER.lesson, line: () => line('status.lesson') });
        b.add({ order: STATUS_ORDER.recording, line: () => line('second.at.twenty') });
        expect(keysOf(b.lines())).toEqual(['status.lesson', 'status.recording-off', 'second.at.twenty']);
    });

    it('a provider with nothing to say (null) or one that throws is left out, the others are said; a removed one is gone', () => {
        const b = new StatusBoard();
        const offLesson = b.add({ order: 10, line: () => line('status.none') });
        b.add({ order: 15, line: () => null });
        b.add({ order: 16, line: () => { throw new Error('broken'); } });
        b.add({ order: 20, line: () => line('status.recording-on') });
        expect(keysOf(b.lines())).toEqual(['status.none', 'status.recording-on']);
        offLesson();
        expect(keysOf(b.lines())).toEqual(['status.recording-on']);
        expect(b.size).toBe(3);
    });

    it('one board per page: the same context gives the same board, another context its own', () => {
        const a = {} as FlightContext;
        const c = {} as FlightContext;
        expect(statusBoard(a)).toBe(statusBoard(a));
        expect(statusBoard(a)).not.toBe(statusBoard(c));
    });

    it('sayStatus says the lines in order: the first cuts what is being said, the others queue behind it', async () => {
        const b = new StatusBoard();
        b.add({ order: 20, line: () => line('status.recording-on') });
        b.add({ order: 10, line: () => line('status.lesson') });
        const said: [string, boolean][] = [];
        await sayStatus(b, async (l, interrupt) => void said.push([l.key, interrupt]));
        expect(said).toEqual([['status.lesson', true], ['status.recording-on', false]]);
    });

    it('control: why the board exists. Two handlers of I on the key router: only the one registered last runs', () => {
        // a page entered through ?sonic= (the sound mode's keys are only on such a page, v12-optin)
        const keys = new KeyRouter({ sonic: () => true });
        const ran: string[] = [];
        keys.on('sonic.status', () => void ran.push('lesson'));
        keys.on('sonic.status', () => void ran.push('recording'));
        keys.route({ code: 'KeyI', shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, repeat: false, target: null, preventDefault() {} } as unknown as KeyboardEvent);
        expect(ran).toEqual(['recording']); // the lesson's line is hidden
    });
});

describe('the session side on the page\'s board', () => {
    const press = (keys: KeyRouter, code: string): string | null =>
        keys.route({ code, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, repeat: false, target: null, preventDefault() {} } as unknown as KeyboardEvent);

    function page(fake: FakeRuntime) {
        // a page entered through ?sonic= (the sound mode's keys are only on such a page, v12-optin)
        const keys = new KeyRouter({ sonic: () => true });
        const events = new Bus<AppEvents>();
        const ctx = { keys, events, sonic: fake.runtime, session: { transform: { s: 1, t: [0, 0, 0] } }, controls: { source: 'keyboard', profile: null }, renderer: { isWebGPU: false } } as unknown as FlightContext;
        return { ctx, keys, events };
    }

    it('the recording\'s line follows the recorder and comes after the lesson\'s; the session side takes no handler of I', async () => {
        const fake = fakeRuntime('walls-hall');
        const { ctx, keys, events } = page(fake);
        // the flight side's provider, as sonic-flight.ts adds it (the lesson host's status line)
        statusBoard(ctx).add({ order: STATUS_ORDER.lesson, line: () => ({ key: 'status.lesson', params: { title: 'The hall', n: 1 } }) });
        const s = mod.createSonicSession(ctx);
        expect(press(keys, 'KeyI')).toBeNull(); // nobody's here: the flight side's handler is the only one in the page
        expect(keysOf(statusBoard(ctx).lines())).toEqual(['status.lesson', 'status.recording-off']);
        // T asks: not on yet
        press(keys, 'KeyT');
        expect(s.recorder.phase).toBe('asking');
        expect(keysOf(statusBoard(ctx).lines())).toEqual(['status.lesson', 'status.recording-off']);
        await sleep(5); // the question has been said
        press(keys, 'KeyT');
        await until('recording', () => s.recorder.phase === 'recording');
        const base = performance.now();
        for (let i = 0; i < 30; i++) events.emit('sonicSample', sampleAt(base + i * 16));
        expect(keysOf(statusBoard(ctx).lines())).toEqual(['status.lesson', 'status.recording-on']);
        press(keys, 'KeyT'); // the pilot's stop
        await until('saved', () => s.recorder.phase === 'idle');
        expect(keysOf(statusBoard(ctx).lines())).toEqual(['status.lesson', 'status.recording-off']);
        s.dispose();
        expect(keysOf(statusBoard(ctx).lines())).toEqual(['status.lesson']); // its provider leaves with it
    });
});
