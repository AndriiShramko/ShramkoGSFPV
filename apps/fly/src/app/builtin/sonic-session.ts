// Fly by Sound, the session side (v0.12, lane v12-feedback, docs/wip/v12-plan.md section 4.3): the recorder of the flight
// and the pilot's voice, the local save, the survey, the replay and the upload of a recording to the author. Step 0 of the
// lead left this feature empty so the lanes never edit features.ts; the lane owns this file and the folder
// apps/fly/src/sonic-session/, where the work is. Every part is a no-op while the sound mode is off (ctx.sonic unset).
import { createSonicSession } from '../../sonic-session/session';
import type { Feature } from '../context';

export const sonicSession: Feature = {
    id: 'sonic-session',
    install(ctx) {
        const session = createSonicSession(ctx);
        return () => session.dispose();
    }
};
