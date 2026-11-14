// "My controller is not in the list" (lane center-throttle, stage 2, docs/wip/center-throttle.md section 5): a DJI
// controller with a screen (RC 2 and its kin) shows up with no HID interface, so WebHID and the Gamepad API never see
// it. WebUSB can at least list what the device offers without opening it: the interface classes in its configuration
// descriptors. This module turns that list into plain parts (a joystick, storage, a serial port, ...) and the text the
// pilot can send with the report form. Nothing here reads sticks or claims an interface; the DJI RC 2's stick channel
// (FF.43.01) is read by devices/dji-rc2-source.ts when the pilot asks for it (lane rc2).
//
// The class codes are the USB-IF's defined class codes (usb.org "Defined Class Codes"); 2CA3 is DJI's vendor id and the
// two product ids are the ones Windows listed on the owner's PC on 2026-11-09 (docs/research/radios/dji-rc3.md).

/** The parts of a WebUSB device this module reads (USBDevice, without the methods). */
export interface UsbLike {
    vendorId: number;
    productId: number;
    productName?: string | null;
    manufacturerName?: string | null;
    configurations?: ReadonlyArray<{ interfaces: ReadonlyArray<{ alternates: ReadonlyArray<{ interfaceClass: number; interfaceSubclass: number; interfaceProtocol: number }> }> }>;
}

/** What one interface is, in the pilot's words (locale keys usb.part.<id>). */
export type UsbPart = 'joystick' | 'sticks' | 'storage' | 'serial' | 'files' | 'network' | 'data' | 'audio' | 'video' | 'other';

export const DJI_VENDOR = 0x2ca3;
/** 2CA3:1021 "DJI Virtual Joystick": the DJI FPV Remote Controller 3 (HID game controller interface). */
export const DJI_JOYSTICK = 0x1021;
/** 2CA3:0020 "Avata360-...": the drone itself (RNDIS, mass storage, bulk; no HID). */
export const DJI_AVATA360_DRONE = 0x0020;
/** 2CA3:1021 is also the DJI RC 2 (its stick channel FF.43.01, no HID; measured in lane rc2 stage 1). */
export const DJI_RC2 = 0x1021;

/** One interface's class, subclass and protocol as a part. */
export function partOf(cls: number, sub: number, proto: number): UsbPart {
    if (cls === 0x03) return 'joystick';
    if (cls === 0x08) return 'storage';
    if (cls === 0x06) return 'files'; // still image: MTP/PTP, how phones and screen controllers share files
    if (cls === 0xe0 || (cls === 0x02 && sub === 0x02 && proto === 0xff)) return 'network'; // RNDIS
    if (cls === 0x02 || cls === 0x0a) return 'serial'; // CDC: a serial (COM) port
    if (cls === 0x01) return 'audio';
    if (cls === 0x0e) return 'video';
    if (cls === 0xff && sub === 0x43 && proto === 0x01) return 'sticks'; // the DJI RC 2's stick channel (lane rc2, devices/dji-rc2-source.ts)
    if (cls === 0xff) return 'data'; // vendor specific: DJI's own data channel (and ADB)
    return 'other';
}

export interface UsbLook {
    /** "2CA3:1021" */
    id: string;
    name: string;
    /** the parts, each once, in the order the device lists them */
    parts: UsbPart[];
    /** every interface as class.subclass.protocol in hex, for the report */
    raw: string[];
    /** what to do: 'connect' (a joystick part: Connect controller can read it), 'rc2' (DJI's stick channel: the helper can try to fly with it), 'drone' (the drone, not its controller), 'none' (nothing readable as sticks), 'empty' (the browser saw no interfaces) */
    verdict: 'connect' | 'rc2' | 'drone' | 'none' | 'empty';
    /** verdict 'rc2' under a product id other than the DJI RC 2's (2CA3:1021): tried the same way, named as untested */
    untested: boolean;
}

const hex = (n: number, w: number): string => n.toString(16).toUpperCase().padStart(w, '0');

