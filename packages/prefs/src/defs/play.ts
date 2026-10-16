// Easy play (v0.8 lane A, the owner's message 21 items 1, 2, 6; docs/wip/v08-a.md). Owner: lane A.
// How the touch sticks and the keyboard fly. A radio, a gamepad or a HID device never reads these:
// it keeps its arm switch and its own throttle.
//  - input.play: easy (default) = no arming (the first flying input starts the motors), the game
//    layout on the keyboard (WASD move, arrows turn and climb), altitude help, the pilot school;
//    pilot = as a radio: Space / the ARM button, a throttle that stays where it is left, Mode 2 keys.
//  - input.altitudeHelp: easy play holds the height and the climb/sink command asks for a speed
//    (apps/fly/src/play/assist.ts). Step 1 of the pilot school; never in acro.
//  - input.haptics: a short vibration on a crash with the touch sticks (where the browser can).
import type { SettingDef } from '../schema';

export const PLAY_DEFS: readonly SettingDef[] = [
    { id: 'input.play', group: 'input', scope: 'global', type: 'enum', options: ['easy', 'pilot'], default: 'easy', apply: 'live', shown: ['settings'], status: 'shipped', since: 2 },
    { id: 'input.altitudeHelp', group: 'input', scope: 'global', type: 'bool', default: true, apply: 'live', shown: ['settings'], status: 'shipped', since: 2 },
    { id: 'input.haptics', group: 'input', scope: 'global', type: 'bool', default: true, apply: 'live', shown: ['settings'], status: 'shipped', since: 2 }
];
