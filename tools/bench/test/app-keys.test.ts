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
const chords = (map: readonly KeyBinding[] = KEYMAP) => routed(map).flatMap((b) => b.keys.map((k) => ({ action: b.action, code: k.code, shiftKey: !!k.shift })));

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
            for (const c of chords()) {
                const before = total();
                expect(r.route(key(c)), `${c.code} (${state})`).toBe(c.action);
                expect(total() - before, c.code).toBe(1);
            }
            expect([...runs.keys()].sort()).toEqual(routed().map((b) => b.action).sort());
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

    it('only shipped, routed bindings take handlers (a planned or flying one would never run)', () => {
        const r = new KeyRouter();
        expect(() => r.on('record.toggle', () => undefined)).toThrow(/planned/);
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
