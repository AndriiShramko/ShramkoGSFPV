import { describe, expect, it } from 'vitest';
import { KEYMAP, V02_PAUSE_ITEMS, actionFor, bindingOf, keymapProblems, keysFor } from '../src/keymap';
import type { KeyBinding, KeyPress } from '../src/keymap';

/** v0.2's PAUSE_KEYS, copied from apps/fly/src/ui/flight.ts at the v0.2 commit (60fa9de). */
const V02_PAUSE_KEYS = {
    resume: [{ cap: 'Esc', aria: 'Escape' }, { cap: 'P', aria: 'P' }],
    restart: [{ cap: 'R', aria: 'R' }]
};

/** The table of docs/architecture-v03.md 1.2: action -> caps, in order. */
const DESIGN_TABLE: Record<string, string[]> = {
    'pause.toggle': ['Esc', 'P'],
    'respawn.start': ['R'],
    'respawn.rewind': ['Y'],
    'crash.keep': ['Enter'],
    'scene.next': ['N'],
    'scene.random': ['Shift+N'],
    'scene.favourite': ['F'],
    'mode.cycle': ['M'],
    'voxels.cycle': ['V'],
    'hud.toggle': ['H'],
    'scale.down': ['['],
    'scale.up': [']'],
    'record.toggle': ['F9'],
    'frameStats.toggle': ['F3'],
    'settings.open': ['O']
};

/**
 * Keys the app handled when wave 1 started that the design table does not list: C (walls on / off,
 * on main since release e5fad2d5182f) and Space (arm, keyboard flying since v0.1).
 */
const V02_EXTRA: Record<string, string[]> = {
    'walls.toggle': ['C'],
    'arm.toggle': ['Space']
};

/**
 * Every key the page handled at the start of wave 1 (main.ts keydown, the Hud's H, devices/keyboard.ts
 * Space and M): the shipped bindings. Space is keyboard flying's own (flying: true); M was too until
 * wave 2 routed it as the mode key for every input.
 */
const SHIPPED_AT_WAVE1 = ['arm.toggle', 'frameStats.toggle', 'hud.toggle', 'mode.cycle', 'pause.toggle', 'respawn.start', 'voxels.cycle', 'walls.toggle'];
/** Flipped in wave 2 by the agent whose feature handles them (W2-1: O opens Settings). */
const SHIPPED_IN_WAVE2 = ['settings.open'];

const press = (code: string, extra: Partial<KeyPress> = {}): KeyPress => ({ code, shiftKey: false, ...extra });
const plant = (b: Partial<KeyBinding> & Pick<KeyBinding, 'action' | 'keys'>): KeyBinding[] =>
    [...KEYMAP, { when: 'always', labelKey: `keys.${b.action}`, status: 'planned', ...b }];

describe('keymap table (1.2)', () => {
    it('has exactly the design table plus the v0.2 keys it did not list, action for action and cap for cap', () => {
        const got = Object.fromEntries(KEYMAP.map((b) => [b.action, b.keys.map((k) => k.cap)]));
        expect(got).toEqual({ ...DESIGN_TABLE, ...V02_EXTRA });
    });

    it('is sound: no key twice where both listen, no flying or harness key, labels keys.<action>', () => {
        expect(keymapProblems(KEYMAP)).toEqual([]);
    });

    it('a letter cap names its own key (a copy-paste slip is caught here)', () => {
        for (const b of KEYMAP) for (const k of b.keys) {
            const m = /^Key([A-Z])$/.exec(k.code);
            if (m) expect(k.cap.replace(/^Shift\+/, '')).toBe(m[1]);
        }
    });
});

