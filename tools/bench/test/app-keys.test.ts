// The flight page's one keydown router (apps/fly/src/app/keys.ts, docs/architecture-v03.md 1.2) over
// the keymap of @gsfpv/prefs: every key press runs at most one handler, no key is bound twice where
// both listen, and a field that takes text keeps its letters (Esc still closes the panel around it).
// Each claim has a negative control that must fire. Node only: the few DOM classes the focus rule
// reads (devices/keyboard.ts typing) are stubbed.
import { beforeAll, describe, expect, it } from 'vitest';
// the same module the app reaches as @gsfpv/prefs (tools/bench does not depend on the package)
import { KEYMAP, keymapProblems } from '../../../packages/prefs/src/keymap';
import type { ActionId, KeyBinding } from '../../../packages/prefs/src/keymap';
import { KeyRouter } from '../../../apps/fly/src/app/keys';

class FakeElement { isContentEditable = false; }
class FakeInput extends FakeElement { constructor(readonly type: string) { super(); } }
class FakeTextArea extends FakeElement {}
class FakeSelect extends FakeElement {}

beforeAll(() => {
    Object.assign(globalThis, { HTMLElement: FakeElement, HTMLInputElement: FakeInput, HTMLTextAreaElement: FakeTextArea, HTMLSelectElement: FakeSelect });
});

interface Press { code: string; shiftKey?: boolean; ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean; repeat?: boolean; target?: unknown }
const key = (p: Press): KeyboardEvent => ({ shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, repeat: false, target: null, preventDefault() { /* */ }, ...p }) as unknown as KeyboardEvent;

/** Every chord of every shipped binding the router routes (not keyboard flying's). */
const routed = (map: readonly KeyBinding[] = KEYMAP) => map.filter((b) => b.status === 'shipped' && !b.flying);
/** ... and of those that listen in `state` (a 'crash' binding such as Enter keeps the wreck only while crashed) */
const listening = (state: 'flight' | 'crash', map: readonly KeyBinding[] = KEYMAP) => routed(map).filter((b) => b.when === 'always' || b.when === state);
const chords = (map: readonly KeyBinding[] = KEYMAP, state?: 'flight' | 'crash') => (state ? listening(state, map) : routed(map)).flatMap((b) => b.keys.map((k) => ({ action: b.action, code: k.code, shiftKey: !!k.shift })));

/** A router with a counting handler on every routed action. */
function counting(map: readonly KeyBinding[] = KEYMAP, o: ConstructorParameters<typeof KeyRouter>[0] = {}) {
    const r = new KeyRouter({ map, ...o });
    const runs = new Map<ActionId, number>();
    for (const b of routed(map)) r.on(b.action, () => runs.set(b.action, (runs.get(b.action) ?? 0) + 1));
    const total = () => [...runs.values()].reduce((a, n) => a + n, 0);
    return { r, runs, total };
}

