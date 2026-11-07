// Fly by Sound, the flight side (v0.12, lane v12-flight, docs/wip/v12-plan.md section 4.2): the lesson
// pilot's hook, the built-in lesson worlds, the sound engine in the page, the resets and the mode's own
// keys. Step 0 of the lead left this empty feature so the lanes never edit features.ts; the lane owns
// this file from here and fills install(). Every hook it adds must do nothing while the sound mode is off.
import type { Feature } from '../context';

export const sonicFlight: Feature = {
    id: 'sonic-flight',
    install() {
        // v12-flight
    }
};
