// Render quality: the frame governor holds the display's frame rate, the settings' quality slider is
// its ceiling, and cinema mode renders at full detail with the governor off. ?governor=0 switches the
// governor off for a load (tests); the test hook's setFrameDelay burns CPU in each frame to simulate
// an overload mid-flight.
import { FrameGovernor } from '@gsfpv/render-pc';
import type { SplatRenderer } from '@gsfpv/render-pc';
import { q } from './env';

export class Quality {
    readonly governor = new FrameGovernor();
    private renderer: SplatRenderer;
    private userMaxScale: number;
    private userBudget = 4;
    private cinemaOn = false;
    /** test only (hook.setFrameDelay): ms of busy CPU in each frame */
    private frameDelay = 0;
    /** renderer.framesHeld at the last frame */
    private heldSeen = 0;

    constructor(renderer: SplatRenderer) {
        this.renderer = renderer;
        this.governor.enabled = q.get('governor') !== '0';
        this.userMaxScale = renderer.renderScale;
    }

    get cinema(): boolean {
        return this.cinemaOn;
    }

    /** Cinema on: full render scale and splat budget, the governor off (apply() puts it on screen). */
    setCinema(on: boolean): void {
        this.cinemaOn = on;
        this.governor.enabled = !on && q.get('governor') !== '0';
    }

    /** The settings' quality, 0 (stable frame) .. 1 (detail): the ceiling the governor works under. */
    setUser(quality: number): void {
        this.userMaxScale = 0.5 + quality * 0.5;
        this.userBudget = 1 + quality * 3;
        this.apply();
    }

    setFrameDelay(ms: number): void {
        this.frameDelay = Math.max(0, Math.min(200, ms));
    }

    apply(): void {
        const r = this.renderer;
        if (this.cinemaOn) {
            r.setRenderScale(this.userMaxScale);
            r.setSplatBudgetMillions(16);
            return;
        }
        const st = this.governor.current;
        r.setRenderScale(Math.min(this.userMaxScale, st.renderScale));
        r.setSplatBudgetMillions(Math.min(this.userBudget, st.splatBudgetMillions));
    }

    /** Once per frame, first: the simulated overload (tests), then the governor's step. */
    frame(now: number): void {
        if (this.frameDelay > 0) { const end = now + this.frameDelay; while (performance.now() < end) { /* simulated overload */ } }
        // a frame the renderer held for the GPU queue (maxFramesInFlight) is a missed one
        const held = this.renderer.framesHeld !== this.heldSeen;
        this.heldSeen = this.renderer.framesHeld;
        if (!this.cinemaOn && this.governor.onFrame(now, this.renderer.frameAfterSkip, held)) this.apply();
    }
}
