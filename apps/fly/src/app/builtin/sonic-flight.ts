// Fly by Sound, the flight side (v0.12, lane v12-flight, docs/wip/v12-plan.md section 4.2): the mode in the page
// (sonic/mode.ts: the prefs' session layer, the lesson pilot for every source, the bridge's samples and events on
// the bus, R short and long, N, [ ] locked, touches). One SonicMode per page, off until the entry or a lesson
// enters it (sonicMode(ctx).enter(...)). Every hook below does nothing while the mode is off: the frame, session
// and life listeners return at once, the keyup listener finds no press, the keys stay the scene's and the respawn's.
import { bindingOf } from '@gsfpv/prefs';
import type { Feature, FlightContext } from '../context';
import { t } from '../../i18n';
import { SonicMode } from '../../sonic/mode';

const modes = new WeakMap<FlightContext, SonicMode>();

/** The mode of this page (the entry, step 8, and the lessons, step 9, enter it), or null before the feature installed. */
export function sonicMode(ctx: FlightContext): SonicMode | null {
    return modes.get(ctx) ?? null;
}

export const sonicFlight: Feature = {
    id: 'sonic-flight',
    install(ctx) {
        const mode = new SonicMode({
            events: ctx.events,
            prefs: ctx.prefs,
            session: () => ctx.session,
            setLesson: (a) => ctx.input.setLesson(a),
            onKey: (action, run) => ctx.keys.on(action, run),
            note: (key) => ctx.hud.flash(t(key), 2500)
        });
        modes.set(ctx, mode);
        const offs = [
            ctx.events.on('frame', ({ now }) => { mode.frame(now); }),
            // a new scene: the bridge's tick hook follows its runner; the lesson pilot starts from the new craft
            ctx.events.on('session', (s) => {
                if (!mode.active) return;
                mode.follow(s);
                ctx.input.lessonPilot?.resetFlight();
            }),
            // a new life (a reset, a respawn, a new flight model): the same, for the runner it may have made
            ctx.events.on('life', () => {
                if (!mode.active) return;
                mode.follow(ctx.session);
                ctx.input.lessonPilot?.resetFlight();
            })
        ];
        // R's release decides short (the last checkpoint) from long (the start, taken while held)
        const rCodes = new Set((bindingOf('respawn.start')?.keys ?? []).map((k) => k.code));
        const onKeyUp = (e: KeyboardEvent): void => {
            if (rCodes.has(e.code)) mode.releaseR();
        };
        // a hidden tab draws no frames: the engine must not go on sounding the last layers
        const onVisibility = (): void => {
            if (document.visibilityState !== 'visible') mode.bridge.silence();
        };
        addEventListener('keyup', onKeyUp, true);
        document.addEventListener('visibilitychange', onVisibility);
        return () => {
            mode.leave();
            for (const off of offs) off();
            removeEventListener('keyup', onKeyUp, true);
            document.removeEventListener('visibilitychange', onVisibility);
            modes.delete(ctx);
        };
    }
};
