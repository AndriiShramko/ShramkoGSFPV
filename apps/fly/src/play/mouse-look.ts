// Mouse look through pointer lock (docs/wip/v09-b.md; the owner's message 22, item 1). The page asks for the
// lock from a click (the browser needs that gesture), reads movementX/Y while it holds, and learns when it is
// gone: Esc is the browser's own release gesture, and it does not reach the page as a key, so a lost lock is
// what tells the flight to pause. Our own release (a dialog opens, the input changes) is told apart, so it
// never pauses anything. DOM only for the lock itself: what a movement means is play/game.ts.
//
// Unadjusted movement (no OS mouse acceleration) is asked for first, so the same hand movement turns the
// drone by the same angle at any speed, like in a game; a platform without it gets the plain lock.

export interface MouseLookHost {
    /** the element that holds the lock (the canvas) */
    target: HTMLElement;
    /** movement while the pointer is locked, in pixels */
    onMove(dxPx: number, dyPx: number): void;
    /** the lock went away and we did not ask for that (Esc, alt-tab, leaving full screen) */
    onLost(): void;
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
        if (this.locked) return true;
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
        return this.locked;
    }

    /** Let the mouse go (a dialog needs the cursor): the flight is not told it was lost. */
    unlock(): void {
        if (!this.locked) return;
        this.releasing = true;
        document.exitPointerLock();
    }

    private onChange = (): void => {
        const now = this.locked;
        if (now) { this.had = true; return; }
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
