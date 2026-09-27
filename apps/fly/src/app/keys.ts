// The page's one keydown handler (docs/architecture-v03.md 1.2): a key press becomes an action
// through the keymap of @gsfpv/prefs (shipped bindings only), and the action runs its handler.
// Keyboard flying (devices/keyboard.ts) and the latency harness keys (F13-F24) are not actions and
// keep their own listeners.
import { actionFor } from '@gsfpv/prefs';
import type { ActionId } from '@gsfpv/prefs';
import { typing } from '../devices/keyboard';

export class KeyRouter {
    /** 'crash' while the crash toast or panel is up (set by whoever shows it): bindings listen per state. */
    state: 'flight' | 'crash' = 'flight';
    private handlers = new Map<ActionId, ((e: KeyboardEvent) => void)[]>();
    private target: Window;

    constructor(target: Window = window) {
        this.target = target;
        target.addEventListener('keydown', this.onKey);
    }

    /**
     * Run `run` for this action. The last handler registered for an action is the one that runs,
     * and unregistering it gives the action back to the one before: a screen that is up (the pause
     * menu, the drone picker) owns the keys it shows while it is up.
     */
    on(action: ActionId, run: (e: KeyboardEvent) => void): () => void {
        const list = this.handlers.get(action) ?? [];
        list.push(run);
        this.handlers.set(action, list);
        return () => {
            const i = list.lastIndexOf(run);
            if (i >= 0) list.splice(i, 1);
        };
    }

    dispose(): void {
        this.target.removeEventListener('keydown', this.onKey);
        this.handlers.clear();
    }

    private onKey = (e: KeyboardEvent): void => {
        // the Controls screen has its own keys
        if (document.querySelector('.screen.radio')) return;
        // a text field takes R and P as letters; Esc is never text, so it still closes the panel around it
        if (typing(e.target) && e.code !== 'Escape') return;
        const action = actionFor(e, this.state);
        if (action === null) return;
        const list = this.handlers.get(action);
        list?.[list.length - 1]?.(e);
    };
}
