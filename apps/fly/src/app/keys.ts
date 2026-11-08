// The page's one keydown handler for shortcuts (docs/architecture-v03.md 1.2): a key press becomes
// an action through the keymap of @gsfpv/prefs (shipped bindings only), and the action runs the
// handler a feature registered for it. Menu key-caps come from the same table (caps()).
// Not routed here: keyboard flying (devices/keyboard.ts reads W A S D, the arrows, Space and M
// itself; they are the keymap's `flying` bindings) and the latency harness keys F13-F24. The sound mode's
// keys (`when: 'sonic'`: T U I Z G) are routed, captioned and listed only when the page says it was entered
// through ?sonic= (the `sonic` option; v12-optin), else they are not on the page at all.
import { KEYMAP, actionFor, bindingOf, keysFor, listensIn, pageBindings } from '@gsfpv/prefs';
import type { ActionId, KeyBinding, KeyHint } from '@gsfpv/prefs';
import { typing } from '../devices/keyboard';

/** Where bindings listen now: 'crash' while the crash view is up. */
export type KeyState = 'flight' | 'crash';

/**
 * Where an action came from: 'key' (a key press, which the browser counts as the user's activation)
 * or 'switch' (a radio switch's range through trigger(); a radio or gamepad frame is never one).
 */
export type ActionSource = 'key' | 'switch';

/** A feature's handler of an action: the keydown (a synthetic one for a switch) and where it came from. */
export type ActionHandler = (e: KeyboardEvent, source: ActionSource) => void;

/**
 * How a handler is registered: `when`, asked at each press, says whether it takes this press; while it says no, the press goes to the
 * handler before it as if it were not there (v12-optin review R4: Fly by Sound's K says the keys, but with a dialog up the press is the
 * dialog's, and the "How to fly" card's own K closes it).
 */
export interface HandlerOptions {
    when?: () => boolean;
}

interface Handler {
    readonly run: ActionHandler;
    readonly when?: () => boolean;
}

/**
 * May the handler of an action from `source` use the user's activation (ask for a permission, open a
 * picker)? A key press is one. A switch only while the page still holds one from a click or a key
 * moments before (navigator.userActivation), as the auto-record start decides it; asked without one,
 * the browser refuses and the refusal would stick (the recording folder reads "no access").
 */
export function isUserGesture(source: ActionSource, nav: { userActivation?: { isActive: boolean } } | undefined = globalThis.navigator): boolean {
    return source === 'key' || !!nav?.userActivation?.isActive;
}

/** Keys that still count while a text field has the focus: Esc is never text (it closes the panel around the field). */
const THROUGH_TEXT = new Set(['Escape']);

export interface KeyRouterOptions {
    /** the table (tests pass their own) */
    map?: readonly KeyBinding[];
    /** focus in a field that takes text: its keys are letters (default: devices/keyboard.ts typing) */
    isText?: (target: EventTarget | null) => boolean;
    /** the page's state for the bindings' `when` */
    state?: () => KeyState;
    /**
     * Shift is a flying key now (the game scheme's "down", devices/keyboard.ts shiftFlies()). A pilot
     * descends with Shift held and presses P, R or Esc meanwhile, so a press with Shift is read as the
     * chord it is first (Shift+N, Shift+F, Shift+[ are bindings), and when no binding has that chord,
     * as the key alone (Shift+Esc pauses, Shift+R respawns). The handler still gets the real event.
     */
    shiftIsFlying?: () => boolean;
    /** the page was entered through ?sonic= (app/flight.ts: sonicEntry()); only then are the sound mode's keys on it (default: no) */
    sonic?: () => boolean;
}

export class KeyRouter {
    private handlers = new Map<ActionId, Handler[]>();
    private labels = new Map<ActionId, string[]>();
    private blocks = new Set<() => boolean>();
    private readonly map: readonly KeyBinding[];
    private readonly isText: (target: EventTarget | null) => boolean;
    private readonly state: () => KeyState;
    private readonly shiftIsFlying: () => boolean;
    private readonly sonic: () => boolean;

    constructor(o: KeyRouterOptions = {}) {
        this.map = o.map ?? KEYMAP;
        this.isText = o.isText ?? typing;
        this.state = o.state ?? (() => 'flight');
        this.shiftIsFlying = o.shiftIsFlying ?? (() => false);
        this.sonic = o.sonic ?? (() => false);
    }

    /** What the keymap's lookups need to know of this page: its table and whether the sound mode's keys are on it. */
    private get page(): { map: readonly KeyBinding[]; sonic: boolean } {
        return { map: this.map, sonic: this.sonic() };
    }

    /** The bindings this page lists (the summary panel's key list), in table order: the sound mode's only on its pages. */
    listed(): KeyBinding[] {
        return pageBindings(this.page);
    }

