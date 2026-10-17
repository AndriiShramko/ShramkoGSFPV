// The one-time hint for a scene that starts enlarged by the owner (v0.9 lane C, item 17 of the owner's
// message 22): macro scans (flying among plants, around a fly) are a unique advantage of the simulator,
// but only if the pilot knows to scale them up. The owner sets such a scene's default Scene size to x2 or
// more in the admin (CatalogScene.scale); this says once, in the flight, what that means and that [ and ]
// change it. No DOM and no store here: app/builtin/scale.ts shows it; tools/bench/test/macro-hint.test.ts
// holds the rule.

/** From this owner default (x2) a scene is "scaled up" and earns the hint. */
export const MACRO_HINT_MIN = 2;

/** The browser's note that the hint was shown (a per-browser convenience, never a setting). */
export const MACRO_HINT_KEY = 'gsfpv.hint.macro';

/** What the rule needs to know about the scene that just started. */
export interface MacroHintFacts {
    /** the Scene size the scene starts at */
    start: number;
    /** the owner's default for the scene (the store's default of scene.transform; 1 when he set none) */
    ownerDefault: number;
    /** the pilot saved a size of his own for the scene: he has been here and tuned it */
    pilotOwn: boolean;
    /** a shared link brought a size for this visit: the chip says it already */
    sharedSize: boolean;
    /** the hint was shown before in this browser */
    seen: boolean;
}

/**
 * Show the hint: the scene starts at the owner's default (not the pilot's own size, not a shared link's)
 * and that default is x2 or more, and it was not shown before in this browser.
 */
export function macroHintDue(f: MacroHintFacts): boolean {
    return !f.seen && !f.pilotOwn && !f.sharedSize && f.ownerDefault >= MACRO_HINT_MIN && Math.abs(f.start - f.ownerDefault) < 1e-3;
}

type KeyStore = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStore(): KeyStore | null {
    try {
        return globalThis.localStorage ?? null;
    } catch {
        return null;
    }
}

/** Was the hint shown before? A blocked storage reads as "not yet" (it shows again, which is harmless). */
export function macroHintSeen(store: KeyStore | null = defaultStore()): boolean {
    try {
        return store?.getItem(MACRO_HINT_KEY) === '1';
    } catch {
        return false;
    }
}

/** Remember that it was shown. */
export function markMacroHintSeen(store: KeyStore | null = defaultStore()): void {
    try {
        store?.setItem(MACRO_HINT_KEY, '1');
    } catch {
        /* blocked or full storage: the hint shows again next time */
    }
}
