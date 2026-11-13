// The GPU hint's pieces that need no page (v0.12, docs/wip/v12-plan.md 2.12 and 4.2 step 11; lane gpu-select, docs/wip/gpu-select.md):
// what the hint says, in what words, the addresses it names, what the browser remembers about it, and when the note comes by itself.
// The rule (what the page draws on, and whether a hint is due) is render-pc's gpuSwitchHintDue; the page's part (the note over the
// flight, the line on the start screen and in the pause menu, the copy button, the spoken line in the mode) is app/builtin/gpu-hint.ts.
//
// The words come from the dictionary (packages/i18n/locales/fly/gpuhint: `gpuhint.*`, and `sonic.say.gpuHint` /
// `sonic.say.gpuSoftware` for the lines a helper hears in Fly by Sound), so the pieces here are data: tests hold that every way out
// is named, with the right address for the browser, in all four languages.
//
// Since lane gpu-select the note is no longer "once per browser". While the page draws on an integrated chip it comes on every
// visit, until the pilot presses "Do not show again"; and when the page later runs on a faster card that choice is forgotten, so a
// browser that falls back to the integrated chip (an update of the browser or of Windows can reset the switch) is told again,
// and told that it was on the faster card before.

/** The key of what the browser remembers about the hint (a per-browser fact, never a setting): GpuHintMemory. */
export const GPU_HINT_KEY = 'gsfpv.hint.gpu';

/**
 * What the browser remembers under GPU_HINT_KEY:
 *   'off'   the pilot pressed "Do not show again";
 *   'fast'  this browser has drawn the page on a faster card (the page saw it), so an integrated chip later is a fall back;
 *   null    nothing. The mark of v0.12 ('1': "shown once") reads as nothing: seen once is no longer a reason to stay quiet.
 */
export type GpuHintMemory = 'off' | 'fast' | null;

/** The flag of Chromium browsers that puts the browser on the high-performance GPU. */
export const FLAG_FRAGMENT = 'force-high-performance-gpu';

/**
 * Windows' own page for the per-application graphics choice (Settings, System, Display, Graphics). A page may link to it:
 * the browser asks the pilot before it opens Settings (measured in Chrome 140 and Edge 157, docs/wip/gpu-select.md).
 */
export const WINDOWS_GRAPHICS_SETTINGS = 'ms-settings:display-advancedgraphics';

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

/**
 * The address of the browser's own switch for graphics acceleration, as text to copy (the software note): Chrome, Edge and
 * Opera keep it under Settings, System; Firefox under Settings, General, Performance. null where the place is not known.
 */
