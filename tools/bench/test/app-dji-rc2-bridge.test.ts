// Lane rc2, stage 3 (docs/wip/rc2.md): the DJI RC 2 through the Shramko RC bridge (tools/rc-bridge/rc_bridge.py), the
// path that works on Windows with DJI Assistant 2's driver and no driver change.
//  - Rc2BridgeDevice over a fake WebSocket speaking the bridge's messages (hello, state, v): the first values open it,
//    each values message is one 12-byte report, the real HidSource reads it with the same profile key as the WebUSB
//    source; nothing answers: 'nobridge'; the bridge without a controller: 'nocontroller'; no values: 'silent'; the
//    bridge going away stops the source and tells onEnd; the last reader gone closes the socket.
//  - the helper block: no connection to 127.0.0.1 when the block is built (never on page load), one on the press of
//    "Fly through the RC bridge"; a bridge that answers hands the device to `fly`; one that does not says how to start
//    it; control: no fly callback, no bridge action.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { FakeStorage } from '../../../packages/prefs/test/helpers';
import { fakeDocument } from './helpers/fake-dom';
import type { FakeElement } from './helpers/fake-dom';

type BridgeMod = typeof import('../../../apps/fly/src/devices/dji-rc2-bridge');
type HidMod = typeof import('../../../apps/fly/src/devices/hid');
type BlockMod = typeof import('../../../apps/fly/src/ui/usb-look-block');
let R: BridgeMod, H: HidMod, B: BlockMod;

class FakeSocket {
    static made: FakeSocket[] = [];
    onopen: ((e: unknown) => void) | null = null;
    onmessage: ((e: { data: unknown }) => void) | null = null;
    onerror: ((e: unknown) => void) | null = null;
    onclose: ((e: unknown) => void) | null = null;
    closed = false;
    constructor(readonly url: string) { FakeSocket.made.push(this); }
    close(): void { this.closed = true; }
    say(m: unknown): void { this.onmessage?.({ data: JSON.stringify(m) }); }
    refuse(): void { this.onerror?.({}); this.onclose?.({}); }
}

beforeAll(async () => {
    // lane connect C2: the switch is gone, the helper is offered by a saved RC 2 setup ({ helper: true } below)
    vi.stubGlobal('location', { search: '?rcbridge=1', pathname: '/en/fly/', href: 'http://127.0.0.1/en/fly/?rcbridge=1', origin: 'http://127.0.0.1' });
    vi.stubGlobal('document', fakeDocument());
    vi.stubGlobal('navigator', { languages: ['en'], language: 'en' });
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    vi.stubGlobal('localStorage', new FakeStorage());
    vi.stubGlobal('WebSocket', FakeSocket);
    R = await import('../../../apps/fly/src/devices/dji-rc2-bridge');
    H = await import('../../../apps/fly/src/devices/hid');
    B = await import('../../../apps/fly/src/ui/usb-look-block');
});

const flush = async (n = 5): Promise<void> => { for (let i = 0; i < n; i++) await Promise.resolve(); };
/** a wait the test lets pass by hand */
function manualWait() {
    const pending: (() => void)[] = [];
    return { wait: () => new Promise<void>((r) => { pending.push(r); }), pass: () => { for (const r of pending.splice(0)) r(); } };
}
const btn = (el: FakeElement, a: string) => el.querySelector(`[data-action="${a}"]`) as unknown as { click(): void } | null;

