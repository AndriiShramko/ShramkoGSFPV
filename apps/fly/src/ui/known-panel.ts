// The controller check of a recognised controller (v0.8 lane B; the owner's item 4): on the wizard's
// check screen, under the stick rows, every control of the controller with what it is, a live reading
// (a bar for an axis, a lamp for a button, the position of a 3-position switch) and where the layout
// comes from (measured / from DJI and pilots / not confirmed yet). Half a minute of moving each stick
// and flipping each switch confirms the layout on the real controller, or shows which control lit
// up where another was expected (the pilot reports it with B). Every fact is in @gsfpv/input
// known-devices.ts; this file only draws it.
import './known-panel.css';
import { channelUs } from '@gsfpv/input';
import type { KnownDevice, KnownInput, RawFrame, SwitchInput } from '@gsfpv/input';
import { h } from './dom';
import { t } from '../i18n';

/**
 * The panel and its per-frame update. `resolve`: the controller's inputs on the path it came by (an
 * axis usage -> its channel), from the recognition (known-devices.ts recognise / resolveInput).
 */
export function knownPanel(device: KnownDevice, resolve: (k: KnownInput) => SwitchInput | null): { el: HTMLElement; live: (f: RawFrame | null) => void } {
    const rows: { input: SwitchInput | null; set: (f: RawFrame) => void }[] = [];
    const list = h('ul', { class: 'kp-list' });
    for (const c of device.controls) {
        const input = resolve(c.input);
        // the badge only: the evidence behind it (files, links, reasons) is in the repository, not translated
        const badge = h('span', { class: `kp-fact ${c.fact.kind}` }, t(`controllers.fact.${c.fact.kind}`));
        const name = h('span', { class: 'kp-name' }, t(`controllers.control.${c.label}`));
        let widget: HTMLElement;
        let set: (f: RawFrame) => void;
        if (!input) {
            widget = h('span', { class: 'kp-none muted' }, '-');
            set = () => undefined;
        } else if (input.kind === 'axis') {
            const fill = h('i');
            widget = h('span', { class: 'kp-bar', 'aria-hidden': 'true' }, fill);
            const i = input.index;
            set = (f) => {
                const v = i < f.axes.length && Number.isFinite(f.axes[i]) ? Math.max(-1, Math.min(1, f.axes[i])) : 0;
                fill.style.left = `${(50 + Math.min(0, v) * 50).toFixed(1)}%`;
                fill.style.width = `${(Math.abs(v) * 50).toFixed(1)}%`;
            };
        } else if (input.kind === 'button') {
            widget = h('span', { class: 'kp-lamp', 'data-on': 'false' }, h('span', { class: 'dot', 'aria-hidden': 'true' }), h('span', { class: 'kp-lamp-t' }, ''));
            const bit = input.bit;
            set = (f) => {
                const on = ((f.buttons >> bit) & 1) === 1;
                if (widget.dataset.on !== String(on)) {
                    widget.dataset.on = String(on);
                    (widget.lastElementChild as HTMLElement).textContent = on ? t('controllers.on') : '';
                }
            };
        } else {
            // a 3-position switch: low / middle / high, the one it is in lit
            const cells = (['low', 'mid', 'high'] as const).map((p) => h('span', { class: 'kp-pos', 'data-pos': p }, t(`controllers.pos.${p}`)));
            widget = h('span', { class: 'kp-sw' }, ...cells);
            const sw = input;
            set = (f) => {
                const us = channelUs(sw, f);
                const at = us === null ? -1 : us < 1325 ? 0 : us < 1675 ? 1 : 2;
                cells.forEach((cell, k) => { if (cell.classList.contains('now') !== (k === at)) cell.classList.toggle('now', k === at); });
            };
        }
        list.append(h('li', { class: 'kp-row', 'data-control': c.label }, name, widget, badge));
        rows.push({ input, set });
    }
    const el = h('section', { class: 'kp', 'data-testid': 'known-controls', 'aria-label': t('controllers.controls', { name: device.name }) },
        h('h3', {}, t('controllers.controls', { name: device.name })),
        list,
        h('p', { class: 'kp-report muted small' }, t('controllers.report')));
    return {
        el,
        live: (f) => {
            if (!f) return;
            for (const r of rows) r.set(f);
        }
    };
}

/** The recognised controller's note at the top of its check screen: what was recognised, how to check it, and its own notes. */
export function knownNote(device: KnownDevice): HTMLElement {
    return h('div', { class: 'wz-note kp-note', 'data-testid': 'known-note' },
        h('p', { class: 'kp-recognised' }, t('controllers.recognised', { name: device.name })),
        h('p', {}, t('controllers.checkIt')),
        device.notes.length ? h('ul', { class: 'kp-notes small' }, ...device.notes.map((n) => h('li', {}, t(n)))) : null);
}

/**
 * The offer for a recognised controller whose saved setup is older than its recognition (@gsfpv/input
 * knownOffer): what its known setup is, and the two answers. `use`: the known setup on its check
 * screen; `keep`: the pilot's setup kept for good (keepOwnSetup). Shown on the Controls screen's radio
 * in use and on the saved setup's check screen (ui/radio.ts).
 */
export function knownOfferBlock(device: KnownDevice, on: { use: () => void; keep: () => void }): HTMLElement {
    return h('div', { class: 'kp-offer', 'data-testid': 'known-offer' },
        h('p', { class: 'kp-recognised' }, t('controllers.useKnown', { name: device.name })),
        h('p', { class: 'muted small' }, t('controllers.offerHint')),
        h('div', { class: 'actions' },
            h('button', { type: 'button', class: 'btn primary', 'data-action': 'use-known', onclick: on.use }, t('controllers.useKnownBtn')),
            h('button', { type: 'button', class: 'btn', 'data-action': 'keep-own', onclick: on.keep }, t('controllers.keepOwnBtn'))));
}

/** A controller recognised by name only (EdgeTX): why the wizard runs. */
export function knownNameNote(device: KnownDevice): HTMLElement | null {
    return device.whyNoMapping ? h('div', { class: 'wz-note kp-note', 'data-testid': 'known-note' }, h('p', {}, t(device.whyNoMapping))) : null;
}
