// Train 3, lane quiet (the owner's message 54, the lead's Q3): with the narrator off ("sounds only") a flight says no line, so every
// event a flight told in words has a sound instead, or none with the reason. This is the one table of those lines; the bridge
// (bridge.ts say) and the page's other speakers (app/say-via.ts: the course, the walls, the rooms, the recorder, through
// runtime.ts PageRuntime.quietSound) both read it, so a line made quiet anywhere plays the same sound. Every sound here is one of the
// package's own cues (contract.ts CueEvent, planner.ts), already in its offline audio proofs and its limit of sounds at once: no new
// sound. It is the mode's (the main chunk asks for none of these texts, tools/bench/test/sonic-int-lazy.test.ts).
import type { CueEvent } from '@shramko/sonic-fpv';

/** One line's sound with the narrator off (null: nothing, `why` says why). */
export interface QuietSound {
    readonly cue: CueEvent | null;
    readonly why: string;
}

const CUE_SENT = 'its cue is sent with the line already';
const TEACHES = 'words that teach the keys; with the narrator off the pilot has learned them, the captions keep them for the eye';
const FLIGHT_ON = 'the flight goes on and nothing waits for it (Q2); the hum is the sound of it';

/** Every line a flight (the free flight over a scan, in place or on the sound page, and its course) can say, and its sound when quiet. */
export const QUIET_SOUNDS: Readonly<Record<string, QuietSound>> = Object.freeze({
    // the course and its gates (the runner over a track, lessons.ts over the scene's course)
    'fly.gate-behind': { cue: { kind: 'wrong-side' }, why: 'a gate missed is behind: one short falling sound, the hum leads back to it' },
    'sonic.say.gateBehind': { cue: { kind: 'wrong-side' }, why: 'a gate missed is behind: one short falling sound, the hum leads back to it' },
    'fly.wrong-way': { cue: null, why: `${CUE_SENT} ('wrong-way', runner.ts and lessons.ts)` },
    'fly.wrong-side': { cue: null, why: `${CUE_SENT} ('wrong-side', runner.ts)` },
    'fly.stage': { cue: null, why: `${CUE_SENT} ('stage', runner.ts)` },
    // a crash that puts the craft back (the touch's own cue sounds at the contact, mode.ts)
    'fly.reset-start': { cue: { kind: 'reset' }, why: 'the craft is put back: the falling sweep' },
    'fly.reset-checkpoint': { cue: { kind: 'reset' }, why: 'the craft is put back: the falling sweep' },
    // the start of a flight and the mode switched on
    'sonic.say.inPlaceOn': { cue: { kind: 'answer', what: 'yes' }, why: 'the mode is on: two notes up' },
    'fly.go': { cue: null, why: FLIGHT_ON },
    'fly.go-on': { cue: null, why: FLIGHT_ON },
    'lesson.scan-free.title': { cue: null, why: TEACHES },
    'sonic.say.lessonKeys': { cue: null, why: TEACHES },
    'sonic.say.lessonKeysFree': { cue: null, why: TEACHES },
    'sonic.say.inPlaceIntro': { cue: null, why: TEACHES },
    'sonic.say.inPlaceIntroCourse': { cue: null, why: TEACHES },
    'sonic.say.courseOffer': { cue: null, why: TEACHES },
    // the scan's walls (walls.ts, lessons.ts)
    'sonic.say.wallsIn': { cue: { kind: 'checkpoint' }, why: 'the walls are ready: the short chime, as for a course ready' },
    'sonic.say.wallsBuilding': { cue: null, why: FLIGHT_ON },
    'sonic.say.wallsStill': { cue: null, why: FLIGHT_ON },
    'sonic.say.wallsFailed': { cue: null, why: 'nothing changes for the pilot: the flight goes on as before; the caption shows it' },
    'sonic.say.wallsCoarse': { cue: null, why: 'a fact of the scan, not an event of the flight; the caption shows it' },
    'sonic.say.scanNoWalls': { cue: null, why: 'a fact of the scan, not an event of the flight; the caption shows it' },
    // the course made by Shift+G (app/builtin/course.ts): its progress lines are free text; its ready line passes its own sound, the
    // short chime ({ kind: 'checkpoint' }, sayVia's quietCue), as the walls ready do
    // Free text (app/builtin/course.ts, app/builtin/walls.ts): the table's answer is for the progress lines; the speakers pass their own
    // sound for the rest (review QW-1, QW-2, QW-6): the course ready 'checkpoint' chime; a lap (course.best,
    // course.lapDone) the 'lap' notes, the course's end the finish notes 'fanfare' (the lead's M3) (the runner sends none for this course: it is counted by the course feature); Shift+G that
    // brings no course (fail(): course.failed, course.none and the like) and a walls build that failed 'wrong-side' (no gate is there
    // to be missed then); Shift+G pressed while the course is being made, and the walls' "the picture may stop" the 'answer' wait
    'sonic.say.text': { cue: null, why: 'progress of the course or the walls being made: the flight goes on; the other lines pass their own sound' }
});

/** The sound of the narrator switched off by its key (Q4): two notes down, unlike the chime of a gate or a course ready. */
export const NARRATOR_OFF_CUE: CueEvent = Object.freeze({ kind: 'answer', what: 'no' });

/** A line's sound with the narrator off; null for a line with none or one not in the table. */
export function quietCue(key: string): CueEvent | null {
    return QUIET_SOUNDS[key]?.cue ?? null;
}
