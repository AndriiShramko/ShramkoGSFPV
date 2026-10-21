// The scan's drawing during a flight (v0.7 lane R, the owner's item 1; v0.9 items 7 and 13; v0.10 items 2-4):
// SuperSplat's stochastic drawing, the splat budget and the top render scale (app/drawing.ts decides,
// render-pc drawing.ts holds the rule: link > the pilot's Render / Splat budget settings > the owner's scene
// entry > the device class's preset, sorted unless the owner's preset says otherwise). The scan already loaded
// with them (fly() and the scene host pass drawingFor() to the session); this feature makes the budget the
// governor's top level and the preset's render scale its resolution cap, applies the Display settings live
// (Render, Splat budget, Device class), does all of it again for every scene switched in the page, and says in a
// short HUD line when a request is not followed here (a phone, a tablet, WebGL: who asked, the scene or the
// setting, and what was refused, stochastic or only the budget) or when the stochastic drawing came from a link.
// A setting the pilot changes while flying wins over the scene's link for the rest of that scene
// (app/drawing.ts setLive), so the control never looks dead.
// While a recording runs the scan is drawn sorted (app/clean-draw.ts, the recorder takes the hold): the engine
// follows `cleanDraw.held`, and the pilot's drawing comes back by itself when it lets go.
// window.__gsfpv.drawing: what was decided, by whom, and what the engine draws with (benches read it).
import type { PrefChange } from '@gsfpv/prefs';
import { t } from '../../i18n';
import type { Feature, FlightContext } from '../context';
import { deviceFor, drawingBudget, drawingDefaults, drawingFor, drawingMode, handheld, linkOf, mobile, setLive } from '../drawing';
import { cleanDraw } from '../clean-draw';

/** How long the HUD line stays, ms: a refused request is read once, the "on" line is a reminder. */
const NOTE_MS = 7000;
const ON_MS = 4000;

function apply(ctx: FlightContext, announce: boolean): void {
    const r = ctx.renderer;
    const d = drawingFor(ctx.prefs, ctx.scene, r.isWebGPU, r.gpuInfo);
    // a recording draws the clean sorted picture while it runs (the pilot's drawing, d, is what comes back)
    const clean = cleanDraw.held;
    const engine = r.setStochastic(d.stochastic && !clean);
    ctx.quality.setTopBudget(d.budgetM);
    ctx.quality.setPresetScale(d.renderScale);
    // a scene switch set the shared renderer's budget to the top while it loaded: back to the governor's step
    ctx.quality.apply();
    const request = linkOf(ctx.scene);
    const dev = deviceFor(ctx.prefs, r.isWebGPU, r.gpuInfo);
    ctx.hook.drawing = {
        scene: ctx.scene.id, mode: drawingMode(ctx.prefs), budgetSetting: drawingBudget(ctx.prefs) ?? null, request: request ?? null, catalogue: ctx.scene.meta?.render ?? null,
        stochastic: d.stochastic, budgetM: d.budgetM, from: d.from, note: d.note, engineStochastic: engine, engineBudgetM: r.splatBudgetMillions, handheld, mobile, webgpu: r.isWebGPU,
        // v0.10: the class this device is, what the browser said (auto), whether the pilot named it, the preset's resolution cap, the owner's table, the recording hold
        class: d.deviceClass, classAuto: dev.auto.cls, classReasons: dev.auto.reasons, classPicked: dev.picked, renderScale: d.renderScale, presetRenderScale: ctx.quality.presetRenderScale,
        owner: drawingDefaults() ?? null, held: clean, gpu: r.gpuInfo,
        // v0.11: which code draws stochastic (the accumulating SuperSplat renderer or the engine's own dither), what planStochastic
        // decided and why, what draws now, what the accumulating renderer lacks on this engine, and its live numbers
        impl: r.stochasticImpl, plan: r.plan, drawn: r.drawn, accumMissing: r.accumMissing(), accum: () => r.accumStats()
    };
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
            // the class the pilot names changes the preset Auto stands for, nothing else: no live choice to note
            if (c.id === 'display.deviceClass') { apply(ctx, true); return; }
            if (c.id !== 'display.drawing' && c.id !== 'display.budget') return;
            // the pilot just chose: for the rest of this scene the choice outranks its link; back to auto hands over to the link again
            setLive(ctx.scene, c.id === 'display.drawing' ? 'stochastic' : 'budget', c.value !== 'auto');
            apply(ctx, true);
        });
        // a recording started or ended (app/clean-draw.ts): the engine follows, the pilot's drawing comes back by itself
        const offHold = cleanDraw.onChange(() => apply(ctx, false));
        return () => {
            offSession();
            offStore();
            offHold();
        };
    }
};
