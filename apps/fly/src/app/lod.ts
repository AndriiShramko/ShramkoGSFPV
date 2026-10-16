// The levels of detail at work (v0.8 lane C, the owner's item 8): one report for the F3 frame line, the
// test hook (window.__gsfpv.lod()) and a bug report's technical details. The owner opened his streamed
// city scan and could not see that it used levels of detail; F3 now says how many levels the scan has,
// how they are chosen, how many splats of how large a budget are drawn and at what resolution, and
// whether the quality governor lowered them.
import type { LodState } from '@gsfpv/render-pc';
import type { FlightContext } from './context';

/** A translator (i18n t): passed in, so this module runs in Node tests without the page's dictionaries. */
export type Say = (key: string, vars?: Record<string, string | number>) => string;

export interface LodReport extends LodState {
    /** the content file on screen (the session may have fallen back from a broken lod-meta.json) */
    contentUrl: string;
    /** content files that did not open before it, with why (session.contentFailures) */
    contentFailures: { url: string; error: string }[];
    /** the render scale now (the governor and the quality slider move it) */
    renderScale: number;
    /** the top of the splat budget: what the drawing gets when no frame is missed, millions */
    topBudgetM: number;
    /** the governor's step (0 = the top) */
    governorStep: number;
    /** late frames the governor did not count because the scan was streaming */
    streamHitches: number;
}

/** The report for the flight on screen. */
export function lodReport(ctx: Pick<FlightContext, 'renderer' | 'session' | 'quality'>): LodReport {
    const g = ctx.quality.governor;
    return {
        ...ctx.renderer.lodState(),
        contentUrl: ctx.session.scene?.contentUrl ?? '',
        contentFailures: [...ctx.session.contentFailures],
        renderScale: ctx.renderer.renderScale,
        topBudgetM: g.topBudgetMillions,
        governorStep: g.step,
        streamHitches: g.streamHitches
    };
}

/** Millions with one decimal below 10 M ("0.4", "3.9", "12"). */
function millions(m: number): string {
    return m < 10 ? (Math.round(m * 10) / 10).toFixed(1) : String(Math.round(m));
}

/** The F3 line about the levels of detail (i18n lod.*, packages/i18n/locales/fly/lod). */
export function lodLine(r: LodReport, say: Say): string {
    const vars = { levels: r.levels, drawn: millions(r.drawn / 1e6), budget: millions(r.budgetM), scale: Math.round(r.renderScale * 100) };
    let s = say(`lod.line.${r.mode}`, vars);
    // the governor lowered the budget to hold the frame rate: say from what
    if (r.mode !== 'final' && r.budgetM < r.topBudgetM - 1e-6) s += ` ${say('lod.lowered', { top: millions(r.topBudgetM) })}`;
    if (r.contentFailures.length > 0) s += ` ${say('lod.fallback')}`;
    return s;
}
