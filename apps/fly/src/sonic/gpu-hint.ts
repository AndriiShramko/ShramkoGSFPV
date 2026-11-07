// The GPU hint's pieces that need no page (v0.12, docs/wip/v12-plan.md 2.12 and 4.2 step 11): what the hint says, in what words,
// the address a browser's flag lives at, and the note that it was shown. The rule (when it is due) is render-pc's gpuSwitchHintDue;
// the page's part (the note over the flight, the copy button, the spoken line in the mode) is app/builtin/gpu-hint.ts.
//
// The words come from the dictionary (packages/i18n/locales/fly/gpuhint: `gpuhint.*`, and `sonic.say.gpuHint` for the line a
// helper hears in Fly by Sound), so the pieces here are data: tests hold that both ways to switch are named, with the right address
// for the browser, in all four languages.

/** The browser's note that the hint was shown (a per-browser convenience, never a setting): once is enough. */
export const GPU_HINT_KEY = 'gsfpv.hint.gpu';

/** The flag of Chromium browsers that puts the browser on the high-performance GPU. */
export const FLAG_FRAGMENT = 'force-high-performance-gpu';

/**
 * The address of that flag in the pilot's browser, to show as text (a page cannot link to a chrome:// address, only the pilot
 * can open it): Chrome and the browsers that say Chrome, Edge, Opera. null for a browser with no such flag (Firefox, Safari):
 * the hint then names the Windows setting alone.
 */
export function flagsAddress(userAgent: string): string | null {
    if (/Firefox\//.test(userAgent)) return null;
    if (/\bEdg(?:e|A|iOS)?\//.test(userAgent)) return `edge://flags/#${FLAG_FRAGMENT}`;
    if (/\bOPR\//.test(userAgent)) return `opera://flags/#${FLAG_FRAGMENT}`;
    // (also HeadlessChrome, the bench's own browser: the word Chrome is not at a word boundary there)
    if (/Chrome\//.test(userAgent)) return `chrome://flags/#${FLAG_FRAGMENT}`;
    return null;
}

/** What the note says: the lead, the browser's way (with its address), Windows' way. */
export interface GpuHintParts {
    readonly text: string;
    /** the browser's way, or null where the browser has no such flag */
    readonly fixFlag: string | null;
    readonly address: string | null;
    readonly fixWindows: string;
}

/** The parts of the note in the pilot's language (`t` is the page's dictionary lookup). */
export function gpuHintParts(userAgent: string, t: (key: string) => string): GpuHintParts {
    const address = flagsAddress(userAgent);
    return { text: t('gpuhint.text'), fixFlag: address ? t('gpuhint.fixFlag') : null, address, fixWindows: t('gpuhint.fixWindows') };
}

type KeyStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function defaultStore(): KeyStore | null {
    try {
        return globalThis.localStorage ?? null;
    } catch {
        return null;
    }
}

/** Was the hint shown before? A blocked storage reads as "not yet" (it shows again, which is harmless). */
export function gpuHintSeen(store: KeyStore | null = defaultStore()): boolean {
    try {
        return store?.getItem(GPU_HINT_KEY) === '1';
    } catch {
        return false;
    }
}

/** Remember that it was shown. */
export function markGpuHintSeen(store: KeyStore | null = defaultStore()): void {
    try {
        store?.setItem(GPU_HINT_KEY, '1');
    } catch {
        /* blocked or full storage: the hint shows again next time */
    }
}

/** Forget it (the test hook; a pilot never needs this). */
export function forgetGpuHint(store: KeyStore | null = defaultStore()): void {
    try {
        store?.removeItem(GPU_HINT_KEY);
    } catch {
        /* nothing stored */
    }
}
