// The Controls screen's DJI part (lane center-throttle stage 2, lane rc2, lane connect C2, docs/wip/connect.md "The
// flow"). Chrome's USB chooser for DJI's vendor id, then what the device offers in plain words. "Connect my
// controller" (ui/radio.ts) calls pickDji(): a picked controller with DJI's stick channel is opened at once
// (devices/dji-rc2-source.ts); when Chrome cannot claim the channel (on Windows it belongs to DJI's driver) the helper
// program route follows by itself (devices/dji-rc2-bridge.ts, tools/rc-bridge). The helper is offered exactly then, or
// when this browser has a saved DJI RC 2 setup (usb-look.ts helperOffered); the page never asks 127.0.0.1 on load
// unless Chrome's permission for it is already granted. A helper that is not running gives one line with the two
// steps, a retry, and a quiet watch that connects as soon as it starts. The details block ("My controller is not in
// the list") keeps the look and "Send this list" for support. Pilots never read the word "bridge".
import { h, clear } from './dom';
import { t } from '../i18n';
import { chooseDji, helperOffered, reportText, routeOf, usbApi } from '../devices/usb-look';
import type { UsbLook } from '../devices/usb-look';
import { DjiRc2Device, Rc2Error, hasStickChannel } from '../devices/dji-rc2-source';
import type { Rc2Why, UsbDeviceLike } from '../devices/dji-rc2-source';
import { RC_BRIDGE_SOURCE, Rc2BridgeDevice, lnaStatus } from '../devices/dji-rc2-bridge';
import type { PermissionsLike } from '../devices/dji-rc2-bridge';

/** pickDji's outcome: 'none' nothing chosen, 'noapi' no WebUSB here, 'gesture' the browser wants a fresh press, 'shown' a look for the report, 'trying' a route to flying started */
export type PickResult = 'none' | 'noapi' | 'gesture' | 'shown' | 'trying' | 'failed';

export interface UsbLookBlock {
    el: HTMLElement;
    /** the last device looked at (tests, the report) */
    readonly seen: UsbLook | null;
    /** Connect my controller's DJI step (see the header) */
    pickDji(afterChooser?: boolean): Promise<PickResult>;
    /** The helper route with no press: only when Chrome's permission is already granted (or the browser has none); true when it flies */
    quietHelper(): Promise<boolean>;
    /** stop the quiet watch (the screen went away) */
    stop(): void;
}

export interface UsbBlockOptions {
    /** this browser has a saved DJI RC 2 setup: the helper route is offered from the start */
    helper?: boolean;
    /** the quiet watch's pause between tries while the helper is not running (ms; chosen, not measured) */
    watchMs?: number;
    /** navigator.permissions for the quiet tries (default the page's) */
    permissions?: PermissionsLike | null;
    /** the helper device (tests) */
    helperDevice?: () => Rc2BridgeDevice;
}

/** a quiet try to the helper only when no question can come: granted, or a browser without the permission */
async function noQuestion(p: PermissionsLike | null): Promise<boolean> {
    const st = await lnaStatus(p).catch(() => null);
    return !st || st.state === 'granted';
}

/**
 * `send`: open the report form with this text; left out, there is no send action (the check screen of a test mode).
 * `fly`: fly with a DJI RC 2 whose stick channel answered, over WebUSB or through the helper (a WebHID-shaped device
 * for HidSource); left out, no fly actions.
 */
