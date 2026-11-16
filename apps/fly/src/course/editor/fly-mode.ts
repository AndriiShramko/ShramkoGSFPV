// Flying through the course inside the edit mode (lane editor3, stage E3, docs/wip/editor3.md "The design", Flying through).
// The owner's words of message 51: "test them at once with the controller: moved one and flew through it on the spot,
// changed or added the next and flew again with the controller. Not split into stages." No pause and no extra press: arming
// the controller (or Space for a keyboard pilot) shows the drone's camera and the course from gate 1 with the edits in it;
// disarming or a crash brings the edit camera back where it was. The lap clock stays off while the mode is open. Pure.

export type EditMode = 'edit' | 'fly';

// Review ED-3 (train 3 wave 2, the lead's wording): after a crash the view returns to the edit camera and stays there. The
// crash drops `armed` until the respawn, and the respawn may arm again (respawn.keepArmed); following `armed` through it
// showed the edit view for 0.5-4 s and then the drone again. Now a crash in flight sets `hold`: the edit view stays while
// the respawned drone is still armed, and flying again needs a fresh arm (armed seen false, then true: the switch off and
// on, or Space twice for a keyboard pilot).

export interface ModeStep {
    readonly mode: EditMode;
    readonly change: 'to-fly' | 'to-edit' | null;
    /** true after a crash in flight until the drone is seen disarmed */
    readonly hold: boolean;
    /**
     * Review EI-5: the drone lies crashed while the edit view is shown: put it back at the start now (the page's respawn), so
     * the mode line says DISARMED or ARMED, not CRASH, while the pilot edits. Also a crash after a Space tap disarmed in the
     * air, which happens in the edit mode itself.
     */
    readonly respawn: boolean;
}

/** One frame: the mode now, the switch to make ('to-fly', 'to-edit') or null, and the crash hold for the next frame. */
export function modeStep(prev: EditMode, armed: boolean, crashed: boolean, hold = false): ModeStep {
    let h = hold;
    let mode: EditMode;
    if (crashed) {
        mode = 'edit';
        if (prev === 'fly') h = true;
    } else if (!armed) {
        mode = 'edit';
        h = false;
    } else {
        mode = h ? 'edit' : 'fly';
    }
    const respawn = crashed && mode === 'edit';
    if (mode === prev) return { mode, change: null, hold: h, respawn };
    return { mode, change: mode === 'fly' ? 'to-fly' : 'to-edit', hold: h, respawn };
}

/** The mode the drone's state asks for with no crash hold: armed flies; disarmed or crashed edits. */
export function editModeOf(armed: boolean, crashed: boolean, prev: EditMode = 'edit'): EditMode {
    return modeStep(prev, armed, crashed).mode;
}

/** What the edit mode's flight shows of the course: the next gate lights up, the lap time and the guide show (integration E),
 *  no best lap written. */
export interface FlyShows {
    readonly nextGate: boolean;
    readonly lapClock: boolean;
    readonly writeBest: boolean;
}

export function flyShows(editing: boolean): FlyShows {
    return editing ? { nextGate: true, lapClock: true, writeBest: false } : { nextGate: true, lapClock: true, writeBest: true };
}
