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

export type DetailState = 'hidden' | 'coming' | 'full' | 'nofiner' | 'kept' | 'lowered' | 'network' | 'givenup';

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
    givenUp: number;
    filesPerSec: number;
}

/** The state of the line. Network trouble shows for every pilot; the rest only for a budget set by hand (G4). */
export function detailState(i: DetailInput): DetailState {
    if (i.givenUp > 0) return 'givenup';
    if (i.retrying > 0) return 'network';
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
        case 'network': return { text: say('detail.network', { files: i.retrying }), action: null, actionText: '' };
        case 'givenup': return { text: say('detail.givenup', { files: i.givenUp }), action: 'retry', actionText: say('detail.retry') };
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