describe('v0.2 keys keep working', () => {
    it('keysFor gives v0.2 PAUSE_KEYS for the two pause items that had keys', () => {
        expect(keysFor(V02_PAUSE_ITEMS.resume)).toEqual(V02_PAUSE_KEYS.resume);
        expect(keysFor(V02_PAUSE_ITEMS.restart)).toEqual(V02_PAUSE_KEYS.restart);
    });

    it('P, Esc, R, F3, V, C and H route in flight and while crashed, as main.ts and the Hud did', () => {
        for (const state of ['flight', 'crash'] as const) {
            expect(actionFor(press('KeyP'), state)).toBe('pause.toggle');
            expect(actionFor(press('Escape'), state)).toBe('pause.toggle');
            expect(actionFor(press('KeyR'), state)).toBe('respawn.start');
            expect(actionFor(press('F3'), state)).toBe('frameStats.toggle');
            expect(actionFor(press('KeyV'), state)).toBe('voxels.cycle');
            expect(actionFor(press('KeyC'), state)).toBe('walls.toggle');
            expect(actionFor(press('KeyH'), state)).toBe('hud.toggle');
        }
    });

    it('only the keys the page handled at the start of wave 1 are shipped, so the refactor changes no key', () => {
        // wave 2 adds its own (SHIPPED_IN_WAVE2)
        expect(KEYMAP.filter((b) => b.status === 'shipped').map((b) => b.action).sort()).toEqual([...SHIPPED_AT_WAVE1, ...SHIPPED_IN_WAVE2].sort());
    });

    it('Space is keyboard flying\'s own (shown, never routed); M is the mode key for every input (routed, wave 2)', () => {
        expect(KEYMAP.filter((b) => b.flying).map((b) => b.action).sort()).toEqual(['arm.toggle']);
        expect(keysFor('mode.cycle')).toEqual([{ cap: 'M', aria: 'M' }]);
        expect(keysFor('arm.toggle')).toEqual([{ cap: 'Space', aria: 'Space' }]);
        for (const state of ['flight', 'crash'] as const) {
            expect(actionFor(press('KeyM'), state)).toBe('mode.cycle');
            expect(actionFor(press('Space'), state)).toBeNull();
        }
        // control: the same M binding marked flying (as in wave 1) is never routed: a radio pilot's M did nothing (review C3, C12)
        const flying = KEYMAP.map((b) => (b.action === 'mode.cycle' ? { ...b, flying: true as const } : b));
        expect(actionFor(press('KeyM'), 'flight', { map: flying })).toBeNull();
    });

    it('control: a planned key routes nothing and shows no cap, until asked for', () => {
        // F9 (recording, wave 3); settings.open (O) was the example until W2-1 shipped it
        expect(actionFor(press('F9'), 'flight')).toBeNull();
        expect(keysFor('record.toggle')).toEqual([]);
        expect(actionFor(press('F9'), 'flight', { planned: true })).toBe('record.toggle');
        expect(keysFor('record.toggle', { planned: true })).toEqual([{ cap: 'F9', aria: 'F9' }]);
        expect(actionFor(press('KeyO'), 'flight')).toBe('settings.open');
    });
});

describe('lookup', () => {
    it('N and Shift+N are different actions', () => {
        expect(actionFor(press('KeyN'), 'flight', { planned: true })).toBe('scene.next');
        expect(actionFor(press('KeyN', { shiftKey: true }), 'flight', { planned: true })).toBe('scene.random');
    });

    it('Ctrl, Alt and Meta chords stay the browser\'s (Ctrl+R reloads, Ctrl+P prints)', () => {
        expect(actionFor(press('KeyR', { ctrlKey: true }), 'flight')).toBeNull();
        expect(actionFor(press('KeyP', { metaKey: true }), 'flight')).toBeNull();
        expect(actionFor(press('F3', { altKey: true }), 'flight')).toBeNull();
    });

    it('a crash-only key does not fire in flight', () => {
        expect(actionFor(press('Enter'), 'crash', { planned: true })).toBe('crash.keep');
        expect(actionFor(press('Enter'), 'flight', { planned: true })).toBeNull();
    });

    it('flying keys route nothing', () => {
        for (const code of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']) {
            expect(actionFor(press(code), 'flight', { planned: true })).toBeNull();
        }
    });

    it('bindingOf finds a binding and misses an unknown action', () => {
        expect(bindingOf('record.toggle')?.keys[0].code).toBe('F9');
        expect(bindingOf('no.such')).toBeUndefined();
    });
});

