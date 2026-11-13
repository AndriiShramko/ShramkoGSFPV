// Train 1 contract (docs/wip/train1-plan.md, "Contracts between lanes"): what flying together says about itself on the page
// hook, window.__gsfpv.rooms. The page probes of the lane and of the integration stage read only this. Owner: lane rooms;
// it may add fields, it does not rename or drop these.

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
}
