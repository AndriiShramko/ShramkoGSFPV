// The splat detail the pilot set by hand, and the line that says what the page does with the detail (lane loadq,
// the owner's message 58, decisions G1 and G2, docs/wip/loadq.md). The pure half, tested in Node
// (tools/bench/test/loadq-detail.test.ts); app/quality.ts and builtin/detail.ts use it.
//
// G1: a budget the pilot set by hand (Settings, Display, Splat budget) is drawn as set: the frame rate keeper (the
// governor) keeps counting frames but does not lower it, unless the pilot lets it choose again (one press on the line).
// G2: one line under the credit, plain words: detail still coming, full for the setting, held back (the keeper, the
// scan has no finer level, the network).

/** What Quality.apply draws: the render scale and the splat budget, millions. */
export interface DrawPlan {
    scale: number;
    budgetM: number;
}

export interface DrawInput {
    /** the pilot set the budget by hand (drawing.ts `from.budget` === 'setting') and has not let the keeper choose */
    pinned: boolean;
    /** the Quality setting's caps: render scale and splat budget, millions */
    userMaxScale: number;
    presetScale: number;
    settingBudgetM: number;
    /** the governor's step now */
    stepScale: number;
    stepBudgetM: number;
}

/** The governor's step lowers the picture only when the budget is not pinned by the pilot (G1). */
export function drawPlan(i: DrawInput): DrawPlan {
    const top = Math.min(i.userMaxScale, i.presetScale);
    if (i.pinned) return { scale: top, budgetM: i.settingBudgetM };
    return { scale: Math.min(top, i.stepScale), budgetM: Math.min(i.settingBudgetM, i.stepBudgetM) };
}

/**
 * How long the keeper must want less before the line says the frames are slow, ms. An estimate: the governor steps
 * down after 1 s of missed frames (governor.ts DEFAULT_GOVERNOR), three of those windows is not a single hitch.
 */
export const KEEPER_SLOW_MS = 3000;

/** How long the line says the detail is full before it hides, ms (an estimate). */
export const FULL_SHOW_MS = 4000;

/** Drawn at least this share of the budget counts as full for the setting; less with nothing to come: no finer level. */
export const FULL_SHARE = 0.9;

export type DetailState = 'hidden' | 'still' | 'coming' | 'full' | 'nofiner' | 'kept' | 'lowered' | 'network' | 'givenup' | 'stilloff';

export interface DetailInput {
    /** the budget comes from the pilot's setting */
    handSet: boolean;
    /** the pilot let the keeper choose again (the press on the line) */
    released: boolean;
    /** the keeper wanted less than the setting for KEEPER_SLOW_MS (Quality.keeperSlow) */
    keeperSlow: boolean;
    /** the governor's step now (0 = the top) */
    step: number;
    /** the setting's budget and the one in force, millions */
    topM: number;
    budgetM: number;
    /** splats drawn in the last frame, millions */
    drawnM: number;
    /** files still to come, waiting for a pause, given up (render-pc StreamStats) */
    pending: number;
    retrying: number;
    /** files that failed or stalled once and are still to come (render-pc StreamStats.troubled) */
    troubled?: number;
    givenUp: number;
    filesPerSec: number;
    /** G6: the craft is still and the detail has risen above the base (StillRise.boostM > 0), for every pilot */
    still?: boolean;
    /** loadq2 R3: the graphics device was lost or ran out of memory while the still budget stood; the page went back to
     *  the flight's budget and switched "More detail at rest" off on this device (Quality.stillTurnedOff, said once) */
    stillOff?: boolean;
}

/** The state of the line. Network trouble shows for every pilot; the rest only for a budget set by hand (G4). */
export function detailState(i: DetailInput): DetailState {
    if (i.givenUp > 0) return 'givenup';
    if (i.retrying > 0 || (i.troubled ?? 0) > 0) return 'network';
    if (i.stillOff === true) return 'stilloff';
    // the detail still coming in for a budget set by hand is said as such, also at rest (review LR-1: the line said
    // 'sharper while you hold still' while the scan was still loading at the start)
    if (i.handSet && !i.released && i.keeperSlow) return 'kept';
    if (i.handSet && i.pending > 0 && !(i.released && i.step > 0 && i.budgetM < i.topM)) return 'coming';
    if (i.still === true) return 'still';
    if (!i.handSet) return 'hidden';
    if (!i.released && i.keeperSlow) return 'kept';
    if (i.released && i.step > 0 && i.budgetM < i.topM) return 'lowered';
    if (i.pending > 0) return 'coming';
    return i.drawnM >= FULL_SHARE * i.budgetM ? 'full' : 'nofiner';
}

