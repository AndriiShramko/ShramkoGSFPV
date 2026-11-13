// Train 1, lane rooms (docs/wip/train1-plan.md): flying together: create a room, share its link, join, see and hear the
// other pilots' drones in the same scan. Owner: lane rooms. The feature is registered in app/features.ts on the train
// base, so the lane fills install() here (its code lives in apps/fly/src/rooms/) and never edits features.ts. The page
// hook it fills is RoomsHook (apps/fly/src/rooms/hook.ts, window.__gsfpv.rooms).
import type { Feature } from '../context';

export const rooms: Feature = {
    id: 'rooms',
    install() {
        // nothing until the lane lands: an ordinary flight is the same flight
    }
};