describe('one handler per key press, no key bound twice', () => {
    it('the shipped keymap binds no key twice where both listen', () => {
        expect(keymapProblems(KEYMAP)).toEqual([]);
    });

    it('each routed chord runs exactly one handler, its own action, in flight and while crashed', () => {
        for (const state of ['flight', 'crash'] as const) {
            const { r, runs, total } = counting(KEYMAP, { state: () => state });
            for (const c of chords(KEYMAP, state)) {
                const before = total();
                expect(r.route(key(c)), `${c.code} (${state})`).toBe(c.action);
                expect(total() - before, c.code).toBe(1);
            }
            expect([...runs.keys()].sort()).toEqual(listening(state).map((b) => b.action).sort());
            // a binding that does not listen in this state runs nothing
            for (const b of routed().filter((x) => !listening(state).includes(x))) for (const k of b.keys) expect(r.route(key({ code: k.code, shiftKey: !!k.shift })), `${k.code} (${state})`).toBeNull();
        }
    });

    it('the keys the page handled at the start of wave 1 all route: Esc P R F3 V C H', () => {
        const { r } = counting();
        expect(['Escape', 'KeyP', 'KeyR', 'F3', 'KeyV', 'KeyC', 'KeyH'].map((code) => r.route(key({ code })))).toEqual(
            ['pause.toggle', 'pause.toggle', 'respawn.start', 'frameStats.toggle', 'voxels.cycle', 'walls.toggle', 'hud.toggle']);
    });

    it('keyboard flying keys (W A S D, arrows, Space) and harness keys (F13-F24) are never routed', () => {
        const { r, total } = counting();
        for (const code of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'F13', 'F20', 'F24']) expect(r.route(key({ code })), code).toBeNull();
        expect(total()).toBe(0);
    });

    it('M is routed for every input: the mode key (wave 2; review findings C3, C12)', () => {
        const { r, runs } = counting();
        expect(r.route(key({ code: 'KeyM' }))).toBe('mode.cycle');
        expect(runs.get('mode.cycle')).toBe(1);
    });

    it('a stack per action: the last handler runs alone; unregistering gives the action back', () => {
        const r = new KeyRouter();
        const ran: string[] = [];
        r.on('pause.toggle', () => ran.push('base'));
        const off = r.on('pause.toggle', () => ran.push('menu'));
        r.route(key({ code: 'KeyP' }));
        off();
        r.route(key({ code: 'KeyP' }));
        expect(ran).toEqual(['menu', 'base']);
    });

    it('v12-optin review R4: a handler whose `when` says no hands the press to the one before it (a key press and a switch alike); says yes, it runs alone', () => {
        const r = new KeyRouter();
        const ran: string[] = [];
        let dialog = true;
        r.on('help.keys', () => ran.push('card'));
        r.on('help.keys', () => ran.push('mode'), { when: () => !dialog });
        r.route(key({ code: 'KeyK' }));
        r.trigger('help.keys');
        dialog = false;
        r.route(key({ code: 'KeyK' }));
        r.trigger('help.keys');
        expect(ran).toEqual(['card', 'card', 'mode', 'mode']);
        // control: with no handler that takes it, nothing ran and the router says so
        const lone = new KeyRouter();
        lone.on('help.keys', () => ran.push('never'), { when: () => false });
        expect(lone.route(key({ code: 'KeyK' }))).toBeNull();
        expect(lone.trigger('help.keys')).toBeNull();
        expect(ran).not.toContain('never');
    });

    it('v12-optin review R4: a page\'s own words for a key in the key list stand while given, the last given first, and go back with it', () => {
        const r = new KeyRouter();
        const b = KEYMAP.find((x) => x.action === 'share.open')!;
        expect(r.labelOf(b)).toBe(b.labelKey);
        const off = r.relabel('share.open', 'keys.sonic.shareLink');
        expect(r.labelOf(b)).toBe('keys.sonic.shareLink');
        const off2 = r.relabel('share.open', 'other');
        expect(r.labelOf(b)).toBe('other');
        off2();
        expect(r.labelOf(b)).toBe('keys.sonic.shareLink');
        off();
        expect(r.labelOf(b)).toBe(b.labelKey);
        // control: another action keeps its own words
        const k = KEYMAP.find((x) => x.action === 'help.keys')!;
        r.relabel('share.open', 'keys.sonic.shareLink');
        expect(r.labelOf(k)).toBe(k.labelKey);
    });

    it('only shipped, routed bindings take handlers (a planned or flying one would never run)', () => {
        // N as it was until W3-1 shipped it: a planned binding
        const r = new KeyRouter({ map: KEYMAP.map((b) => (b.action === 'scene.next' ? { ...b, status: 'planned' as const } : b)) });
        expect(() => r.on('scene.next', () => undefined)).toThrow(/planned/);
        expect(() => new KeyRouter().on('scene.next', () => undefined)).not.toThrow();
        expect(() => r.on('arm.toggle', () => undefined)).toThrow(/keyboard flying/);
        expect(() => r.on('mode.cycle', () => undefined)).not.toThrow();
        expect(() => r.on('no.such', () => undefined)).toThrow(/no key binding/);
        expect(r.routes('pause.toggle')).toBe(true);
        expect(r.routes('arm.toggle')).toBe(false);
    });

    it('Ctrl, Alt and Meta chords stay the browser\'s', () => {
        const { r, total } = counting();
        for (const m of ['ctrlKey', 'altKey', 'metaKey'] as const) expect(r.route(key({ code: 'KeyR', [m]: true }))).toBeNull();
        expect(total()).toBe(0);
    });

    it('the menu key-caps come from the keymap: v0.2 PAUSE_KEYS, cap for cap', () => {
        const r = new KeyRouter();
        expect(r.caps('pause.toggle')).toEqual([{ cap: 'Esc', aria: 'Escape' }, { cap: 'P', aria: 'P' }]);
        expect(r.caps('respawn.start')).toEqual([{ cap: 'R', aria: 'R' }]);
    });

    it('control: a planted second binding of C where both listen is caught, and the router could never run it', () => {
        const dupe: KeyBinding = { action: 'test.dupe', keys: [{ code: 'KeyC', cap: 'C', aria: 'C' }], when: 'flight', labelKey: 'keys.test.dupe', status: 'shipped' };
        const map = [...KEYMAP, dupe];
        expect(keymapProblems(map)).toEqual(['KeyC is bound to walls.toggle and test.dupe (always / flight)']);
        const { r, runs } = counting(map);
        r.route(key({ code: 'KeyC' }));
        expect(runs.get('walls.toggle')).toBe(1);
        expect(runs.get('test.dupe')).toBeUndefined(); // shadowed: exactly what the rule prevents
    });
});

