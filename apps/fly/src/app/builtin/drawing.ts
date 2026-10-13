// The scan's drawing during a flight (v0.7 lane R, the owner's item 1): SuperSplat's stochastic
// drawing and the link's splat budget (app/drawing.ts decides, render-pc drawing.ts holds the rule).
// The scan already loaded with them (fly() and the scene host pass drawingFor() to the session); this
// feature makes the budget the governor's top level, applies the Display setting display.drawing live,
// does both again for every scene switched in the page, and says in a short HUD line when a request is
// not followed here (a phone, a tablet, WebGL) or when the stochastic drawing came from the link.
// window.__gsfpv.drawing: what was decided and what the engine draws with (benches read it).
import type { PrefChange } from '@gsfpv/prefs';
import { t } from '../../i18n';
import type { Feature, FlightContext } from '../context';
import { drawingFor, drawingMode, handheld, requestOf } from '../drawing';

/** How long the HUD line stays, ms: a refused request is read once, the "on" line is a reminder. */
const NOTE_MS = 7000;
const ON_MS = 4000;

function apply(ctx: FlightContext, announce: boolean): void {
    const r = ctx.renderer;
    const d = drawingFor(ctx.prefs, ctx.scene, r.isWebGPU);
    const engine = r.setStochastic(d.stochastic);
    ctx.quality.setTopBudget(d.budgetM);
    // a scene switch set the shared renderer's budget to the top while it loaded: back to the governor's step
    ctx.quality.apply();
    ctx.hook.drawing = { scene: ctx.scene.id, mode: drawingMode(ctx.prefs), request: requestOf(ctx.scene) ?? null, stochastic: d.stochastic, budgetM: d.budgetM, note: d.note, engineStochastic: engine, engineBudgetM: r.splatBudgetMillions, handheld, webgpu: r.isWebGPU };
    if (!announce) return;
    if (d.note) ctx.hud.flash(t(`drawing.note.${d.note}`), NOTE_MS);
    else if (engine && drawingMode(ctx.prefs) === 'auto') ctx.hud.flash(t('drawing.on', { budget: d.budgetM }), ON_MS);
}

export const drawing: Feature = {
    id: 'drawing',
    install(ctx) {
        apply(ctx, true);
        const offSession = ctx.events.on('session', () => apply(ctx, true));
        const offStore = ctx.prefs.onChange((c: PrefChange) => {
            if (c.id === 'display.drawing') apply(ctx, true);
        });
        return () => {
            offSession();
            offStore();
        };
    }
};
