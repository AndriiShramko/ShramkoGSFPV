// The DJI RC 2 through the Shramko RC bridge (lane rc2, stage 3, docs/wip/rc2.md, tools/rc-bridge/): on Windows with
// DJI Assistant 2 installed the stick channel belongs to DJI's libusb0 driver, so Chrome cannot claim it over WebUSB
// (dji-rc2-source.ts). The bridge, a small program on the pilot's computer, reads the sticks through DJI's own driver and
// serves the six raw values on ws://127.0.0.1:47310/. Rc2BridgeDevice is shaped as a WebHID device exactly like
// DjiRc2Device (same name, collections and 12-byte reports), so HidSource, the wizard, the check screen and the
// profile ("hid:2ca3:1021:DJI RC 2:12:d") are the same whichever way the sticks come.
//
// The page connects only when the pilot presses the helper's "Fly through the RC bridge" (ui/usb-look-block.ts):
// nothing probes 127.0.0.1 on load. The bridge closing (stopped, or the controller pulled out) stops the source; the
// stale rule of ArmGate disarms a radio that went silent, as for the WebUSB source.

import { RC2_HID_COLLECTIONS, rc2Report, stickRawOk } from '../../../../packages/input/src/dji-duml';
import { RC2_FIRST_MS, RC2_NAME, RC2_VENDOR, Rc2Error } from './dji-rc2-source';

/** the bridge's port (tools/rc-bridge/rc_bridge.py PORT): chosen, not measured */
export const RC_BRIDGE_PORT = 47310;
export const RC_BRIDGE_URL = `ws://127.0.0.1:${RC_BRIDGE_PORT}/`;
/** where a pilot gets the bridge: its folder's README in the public repository (main), which says how to start it */
export const RC_BRIDGE_README = 'tools/rc-bridge/README.md';
export const RC_BRIDGE_SOURCE = `https://github.com/AndriiShramko/ShramkoGSFPV/blob/main/${RC_BRIDGE_README}`;
/** the DJI RC 2's USB product id (2CA3:1021, measured in stage 1) */
const RC2_PRODUCT = 0x1021;

/** The parts of a WebSocket this module uses, so tests can hand over a fake. */
export interface SocketLike {
    onopen: ((e: unknown) => void) | null;
    onmessage: ((e: { data: unknown }) => void) | null;
    onerror: ((e: unknown) => void) | null;
    onclose: ((e: unknown) => void) | null;
    close(): void;
}

export interface BridgeOptions {
    url?: string;
    socket?: (url: string) => SocketLike;
    clock?: () => number;
    wait?: (ms: number) => Promise<void>;
    /** navigator.permissions (default the page's; null: none) */
    permissions?: PermissionsLike | null;
}

/** The parts of navigator.permissions and PermissionStatus this module uses, so tests can hand over a fake. */
export interface PermStatusLike {
    readonly state: string;
    addEventListener(type: 'change', fn: () => void): void;
    removeEventListener(type: 'change', fn: () => void): void;
}
export interface PermissionsLike { query(d: { name: string }): Promise<PermStatusLike> }

/**
 * Chrome's Local Network Access (lane rc2-lna, docs/wip/rc2-lna.md): a public https page may open ws://127.0.0.1 only
 * after the pilot allows it. Measured on Chrome 156: the permission that decides it is 'loopback-network'; older
 * builds named it 'local-network-access'. The first name the browser knows is used; none known: no question exists
 * (the browser behaves as before).
 */
export const LNA_NAMES = ['loopback-network', 'local-network-access'] as const;

/** The pilot's answer so far, or null when the browser knows none of LNA_NAMES. */
export async function lnaStatus(p: PermissionsLike | null | undefined): Promise<PermStatusLike | null> {
    if (!p?.query) return null;
    for (const name of LNA_NAMES) {
        try {
            return await p.query({ name });
        } catch { /* unknown name in this browser: try the next */ }
    }
    return null;
}

const defaultPermissions = (): PermissionsLike | null =>
    (globalThis.navigator as unknown as { permissions?: PermissionsLike } | undefined)?.permissions ?? null;

type ReportListener = (e: { reportId: number; data: DataView; timeStamp: number }) => void;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Six raw values 364..1684 (stickRawOk: with its margin), or null for anything else the bridge says. */
function valuesOf(m: unknown): number[] | null {
    const v = (m as { v?: unknown } | null)?.v;
    if (!Array.isArray(v) || v.length !== 6) return null;
    return v.every(stickRawOk) ? (v as number[]) : null;
}

/** The RC 2 over the local bridge, shaped as a WebHID device for HidSource (see the header). */
export class Rc2BridgeDevice {
    readonly vendorId = RC2_VENDOR;
    readonly productId = RC2_PRODUCT;
    readonly productName = RC2_NAME;
    readonly collections = RC2_HID_COLLECTIONS;
    opened = false;
    /** stick messages handed over (tests, the report) */
    replies = 0;
    /** the source stopped: 'unplug' (the bridge went away or lost the controller), 'closed' (let go) */
    onEnd: ((why: 'unplug' | 'error' | 'closed') => void) | null = null;
    private readonly listeners = new Set<ReportListener>();
    private readonly url: string;
    private readonly socket: (url: string) => SocketLike;
    private readonly clock: () => number;
    private readonly wait: (ms: number) => Promise<void>;
    private ws: SocketLike | null = null;
    private readonly permissions: PermissionsLike | null;
    /** open() waiting for the pilot's answer to Chrome's question: stops that wait (close) */
    private cancel: (() => void) | null = null;