/** A translator (i18n t). */
export type Say = (key: string, vars?: Record<string, string | number>) => string;

/** The press the line offers: let the keeper choose again, or ask the given-up files again. */
export type DetailAction = 'release' | 'retry' | null;

export interface DetailLine {
    text: string;
    action: DetailAction;
    actionText: string;
}

/** Millions with one decimal below 10 ("0.4", "6.2", "16"). */
export function millionsText(m: number): string {
    return m < 10 ? (Math.round(m * 10) / 10).toFixed(1) : String(Math.round(m));
}

/** The line's text for a state (i18n detail.*, packages/i18n/locales/fly/detail). */
export function detailLine(s: DetailState, i: DetailInput, say: Say): DetailLine {
    const none: DetailLine = { text: '', action: null, actionText: '' };
    const drawn = millionsText(i.drawnM);
    const top = millionsText(i.topM);
    switch (s) {
        case 'hidden': return none;
        case 'still': return { text: say('detail.still', { drawn }), action: null, actionText: '' };
        case 'coming': {
            const secs = i.filesPerSec > 0 ? Math.max(1, Math.round(i.pending / i.filesPerSec)) : 0;
            const text = secs > 0
                ? say('detail.coming', { drawn, top, files: i.pending, secs })
                : say('detail.comingStart', { drawn, top, files: i.pending });
            return { text, action: null, actionText: '' };
        }
        case 'full': return { text: say('detail.full'), action: null, actionText: '' };
        case 'nofiner': return { text: say('detail.nofiner'), action: null, actionText: '' };
        case 'kept': return { text: say('detail.kept'), action: 'release', actionText: say('detail.release') };
        case 'lowered': return { text: say('detail.lowered', { drawn, top }), action: null, actionText: '' };
        case 'network': return { text: say('detail.network', { files: Math.max(i.retrying, i.troubled ?? 0) }), action: null, actionText: '' };
        case 'givenup': return { text: say('detail.givenup', { files: i.givenUp }), action: 'retry', actionText: say('detail.retry') };
        case 'stilloff': return { text: say('detail.stilloff'), action: null, actionText: '' };
    }
}

/**
 * Whether the line shows now: full and no-finer show for FULL_SHOW_MS after they began, then hide until the state
 * changes; every other state shows while it lasts. `since`: when the current state began, ms.
 */
export function detailVisible(s: DetailState, since: number, now: number): boolean {
    if (s === 'hidden') return false;
    if (s === 'full' || s === 'nofiner') return now - since < FULL_SHOW_MS;
    return true;
}

// G6 (docs/wip/loadq.md, L1 (d)): more detail while the craft is still. While the craft's speed, turn rate and sticks
// are near rest (or the page is paused), the budget rises step by step as long as the last second's median frame stays
// under STILL_FRAME_MS and under a cap by the device's memory; any move (or the end of a pause) sets the base back in
// the same frame. Measured in L1 on Lublin from above at a base of 0.5 M: +4.9 dB after 5 s, +8.2 dB after 10 s.

/** Speed under which the craft counts as still, m/s (an estimate: a hover drifts by a few cm/s). */
export const STILL_SPEED_MS = 0.3;
/** Turn rate under which the craft counts as still, deg/s on every axis (an estimate). */
export const STILL_TURN_DEG_S = 15;
/** A stick (roll, pitch, yaw) off centre by this, or the throttle moved by this since rest began, is a move (an estimate, stick range -1..1). */
export const STILL_STICK = 0.05;
/** How long the craft must be still before the detail rises, ms (an estimate). */
export const STILL_AFTER_MS = 1000;
/** One rise each this long, ms (as measured in L1 with the probe's STILL switch). */
export const STILL_STEP_MS = 1000;
/** Each rise multiplies the budget by this (as measured in L1). */
export const STILL_RISE = 1.5;
/** The median frame time a still picture may take, ms (the lead's estimate, 15 frames a second). */
export const STILL_FRAME_MS = 66;

/** The top a still picture may rise to by the device's memory, millions (navigator.deviceMemory, GB; an estimate). */
export function stillCapM(deviceMemoryGB: number | undefined): number {
    if (deviceMemoryGB === undefined || !(deviceMemoryGB > 0)) return 8;
    if (deviceMemoryGB <= 4) return 4;
    // Chrome reports at most 8 (8 GB or more)
    if (deviceMemoryGB < 8) return 8;
    return 16;
}

