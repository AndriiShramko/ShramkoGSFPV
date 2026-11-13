// Lane connect, stage C2 (docs/wip/connect.md "The flow"): "Connect my controller" routes by itself.
//  - the routing rule (devices/usb-look.ts routeOf, helperOffered): a joystick part goes the HID way, DJI's stick
//    channel the WebUSB way, anything else to the report; the helper program for DJI controllers on Windows is
//    offered exactly when the look says a DJI controller and the claim failed, or a saved RC 2 setup exists;
//  - a DJI controller with the stick channel under another product id is tried the same way and named untested;
//  - the block (ui/usb-look-block.ts pickDji): a refused claim goes on to the helper by itself, with no ?rcbridge=1;
//  - the helper not running: one line with the two steps, and the page connects by itself once it starts;
//  - a quiet try never runs while Chrome's question about this device's apps would come ('prompt').
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { FakeStorage } from '../../../packages/prefs/test/helpers';
import { fakeDocument } from './helpers/fake-dom';
import type { FakeElement } from './helpers/fake-dom';

type LookMod = typeof import('../../../apps/fly/src/devices/usb-look');
type BlockMod = typeof import('../../../apps/fly/src/ui/usb-look-block');
type BridgeMod = typeof import('../../../apps/fly/src/devices/dji-rc2-bridge');
let L: LookMod, B: BlockMod, R: BridgeMod;
const nav: { languages: string[]; language: string; usb?: unknown } = { languages: ['en'], language: 'en' };

beforeAll(async () => {
    vi.stubGlobal('location', { search: '', pathname: '/en/fly/', href: 'http://127.0.0.1/en/fly/', origin: 'http://127.0.0.1' });
    vi.stubGlobal('document', fakeDocument());
    vi.stubGlobal('navigator', nav);
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    vi.stubGlobal('localStorage', new FakeStorage());
    L = await import('../../../apps/fly/src/devices/usb-look');
    B = await import('../../../apps/fly/src/ui/usb-look-block');
    R = await import('../../../apps/fly/src/devices/dji-rc2-bridge');
});

const iface = (n: number, c: number, s = 0, p = 0) => ({ interfaceNumber: n, alternates: [{ interfaceClass: c, interfaceSubclass: s, interfaceProtocol: p }] });
const dji = (pid: number, name: string, ifs: ReturnType<typeof iface>[]) => ({ vendorId: 0x2ca3, productId: pid, productName: name, configurations: [{ configurationValue: 1, interfaces: ifs }] });
const RC2 = dji(0x1021, 'DJI RC 2', [iface(0, 0xff, 0x43, 0x01), iface(2, 0xff, 0x42, 0x01)]);
const OTHER = dji(0x1030, 'DJI RC N3', [iface(0, 0xff, 0x43, 0x01)]);
const JOY = dji(0x1021, 'DJI Virtual Joystick', [iface(0, 0x03)]);
const DRONE = dji(0x0020, 'Avata360-xyz', [iface(0, 0xe0, 0x01, 0x03), iface(1, 0x08, 0x06, 0x50)]);

/** an RC 2 over WebUSB whose claim Chrome refuses (Windows: the channel belongs to DJI's driver) */
function refused(base: typeof RC2) {
    return {
        ...base, opened: false, configuration: null,
        open: async function (this: { opened: boolean }) { this.opened = true; },
        close: async function (this: { opened: boolean }) { this.opened = false; },
        selectConfiguration: async () => undefined,
        claimInterface: async () => { throw Object.assign(new Error('Unable to claim interface.'), { name: 'NetworkError' }); },
        releaseInterface: async () => undefined,
        transferOut: async () => ({}),
        transferIn: async () => new Promise(() => undefined)
    };
}

/** the helper's socket: `up()` says whether the program runs now; running, it sends the sticks at rest */
class FakeSocket {
    onopen: ((e: unknown) => void) | null = null;
    onmessage: ((e: { data: unknown }) => void) | null = null;
    onerror: ((e: unknown) => void) | null = null;
    onclose: ((e: unknown) => void) | null = null;
    constructor(up: boolean) {
        setTimeout(() => {
            if (!up) { this.onerror?.({}); return; }
            this.onopen?.({});
            this.onmessage?.({ data: JSON.stringify({ v: [1024, 1024, 1024, 1024, 1024, 1024] }) });
        }, 1);
    }
    close(): void { /* closed */ }
}

