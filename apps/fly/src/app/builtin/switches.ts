// Radio switches run app actions (v0.7 lane D2; Profile.switches, @gsfpv/input switches.ts): a range of
// an action (rewind, restart, record, pause, next or random scene, HUD) that the radio's switch enters
// runs the action as its key would, through the key router, so the same handler, the same screens
// that hold keys back and the same crash-state rules apply. Arm and flight mode never come here:
// controls.ts maps them onto the channels the flight reads.
import type { Feature } from '../context';

export const switches: Feature = {
    id: 'switches',
    install(ctx) {
        ctx.controls.onSwitchAction = (a) => { ctx.keys.trigger(a); };
        return () => { ctx.controls.onSwitchAction = null; };
    }
};
