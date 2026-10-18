// HidSource (apps/fly/src/devices/hid.ts) with a fake WebHID device, in Node: open, the reader it
// makes from the device's descriptor (makeHidReader), e.reportId routing, refused reports, the
// profile key and the display name; and reconnect.ts finding a saved profile by that key at page
// load. The EdgeTX radio, now read by its descriptor, must keep the key of the profiles pilots saved
// before (hid:1209:4f54:<name>:19), so a calibrated radio flies again without the wizard. Negative
// controls: the DJI without a descriptor (every report refused, as before the fix), a report id the
// device does not have, a DJI profile under the old key without :d. The app modules read location,
// document and matchMedia when they load, so those are stubbed first (as app-modes.test.ts).
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { FakeStorage } from '../../../packages/prefs/test/helpers';
import type { HidCollectionInfo, Profile, RawFrame } from '../../../packages/input/src';
import { DJI_RC3, DJI_RC3_WINDOWS, EDGETX_CLASSIC, djiRc3Report, edgeTxClassicReport } from '../../../packages/input/src/sim/devices';
import { DJI_RC3_STIR } from '../../../packages/input/test/fixtures/dji-rc3-stir';

type AppHid = typeof import('../../../apps/fly/src/devices/hid');
type AppReconnect = typeof import('../../../apps/fly/src/devices/reconnect');
type AppPrefs = typeof import('../../../apps/fly/src/app/prefs');
type AppControls = typeof import('../../../apps/fly/src/controls');

let H: AppHid, R: AppReconnect, P: AppPrefs, C: AppControls;
let storage = new FakeStorage();
const doc = { cookie: '', documentElement: { lang: '' }, visibilityState: 'visible' };

beforeAll(async () => {
    vi.stubGlobal('location', { search: '', pathname: '/fly/', href: 'http://127.0.0.1/fly/', origin: 'http://127.0.0.1' });
    vi.stubGlobal('document', doc);
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    vi.stubGlobal('localStorage', storage);
    H = await import('../../../apps/fly/src/devices/hid');
    R = await import('../../../apps/fly/src/devices/reconnect');
    P = await import('../../../apps/fly/src/app/prefs');
    C = await import('../../../apps/fly/src/controls');
});

afterEach(() => { P.closePagePrefs(); vi.unstubAllGlobals(); vi.stubGlobal('location', { search: '', pathname: '/fly/', href: 'http://127.0.0.1/fly/', origin: 'http://127.0.0.1' }); vi.stubGlobal('document', doc); vi.stubGlobal('matchMedia', () => ({ matches: false })); });

interface FakeEvent { device: FakeHidDevice; reportId: number; data: DataView; timeStamp: number }

/** A WebHID device as HidSource sees it: open(), the inputreport listener, the descriptor, its names. */
class FakeHidDevice {
    opened = false;
    opens = 0;
    private listeners = new Set<(e: FakeEvent) => void>();
    /** on open: send this report once a listener is there (a radio reports all the time) */
    autoReport: { id: number; data: Uint8Array } | null = null;
    constructor(readonly vendorId: number, readonly productId: number, readonly productName: string, readonly collections?: readonly HidCollectionInfo[]) {}
    async open(): Promise<void> { this.opened = true; this.opens++; }
    async close(): Promise<void> { this.opened = false; }
    addEventListener(type: string, l: (e: FakeEvent) => void): void {
        if (type !== 'inputreport') return;
        this.listeners.add(l);
        const r = this.autoReport;
        if (r) setTimeout(() => this.send(r.id, r.data, 5), 5);
    }
    removeEventListener(type: string, l: (e: FakeEvent) => void): void { if (type === 'inputreport') this.listeners.delete(l); }
    get listening(): number { return this.listeners.size; }
    send(reportId: number, data: Uint8Array, timeStamp: number): void {
        const e: FakeEvent = { device: this, reportId, data: new DataView(data.buffer, data.byteOffset, data.byteLength), timeStamp };
        for (const l of [...this.listeners]) l(e);
    }
}

const dji = (cols: readonly HidCollectionInfo[] | undefined = DJI_RC3.collections) => new FakeHidDevice(DJI_RC3.vendorId, DJI_RC3.productId, DJI_RC3.productName, cols);
// the name as the v0.2 profile in app-modes.test.ts saved it
const edgetx = (cols: readonly HidCollectionInfo[] | undefined = EDGETX_CLASSIC.collections) => new FakeHidDevice(EDGETX_CLASSIC.vendorId, EDGETX_CLASSIC.productId, 'Radiomaster TX16S Joystick', cols);
const asDevice = (d: FakeHidDevice): HIDDevice => d as unknown as HIDDevice;

async function opened(d: FakeHidDevice): Promise<{ src: InstanceType<AppHid['HidSource']>; frames: RawFrame[] }> {
    const src = new H.HidSource();
    const frames: RawFrame[] = [];
    src.onFrame = (f) => frames.push({ t: f.t, axes: Float32Array.from(f.axes), buttons: f.buttons });
    await src.open(asDevice(d));
    return { src, frames };
}

