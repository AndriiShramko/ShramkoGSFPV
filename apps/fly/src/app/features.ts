// Every feature of the flight page, one line each, append-only (docs/architecture-v03.md 1.1).
// They install in this order, which is also the order of their parts on the page (paint and focus
// order: the credit line, the walls box, the gravity note, the OSD, the voxel legend, the top
// buttons, the cinema bar) and of their event listeners. The pause menu sorts its items by each
// item's `order`, not by this list.
import type { Feature } from './context';
import { scene } from './builtin/scene';
import { walls } from './builtin/walls';
import { gravityNote } from './builtin/gravity';
import { hud } from './builtin/hud';
import { voxels } from './builtin/voxels';
import { topActions } from './builtin/top';
import { cinema } from './builtin/cinema';
import { crash } from './builtin/crash';
import { pause } from './builtin/pause';
import { respawn } from './builtin/respawn';
import { drone } from './builtin/drone';
import { controlsItem } from './builtin/controls';
import { settings } from './builtin/settings';
import { replays } from './builtin/replays';
import { measure } from './builtin/measure';
import { betaflightImport } from './builtin/import';
import { summary } from './builtin/summary';
import { modes } from './builtin/modes';

export const FEATURES: readonly Feature[] = [
    scene,
    walls,
    gravityNote,
    hud,
    voxels,
    topActions,
    cinema,
    crash,
    pause,
    respawn,
    drone,
    controlsItem,
    settings,
    replays,
    measure,
    betaflightImport,
    summary,
    modes
];
