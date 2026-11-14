// Flying through the course inside the edit mode (lane editor3, stage E3, docs/wip/editor3.md "The design", Flying through).
// The owner's words of message 51: "test them at once with the controller: moved one and flew through it on the spot,
// changed or added the next and flew again with the controller. Not split into stages." No pause and no extra press: arming
// the controller (or Space for a keyboard pilot) shows the drone's camera and the course from gate 1 with the edits in it;
// disarming or a crash brings the edit camera back where it was. The lap clock stays off while the mode is open. Pure.

export type EditMode = 'edit' | 'fly';

/** The mode the drone's state asks for: an armed drone that has not crashed flies, else the pilot edits. */
export function editModeOf(armed: boolean, crashed: boolean): EditMode {
    return armed && !crashed ? 'fly' : 'edit';
}

/** One frame: the mode now and the switch to make ('to-fly', 'to-edit') or null when it stays. */
export function modeStep(prev: EditMode, armed: boolean, crashed: boolean): { mode: EditMode; change: 'to-fly' | 'to-edit' | null } {
    const mode = editModeOf(armed, crashed);
    if (mode === prev) return { mode, change: null };
    return { mode, change: mode === 'fly' ? 'to-fly' : 'to-edit' };
}

/** What the edit mode's flight shows of the course: the next gate lights up, no lap time, no best lap written. */
export interface FlyShows {
    readonly nextGate: boolean;
    readonly lapClock: boolean;
    readonly writeBest: boolean;
}

export function flyShows(editing: boolean): FlyShows {
    return editing ? { nextGate: true, lapClock: false, writeBest: false } : { nextGate: true, lapClock: true, writeBest: true };
}
