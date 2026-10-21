// What says how a scene is drawn, read from the page's state (v0.9 lane R, items 7 and 13). The pure half of
// app/drawing.ts, with no `location` and no `navigator`, so it runs in Node tests: the pilot's Display settings
// (Render, Splat budget, Device class), the scene's link less what the pilot overrode while flying it, the owner's
// entry, and the F3 line. @gsfpv/render-pc drawing.ts resolveDrawing holds the order: link > the pilot's settings >
// the owner's entry > the device's class preset.
import { DEVICE_CLASSES, pilotBudgetM } from '@gsfpv/render-pc';
import type { DeviceClass, DeviceReading, Drawing, DrawingAsk, DrawingMode, DrawingPreset } from '@gsfpv/render-pc';
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

/** The pilot's Display setting Device class: a class he named, or undefined for auto (and for anything unknown). */
export function deviceClassSetting(prefs: PrefsReader): DeviceClass | undefined {
    const v = prefs.get<string>('display.deviceClass');
    return (DEVICE_CLASSES as readonly string[]).includes(v) ? (v as DeviceClass) : undefined;
}

/** The class this page treats the device as: the pilot's own naming over what the browser says. */
export interface DeviceChoice {
    cls: DeviceClass;
    /** what the browser says (render-pc classifyDevice), whatever the pilot named */
    auto: DeviceReading;
    /** the pilot named the class (Settings -> Display -> Device class) */
    picked: boolean;
}

export function chooseDevice(prefs: PrefsReader, auto: DeviceReading): DeviceChoice {
    const named = deviceClassSetting(prefs);
    return { cls: named ?? auto.cls, auto, picked: named !== undefined };
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
export function drawingLine(d: Drawing, say: (key: string, vars?: Record<string, string | number>) => string, held = false, drawn?: 'sorted' | 'engine' | 'accum'): string {
    // a recording (REC, auto-record) draws sorted while it runs (app/clean-draw.ts): the line says so, not what Auto would draw.
    // `drawn` (the renderer's live answer, v0.11): the accumulating renderer says so; an engine that fell back to its own dither is plain "stochastic"
    const stochastic = d.stochastic && !held;
    return say('drawing.line', {
        mode: say(`drawing.mode.${!stochastic ? 'sorted' : drawn === 'accum' ? 'accumulating' : 'stochastic'}`),
        modeFrom: say(held && d.stochastic ? 'drawing.from.rec' : `drawing.from.${d.from.stochastic}`),
        budget: Math.round(d.budgetM * 100) / 100,
        budgetFrom: say(`drawing.from.${d.from.budget}`),
        device: say(`drawing.class.${d.deviceClass}`)
    });
}

/** What the Render row's live line (Settings -> Display) tells: the class this device is and what Auto draws with. */
export interface DeviceLineInput {
    /** the class in use (the pilot's naming over the browser's reading) */
    choice: DeviceChoice;
    /** the preset of that class: the owner's fields over the built-in ones */
    preset: DrawingPreset;
    /** the device can draw stochastic (desktop WebGPU): a preset that says stochastic on a phone draws sorted */
    canStochastic: boolean;
    /** a short name for the GPU ("nvidia lovelace"); empty when the browser hides it */
    gpu: string;
    /** the owner changed a field of this class's preset in the admin */
    ownerChanged: boolean;
    /** a recording runs: the picture is sorted until it stops */
    held: boolean;
}

/** The line and the notes under the Render row: "This device: desktop, strong graphics (nvidia lovelace). Auto draws sorted, up to 4 M splats, at 100 % of the screen's resolution." */
export function deviceLine(i: DeviceLineInput, say: (key: string, vars?: Record<string, string | number>) => string): { line: string; notes: string[] } {
    const stochastic = i.preset.drawing === 'stochastic' && i.canStochastic;
    const line = say('drawing.row.line', {
        device: say(`drawing.class.${i.choice.cls}`),
        gpu: i.gpu ? say('drawing.row.gpu', { gpu: i.gpu }) : '',
        mode: say(`drawing.mode.${stochastic ? 'stochastic' : 'sorted'}`),
        budget: Math.round(i.preset.budgetM * 100) / 100,
        scale: Math.round(i.preset.renderScale * 100)
    });
    const notes: string[] = [];
    if (i.choice.picked) notes.push(say('drawing.row.picked', { auto: say(`drawing.class.${i.choice.auto.cls}`) }));
    if (i.ownerChanged) notes.push(say('drawing.row.owner'));
    if (i.held) notes.push(say('drawing.row.held'));
    return { line, notes };
}
