// Lane center-throttle, stage 2 item 5 (docs/wip/center-throttle.md): "My controller is not in the list" on the Controls
// screen. Chrome's USB chooser for DJI's vendor id (2CA3), what the device offers in plain words, and one action that
// hands the list to the report form. No interface is opened or claimed.
//  - the classifier: the USB-IF class codes as parts; the DJI FPV Remote Controller 3 (HID) says "Connect"; the
//    Avata 360 drone (2CA3:0020, RNDIS + storage + bulk, as Windows listed it on 2026-11-09) says "the drone itself";
//    a screen controller as the research expects it (MTP + vendor bulk + ADB, no HID) says nothing readable yet; a
//    device whose descriptors the browser did not read says so;
//  - the block: no WebUSB (or a policy that blocks it) says so; a chosen device lists its parts and "Send this list"
//    sends the report text; the chooser closed without a choice is not an error;
//  - every string in en, es, pl and ru.
// The screen controller's interface list is the research's expectation (docs/research/radios/dji-rc3.md), not a
// measurement: no DJI controller with a screen ever enumerated on the owner's PC.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { FakeStorage } from '../../../packages/prefs/test/helpers';
import { fakeDocument } from './helpers/fake-dom';
import type { FakeElement } from './helpers/fake-dom';
import * as D from '../../../packages/input/src/dji-duml';

type LookMod = typeof import('../../../apps/fly/src/devices/usb-look');
type BlockMod = typeof import('../../../apps/fly/src/ui/usb-look-block');
let L: LookMod, B: BlockMod;
const nav: { languages: string[]; language: string; usb?: unknown } = { languages: ['en'], language: 'en' };

beforeAll(async () => {
    vi.stubGlobal('location', { search: '', pathname: '/en/fly/', href: 'http://127.0.0.1/en/fly/', origin: 'http://127.0.0.1' });
    vi.stubGlobal('document', fakeDocument());
    vi.stubGlobal('navigator', nav);
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    vi.stubGlobal('localStorage', new FakeStorage());
    L = await import('../../../apps/fly/src/devices/usb-look');
    B = await import('../../../apps/fly/src/ui/usb-look-block');
});

const iface = (c: number, s = 0, p = 0) => ({ alternates: [{ interfaceClass: c, interfaceSubclass: s, interfaceProtocol: p }] });
const dev = (pid: number, name: string, ifs: ReturnType<typeof iface>[]) => ({ vendorId: 0x2ca3, productId: pid, productName: name, configurations: ifs.length ? [{ interfaces: ifs }] : [] });
const RC3 = dev(0x1021, 'DJI Virtual Joystick', [iface(0x03)]);
const DRONE = dev(0x0020, 'Avata360-xyz', [iface(0xe0, 0x01, 0x03), iface(0x0a), iface(0x08, 0x06, 0x50), iface(0xff)]);
const SCREEN = dev(0x1021, 'DJI RC 2', [iface(0x06, 0x01, 0x01), iface(0xff, 0x42, 0x01), iface(0xff)]);
const BLANK = dev(0x1021, '', []);
// the owner's RC 2 as measured on 2026-11-13 (lane rc2 stage 1): interface 0 FF.43.01 (the sticks), interface 2 FF.42.01 (ADB)
const RC2 = { ...dev(0x1021, 'DJI RC 2', []), configurations: [{ configurationValue: 1, interfaces: [{ interfaceNumber: 0, ...iface(0xff, 0x43, 0x01) }, { interfaceNumber: 2, ...iface(0xff, 0x42, 0x01) }] }] };