    constructor(o: BridgeOptions = {}) {
        this.url = o.url ?? RC_BRIDGE_URL;
        this.socket = o.socket ?? ((u) => new WebSocket(u) as unknown as SocketLike);
        this.clock = o.clock ?? (() => performance.now());
        this.wait = o.wait ?? sleep;
        this.permissions = o.permissions === undefined ? defaultPermissions() : o.permissions;
    }

    /**
     * The one place of the Local Network Access rule (LNA_NAMES). 'denied': Rc2Error 'denied' with no connection.
     * 'prompt': `asking` is called, then it connects (the attempt is what makes Chrome show its question); an attempt
     * refused while the question is open waits for the answer: Allow connects again at once (no second press), Block
     * is 'denied'. 'granted' or no such permission: connects as before. Then as connect().
     */
    open(asking?: () => void): Promise<void> {
        if (this.opened) return Promise.resolve();
        // no permissions API: connect in this same task, as before
        return this.permissions?.query ? this.ask(asking) : this.connect();
    }

    private async ask(asking?: () => void): Promise<void> {
        const st = await lnaStatus(this.permissions);
        if (st?.state === 'denied') throw new Rc2Error('denied');
        if (st?.state !== 'prompt') return this.connect();
        asking?.();
        try {
            return await this.connect();
        } catch (e) {
            if (!(e instanceof Rc2Error) || e.why !== 'nobridge') throw e;
        }
        const answer = st.state !== 'prompt' ? st.state : await new Promise<string>((res, rej) => {
            const on = (): void => {
                if (st.state === 'prompt') return;
                done();
                res(st.state);
            };
            const done = (): void => { st.removeEventListener('change', on); this.cancel = null; };
            this.cancel = () => { done(); rej(new Rc2Error('nobridge')); };
            st.addEventListener('change', on);
        });
        if (answer === 'denied') throw new Rc2Error('denied');
        return this.connect();
    }

    /**
     * Connect and wait for the first stick values. Rc2Error 'nobridge': nothing answers on the port (the program is
     * not running, or the browser refused the connection); 'nocontroller': the bridge runs but has no controller;
     * 'silent': connected, but no values within RC2_FIRST_MS.
     */
    private connect(): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            let settled = false;
            let ws: SocketLike;
            const fail = (why: 'nobridge' | 'nocontroller' | 'silent'): void => {
                if (settled) return;
                settled = true;
                this.drop(ws);
                reject(new Rc2Error(why));
            };
            try {
                ws = this.socket(this.url);
            } catch (e) {
                settled = true;
                reject(new Rc2Error('nobridge', e));
                return;
            }
            this.ws = ws;
            ws.onerror = () => fail('nobridge');
            ws.onclose = () => {
                if (!settled) { fail('nobridge'); return; }
                if (this.ws === ws) this.stop('unplug');
            };
            ws.onopen = () => {
                void this.wait(RC2_FIRST_MS).then(() => fail('silent'));
            };
            ws.onmessage = (e) => {
                if (typeof e.data !== 'string') return;
                let m: unknown;
                try { m = JSON.parse(e.data); } catch { return; }
                if ((m as { state?: string }).state === 'no-controller') {
                    if (!settled) fail('nocontroller');
                    else if (this.ws === ws) this.stop('unplug');
                    return;
                }
                const v = valuesOf(m);
                if (!v) return;
                if (!settled) { settled = true; this.opened = true; resolve(); }
                if (this.ws !== ws) return;
                this.replies++;
                const ev = { reportId: 0, data: new DataView(rc2Report(v).buffer), timeStamp: this.clock() };
                for (const fn of this.listeners) fn(ev);
            };
        });
    }

    addEventListener(type: string, fn: ReportListener): void {
        if (type === 'inputreport') this.listeners.add(fn);
    }

    /** The last reader gone (HidSource.close): the connection is closed, so the bridge lets the controller go. */
    removeEventListener(type: string, fn: ReportListener): void {
        if (type !== 'inputreport' || !this.listeners.delete(fn)) return;
        if (this.listeners.size === 0 && this.opened) void this.close();
    }

    close(): Promise<void> {
        this.cancel?.();
        this.stop('closed');
        return Promise.resolve();
    }

    private drop(ws: SocketLike | undefined): void {
        if (!ws) return;
        ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
        try { ws.close(); } catch { /* already closed */ }
        if (this.ws === ws) this.ws = null;
    }

    private stop(why: 'unplug' | 'closed'): void {
        const ws = this.ws;
        if (!ws) return;
        const was = this.opened;
        this.opened = false;
        this.drop(ws);
        if (was) this.onEnd?.(why);
    }
}