    /**
     * Run `run` for this action's keys. The last handler registered for an action is the one that
     * runs, and unregistering it gives the action back to the one before: a screen that is up (the
     * pause menu, the drone picker) owns the keys it shows while it is up. A handler whose `when`
     * says no for a press hands it to the one before it, as if it were not there. Only shipped, routed
     * bindings take handlers: a planned binding would never run, a flying one belongs to keyboard
     * flying, so both throw here instead of failing silently.
     */
    on(action: ActionId, run: ActionHandler, o: HandlerOptions = {}): () => void {
        const b = bindingOf(action, this.map);
        if (!b) throw new Error(`no key binding for ${action}`);
        if (b.flying) throw new Error(`${action} is read by keyboard flying, not routed`);
        if (b.status !== 'shipped') throw new Error(`${action} is planned: ship its binding with the feature`);
        return this.push(action, o.when ? { run, when: o.when } : { run });
    }

    /** Does this router route the action's keys (a shipped binding that is not keyboard flying's, a mode's key on its pages only)? */
    routes(action: ActionId): boolean {
        const b = bindingOf(action, this.map);
        return !!b && !b.flying && b.status === 'shipped' && (b.when !== 'sonic' || this.sonic());
    }

    private push(action: ActionId, h: Handler): () => void {
        const list = this.handlers.get(action) ?? [];
        list.push(h);
        this.handlers.set(action, list);
        return () => {
            const i = list.lastIndexOf(h);
            if (i >= 0) list.splice(i, 1);
        };
    }

    /**
     * This page's own words for an action's key in the key list, while they stand (v12-optin review R4: in Fly by Sound L copies the
     * lesson's link and K says the keys); the returned function takes them back. The last given stands, like a handler.
     */
    relabel(action: ActionId, labelKey: string): () => void {
        const list = this.labels.get(action) ?? [];
        list.push(labelKey);
        this.labels.set(action, list);
        return () => {
            const i = list.lastIndexOf(labelKey);
            if (i >= 0) list.splice(i, 1);
        };
    }

    /** The words the key list gives a binding on this page: the last relabel standing, else the keymap's own. */
    labelOf(b: KeyBinding): string {
        const list = this.labels.get(b.action);
        return list?.[list.length - 1] ?? b.labelKey;
    }

    /** While `blocked()` is true nothing is routed (a screen with keys of its own, like Controls). */
    block(blocked: () => boolean): () => void {
        this.blocks.add(blocked);
        return () => this.blocks.delete(blocked);
    }

    /** The key-caps of an action, for a menu item or a hint (keysFor over this router's table). */
    caps(action: ActionId): KeyHint[] {
        return keysFor(action, this.page);
    }

    /** Route one key press: the action whose handler ran, or null. */
    route(e: KeyboardEvent): ActionId | null {
        for (const b of this.blocks) if (b()) return null;
        // a text field takes R and P as letters; Esc is never text, so it still closes the panel around it
        if (this.isText(e.target) && !THROUGH_TEXT.has(e.code)) return null;
        // Shift held as a flying key (the descent) is a modifier only where a binding says so: the real chord
        // first, then the key alone
        const page = this.page;
        let action = actionFor(e, this.state(), page);
        if (action === null && e.shiftKey && this.shiftIsFlying()) {
            action = actionFor({ code: e.code, shiftKey: false, ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey }, this.state(), page);
        }
        if (action === null) return null;
        return this.run(action, e, 'key') ? action : null;
    }

    /** The last registered handler of the action that takes this press (its `when` says yes, or it has none) runs; whether one did. */
    private run(action: ActionId, e: KeyboardEvent, source: ActionSource): boolean {
        const list = this.handlers.get(action) ?? [];
        for (let i = list.length - 1; i >= 0; i--) {
            const h = list[i]!;
            if (h.when && !h.when()) continue;
            h.run(e, source);
            return true;
        }
        return false;
    }

    /**
     * Run an action as if its first key were pressed (a radio switch's action, app/builtin/switches.ts):
     * the same handler, the same blocks (a screen with keys of its own) and the same `when` (a
     * crash-only action only in the crash state). The handler gets a synthetic keydown of that key
     * and the source 'switch': no user activation (isUserGesture). The action that ran, or null.
     */
    trigger(action: ActionId): ActionId | null {
        for (const b of this.blocks) if (b()) return null;
        const binding = bindingOf(action, this.map);
        if (!binding || !this.routes(action)) return null;
        if (!listensIn(binding, this.state())) return null;
        const k = binding.keys[0];
        return this.run(action, makeKeyEvent(k.code, !!k.shift), 'switch') ? action : null;
    }

    /** Listen on `target` (the window) until the returned function is called. */
    attach(target: Pick<Window, 'addEventListener' | 'removeEventListener'> = window): () => void {
        const onKey = (e: Event): void => { this.route(e as KeyboardEvent); };
        target.addEventListener('keydown', onKey);
        return () => target.removeEventListener('keydown', onKey);
    }
}

/** A keydown for a triggered action: a real KeyboardEvent in the page, a plain stand-in where there is none (Node tests). */
function makeKeyEvent(code: string, shiftKey: boolean): KeyboardEvent {
    if (typeof KeyboardEvent === 'function') return new KeyboardEvent('keydown', { code, shiftKey, cancelable: true });
    return { type: 'keydown', code, key: '', shiftKey, repeat: false, ctrlKey: false, altKey: false, metaKey: false, target: null, preventDefault: () => undefined } as unknown as KeyboardEvent;
}
