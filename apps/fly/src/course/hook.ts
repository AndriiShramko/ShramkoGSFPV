// Train 1 contract (docs/wip/train1-plan.md, "Contracts between lanes"): what the course says about itself on the page
// hook, window.__gsfpv.course. The page probes of the lane and of the integration stage read only this. Owner: lane tracks;
// it may add fields, it does not rename or drop these.

export interface CourseHook {
    /** the course is shown and timed now (Shift+T, the pause menu) */
    on: boolean;
    /** where the course came from; 'none': this scene has no course in this tab */
    source: 'none' | 'generated' | 'server';
    /** the track's id and version; null without a course */
    track: { id: string; version: number } | null;
    /** the generator's seed when the course was generated in this tab or names one; else null */
    seed: number | null;
    /** the gates of the course */
    gates: number;
    /** index of the gate to fly next, 0-based; -1 without a course or after the last lap */
    next: number;
    /** the entities drawn for the course now (gates and arrows); 0 when the course is off */
    drawn: number;
    /** finished laps of this attempt */
    laps: number;
    lastLapMs: number | null;
    bestLapMs: number | null;
    /** the points the sound beacon follows (flown frame); 0 when the course gives none */
    beaconPoints: number;
    /** why the last generate, load or save did not happen; null when it did */
    problem: string | null;
    /** T3: the courses the server keeps for this scene (fetched on scene load; -1 until the answer came) */
    serverTracks: number;
    /** T3: the server's id of the course this tab saved for everyone; null before a save */
    saved: string | null;
    /** train 2, T3-editor-ui: the editor (tracks-plan 2.11); absent until the feature installs it */
    editor?: CourseEditorHook;
}

export interface CourseEditorHook {
    open: boolean;
    /** the selected gate, 0-based */
    selected: number;
    /** the course was changed since it was opened or last saved */
    changed: boolean;
    /** problems of the course as it stands (save is refused while any) */
    problems: number;
    /** the code of the last refusal (editor.ts EditRefusal), null after an accepted change */
    refused: string | null;
    /** the last line said in the live region */
    said: string;
    /** the votes this browser gave, by course id */
    votes: Record<string, number>;
    /** stage F1-finish: the paint of every gate while editing (course/editor/rules.ts EditPaint) */
    paints: string[];
    /** stage F1-finish: an admin session answered, "Save as the admin's version" is offered */
    admin: boolean;
    /** stage F1-finish: the course ids with a completed lap in this browser (their rows may vote) */
    lapped: string[];
    /** stage K2: the editor's camera on the selected gate (course/editor/camera.ts), flown frame; null when closed */
    /** `look`: where the camera looks (K2.6: right of the gate when the window covers the right part), `free` the window's left edge over the width */
    view?: { eye: number[]; at: number[]; look?: number[]; free?: number } | null;
}