describe('the classifier: what the device offers', () => {
    it('reads the class codes as parts', () => {
        expect(L.partOf(0x03, 0, 0)).toBe('joystick');
        expect(L.partOf(0x08, 0x06, 0x50)).toBe('storage');
        expect(L.partOf(0x02, 0x02, 0x01)).toBe('serial');
        expect(L.partOf(0x0a, 0, 0)).toBe('serial');
        expect(L.partOf(0x02, 0x02, 0xff)).toBe('network');
        expect(L.partOf(0xe0, 0x01, 0x03)).toBe('network');
        expect(L.partOf(0x06, 0x01, 0x01)).toBe('files');
        expect(L.partOf(0xff, 0x42, 0x01)).toBe('data');
        expect(L.partOf(0xff, 0x43, 0x01)).toBe('sticks');
        expect(L.partOf(0xdc, 0, 0)).toBe('other');
    });
    it('RC 3: connect; the drone: the drone; a screen controller: nothing readable; no descriptors: empty', () => {
        expect(L.lookAt(RC3)).toMatchObject({ id: '2CA3:1021', verdict: 'connect', parts: ['joystick'] });
        expect(L.lookAt(DRONE).verdict).toBe('drone');
        const s = L.lookAt(SCREEN);
        expect(s).toMatchObject({ verdict: 'none', parts: ['files', 'data'], raw: ['06.01.01', 'FF.42.01', 'FF.00.00'] });
        expect(L.lookAt(BLANK)).toMatchObject({ verdict: 'empty', parts: [], name: '' });
        expect(L.lookAt(RC2)).toMatchObject({ verdict: 'rc2', parts: ['sticks', 'data'], raw: ['FF.43.01', 'FF.42.01'] });
        expect(L.lookAt({ ...RC2, vendorId: 0x1234 }).verdict).toBe('none'); // the channel counts on DJI's vendor id only
    });
    it('the report text: the pilot\'s words, then the numbers', () => {
        const say = (k: string, p?: Record<string, string>): string => `${k}${p ? JSON.stringify(p) : ''}`;
        const text = L.reportText(L.lookAt(SCREEN), say);
        expect(text.split('\n')).toEqual(['usb.report.head{"name":"DJI RC 2"}', '- usb.part.files', '- usb.part.data', 'USB 2CA3:1021 "DJI RC 2" if: 06.01.01 FF.42.01 FF.00.00']);
        expect(L.reportText(L.lookAt(BLANK), say).split('\n')).toEqual(['usb.report.head{"name":"2CA3:1021"}', '- usb.part.none', 'USB 2CA3:1021 if: -']);
    });
});

const flush = async (): Promise<void> => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
const btn = (el: FakeElement, action: string): FakeElement => el.querySelector(`[data-action="${action}"]`) as FakeElement;

