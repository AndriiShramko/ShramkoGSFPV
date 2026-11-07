// Fly by Sound, the session side (v0.12, lane v12-feedback, docs/wip/v12-plan.md section 4.3): the recorder of the flight
// and the pilot's voice, the local save, the survey, the replay and the upload of a recording to the author. Step 0 of the
// lead left this feature empty so the lanes never edit features.ts; the lane owns this file and the folder
// apps/fly/src/sonic-session/, where the work is.
//
// Every part is a no-op while the sound mode is off (ctx.sonic unset), and the session side is not even loaded then: it is
// about 370 KB of script (the sound package's dictionaries in four languages, the zip writer, the replay core, the panel; 90 KB
// compressed) that nobody who flies without the sound mode needs, and this feature is installed for every visitor of the
// simulator. It is fetched when ctx.sonic appears (the mode starts), one frame later, and installed then; ordinary flight never
// downloads, parses or runs it. The same pattern as the drone models (drone.ts imports drones3d the same way).
import type { SonicSession } from '../../sonic-session/session';
import type { Feature } from '../context';

/** After a fetch of the session side failed (offline, a release replaced under the page) the next try is this far off, ms. */
const RETRY_MS = 5000;

export const sonicSession: Feature = {
    id: 'sonic-session',
    install(ctx) {
        let session: SonicSession | null = null;
        let loading = false;
        let disposed = false;
        let retryAt = 0;
        const check = (): void => {
            if (ctx.sonic === undefined || loading || session !== null || disposed || performance.now() < retryAt) return;
            loading = true;
            import('../../sonic-session/session').then(
                (m) => {
                    loading = false;
                    if (disposed) return;
                    try {
                        session = m.createSonicSession(ctx);
                        off();
                    } catch {
                        // a fault in this feature must never reach the flight: it is left off for this page
                        retryAt = Infinity;
                    }
                },
                () => {
                    loading = false;
                    retryAt = performance.now() + RETRY_MS;
                }
            );
        };
        const off = ctx.events.on('frame', check);
        return () => {
            disposed = true;
            off();
            session?.dispose();
            session = null;
        };
    }
};
