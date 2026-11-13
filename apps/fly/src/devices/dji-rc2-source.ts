// The DJI RC 2 (the controller with a screen that ships with the Avata 360) as an input source over WebUSB (lane rc2,
// stage 2, docs/wip/rc2.md). The controller has no HID interface; its sticks answer a DUML request on the vendor bulk
// interface FF.43.01 (packages/input/src/dji-duml.ts). DjiRc2Device opens the device, selects the configuration,
// claims that interface, asks for the sticks about 100 times a second and hands each answer over as a HID input report
// of the shape RC2_HID_COLLECTIONS describes. So HidSource reads it as it reads any HID joystick: the same frames into
// Controls (code map: "Where a frame goes"), the same wizard and check screen, the same profiles
// ("hid:2ca3:1021:DJI RC 2:12:d"). Its left stick springs to the centre (1024 measured at rest), so throttleStyle auto
// resolves to 'centred' from the rest the wizard and the rest watch see, as for the DJI FPV Remote Controller 3.
//
// On Windows the claim fails unless the interface uses Windows' generic USB driver (WinUSB); with DJI Assistant 2
// installed it uses DJI's libusb0 driver (measured in stage 1). The helper says so (ui/usb-look-block.ts).
// Unplugged, or a transfer that fails: the source stops and sends nothing more; Controls disarms a radio that went
// silent (the stale rule of ArmGate, 100 ms), and onEnd tells the owner.

import { DumlReader, RC2, RC2_HID_COLLECTIONS, isStickReply, rc2Report, stickRequest, stickValues } from '../../../../packages/input/src/dji-duml';
import type { Profile } from '@gsfpv/input';
import { HidSource } from './hid';
import type { Reconnected } from './reconnect';

export const RC2_VENDOR = 0x2ca3;
/** the stick channel: vendor class FF, subclass 43, protocol 01 (interface 0 on the owner's RC 2, measured) */
export const RC2_STICK_IFACE = { cls: 0xff, sub: 0x43, proto: 0x01 } as const;
/** HIDDevice.productName of the source (part of the profile key; the USB product string is not used) */
export const RC2_NAME = 'DJI RC 2';
/** one stick request every 10 ms: the reference's default rate of 100 Hz (rc2_joystick.py --rate); not measured here */
export const RC2_POLL_MS = 10;
/** a request with no answer after this is given up (its slot freed): estimate (stage 1 saw every answer within 100 ms) */
export const RC2_REPLY_MS = 100;
/**
 * Requests out at once. The next request does not wait for the answer of the last one: on a busy page (measured with
 * tools/bench/scripts/rc2-probe.mjs on 2026-11-13: about 20 frames a second, frames up to 180 ms) a request-answer
 * chain that waits for each answer delivered one frame every 100-210 ms, the arm gate's stale rule (100 ms) cut the
 * motors and the drone fell. With requests already out, each answer is one task of its own. 4 is an estimate: the
 * reference sends one at a time and the controller's queue depth was not measured.
 */
export const RC2_INFLIGHT = 4;
/** no stick answer this long after the claim: the controller is silent (estimate) */
export const RC2_FIRST_MS = 1500;
/** bytes asked for per bulk read: the endpoint's max packet size, 512 (measured) */
const READ_BYTES = 512;

// The WebUSB parts this module uses (USBDevice and friends), so tests can hand over a fake.
export interface UsbEndpointLike { endpointNumber: number; direction: 'in' | 'out'; type: string }
export interface UsbAlternateLike { interfaceClass: number; interfaceSubclass: number; interfaceProtocol: number; endpoints?: readonly UsbEndpointLike[] }
export interface UsbInterfaceLike { interfaceNumber: number; alternates: readonly UsbAlternateLike[] }
export interface UsbConfigurationLike { configurationValue: number; interfaces: readonly UsbInterfaceLike[] }
export interface UsbDeviceLike {
    vendorId: number;
    productId: number;
    productName?: string | null;
    opened: boolean;
    configuration?: { configurationValue: number } | null;
    configurations: readonly UsbConfigurationLike[];
    open(): Promise<void>;
    close(): Promise<void>;
    selectConfiguration(value: number): Promise<void>;
    claimInterface(n: number): Promise<void>;
    releaseInterface(n: number): Promise<void>;
    transferOut(ep: number, data: Uint8Array): Promise<unknown>;
    transferIn(ep: number, length: number): Promise<{ status?: string; data?: DataView | null }>;
}
/** navigator.usb as far as this module needs it */
export interface UsbHub {
    getDevices?(): Promise<UsbDeviceLike[]>;
    addEventListener?(type: 'disconnect', fn: (e: { device: unknown }) => void): void;
    removeEventListener?(type: 'disconnect', fn: (e: { device: unknown }) => void): void;
}

