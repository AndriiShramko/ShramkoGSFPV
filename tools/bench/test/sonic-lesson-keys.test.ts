// v0.13 Fly by Sound, lane v13-host stage B (docs/wip/v13-host.md "Stage B"): the pilot's keys and the lesson menu, in the page
// around the sound package's lesson runner. The lesson rig (tools/bench/test/sonic-lesson-rig.ts: the real flight model, lesson
// pilot, mode, bridge, lesson host and runner; a fake engine and drawing) and plain fakes where the rig has none.
//  - B1 (W3): the runner is made with the pilot's path, the names of his keys (as his keyboard layout types them), his speaking
//    speed and the lesson G left (createLessonRunner's path, keys, speechRate, returnTo).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getLesson, lessonPaths } from '../../../packages/sonic-fpv/src';
import { KEYMAP } from '../../../packages/prefs/src/keymap';
import { KeyRouter } from '../../../apps/fly/src/app/keys';
import { DEFAULT_RUNNER_KEYS, KeyNames, codeOfHint, spokenKey } from '../../../apps/fly/src/sonic/key-names';
import { runnerOptions } from '../../../apps/fly/src/sonic/lessons';
import { saveProgress } from '../../../apps/fly/src/sonic/store';
import { mkStore } from '../../../packages/prefs/test/helpers';
import { Rig } from './sonic-lesson-rig';

let rig: Rig | null = null;
afterEach(() => {
    rig?.dispose();
    rig = null;
    vi.restoreAllMocks();
});

async function open(id: string, before?: (r: Rig) => void): Promise<Rig> {
    rig = await Rig.make(getLesson(id));
    before?.(rig);
    expect(await rig.host.open(id)).toBe(true);
    return rig;
}

/** The key names of a page entered through ?sonic= (or not): its router's key table, Escape said by its name. */
function pageNames(sonic = true): KeyNames {
    const router = new KeyRouter({ map: KEYMAP, sonic: () => sonic });
    return new KeyNames((a) => router.caps(a), (code) => (code === 'Escape' ? 'Escape' : null));
}

// ------------------------------------------------------------------ B1

