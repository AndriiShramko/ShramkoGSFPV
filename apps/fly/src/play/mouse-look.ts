// Mouse look through pointer lock (docs/wip/v09-b.md; the owner's message 22, item 1). The page asks for the
// lock from a click (the browser needs that gesture), reads movementX/Y while it holds, and learns when it is
// gone: Esc is the browser's own release gesture, and it does not reach the page as a key, so a lost lock is
// what tells the flight to pause. Our own release (a dialog opens, the input changes) is told apart, so it
// never pauses anything. DOM only for the lock itself: what a movement means is play/game.ts.
//
// Unadjusted movement (no OS mouse acceleration) is asked for first, so the same hand movement turns the
// drone by the same angle at any speed, like in a game; a platform without it gets the plain lock.
//
// A window that needs the cursor wins (lane mouse-free, docs/wip/mouse-free.md): a lock that lands while
// `host.held()` says one is up is let go at once, and sync() lets a held lock go when one opens. That covers the race the
// owner hit on 2026-11-13: "Send this list" closed the Controls screen (the last pause reason, so the flight
// asked for the lock inside that click) and opened the report form in the same click; the form's pause found
// no lock to release yet, then the lock landed over the form. The rule lives here, not in each window.

/** Windows over the flight that need the cursor: every panel (ui/dom.ts: the pause menu, the report form,
 *  settings, rooms, ceiling and floaters, the how-to-fly card), the Controls, drones and scenes screens, any
 *  modal dialog shown, Fly by Sound's start screen (while shown) and lesson menu, the crash view, the video
 *  export bar (builtin/video-export.ts: Cancel, Retry, Close). */
export const CURSOR_WINDOWS = ['.panel', '.screen.radio', '.screen.drones', '.screen.scenes',
    '[aria-modal="true"]:not([hidden])', '.sonic-start:not([hidden])', '.sonic-menu', '.crash-overlay', '.vx-bar'] as const;

/** A window that needs the cursor is in the page. */
export function cursorWindowOpen(root: Pick<ParentNode, 'querySelector'> = document): boolean {
    return CURSOR_WINDOWS.some((s) => root.querySelector(s) !== null);
}

export interface MouseLookHost {
    /** the element that holds the lock (the canvas) */
    target: HTMLElement;
    /** movement while the pointer is locked, in pixels */
    onMove(dxPx: number, dyPx: number): void;
    /** the lock went away and we did not ask for that (Esc, alt-tab, leaving full screen) */
    onLost(): void;
    /** a window that needs the cursor is up (default: cursorWindowOpen()) */
    held?(): boolean;
}

export class MouseLook {
    /** this browser has pointer lock at all */
    readonly supported: boolean = typeof Element !== 'undefined' && 'requestPointerLock' in Element.prototype;
    private releasing = false;
    private had = false;
    private readonly host: MouseLookHost;

    constructor(host: MouseLookHost) {
        this.host = host;
        document.addEventListener('pointerlockchange', this.onChange);
        document.addEventListener('mousemove', this.onMove, { capture: true });
    }

    /** A window that needs the cursor is up: a lock that lands now is let go. */
    get held(): boolean {
        return this.host.held ? this.host.held() : cursorWindowOpen();
    }

    /** Let the mouse go if a window that needs the cursor is up (any caller, any time: a window just opened). */
    sync(): void {
        if (this.locked && this.held) this.unlock();
    }

    /** The lock is held by our element. */
    get locked(): boolean {
        return document.pointerLockElement === this.host.target;
    }

    /**
     * Ask for the lock. Must run inside a user gesture (a click, a key press other than Esc). Resolves
     * true when the lock is held; false when the browser refused (no gesture, the window has no focus,
     * the lock was just released by the user and it is too soon).
     */
    async lock(): Promise<boolean> {
        if (!this.supported) return false;
        // a release still on its way (unlock() asked, the browser has not let go yet) is not a lock: the
        // caller shows the pill and the next click asks again, instead of a flight without the mouse
        if (this.releasing) return false;
        if (this.locked) return true;
        // No check of `held` before the request: the pause menu's Continue asks inside its click while the
        // menu is still up (it closes in the button's own handler). The lock lands later; onChange decides then.
        const el = this.host.target as HTMLElement & { requestPointerLock(o?: { unadjustedMovement?: boolean }): Promise<void> | undefined };
        try {
            try {
                await el.requestPointerLock({ unadjustedMovement: true });
            } catch (e) {
                // a platform that cannot turn the OS acceleration off: the plain lock
                if ((e as { name?: string })?.name !== 'NotSupportedError') throw e;
                await el.requestPointerLock();
            }
        } catch {
            return false;
        }
        if (this.locked && this.held) { this.unlock(); return false; }
        return this.locked && !this.releasing;
    }

    /** Let the mouse go (a dialog needs the cursor): the flight is not told it was lost. */
    unlock(): void {
        if (!this.locked) return;
        this.releasing = true;
        document.exitPointerLock();
    }

    private onChange = (): void => {
        const now = this.locked;
        // a lock that lands while a window needs the cursor (asked before it opened): let it go, quietly
        if (now) { this.had = true; if (this.held) this.unlock(); return; }
        if (!this.had) return;
        this.had = false;
        const ours = this.releasing;
        this.releasing = false;
        if (!ours) this.host.onLost();
    };

    private onMove = (e: MouseEvent): void => {
        if (this.locked) this.host.onMove(e.movementX, e.movementY);
    };

    dispose(): void {
        document.removeEventListener('pointerlockchange', this.onChange);
        document.removeEventListener('mousemove', this.onMove, { capture: true });
        if (this.locked) document.exitPointerLock();
    }
}
