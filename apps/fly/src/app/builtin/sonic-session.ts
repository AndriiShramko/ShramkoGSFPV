// Fly by Sound, the session side (v0.12, lane v12-feedback, docs/wip/v12-plan.md section 4.3): the
// recorder of the flight and the pilot's voice, the local save, the survey, the replay and the upload
// of a recording to the author. Step 0 of the lead left this empty feature so the lanes never edit
// features.ts; the lane owns this file from here and fills install().
import type { Feature } from '../context';

export const sonicSession: Feature = {
    id: 'sonic-session',
    install() {
        // v12-feedback
    }
};