describe('B1 (W3): the runner gets the pilot\'s path, key names, speaking speed and the way back of G', () => {
    it('the names of the keys: N, B and Z from the page\'s key table, Escape by its name; with the pilot\'s layout, what it types on each place', () => {
        const names = pageNames();
        expect(names.runner()).toEqual({ next: 'N', previous: 'B', repeat: 'Z' });
        expect(names.of('pause.toggle', 'Escape')).toBe('Escape');
        expect(names.of('pause.toggle')).toBe('Escape P');
        // a German keyboard types Y on the place of Z (KeyboardLayoutMap gives lower-case characters by code)
        names.setLayout(new Map([['KeyZ', 'y'], ['KeyY', 'z'], ['KeyN', 'n'], ['KeyB', 'b']]));
        expect(names.runner()).toEqual({ next: 'N', previous: 'B', repeat: 'Y' });
        // a French one W
        names.setLayout(new Map([['KeyZ', 'w'], ['KeyW', 'z'], ['KeyQ', 'a'], ['KeyN', 'n'], ['KeyB', 'b']]));
        expect(names.runner().repeat).toBe('W');
        // a place the layout types nothing printable on keeps the table's cap; a named key never takes a layout's character
        names.setLayout(new Map([['KeyZ', ' '], ['Escape', 'x']]));
        expect(names.runner().repeat).toBe('Z');
        expect(names.of('pause.toggle', 'Escape')).toBe('Escape');
        expect(codeOfHint({ cap: 'Shift+N', aria: 'Shift+N' })).toBeNull();
        expect(spokenKey({ cap: '[', aria: '[' }, new Map([['BracketLeft', 'ü']]), () => null)).toBe('[');
    });

    it('the layout is asked of the browser (navigator.keyboard.getLayoutMap) when it has it; without it, or when it refuses, the caps', async () => {
        const names = pageNames();
        await names.refresh({ keyboard: { getLayoutMap: async () => new Map([['KeyZ', 'y']]) } });
        expect(names.runner().repeat).toBe('Y');
        const plain = pageNames();
        await plain.refresh({});
        expect(plain.runner().repeat).toBe('Z');
        const refused = pageNames();
        await refused.refresh({ keyboard: { getLayoutMap: () => Promise.reject(new Error('SecurityError')) } });
        expect(refused.runner().repeat).toBe('Z');
    });

    it('control: on a page without the mode its own key Z has no cap (not routed there), so the runner keeps its own name', () => {
        const names = pageNames(false);
        expect(names.of('sonic.repeat')).toBe('');
        expect(names.runner()).toEqual({ next: 'N', previous: 'B', repeat: DEFAULT_RUNNER_KEYS.repeat });
    });

    it('runnerOptions: the path, the key names and the speaking speed are the page\'s, the way back the opener\'s, the progress the store\'s', () => {
        const store = mkStore();
        saveProgress(store, { lessonId: 'rings-first', version: getLesson('rings-first').version, attempts: 2, successes: 1, blocksPassed: 0, passed: false, bestTimeMs: null, lastAt: '2026-11-08T10:00:00.000Z' });
        const page = { locale: 'en' as const, store, path: () => 'fast' as const, keyNames: () => ({ next: 'J', previous: 'X', repeat: 'Y' }), speechRate: () => 1.5 };
        const start = getLesson('rings-first').start;
        const o = runnerOptions(page, 'rings-first', { start, floorY: 0, objects: null, returnTo: 'hover-height' }, 5);
        expect(o).toMatchObject({ locale: 'en', path: 'fast', keys: { next: 'J', previous: 'X', repeat: 'Y' }, speechRate: 1.5, returnTo: 'hover-height', sessionStartMs: 5, start, floorY: 0 });
        expect(o.progress).toMatchObject({ lessonId: 'rings-first', attempts: 2, successes: 1 });
        expect('objects' in o).toBe(false);
        // a page that gives no names and no speed: the runner's own names, speed 1
        const bare = runnerOptions({ locale: 'en', store, path: () => 'full' }, 'rings-first', { start, floorY: 0, objects: null, returnTo: null }, 0);
        expect(bare).toMatchObject({ path: 'full', speechRate: 1, returnTo: null });
        expect('keys' in bare).toBe(false);
    });

    it('in the page the lesson stands where it is on the pilot\'s path: rings-first is lesson 6 of 8 on the fast path, 20 of 28 on the full one', async () => {
        const paths = lessonPaths();
        const fast = await open('rings-first', (r) => { r.paths = 'fast'; });
        expect(fast.host.runner!.view()).toMatchObject({ path: 'fast', lessonIndex: paths.fast.indexOf('rings-first') + 1, lessonCount: paths.fast.length });
        expect(fast.host.runner!.view().lessonCount).toBe(8);
        fast.dispose();
        rig = null;
        const full = await open('rings-first');
        expect(full.host.runner!.view()).toMatchObject({ path: 'full', lessonIndex: paths.full.indexOf('rings-first') + 1, lessonCount: 28 });
    }, 60000);

    it('the names reach the lesson\'s lines: after three failed attempts in a row hover-height offers the next lesson under the name the page gives N', async () => {
        const r = await open('hover-height', (rr) => { rr.keyNames = { next: 'J', previous: 'X', repeat: 'Y' }; });
        // a pilot who never touches a stick: every attempt runs out
        await r.run(400000, null, () => r.engine.said.some((s) => s.line.key === 'fly.offer-next'));
        const offer = r.engine.said.find((s) => s.line.key === 'fly.offer-next');
        expect(offer, 'the go-on offer after three failures in a row').toBeDefined();
        expect(offer!.line.params).toMatchObject({ key: 'J' });
        expect(offer!.text).toContain('J');
        expect(r.lessonEvents('attempt-fail').length).toBeGreaterThanOrEqual(getLesson('hover-height').pass.attempts);
    }, 300000);
});
