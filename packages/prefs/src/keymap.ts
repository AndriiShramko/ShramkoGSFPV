// The one table of keyboard shortcuts (docs/architecture-v03.md 1.2). It drives the page's single
// keydown handler (apps/fly app/keys.ts), the key-caps beside menu items (it replaces v0.2's
// PAUSE_KEYS: same KeyHint shape, same aria-keyshortcuts values) and the settings catalogue.
// Pure data and lookups: events, focus and text fields belong to the router, not here.

export type ActionId =
    | 'pause.toggle' | 'respawn.start' | 'respawn.rewind' | 'crash.keep' | 'scene.next' | 'scene.random' | 'scene.favourite'
    | 'mode.cycle' | 'voxels.cycle' | 'hud.toggle' | 'scale.down' | 'scale.up' | 'record.toggle' | 'frameStats.toggle'
    | 'settings.open' | 'walls.toggle' | 'arm.toggle' | 'feedback.open' | 'share.open' | 'help.keys' | 'fullscreen.toggle' | (string & {}); // v0.2 pause items keep the keys v0.2 shipped

/** A key as a menu shows it (`cap`) and as ARIA names it (`aria`, for aria-keyshortcuts). v0.2's shape. */
export interface KeyHint { cap: string; aria: string }

/** One physical key by KeyboardEvent.code, so it sits in the same place on every layout. */
export interface KeyChord extends KeyHint {
    code: string;
    /** true: only with Shift held; absent: only without it (N and Shift+N are different actions) */
    shift?: boolean;
}

/**
 * Where a binding listens: in flight (paused or not), while the crash toast or panel is up, or both. `sonic`: both, but
 * only on a page entered through ?sonic= (Fly by Sound, v12-optin): anywhere else the key is neither routed nor listed,
 * and the catalogue does not count it, so a pilot who did not choose the sound mode never meets its keys.
 */
export type KeyWhen = 'flight' | 'crash' | 'always' | 'sonic';

export interface KeyBinding {
    action: ActionId;
    keys: readonly KeyChord[];
    when: KeyWhen;
    /** i18n key of the action's name, in the `keys` namespace: `keys.<action>` */
    labelKey: string;
    /**
     * planned: the feature has not landed, so the router does not route it and neither the menus
     * nor the catalogue show it (the schema's `planned`, for keys). The agent whose feature lands
     * flips its own binding to shipped.
     */
    status: 'shipped' | 'planned';
    /**
     * true: keyboard flying reads this key itself (devices/keyboard.ts, only while the keyboard is
     * the input), so the page's router never routes it; it is listed for the key-caps and the
     * catalogue. The only bindings allowed on a keyboard-flying key.
     */
    flying?: true;
}

const letter = (l: string): KeyChord => ({ code: `Key${l}`, cap: l, aria: l });

