// Crosshair (v0.7 lane D1; a pilot's idea from Telegram, R-20261006: "a crosshair in the centre").
// A mark over the centre of the flight view, drawn by apps/fly/src/crosshair.ts (pure: settings ->
// SVG) and app/builtin/crosshair.ts (the overlay). Off by default: a real FPV feed has none, and most
// pilots fly without one. Hidden in cinema mode and in the clean view, and never drawn into a
// recording (the recorder takes only the drawn scan; docs/wip/v07-d1.md section 3).
import type { SettingDef } from '../schema';

/** The marks, in the order the settings row lists them: off, a dot, a cross, a circle, a ring with a dot. */
export const CROSSHAIR_SHAPES: readonly string[] = ['off', 'dot', 'cross', 'circle', 'ringDot'];
/** The colours a pilot picks from (apps/fly/src/crosshair.ts maps each to its CSS colour). */
export const CROSSHAIR_COLORS: readonly string[] = ['green', 'white', 'yellow', 'red', 'cyan', 'magenta', 'black'];

/** The crosshair's settings (group Display): shape (off by default), size, colour, opacity. */
export const CROSSHAIR_DEFS: readonly SettingDef[] = [
    { id: 'crosshair.shape', group: 'display', scope: 'global', type: 'enum', options: CROSSHAIR_SHAPES, default: 'off', apply: 'live', shown: ['settings'], status: 'shipped', since: 2 },
    // the mark's outer size as a share of the view's shorter side, so it looks the same on a phone and a 4K screen
    { id: 'crosshair.size', group: 'display', scope: 'global', type: 'number', min: 1, max: 20, step: 0.5, unit: 'pct', default: 4, apply: 'live', shown: ['settings'], status: 'shipped', since: 2 },
    { id: 'crosshair.color', group: 'display', scope: 'global', type: 'enum', options: CROSSHAIR_COLORS, default: 'green', apply: 'live', shown: ['settings'], status: 'shipped', since: 2 },
    { id: 'crosshair.opacity', group: 'display', scope: 'global', type: 'number', min: 0.1, max: 1, step: 0.05, default: 0.8, apply: 'live', shown: ['settings'], status: 'shipped', since: 2 }
];
