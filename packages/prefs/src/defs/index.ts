// SCHEMA: every setting (A.8), one def file per owner (J). defineSettings sorts them into group
// order, so a file may hold defs of another group (stats.ts is in display, scene.ts in two).
import { defineSettings } from '../schema';
import { FLIGHT_DEFS } from './flight';
import { CRASH_DEFS } from './crash';
import { CAMERA_DEFS } from './camera';
import { DISPLAY_DEFS } from './display';
import { STATS_DEFS } from './stats';
import { INPUT_DEFS } from './input';
import { DRONE_DEFS } from './drone';
import { WIND_DEFS } from './wind';
import { TUNE_DEFS } from './tune';
import { SCENES_DEFS } from './scenes';
import { SCENE_DEFS } from './scene';
import { VOXELS_DEFS } from './voxels';
import { RECORDING_DEFS } from './recording';
import { CROSSHAIR_DEFS } from './crosshair';
import { SOUND_DEFS } from './sound';

export const SCHEMA = defineSettings([
    ...FLIGHT_DEFS,
    ...CRASH_DEFS,
    ...CAMERA_DEFS,
    ...DISPLAY_DEFS,
    ...STATS_DEFS,
    ...INPUT_DEFS,
    ...DRONE_DEFS,
    ...WIND_DEFS,
    ...TUNE_DEFS,
    ...SCENES_DEFS,
    ...SCENE_DEFS,
    ...VOXELS_DEFS,
    ...RECORDING_DEFS,
    ...CROSSHAIR_DEFS,
    ...SOUND_DEFS
]);

export { DRONE_IDS } from './drone';
export { RATE_TYPES, RATE_BOUNDS, validatePid, validateRates, validateThrottle } from './tune';
export type { RatesType, AxisRates, RatesValue, PidValue, ThrottleValue } from './tune';
export { validateTransform, SCALE_MIN, SCALE_MAX, WALLS_OPTIONS, CEILING_OPTIONS, CEILING_LIMIT_M } from './scene';
export { WIND_MODES } from './wind';
export { VOXEL_STYLES, VOXEL_VIEWS } from './voxels';
export type { SceneTransform } from './scene';
export { validateFolder } from './recording';
export { CROSSHAIR_SHAPES, CROSSHAIR_COLORS } from './crosshair';
export type { FolderValue } from './recording';
