// The wind of the place (v0.7 lane E, the owner's item 10; docs/wip/v07-e.md). Owner: lane E.
// Group 'drone' (Drone & physics), beside gravity: both are the air and the planet the craft flies in.
//  - wind.mode, one choice for every scan: off; the scene's own wind (the admin's catalogue `wind`,
//    so off on a scan without one: the default); the wind at the place now (GET /api/wind/<id>?mode=now,
//    for a scan with a location; a scan without one falls back to its own wind, else none); custom.
//  - wind.fromDeg / speed / gust: the custom wind, per scan ("if the wind always blows from the north,
//    the scan could have it too"). Compass degrees the wind comes FROM, mean m/s at 10 m above the
//    ground, gust amplitude in m/s; ranges as the catalogue's. A scan without a compass heading takes
//    its forward axis as north (the Settings help says so).
// All four change the flight model (sim-core ParamOverrides.wind): 'life' settings.
import type { SettingDef } from '../schema';

/** wind.mode's options, in the order the screen shows them. */
export const WIND_MODES: readonly string[] = ['off', 'scene', 'now', 'custom'];

export const WIND_DEFS: readonly SettingDef[] = [
    { id: 'wind.mode', group: 'drone', scope: 'global', type: 'enum', options: WIND_MODES, default: 'scene', apply: 'life', shown: ['settings'], status: 'shipped', since: 2 },
    // from the west: the prevailing wind over most of Europe, where the owner flies
    { id: 'wind.fromDeg', group: 'drone', scope: 'scene', type: 'number', min: 0, max: 360, step: 5, unit: 'deg', default: 270, apply: 'life', shown: ['settings'], status: 'shipped', since: 2 },
    { id: 'wind.speed', group: 'drone', scope: 'scene', type: 'number', min: 0, max: 30, step: 0.5, unit: 'mps', default: 4, apply: 'life', shown: ['settings'], status: 'shipped', since: 2 },
    { id: 'wind.gust', group: 'drone', scope: 'scene', type: 'number', min: 0, max: 20, step: 0.5, unit: 'mps', default: 2, apply: 'life', shown: ['settings'], status: 'shipped', since: 2 }
];
