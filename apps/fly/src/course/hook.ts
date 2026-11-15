// Train 1 contract (docs/wip/train1-plan.md, "Contracts between lanes"): what the course says about itself on the page
// hook, window.__gsfpv.course. The page probes of the lane and of the integration stage read only this. Owner: lane tracks;
// it may add fields, it does not rename or drop these.

import type { SonicObject, TrackFile } from '@shramko/sonic-fpv';

/** Lane onecourse (message 52, D1/D6): the course in the scene as Fly by Sound takes it. One course; the course feature owns it. */
export interface CourseForSound {
    /** the course shown now, its next gate (0-based, -1 after the last lap) and its gates in the flown world; null without one */
    inUse(): { track: TrackFile; next: number; gates: readonly SonicObject[] } | null;
    /** Shift+G's own action: a new course replaces the one in the scene */
    generate(): void;
}

export interface CourseHook {
    /** lane onecourse: the course for Fly by Sound; absent until the feature installs it */
    sound?: CourseForSound;
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
    /** stage G1-progress: the course's progress line now (course/progress.ts), the arrival warning, or null */
    progress?: string | null;
    /** stage G4-prove: every gate's centre and rotation (w, x, y, z), flown frame; [] without a course */
    gatePoses?: () => { pos: number[]; quat: number[]; shape?: Record<string, unknown> }[];
    /** stage G4-prove: the course HUD's text now (lap clock and lines), null when it is not on the page */
    clockText?: () => string | null;
    /** stage X2-gate-one: what the guide to the next gate shows now (course/hud.ts GuideState) */
    guide?: () => { shown: boolean; gate: number; metres: number; side: 'left' | 'right'; behind: boolean; inFrame: boolean; bearingDeg: number; x: number; y: number };
    /** lane course4 (S1, S2): banners over START / FINISH gates, lines on the ground, the gate carrying the number plate, roles */
    look?: () => { banners: number; groundLines: number; plate: number; roles: ('start' | 'finish' | 'startFinish' | null)[] };
    /** lane course4 (S4, S5): the lap's splash or the results card now (course/hud.ts SplashState) */
    splash?: () => { kind: 'none' | 'splash' | 'card'; text: string; delta: string; tone: string; mode: string; at: number; alpha: number };
    /** lane fix3b, Y1: the edit mode's Save check of the course in use, untouched, with the measured report; null without
     *  a course or walls (test data, read only). `move` checks a copy with one gate at another place (flown frame): the
     *  negative row of Y3 (a gate pushed into a wall must still be refused); the course in use is not changed. */
    saveCheck?: (move?: { gate: number; pos: readonly number[] }) => Record<string, unknown> | null;
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
    /** F2 (asked by lane editor3): the drone flies in the edit mode now (the mode's 'fly'), false in the edit view; probes
     *  read it, the page writes it (the editor's wiring sets it, absent until then) */
    readonly flying?: boolean;
    /** integration E (brief seam d): the selected gate's own flown pose from the course state (drag.ts gateFlownPose), so a
     *  probe measures a turn ring by the gate and not by the view's stand-in; null when no gate is selected */
    pose?: { pos: number[]; quat: number[] } | null;
}