describe('the block on the Controls screen', () => {
    it('no WebUSB: says so in plain words, no chooser', async () => {
        delete nav.usb;
        const b = B.usbLookBlock(() => undefined);
        const el = b.el as unknown as FakeElement;
        btn(el, 'usb-look').click();
        await flush();
        expect(el.querySelector('[data-testid="usb-look-out"]')!.textContent).toContain('cannot look at USB devices');
        expect(b.seen).toBeNull();
    });
    it('a policy that blocks usb: the same line (control: the API present but not allowed)', async () => {
        const asked: unknown[] = [];
        nav.usb = { requestDevice: (o: unknown) => { asked.push(o); return Promise.resolve(SCREEN); } };
        (document as unknown as { featurePolicy?: unknown }).featurePolicy = { allowsFeature: (f: string) => f !== 'usb' };
        try {
            const el = B.usbLookBlock(() => undefined).el as unknown as FakeElement;
            btn(el, 'usb-look').click();
            await flush();
            expect(asked).toEqual([]);
            expect(el.textContent).toContain('cannot look at USB devices');
        } finally { delete (document as unknown as { featurePolicy?: unknown }).featurePolicy; }
    });
    it('a screen controller: asks Chrome for vendor 2CA3, lists the parts, sends the list', async () => {
        const asked: unknown[] = [];
        nav.usb = { requestDevice: (o: unknown) => { asked.push(o); return Promise.resolve(SCREEN); } };
        const sent: string[] = [];
        const b = B.usbLookBlock((text) => sent.push(text));
        const el = b.el as unknown as FakeElement;
        btn(el, 'usb-look').click();
        await flush();
        expect(asked).toEqual([{ filters: [{ vendorId: 0x2ca3 }] }]);
        const parts = el.querySelectorAll('[data-part]').map((li) => li.getAttribute('data-part'));
        expect(parts).toEqual(['files', 'data']);
        expect(el.querySelector('[data-testid="usb-look-verdict"]')!.getAttribute('data-verdict')).toBe('none');
        expect(el.textContent).toContain("DJI's own data channel");
        expect(el.textContent).not.toContain('cannot read it yet'); // the old line is gone (lane rc2)
        expect(btn(el, 'usb-rc2-fly')).toBeNull(); // no stick channel: no fly action
        btn(el, 'usb-look-send').click();
        expect(sent).toHaveLength(1);
        expect(sent[0]).toContain('My controller is not in the list: DJI RC 2');
        expect(sent[0]).toContain('if: 06.01.01 FF.42.01 FF.00.00');
    });
    it('the RC 3: points to the Connect button; the chooser closed: not an error; no send action without a report form', async () => {
        nav.usb = { requestDevice: () => Promise.resolve(RC3) };
        let el = B.usbLookBlock().el as unknown as FakeElement;
        btn(el, 'usb-look').click();
        await flush();
        expect(el.querySelector('[data-testid="usb-look-verdict"]')!.getAttribute('data-verdict')).toBe('connect');
        expect(btn(el, 'usb-look-send')).toBeNull();
        nav.usb = { requestDevice: () => Promise.reject(Object.assign(new Error('none'), { name: 'NotFoundError' })) };
        el = B.usbLookBlock(() => undefined).el as unknown as FakeElement;
        btn(el, 'usb-look').click();
        await flush();
        expect(el.textContent).toContain('No device was chosen');
        nav.usb = { requestDevice: () => Promise.reject(Object.assign(new Error('busy'), { name: 'SecurityError' })) };
        el = B.usbLookBlock(() => undefined).el as unknown as FakeElement;
        btn(el, 'usb-look').click();
        await flush();
        expect(el.textContent).toContain('could not read this device');
    });
});

