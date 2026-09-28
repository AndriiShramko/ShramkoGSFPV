// The pilot's walls switch for this scan (Andrii, 2026-09-27): walls on or off is a new flight model
// and log (FlightSession.setWallsOn), remembered per scan. The walls menu, the settings block and C
// all switch through here; the walls box, the HUD tag and the voxel grid follow the 'walls' event.
import type { PrefsStore } from '@gsfpv/prefs';
import { saveWallsChoice } from '../flightwalls';
import { beacon } from './env';
import { mirrorWallsChoice } from './prefs';
import type { AppEvents, Bus, SceneRef, WallsHost } from './context';
import type { FlightSession } from '../session';

export function wallsHost(o: { session: () => FlightSession; scene: () => SceneRef; events: Bus<AppEvents>; clearCrash: () => void; prefs: PrefsStore | null }): WallsHost {
    return {
        has: () => !!o.session().collision,
        on: () => o.session().wallsOn,
        get adminOff() { return o.scene().meta?.walls === 'off'; },
        set(on: boolean, remember = true): void {
            const session = o.session();
            if (!session.collision) return;
            o.clearCrash();
            if (!session.setWallsOn(on)) return;
            if (remember) saveWallsChoice(o.scene().id, on);
            // wave 1 bridge (app/prefs.ts): scene.walls in the store follows the switch
            mirrorWallsChoice(o.scene().id, on, remember, o.prefs);
            o.events.emit('walls', { on });
            beacon('walls_switch', { on });
        }
    };
}
