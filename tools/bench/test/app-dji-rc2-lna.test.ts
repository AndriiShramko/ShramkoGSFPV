// Lane rc2-lna (docs/wip/rc2-lna.md): the RC bridge from the public https site and Chrome's Local Network Access
// question ("may this site reach apps on this device"). Measured on Chrome 156: the permission that decides
// ws://127.0.0.1 is 'loopback-network'; without it the socket fails with ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS.
//  - Rc2BridgeDevice asks navigator.permissions first: 'denied' fails at once with no socket; 'prompt' tells the page
//    (asking) and connects; a failed attempt while the question is open waits for the answer and connects again at
//    once on Allow (one press); a refusal then is 'denied'; 'granted' or a browser that knows none of the names:
//    connects as before, no asking line.
//  - the helper block: 'prompt' shows the line that Chrome is asking (data-state 'asking') and keeps it while the
//    question is open; Allow flies without a second press; 'denied' shows the no-answer line (how to allow it in the
//    site settings) without a connection; a second press while asking starts over.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { FakeStorage } from '../../../packages/prefs/test/helpers';
import { fakeDocument } from './helpers/fake-dom';
import type { FakeElement } from './helpers/fake-dom';

type BridgeMod = typeof import('../../../apps/fly/src/devices/dji-rc2-bridge');
type BlockMod = typeof import('../../../apps/fly/src/ui/usb-look-block');
let R: BridgeMod, B: BlockMod;

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
    values(): void { this.onopen?.({}); this.say({ v: [1024, 1024, 1024, 1024, 1024, 1024] }); }
}

class FakePerm {
    private readonly fns = new Set<() => void>();
    constructor(public state: string) {}
    addEventListener(_t: 'change', fn: () => void): void { this.fns.add(fn); }
    removeEventListener(_t: 'change', fn: () => void): void { this.fns.delete(fn); }
    set(s: string): void { this.state = s; for (const fn of [...this.fns]) fn(); }
    get listeners(): number { return this.fns.size; }
}
/** navigator.permissions that knows only `known` (others: TypeError, as Chrome does for an unknown name) */
function perms(perm: FakePerm, known: string[] = ['loopback-network']) {
    const asked: string[] = [];
    return {
        asked,
        query: async ({ name }: { name: string }) => {
            asked.push(name);
            if (!known.includes(name)) throw new TypeError(`The provided value '${name}' is not a valid enum value`);
            return perm;
        }
    };
}

beforeAll(async () => {
    vi.stubGlobal('location', { search: '?rcbridge=1', pathname: '/en/fly/', href: 'https://gsfpv.example/en/fly/?rcbridge=1', origin: 'https://gsfpv.example' });
    vi.stubGlobal('document', fakeDocument());
    vi.stubGlobal('navigator', { languages: ['en'], language: 'en' });
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    vi.stubGlobal('localStorage', new FakeStorage());
    vi.stubGlobal('WebSocket', FakeSocket);
    R = await import('../../../apps/fly/src/devices/dji-rc2-bridge');
    B = await import('../../../apps/fly/src/ui/usb-look-block');
});

const flush = async (n = 8): Promise<void> => { for (let i = 0; i < n; i++) await Promise.resolve(); };
const btn = (el: FakeElement, a: string) => el.querySelector(`[data-action="${a}"]`) as unknown as { click(): void } | null;
const outcome = (p: Promise<void>) => { const r = { v: 'pending' }; p.then(() => { r.v = 'opened'; }, (e: { why?: string }) => { r.v = e.why ?? String(e); }); return r; };

