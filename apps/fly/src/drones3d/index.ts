// The entry of the 3D drone models chunk (v0.9 lane D). The picker and the pause menu load it with import() when they
// open, so the flight path never pays for it: the geometry, the studio and its stylesheet are in this chunk only.
export { mountStage, viewFor } from './viewer';
export type { Stage, StageInfo, StageOptions } from './viewer';