const btn = (el: FakeElement, action: string) => el.querySelector(`[data-action="${action}"]`) as unknown as { click(): void } | null;
const until = async (ok: () => boolean, ms = 2000): Promise<boolean> => {
    const t0 = Date.now();
    while (!ok() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 5));
    return ok();
};

describe('the routing rule', () => {
    it('a joystick part: the HID way; the stick channel: WebUSB; the drone and anything else: the report', () => {
        expect(L.routeOf(L.lookAt(JOY))).toBe('hid');
        expect(L.routeOf(L.lookAt(RC2))).toBe('rc2usb');
        expect(L.routeOf(L.lookAt(OTHER))).toBe('rc2usb');
        expect(L.routeOf(L.lookAt(DRONE))).toBe('report');
    });
    it('the helper: a DJI controller whose claim failed, or a saved RC 2 setup; never a joystick, the drone or a claim that worked', () => {
        expect(L.helperOffered(L.lookAt(RC2), true, false)).toBe(true);
        expect(L.helperOffered(L.lookAt(OTHER), true, false)).toBe(true);
        expect(L.helperOffered(L.lookAt(RC2), false, false)).toBe(false);
        expect(L.helperOffered(L.lookAt(JOY), true, false)).toBe(false);
        expect(L.helperOffered(L.lookAt(DRONE), true, false)).toBe(false);
        expect(L.helperOffered(null, false, false)).toBe(false);
        expect(L.helperOffered(null, false, true)).toBe(true);
    });
    it('another DJI product id with the stick channel is the same route, named as untested; the RC 2 is not', () => {
        expect(L.lookAt(OTHER)).toMatchObject({ verdict: 'rc2', untested: true });
        expect(L.lookAt(RC2)).toMatchObject({ verdict: 'rc2', untested: false });
        expect(L.lookAt(JOY).untested).toBe(false);
    });
});

describe('a controller found by itself opens the route of its saved setup (review CN-4)', () => {
    // a TX16S: on the Gamepad API by itself when plugged in, granted over WebHID earlier, its setup saved under hid:
    const TX = { vendorId: 0x1209, productId: 0x4f54, productName: 'Radiomaster TX16S Joystick' };
    const PAD = { key: 'gp:Radiomaster TX16S Joystick (Vendor: 1209 Product: 4f54):8:32:', known: false };
    const MOUSE = { vendorId: 0x046d, productId: 0xc077, productName: 'USB Mouse' };
    it('a saved HID setup beats a new gamepad wizard; a saved pad setup beats a granted HID device with none', async () => {
        const A = await import('../../../apps/fly/src/devices/auto-route');
        const hidKey = 'hid:1209:4f54:Radiomaster TX16S Joystick:19';
        expect(A.autoRoute({ pad: PAD, hid: [MOUSE, TX], saved: [hidKey] })).toEqual({ kind: 'hid', index: 1 });
        expect(A.autoRoute({ pad: PAD, hid: [TX], saved: [PAD.key] })).toEqual({ kind: 'pad' });
        expect(A.autoRoute({ pad: { ...PAD, known: true }, hid: [TX], saved: [] })).toEqual({ kind: 'pad' });
        // nothing saved: the granted HID device (its own reports) is the better way into the wizard
        expect(A.autoRoute({ pad: PAD, hid: [TX], saved: [] })).toEqual({ kind: 'hid', index: 0 });
        expect(A.autoRoute({ pad: PAD, hid: [], saved: [hidKey] })).toEqual({ kind: 'pad' });
        expect(A.autoRoute({ pad: null, hid: [], saved: [] })).toBeNull();
        // another device's saved setup with the same ids but another name is not this one's
        expect(A.autoRoute({ pad: PAD, hid: [TX], saved: ['hid:1209:4f54:Radiomaster Pocket Joystick:19', PAD.key] })).toEqual({ kind: 'pad' });
    });
});