export interface StickChannel { config: number; iface: number; epIn: number; epOut: number }

/** Where the sticks are: the configuration and interface FF.43.01 and its bulk endpoints (1 in and out when not listed). */
export function stickChannel(d: Pick<UsbDeviceLike, 'configurations'>): StickChannel | null {
    for (const c of d.configurations ?? []) {
        for (const i of c.interfaces) {
            const a = i.alternates[0];
            if (!a || a.interfaceClass !== RC2_STICK_IFACE.cls || a.interfaceSubclass !== RC2_STICK_IFACE.sub || a.interfaceProtocol !== RC2_STICK_IFACE.proto) continue;
            const bulk = (dir: 'in' | 'out'): number => a.endpoints?.find((e) => e.direction === dir && e.type === 'bulk')?.endpointNumber ?? 1;
            return { config: c.configurationValue, iface: i.interfaceNumber, epIn: bulk('in'), epOut: bulk('out') };
        }
    }
    return null;
}

/** A DJI device with the stick channel (the RC 2; other DJI controllers with a screen if they have it too). */
export function hasStickChannel(d: Pick<UsbDeviceLike, 'vendorId' | 'configurations'>): boolean {
    return d.vendorId === RC2_VENDOR && stickChannel(d) !== null;
}

/**
 * Why the source could not start: the browser could not take the interface, or the controller did not answer; over
 * the RC bridge (dji-rc2-bridge.ts): nothing answers on its port, or the bridge runs but has no controller.
 */
export type Rc2Why = 'claim' | 'silent' | 'nobridge' | 'nocontroller';
export class Rc2Error extends Error {
    constructor(readonly why: Rc2Why, readonly cause?: unknown) {
        super(`DJI RC 2: ${why}`);
        this.name = 'Rc2Error';
    }
}

type ReportListener = (e: { reportId: number; data: DataView; timeStamp: number }) => void;

export interface Rc2Options {
    /** navigator.usb (its disconnect event), default the page's */
    hub?: UsbHub | null;
    clock?: () => number;
    wait?: (ms: number) => Promise<void>;
    /** the ask loop's pause between requests (default: a plain timer) */
    pace?: (ms: number) => Promise<void>;
}

const defaultHub = (): UsbHub | null => (globalThis.navigator as unknown as { usb?: UsbHub } | undefined)?.usb ?? null;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** The RC 2 shaped as a WebHID device for HidSource (see the header). */
export class DjiRc2Device {
    readonly vendorId: number;
    readonly productId: number;
    readonly productName = RC2_NAME;
    readonly collections = RC2_HID_COLLECTIONS;
    opened = false;
    /** stick answers and requests that went unanswered (tests, the report) */
    replies = 0;
    unanswered = 0;
    /** answers dropped because their request was given up or is older than RC2_REPLY_MS (old stick data never flies) */
    late = 0;
    /** stick answers dropped because their payload is not in the recorded layout (stickValues) */
    bad = 0;
    /** the source stopped: 'unplug' (the device left), 'error' (a transfer failed), 'closed' (let go) */
    onEnd: ((why: 'unplug' | 'error' | 'closed') => void) | null = null;
    private readonly listeners = new Set<ReportListener>();
    private readonly hub: UsbHub | null;
    private readonly clock: () => number;
    private readonly wait: (ms: number) => Promise<void>;
    private readonly pace: (ms: number) => Promise<void>;
    private ch: StickChannel | null = null;
    private gen = 0;
    /** open()'s wait for the first stick answer */
    private answered: (() => void) | null = null;
    /** the sequence number of each request that is out and when it was sent, oldest first */
    private inflight: { seq: number; at: number }[] = [];