describe('negative controls: keymapProblems catches every planted mistake', () => {
    it('a key bound twice where both listen (planted P in flight, next to Esc/P always)', () => {
        const p = keymapProblems(plant({ action: 'test.dupe', keys: [{ code: 'KeyP', cap: 'P', aria: 'P' }], when: 'flight' }));
        expect(p).toHaveLength(1);
        expect(p[0]).toContain('KeyP is bound to pause.toggle and test.dupe');
    });

    it('two crash-only bindings on one key', () => {
        expect(keymapProblems(plant({ action: 'test.crash', keys: [{ code: 'Enter', cap: 'Enter', aria: 'Enter' }], when: 'crash' }))).toHaveLength(1);
    });

    it('but one key in flight and another action on it while crashed is allowed', () => {
        const map: KeyBinding[] = [
            { action: 'a.flight', keys: [{ code: 'KeyJ', cap: 'J', aria: 'J' }], when: 'flight', labelKey: 'keys.a.flight', status: 'planned' },
            { action: 'a.crash', keys: [{ code: 'KeyJ', cap: 'J', aria: 'J' }], when: 'crash', labelKey: 'keys.a.crash', status: 'planned' }
        ];
        expect(keymapProblems(map)).toEqual([]);
    });

    it('Shift+P does not collide with P', () => {
        expect(keymapProblems(plant({ action: 'test.shift', keys: [{ code: 'KeyP', shift: true, cap: 'Shift+P', aria: 'Shift+P' }] }))).toEqual([]);
    });

    it('each keyboard-flying key taken by a menu action', () => {
        for (const code of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']) {
            const p = keymapProblems(plant({ action: 'test.fly', keys: [{ code, cap: code, aria: code }] }));
            expect(p.some((s) => s.includes('keyboard-flying key')), code).toBe(true);
        }
    });

    it('Space (arm) taken by a routed action, even with arm.toggle removed', () => {
        const map = KEYMAP.filter((b) => b.action !== 'arm.toggle');
        const p = keymapProblems([...map, { action: 'test.space', keys: [{ code: 'Space', cap: 'Space', aria: 'Space' }], when: 'flight', labelKey: 'keys.test.space', status: 'planned' }]);
        expect(p).toEqual(['test.space: Space is a keyboard-flying key']);
    });

    it('a binding marked flying on a key keyboard flying does not read (V)', () => {
        const map = KEYMAP.map((b) => (b.action === 'voxels.cycle' ? { ...b, flying: true as const } : b));
        expect(keymapProblems(map)).toEqual(['voxels.cycle: KeyV is marked flying, but keyboard flying does not read it']);
    });

    it('M taken by anything but the mode cycle', () => {
        const map = KEYMAP.map((b) => (b.action === 'hud.toggle' ? { ...b, keys: [{ code: 'KeyM', cap: 'M', aria: 'M' }] } : b));
        expect(keymapProblems(map).some((s) => s.includes('belongs to keyboard flying (mode.cycle)'))).toBe(true);
    });

    it('a latency-harness key (F13-F24)', () => {
        expect(keymapProblems(plant({ action: 'test.f20', keys: [{ code: 'F20', cap: 'F20', aria: 'F20' }] }))[0]).toContain('latency harness');
    });

    it('an action listed twice, a wrong label and a two-key aria value', () => {
        const p = keymapProblems(plant({ action: 'hud.toggle', keys: [{ code: 'KeyK', cap: 'K', aria: 'K L' }], labelKey: 'keys.hud' }));
        expect(p.some((s) => s.includes('listed twice'))).toBe(true);
        expect(p.some((s) => s.includes('is not keys.hud.toggle'))).toBe(true);
        expect(p.some((s) => s.includes('aria "K L"'))).toBe(true);
    });
});
