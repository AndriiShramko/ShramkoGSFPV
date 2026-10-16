// Render quality: the frame governor holds the display's frame rate, the settings' quality slider is
// its ceiling, and cinema mode renders at full detail with the governor off. ?governor=0 switches the
// governor off for a load (tests); the test hook's setFrameDelay burns CPU in each frame to simulate
// an overload mid-flight. The top splat budget is 4 M unless the scene's link asks for another one
// (v0.7 lane R, app/drawing.ts): setTopBudget moves the governor's steps, the slider and cinema with it.
import { FrameGovernor } from '@gsfpv/render-pc';
import type { SplatRenderer } from '@gsfpv/render-pc';
import { q } from './env';

/** Cinema mode's splat budget, millions: full detail, or the scene's own top when that is higher. */
const CINEMA_BUDGET_M = 16;

export class Quality {
    readonly governor = new FrameGovernor();
    private renderer: SplatRenderer;
    private userMaxScale: number;
    /** the settings' quality, 0 (stable frame) .. 1 (detail) */
    private userQuality = 1;
    private cinemaOn = false;
    /** test only (hook.setFrameDelay): ms of busy CPU in each frame */
    private frameDelay = 0;
    /** renderer.framesHeld at the last frame */
    private heldSeen = 0;
    /** renderer.streamTicks at the last frame: the scan's streamer at work since (governor `streamed`) */
    private streamSeen = 0;

    constructor(renderer: SplatRenderer) {
        this.renderer = renderer;
        this.governor.enabled = q.get('governor') !== '0';
        this.userMaxScale = renderer.renderScale;
    }

    get cinema(): boolean {
        return this.cinemaOn;
    }

    /**
     * The Quality setting's cap on the splat budget, millions: a quarter of the top at 0, the top at 1
     * (1..4 M at the default top). apply() draws the smaller of this and the governor's step budget.
     */
    get settingBudgetMillions(): number {
        return this.governor.topBudgetMillions * (0.25 + 0.75 * this.userQuality);
    }

    /** Cinema on: full render scale and splat budget, the governor off (apply() puts it on screen). */
    setCinema(on: boolean): void {
        this.cinemaOn = on;
        this.governor.enabled = !on && q.get('governor') !== '0';
    }

    /** The settings' quality, 0 (stable frame) .. 1 (detail): the ceiling the governor works under. */
    setUser(quality: number): void {
        this.userQuality = quality;
        this.userMaxScale = 0.5 + quality * 0.5;
        this.apply();
    }

    /**
     * The scene's top splat budget, millions (drawing.ts: the link's ?budget=, else 4). Missed frames
     * lower the budget from here; nothing changes on screen when the top is the same as before.
     */
    setTopBudget(m: number): void {
        if (this.governor.setTopBudget(m)) this.apply();
    }

    setFrameDelay(ms: number): void {
        this.frameDelay = Math.max(0, Math.min(200, ms));
    }

    apply(): void {
        const r = this.renderer;
        if (this.cinemaOn) {
            r.setRenderScale(this.userMaxScale);
            r.setSplatBudgetMillions(Math.max(CINEMA_BUDGET_M, this.governor.topBudgetMillions));
            return;
        }
        const st = this.governor.current;
        r.setRenderScale(Math.min(this.userMaxScale, st.renderScale));
        r.setSplatBudgetMillions(Math.min(this.settingBudgetMillions, st.splatBudgetMillions));
    }

    /** Once per frame, first: the simulated overload (tests), then the governor's step. */
    frame(now: number): void {
        if (this.frameDelay > 0) { const end = now + this.frameDelay; while (performance.now() < end) { /* simulated overload */ } }
        // a frame the renderer held for the GPU queue (maxFramesInFlight) is a missed one
        const held = this.renderer.framesHeld !== this.heldSeen;
        this.heldSeen = this.renderer.framesHeld;
        // a level-of-detail file requested or arrived since the last frame: a late frame now is the
        // streamer's work, not a GPU that cannot draw the budget (governor.ts onFrame, v0.8 item 8)
        const streamed = this.renderer.streamTicks !== this.streamSeen;
        this.streamSeen = this.renderer.streamTicks;
        // the governor's clock is the frame's rAF timestamp (the display's frame time), not the moment
        // this code runs: late work shows as whole skipped periods, and the short catch-up interval
        // after a late callback (5.5 ms after a 120 ms one, measured on ba7aa29d) never teaches it a
        // display period of 9-13 ms, which made every on-time frame "missed" (docs/wip/v08-c.md)
        if (!this.cinemaOn && this.governor.onFrame(this.renderer.frameTime, this.renderer.frameAfterSkip, held, streamed)) this.apply();
    }
}