export const KEYMAP: readonly KeyBinding[] = [
    // v0.2 (app/builtin/pause.ts): P or Esc toggles the pause, so in the menu they continue
    { action: 'pause.toggle', keys: [{ code: 'Escape', cap: 'Esc', aria: 'Escape' }, letter('P')], when: 'always', labelKey: 'keys.pause.toggle', status: 'shipped' },
    // v0.2: R respawns at the start, and with the menu up it is the menu's Restart
    { action: 'respawn.start', keys: [letter('R')], when: 'always', labelKey: 'keys.respawn.start', status: 'shipped' },
    // Liftoff's rewind key (research-a (c) [L10])
    { action: 'respawn.rewind', keys: [letter('Y')], when: 'always', labelKey: 'keys.respawn.rewind', status: 'shipped' },
    { action: 'crash.keep', keys: [{ code: 'Enter', cap: 'Enter', aria: 'Enter' }], when: 'crash', labelKey: 'keys.crash.keep', status: 'shipped' },
    { action: 'scene.next', keys: [letter('N')], when: 'always', labelKey: 'keys.scene.next', status: 'shipped' },
    { action: 'scene.random', keys: [{ code: 'KeyN', shift: true, cap: 'Shift+N', aria: 'Shift+N' }], when: 'always', labelKey: 'keys.scene.random', status: 'shipped' },
    // F is full screen since v0.9 (below); the next favourite scene is Shift+F
    { action: 'scene.favourite', keys: [{ code: 'KeyF', shift: true, cap: 'Shift+F', aria: 'Shift+F' }], when: 'always', labelKey: 'keys.scene.favourite', status: 'shipped' },
    // M cycles acro / angle / horizon for every input (app/builtin/modes.ts, the HUD mode chip; with
    // a radio whose mode switch decides, it says so). v0.2's keyboard flying toggled angle on M,
    // so keyboard pilots keep their key
    { action: 'mode.cycle', keys: [letter('M')], when: 'always', labelKey: 'keys.mode.cycle', status: 'shipped' },
    // Space arms and disarms: keyboard flying, and a radio without an arm switch (devices/keyboard.ts)
    { action: 'arm.toggle', keys: [{ code: 'Space', cap: 'Space', aria: 'Space' }], when: 'always', labelKey: 'keys.arm.toggle', status: 'shipped', flying: true },
    // v0.2 (app/builtin/voxels.ts): the voxel grid off / over the scan / voxels only
    { action: 'voxels.cycle', keys: [letter('V')], when: 'always', labelKey: 'keys.voxels.cycle', status: 'shipped' },
    // v0.2 (app/builtin/walls.ts): the walls (collisions) on / off for this scan
    { action: 'walls.toggle', keys: [letter('C')], when: 'always', labelKey: 'keys.walls.toggle', status: 'shipped' },
    // v0.2 (app/builtin/hud.ts): every text on the flight view off / on
    { action: 'hud.toggle', keys: [letter('H')], when: 'always', labelKey: 'keys.hud.toggle', status: 'shipped' },
    // [ ] step the scene size x1.1; with Shift x2 (0.25 to 100 is 9 Shift presses, not 63)
    { action: 'scale.down', keys: [{ code: 'BracketLeft', cap: '[', aria: '[' }, { code: 'BracketLeft', shift: true, cap: 'Shift+[', aria: 'Shift+[' }], when: 'always', labelKey: 'keys.scale.down', status: 'shipped' },
    { action: 'scale.up', keys: [{ code: 'BracketRight', cap: ']', aria: ']' }, { code: 'BracketRight', shift: true, cap: 'Shift+]', aria: 'Shift+]' }], when: 'always', labelKey: 'keys.scale.up', status: 'shipped' },
    // W3-5 (app/builtin/cinema.ts): REC on the recording bar and in the pause menu (F.4)
    { action: 'record.toggle', keys: [{ code: 'F9', cap: 'F9', aria: 'F9' }], when: 'always', labelKey: 'keys.record.toggle', status: 'shipped' },
    // v0.2 (app/builtin/hud.ts)
    { action: 'frameStats.toggle', keys: [{ code: 'F3', cap: 'F3', aria: 'F3' }], when: 'always', labelKey: 'keys.frameStats.toggle', status: 'shipped' },
    // W2-1 (app/builtin/settings.ts): the settings screen, also from the pause menu and the gear
    { action: 'settings.open', keys: [letter('O')], when: 'always', labelKey: 'keys.settings.open', status: 'shipped' },
    // W5 (app/builtin/feedback.ts): the bug / idea / cooperation dialog, also on the top bar and in the
    // pause menu; B as in bug (and the Polish "blad"), and in the crash state too, where bugs show
    { action: 'feedback.open', keys: [letter('B')], when: 'always', labelKey: 'keys.feedback.open', status: 'shipped' },
    // v0.7 lane D1 (app/builtin/share.ts): share the scene flown now, also on the top bar, in the pause
    // menu, the crash panel and the stats card; L as in "link" (no other binding or flying key uses it)
    { action: 'share.open', keys: [letter('L')], when: 'always', labelKey: 'keys.share.open', status: 'shipped' },
    // train 1, lane rooms (docs/wip/train1-plan.md, "Contracts between lanes"): reserved on the train base as planned, so the
    // router does not route them yet; the lane flips its own two lines to shipped (or deletes the one it does not build) and
    // touches no other line of this table. Shift+L opens "Fly with others" (the room and its link), Shift+O says who is around
    { action: 'rooms.panel', keys: [{ code: 'KeyL', shift: true, cap: 'Shift+L', aria: 'Shift+L' }], when: 'always', labelKey: 'keys.rooms.panel', status: 'shipped' },
    { action: 'rooms.who', keys: [{ code: 'KeyO', shift: true, cap: 'Shift+O', aria: 'Shift+O' }], when: 'always', labelKey: 'keys.rooms.who', status: 'shipped' },
    // v0.8 lane A (app/builtin/play.ts): the keyboard's key card on demand (it shows by itself while the
    // drone waits on the ground); K as in "keys"
    { action: 'help.keys', keys: [letter('K')], when: 'always', labelKey: 'keys.help.keys', status: 'shipped' },
    // v0.9 lane B (app/builtin/play.ts, play/fullscreen.ts): full screen on and off, also on the top bar; F as in
    // "full screen", the key games use; it works with the mouse captured. The next favourite scene moved to Shift+F
    { action: 'fullscreen.toggle', keys: [letter('F')], when: 'always', labelKey: 'keys.fullscreen.toggle', status: 'shipped' },
    // v0.12 Fly by Sound (docs/wip/v12-plan.md sections 1 and 3; the handlers are in sonic/feature.ts and
    // sonic-session/session.ts). All five letters were free: T records the flight and the pilot's voice, U sends the
    // recording to the author, I says the status (lesson, attempt, recording), Z repeats the last spoken line, G opens the
    // sound glossary. Keys of the mode only (v12-optin, the owner's message 40: the sound mode is not pressed on pilots who
    // did not choose it): routed and listed on a page entered through ?sonic=, nowhere else, and not in the catalogue
    // lane center-throttle (app/builtin/throttle-style.ts): a radio's or gamepad's throttle style, stick in the centre <-> from zero
    { action: 'throttle.style', keys: [letter('J')], when: 'always', labelKey: 'keys.throttle.style', status: 'shipped' },
    // train 1, lane tracks (docs/wip/train1-plan.md, "Contracts between lanes"): reserved on the train base as planned; the lane
    // flips its own two lines to shipped (or deletes the one it does not build) and touches no other line of this table.
    // Shift+T puts the course (the obstacles, the arrows, the lap timer) on and off in flight, Shift+G makes a new random course
    { action: 'course.toggle', keys: [{ code: 'KeyT', shift: true, cap: 'Shift+T', aria: 'Shift+T' }], when: 'always', labelKey: 'keys.course.toggle', status: 'planned' },
    { action: 'course.generate', keys: [{ code: 'KeyG', shift: true, cap: 'Shift+G', aria: 'Shift+G' }], when: 'always', labelKey: 'keys.course.generate', status: 'planned' },
    { action: 'sonic.record', keys: [letter('T')], when: 'sonic', labelKey: 'keys.sonic.record', status: 'shipped' },
    { action: 'sonic.send', keys: [letter('U')], when: 'sonic', labelKey: 'keys.sonic.send', status: 'shipped' },
    { action: 'sonic.status', keys: [letter('I')], when: 'sonic', labelKey: 'keys.sonic.status', status: 'shipped' },
    { action: 'sonic.repeat', keys: [letter('Z')], when: 'sonic', labelKey: 'keys.sonic.repeat', status: 'shipped' },
    { action: 'sonic.glossary', keys: [letter('G')], when: 'sonic', labelKey: 'keys.sonic.glossary', status: 'shipped' },
    // lane sonic-hints (the owner's complaint of 2026-11-10): X leaves a lesson for the mode's main menu (its start screen) in one
    // press, the lesson saved. X was free (no binding, not a flying key). A key of the mode only, like the five above
    { action: 'sonic.home', keys: [letter('X')], when: 'sonic', labelKey: 'keys.sonic.home', status: 'shipped' }
];