describe('the sound mode\'s keys are on a page entered through ?sonic= only (v12-optin)', () => {
    const SOUND: [string, ActionId][] = [['KeyT', 'sonic.record'], ['KeyU', 'sonic.send'], ['KeyI', 'sonic.status'], ['KeyZ', 'sonic.repeat'], ['KeyG', 'sonic.glossary'], ['KeyX', 'sonic.home']];
    /** The keymap as v0.12 was released (8ce53fb): the five keys always. */
    const RELEASED = KEYMAP.map((b) => (b.when === 'sonic' ? { ...b, when: 'always' as const } : b));

    it('an ordinary page (the router\'s default): T U I Z G run no handler even when one is registered, show no caps, are not listed, routed or triggered; control: the released keymap routes and lists all five', () => {
        for (const state of ['flight', 'crash'] as const) {
            const { r, total } = counting(KEYMAP, { state: () => state });
            for (const [code, action] of SOUND) {
                expect(r.route(key({ code })), `${code} ${state}`).toBeNull();
                expect(r.caps(action)).toEqual([]);
                expect(r.routes(action)).toBe(false);
                expect(r.trigger(action)).toBeNull();
            }
            expect(total()).toBe(0);
            expect(r.listed().map((b) => b.action).filter((a) => a.startsWith('sonic.'))).toEqual([]);
            const old = counting(RELEASED, { state: () => state });
            for (const [code, action] of SOUND) expect(old.r.route(key({ code })), `${code} ${state} released`).toBe(action);
            expect(old.r.listed().filter((b) => b.action.startsWith('sonic.'))).toHaveLength(SOUND.length);
        }
    });

    it('a page entered through ?sonic=: each runs its handler once, in flight and while crashed, with its caps, listed in table order', () => {
        for (const state of ['flight', 'crash'] as const) {
            const { r, runs } = counting(KEYMAP, { state: () => state, sonic: () => true });
            for (const [code, action] of SOUND) {
                expect(r.route(key({ code })), `${code} ${state}`).toBe(action);
                expect(runs.get(action)).toBe(1);
                expect(r.caps(action).map((k) => k.cap)).toEqual([code.slice(3)]);
                expect(r.routes(action)).toBe(true);
            }
            expect(r.listed().map((b) => b.action)).toEqual(KEYMAP.filter((b) => b.status === 'shipped').map((b) => b.action));
            expect(r.trigger('sonic.status')).toBe('sonic.status');
        }
    });

    it('the page is asked at each press, not once: the same router before and after the page says ?sonic=', () => {
        let sonic = false;
        const { r, runs } = counting(KEYMAP, { sonic: () => sonic });
        expect(r.route(key({ code: 'KeyT' }))).toBeNull();
        sonic = true;
        expect(r.route(key({ code: 'KeyT' }))).toBe('sonic.record');
        expect(runs.get('sonic.record')).toBe(1);
    });
});

