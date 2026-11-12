// The Controls screen's "My controller is not in the list" (lane center-throttle, stage 2): Chrome's USB chooser for
// DJI's vendor id, then what the device offers in plain words and one action to send that list with the report form.
// Nothing is opened or read beyond the descriptors (devices/usb-look.ts).
import { h, clear } from './dom';
import { t } from '../i18n';
import { chooseDji, reportText, usbApi } from '../devices/usb-look';
import type { UsbLook } from '../devices/usb-look';

export interface UsbLookBlock {
    el: HTMLElement;
    /** the last device looked at (tests, the report) */
    readonly seen: UsbLook | null;
}

/** `send`: open the report form with this text; left out, there is no send action (the check screen of a test mode). */
export function usbLookBlock(send?: (text: string) => void): UsbLookBlock {
    let seen: UsbLook | null = null;
    const out = h('div', { class: 'usb-look-out', role: 'status', 'aria-live': 'polite', 'data-testid': 'usb-look-out' });
    const show = (l: UsbLook): void => {
        clear(out);
        out.append(h('p', {}, t('usb.found', { name: l.name || l.id })));
        const list = h('ul', { class: 'usb-look-parts', 'data-testid': 'usb-look-parts' });
        for (const p of l.parts) list.append(h('li', { 'data-part': p }, t(`usb.part.${p}`)));
        if (!l.parts.length) list.append(h('li', { 'data-part': 'none' }, t('usb.part.none')));
        out.append(list, h('p', { 'data-testid': 'usb-look-verdict', 'data-verdict': l.verdict }, t(`usb.verdict.${l.verdict}`)));
        if (send) {
            out.append(h('button', { type: 'button', class: 'btn', 'data-action': 'usb-look-send',
                onclick: () => send(reportText(l, (k, p) => t(k, p))) }, t('usb.send')));
        }
    };
    const look = async (): Promise<void> => {
        const api = usbApi();
        clear(out);
        if (!api) { out.append(h('p', {}, t('usb.noApi'))); return; }
        try {
            const l = await chooseDji(api);
            if (!l) { out.append(h('p', {}, t('usb.nothingChosen'))); return; }
            seen = l;
            show(l);
        } catch {
            out.append(h('p', {}, t('usb.failed')));
        }
    };
    const el = h('details', { class: 'usb-look', 'data-testid': 'usb-look' },
        h('summary', {}, t('usb.title')),
        h('p', { class: 'muted small' }, t('usb.why')),
        h('button', { type: 'button', class: 'btn', 'data-action': 'usb-look', onclick: () => void look() }, t('usb.look')),
        out);
    return { el, get seen() { return seen; } };
}
