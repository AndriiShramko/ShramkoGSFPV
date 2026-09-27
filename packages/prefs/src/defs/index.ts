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
import { TUNE_DEFS } from './tune';
import { SCENES_DEFS } from './scenes';
import { SCENE_DEFS } from './scene';
import { VOXELS_DEFS } from './voxels';
import { RECORDING_DEFS } from './recording';

export const SCHEMA = defineSettings([
    ...FLIGHT_DEFS,
    ...CRASH_DEFS,
    ...CAMERA_DEFS,
    ...DISPLAY_DEFS,
    ...STATS_DEFS,
    ...INPUT_DEFS,
    ...DRONE_DEFS,
    ...TUNE_DEFS,
    ...SCENES_DEFS,
    ...SCENE_DEFS,
    ...VOXELS_DEFS,
    ...RECORDING_DEFS
]);

export { DRONE_IDS } from './drone';
export { RATE_TYPES, RATE_BOUNDS, validatePid, validateRates, validateThrottle } from './tune';
export type { RatesType, AxisRates, RatesValue, PidValue, ThrottleValue } from './tune';
export { validateTransform, SCALE_MIN, SCALE_MAX } from './scene';
export type { SceneTransform } from './scene';
export { validateFolder } from './recording';
export type { FolderValue } from './recording';