/**
 * v0.2's pause-menu items (ui/flight.ts PauseActions) that showed keys, and the action whose keys
 * they show now: keysFor(V02_PAUSE_ITEMS.resume) is v0.2's PAUSE_KEYS.resume, cap for cap.
 */
export const V02_PAUSE_ITEMS: Readonly<Record<'resume' | 'restart', ActionId>> = { resume: 'pause.toggle', restart: 'respawn.start' };

/**
 * Keyboard flying (devices/keyboard.ts with the layouts of apps/fly/src/play/keys.ts, plus Space =
 * arm in the pilot profile): no menu action may take one; only a binding marked `flying` (read by
 * devices/keyboard.ts itself, never routed) lists one. Q and E turn in the game layout (v0.9; Shift
 * is its descent and is a modifier for the chords that name it: Shift+N, Shift+F, Shift+[ ]).
 */
export const FLYING_CODES: readonly string[] = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'ShiftLeft', 'ShiftRight'];

/**
 * Keys keyboard pilots know from keyboard flying, each with the one action allowed on it (the same
 * thing): M was keyboard flying's angle key in v0.2 and is the mode key for every input now.
 */
export const SHARED_WITH_FLYING: Readonly<Record<string, ActionId>> = { KeyM: 'mode.cycle' };

/** F13-F24 belong to the latency harness (devices/keyboard.ts): one numbered input event per press. */
export const RESERVED_CODES: readonly string[] = Array.from({ length: 12 }, (_, i) => `F${13 + i}`);

/**
 * What a lookup knows of the page: `planned` shows bindings that have not shipped (the catalogue's checks), `sonic` says the
 * page was entered through ?sonic= (only then are the `sonic` bindings there), `map` is another table (tests).
 */
export interface KeyLookup { planned?: boolean; sonic?: boolean; map?: readonly KeyBinding[] }

