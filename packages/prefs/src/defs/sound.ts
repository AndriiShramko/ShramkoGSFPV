// Sound (v0.7 lane D1; a pilot's idea from Telegram, R-20261006: "an option to have the drone's working
// sound, flying is nicer then"). apps/fly/src/audio/motor-sound.ts makes the motors' sound from the
// simulated motor speeds (Web Audio; it only reads the flight model, never writes it).
//
// On by default: FPV pilots fly by ear (the motors tell throttle and load before the picture does),
// every FPV simulator ships with motor sound on, and the pilot who asked said flying is nicer with it.
// Quiet by default since v0.8 (the owner's message 21, item 3: "not loud by default; quiet; the user
// can raise it or switch it off"): 15 % instead of 40 %. The master gain is (v/100)^1.5 x 0.7
// (audio/motor-sound.ts), so 0.177 -> 0.041, 12.8 dB quieter, about -28 dB from full scale: a
// background whine that still tells the throttle by ear. A pilot who never moved the slider gets the
// new default (design A.6); one who set it keeps it. The page stays silent until the pilot clicks or
// presses a key (the browser's rule); the speaker on the top bar, the pause menu and Settings -> Sound
// switch it off (docs/wip/v08-a.md section 4).
import type { SettingDef } from '../schema';

/** The Sound group's settings: the motor sound on or off, and its volume. */
export const SOUND_DEFS: readonly SettingDef[] = [
    { id: 'sound.motors', group: 'sound', scope: 'global', type: 'bool', default: true, apply: 'live', shown: ['settings', 'pause'], status: 'shipped', since: 2 },
    { id: 'sound.volume', group: 'sound', scope: 'global', type: 'number', min: 0, max: 100, step: 5, unit: 'pct', default: 15, apply: 'live', shown: ['settings'], status: 'shipped', since: 2 }
];
