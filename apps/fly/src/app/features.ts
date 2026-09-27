// Every feature of the flight page, one line each, append-only (docs/architecture-v03.md 1.1).
// They install in this order, which is also the order of their parts on the page (focus order)
// and of their per-frame work: quality, then the input, the crash view, the HUD.
import type { Feature } from './context';
import { scene } from './builtin/scene';
import { bake } from './builtin/bake';
import { gravityNote } from './builtin/gravity';
import { quality } from './builtin/quality';
import { input } from './builtin/input';
import { crash } from './builtin/crash';
import { hud } from './builtin/hud';
import { topActions } from './builtin/top';
import { cinema } from './builtin/cinema';
import { pause } from './builtin/pause';
import { drone } from './builtin/drone';
import { settings } from './builtin/settings';
import { replays } from './builtin/replays';
import { measure } from './builtin/measure';
import { betaflightImport } from './builtin/import';

export const FEATURES: readonly Feature[] = [
    scene,
    bake,
    gravityNote,
    quality,
    input,
    crash,
    hud,
    topActions,
    cinema,
    pause,
    drone,
    settings,
    replays,
    measure,
    betaflightImport
];