    constructor(readonly usb: UsbDeviceLike, o: Rc2Options = {}) {
        this.vendorId = usb.vendorId;
        this.productId = usb.productId;
        this.hub = o.hub === undefined ? defaultHub() : o.hub;
        this.clock = o.clock ?? (() => performance.now());
        this.wait = o.wait ?? sleep;
        // a plain timer: an animation-frame wake (a1b43eb1) only added requests, frames and work on a busy page
        // (rc2-probe.mjs pass 3, docs/wip/rc2.md), so it was taken out
        this.pace = o.pace ?? this.wait;
    }

    /** Open, select the configuration, claim the stick channel, start asking; resolves at the first stick answer. */
    async open(): Promise<void> {
        if (this.opened) return;
        const ch = stickChannel(this.usb);
        if (!ch) throw new Rc2Error('claim');
        const wasOpen = this.usb.opened;
        try {
            if (!this.usb.opened) await this.usb.open();
            if (this.usb.configuration?.configurationValue !== ch.config) await this.usb.selectConfiguration(ch.config);
            await this.usb.claimInterface(ch.iface);
        } catch (e) {
            if (!wasOpen && this.usb.opened) await this.usb.close().catch(() => undefined);
            throw new Rc2Error('claim', e);
        }
        this.ch = ch;
        this.opened = true;
        const gen = ++this.gen;
        this.hub?.addEventListener?.('disconnect', this.onDisconnect);
        const first = new Promise<boolean>((res) => { this.answered = () => res(true); void this.wait(RC2_FIRST_MS).then(() => res(false)); });
        void this.readLoop(gen);
        void this.askLoop(gen);
        if (!(await first)) {
            await this.stop('closed', false);
            throw new Rc2Error('silent');
        }
    }

    addEventListener(type: string, fn: ReportListener): void {
        if (type === 'inputreport') this.listeners.add(fn);
    }

    /** The last reader gone (HidSource.close): the channel is let go, so nothing polls in the background. */
    removeEventListener(type: string, fn: ReportListener): void {
        if (type !== 'inputreport' || !this.listeners.delete(fn)) return;
        if (this.listeners.size === 0 && this.opened) void this.close();
    }

    close(): Promise<void> {
        return this.stop('closed', true);
    }

    private onDisconnect = (e: { device: unknown }): void => {
        if (e.device === this.usb) void this.stop('unplug', true);
    };

    private async stop(why: 'unplug' | 'error' | 'closed', tell: boolean): Promise<void> {
        if (!this.opened) return;
        this.opened = false;
        this.gen++;
        this.answered = null;
        this.inflight = [];
        this.hub?.removeEventListener?.('disconnect', this.onDisconnect);
        const ch = this.ch;
        this.ch = null;
        if (why !== 'unplug' && ch) {
            await this.usb.releaseInterface(ch.iface).catch(() => undefined);
            await this.usb.close().catch(() => undefined);
        }
        if (tell) this.onEnd?.(why);
    }