describe('focus in a field that takes text', () => {
    const shortcuts = ['KeyP', 'KeyR', 'F3', 'KeyV', 'KeyC', 'KeyH'];

    it('a text input, a text area and a select keep their keys; Esc still routes (it closes the panel around the field)', () => {
        for (const target of [new FakeInput('text'), new FakeInput('number'), new FakeTextArea(), new FakeSelect()]) {
            const { r, total } = counting();
            for (const code of shortcuts) expect(r.route(key({ code, target })), `${code} in ${target.constructor.name}`).toBeNull();
            expect(total()).toBe(0);
            expect(r.route(key({ code: 'Escape', target }))).toBe('pause.toggle');
        }
    });

    it('a focused slider, checkbox or button does not swallow R, P or Esc (v0.2)', () => {
        for (const type of ['range', 'checkbox', 'button']) {
            const { r } = counting();
            expect(r.route(key({ code: 'KeyR', target: new FakeInput(type) })), type).toBe('respawn.start');
            expect(r.route(key({ code: 'KeyP', target: new FakeInput(type) })), type).toBe('pause.toggle');
        }
    });

    it('a contenteditable element keeps its keys', () => {
        const el = new FakeElement();
        el.isContentEditable = true;
        expect(counting().r.route(key({ code: 'KeyR', target: el }))).toBeNull();
    });

    it('control: without the focus rule the same R in a text field would respawn', () => {
        const { r, runs } = counting(KEYMAP, { isText: () => false });
        expect(r.route(key({ code: 'KeyR', target: new FakeInput('text') }))).toBe('respawn.start');
        expect(runs.get('respawn.start')).toBe(1);
    });
});

describe('screens with keys of their own, and the listener', () => {
    it('while a block holds (the Controls screen), nothing routes, Esc included; released, keys route again', () => {
        const { r, total } = counting();
        let up = true;
        const off = r.block(() => up);
        for (const code of ['Escape', 'KeyP', 'KeyR', 'F3', 'KeyV']) expect(r.route(key({ code }))).toBeNull();
        expect(total()).toBe(0);
        up = false; // control: the same router routes once the screen is gone
        expect(r.route(key({ code: 'KeyR' }))).toBe('respawn.start');
        up = true;
        off();
        expect(r.route(key({ code: 'KeyR' }))).toBe('respawn.start');
    });

    it('attach listens for keydown on the target until detached', () => {
        const listeners = new Set<(e: Event) => void>();
        const target = {
            addEventListener: (type: string, cb: (e: Event) => void) => { if (type === 'keydown') listeners.add(cb); },
            removeEventListener: (type: string, cb: (e: Event) => void) => { if (type === 'keydown') listeners.delete(cb); }
        } as unknown as Window;
        const { r, runs } = counting();
        const detach = r.attach(target);
        for (const cb of listeners) cb(key({ code: 'KeyV' }) as unknown as Event);
        detach();
        for (const cb of listeners) cb(key({ code: 'KeyV' }) as unknown as Event);
        expect(listeners.size).toBe(0);
        expect(runs.get('voxels.cycle')).toBe(1);
    });
});

describe('Shift held as the game scheme\'s descent (v0.9; the review of 2026-10-16 for v0.8\'s boost)', () => {
    it('a pilot holding Shift to land still pauses, respawns and so on: the real chord first, then the key alone; control: without the rule Shift drops them', () => {
        const flying = { on: true };
        const { r, runs } = counting(KEYMAP, { shiftIsFlying: () => flying.on });
        const all = chords(KEYMAP, 'flight');
        const shifted = new Set(all.filter((c) => c.shiftKey).map((c) => c.code));
        // a chord that names Shift (Shift+N, Shift+F, Shift+[ and Shift+]) is that chord; every other key is the key alone
        for (const c of all.filter((x) => !x.shiftKey && !shifted.has(x.code))) {
            runs.clear();
            expect(r.route(key({ code: c.code, shiftKey: true })), `${c.code} with Shift held to descend`).toBe(c.action);
        }
        expect(r.route(key({ code: 'KeyN', shiftKey: true }))).toBe('scene.random');
        expect(r.route(key({ code: 'KeyF', shiftKey: true }))).toBe('scene.favourite');
        expect(r.route(key({ code: 'KeyF' }))).toBe('fullscreen.toggle');
        // Shift is not held as a flying key: Shift+Esc is nothing, as before
        flying.on = false;
        expect(r.route(key({ code: 'Escape', shiftKey: true }))).toBeNull();
        // control: the router without the rule, Shift held
        const C = counting(KEYMAP);
        const lost = ['Escape', 'KeyP', 'KeyR', 'KeyM', 'KeyK', 'KeyH', 'KeyC'].filter((code) => C.r.route(key({ code, shiftKey: true })) === null);
        expect(lost).toEqual(['Escape', 'KeyP', 'KeyR', 'KeyM', 'KeyK', 'KeyH', 'KeyC']);
        expect(C.r.route(key({ code: 'KeyN', shiftKey: true }))).toBe('scene.random');
    });
});
