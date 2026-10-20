// The drawing presets, one per class of device (v0.10 lane R, the owner's items 3 and 4): what a device starts with
// when nothing asks for anything else. The built-in table is ours (below); the owner overrides any field of any class
// in the admin ("Drawing defaults", stored with the catalogue, GET /api/catalog "drawing"), and a field he never set
// stays the built-in value. Pure data and rules, no engine and no DOM: the admin page and the simulator both read it,
// and apps/api/admin.py keeps a copy of the classes, the modes and the ranges (a test keeps them equal).
//
// Where the built-in numbers come from: docs/wip/v10-r.md, "Findings" and "Design".
import type { DeviceClass } from './device-class';
import { DEVICE_CLASSES } from './device-class';

export { DEVICE_CLASSES };
export type { DeviceClass };

/** What a class is drawn with; `drawing` is the mode the device gets when nobody asks (the order is in drawing.ts). */
export const PRESET_DRAWINGS = ['sorted', 'stochastic'] as const;
export type PresetDrawing = (typeof PRESET_DRAWINGS)[number];

export const PRESET_BUDGET_MIN = 0.25;
export const PRESET_BUDGET_MAX = 32;
export const PRESET_SCALE_MIN = 0.4;
export const PRESET_SCALE_MAX = 1;

export interface DrawingPreset {
    /** 'sorted': the classic, smooth drawing (every splat blended back to front); 'stochastic': SuperSplat's sort-free beta, a fine grain */
    drawing: PresetDrawing;
    /** the top splat budget, millions: the quality governor lowers it from here when frames are missed */
    budgetM: number;
    /** the top render scale, a share of the display's pixels (1 = every pixel); the governor lowers it from here */
    renderScale: number;
}

export type DrawingPresets = Record<DeviceClass, DrawingPreset>;

/** The owner's changes: any class, any field (what the admin stores). */
export interface DrawingDefaults {
    presets: Partial<Record<DeviceClass, Partial<DrawingPreset>>>;
}

/**
 * The built-in table. Sorted everywhere: the engine's stochastic drawing is a single dithered sample per pixel, which on
 * the interiors measured here sits 17 dB from the sorted picture and never converges to it (docs/wip/v10-r.md); it
 * stays one choice away (the pilot's Render setting, a link's ?stochastic, the scene's entry, or these presets).
 * Budgets: SuperSplat's viewer's own (4 M desktop, 2 M mobile); render scales: the quality governor's ladder
 * (governor.ts DEFAULT_STEPS: 1, 0.85, 0.7, 0.6, 0.5) entered where a device of that class settles, so a weak
 * device does not spend its first seconds missing frames on the way down.
 */
export const BUILTIN_PRESETS: DrawingPresets = {
    'desktop-strong': { drawing: 'sorted', budgetM: 4, renderScale: 1 },
    'desktop-weak': { drawing: 'sorted', budgetM: 2.5, renderScale: 0.85 },
    tablet: { drawing: 'sorted', budgetM: 2, renderScale: 0.85 },
    phone: { drawing: 'sorted', budgetM: 2, renderScale: 0.7 }
};

const round3 = (x: number): number => Math.round(x * 1000) / 1000;
const inRange = (v: unknown, lo: number, hi: number): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? round3(v) : undefined);

/**
 * The `drawing` document of the public catalogue (or the admin's draft), read strictly: known classes, known modes,
 * numbers in range, nothing else; undefined when nothing valid is left. apps/api/admin.py clean_drawing applies the
 * same rules before anything is stored, this protects the page from a hand-edited or older document.
 */
export function readDrawingDefaults(v: unknown): DrawingDefaults | undefined {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
    const raw = (v as { presets?: unknown }).presets;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
    const presets: DrawingDefaults['presets'] = {};
    for (const cls of DEVICE_CLASSES) {
        const p = (raw as Record<string, unknown>)[cls];
        if (!p || typeof p !== 'object' || Array.isArray(p)) continue;
        const o = p as Record<string, unknown>;
        const out: Partial<DrawingPreset> = {};
        if (o.drawing === 'sorted' || o.drawing === 'stochastic') out.drawing = o.drawing;
        const b = inRange(o.budgetM, PRESET_BUDGET_MIN, PRESET_BUDGET_MAX);
        if (b !== undefined) out.budgetM = b;
        const r = inRange(o.renderScale, PRESET_SCALE_MIN, PRESET_SCALE_MAX);
        if (r !== undefined) out.renderScale = r;
        if (Object.keys(out).length) presets[cls] = out;
    }
    return Object.keys(presets).length ? { presets } : undefined;
}

/** The preset of a class: the owner's fields over the built-in ones. */
export function presetFor(cls: DeviceClass, owner?: DrawingDefaults): DrawingPreset {
    return { ...BUILTIN_PRESETS[cls], ...(owner?.presets[cls] ?? {}) };
}

/** Every class's preset (what the admin shows and the simulator reads). */
export function presetTable(owner?: DrawingDefaults): DrawingPresets {
    return Object.fromEntries(DEVICE_CLASSES.map((c) => [c, presetFor(c, owner)])) as DrawingPresets;
}

/** The fields of a class the owner changed from the built-in value (the admin marks them). */
export function changedFields(cls: DeviceClass, owner?: DrawingDefaults): (keyof DrawingPreset)[] {
    const mine = owner?.presets[cls];
    if (!mine) return [];
    return (Object.keys(mine) as (keyof DrawingPreset)[]).filter((k) => mine[k] !== BUILTIN_PRESETS[cls][k]);
}
