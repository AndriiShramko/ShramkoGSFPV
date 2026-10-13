// Sound (v0.7 lane D1; a pilot's idea from Telegram, R-20261006: "an option to have the drone's working
// sound, flying is nicer then"). apps/fly/src/audio/motor-sound.ts makes the motors' sound from the
// simulated motor speeds (Web Audio; it only reads the flight model, never writes it).
//
// On by default, at 40 %: FPV pilots fly by ear (the motors tell throttle and load before the
// picture does), every FPV simulator ships with motor sound on, and the pilot who asked said flying is
// nicer with it. 40 % is quiet; the page stays silent until the pilot clicks or presses a key (the
// browser's rule), and the pause menu turns it off in one click (docs/wip/v07-d1.md section 4).
import type { SettingDef } from '../schema';

export const SOUND_DEFS: readonly SettingDef[] = [
    { id: 'sound.motors', group: 'sound', scope: 'global', type: 'bool', default: true, apply: 'live', shown: ['settings', 'pause'], status: 'shipped', since: 2 },
    { id: 'sound.volume', group: 'sound', scope: 'global', type: 'number', min: 0, max: 100, step: 5, unit: 'pct', default: 40, apply: 'live', shown: ['settings'], status: 'shipped', since: 2 }
];