export interface StillSample {
    now: number;
    paused: boolean;
    /** the craft's speed, m/s, and its largest turn rate on any axis, deg/s */
    speed: number;
    turnDegS: number;
    /** the sticks: roll, pitch, yaw (-1..1, 0 = centre) and throttle (-1..1) */
    roll: number;
    pitch: number;
    yaw: number;
    throttle: number;
    /** the time since the last frame, ms */
    frameMs: number;
    /** loadq2 R5: how fast the view itself turns (deg/s) and moves (m/s): the camera, whatever turns it (the mouse look,
     *  the course editor's camera, a stick); a turning view is a move, also in a pause */
    viewTurnDegS?: number;
    viewSpeed?: number;
}

/** loadq2 R3: the still budget is at most this many times the flight's budget in force (the lead's estimate). */
export const STILL_TIMES_BASE = 4;
/** loadq2 R3: on a touch device (the class phone or tablet) at most this many times (the lead's estimate). */
export const STILL_TIMES_BASE_TOUCH = 2;
/** How long the line says that "More detail at rest" was switched off after a device fault, ms (an estimate). */
export const STILL_OFF_SHOW_MS = 10000;

/** loadq2 R3: the top a still picture may rise to: the memory cap, and at most 4 (touch: 2) times the flight's budget. */
export function stillTopM(baseM: number, capM: number, touch: boolean): number {
    return Math.max(baseM, Math.min(capM, baseM * (touch ? STILL_TIMES_BASE_TOUCH : STILL_TIMES_BASE)));
}

/** The rule of G6: frame() once per frame; boostM is the budget a still picture draws (0: none, the base applies). */
export class StillRise {
    boostM = 0;
    private since = 0;
    private lastStep = 0;
    private throttle0 = 0;
    private wasPaused = false;
    private frames: number[] = [];

    /** True when boostM changed (the caller applies it at once). */
    frame(s: StillSample, baseM: number, capM: number, enabled: boolean, keeperCalm = true, touch = false): boolean {
        const unpaused = this.wasPaused && !s.paused;
        this.wasPaused = s.paused;
        const off = (v: number): number => (v < 0 ? -v : v);
        // R5: the view turning or moving is a move, paused or not
        const viewMoving = (s.viewTurnDegS ?? 0) >= STILL_TURN_DEG_S || (s.viewSpeed ?? 0) >= STILL_SPEED_MS;
        const moving = unpaused || viewMoving || (!s.paused && (s.speed >= STILL_SPEED_MS || s.turnDegS >= STILL_TURN_DEG_S
            || off(s.roll) >= STILL_STICK || off(s.pitch) >= STILL_STICK || off(s.yaw) >= STILL_STICK
            || (this.since > 0 && off(s.throttle - this.throttle0) >= STILL_STICK)));
        // the frame rate keeper chooses the flight's step before the detail rises (review LR-4); once risen, it is at rest
        if (!enabled || moving || (this.boostM === 0 && !keeperCalm)) return this.reset(s);
        if (this.since === 0) {
            this.since = s.now;
            this.lastStep = s.now;
            this.throttle0 = s.throttle;
            this.frames = [];
            return false;
        }
        if (s.frameMs > 0) this.frames.push(s.frameMs);
        if (s.now - this.since < STILL_AFTER_MS || s.now - this.lastStep < STILL_STEP_MS) return false;
        const med = median(this.frames);
        this.frames = [];
        this.lastStep = s.now;
        const cur = this.boostM > 0 ? this.boostM : baseM;
        let next = cur;
        if (med < STILL_FRAME_MS) next = Math.min(stillTopM(baseM, capM, touch), cur * STILL_RISE);
        else if (this.boostM > 0) next = cur / STILL_RISE;
        if (next <= baseM) next = 0;
        const changed = next !== this.boostM;
        this.boostM = next;
        return changed;
    }

    private reset(s: StillSample): boolean {
        this.since = 0;
        this.frames = [];
        this.throttle0 = s.throttle;
        const changed = this.boostM !== 0;
        this.boostM = 0;
        return changed;
    }
}

function median(a: number[]): number {
    if (a.length === 0) return 0;
    const b = [...a].sort((x, y) => x - y);
    return b[b.length >> 1];
}
