// The throttle style of the radio, gamepad or HID controller in use (lane center-throttle, docs/wip/center-throttle.md;
// the owner's words of 2026-11-12). Every frame:
//  - while the motors are off, where the throttle rests on this connection is watched (@gsfpv/input RestWatch: the first
//    still half second; a new controller starts the watch again);
//  - the style is resolved (profileStyle: the pilot's choice for this controller, else the rest seen now, else the
//    wizard's rest, else the known table: the DJI FPV Remote Controller's throttle springs to the centre, else from zero)
//    and handed to the input host, which flies it on the ground at once and after the motors stop otherwise;
//  - prefs input.throttleStyle shows the pilot's choice for the controller in use ('auto' when none); a change of it (the
//    settings screen, J) is saved into that controller's profile, so the choice is per controller.
// J (keymap throttle.style) flips centred <-> from zero for the controller in use. Touch and keyboard: J says it is for a
// radio or a gamepad (they already fly without arming).
import { RestWatch, profileStyle, readThrottleStyle } from '@gsfpv/input';
import type { Profile, ResolvedStyle, ThrottleRest, ThrottleStyle } from '@gsfpv/input';
import { saveProfile } from '../../controls';
import { t } from '../../i18n';
import type { Feature, FlightContext } from '../context';

// window.__gsfpv.throttle: the style in use, for the tests and the page probe
declare module '../test-hook' {
    interface TestHook {
        throttle?: () => {
            /** the style flying now and the one waiting for the motors to stop */
            now: ThrottleStyle; pending: ThrottleStyle | null;
            /** the resolved style and why (choice, seen, wizard, table, default); null: no radio or gamepad in use */
            resolved: ResolvedStyle | null;
            /** where the throttle was seen resting on this connection */
            seen: ThrottleRest | null;
            /** the setting's value: the pilot's choice for this controller, or 'auto' */
            setting: string;
            /** the centred pilot's state while it flies */
            centre: { arm: string; control: string; landed: boolean; heightM: number | null } | null;
        };
    }
}

/** The style name as the pilot reads it, in the setting's words. */
export function styleName(s: ThrottleStyle): string {
    return t(`set.input.throttleStyle.opt.${s}`);
}

/** The radio or gamepad profile flying now, or null (touch, keyboard, none). */
function radioProfile(ctx: FlightContext): Profile | null {
    const c = ctx.controls;
    return (c.source === 'hid' || c.source === 'gamepad') ? c.profile : null;
}

export const throttleStyle: Feature = {
    id: 'throttleStyle',
    install(ctx) {
        const prefs = ctx.prefs;
        const watch = new RestWatch();
        let shown: Profile | null = null;
        let syncing = false;
        let resolved: ResolvedStyle | null = null;

        /** The setting shows this controller's choice (no write back: it is the controller's own value). */
        const showChoice = (p: Profile | null): void => {
            syncing = true;
            try { prefs.set('input.throttleStyle', p?.throttleStyle ?? 'auto'); } finally { syncing = false; }
        };

        const resolve = (): void => {
            const p = radioProfile(ctx);
            if (p !== shown) {
                // another controller (or setup): its own choice, a new watch of where its throttle rests
                shown = p;
                watch.reset();
                showChoice(p);
            }
            if (!p) { resolved = null; return; }
            const c = ctx.controls;
            // only a reporting controller with the motors off says where its throttle rests
            if (!c.gate.armed && c.lastSampleAt > 0) watch.update(c.mapped[2], performance.now());
            resolved = profileStyle(p, watch.rest);
            ctx.input.setThrottleStyle(resolved.style);
        };

        const offPrefs = prefs.onChange((ch) => {
            if (ch.id !== 'input.throttleStyle' || syncing) return;
            const p = radioProfile(ctx);
            if (!p) return;
            const choice = readThrottleStyle(prefs.get('input.throttleStyle'));
            if (choice === p.throttleStyle) return;
            // the choice belongs to the controller: saved in its profile (the same object the input flies with)
            if (choice) p.throttleStyle = choice;
            else delete p.throttleStyle;
            saveProfile(p);
            resolve();
        });

        const offKey = ctx.keys.on('throttle.style', (e) => {
            if (e.repeat || document.querySelector('#ui .screen, #ui .panel')) return;
            if (!radioProfile(ctx)) { ctx.hud.flash(t('throttle.radioOnly'), 4000); return; }
            resolve();
            const next: ThrottleStyle = resolved?.style === 'centred' ? 'zero' : 'centred';
            prefs.set('input.throttleStyle', next);
            const pending = ctx.input.throttleStyle.pending;
            ctx.hud.flash(t(pending ? 'throttle.afterLanding' : 'throttle.now', { style: styleName(next) }), 3000);
        });

        const offFrame = ctx.events.on('frame', () => {
            resolve();
            ctx.input.settleStyle();
        });
        // a new life or scene: the centred pilot's loops start from the craft's new state
        const offLife = ctx.events.on('life', () => ctx.input.centrePilot?.resetFlight());
        const offSession = ctx.events.on('session', () => ctx.input.centrePilot?.resetFlight());

        ctx.hook.throttle = () => {
            const s = ctx.input.throttleStyle;
            const v = prefs.get('input.throttleStyle');
            return { now: s.now, pending: s.pending, resolved, seen: watch.rest, setting: typeof v === 'string' ? v : 'auto', centre: ctx.input.centrePilot?.state() ?? null };
        };

        return () => {
            offPrefs();
            offKey();
            offFrame();
            offLife();
            offSession();
            delete ctx.hook.throttle;
        };
    }
};