export function accelerationAddress(userAgent: string): string | null {
    if (/Firefox\//.test(userAgent)) return 'about:preferences#general';
    if (/\bEdg(?:e|A|iOS)?\//.test(userAgent)) return 'edge://settings/system';
    if (/\bOPR\//.test(userAgent)) return 'opera://settings/system';
    if (/Chrome\//.test(userAgent)) return 'chrome://settings/system';
    return null;
}

/** Which note: how to switch to the faster card, the same after the browser fell back from it, why the processor draws. */
export type GpuNote = 'switch' | 'back' | 'software';

/** What the note says: the lead, the browser's way (with its address), Windows' way (with its link where there is one). */
export interface GpuHintParts {
    readonly note: GpuNote;
    readonly text: string;
    /** the browser's way, or null where the browser has none */
    readonly fixFlag: string | null;
    readonly address: string | null;
    readonly fixWindows: string;
    /** a second line of Windows' way (the software note on Windows: where the adapters are listed), or null */
    readonly fixWindowsMore: string | null;
    /** the address of Windows' graphics page for a link (the switch notes on Windows), or null */
    readonly settingsUrl: string | null;
}

export interface GpuHintPartsOptions {
    /** which note (default 'switch') */
    note?: GpuNote;
    /** the adapter's name for the lead; '' leaves the bracket with the name out */
    name?: string;
    /** the page is on Windows (default true: the switch hint is only ever due there) */
    windows?: boolean;
}

/** `{name}` in a dictionary line; with no name, the bracket that held it goes too (" ({name})"). */
function withName(line: string, name: string): string {
    return name ? line.split('{name}').join(name) : line.replace(/\s*\(\{name\}\)/g, '').split('{name}').join('');
}

/** The parts of the note in the pilot's language (`t` is the page's dictionary lookup). */
export function gpuHintParts(userAgent: string, t: (key: string) => string, o: GpuHintPartsOptions = {}): GpuHintParts {
    const note = o.note ?? 'switch';
    const name = o.name ?? '';
    const windows = o.windows ?? true;
    if (note === 'software') {
        const address = accelerationAddress(userAgent);
        return { note, text: withName(t('gpuhint.softText'), name), fixFlag: address ? t('gpuhint.softFixBrowser') : null, address, fixWindows: t('gpuhint.softFixDriver'), fixWindowsMore: windows ? t('gpuhint.softFixDriverWindows') : null, settingsUrl: null };
    }
    const address = flagsAddress(userAgent);
    return { note, text: withName(t(note === 'back' ? 'gpuhint.textBack' : 'gpuhint.text'), name), fixFlag: address ? t('gpuhint.fixFlag') : null, address, fixWindows: t('gpuhint.fixWindows'), fixWindowsMore: null, settingsUrl: windows ? WINDOWS_GRAPHICS_SETTINGS : null };
}

type KeyStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function defaultStore(): KeyStore | null {
    try {
        return globalThis.localStorage ?? null;
    } catch {
        return null;
    }
}

/** What the browser remembers about the hint. A blocked storage reads as nothing (the hint shows again, which is harmless). */
export function gpuHintMemory(store: KeyStore | null = defaultStore()): GpuHintMemory {
    try {
        const v = store?.getItem(GPU_HINT_KEY);
        return v === 'off' || v === 'fast' ? v : null;
    } catch {
        return null;
    }
}

/** Did the pilot say "Do not show again"? (The v0.12 mark, "shown once", is not that.) */
export function gpuHintSeen(store: KeyStore | null = defaultStore()): boolean {
    return gpuHintMemory(store) === 'off';
}

/** Remember "Do not show again". */
export function markGpuHintSeen(store: KeyStore | null = defaultStore()): void {
    try {
        store?.setItem(GPU_HINT_KEY, 'off');
    } catch {
        /* blocked or full storage: the hint shows again next time */
    }
}

/** Remember that this browser drew the page on a faster card (which also ends "Do not show again": a later fall back is said). */
export function noteFastGraphics(store: KeyStore | null = defaultStore()): void {
    try {
        if (store?.getItem(GPU_HINT_KEY) !== 'fast') store?.setItem(GPU_HINT_KEY, 'fast');
    } catch {
        /* blocked or full storage */
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

/** What the plan reads of the rule's reading (render-pc GpuHintReading; named here so this file needs no engine package). */
export interface GpuHintAsk {
    hint: 'switch' | 'software' | null;
    reason: string;
    kind: 'software' | 'integrated' | 'other';
}

export interface GpuHintPlan {
    /** the note this reading calls for (the status line and its button show it on demand), or null */
    note: GpuNote | null;
    /** the note comes by itself now */
    show: boolean;
    /** the page runs on a faster card: remember it ('fast'), which also ends "Do not show again" */
    rememberFast: boolean;
}

/**
 * What the page does with a reading: which note it calls for, whether it comes by itself, what to remember.
 *   - The switch note comes on every visit (once per page load, never over a paused flight) until "Do not show again".
 *   - After the browser was on a faster card ('fast'), the same reading is a fall back and the note says so ('back').
 *   - The software note comes once per visit whatever was remembered: "Do not show again" was said about another matter.
 *   - On a faster card (the rule's 'not-intel' or 'intel-discrete' on a graphics kind that is neither software nor
 *     integrated) nothing is shown and 'fast' is remembered.
 * `force`: the test hook's way to see the note whatever was shown or remembered.
 */
export function planGpuHint(reading: GpuHintAsk, memory: GpuHintMemory, o: { shownThisVisit: boolean; paused: boolean; force?: boolean }): GpuHintPlan {
    if (reading.hint === null) {
        const fast = reading.kind === 'other' && (reading.reason === 'not-intel' || reading.reason === 'intel-discrete');
        return { note: null, show: false, rememberFast: fast };
    }
    const free = !o.shownThisVisit && !o.paused;
    if (reading.hint === 'software') return { note: 'software', show: o.force === true || free, rememberFast: false };
    return { note: memory === 'fast' ? 'back' : 'switch', show: o.force === true || (free && memory !== 'off'), rememberFast: false };
}
