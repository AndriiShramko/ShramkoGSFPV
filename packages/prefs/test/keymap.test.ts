import { describe, expect, it } from 'vitest';
import { FLYING_CODES, KEYMAP, V02_PAUSE_ITEMS, actionFor, bindingOf, keymapProblems, keysFor, listensIn, pageBindings } from '../src/keymap';
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
    'scale.down': ['[', 'Shift+['], // Shift: x2 steps (owner's message 16, scale up to x100)
    'scale.up': [']', 'Shift+]'],
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
/** Keys shipped in wave 2, by the agent whose feature handles them. */
const SHIPPED_IN_WAVE2: readonly string[] = [
    // W2-1: O opens Settings
    'settings.open',
    // W2-2 respawn: Y rewinds, Enter keeps the wreck (C.10)
    'respawn.rewind', 'crash.keep',
    // W3-5: F9, REC on the recording bar
    'record.toggle',
    // W3-1: N next scene, Shift+N random scene, F next favourite (E.5)
    'scene.next', 'scene.random', 'scene.favourite',
    // W3-3: [ and ] scene smaller / larger around the drone (E.7)
    'scale.down', 'scale.up',
    // W5: B opens the feedback dialog (bug / idea / cooperation)
    'feedback.open',
    // v0.7 D1: L shares the scene flown (the share panel)
    'share.open',
    // v0.8 lane A: K shows the keyboard's key card on demand (app/builtin/play.ts)
    'help.keys',
    // v0.9 lane B: F toggles full screen (app/builtin/play.ts)
    'fullscreen.toggle',
    // lane center-throttle: J, the throttle style (app/builtin/throttle-style.ts)
    'throttle.style'
];
/** Keys shipped for Fly by Sound (v0.12, docs/wip/v12-plan.md sections 1 and 3): bound at step 0, handled by the lanes' features. */
const SHIPPED_IN_V12: readonly string[] = ['sonic.record', 'sonic.send', 'sonic.status', 'sonic.repeat', 'sonic.glossary'];
/** Lane sonic-hints: X leaves a lesson for the mode's main menu (sonic/feature.ts). Every key of the mode: */
const MODE_KEYS: readonly string[] = [...SHIPPED_IN_V12, 'sonic.home'];

/** Keys added after the design table, by the agent whose feature handles them. */
const ADDED_AFTER_DESIGN: Record<string, string[]> = {
    'feedback.open': ['B'],
    'share.open': ['L'],
    'help.keys': ['K'],
    // v0.9 lane B: F is full screen; the design table's F (next favourite scene) moved to Shift+F
    'fullscreen.toggle': ['F'],
    'scene.favourite': ['Shift+F'],
    // lane center-throttle: J flips a radio's or gamepad's left stick between in the centre and from zero
    'throttle.style': ['J'],
    // v0.12 Fly by Sound: T records, U sends, I says the status, Z repeats the last line, G opens the glossary
    'sonic.record': ['T'],
    'sonic.send': ['U'],
    'sonic.status': ['I'],
    'sonic.repeat': ['Z'],
    'sonic.glossary': ['G'],
    // lane sonic-hints: X, the mode's main menu from a lesson
    'sonic.home': ['X']
};

const press = (code: string, extra: Partial<KeyPress> = {}): KeyPress => ({ code, shiftKey: false, ...extra });
const plant = (b: Partial<KeyBinding> & Pick<KeyBinding, 'action' | 'keys'>): KeyBinding[] =>
    [...KEYMAP, { when: 'always', labelKey: `keys.${b.action}`, status: 'planned', ...b }];

