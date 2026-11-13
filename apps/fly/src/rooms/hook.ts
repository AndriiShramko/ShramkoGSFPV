// Train 1 contract (docs/wip/train1-plan.md, "Contracts between lanes"): what flying together says about itself on the page
// hook, window.__gsfpv.rooms. The page probes of the lane and of the integration stage read only this. Owner: lane rooms;
// it may add fields, it does not rename or drop these.
import type { RaceRow } from './race';

export interface RoomsHook {
    /** off: no room; lost: the connection went and the page is trying again */
    state: 'off' | 'connecting' | 'joined' | 'lost';
    /** the room's id (the value of ?room=); null without a room */
    room: string | null;
    /** this pilot's slot in the room; null until the server's welcome */
    slot: number | null;
    /** everyone in the room, this pilot included */
    members: readonly { slot: number; nick: string }[];
    /** the other pilots' drones as drawn in this frame (flown frame, metres); ageMs: time since their last pose arrived */
    remotes: readonly { slot: number; pos: readonly [number, number, number]; ageMs: number }[];
    /** the keys of the lines said or announced about the room, oldest first, at most the last 50 */
    said: readonly string[];
    /** why the last create or join did not happen; null when it did */
    problem: string | null;
    /** added in R3: the nickname this page joins with */
    nick?: string;
    /** added in R3: the room's link (https://<host>/fly/?scene=..&room=<id>) once joined; null outside a room */
    link?: string | null;
    /** added in R3: the slots whose name tag is placed in this frame */
    tags?: readonly number[];
    /** added by lane look: every remote drone of this frame, drawn or hidden by the near rule (remote-stage.ts) */
    drawn?: readonly DrawnRemote[];
    /** added by lane rooms2: 'persistent' for an open room (key 9), null outside a room */
    kind?: 'temp' | 'persistent' | null;
    /** added by lane rooms2: the room's open vote for another scan, null without one */
    vote?: { scene: string; by: number; yes: number; need: number; mine: boolean } | null;
    /** added by lane rooms2: the scan the room flies once this page flies it too, else null */
    roomScene?: string | null;
    /** added by lane rooms2, stage Q2: the room's race as this page sees it; null outside a room */
    race?: RaceHook | null;
}

/** The race of the room on this page (apps/fly/src/rooms/race-page.ts). */
export interface RaceHook {
    /** off: no race yet; prep: courses being built; count: the countdown; run: racing; results: over, the table stays */
    state: 'off' | 'prep' | 'count' | 'run' | 'results';
    /** the race's course ('g1.<seed>' or '<id>.v<n>') */
    course: string | null;
    laps: number;
    /** the start on the server's clock, ms */
    startAt: number | null;
    /** this pilot races (he was in the room when it was proposed) */
    racer: boolean;
    /** the course is built and drawn on this page */
    built: boolean;
    gates: number;
    /** the gate to fly next, -1 when none */
    next: number;
    /** the laps this page reported */
    sent: number;
    /** the last table of the service, place order */
    table: readonly RaceRow[];
    problem: string | null;
    /** the course's line through its gates, flown world (the probes fly it) */
    path: readonly (readonly number[])[];
    /** the gates as the lap timer checks them, flown world: centre, rotation (w, x, y, z) and opening kind (probes) */
    gatePoses: readonly { readonly pos: readonly number[]; readonly quat: readonly number[]; readonly kind: string }[];
}

/** One remote drone in this frame as the flight camera sees it (lane look). */
export interface DrawnRemote {
    slot: number;
    /** metres from the flight camera */
    distM: number;
    /** the near rule: 0 not drawn (body and tag), 1 whole, between: fading */
    alpha: number;
    /** the drone's box on the view (CSS px, clipped to the view), null when off the view; the whole view when behind the camera's near plane */
    box: [number, number, number, number] | null;
    /** the box's share of the view, 0..1 (also for a hidden drone: how much it would cover) */
    share: number;
}

/** The rooms part of the page hook (window.__gsfpv.rooms) when the page has one: the drawing code adds its fields there. */
export function roomsPageHook(): { drawn?: readonly DrawnRemote[] } | null {
    const g = (globalThis as { __gsfpv?: { rooms?: { drawn?: readonly DrawnRemote[] } } }).__gsfpv;
    return g?.rooms ?? null;
}