describe('HidSource with the DJI RC 3 (descriptor read)', () => {
    for (const [shape, cols] of [['descriptor (macOS, Linux)', DJI_RC3.collections], ['Windows (preparsed data)', DJI_RC3_WINDOWS.collections]] as const) {
        it(`${shape}: opens the device, reads the real stir's 13-byte reports through e.reportId, keys and names it`, async () => {
            const d = dji(cols);
            const { src, frames } = await opened(d);
            expect(d.opens).toBe(1);
            expect(d.listening).toBe(1);
            // the key is the device's own before any report: its axis report length and :d
            expect(src.key).toBe('hid:2ca3:1021:HID Interface:13:d');
            let t = 0;
            for (const [, a0, a1, a2, a3, a4, b] of DJI_RC3_STIR) {
                t += 1000 / 160;
                d.send(0, djiRc3Report([a0, a1, a2, a3, a4], b), t);
            }
            expect(src.reports).toBe(DJI_RC3_STIR.length);
            expect(src.badReports).toBe(0);
            expect(frames).toHaveLength(DJI_RC3_STIR.length);
            DJI_RC3_STIR.forEach(([, a0, a1, a2, a3, a4, b], i) => {
                [a0, a1, a2, a3, a4].forEach((raw, k) => expect(frames[i].axes[k]).toBeCloseTo(raw / 660, 6));
                expect(frames[i].buttons).toBe(b);
            });
            expect(frames[frames.length - 1].t).toBeCloseTo(t, 6); // the event's timeStamp
            expect(src.rateHz).toBeGreaterThan(150);
            expect(src.rateHz).toBeLessThan(170);
            expect(src.key).toBe('hid:2ca3:1021:HID Interface:13:d');
            expect(H.hidDisplayName(asDevice(d))).toBe('USB 2ca3:1021');
            // a report id the device does not have: refused, the frame untouched, the radio screen counts it
            const before = Array.from(src.frame.axes);
            d.send(5, djiRc3Report([660, 660, 660, 660, 660], 0xffffff), t + 10);
            expect(src.badReports).toBe(1);
            expect(src.lastBadLen).toBe(13);
            expect(Array.from(src.frame.axes)).toEqual(before);
            expect(frames).toHaveLength(DJI_RC3_STIR.length);
            // closed: no more frames
            src.close();
            expect(d.listening).toBe(0);
            d.send(0, djiRc3Report([0, 0, 0, 0, 0], 0), t + 20);
            expect(src.reports).toBe(DJI_RC3_STIR.length);
        });
    }

    it('negative control: the same device and reports without a descriptor (the fixed EdgeTX layout, as before the fix) give no frame', async () => {
        const d = dji([]);
        const { src, frames } = await opened(d);
        for (let i = 0; i < 50; i++) d.send(0, djiRc3Report([-11, 0, 0, -8, 0], 0x50), i * 6);
        expect(src.reports).toBe(0);
        expect(frames).toHaveLength(0);
        expect(src.badReports).toBe(50);
        expect(src.lastBadLen).toBe(13);
        expect(src.key).toBe('hid:2ca3:1021:HID Interface:13'); // the fixed layout's key: the arriving length, no :d
    });
});

