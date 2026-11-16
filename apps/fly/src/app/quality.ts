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
import { drawPlan, KEEPER_SLOW_MS } from './detail-rule';

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
    /**
     * Lane loadq G1: the top budget is the pilot's own setting (drawing.ts from.budget 'setting'): the governor's step does
     * not lower it (app/detail-rule.ts drawPlan) until the pilot lets it choose again (release).
     */
    private handSetM: number | null = null;
    /** the pilot pressed "Let the page choose" for this setting */
    private releasedPin = false;
    /** since when the governor has wanted a lower step (0: it is at the top), the frame's time */
    private lowSince = 0;
    /** the last frame's time */
    private lastNow = 0;

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
     * page; later calls (a scene switch) only keep the id. ?governor=0 keeps the top step (tests). `mayStartLower`
     * false (a strong desktop, governorMayStartLower) keeps the top step too; the settled step is still remembered.
     */
    startFrom(id: string, mayStartLower = true): void {
        if (this.deviceId === id) return;
        const first = this.deviceId === null;
        this.deviceId = id;
        let raw: string | null = null;
        try { raw = globalThis.localStorage?.getItem(GOVERNOR_START_KEY) ?? null; } catch { /* storage blocked */ }
        const s = savedStartStep(raw, id, this.governor.steps.length);
        this.savedStep = s;
        if (first && mayStartLower && this.governor.enabled && s > 0) {
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
    setTopBudget(m: number, handSet = false): void {
        const was = this.pinned;
        const next = handSet ? m : null;
        // a new value set by hand is kept again, even after the pilot let the page choose for the last one
        if (next !== this.handSetM) this.releasedPin = false;
        this.handSetM = next;
        if (this.governor.setTopBudget(m) || was !== this.pinned) this.apply();
    }

    /** The budget is the pilot's own and is drawn as set (G1). */
    get pinned(): boolean {
        return this.handSetM !== null && !this.releasedPin && !this.cinemaOn;
    }

    /** The budget comes from the pilot's setting (pinned or let go). */
    get handSet(): boolean {
        return this.handSetM !== null;
    }

    /** The pilot let the page choose for the setting now in force. */
    get released(): boolean {
        return this.releasedPin;
    }

    /** The keeper has wanted a lower step for KEEPER_SLOW_MS while the setting is kept (the line says so). */
    get keeperSlow(): boolean {
        return this.governor.step > 0 && this.lowSince > 0 && this.lastNow - this.lowSince >= KEEPER_SLOW_MS;
    }

    /** The line's press: the governor works under the pilot's top again, for this setting. */
    release(): void {
        if (this.handSetM === null || this.releasedPin) return;
        this.releasedPin = true;
        this.apply();
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
        const p = drawPlan({
            pinned: this.pinned, userMaxScale: this.userMaxScale, presetScale: this.presetScale,
            settingBudgetM: this.settingBudgetMillions, stepScale: st.renderScale, stepBudgetM: st.splatBudgetMillions
        });
        this.planM = p.budgetM;
        // G6: a still picture draws the risen budget at the top render scale (builtin/still.ts sets it)
        if (this.stillM > p.budgetM) {
            r.setRenderScale(Math.min(this.userMaxScale, this.presetScale));
            r.setSplatBudgetMillions(this.stillM);
            return;
        }
        r.setRenderScale(p.scale);
        r.setSplatBudgetMillions(p.budgetM);
    }

    /** the budget apply() draws without the still rise, millions */
    private planM = 0;
    /** G6: the budget of a still picture, millions; 0 = none */
    private stillM = 0;

    /** The budget drawn without the still rise (the base G6 rises from), millions. */
    get baseBudgetMillions(): number {
        return this.planM;
    }

    /** G6 (builtin/still.ts): the still picture's budget, millions, 0 to go back to the base; applied at once. */
    setStillBudget(m: number): void {
        const next = this.cinemaOn ? 0 : m;
        if (next === this.stillM) return;
        this.stillM = next;
        this.apply();
    }

    /** The still picture's budget in force, millions (0: none). */
    get stillBudgetMillions(): number {
        return this.stillM;
    }

    /**
     * The keeper has chosen this flight's step (FrameGovernor.calm): the still rise waits for it (review LR-4), so a weak
     * device that waits at the start still finds its flight's step first.
     */
    get keeperCalm(): boolean {
        return this.cinemaOn || this.governor.calm(this.renderer.frameTime);
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
        // G6: the slower frames of a still picture are chosen, not missed: the keeper does not count them
        const still = this.stillM > 0;
        // the governor is told of the rest, so the first frames after a move are judged as a whole window (review LR-3)
        if (still) this.governor.rest(this.renderer.frameTime);
        else if (!this.cinemaOn && this.governor.onFrame(this.renderer.frameTime, this.renderer.frameAfterSkip, held, streamed)) this.apply();
        this.lastNow = now;
        if (this.governor.step === 0) this.lowSince = 0;
        else if (this.lowSince === 0) this.lowSince = now;
        // remember the step this device settled at for the next load (startFrom)
        if (this.deviceId !== null && !this.cinemaOn && !still) {
            const s = this.governor.settledStep(this.renderer.frameTime, GOVERNOR_SETTLE_MS);
            if (s !== null && s !== this.savedStep) {
                this.savedStep = s;
                try { globalThis.localStorage?.setItem(GOVERNOR_START_KEY, governorStartRecord(this.deviceId, s)); } catch { /* storage full or blocked */ }
            }
        }
    }
}