/** What the device offers, read from its descriptors (no open, no claim). */
export function lookAt(d: UsbLike): UsbLook {
    const parts: UsbPart[] = [];
    const raw: string[] = [];
    for (const c of d.configurations ?? []) {
        for (const i of c.interfaces) {
            const a = i.alternates[0];
            if (!a) continue;
            raw.push(`${hex(a.interfaceClass, 2)}.${hex(a.interfaceSubclass, 2)}.${hex(a.interfaceProtocol, 2)}`);
            const p = partOf(a.interfaceClass, a.interfaceSubclass, a.interfaceProtocol);
            if (!parts.includes(p)) parts.push(p);
        }
    }
    const verdict = d.vendorId === DJI_VENDOR && d.productId === DJI_AVATA360_DRONE ? 'drone'
        : parts.includes('joystick') ? 'connect' : d.vendorId === DJI_VENDOR && parts.includes('sticks') ? 'rc2' : parts.length === 0 ? 'empty' : 'none';
    // a DJI controller with the stick channel under another product id is tried as the RC 2 and named as untested
    const untested = verdict === 'rc2' && d.productId !== DJI_RC2;
    return { id: `${hex(d.vendorId, 4)}:${hex(d.productId, 4)}`, name: (d.productName ?? '').trim(), parts, raw, verdict, untested };
}

/** The lines for the report form: the pilot's words first (`say` is the locale's t), then the numbers the owner needs. */
export function reportText(l: UsbLook, say: (key: string, p?: Record<string, string>) => string): string {
    const lines = [say('usb.report.head', { name: l.name || l.id })];
    for (const p of l.parts) lines.push(`- ${say(`usb.part.${p}`)}`);
    if (!l.parts.length) lines.push(`- ${say('usb.part.none')}`);
    lines.push(`USB ${l.id}${l.name ? ` "${l.name}"` : ''} if: ${l.raw.join(' ') || '-'}`);
    return lines.join('\n');
}

interface UsbApi<D extends UsbLike = UsbLike> { requestDevice(o: { filters: { vendorId: number }[] }): Promise<D> }

/** WebUSB here: absent in Firefox and Safari, and blocked where the page's Permissions-Policy says usb=(). */
export function usbApi<D extends UsbLike = UsbLike>(): UsbApi<D> | null {
    const usb = (globalThis.navigator as unknown as { usb?: UsbApi<D> } | undefined)?.usb;
    if (!usb) return null;
    const fp = (globalThis.document as unknown as { featurePolicy?: { allowsFeature(f: string): boolean } } | undefined)?.featurePolicy;
    if (fp && !fp.allowsFeature('usb')) return null;
    return usb;
}

/** Chrome's device chooser for DJI's vendor id: what the chosen device offers, and the device; null when the pilot closed it without a choice. */
export async function chooseDji<D extends UsbLike>(api: UsbApi<D>): Promise<{ look: UsbLook; device: D } | null> {
    try {
        const device = await api.requestDevice({ filters: [{ vendorId: DJI_VENDOR }] });
        return { look: lookAt(device), device };
    } catch (e) {
        if ((e as { name?: string })?.name === 'NotFoundError') return null;
        throw e;
    }
}

/**
 * The old RC bridge switch (?rcbridge=1, lane rc2) was retired in lane connect stage C2: the helper program is offered
 * by routeOf / helperOffered below. The key stays named so packages/prefs/src/migrate.ts can still list it; nothing reads it.
 */
export const RC_BRIDGE_KEY = 'gsfpv.rcBridge';

/** Where "Connect my controller" goes with what the USB chooser returned (lane connect C2, docs/wip/connect.md "The flow"). */
export type UsbRoute = 'hid' | 'rc2usb' | 'report';

/**
 * The routing rule of a DJI device picked in Chrome's USB chooser: a joystick part is read as a HID controller (it
 * is in the first chooser), DJI's stick channel is opened over WebUSB, anything else is shown for the report.
 */
export function routeOf(l: UsbLook): UsbRoute {
    return l.verdict === 'connect' ? 'hid' : l.verdict === 'rc2' ? 'rc2usb' : 'report';
}

/**
 * The helper program for DJI controllers on Windows (tools/rc-bridge) is offered exactly when the look says a DJI
 * controller with the stick channel and Chrome could not claim it, or when this browser has a saved DJI RC 2 setup.
 */
export function helperOffered(l: UsbLook | null, claimFailed: boolean, savedRc2: boolean): boolean {
    return savedRc2 || (!!l && l.verdict === 'rc2' && claimFailed);
}
