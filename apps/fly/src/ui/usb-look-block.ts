// The Controls screen's "My controller is not in the list" (lane center-throttle, stage 2): Chrome's USB chooser for
// DJI's vendor id, then what the device offers in plain words and one action to send that list with the report form.
// Nothing is opened or read beyond the descriptors (devices/usb-look.ts), except (lane rc2) when the device has the
// DJI RC 2's stick channel and the pilot presses "Fly with this controller": then devices/dji-rc2-source.ts opens it,
// claims the channel and waits for the first stick answer before handing the device to `fly` (the Controls screen's
// HID path: wizard, check screen, profile). A claim the browser refuses (on Windows the channel belongs to another
// driver) is said in plain words, and "Send this list" stays.
import { h, clear } from './dom';
import { t } from '../i18n';
import { chooseDji, reportText, usbApi } from '../devices/usb-look';
import type { UsbLook } from '../devices/usb-look';
import { DjiRc2Device, Rc2Error, hasStickChannel } from '../devices/dji-rc2-source';
import type { UsbDeviceLike } from '../devices/dji-rc2-source';

export interface UsbLookBlock {
    el: HTMLElement;
    /** the last device looked at (tests, the report) */
    readonly seen: UsbLook | null;
}

/**
 * `send`: open the report form with this text; left out, there is no send action (the check screen of a test mode).
 * `fly`: fly with a DJI RC 2 whose stick channel answered (a WebHID-shaped device for HidSource); left out, no fly action.
 */
export function usbLookBlock(send?: (text: string) => void, fly?: (d: DjiRc2Device) => void): UsbLookBlock {
    let seen: UsbLook | null = null;
    let busy = false;
    const out = h('div', { class: 'usb-look-out', role: 'status', 'aria-live': 'polite', 'data-testid': 'usb-look-out' });
    const tryFly = async (dev: UsbDeviceLike, say: HTMLElement): Promise<void> => {
        if (busy || !fly) return;
        busy = true;
        say.setAttribute('data-state', 'opening');
        say.textContent = t('usb.rc2.opening');
        const d = new DjiRc2Device(dev);
        try {
            await d.open();
            say.setAttribute('data-state', 'flying');
            say.textContent = '';
            fly(d);
        } catch (e) {
            const why = e instanceof Rc2Error ? e.why : 'claim';
            say.setAttribute('data-state', why);
            say.textContent = t(why === 'silent' ? 'usb.rc2.silent' : 'usb.rc2.claimFailed');
        } finally {
            busy = false;
        }
    };
    const show = (l: UsbLook, dev: UsbDeviceLike | null): void => {
        clear(out);
        out.append(h('p', {}, t('usb.found', { name: l.name || l.id })));
        const list = h('ul', { class: 'usb-look-parts', 'data-testid': 'usb-look-parts' });
        for (const p of l.parts) list.append(h('li', { 'data-part': p }, t(`usb.part.${p}`)));
        if (!l.parts.length) list.append(h('li', { 'data-part': 'none' }, t('usb.part.none')));
        out.append(list, h('p', { 'data-testid': 'usb-look-verdict', 'data-verdict': l.verdict }, t(`usb.verdict.${l.verdict}`)));
        if (fly && l.verdict === 'rc2' && dev && hasStickChannel(dev)) {
            // the outcome is read out by the polite live region this block already is (role status)
            const say = h('p', { 'data-testid': 'usb-rc2-say' });
            out.append(h('button', { type: 'button', class: 'btn primary', 'data-action': 'usb-rc2-fly', onclick: () => void tryFly(dev, say) }, t('usb.rc2.fly')), say);
        }
        if (send) {
            out.append(h('button', { type: 'button', class: 'btn', 'data-action': 'usb-look-send',
                onclick: () => send(reportText(l, (k, p) => t(k, p))) }, t('usb.send')));
        }
    };
    const look = async (): Promise<void> => {
        const api = usbApi<UsbDeviceLike>();
        clear(out);
        if (!api) { out.append(h('p', {}, t('usb.noApi'))); return; }
        try {
            const r = await chooseDji(api);
            if (!r) { out.append(h('p', {}, t('usb.nothingChosen'))); return; }
            seen = r.look;
            show(r.look, r.device);
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