describe('Rc2BridgeDevice and the Local Network Access question', () => {
    it('denied: fails with denied and makes no socket', async () => {
        FakeSocket.made = [];
        const d = new R.Rc2BridgeDevice({ permissions: perms(new FakePerm('denied')) });
        const asking = vi.fn();
        const r = outcome(d.open(asking));
        await flush();
        expect(r.v).toBe('denied');
        expect(FakeSocket.made).toHaveLength(0);
        expect(asking).not.toHaveBeenCalled();
    });

    it('prompt: says it is asking, connects; a refused attempt waits for the answer and Allow connects at once', async () => {
        FakeSocket.made = [];
        const perm = new FakePerm('prompt');
        const p = perms(perm);
        const d = new R.Rc2BridgeDevice({ permissions: p });
        const asking = vi.fn();
        const r = outcome(d.open(asking));
        await flush();
        expect(p.asked[0]).toBe('loopback-network');
        expect(asking).toHaveBeenCalledTimes(1);
        expect(FakeSocket.made).toHaveLength(1); // the attempt is what makes Chrome ask
        FakeSocket.made[0].refuse();
        await flush();
        expect(r.v).toBe('pending'); // the question is open: no "does not answer" yet
        perm.set('granted');
        await flush();
        expect(FakeSocket.made).toHaveLength(2);
        FakeSocket.made[1].values();
        await flush();
        expect(r.v).toBe('opened');
        expect(perm.listeners).toBe(0);
        await d.close();
    });

    it('prompt, then the pilot blocks it: denied; the socket opening while asking needs no second attempt', async () => {
        FakeSocket.made = [];
        const perm = new FakePerm('prompt');
        const r = outcome(new R.Rc2BridgeDevice({ permissions: perms(perm) }).open());
        await flush();
        FakeSocket.made[0].refuse();
        await flush();
        perm.set('denied');
        await flush();
        expect(r.v).toBe('denied');
        expect(FakeSocket.made).toHaveLength(1);
        const held = outcome(new R.Rc2BridgeDevice({ permissions: perms(new FakePerm('prompt')) }).open());
        await flush();
        FakeSocket.made[1].values();
        await flush();
        expect(held.v).toBe('opened');
        expect(FakeSocket.made).toHaveLength(2);
    });

    it('granted, or a browser that knows none of the names: connects as before, no asking; granted + no bridge: nobridge', async () => {
        FakeSocket.made = [];
        const asking = vi.fn();
        const old = perms(new FakePerm('prompt'), []);
        const a = outcome(new R.Rc2BridgeDevice({ permissions: old }).open(asking));
        await flush();
        expect(old.asked).toEqual(['loopback-network', 'local-network-access']);
        FakeSocket.made[0].refuse();
        await flush();
        expect(a.v).toBe('nobridge');
        const g = outcome(new R.Rc2BridgeDevice({ permissions: perms(new FakePerm('granted'), ['local-network-access']) }).open(asking));
        await flush();
        FakeSocket.made[1].refuse();
        await flush();
        expect(g.v).toBe('nobridge');
        expect(asking).not.toHaveBeenCalled();
    });
});

describe('the helper block while Chrome asks', () => {
    it('prompt: the asking line stays while the question is open; Allow flies without a second press', async () => {
        FakeSocket.made = [];
        const perm = new FakePerm('prompt');
        vi.stubGlobal('navigator', { languages: ['en'], language: 'en', permissions: perms(perm) });
        const flown: unknown[] = [];
        const el = B.usbLookBlock(() => undefined, (x) => flown.push(x)).el as unknown as FakeElement;
        const say = el.querySelector('[data-testid="usb-bridge-say"]')!;
        btn(el, 'usb-rc2-bridge')!.click();
        await flush();
        expect(say.getAttribute('data-state')).toBe('asking');
        expect(say.textContent).toContain('Chrome is asking whether this site may reach apps on this device');
        expect(say.textContent).toContain('Allow');
        FakeSocket.made[0].refuse();
        await flush();
        expect(say.getAttribute('data-state')).toBe('asking');
        perm.set('granted');
        await flush();
        FakeSocket.made[1].values();
        await flush();
        expect(say.getAttribute('data-state')).toBe('flying');
        expect(flown).toHaveLength(1);
    });

    it('denied: the no-answer line with the site settings, no connection; a second press while asking starts over', async () => {
        FakeSocket.made = [];
        vi.stubGlobal('navigator', { languages: ['en'], language: 'en', permissions: perms(new FakePerm('denied')) });
        const el = B.usbLookBlock(() => undefined, () => undefined).el as unknown as FakeElement;
        const say = el.querySelector('[data-testid="usb-bridge-say"]')!;
        btn(el, 'usb-rc2-bridge')!.click();
        await flush();
        expect(say.getAttribute('data-state')).toBe('denied');
        expect(say.textContent).toContain('site settings');
        expect(FakeSocket.made).toHaveLength(0);

        const perm = new FakePerm('prompt');
        vi.stubGlobal('navigator', { languages: ['en'], language: 'en', permissions: perms(perm) });
        const flown: unknown[] = [];
        const el2 = B.usbLookBlock(() => undefined, (x) => flown.push(x)).el as unknown as FakeElement;
        const say2 = el2.querySelector('[data-testid="usb-bridge-say"]')!;
        btn(el2, 'usb-rc2-bridge')!.click();
        await flush();
        FakeSocket.made[0].refuse();
        await flush();
        btn(el2, 'usb-rc2-bridge')!.click(); // the pilot closed the question unanswered and presses again
        await flush();
        expect(FakeSocket.made).toHaveLength(2);
        expect(perm.listeners).toBe(0); // the first attempt stopped waiting
        FakeSocket.made[1].values();
        await flush();
        expect(say2.getAttribute('data-state')).toBe('flying');
        expect(flown).toHaveLength(1);
        vi.stubGlobal('navigator', { languages: ['en'], language: 'en' });
    });
});
