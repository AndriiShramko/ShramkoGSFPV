// Fly by Sound switched on in place, wired to the page (train 3, lane sonic3): loaded by the main chunk's shim
// (app/builtin/sonic-flight.ts) at the first press of Backslash or of the pause item, never before. The switch itself is
// in-place-model.ts; this file gives it the page's sound setup, entry and installer.
import './texts';
import type { FlightContext } from '../app/context';
import type { FlightSession } from '../session';
import { Captions } from './captions';
import { SonicSetup } from './entry';
import { setSonicEntry } from './entry-state';
import { InPlaceSwitch, firstTimer } from './in-place-model';
import { loadMode } from './lazy-start';
import { allProgress, fliesBySound, setFliesBySound } from './store';
import { locale, t } from '../i18n';

/** The switch over this flight; `lessons` opens the mode's lessons beside it (the shim's modeScanPage in a new tab). */
export function inPlaceSwitch(ctx: FlightContext, lessons: () => void): InPlaceSwitch<SonicSetup> {
    let captions: Captions | null = null;
    return new InPlaceSwitch<SonicSetup>({
        flown: () => ctx.session,
        async start() {
            captions ??= new Captions();
            const setup = new SonicSetup(ctx.prefs, locale, captions);
            await setup.audio.start();
            return setup.audio.available ? setup : null;
        },
        stop: (setup) => void setup.audio.close().catch(() => undefined),
        setEntry: (e) => {
            // a lesson with other walls hands its session to the shell (feature.ts swapTo), as the ?sonic= page does
            const swap = (ctx as { swapSession?: (next: FlightSession, scene: { id: string }) => void }).swapSession;
            if (e && swap) e.swapSession = (next, scene) => swap.call(ctx, next, scene);
            setSonicEntry(e);
        },
        install: async (e) => (await loadMode())(ctx, e),
        firstTime: () => firstTimer(allProgress(ctx.prefs), fliesBySound(ctx.prefs)),
        markFlies: () => setFliesBySound(ctx.prefs),
        lessons,
        failed: (e) => {
            console.warn('fly by sound: did not switch on here', e);
            ctx.hud.flash(t('sonic.menu.hereFailed'), 4000);
        }
    });
}