/** Is the binding on this page at all: shipped (or planned, when asked for), and a mode's key only on a page of that mode. */
function visible(b: KeyBinding, o: KeyLookup): boolean {
    return (!!o.planned || b.status === 'shipped') && (b.when !== 'sonic' || !!o.sonic);
}

/** The binding of an action, or undefined. */
export function bindingOf(action: ActionId, map: readonly KeyBinding[] = KEYMAP): KeyBinding | undefined {
    return map.find((b) => b.action === action);
}

/**
 * The bindings a page lists (its key list, the catalogue), in table order: the shipped ones, without the sound mode's
 * unless the page was entered through ?sonic=.
 */
export function pageBindings(o: KeyLookup = {}): KeyBinding[] {
    return (o.map ?? KEYMAP).filter((b) => visible(b, o));
}

/** Key-caps for a menu item, in table order. Planned bindings show nothing unless asked for, a mode's keys nothing outside it. */
export function keysFor(action: ActionId, o: KeyLookup = {}): KeyHint[] {
    const b = bindingOf(action, o.map);
    if (!b || !visible(b, o)) return [];
    return b.keys.map((k) => ({ cap: k.cap, aria: k.aria }));
}

/** Does the binding listen in this state ('flight' or 'crash'): `always` and `sonic` in both (`sonic` on its pages only: visible). */
export function listensIn(b: KeyBinding, state: 'flight' | 'crash'): boolean {
    return b.when === 'always' || b.when === 'sonic' || b.when === state;
}

/** The subset of KeyboardEvent the lookup reads (so it runs in Node tests). */
export interface KeyPress { code: string; shiftKey: boolean; ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean }

/**
 * The action a key press runs in the page's current state, or null. Ctrl, Alt and Meta chords are
 * never ours: the browser keeps Ctrl+R, Ctrl+P, Ctrl+F and the rest. Flying bindings are never
 * routed: keyboard flying reads those keys itself.
 */
export function actionFor(e: KeyPress, state: 'flight' | 'crash', o: KeyLookup = {}): ActionId | null {
    if (e.ctrlKey || e.altKey || e.metaKey) return null;
    for (const b of o.map ?? KEYMAP) {
        if (b.flying || !visible(b, o) || !listensIn(b, state)) continue;
        if (b.keys.some((k) => k.code === e.code && !!k.shift === e.shiftKey)) return b.action;
    }
    return null;
}

/**
 * Everything wrong with a keymap, empty when it is sound: a key bound twice where both listen
 * ('always' overlaps both states; 'sonic' overlaps everything, since a page of the sound mode has every other key
 * too), a flying or harness key taken by a menu action, a binding
 * marked flying on a key keyboard flying does not read, an action listed twice, a label outside
 * `keys.<action>`, an aria value with spaces (aria-keyshortcuts separates alternatives with
 * spaces). Planned bindings are checked too: they will ship.
 */
export function keymapProblems(map: readonly KeyBinding[]): string[] {
    const out: string[] = [];
    const seen = new Map<string, { action: ActionId; when: KeyWhen }[]>();
    const actions = new Set<ActionId>();
    for (const b of map) {
        if (actions.has(b.action)) out.push(`action ${b.action} listed twice`);
        actions.add(b.action);
        if (b.labelKey !== `keys.${b.action}`) out.push(`${b.action}: label ${b.labelKey} is not keys.${b.action}`);
        if (!b.keys.length) out.push(`${b.action}: no keys`);
        for (const k of b.keys) {
            const chord = `${k.shift ? 'Shift+' : ''}${k.code}`;
            if (FLYING_CODES.includes(k.code) && !b.flying) out.push(`${b.action}: ${chord} is a keyboard-flying key`);
            const sharer = SHARED_WITH_FLYING[k.code];
            if (b.flying && !FLYING_CODES.includes(k.code) && sharer === undefined) out.push(`${b.action}: ${chord} is marked flying, but keyboard flying does not read it`);
            if (sharer !== undefined && sharer !== b.action) out.push(`${b.action}: ${chord} belongs to keyboard flying (${sharer})`);
            if (RESERVED_CODES.includes(k.code)) out.push(`${b.action}: ${chord} is reserved for the latency harness`);
            if (/\s/.test(k.aria) || !k.aria) out.push(`${b.action}: aria "${k.aria}" is not one aria-keyshortcuts value`);
            const list = seen.get(chord) ?? [];
            for (const o of list) {
                const overlap = o.when === b.when || [o.when, b.when].some((w) => w === 'always' || w === 'sonic');
                if (overlap) out.push(`${chord} is bound to ${o.action} and ${b.action} (${o.when} / ${b.when})`);
            }
            list.push({ action: b.action, when: b.when });
            seen.set(chord, list);
        }
    }
    return out;
}
