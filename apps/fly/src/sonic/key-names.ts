// The names of the pilot's keys in what the mode says (v0.13, lane v13-host B1; docs/wip/v13-host.md): the sound package's
// lines say them ("Press N to go on to the next lesson": RunnerOptions.keys), and so do K's help and the line at every lesson's
// start ("Escape: menu. Z: repeat the task. N: next."). A line must name the key the pilot really presses.
//
// The page binds keys by their place on the keyboard (KeyboardEvent.code, packages/prefs keymap.ts), and the letter printed on a
// place depends on the pilot's layout: the place of Z types Y on a German keyboard and W on a French one. Where the browser says
// what the pilot's layout types (navigator.keyboard.getLayoutMap: Chromium on a secure page; for a layout that types no Latin
// letters it answers with the last Latin one the pilot used), a letter key is named by that letter; elsewhere by the key table's
// cap, which names the place on a US keyboard. A named key (Escape) is said by its name in the page's language. The key table is
// the router's (KeyRouter.caps): a key the page does not route (the mode's keys on an ordinary page) has no name.
import type { ActionId, KeyHint } from '@gsfpv/prefs';

/** What the browser's layout map gives: the character a key's place types in the pilot's layout (KeyboardLayoutMap.get). */
export interface LayoutMap {
    get(code: string): string | undefined;
}

/** The names of the keys the runner's lines say (the sound package's RunnerOptions.keys). */
export interface RunnerKeys {
    readonly next: string;
    readonly previous: string;
    readonly repeat: string;
}

/** The runner's own names, when the page has none (the package's defaults). */
export const DEFAULT_RUNNER_KEYS: RunnerKeys = Object.freeze({ next: 'N', previous: 'B', repeat: 'Z' });

/** Named keys the page binds (aria = KeyboardEvent.code for these). */
const NAMED = new Set(['Escape', 'Enter', 'Space', 'Tab', 'Backspace']);

/** The place a cap names: KeyN for N, Digit1 for 1, Escape for Escape; null for a chord (Shift+N) or a key named otherwise ([). */
export function codeOfHint(h: KeyHint): string | null {
    if (/^[A-Z]$/.test(h.aria)) return `Key${h.aria}`;
    if (/^[0-9]$/.test(h.aria)) return `Digit${h.aria}`;
    if (NAMED.has(h.aria) || /^F([1-9]|1[0-9]|2[0-4])$/.test(h.aria)) return h.aria;
    return null;
}

/**
 * How one key is said: a letter by what the pilot's layout types on its place (upper case), else by the cap; a named key by its
 * name in the page's language (`named`, null when there is none: then the cap); anything else by its cap.
 */
export function spokenKey(h: KeyHint, layout: LayoutMap | null, named: (code: string) => string | null): string {
    const code = codeOfHint(h);
    if (code === null) return h.cap;
    if (code.startsWith('Key') || code.startsWith('Digit')) {
        const typed = layout?.get(code);
        // one printable character, not a space or a dead key's mark alone
        if (typed !== undefined && typed.length === 1 && typed.trim() !== '') return typed.toUpperCase();
        return h.cap;
    }
    return named(code) ?? h.cap;
}

/** The pilot's key names on this page (sonic/feature.ts makes one; Node tests pass their own caps and layout). */
export class KeyNames {
    private layout: LayoutMap | null = null;
    private readonly caps: (action: ActionId) => readonly KeyHint[];
    private readonly named: (code: string) => string | null;

    /** `caps`: the router's key-caps of an action on this page; `named`: a named key's name in the page's language, or null. */
    constructor(caps: (action: ActionId) => readonly KeyHint[], named: (code: string) => string | null) {
        this.caps = caps;
        this.named = named;
    }

    /** The pilot's layout, when the browser says it (asked again at each lesson's open: a pilot may switch layouts). */
    async refresh(nav: unknown = globalThis.navigator): Promise<void> {
        try {
            const kb = (nav as { keyboard?: { getLayoutMap?: () => Promise<LayoutMap> } } | undefined)?.keyboard;
            if (kb?.getLayoutMap) this.layout = await kb.getLayoutMap();
        } catch {
            // not on this page (another browser, an insecure page, a frame): the key table's caps
        }
    }

    /** A layout given directly (tests; a page that read it elsewhere). */
    setLayout(layout: LayoutMap | null): void {
        this.layout = layout;
    }

    /** The spoken names of an action's keys on this page, joined by spaces (`aria`: only that key of the binding); '' when none. */
    of(action: ActionId, aria?: string): string {
        return this.caps(action)
            .filter((h) => aria === undefined || h.aria === aria)
            .map((h) => spokenKey(h, this.layout, this.named))
            .join(' ');
    }

    /** The runner's keys: N (scene.next), B (feedback.open) and Z (sonic.repeat), as this pilot's keyboard names them. */
    runner(): RunnerKeys {
        return {
            next: this.of('scene.next') || DEFAULT_RUNNER_KEYS.next,
            previous: this.of('feedback.open') || DEFAULT_RUNNER_KEYS.previous,
            repeat: this.of('sonic.repeat') || DEFAULT_RUNNER_KEYS.repeat
        };
    }
}
