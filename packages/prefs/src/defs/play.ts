// Easy play (v0.8 lane A, the owner's message 21 items 1, 2, 6; docs/wip/v08-a.md). Owner: lane A.
// How the touch sticks and the keyboard fly. A radio, a gamepad or a HID device never reads these:
// it keeps its arm switch and its own throttle.
//  - input.play: easy (default) = no arming (the first flying input starts the motors), the game
//    layout on the keyboard (WASD move, arrows turn and climb), altitude help, the pilot school;
//    pilot = as a radio: Space / the ARM button, a throttle that stays where it is left, Mode 2 keys.
//  - input.altitudeHelp: easy play holds the height and the climb/sink command asks for a speed
//    (apps/fly/src/play/assist.ts). Step 1 of the pilot school; never in acro.
//  - input.haptics: a short vibration on a crash with the touch sticks (where the browser can).
// v0.9 lane B (docs/wip/v09-b.md, the owner's message 22 item 1): on a keyboard 'easy' is the game scheme
// (mouse look through pointer lock, W A S D, Space up, Shift down, hover when keys are let go;
// apps/fly/src/play/game.ts). Its three settings:
//  - input.mouseSensitivity: x 0.25..3, 1 = 0.1 degrees of turn per pixel of mouse movement.
//  - input.mouseInvertY: the mouse's up and down inverted (off: away from you looks up, as in most games).
//  - input.gameSpeed: slow / normal / fast = 4 / 8 / 14 m/s across and 3 / 5 / 8 m/s up and down.
// v0.10 lane K (docs/wip/v10-k.md, the owner's message 23 item 1): the "How to fly" card shown when a scan opens.
//  - input.howToFly: on (default) = the card with the keys (or the sticks) of the input in use shows once per visit when the
//    scan is ready; its "Do not show again" box turns this off. K and the pause menu show it whatever this says.
import type { SettingDef } from '../schema';

export const PLAY_DEFS: readonly SettingDef[] = [
    { id: 'input.play', group: 'input', scope: 'global', type: 'enum', options: ['easy', 'pilot'], default: 'easy', apply: 'live', shown: ['settings'], status: 'shipped', since: 2 },
    { id: 'input.altitudeHelp', group: 'input', scope: 'global', type: 'bool', default: true, apply: 'live', shown: ['settings'], status: 'shipped', since: 2 },
    { id: 'input.haptics', group: 'input', scope: 'global', type: 'bool', default: true, apply: 'live', shown: ['settings'], status: 'shipped', since: 2 },
    { id: 'input.mouseSensitivity', group: 'input', scope: 'global', type: 'number', min: 0.25, max: 3, step: 0.05, unit: 'x', default: 1, apply: 'live', shown: ['settings'], status: 'shipped', since: 2 },
    { id: 'input.mouseInvertY', group: 'input', scope: 'global', type: 'bool', default: false, apply: 'live', shown: ['settings'], status: 'shipped', since: 2 },
    { id: 'input.gameSpeed', group: 'input', scope: 'global', type: 'enum', options: ['slow', 'normal', 'fast'], default: 'normal', apply: 'live', shown: ['settings'], status: 'shipped', since: 2 },
    { id: 'input.howToFly', group: 'input', scope: 'global', type: 'bool', default: true, apply: 'live', shown: ['settings'], status: 'shipped', since: 2 }
];