describe('keymap table (1.2)', () => {
    it('has exactly the design table plus the v0.2 keys it did not list, action for action and cap for cap', () => {
        const got = Object.fromEntries(KEYMAP.map((b) => [b.action, b.keys.map((k) => k.cap)]));
        expect(got).toEqual({ ...DESIGN_TABLE, ...V02_EXTRA, ...ADDED_AFTER_DESIGN });
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

    it('only the keys the page handled at the start of wave 1 are shipped, so the refactor changes no key (plus those wave 2 and v0.12 shipped)', () => {
        expect(KEYMAP.filter((b) => b.status === 'shipped').map((b) => b.action).sort()).toEqual([...SHIPPED_AT_WAVE1, ...SHIPPED_IN_WAVE2, ...MODE_KEYS].sort());
    });

    it('Fly by Sound\'s T U I Z G route in flight and while crashed on a page entered through ?sonic=, with no Shift, Ctrl, Alt or Meta; none is a keyboard-flying key', () => {
        const want: Record<string, string> = { KeyT: 'sonic.record', KeyU: 'sonic.send', KeyI: 'sonic.status', KeyZ: 'sonic.repeat', KeyG: 'sonic.glossary' };
        for (const state of ['flight', 'crash'] as const) {
            for (const [code, action] of Object.entries(want)) {
                expect(actionFor(press(code), state, { sonic: true }), `${code} ${state}`).toBe(action);
                expect(actionFor(press(code, { shiftKey: true }), state, { sonic: true }), `Shift+${code} ${state}`).toBeNull();
                expect(actionFor(press(code, { ctrlKey: true }), state, { sonic: true }), `Ctrl+${code} ${state}`).toBeNull();
            }
        }
        for (const code of Object.keys(want)) expect(FLYING_CODES).not.toContain(code);
        // the labels sit where the mode's key list reads them: keys.<action>
        for (const action of MODE_KEYS) expect(bindingOf(action)?.labelKey).toBe(`keys.${action}`);
    });

    it('control: a sixth action planted on one of the five letters is caught as a double binding', () => {
        const p = keymapProblems(plant({ action: 'test.t', keys: [{ code: 'KeyT', cap: 'T', aria: 'T' }], status: 'shipped' }));
        expect(p).toHaveLength(1);
        expect(p[0]).toContain('KeyT is bound to sonic.record and test.t');
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
        // N as it was until W3-1 shipped it (O, F9 and N were the example until W2-1, W3-5 and W3-1 shipped them)
        const planned = KEYMAP.map((b) => (b.action === 'scene.next' ? { ...b, status: 'planned' as const } : b));
        expect(actionFor(press('KeyN'), 'flight', { map: planned })).toBeNull();
        expect(keysFor('scene.next', { map: planned })).toEqual([]);
        expect(actionFor(press('KeyN'), 'flight', { planned: true, map: planned })).toBe('scene.next');
        expect(keysFor('scene.next', { planned: true, map: planned })).toEqual([{ cap: 'N', aria: 'N' }]);
        expect(actionFor(press('KeyN'), 'flight')).toBe('scene.next');
        expect(actionFor(press('KeyO'), 'flight')).toBe('settings.open');
    });
});

describe('the sound mode\'s keys exist only in the mode (v12-optin: when \'sonic\')', () => {
    const SOUND_CODES = ['KeyT', 'KeyU', 'KeyI', 'KeyZ', 'KeyG', 'KeyX'];
    /** The keymap as v0.12 was released (8ce53fb): the same five bindings, when 'always'. The control of the tests here. */
    const RELEASED = KEYMAP.map((b) => (b.when === 'sonic' ? { ...b, when: 'always' as const } : b));

    it('the five and only the five are the mode\'s', () => {
        expect(KEYMAP.filter((b) => b.when === 'sonic').map((b) => b.action)).toEqual([...MODE_KEYS]);
    });

    it('a page without ?sonic=: T U I Z G route nothing, in flight or crashed; control: the released keymap routes all five', () => {
        for (const state of ['flight', 'crash'] as const) {
            for (const code of SOUND_CODES) {
                expect(actionFor(press(code), state), `${code} ${state}`).toBeNull();
                expect(actionFor(press(code), state, { sonic: false }), `${code} ${state}`).toBeNull();
                expect(actionFor(press(code), state, { map: RELEASED }), `${code} ${state} released`).not.toBeNull();
            }
        }
        // every other key still routes there as it did
        expect(actionFor(press('KeyL'), 'flight')).toBe('share.open');
        expect(actionFor(press('KeyK'), 'flight')).toBe('help.keys');
    });

    it('a page without ?sonic= lists and captions none of them; with ?sonic= they are listed where the table has them; control: released, all five listed', () => {
        const plain = pageBindings().map((b) => b.action);
        const sonic = pageBindings({ sonic: true }).map((b) => b.action);
        for (const a of MODE_KEYS) {
            expect(plain).not.toContain(a);
            expect(keysFor(a)).toEqual([]);
            const k = bindingOf(a)!.keys[0];
            expect(keysFor(a, { sonic: true })).toEqual([{ cap: k.cap, aria: k.aria }]);
        }
        expect(sonic).toEqual(KEYMAP.filter((b) => b.status === 'shipped').map((b) => b.action));
        expect(plain).toEqual(sonic.filter((a) => !MODE_KEYS.includes(a)));
        expect(pageBindings({ map: RELEASED }).map((b) => b.action)).toEqual(sonic);
    });

    it('a mode key listens in both states (on its pages); a planned one stays hidden on a ?sonic= page too', () => {
        const b = bindingOf('sonic.record')!;
        expect(listensIn(b, 'flight')).toBe(true);
        expect(listensIn(b, 'crash')).toBe(true);
        expect(listensIn(bindingOf('crash.keep')!, 'flight')).toBe(false);
        const planned = KEYMAP.map((x) => (x.action === 'sonic.glossary' ? { ...x, status: 'planned' as const } : x));
        expect(actionFor(press('KeyG'), 'flight', { sonic: true, map: planned })).toBeNull();
        expect(pageBindings({ sonic: true, map: planned }).map((x) => x.action)).not.toContain('sonic.glossary');
    });

    it('a mode key overlaps every other binding: another action on its letter, in any state, is a double binding; control: a crash-only and a flight-only key on one letter do not clash', () => {
        for (const when of ['flight', 'crash', 'always', 'sonic'] as const) {
            const p = keymapProblems([...KEYMAP, { action: 'test.t', keys: [{ code: 'KeyT', cap: 'T', aria: 'T' }], when, labelKey: 'keys.test.t', status: 'shipped' }]);
            expect(p, when).toEqual([`KeyT is bound to sonic.record and test.t (sonic / ${when})`]);
        }
        const free: KeyBinding[] = [
            // every letter is bound since J took the last one (lane center-throttle): a digit is free
            { action: 'test.a', keys: [{ code: 'Digit1', cap: '1', aria: '1' }], when: 'flight', labelKey: 'keys.test.a', status: 'shipped' },
            { action: 'test.b', keys: [{ code: 'Digit1', cap: '1', aria: '1' }], when: 'crash', labelKey: 'keys.test.b', status: 'shipped' }
        ];
        expect(keymapProblems([...KEYMAP, ...free])).toEqual([]);
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
