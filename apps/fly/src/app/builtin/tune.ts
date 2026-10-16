// "Help us tune this drone" (v0.8, the owner's item 9; docs/wip/v08-d.md): the presets are built from
// published numbers and estimates, so a pilot who flies one of them for real is asked for what fits it
// to the real quad (Betaflight `diff all`, a blackbox log, a few words) or for a drone that is missing.
// This file is the settings screen's row under Drone (app/builtin/settings.ts extra); the drone
// picker's buttons are wired in app/builtin/drone.ts, the form itself is the feedback dialog's Drone
// physics kind (app/builtin/feedback.ts).
import { h } from '../../ui/dom';
import { t } from '../../i18n';
import { openFeedback } from './feedback';
import type { FlightContext } from '../context';
import '../../ui/drone-tune.css';

/** The row under the Drone setting: one line and a button that opens the form for the drone flown. */
export function tuneRow(ctx: FlightContext, closeSettings: () => void): { el: HTMLElement; refresh(): void } {
    const btn = h('button', { type: 'button', class: 'btn', 'data-action': 'settings-drone-tune', 'data-testid': 'settings-drone-tune' }, t('set.drone.tuneButton'));
    btn.addEventListener('click', () => {
        // one screen at a time: Settings closes (its changes are in the store), then the form opens on the drone flown
        closeSettings();
        openFeedback(ctx, 'drone', { drone: ctx.session.presetId });
    });
    const el = h('div', { class: 'tune-row', 'data-testid': 'settings-tune-row' }, h('p', {}, t('set.drone.tune')), btn);
    return { el, refresh: () => undefined };
}
