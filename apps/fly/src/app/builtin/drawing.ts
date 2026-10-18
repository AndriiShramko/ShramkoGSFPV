// The scan's drawing during a flight (v0.7 lane R, the owner's item 1; v0.9 items 7 and 13): SuperSplat's
// stochastic drawing and the splat budget (app/drawing.ts decides, render-pc drawing.ts holds the rule:
// link > the pilot's Render / Splat budget settings > the owner's scene entry > the device's default,
// which on a desktop WebGPU browser is stochastic). The scan already loaded with them (fly() and the scene
// host pass drawingFor() to the session); this feature makes the budget the governor's top level, applies
// the Display settings live, does both again for every scene switched in the page, and says in a short HUD
// line when a request is not followed here (a phone, a tablet, WebGL: who asked, the scene or the setting,
// and what was refused, stochastic or only the budget) or when the stochastic drawing came from a link.
// A setting the pilot changes while flying wins over the scene's link for the rest of that scene
// (app/drawing.ts setLive), so the control never looks dead.
// window.__gsfpv.drawing: what was decided, by whom, and what the engine draws with (benches read it).
import type { PrefChange } from '@gsfpv/prefs';
import { t } from '../../i18n';
import type { Feature, FlightContext } from '../context';
import { drawingBudget, drawingFor, drawingMode, handheld, linkOf, mobile, setLive } from '../drawing';

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
    const request = linkOf(ctx.scene);
    ctx.hook.drawing = { scene: ctx.scene.id, mode: drawingMode(ctx.prefs), budgetSetting: drawingBudget(ctx.prefs) ?? null, request: request ?? null, catalogue: ctx.scene.meta?.render ?? null, stochastic: d.stochastic, budgetM: d.budgetM, from: d.from, note: d.note, engineStochastic: engine, engineBudgetM: r.splatBudgetMillions, handheld, mobile, webgpu: r.isWebGPU };
    if (!announce) return;
    // the note names who asked and what was refused (render-pc DrawingNote); a budget note quotes both numbers
    if (d.note) ctx.hud.flash(t(`drawing.note.${d.note}`, { budget: request?.budgetM ?? ctx.scene.meta?.render?.budgetM ?? drawingBudget(ctx.prefs) ?? d.budgetM, top: d.budgetM }), NOTE_MS);
    // a link or the owner's entry asked for stochastic and got it: say so once. The device's own default is not news.
    else if (engine && d.from.stochastic !== 'device' && d.from.stochastic !== 'setting') ctx.hud.flash(t('drawing.on', { budget: d.budgetM }), ON_MS);
}

export const drawing: Feature = {
    id: 'drawing',
    install(ctx) {
        apply(ctx, true);
        const offSession = ctx.events.on('session', () => apply(ctx, true));
        const offStore = ctx.prefs.onChange((c: PrefChange) => {
            if (c.id !== 'display.drawing' && c.id !== 'display.budget') return;
            // the pilot just chose: for the rest of this scene the choice outranks its link; back to auto hands over to the link again
            setLive(ctx.scene, c.id === 'display.drawing' ? 'stochastic' : 'budget', c.value !== 'auto');
            apply(ctx, true);
        });
        return () => {
            offSession();
            offStore();
        };
    }
};