    /** Bulk reads: every stick answer becomes one input report. */
    private async readLoop(gen: number): Promise<void> {
        const reader = new DumlReader();
        while (gen === this.gen && this.ch) {
            let r: { status?: string; data?: DataView | null };
            try {
                r = await this.usb.transferIn(this.ch.epIn, READ_BYTES);
            } catch {
                if (gen === this.gen) void this.stop('error', true);
                return;
            }
            if (gen !== this.gen) return;
            if (!r.data || r.status === 'stall') continue;
            for (const f of reader.feed(new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength))) {
                if (!isStickReply(f) || f.receiver !== RC2.PC) continue; // the controller's unasked frames
                // only the answer to a request still out and younger than RC2_REPLY_MS: the report is stamped on
                // arrival, so an older answer would pass the stale rule with old stick data
                const i = this.inflight.findIndex((q) => q.seq === f.seq);
                const q = i < 0 ? null : this.inflight.splice(i, 1)[0]!;
                if (!q || this.clock() - q.at >= RC2_REPLY_MS) {
                    this.late++;
                    continue;
                }
                const v = stickValues(f);
                if (!v) {
                    this.bad++;
                    continue;
                }
                this.replies++;
                const a = this.answered;
                this.answered = null;
                a?.();
                const ev = { reportId: 0, data: new DataView(rc2Report(v).buffer), timeStamp: this.clock() };
                for (const fn of this.listeners) fn(ev);
            }
        }
    }

    /**
     * A request every RC2_POLL_MS while fewer than RC2_INFLIGHT are out; a request with no answer after RC2_REPLY_MS
     * is given up (counted in unanswered) and frees its slot. Answers do not pace the requests (see RC2_INFLIGHT).
     */
    private async askLoop(gen: number): Promise<void> {
        let seq = 1;
        let last = this.clock();
        this.inflight = [];
        while (gen === this.gen && this.ch) {
            const t0 = this.clock();
            while (this.inflight.length && t0 - this.inflight[0]!.at >= RC2_REPLY_MS) {
                this.inflight.shift();
                this.unanswered++;
            }
            // one request a wake; a wake that came late (a busy page may wake this loop only once a frame) fills every
            // free slot at once, so the answers of one late wake keep coming during the next frame
            const late = t0 - last > 2 * RC2_POLL_MS;
            last = t0;
            const out: Promise<unknown>[] = [];
            while (this.inflight.length < RC2_INFLIGHT && (late || out.length === 0)) {
                this.inflight.push({ seq, at: t0 });
                out.push(this.usb.transferOut(this.ch.epOut, stickRequest(seq)));
                seq = (seq + 1) & 0xffff;
            }
            if (out.length) {
                try {
                    await Promise.all(out);
                } catch {
                    if (gen === this.gen) void this.stop('error', true);
                    return;
                }
                if (gen !== this.gen) return;
            }
            const left = RC2_POLL_MS - (this.clock() - t0);
            if (left > 0) await this.pace(left);
        }
    }
}

/**
 * Review R10: an RC 2 (WebUSB or the RC bridge) that stops on its own, unplugged, switched off or the bridge closed,
 * says so once on the flight view. The stale rule has already stopped the motors; this only names the cause.
 * The flight view listens (app/builtin/hud.ts: hud.flash with usb.rc2.lost); 'closed' (the page let go) says nothing.
 */
type LostListener = (why: 'unplug' | 'error') => void;
const lostListeners = new Set<LostListener>();

export function onRadioLost(fn: LostListener): () => void {
    lostListeners.add(fn);
    return () => { lostListeners.delete(fn); };
}

/** Sets the device's onEnd so that an end the pilot did not choose reaches onRadioLost's listeners. */
export function tellWhenLost(d: { onEnd: ((why: 'unplug' | 'error' | 'closed') => void) | null }): void {
    d.onEnd = (why) => {
        if (why === 'closed') return;
        for (const fn of [...lostListeners]) fn(why);
    };
}

/**
 * A later visit: an RC 2 the browser already may open (navigator.usb.getDevices(), no chooser, no user gesture) whose
 * profile key has a saved setup. Returns it as a HID choice (HidSource over DjiRc2Device), or null.
 */
export async function findSavedRc2(lookup: (key: string) => Profile | null, hub: UsbHub | null = defaultHub()): Promise<Reconnected | null> {
    if (!hub?.getDevices) return null;
    let list: UsbDeviceLike[];
    try {
        list = await hub.getDevices();
    } catch {
        return null;
    }
    for (const d of list.filter(hasStickChannel)) {
        const src = new HidSource();
        try {
            const rc = new DjiRc2Device(d, { hub });
            tellWhenLost(rc);
            await src.open(rc as unknown as HIDDevice);
            const profile = lookup(src.key);
            if (profile) return { kind: 'hid', profile, hid: src };
        } catch { /* claimed elsewhere or silent: the Controls screen handles it */ }
        src.close();
    }
    return null;
}
