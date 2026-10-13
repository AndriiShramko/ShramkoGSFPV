// Radio switches run app actions (v0.7 lane D2; Profile.switches, @gsfpv/input switches.ts): a range of
// an action (rewind, restart, record, pause, next or random scene, HUD) that the radio's switch enters
// runs the action as its key would, through the key router, so the same handler, the same screens
// that hold keys back and the same crash-state rules apply. Arm and flight mode never come here:
// controls.ts maps them onto the channels the flight reads. Settings' Input group links here too
// (switchesRow): the place the pilot looked for it.
import { h } from '../../ui/dom';
import { t } from '../../i18n';
import type { Feature, FlightContext } from '../context';

/**
 * The line under Settings' stick-mode row: the radio in use and a button to its Switches view, or,
 * with no radio, the way to connect one. Settings closes first (its changes are in the store).
 */
export function switchesRow(ctx: FlightContext, closeSettings: () => void): { el: HTMLElement; refresh(): void } {
    const line = h('p', { class: 'small sr-extra-line', 'data-testid': 'switches-settings-line' });
    const open = h('button', { type: 'button', class: 'btn sr-extra-btn', 'data-action': 'settings-open-switches' });
    const radio = (): boolean => !!ctx.controls.profile && (ctx.controls.source === 'hid' || ctx.controls.source === 'gamepad');
    open.addEventListener('click', () => {
        closeSettings();
        ctx.input.openRadio(false, radio() ? 'switches' : undefined);
    });
    const refresh = (): void => {
        const on = radio();
        line.textContent = on ? t('switches.settingsLine', { name: ctx.controls.profile?.deviceName ?? '' }) : t('switches.settingsNoRadio');
        open.textContent = on ? t('switches.settingsBtn') : t('top.controls');
    };
    refresh();
    return { el: h('div', { class: 'sr-extra' }, line, open), refresh };
}

export const switches: Feature = {
    id: 'switches',
    install(ctx) {
        ctx.controls.onSwitchAction = (a) => { ctx.keys.trigger(a); };
        return () => { ctx.controls.onSwitchAction = null; };
    }
};