describe('HidSource with an EdgeTX radio: read by its descriptor, the key of its saved profiles kept', () => {
    // the key a radio got before this change: hid:<vid>:<pid>:<productName>:<arriving report length>
    const OLD_KEY = 'hid:1209:4f54:Radiomaster TX16S Joystick:19';

    for (const [what, cols] of [['its descriptor', EDGETX_CLASSIC.collections], ['no descriptor (fallback)', undefined]] as const) {
        it(`${what}: frames as the fixed layout, key ${OLD_KEY}, name as before`, async () => {
            const d = edgetx(cols);
            const { src, frames } = await opened(d);
            expect(src.key).toBe('hid:1209:4f54:Radiomaster TX16S Joystick:0'); // before a report, as before: the arriving length
            d.send(0, edgeTxClassicReport([2047, 0, 1024, 1536, 1024, 1024, 1024, 1024], 0x000005), 1);
            expect(frames).toHaveLength(1);
            expect(Array.from(frames[0].axes)).toEqual([1023 / 1024, -1, 0, 0.5, 0, 0, 0, 0]);
            expect(frames[0].buttons).toBe(5);
            expect(src.key).toBe(OLD_KEY);
            expect(H.hidDisplayName(asDevice(d))).toBe('Radiomaster TX16S Joystick');
        });
    }

    it('reconnect at page load finds the profile saved under the old key (and a DJI profile under the old key without :d is not taken)', async () => {
        storage = new FakeStorage();
        vi.stubGlobal('localStorage', storage);
        P.closePagePrefs();
        P.openPagePrefs([], '', { storage: storage as unknown as Storage, win: null, doc: null, cookieDoc: null, debounceMs: 0, openKv: async () => ({ get: async () => undefined, put: async () => undefined, close: () => undefined }) });
        const profile = (deviceKey: string, deviceName: string): Profile => ({
            version: 1, deviceKey, deviceName, deadband: 0, created: '2026-09-26T19:44:02.118Z', wizard: 2,
            axes: { roll: { index: 0, invert: false, center: 0, min: -1, max: 1 }, pitch: { index: 1, invert: false, center: 0, min: -1, max: 1 }, throttle: { index: 2, invert: false, center: -1, min: -1, max: 1 }, yaw: { index: 3, invert: false, center: 0, min: -1, max: 1 } },
            arm: { kind: 'axis', index: 4, threshold: 0.5, onAbove: true }, angleMode: null
        } as Profile);
        C.saveProfile(profile(OLD_KEY, 'Radiomaster TX16S Joystick'));
        C.saveProfile(profile('hid:2ca3:1021:HID Interface:13', 'USB 2ca3:1021')); // as the branch before this fix would have saved it
        const radio = edgetx();
        radio.autoReport = { id: 0, data: edgeTxClassicReport([1024, 1024, 0, 1024, 0, 1024, 1024, 1024], 0) };
        const pad = dji();
        pad.autoReport = { id: 0, data: djiRc3Report([-11, 0, 0, -8, 0], 0x50) };
        let devices: FakeHidDevice[] = [radio];
        vi.stubGlobal('navigator', { hid: { getDevices: async () => devices.map(asDevice), requestDevice: async () => [] } });
        const found = await R.findSavedHid(C.profileFor, null, 500);
        expect(found?.profile.deviceKey).toBe(OLD_KEY);
        expect(found?.hid?.key).toBe(OLD_KEY);
        found?.hid?.close();
        // the DJI alone: its old-format key is not its key any more
        devices = [pad];
        expect(await R.findSavedHid(C.profileFor, null, 500)).toBeNull();
        // saved under its own key it is found
        C.saveProfile(profile('hid:2ca3:1021:HID Interface:13:d', 'USB 2ca3:1021'));
        const again = await R.findSavedHid(C.profileFor, null, 500);
        expect(again?.profile.deviceKey).toBe('hid:2ca3:1021:HID Interface:13:d');
        again?.hid?.close();
    });
});

describe('the chooser', () => {
    it('asks for the EdgeTX USB ids and every game control the reader reads (usage page 1: joystick, gamepad, multi-axis)', async () => {
        let asked: unknown = null;
        const d = dji();
        vi.stubGlobal('navigator', { hid: { requestDevice: async (o: unknown) => { asked = o; return [asDevice(d)]; }, getDevices: async () => [] } });
        expect(H.HidSource.supported()).toBe(true);
        const got = await new H.HidSource().request();
        expect(got).toBe(asDevice(d));
        expect(asked).toEqual({ filters: [{ vendorId: 0x1209, productId: 0x4f54 }, { usagePage: 1, usage: 4 }, { usagePage: 1, usage: 5 }, { usagePage: 1, usage: 8 }] });
    });
});

describe('HidSource notes every report in its link meter (v0.9 lane E)', () => {
    const send = (d: FakeHidDevice, times: number[]) => times.forEach((t) => d.send(0, djiRc3Report([-11, 0, 0, -8, 0], 0x50), t));
    const steady = (n: number, gap: number): number[] => Array.from({ length: n }, (_, i) => 100 + i * gap);

    it('a cable at 160 Hz reads as a fast, steady link; the same device slowed to 33 ms reads as slow (the control)', async () => {
        const fast = await opened(dji());
        send(dji0(fast), steady(200, 6.25));
        const f = fast.src.link.stats(100 + 200 * 6.25);
        expect(f.verdict).toBe('ok');
        expect(f.hz).toBeGreaterThan(150);
        expect(f.hz).toBeLessThan(170);
        fast.src.close();

        const slow = await opened(dji());
        send(dji0(slow), steady(60, 33));
        const sl = slow.src.link.stats(100 + 60 * 33);
        expect(sl.verdict).toBe('slow');
        expect(sl.meanMs).toBeCloseTo(33, 3);
        slow.src.close();
    });

    it('bunches of reports with pauses between them read as bursty', async () => {
        const { src, ...rest } = await opened(dji());
        const times: number[] = [];
        for (let b = 0; b < 40; b++) for (let k = 0; k < 4; k++) times.push(100 + b * 70 + k * 0.4);
        send(dji0({ src, ...rest }), times);
        expect(src.link.stats(100 + 40 * 70).verdict).toBe('bursty');
        src.close();
    });

    it('a refused report is not a sample, and a closed source stops watching the page for stalls', async () => {
        const { src } = await opened(dji());
        const d = (src as unknown as { device: FakeHidDevice }).device;
        for (let i = 0; i < 30; i++) d.send(9, djiRc3Report([0, 0, 0, 0, 0], 0), 100 + i * 5); // a report id the device does not have
        expect(src.link.stats(300).n).toBe(0);
        src.close();
        expect((src as unknown as { stopBeat: unknown }).stopBeat).toBeNull();
    });
});

/** The fake device an opened source reads. */
function dji0(o: { src: InstanceType<AppHid['HidSource']> }): FakeHidDevice {
    return (o.src as unknown as { device: FakeHidDevice }).device;
}
