// What says how a scene is drawn, read from the page's state (v0.9 lane R, items 7 and 13). The pure half of
// app/drawing.ts, with no `location` and no `navigator`, so it runs in Node tests: the pilot's two Display settings
// (Render, Splat budget), the scene's link less what the pilot overrode while flying it, the owner's entry, and
// the F3 line. @gsfpv/render-pc drawing.ts resolveDrawing holds the order: link > the pilot's settings > the
// owner's entry > the device.
import { pilotBudgetM } from '@gsfpv/render-pc';
import type { Drawing, DrawingAsk, DrawingMode } from '@gsfpv/render-pc';
import type { SceneRender } from '@gsfpv/scenes';

/** The part of a prefs store this reads (PrefsStore.get). */
export interface PrefsReader { get<T>(id: string): T }

/** The part of a scene this reads (app/context.ts SceneRef): the link it came from and the owner's catalogue entry. */
export interface AskedScene {
    render?: SceneRender;
    meta?: { render?: SceneRender };
}

/** The pilot's Display setting Render (anything unknown reads as auto). */
export function drawingMode(prefs: PrefsReader): DrawingMode {
    const v = prefs.get<string>('display.drawing');
    return v === 'stochastic' || v === 'sorted' ? v : 'auto';
}

/** The pilot's Display setting Splat budget, millions; undefined = auto (or anything unknown). */
export function drawingBudget(prefs: PrefsReader): number | undefined {
    return pilotBudgetM(prefs.get<string>('display.budget'));
}

/**
 * What the pilot changed in the Render settings while flying THIS scene: it wins over the scene's link
 * for the rest of that scene, so a control never looks dead (a link asked for stochastic, the pilot
 * picks Sorted: sorted draws). Kept per scene object, so the next scene starts clean.
 */
export interface LiveChoice { stochastic?: boolean; budget?: boolean }
const live = new WeakMap<object, LiveChoice>();

/** Note that the pilot just changed the Render mode (`on`: to something other than auto) or the budget on this scene. */
export function setLive(scene: object, what: keyof LiveChoice, on: boolean): void {
    const c = live.get(scene) ?? {};
    if (on) c[what] = true; else delete c[what];
    live.set(scene, c);
}

/** What the scene's link asks: its fields, less what the pilot overrode while flying it. */
export function linkOf(scene: AskedScene): SceneRender | undefined {
    const l = scene.render;
    if (!l) return undefined;
    const c = live.get(scene);
    if (!c?.stochastic && !c?.budget) return l;
    const r: SceneRender = {};
    if (!c.budget && l.budgetM !== undefined) r.budgetM = l.budgetM;
    if (!c.stochastic && l.stochastic !== undefined) r.stochastic = l.stochastic;
    return r.budgetM === undefined && r.stochastic === undefined ? undefined : r;
}

/** Everything that says how this scene is drawn (render-pc DrawingAsk): its link, the pilot's settings, the owner's entry. */
export function askFor(prefs: PrefsReader, scene: AskedScene): DrawingAsk {
    const link = linkOf(scene);
    const budgetM = drawingBudget(prefs);
    return { ...(link ? { link } : {}), pilot: { mode: drawingMode(prefs), ...(budgetM !== undefined ? { budgetM } : {}) }, ...(scene.meta?.render ? { scene: scene.meta.render } : {}) };
}

/**
 * The F3 line about the drawing: what it is and who decided it ("Render: stochastic (this device) · budget
 * 8 M splats (the link)"), the answer to "is it on, and why" that the owner could not get in v0.7.
 */
export function drawingLine(d: Drawing, say: (key: string, vars?: Record<string, string | number>) => string): string {
    return say('drawing.line', {
        mode: say(`drawing.mode.${d.stochastic ? 'stochastic' : 'sorted'}`),
        modeFrom: say(`drawing.from.${d.from.stochastic}`),
        budget: Math.round(d.budgetM * 100) / 100,
        budgetFrom: say(`drawing.from.${d.from.budget}`)
    });
}
