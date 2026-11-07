// Fly by Sound, the flight side (v0.12, lane v12-flight, docs/wip/v12-plan.md section 4.2): the mode, its lessons and its engine
// in the flight page. This feature is a shim in the main chunk (v12-int step 4): every visitor of the simulator installs it, so
// it holds nothing of the mode. On a page entered through ?sonic= boot.ts has loaded the mode's chunk before the flight was made
// (sonic/lazy-start.ts) and set the entry; the shim then installs sonic/feature.ts installSonicFlight. On any other page it
// installs nothing: no listener, no key, and nothing of the sound package or the lessons was downloaded.
import { sonicEntry, sonicInstaller } from '../../sonic/entry-state';
import type { Feature } from '../context';

export const sonicFlight: Feature = {
    id: 'sonic-flight',
    install(ctx) {
        const entry = sonicEntry();
        const install = sonicInstaller();
        if (!entry || !install) return undefined;
        return install(ctx, entry);
    }
};
