// When the first view of a scan is shown (v0.9 lane A, the owner's items 8, 10/16; docs/wip/v09-a.md).
// Pure: no engine, no DOM, no clock of its own, so tools/bench/test/reveal.test.ts drives it with the
// frame-by-frame traces the probe recorded (evidence/2026-10-17/v09-load-probe-base*.json).
//
// The rule until v0.8 waited for the engine to report a file loading and then none ("streamed in and
// resident"), else 30 s of silence. A single-file scan (meta.json, 62 % of SuperSplat's scenes) never
// reports a file loading: it is whole before the engine draws it. So every such scan sat at "Preparing
// the view" for 30 s after its last byte while it was already drawn behind the card (d8ba72a6, 224aba38,
// 15a202e6 measured at 33-38 s). The rule now reads the state, not a transition, so the content type,
// the browser's cache and an in-page switch on the shared renderer do not matter:
//   'ready'    every file of the first view has its bytes, the engine drew it and loads nothing more;
//   'settled'  the first view's files are in (or the engine drew the scan and loads nothing) for
//              SETTLE_MS: shown anyway (the engine may go on with the next level's prefetch or the
//              environment, which the view does not need). This bounds the wait after the bytes;
//   'pilot'    the pilot pressed "Fly now" once something was drawn (FLY_NOW_AFTER_MS into the stage);
//   'stall'    no byte and no change for REVEAL_STALL_MS: what there is, with the reason said.

/** Why the first view was shown (LoadProgress.reveal). */
export type RevealReason = 'ready' | 'settled' | 'pilot' | 'stall';

/** What the watch reads each frame (render-pc FirstView: bytes of the first view and the last frame). */
export interface ViewNow {
    /** the scan's file list is known */
    listed: boolean;
    /** every file the first view needs has all its bytes */
    complete: boolean;
    /** files of the first view, and of those the ones whose bytes are all in */
    files: number;
    filesIn: number;
    /** splats the engine drew in the last frame */
    drawn: number;
    /** the engine's last 'frame:ready' */
    ready: boolean;
    loading: number;
    /** performance.now() of the last byte of the scan or the walls, 0 before the first */
    lastByteAt: number;
}

/** After the first view's files are in, the longest the engine may go on loading before the view is shown. */
export const SETTLE_MS = 2500;
/** No byte and no change in the first view for this long: show what there is. */
export const REVEAL_STALL_MS = 30000;
/** "Fly now" is offered once something is drawn and the wait has lasted this long. */
export const FLY_NOW_AFTER_MS = 5000;

export class RevealWatch {
    private sig = '';
    private changedAt: number;
    /** when the settle condition began to hold, 0 while it does not */
    private settleFrom = 0;
    private readonly startedAt: number;

    constructor(now: number) {
        this.startedAt = now;
        this.changedAt = now;
    }

    /** The engine has the first view's files (or drew the scan and loads nothing): the settle clock runs. */
    private settling(v: ViewNow): boolean {
        return (v.listed && v.complete) || (v.listed && v.drawn > 0 && v.ready && v.loading === 0);
    }

    /** One observation (a frame, or the 250 ms timer when no frames come); the reason to show the view now, or null. */
    step(v: ViewNow, now: number, pilotAsked = false): RevealReason | null {
        const sig = `${v.listed}/${v.complete}/${v.filesIn}/${v.files}/${v.drawn > 0}/${v.ready}/${v.loading}`;
        if (sig !== this.sig) {
            this.sig = sig;
            this.changedAt = now;
        }
        if (v.listed && v.complete && v.drawn > 0 && v.ready && v.loading === 0) return 'ready';
        if (this.settling(v)) {
            if (this.settleFrom === 0) this.settleFrom = now;
            if (now - this.settleFrom >= SETTLE_MS) return 'settled';
        } else this.settleFrom = 0;
        if (pilotAsked && this.canFlyNow(v, now)) return 'pilot';
        if (now - Math.max(this.changedAt, v.lastByteAt) > REVEAL_STALL_MS) return 'stall';
        return null;
    }

    /** ms until the view is shown anyway (the settle bound), null when that bound is not running. */
    revealInMs(now: number): number | null {
        return this.settleFrom === 0 ? null : Math.max(0, SETTLE_MS - (now - this.settleFrom));
    }

    /** "Fly now" may be offered: something of the scan is drawn and the wait has lasted FLY_NOW_AFTER_MS. */
    canFlyNow(v: ViewNow, now: number): boolean {
        return v.drawn > 0 && now - this.startedAt >= FLY_NOW_AFTER_MS;
    }
}

/**
 * The pilot's "Fly now": the loading card presses it, the session's loader acts on it once it watches
 * the first view (a press before that is kept). One per load.
 */
export class FlyNow {
    private fn: (() => void) | null = null;
    pressed = false;

    press(): void {
        this.pressed = true;
        this.fn?.();
    }

    /** The loader's handler; called at once when the pilot already pressed. */
    bind(fn: () => void): void {
        this.fn = fn;
        if (this.pressed) fn();
    }
}
