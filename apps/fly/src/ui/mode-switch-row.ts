// The radio's mode switch on the wizard's check screen (docs/architecture-v03.md B.2; the owner's
// items 15 and 30). Nothing to press: the pilot flips the switch they fly modes with and the
// wizard takes it (CalibrationWizard.modeWatch). The row shows what was found, where the switch is
// now and which mode each position gives; its buttons are only overrides (no switch, use a
// switch, another mode for a position). ui/radio.ts puts it under the arm row.
import { FLIGHT_MODES } from '@gsfpv/input';
import type { CalibrationWizard, SwitchInput, SwitchPos, WizardState } from '@gsfpv/input';
import { h } from './dom';
import { t } from '../i18n';
import './mode-switch-row.css';

/** "CH6" or "button 3", as the arm row names its source. */
export function switchText(i: SwitchInput): string {
    return i.kind === 'axis' ? t('wizard.armSource.ch', { n: i.index + 1 }) : t('wizard.armSource.button', { n: i.bit + 1 });
}

/** What the row was built for: a new switch, none, or watching rebuilds it (ui/radio.ts adds this to its rebuild key). */
export function modeRowKey(st: WizardState): string {
    const m = st.modeSwitch;
    if (!m) return '';
    if (!m.sw) return m.listening ? 'listen' : 'none';
    return m.sw.input.kind === 'axis' ? `ch${m.sw.input.index}` : `b${m.sw.input.bit}`;
}

/** Position names: the channel's value on an axis (EdgeTX -100 / 0 / +100), released / pressed on a button. */
function posText(i: SwitchInput, p: SwitchPos): string {
    if (i.kind === 'button') return t(p === 2 ? 'mode.switch.pressed' : 'mode.switch.released');
    return p === 0 ? '−100' : p === 1 ? '0' : '+100';
}

/**
 * The row and its per-frame update. `btn` makes a wizard button (radio.ts's own, so focus and
 * Enter behave as everywhere on the screen); `changed` redraws the screen after an override.
 */
export function modeSwitchRow(wz: CalibrationWizard, btn: (label: string, action: string, onclick: () => void) => HTMLButtonElement, changed: () => void): { el: HTMLElement; live: () => void } {
    const st = wz.state;
    const m = st.modeSwitch;
    const sw = m?.sw ?? null;
    const name = h('span', { class: 'nm' }, t('mode.switch.title'));
    const ch = h('span', { class: 'ch' }, sw ? switchText(sw.input) : '-');
    const body = h('div', { class: 'wz-modesw', role: 'status' });
    const acts = h('div', { class: 'acts' });
    const el = h('div', { class: 'wz-row mode', 'data-fn': 'mode', 'data-testid': 'mode-switch-row' }, name, ch, body, acts);
    const pos: { p: SwitchPos; b: HTMLButtonElement }[] = [];
    if (sw) {
        const positions: SwitchPos[] = sw.input.kind === 'button' ? [0, 2] : [0, 1, 2];
        for (const p of positions) {
            // a position's mode as a toggle through the three: an override, the defaults fly as they are
            const b = btn(`${posText(sw.input, p)}: ${t(`mode.${sw.modes[p]}`)}`, `mode-pos-${p}`, () => {
                const cur = wz.state.modeSwitch?.sw?.modes[p] ?? sw.modes[p];
                wz.modeSwitchSet(p, FLIGHT_MODES[(FLIGHT_MODES.indexOf(cur) + 1) % FLIGHT_MODES.length]);
                changed();
            });
            b.classList.add('pos');
            pos.push({ p, b });
            body.append(b);
        }
        body.append(h('span', { class: 'wz-modesw-say muted small' }, t('mode.switch.found', { src: switchText(sw.input) })));
        acts.append(btn(t('mode.switch.btnNone'), 'mode-switch-none', () => { wz.modeSwitchNone(); changed(); }));
    } else if (m?.listening) {
        body.append(h('span', { class: 'wz-modesw-say' }, t('mode.switch.listen')));
    } else {
        body.append(h('span', { class: 'wz-modesw-say muted' }, t('mode.switch.none')));
        acts.append(btn(t('mode.switch.btnFind'), 'mode-switch-find', () => { wz.modeSwitchFind(); changed(); }));
    }
    const live = (): void => {
        const s = wz.state.modeSwitch;
        if (!s?.sw) return;
        for (const { p, b } of pos) {
            const label = `${posText(s.sw.input, p)}: ${t(`mode.${s.sw.modes[p]}`)}`;
            if (b.textContent !== label) b.textContent = label;
            b.classList.toggle('now', s.pos === p);
            b.setAttribute('aria-current', String(s.pos === p));
            // a 3-position switch shows its middle once it was there: a 2-position one never has one
            b.hidden = !s.seen[p] && s.pos !== p;
        }
    };
    live();
    return { el, live };
}