describe('the DJI RC 2 in the block (lane rc2)', () => {
    /** a WebUSB device for the source: the RC 2's descriptors, a claim that works or not, one stick answer per request */
    function usbRc2(claim: 'ok' | 'refused') {
        const calls: string[] = [];
        let wake: (() => void) | null = null;
        const queue: Uint8Array[] = [];
        const answer = (seq: number): Uint8Array => {
            const p = new Uint8Array(19);
            for (let i = 0; i < 6; i++) { p[1 + i * 3] = 0x00; p[2 + i * 3] = 0x04; p[3 + i * 3] = i + 1; }
            return D.buildFrame({ sender: 0x06, receiver: 0x0a, seq, type: 0x80, set: 6, id: 1, payload: p });
        };
        return {
            ...RC2, opened: false, configuration: null, calls,
            open: async function (this: { opened: boolean }) { calls.push('open'); this.opened = true; },
            close: async function (this: { opened: boolean }) { calls.push('close'); this.opened = false; },
            selectConfiguration: async () => { calls.push('config'); },
            claimInterface: async (n: number) => { calls.push(`claim ${n}`); if (claim === 'refused') throw Object.assign(new Error('Unable to claim interface.'), { name: 'NetworkError' }); },
            releaseInterface: async () => { calls.push('release'); },
            transferOut: async (_ep: number, d: Uint8Array) => { queue.push(answer(d[6] | (d[7] << 8))); wake?.(); return {}; },
            transferIn: async () => { while (!queue.length) await new Promise<void>((r) => { wake = r; }); return { status: 'ok', data: new DataView(queue.shift()!.buffer) }; }
        };
    }
    it('the RC 2 offers "Fly with this controller"; a refused claim says what is wrong, that nothing is broken, what works; the list can still be sent', async () => {
        const d = usbRc2('refused');
        nav.usb = { requestDevice: () => Promise.resolve(d) };
        const flown: unknown[] = [];
        const sent: string[] = [];
        const el = B.usbLookBlock((x) => sent.push(x), (x) => flown.push(x)).el as unknown as FakeElement;
        btn(el, 'usb-look').click();
        await flush();
        expect(el.querySelector('[data-testid="usb-look-verdict"]')!.getAttribute('data-verdict')).toBe('rc2');
        btn(el, 'usb-rc2-fly').click();
        for (let i = 0; i < 5; i++) await flush();
        const say = el.querySelector('[data-testid="usb-rc2-say"]')!;
        expect(say.getAttribute('data-state')).toBe('claim');
        expect(say.textContent).toContain('could not open the controller');
        expect(say.textContent).toContain('Nothing is broken');
        expect(say.textContent).toContain('fly with the keyboard, a gamepad or a radio');
        expect(flown).toEqual([]);
        expect(d.calls).toEqual(['open', 'config', 'claim 0', 'close']);
        btn(el, 'usb-look-send').click();
        expect(sent[0]).toContain('if: FF.43.01 FF.42.01');
    });
    it('a claim that works: the device answers and goes to the Controls screen; control: no fly callback, no fly action', async () => {
        const d = usbRc2('ok');
        nav.usb = { requestDevice: () => Promise.resolve(d) };
        const flown: { productName: string; collections: unknown[]; close(): Promise<void> }[] = [];
        let el = B.usbLookBlock(() => undefined, (x) => flown.push(x as never)).el as unknown as FakeElement;
        btn(el, 'usb-look').click();
        await flush();
        btn(el, 'usb-rc2-fly').click();
        const t0 = Date.now();
        while (!flown.length && Date.now() - t0 < 2000) await new Promise((r) => setTimeout(r, 5));
        expect(flown).toHaveLength(1);
        expect(flown[0].productName).toBe('DJI RC 2');
        expect(flown[0].collections).toHaveLength(1);
        expect(el.querySelector('[data-testid="usb-rc2-say"]')!.getAttribute('data-state')).toBe('flying');
        await flown[0].close();
        el = B.usbLookBlock(() => undefined).el as unknown as FakeElement;
        btn(el, 'usb-look').click();
        await flush();
        expect(el.querySelector('[data-testid="usb-look-verdict"]')!.getAttribute('data-verdict')).toBe('rc2');
        expect(btn(el, 'usb-rc2-fly')).toBeNull();
    });
});

describe('strings', () => {
    it('every key of locales/fly/usb in en, es, pl and ru, with the same placeholders', () => {
        const dir = resolve(__dirname, '../../../packages/i18n/locales/fly/usb');
        const read = (l: string): Record<string, string> => JSON.parse(readFileSync(resolve(dir, `${l}.json`), 'utf8'));
        const en = read('en');
        const used = ['usb.rc2.fly', 'usb.rc2.opening', 'usb.rc2.claimFailed', 'usb.rc2.silent',
            'usb.rc2.bridgeWhy', 'usb.rc2.bridge', 'usb.rc2.bridgeOpening', 'usb.rc2.noBridge', 'usb.rc2.bridgeNoController', 'usb.title', 'usb.why', 'usb.look', 'usb.found', 'usb.send', 'usb.noApi', 'usb.nothingChosen', 'usb.failed', 'usb.report.head', 'usb.part.none',
            ...(['joystick', 'sticks', 'storage', 'serial', 'files', 'network', 'data', 'audio', 'video', 'other'] as const).map((p) => `usb.part.${p}`),
            ...['connect', 'rc2', 'drone', 'none', 'empty'].map((v) => `usb.verdict.${v}`)];
        expect(Object.keys(en).sort()).toEqual([...used].sort());
        const ph = (s: string): string[] => (s.match(/\{\w+\}/g) ?? []).sort();
        for (const l of ['es', 'pl', 'ru']) {
            const d = read(l);
            expect(Object.keys(d).sort()).toEqual(Object.keys(en).sort());
            for (const k of Object.keys(en)) {
                expect(d[k].length).toBeGreaterThan(0);
                expect(ph(d[k])).toEqual(ph(en[k]));
            }
        }
    });
});