describe('Rc2BridgeDevice over the bridge messages', () => {
    it('opens at the first values; one 12-byte report per message; HidSource reads it as the WebUSB RC 2', async () => {
        let sock: FakeSocket | null = null;
        const d = new R.Rc2BridgeDevice({ socket: (u) => (sock = new FakeSocket(u)) });
        const opened = d.open();
        expect(sock!.url).toBe('ws://127.0.0.1:47310/');
        sock!.onopen?.({});
        sock!.say({ hello: 'shramko-rc-bridge', version: 1 });
        sock!.say({ state: 'reading' });
        sock!.say({ v: [1024, 1024, 1024, 1024, 1024, 1024] });
        await opened;
        expect(d.opened).toBe(true);
        const src = new H.HidSource();
        await src.open(d as unknown as HIDDevice);
        const frames: number[][] = [];
        src.onFrame = (f) => frames.push(Array.from(f.axes.slice(0, 6)));
        sock!.say({ v: [1684, 364, 1024, 1354, 1024, 1024] });
        sock!.say({ v: 'nonsense' });
        sock!.say({ v: [1, 2, 3] });
        sock!.say({ v: [0, 65535, 1024, 1024, 1024, 1024] }); // out of 364..1684: never flown, not even clamped
        expect(src.key).toBe('hid:2ca3:1021:DJI RC 2:12:d');
        expect(d.replies).toBe(2);
        expect(frames).toHaveLength(1);
        expect(frames[0][0]).toBeCloseTo(1, 2);
        expect(frames[0][1]).toBeCloseTo(-1, 2);
        expect(frames[0][2]).toBeCloseTo(0, 2);
        expect(frames[0][3]).toBeCloseTo(0.5, 2);
        src.close();
        expect(sock!.closed).toBe(true); // the last reader gone: the bridge lets the controller go
        expect(d.opened).toBe(false);
    });

    it('nothing answers: nobridge; no controller: nocontroller; no values: silent', async () => {
        const whyOf = async (drive: (s: FakeSocket, pass: () => void) => void): Promise<string> => {
            let sock: FakeSocket | null = null;
            const w = manualWait();
            const d = new R.Rc2BridgeDevice({ socket: (u) => (sock = new FakeSocket(u)), wait: w.wait });
            const p = d.open().then(() => 'opened', (e: { why?: string }) => e.why ?? String(e));
            drive(sock!, w.pass);
            const r = await p;
            expect(sock!.closed || r === 'nobridge').toBe(true);
            return r;
        };
        expect(await whyOf((s) => s.refuse())).toBe('nobridge');
        expect(await whyOf((s) => { s.onopen?.({}); s.say({ hello: 'shramko-rc-bridge' }); s.say({ state: 'no-controller', why: 'no DJI RC 2' }); })).toBe('nocontroller');
        expect(await whyOf((s, pass) => { s.onopen?.({}); s.say({ hello: 'shramko-rc-bridge' }); s.say({ state: 'reading' }); void flush().then(pass); })).toBe('silent');
    });

    it('the bridge going away or losing the controller stops the source and says so', async () => {
        for (const end of ['close', 'lost'] as const) {
            let sock: FakeSocket | null = null;
            const d = new R.Rc2BridgeDevice({ socket: (u) => (sock = new FakeSocket(u)) });
            const ends: string[] = [];
            d.onEnd = (why) => ends.push(why);
            const p = d.open();
            sock!.onopen?.({});
            sock!.say({ v: [1024, 1024, 1024, 1024, 1024, 1024] });
            await p;
            if (end === 'close') sock!.onclose?.({}); else sock!.say({ state: 'no-controller', why: 'unplugged' });
            expect(ends).toEqual(['unplug']);
            expect(d.opened).toBe(false);
            sock!.say({ v: [1024, 1024, 1024, 1024, 1024, 1024] });
            expect(d.replies).toBe(1);
        }
    });
});

describe('"Fly through the RC bridge" in the helper block', () => {
    it('no connection when the block is built; the press connects; values hand the device to fly', async () => {
        FakeSocket.made = [];
        const flown: { productName: string; close(): Promise<void> }[] = [];
        const el = B.usbLookBlock(() => undefined, (x) => flown.push(x as never), { helper: true }).el as unknown as FakeElement;
        expect(FakeSocket.made).toHaveLength(0);
        expect(el.textContent).toContain('start-dji-helper.cmd');
        btn(el, 'usb-rc2-bridge')!.click();
        expect(FakeSocket.made).toHaveLength(1);
        expect(FakeSocket.made[0].url).toBe('ws://127.0.0.1:47310/');
        const say = el.querySelector('[data-testid="usb-bridge-say"]')!;
        expect(say.getAttribute('data-state')).toBe('opening');
        FakeSocket.made[0].onopen?.({});
        FakeSocket.made[0].say({ v: [1024, 1024, 1024, 1024, 1024, 1024] });
        await flush();
        expect(flown).toHaveLength(1);
        expect(flown[0].productName).toBe('DJI RC 2');
        expect(say.getAttribute('data-state')).toBe('flying');
        await flown[0].close();
    });

    it('a bridge that does not answer: how to start it; one with no controller: how to connect it; control: no fly, no action', async () => {
        FakeSocket.made = [];
        const el = B.usbLookBlock(() => undefined, () => undefined, { helper: true }).el as unknown as FakeElement;
        const say = el.querySelector('[data-testid="usb-bridge-say"]')!;
        btn(el, 'usb-rc2-bridge')!.click();
        FakeSocket.made[0].refuse();
        await flush();
        expect(say.getAttribute('data-state')).toBe('nobridge');
        expect(say.textContent).toContain('does not answer');
        expect(say.textContent).toContain('start-dji-helper.cmd');
        btn(el, 'usb-rc2-bridge')!.click();
        FakeSocket.made[1].onopen?.({});
        FakeSocket.made[1].say({ state: 'no-controller', why: 'x' });
        await flush();
        expect(say.getAttribute('data-state')).toBe('nocontroller');
        expect(say.textContent).toContain('does not see the controller');
        const none = B.usbLookBlock(() => undefined).el as unknown as FakeElement;
        expect(btn(none, 'usb-rc2-bridge')).toBeNull();
        expect(FakeSocket.made).toHaveLength(2);
    });
});
