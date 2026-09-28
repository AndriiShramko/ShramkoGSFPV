// The page's one keydown handler for shortcuts (docs/architecture-v03.md 1.2): a key press becomes
// an action through the keymap of @gsfpv/prefs (shipped bindings only), and the action runs the
// handler a feature registered for it. Menu key-caps come from the same table (caps()).
// Not routed here: keyboard flying (devices/keyboard.ts reads W A S D, the arrows, Space and M
// itself; they are the keymap's `flying` bindings) and the latency harness keys F13-F24.
import { KEYMAP, actionFor, bindingOf, keysFor } from '@gsfpv/prefs';
import type { ActionId, KeyBinding, KeyHint } from '@gsfpv/prefs';
import { typing } from '../devices/keyboard';

/** Where bindings listen now: 'crash' while the crash view is up. */
export type KeyState = 'flight' | 'crash';

type Handler = (e: KeyboardEvent) => void;

/** Keys that still count while a text field has the focus: Esc is never text (it closes the panel around the field). */
const THROUGH_TEXT = new Set(['Escape']);

export interface KeyRouterOptions {
    /** the table (tests pass their own) */
    map?: readonly KeyBinding[];
    /** focus in a field that takes text: its keys are letters (default: devices/keyboard.ts typing) */
    isText?: (target: EventTarget | null) => boolean;
    /** the page's state for the bindings' `when` */
    state?: () => KeyState;
}

export class KeyRouter {
    private handlers = new Map<ActionId, Handler[]>();
    private blocks = new Set<() => boolean>();
    private readonly map: readonly KeyBinding[];
    private readonly isText: (target: EventTarget | null) => boolean;
    private readonly state: () => KeyState;

    constructor(o: KeyRouterOptions = {}) {
        this.map = o.map ?? KEYMAP;
        this.isText = o.isText ?? typing;
        this.state = o.state ?? (() => 'flight');
    }

    /**
     * Run `run` for this action's keys. The last handler registered for an action is the one that
     * runs, and unregistering it gives the action back to the one before: a screen that is up (the
     * pause menu, the drone picker) owns the keys it shows while it is up. Only shipped, routed
     * bindings take handlers: a planned binding would never run, a flying one belongs to keyboard
     * flying, so both throw here instead of failing silently.
     */
    on(action: ActionId, run: Handler): () => void {
        const b = bindingOf(action, this.map);
        if (!b) throw new Error(`no key binding for ${action}`);
        if (b.flying) throw new Error(`${action} is read by keyboard flying, not routed`);
        if (b.status !== 'shipped') throw new Error(`${action} is planned: ship its binding with the feature`);
        return this.push(action, run);
    }

    /** Does this router route the action's keys (a shipped binding that is not keyboard flying's)? */
    routes(action: ActionId): boolean {
        const b = bindingOf(action, this.map);
        return !!b && !b.flying && b.status === 'shipped';
    }

    private push(action: ActionId, run: Handler): () => void {
        const list = this.handlers.get(action) ?? [];
        list.push(run);
        this.handlers.set(action, list);
        return () => {
            const i = list.lastIndexOf(run);
            if (i >= 0) list.splice(i, 1);
        };
    }

    /** While `blocked()` is true nothing is routed (a screen with keys of its own, like Controls). */
    block(blocked: () => boolean): () => void {
        this.blocks.add(blocked);
        return () => this.blocks.delete(blocked);
    }

    /** The key-caps of an action, for a menu item or a hint (keysFor over this router's table). */
    caps(action: ActionId): KeyHint[] {
        return keysFor(action, { map: this.map });
    }

    /** Route one key press: the action whose handler ran, or null. */
    route(e: KeyboardEvent): ActionId | null {
        for (const b of this.blocks) if (b()) return null;
        // a text field takes R and P as letters; Esc is never text, so it still closes the panel around it
        if (this.isText(e.target) && !THROUGH_TEXT.has(e.code)) return null;
        const action = actionFor(e, this.state(), { map: this.map });
        if (action === null) return null;
        const list = this.handlers.get(action);
        const run = list?.[list.length - 1];
        if (!run) return null;
        run(e);
        return action;
    }

    /** Listen on `target` (the window) until the returned function is called. */
    attach(target: Pick<Window, 'addEventListener' | 'removeEventListener'> = window): () => void {
        const onKey = (e: Event): void => { this.route(e as KeyboardEvent); };
        target.addEventListener('keydown', onKey);
        return () => target.removeEventListener('keydown', onKey);
    }
}
