// Full screen (docs/wip/v09-b.md; the owner's message 22, item 6, a pilot's idea: "in the browser one gets
// distracted"). F and the top-bar button toggle the Fullscreen API on the whole page; it works together with
// pointer lock (play/mouse-look.ts). Esc or F11 leave it, as the browser says on entering. DOM only.

/** This browser lets the page go full screen (the API exists and no policy forbids it). */
export function fullscreenAvailable(): boolean {
    return typeof document !== 'undefined' && document.fullscreenEnabled === true;
}

/** The page is full screen now. */
export function isFullscreen(): boolean {
    return document.fullscreenElement !== null;
}

/**
 * Go full screen, or come back. Must run inside a user gesture (a key press or a click). Resolves
 * true when the page is full screen afterwards; false when it is not (refused, or just left).
 */
export async function toggleFullscreen(): Promise<boolean> {
    if (!fullscreenAvailable()) return false;
    try {
        if (isFullscreen()) await document.exitFullscreen();
        else await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    } catch {
        // refused (no gesture, an iframe without the permission): the page stays as it is
    }
    return isFullscreen();
}

/** Call `cb` whenever the page enters or leaves full screen; the returned function stops it. */
export function onFullscreenChange(cb: (on: boolean) => void): () => void {
    const h = (): void => cb(isFullscreen());
    document.addEventListener('fullscreenchange', h);
    return () => document.removeEventListener('fullscreenchange', h);
}