describe('Connect my controller, the DJI step', () => {
    it('a refused claim goes on to the helper by itself (no ?rcbridge=1) and flies when it answers; the untested name is shown', async () => {
        nav.usb = { requestDevice: () => Promise.resolve(refused({ ...OTHER } as never)) };
        const flown: unknown[] = [];
        const blk = B.usbLookBlock(() => undefined, (d) => flown.push(d), { permissions: null, helperDevice: () => new R.Rc2BridgeDevice({ socket: () => new FakeSocket(true) as never, permissions: null }) });
        const el = blk.el as unknown as FakeElement;
        expect(btn(el, 'usb-rc2-bridge')).toBeNull();
        expect(await blk.pickDji()).toBe('trying');
        expect(el.querySelector('[data-testid="usb-untested"]')?.textContent).toContain('not been tested');
        expect(await until(() => flown.length === 1)).toBe(true);
        expect(btn(el, 'usb-rc2-bridge')).not.toBeNull();
        expect(el.querySelector('[data-testid="usb-bridge-say"]')!.getAttribute('data-state')).toBe('flying');
        expect(el.textContent).not.toMatch(/bridge/i);
        await (flown[0] as { close(): Promise<void> }).close();
    });
    it('the helper not running: the two steps in one line, then it connects by itself once the program starts', async () => {
        let up = false;
        let made = 0;
        const flown: unknown[] = [];
        const blk = B.usbLookBlock(() => undefined, (d) => flown.push(d), { helper: true, watchMs: 20, permissions: null,
            helperDevice: () => { made++; return new R.Rc2BridgeDevice({ socket: () => new FakeSocket(up) as never, permissions: null }); } });
        const el = blk.el as unknown as FakeElement;
        btn(el, 'usb-rc2-bridge')!.click();
        const say = el.querySelector('[data-testid="usb-bridge-say"]')!;
        expect(await until(() => say.getAttribute('data-state') === 'nobridge')).toBe(true);
        expect(say.textContent).toContain('1. Double-click start-dji-helper.cmd');
        expect(say.textContent).toContain('2. Leave its window open');
        expect(await until(() => made >= 3)).toBe(true);
        expect(flown).toHaveLength(0);
        up = true;
        expect(await until(() => flown.length === 1)).toBe(true);
        blk.stop();
        await (flown[0] as { close(): Promise<void> }).close();
    });
    it('quiet tries only when no question can come: permission prompt makes no socket, granted connects', async () => {
        const perm = (state: string) => ({ query: async () => ({ state, addEventListener: () => undefined, removeEventListener: () => undefined }) });
        let socks = 0;
        const dev = () => new R.Rc2BridgeDevice({ socket: () => { socks++; return new FakeSocket(true) as never; }, permissions: null });
        const flown: unknown[] = [];
        const asked = B.usbLookBlock(() => undefined, (d) => flown.push(d), { helper: true, permissions: perm('prompt'), helperDevice: dev });
        expect(await asked.quietHelper()).toBe(false);
        asked.stop();
        expect(socks).toBe(0);
        const granted = B.usbLookBlock(() => undefined, (d) => flown.push(d), { helper: true, permissions: perm('granted'), helperDevice: dev });
        expect(await granted.quietHelper()).toBe(true);
        expect(socks).toBe(1);
        expect(flown).toHaveLength(1);
        granted.stop();
        await (flown[0] as { close(): Promise<void> }).close();
    });
});

describe('after a press the next step is in view and acts (review CN-5, CN-6, CN-7)', () => {
    it('a DJI pick brings the block into view, a refused claim then its helper section', async () => {
        nav.usb = { requestDevice: () => Promise.resolve(refused({ ...RC2 } as never)) };
        const blk = B.usbLookBlock(() => undefined, () => undefined, { permissions: null, helperDevice: () => new R.Rc2BridgeDevice({ socket: () => new FakeSocket(false) as never, permissions: null }) });
        const proto = Object.getPrototypeOf(blk.el) as { scrollIntoView?: unknown };
        const seen: string[] = [];
        proto.scrollIntoView = function (this: FakeElement) { seen.push(this.getAttribute('data-testid') ?? ''); };
        try {
            expect(await blk.pickDji()).toBe('trying');
            expect(await until(() => seen.includes('usb-helper'))).toBe(true);
            expect(seen[0]).toBe('usb-look');
        } finally {
            delete proto.scrollIntoView;
            blk.stop();
        }
    });
    it('"Fly with this controller" on the details road goes on to the helper when the claim is refused', async () => {
        nav.usb = { requestDevice: () => Promise.resolve(refused({ ...RC2 } as never)) };
        const flown: unknown[] = [];
        const blk = B.usbLookBlock(() => undefined, (d) => flown.push(d), { permissions: null, helperDevice: () => new R.Rc2BridgeDevice({ socket: () => new FakeSocket(true) as never, permissions: null }) });
        const el = blk.el as unknown as FakeElement;
        btn(el, 'usb-look')!.click();
        expect(await until(() => btn(el, 'usb-rc2-fly') !== null)).toBe(true);
        btn(el, 'usb-rc2-fly')!.click();
        expect(await until(() => flown.length === 1)).toBe(true);
        expect(flown[0]).toBeInstanceOf(R.Rc2BridgeDevice);
        blk.stop();
        await (flown[0] as { close(): Promise<void> }).close();
    });
    it('a press during a quiet helper try is not lost: the quiet try is let go and the press connects', async () => {
        /** a helper socket that never answers (one quiet try under way) */
        class Hang {
            onopen: ((e: unknown) => void) | null = null;
            onmessage: ((e: { data: unknown }) => void) | null = null;
            onerror: ((e: unknown) => void) | null = null;
            onclose: ((e: unknown) => void) | null = null;
            close(): void { this.onclose?.({}); }
        }
        let made = 0;
        const flown: unknown[] = [];
        const blk = B.usbLookBlock(() => undefined, (d) => flown.push(d), { helper: true, permissions: null,
            helperDevice: () => { made++; const first = made === 1; return new R.Rc2BridgeDevice({ socket: () => (first ? new Hang() : new FakeSocket(true)) as never, permissions: null }); } });
        const el = blk.el as unknown as FakeElement;
        void blk.quietHelper();
        expect(await until(() => made === 1)).toBe(true);
        btn(el, 'usb-rc2-bridge')!.click();
        expect(await until(() => flown.length === 1)).toBe(true);
        expect(made).toBe(2);
        blk.stop();
        await (flown[0] as { close(): Promise<void> }).close();
    });
});