export function usbLookBlock(send?: (text: string) => void, fly?: (d: DjiRc2Device | Rc2BridgeDevice) => void, o: UsbBlockOptions = {}): UsbLookBlock {
    let seen: UsbLook | null = null;
    let busy = false;
    let stopped = false;
    let watch: ReturnType<typeof setTimeout> | undefined;
    const perms = o.permissions === undefined ? ((globalThis.navigator as unknown as { permissions?: PermissionsLike } | undefined)?.permissions ?? null) : o.permissions;
    const helperDev = o.helperDevice ?? ((): Rc2BridgeDevice => new Rc2BridgeDevice());
    const out = h('div', { class: 'usb-look-out', role: 'status', 'aria-live': 'polite', 'data-testid': 'usb-look-out' });
    // denied (Chrome's Local Network Access blocked for this site): the no-answer line, which says how to allow it
    const SAY: Record<Rc2Why, string> = { claim: 'usb.rc2.claimFailed', silent: 'usb.rc2.silent', nobridge: 'usb.rc2.noBridge', nocontroller: 'usb.rc2.bridgeNoController', denied: 'usb.rc2.noBridge' };
    // the attempt under way, and whether it waits for the pilot's answer to Chrome's question (lane rc2-lna)
    let current: DjiRc2Device | Rc2BridgeDevice | null = null;
    let asking = false;
    let run = 0;
    let helperSay: HTMLElement | null = null;
    const el = h('details', { class: 'usb-look', 'data-testid': 'usb-look' },
        h('summary', {}, t('usb.title')),
        h('p', { class: 'muted small' }, t('usb.why')),
        h('button', { type: 'button', class: 'btn', 'data-action': 'usb-look', onclick: () => void look() }, t('usb.look')),
        out);
    const stopWatch = (): void => { if (watch !== undefined) clearTimeout(watch); watch = undefined; };
    const startWatch = (): void => {
        stopWatch();
        if (stopped || !fly) return;
        watch = setTimeout(() => void quiet(true), o.watchMs ?? 2000);
    };
    const tryFly = async (d: DjiRc2Device | Rc2BridgeDevice, say: HTMLElement, opening: string, then?: () => void): Promise<void> => {
        if (!fly) return;
        if (busy) {
            // a press while Chrome's question is open (the pilot may have closed it unanswered): start over
            if (!asking || !(d instanceof Rc2BridgeDevice)) return;
            void current?.close();
        }
        stopWatch();
        busy = true;
        asking = false;
        current = d;
        const my = ++run;
        say.setAttribute('data-state', 'opening');
        say.textContent = t(opening);
        let failed: Rc2Why | null = null;
        try {
            if (d instanceof Rc2BridgeDevice) {
                await d.open(() => {
                    if (my !== run) return;
                    asking = true;
                    say.setAttribute('data-state', 'asking');
                    say.textContent = t('usb.rc2.bridgeAsk');
                });
            } else await d.open();
            if (my !== run) return;
            say.setAttribute('data-state', 'flying');
            say.textContent = '';
            fly(d);
        } catch (e) {
            if (my !== run) return;
            const why: Rc2Why = e instanceof Rc2Error ? e.why : 'claim';
            failed = why;
            say.setAttribute('data-state', why);
            if (why === 'claim') offerHelper();
            say.textContent = why === 'claim' ? `${t(SAY.claim)} ${t('usb.rc2.claimBridge')}` : t(SAY[why]);
            // the helper not running: the page tries again by itself while the screen is open (no question can come)
            if (d instanceof Rc2BridgeDevice && (why === 'nobridge' || why === 'nocontroller')) startWatch();
        } finally {
            if (my === run) {
                busy = false;
                asking = false;
                current = null;
            }
        }
        if (failed === 'claim' && then) then();
    };
    // the helper section: built once, when it is offered (helperOffered), never before
    const offerHelper = (): void => {
        if (helperSay || !fly) return;
        const say = h('p', { 'data-testid': 'usb-bridge-say', role: 'status', 'aria-live': 'polite' });
        helperSay = say;
        el.append(h('div', { class: 'usb-helper', 'data-testid': 'usb-helper' },
            h('p', { class: 'muted small' }, t('usb.rc2.bridgeWhy'), ' ',
                h('a', { href: RC_BRIDGE_SOURCE, target: '_blank', rel: 'noopener', 'data-testid': 'usb-bridge-get' }, t('usb.rc2.bridgeGet'))),
            h('button', { type: 'button', class: 'btn', 'data-action': 'usb-rc2-bridge', onclick: () => helperTry() }, t('usb.rc2.bridge')),
            say));
    };
    const helperTry = (): void => {
        offerHelper();
        if (helperSay) void tryFly(helperDev(), helperSay, 'usb.rc2.bridgeOpening');
    };
    // one quiet try: no question, no change of the line unless it connects
    const quiet = async (again: boolean): Promise<boolean> => {
        if (stopped || busy || !fly) return false;
        if (again && (el as unknown as { isConnected?: boolean }).isConnected === false) return false;
        if (!(await noQuestion(perms)) || stopped || busy) return false;
        const d = helperDev();
        busy = true;
        try {
            await d.open();
        } catch {
            busy = false;
            if (again) startWatch();
            return false;
        }
        busy = false;
        if (stopped) { void d.close(); return false; }
        offerHelper();
        helperSay?.setAttribute('data-state', 'flying');
        if (helperSay) helperSay.textContent = '';
        fly(d);
        return true;
    };
    const show = (l: UsbLook, dev: UsbDeviceLike | null): HTMLElement | null => {
        clear(out);
        out.append(h('p', {}, t('usb.found', { name: l.name || l.id })));
        if (l.untested) out.append(h('p', { 'data-testid': 'usb-untested' }, t('usb.untested', { name: l.name || l.id })));
        const list = h('ul', { class: 'usb-look-parts', 'data-testid': 'usb-look-parts' });
        for (const p of l.parts) list.append(h('li', { 'data-part': p }, t(`usb.part.${p}`)));
        if (!l.parts.length) list.append(h('li', { 'data-part': 'none' }, t('usb.part.none')));
        out.append(list, h('p', { 'data-testid': 'usb-look-verdict', 'data-verdict': l.verdict }, t(`usb.verdict.${l.verdict}`)));
        let say: HTMLElement | null = null;
        if (fly && l.verdict === 'rc2' && dev && hasStickChannel(dev)) {
            // the outcome is read out by the polite live region this block already is (role status)
            const s = h('p', { 'data-testid': 'usb-rc2-say' });
            say = s;
            out.append(h('button', { type: 'button', class: 'btn primary', 'data-action': 'usb-rc2-fly', onclick: () => void tryFly(new DjiRc2Device(dev), s, 'usb.rc2.opening') }, t('usb.rc2.fly')), s);
        }
        if (send) {
            out.append(h('button', { type: 'button', class: 'btn', 'data-action': 'usb-look-send',
                onclick: () => send(reportText(l, (k, p) => t(k, p))) }, t('usb.send')));
        }
        return say;
    };
    const choose = async (afterChooser: boolean): Promise<{ look: UsbLook; device: UsbDeviceLike } | PickResult> => {
        const api = usbApi<UsbDeviceLike>();
        clear(out);
        if (!api) { out.append(h('p', {}, t('usb.noApi'))); return 'noapi'; }
        try {
            const r = await chooseDji(api);
            if (!r) { out.append(h('p', {}, t('usb.nothingChosen'))); return 'none'; }
            seen = r.look;
            return r;
        } catch (e) {
            // after the HID chooser, Chrome may want a fresh press before its USB chooser: the caller asks for one more
            if (afterChooser && (e as { name?: string })?.name === 'SecurityError') return 'gesture';
            out.append(h('p', {}, t('usb.failed')));
            return 'failed';
        }
    };
    const look = async (): Promise<void> => {
        const r = await choose(false);
        if (typeof r !== 'string') show(r.look, r.device);
    };
    const pickDji = async (afterChooser = false): Promise<PickResult> => {
        const r = await choose(afterChooser);
        if (typeof r === 'string') {
            if (r !== 'gesture') el.setAttribute('open', '');
            return r;
        }
        const say = show(r.look, r.device);
        el.setAttribute('open', '');
        if (routeOf(r.look) !== 'rc2usb' || !say) return 'shown';
        // the stick channel at once; a refused claim goes on to the helper program by itself (helperOffered)
        void tryFly(new DjiRc2Device(r.device), say, 'usb.rc2.opening', () => { if (helperOffered(r.look, true, false)) helperTry(); });
        return 'trying';
    };
    if (fly && helperOffered(null, false, !!o.helper)) offerHelper();
    return {
        el,
        get seen() { return seen; },
        pickDji,
        quietHelper: async () => {
            const ok = await quiet(false);
            if (!ok && helperSay && !stopped) startWatch();
            return ok;
        },
        stop: () => { stopped = true; stopWatch(); }
    };
}
