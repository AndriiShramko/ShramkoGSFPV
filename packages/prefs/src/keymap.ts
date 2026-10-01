// The one table of keyboard shortcuts (docs/architecture-v03.md 1.2). It drives the page's single
// keydown handler (apps/fly app/keys.ts), the key-caps beside menu items (it replaces v0.2's
// PAUSE_KEYS: same KeyHint shape, same aria-keyshortcuts values) and the settings catalogue.
// Pure data and lookups: events, focus and text fields belong to the router, not here.

export type ActionId =
    | 'pause.toggle' | 'respawn.start' | 'respawn.rewind' | 'crash.keep' | 'scene.next' | 'scene.random' | 'scene.favourite'
    | 'mode.cycle' | 'voxels.cycle' | 'hud.toggle' | 'scale.down' | 'scale.up' | 'record.toggle' | 'frameStats.toggle'
    | 'settings.open' | 'walls.toggle' | 'arm.toggle' | (string & {}); // v0.2 pause items keep the keys v0.2 shipped

/** A key as a menu shows it (`cap`) and as ARIA names it (`aria`, for aria-keyshortcuts). v0.2's shape. */
export interface KeyHint { cap: string; aria: string }

/** One physical key by KeyboardEvent.code, so it sits in the same place on every layout. */
export interface KeyChord extends KeyHint {
    code: string;
    /** true: only with Shift held; absent: only without it (N and Shift+N are different actions) */
    shift?: boolean;
}

/** Where a binding listens: in flight (paused or not), while the crash toast or panel is up, or both. */
export type KeyWhen = 'flight' | 'crash' | 'always';

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
    { action: 'respawn.rewind', keys: [letter('Y')], when: 'always', labelKey: 'keys.respawn.rewind', status: 'planned' },
    { action: 'crash.keep', keys: [{ code: 'Enter', cap: 'Enter', aria: 'Enter' }], when: 'crash', labelKey: 'keys.crash.keep', status: 'planned' },
    { action: 'scene.next', keys: [letter('N')], when: 'always', labelKey: 'keys.scene.next', status: 'planned' },
    { action: 'scene.random', keys: [{ code: 'KeyN', shift: true, cap: 'Shift+N', aria: 'Shift+N' }], when: 'always', labelKey: 'keys.scene.random', status: 'planned' },
    { action: 'scene.favourite', keys: [letter('F')], when: 'always', labelKey: 'keys.scene.favourite', status: 'planned' },
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
    { action: 'scale.down', keys: [{ code: 'BracketLeft', cap: '[', aria: '[' }], when: 'always', labelKey: 'keys.scale.down', status: 'planned' },
    { action: 'scale.up', keys: [{ code: 'BracketRight', cap: ']', aria: ']' }], when: 'always', labelKey: 'keys.scale.up', status: 'planned' },
    { action: 'record.toggle', keys: [{ code: 'F9', cap: 'F9', aria: 'F9' }], when: 'always', labelKey: 'keys.record.toggle', status: 'planned' },
    // v0.2 (app/builtin/hud.ts)
    { action: 'frameStats.toggle', keys: [{ code: 'F3', cap: 'F3', aria: 'F3' }], when: 'always', labelKey: 'keys.frameStats.toggle', status: 'shipped' },
    // W2-1 (app/builtin/settings.ts): the settings screen, also from the pause menu and the gear
    { action: 'settings.open', keys: [letter('O')], when: 'always', labelKey: 'keys.settings.open', status: 'shipped' }
];

/**
 * v0.2's pause-menu items (ui/flight.ts PauseActions) that showed keys, and the action whose keys
 * they show now: keysFor(V02_PAUSE_ITEMS.resume) is v0.2's PAUSE_KEYS.resume, cap for cap.
 */
export const V02_PAUSE_ITEMS: Readonly<Record<'resume' | 'restart', ActionId>> = { resume: 'pause.toggle', restart: 'respawn.start' };

/**
 * Keyboard flying (devices/keyboard.ts FLY_KEYS, plus Space = arm): no menu action may take one;
 * only a binding marked `flying` (read by devices/keyboard.ts itself, never routed) lists one.
 */
export const FLYING_CODES: readonly string[] = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'];

/**
 * Keys keyboard pilots know from keyboard flying, each with the one action allowed on it (the same
 * thing): M was keyboard flying's angle key in v0.2 and is the mode key for every input now.
 */
export const SHARED_WITH_FLYING: Readonly<Record<string, ActionId>> = { KeyM: 'mode.cycle' };

/** F13-F24 belong to the latency harness (devices/keyboard.ts): one numbered input event per press. */
export const RESERVED_CODES: readonly string[] = Array.from({ length: 12 }, (_, i) => `F${13 + i}`);

function visible(b: KeyBinding, planned: boolean): boolean {
    return planned || b.status === 'shipped';
}

/** The binding of an action, or undefined. */
export function bindingOf(action: ActionId, map: readonly KeyBinding[] = KEYMAP): KeyBinding | undefined {
    return map.find((b) => b.action === action);
}

/** Key-caps for a menu item, in table order. Planned bindings show nothing unless asked for. */
export function keysFor(action: ActionId, o: { planned?: boolean; map?: readonly KeyBinding[] } = {}): KeyHint[] {
    const b = bindingOf(action, o.map);
    if (!b || !visible(b, !!o.planned)) return [];
    return b.keys.map((k) => ({ cap: k.cap, aria: k.aria }));
}

/** The subset of KeyboardEvent the lookup reads (so it runs in Node tests). */
export interface KeyPress { code: string; shiftKey: boolean; ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean }

/**
 * The action a key press runs in the page's current state, or null. Ctrl, Alt and Meta chords are
 * never ours: the browser keeps Ctrl+R, Ctrl+P, Ctrl+F and the rest. Flying bindings are never
 * routed: keyboard flying reads those keys itself.
 */
export function actionFor(e: KeyPress, state: 'flight' | 'crash', o: { planned?: boolean; map?: readonly KeyBinding[] } = {}): ActionId | null {
    if (e.ctrlKey || e.altKey || e.metaKey) return null;
    for (const b of o.map ?? KEYMAP) {
        if (b.flying || !visible(b, !!o.planned) || (b.when !== 'always' && b.when !== state)) continue;
        if (b.keys.some((k) => k.code === e.code && !!k.shift === e.shiftKey)) return b.action;
    }
    return null;
}

/**
 * Everything wrong with a keymap, empty when it is sound: a key bound twice where both listen
 * ('always' overlaps both states), a flying or harness key taken by a menu action, a binding
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
                if (o.when === 'always' || b.when === 'always' || o.when === b.when) out.push(`${chord} is bound to ${o.action} and ${b.action} (${o.when} / ${b.when})`);
            }
            list.push({ action: b.action, when: b.when });
            seen.set(chord, list);
        }
    }
    return out;
}