describe('the helper program\'s two files (C3)', () => {
    it('the helper section saves both files with one press each: the repository copy first, then the page\'s own', async () => {
        let give: (f: { name: 'start-dji-helper.cmd' | 'dji-helper.py'; url: string }[]) => void = () => undefined;
        const ready = new Promise<{ name: 'start-dji-helper.cmd' | 'dji-helper.py'; url: string }[]>((r) => { give = r; });
        const blk = B.usbLookBlock(() => undefined, () => undefined, { helper: true, permissions: null, helperFiles: () => ready,
            helperDevice: () => new R.Rc2BridgeDevice({ socket: () => new FakeSocket(false) as never, permissions: null }) });
        const el = blk.el as unknown as FakeElement;
        btn(el, 'usb-rc2-bridge')!.click();
        const links = el.querySelectorAll('[data-testid="usb-helper-file"]');
        expect(links.map((a) => a.getAttribute('download'))).toEqual(['start-dji-helper.cmd', 'dji-helper.py']);
        expect(links[1]!.getAttribute('href')).toBe('https://raw.githubusercontent.com/AndriiShramko/ShramkoGSFPV/main/tools/rc-bridge/rc_bridge.py');
        expect(links[0]!.textContent).toBe('Download start-dji-helper.cmd');
        give([{ name: 'start-dji-helper.cmd', url: 'blob:cmd' }, { name: 'dji-helper.py', url: 'blob:py' }]);
        expect(await until(() => links[1]!.getAttribute('href') === 'blob:py')).toBe(true);
        expect(links[0]!.getAttribute('href')).toBe('blob:cmd');
        expect(links[0]!.getAttribute('target')).toBeNull();
        expect(el.textContent).toContain('Python 3.8');
        expect(el.textContent).not.toMatch(/bridge/i);
        blk.stop();
    });
    it('the bundled files are the repository\'s, the .cmd with Windows line ends', async () => {
        const F = await import('../../../apps/fly/src/devices/helper-files');
        const { readFileSync } = await import('node:fs');
        const got: Record<string, string> = {};
        const files = await F.helperFiles(undefined, (text, name) => { got[name] = text; return `blob:${name}`; });
        expect(files.map((f) => f.url)).toEqual(['blob:start-dji-helper.cmd', 'blob:dji-helper.py']);
        const disk = (n: string) => readFileSync(new URL(`../../rc-bridge/${n}`, import.meta.url), 'utf8');
        expect(got['dji-helper.py']).toBe(disk('rc_bridge.py'));
        const cmd = got['start-dji-helper.cmd']!;
        expect(cmd.replace(/\r\n/g, '\n')).toBe(disk('start-dji-helper.cmd').replace(/\r\n/g, '\n'));
        expect(cmd.split('\n').length - 1).toBe(cmd.split('\r\n').length - 1);
        expect(cmd).toContain('Python is not on this computer');
    });
});
