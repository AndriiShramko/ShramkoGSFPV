// @gsfpv/prefs (docs/architecture-v03.md A.1). The keymap is the lead's contract; the store,
// schema, defs, migrations, import/export and catalogue append their exports below it.
export * from './keymap';
export * from './schema';
export * from './doc';
export * from './migrate';
export * from './io';
export * from './store';
export * from './url';
export * from './catalog';
export * from './browser';
export { SCHEMA, DRONE_IDS, RATE_TYPES, RATE_BOUNDS, validatePid, validateRates, validateThrottle, validateTransform, validateFolder, SCALE_MIN, SCALE_MAX } from './defs';
export type { RatesType, AxisRates, RatesValue, PidValue, ThrottleValue, SceneTransform, FolderValue } from './defs';
