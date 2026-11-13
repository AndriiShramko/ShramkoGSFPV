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
}
