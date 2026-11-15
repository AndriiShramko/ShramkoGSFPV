// Render quality: the frame governor holds the display's frame rate, the settings' quality slider is
// its ceiling, and cinema mode renders at full detail with the governor off. ?governor=0 switches the
// governor off for a load (tests); the test hook's setFrameDelay burns CPU in each frame to simulate
// an overload mid-flight. The top splat budget is the device class's preset (4 M on a strong desktop) unless
// the scene's link, the pilot's setting or the scene's entry asks for another one (v0.7 lane R, app/drawing.ts):
// setTopBudget moves the governor's steps, the slider and cinema with it. The preset's top render scale
// (v0.10, setPresetScale) caps the resolution the governor lowers from: a phone starts at 70 % of its pixels.
import { FrameGovernor, GOVERNOR_SETTLE_MS, GOVERNOR_START_KEY, governorStartRecord, savedStartStep } from '@gsfpv/render-pc';
import type { SplatRenderer } from '@gsfpv/render-pc';
import { q } from './env';

/** Cinema mode's splat budget, millions: full detail, or the scene's own top when that is higher. */
const CINEMA_BUDGET_M = 16;

export class Quality {
    readonly governor = new FrameGovernor();
    private renderer: SplatRenderer;
    private userMaxScale: number;
    /** the device class preset's top render scale (setPresetScale); 1 = every pixel */
    private presetScale = 1;
    /** the settings' quality, 0 (stable frame) .. 1 (detail) */
    private userQuality = 1;
    private cinemaOn = false;
    /** test only (hook.setFrameDelay): ms of busy CPU in each frame */
    private frameDelay = 0;
    /** renderer.framesHeld at the last frame */
    private heldSeen = 0;
    /** renderer.streamTicks at the last frame: the scan's streamer at work since (governor `streamed`, report only) */
    private streamSeen = 0;

    constructor(renderer: SplatRenderer) {
        this.renderer = renderer;
        this.governor.enabled = q.get('governor') !== '0';
        this.userMaxScale = renderer.renderScale;
    }

    /** the device's id for the remembered start step (startFrom), null until the class and the GPU are known */
    private deviceId: string | null = null;
    /** the step last written for deviceId */
    private savedStep = -1;

    /**
     * R32: start the governor at the step this device (governorDeviceId) settled at on its last flight, once per
     * page; later calls (a scene switch) only keep the id. ?governor=0 keeps the top step (tests).
     */
    startFrom(id: string): void {
        if (this.deviceId === id) return;
        const first = this.deviceId === null;
        this.deviceId = id;
        let raw: string | null = null;
        try { raw = globalThis.localStorage?.getItem(GOVERNOR_START_KEY) ?? null; } catch { /* storage blocked */ }
        const s = savedStartStep(raw, id, this.governor.steps.length);
        this.savedStep = s;
        if (first && this.governor.enabled && s > 0) {
            this.governor.startAt(s);
            this.apply();
        }
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

    /**
     * The top render scale of this device's class preset (render-pc presets.ts renderScale): the resolution never
     * goes above it, the governor lowers it from there. Cinema mode (full detail) ignores it, like the budget.
     */
    setPresetScale(scale: number): void {
        const s = Math.max(0.1, Math.min(1, scale));
        if (s === this.presetScale) return;
        this.presetScale = s;
        this.apply();
    }

    /** The preset's top render scale now (the test hook and the settings line read it). */
    get presetRenderScale(): number {
        return this.presetScale;
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
        r.setRenderScale(Math.min(this.userMaxScale, this.presetScale, st.renderScale));
        r.setSplatBudgetMillions(Math.min(this.settingBudgetMillions, st.splatBudgetMillions));
    }

    /** Once per frame, first: the simulated overload (tests), then the governor's step. */
    frame(now: number): void {
        if (this.frameDelay > 0) { const end = now + this.frameDelay; while (performance.now() < end) { /* simulated overload */ } }
        // a frame the renderer held for the GPU queue (maxFramesInFlight) is a missed one
        const held = this.renderer.framesHeld !== this.heldSeen;
        this.heldSeen = this.renderer.framesHeld;
        // a level-of-detail file requested or arrived since the last frame: the governor counts a missed
        // frame now like any other and also as a streaming one, for the report (governor.ts onFrame `streamed`)
        const streamed = this.renderer.streamTicks !== this.streamSeen;
        this.streamSeen = this.renderer.streamTicks;
        // the governor's clock is the frame's rAF timestamp (the display's frame time), not the moment
        // this code runs: late work shows as whole skipped periods, and the short catch-up interval
        // after a late callback (5.5 ms after a 120 ms one, measured on ba7aa29d) never teaches it a
        // display period of 9-13 ms, which made every on-time frame "missed" (docs/wip/v08-c.md)
        if (!this.cinemaOn && this.governor.onFrame(this.renderer.frameTime, this.renderer.frameAfterSkip, held, streamed)) this.apply();
        // remember the step this device settled at for the next load (startFrom)
        if (this.deviceId !== null && !this.cinemaOn) {
            const s = this.governor.settledStep(this.renderer.frameTime, GOVERNOR_SETTLE_MS);
            if (s !== null && s !== this.savedStep) {
                this.savedStep = s;
                try { globalThis.localStorage?.setItem(GOVERNOR_START_KEY, governorStartRecord(this.deviceId, s)); } catch { /* storage full or blocked */ }
            }
        }
    }
}
