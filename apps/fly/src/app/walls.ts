// The pilot's walls switch (Andrii, 2026-09-27; one choice for every scan since 2026-10-02 message
// 16): walls on or off is a new flight model and log (FlightSession.setWallsOn). The store's
// scene.walls is the only place the choice lives (flightwalls.ts wallsWanted reads it); the flight
// follows the store, whoever changed it: C, the walls menu, Settings, a reset, an import, another
// tab. The walls box, the voxel grid and the HUD follow the flight (the 'walls' event, and the HUD
// reads the session itself every frame), so nothing keeps a copy that a scene switch could leave stale.
import type { PrefsStore } from '@gsfpv/prefs';
import { wallsWanted } from '../flightwalls';
import { beacon } from './env';
import type { AppEvents, Bus, SceneRef, WallsHost } from './context';
import type { FlightSession } from '../session';

export function wallsHost(o: { session: () => FlightSession; scene: () => SceneRef; events: Bus<AppEvents>; clearCrash: () => void; prefs: PrefsStore }): WallsHost {
    const wanted = (): boolean => wallsWanted(o.prefs, o.scene().id);
    /** The flight takes the store's value; nothing happens when it already flies it. */
    const follow = (): void => {
        const session = o.session();
        const on = wanted();
        if (session.wallsOn === on) return;
        if (!session.collision) {
            // nothing flies on walls yet: walls this scan gets later (a bake) start as the switch says
            session.wallsOn = on;
            return;
        }
        o.clearCrash();
        if (!session.setWallsOn(on)) return;
        o.events.emit('walls', { on });
        beacon('walls_switch', { on });
    };
    o.prefs.onChange((c) => { if (c.id === 'scene.walls') follow(); });
    // a new scene starts with the store's value (scene-host.ts); this only catches a change made while it loaded
    o.events.on('session', follow);
    return {
        has: () => !!o.session().collision,
        on: () => o.session().wallsOn,
        get adminOff() { return o.scene().meta?.walls === 'off' && !o.prefs.isExplicit('scene.walls'); },
        set(on: boolean, remember = true): void {
            if (wanted() === on) return;
            const v = on ? 'on' : 'off';
            if (remember) {
                // stored first: while ?walls= still holds this load the flight does not move; then
                // the link's value goes and the flight takes the pilot's (one new life, not two)
                o.prefs.set('scene.walls', v);
                o.prefs.clearSession('scene.walls');
            } else o.prefs.setSession('scene.walls', v);
        }
    };
}
