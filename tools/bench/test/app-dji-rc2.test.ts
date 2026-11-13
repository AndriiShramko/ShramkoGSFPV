// Lane rc2, stage 2 (docs/wip/rc2.md): the DJI RC 2 as an input source over WebUSB (apps/fly/src/devices/dji-rc2-source.ts).
// A fake USBDevice answers each stick request the way the owner's controller did on 2026-11-13: first by replaying the
// recorded frames in their order (stick answers and the unasked set-00 frames, evidence/2026-11-13/rc2/frames-rest.json),
// then with built answers whose values move (the recording never moved: the layout is the reference's).
//  - read through the real HidSource: the recorded answers give centred axes, one frame per stick answer, the unasked
//    frames none; the profile key; open, configuration and claim of interface 0 in that order;
//  - moving sticks move the axes (-1..1); the throttle at rest sits in the middle (the centred style's cue);
//  - a refused claim gives Rc2Error 'claim' and leaves the device closed; a controller that never answers gives 'silent';
//  - unplugged: onEnd('unplug'), no frame after it, and the real Controls disarm (stale) a pilot armed by Space;
//  - let go (HidSource.close): the interface is released and the asking stops;
//  - a later visit: findSavedRc2 takes a granted device with a saved profile without the chooser, and lets go of one without.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Profile, RawFrame } from '../../../packages/input/src';
import { RC2, buildFrame, parseFrame } from '../../../packages/input/src/dji-duml';
import type { DumlFrame } from '../../../packages/input/src/dji-duml';
import { FakeStorage } from '../../../packages/prefs/test/helpers';

type Rc2Mod = typeof import('../../../apps/fly/src/devices/dji-rc2-source');
type HidMod = typeof import('../../../apps/fly/src/devices/hid');
type AppControls = typeof import('../../../apps/fly/src/controls');
let R: Rc2Mod, H: HidMod, C: AppControls;

beforeAll(async () => {
    vi.stubGlobal('location', { search: '', pathname: '/fly/', href: 'http://127.0.0.1/fly/', origin: 'http://127.0.0.1' });
    vi.stubGlobal('document', { cookie: '', documentElement: { lang: '' }, visibilityState: 'visible' });
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    vi.stubGlobal('localStorage', new FakeStorage());
    R = await import('../../../apps/fly/src/devices/dji-rc2-source');
    H = await import('../../../apps/fly/src/devices/hid');
    C = await import('../../../apps/fly/src/controls');
});

const rec = JSON.parse(readFileSync(resolve(__dirname, '../../../packages/input/test/fixtures/dji-rc2/frames-rest.json'), 'utf8')) as { frames: { hex: string; set: number }[] };
const bytes = (hex: string): Uint8Array => Uint8Array.from(hex.match(/../g)!.map((x) => parseInt(x, 16)));
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const until = async (ok: () => boolean, ms = 2000): Promise<void> => { const t0 = Date.now(); while (!ok() && Date.now() - t0 < ms) await sleep(5); };

/** A stick answer laid out as the recorded one: result 0, each value followed by its channel number. */
function answer(seq: number, values: readonly number[]): Uint8Array {
    const p = new Uint8Array(19);
    values.forEach((v, i) => { p[1 + i * 3] = v & 0xff; p[2 + i * 3] = v >> 8; p[3 + i * 3] = i + 1; });
    return buildFrame({ sender: RC2.RC, receiver: RC2.PC, seq, type: 0x80, set: 6, id: 1, payload: p });
}

const CENTRE = [1024, 1024, 1024, 1024, 1024, 1024];

class FakeRc2 {
    vendorId = 0x2ca3;
    productId = 0x1021;
    productName = 'DJI RC 2';
    opened = false;
    configuration: { configurationValue: number } | null = null;
    configurations = [{
        configurationValue: 1,
        interfaces: [
            { interfaceNumber: 0, alternates: [{ interfaceClass: 0xff, interfaceSubclass: 0x43, interfaceProtocol: 0x01, endpoints: [{ endpointNumber: 1, direction: 'in' as const, type: 'bulk' }, { endpointNumber: 1, direction: 'out' as const, type: 'bulk' }] }] },
            { interfaceNumber: 2, alternates: [{ interfaceClass: 0xff, interfaceSubclass: 0x42, interfaceProtocol: 0x01 }] }
        ]
    }];
    calls: string[] = [];
    requests = 0;
    claimFails = false;
    silent = false;
    gone = false;
    /** the recorded frames still to replay (null: answer with `values`) */
    replay: Uint8Array[] | null = null;
    values: number[] = CENTRE.slice();
    /** answers come this long after their request (0: at once) */
    delayMs = 0;
    private queue: Uint8Array[] = [];
    private wake: (() => void) | null = null;

    async open(): Promise<void> { this.calls.push('open'); this.opened = true; }
    async close(): Promise<void> { this.calls.push('close'); this.opened = false; }
    async selectConfiguration(v: number): Promise<void> { this.calls.push(`config ${v}`); this.configuration = { configurationValue: v }; }
    async claimInterface(n: number): Promise<void> {
        this.calls.push(`claim ${n}`);
        if (this.claimFails) throw Object.assign(new Error('Unable to claim interface.'), { name: 'NetworkError' });
    }
    async releaseInterface(n: number): Promise<void> { this.calls.push(`release ${n}`); }
    async transferOut(ep: number, data: Uint8Array): Promise<unknown> {
        if (this.gone) throw Object.assign(new Error('The device was disconnected.'), { name: 'NotFoundError' });
        const req = parseFrame(data) as DumlFrame;
        expect([ep, req.set, req.id, req.type, req.sender, req.receiver]).toEqual([1, 6, 1, 0x40, 0x0a, 0x06]);
        this.requests++;
        if (this.silent) return { status: 'ok' };
        if (this.replay) {
            // up to and including the next recorded stick answer, the unasked frames before it in the same read
            const chunk: number[] = [];
            while (this.replay.length) {
                const f = this.replay.shift()!;
                if (f[9] === 6) {
                    // the recorded answer, its sequence set to this request's (the controller echoes it)
                    chunk.push(...buildFrame({ ...(parseFrame(f) as DumlFrame), seq: req.seq }));
                    break;
                }
                chunk.push(...f);
            }
            if (chunk.length) this.queue.push(Uint8Array.from(chunk));
        } else if (this.delayMs > 0) {
            // a slow bus or a busy page: the answer comes this long after its request
            const a = answer(req.seq, this.values);
            setTimeout(() => { this.queue.push(a); this.wake?.(); }, this.delayMs);
        } else {
            this.queue.push(answer(req.seq, this.values));
        }
        this.wake?.();
        return { status: 'ok' };
    }
    async transferIn(ep: number, len: number): Promise<{ status: string; data: DataView }> {
        expect([ep, len]).toEqual([1, 512]);
        while (!this.queue.length && !this.gone) await new Promise<void>((r) => { this.wake = r; });
        if (this.gone) throw Object.assign(new Error('The device was disconnected.'), { name: 'NotFoundError' });
        const b = this.queue.shift()!;
        return { status: 'ok', data: new DataView(b.buffer) };
    }
    unplug(): void { this.gone = true; this.opened = false; this.wake?.(); }
}

class FakeHub {
    private fns = new Set<(e: { device: unknown }) => void>();
    constructor(readonly devices: FakeRc2[] = []) {}
    getDevices(): Promise<FakeRc2[]> { return Promise.resolve(this.devices); }
    addEventListener(_t: 'disconnect', fn: (e: { device: unknown }) => void): void { this.fns.add(fn); }
    removeEventListener(_t: 'disconnect', fn: (e: { device: unknown }) => void): void { this.fns.delete(fn); }
    disconnect(d: FakeRc2): void { d.unplug(); for (const fn of [...this.fns]) fn({ device: d }); }
    get listening(): number { return this.fns.size; }
}

async function sourceOn(dev: FakeRc2, hub = new FakeHub([dev])) {
    const rc = new R.DjiRc2Device(dev, { hub });
    const src = new H.HidSource();
    const frames: RawFrame[] = [];
    src.onFrame = (f) => frames.push({ t: f.t, axes: Float32Array.from(f.axes), buttons: f.buttons });
    await src.open(rc as unknown as HIDDevice);
    return { rc, src, frames, hub };
}

describe('the stick channel through HidSource', () => {
    it('the recorded frames: centred axes, one frame per stick answer, none for the unasked frames; key and call order', async () => {
        const dev = new FakeRc2();
        const part = rec.frames.slice(0, 120); // about 2 s of the recording at the 10 ms pace
        dev.replay = part.map((f) => bytes(f.hex));
        const answers = part.filter((f) => f.set === 6).length;
        expect(part.length - answers).toBeGreaterThan(2); // unasked frames are in it
        const { rc, src, frames } = await sourceOn(dev);
        await until(() => dev.replay!.length === 0, 5000);
        await sleep(30);
        expect(dev.calls.slice(0, 3)).toEqual(['open', 'config 1', 'claim 0']);
        expect(rc.replies).toBe(answers);
        expect(frames.length).toBe(answers - 1); // the first answer came before HidSource listened (it opened the device)
        for (const f of frames) expect(Array.from(f.axes.slice(0, 6))).toEqual([0, 0, 0, 0, 0, 0]);
        expect(src.key).toBe('hid:2ca3:1021:DJI RC 2:12:d');
        expect(src.badReports).toBe(0);
        src.close();
    });
    it('moving sticks move the axes; at rest the throttle sits in the middle', async () => {
        const dev = new FakeRc2();
        const { src, frames } = await sourceOn(dev);
        await until(() => frames.length > 2);
        expect(frames[frames.length - 1].axes[2]).toBe(0); // throttle at 1024: the middle, the centred style's rest
        dev.values = [1684, 364, 1354, 694, 1024, 1189];
        const n = frames.length;
        await until(() => frames.length > n + 3);
        expect(Array.from(frames[frames.length - 1].axes.slice(0, 6))).toEqual([1, -1, 0.5, -0.5, 0, 0.25]);
        expect(dev.requests).toBeGreaterThan(3);
        src.close();
    });
    it('answers 60 ms late: requests do not wait for them, so frames come far more often than one per answer time', async () => {
        // the page probe (rc2-probe.mjs, 2026-11-13) saw a request-answer chain deliver a frame every 100-210 ms on a
        // busy page and the arm gate cut the motors; one request at a time would give a frame every 70 ms here
        const dev = new FakeRc2();
        dev.delayMs = 60;
        const { rc, src } = await sourceOn(dev);
        const at: number[] = [];
        src.onFrame = () => at.push(performance.now());
        await sleep(1000);
        await src.close();
        const gaps = at.slice(1).map((t, i) => t - at[i]!);
        expect(at.length).toBeGreaterThan(20);
        expect(Math.max(...gaps)).toBeLessThan(55);
        expect(rc.late).toBe(0);
    });
    it('answers 400 ms late never fly: their requests were given up, so the stick data is old; open() says silent', async () => {
        const dev = new FakeRc2();
        dev.delayMs = 400;
        const rc = new R.DjiRc2Device(dev, { hub: new FakeHub([dev]) });
        let reports = 0;
        rc.addEventListener('inputreport', () => { reports++; });
        await expect(rc.open()).rejects.toMatchObject({ why: 'silent' });
        expect(reports).toBe(0);
        expect(rc.replies).toBe(0);
        expect(rc.late).toBeGreaterThan(5);
        expect(rc.unanswered).toBeGreaterThan(5);
    });
    it('answers out of 364..1684 are dropped and counted, never flown as full deflection', async () => {
        const dev = new FakeRc2();
        const { rc, src, frames } = await sourceOn(dev);
        await until(() => frames.length > 2);
        dev.values = [0, 65535, 1024, 1024, 1024, 1024];
        const n = frames.length;
        const b0 = rc.bad;
        await until(() => rc.bad > b0 + 5);
        expect(rc.bad).toBeGreaterThan(b0 + 5);
        expect(frames.length).toBeLessThanOrEqual(n + 1); // one answer may have been on its way already
        src.close();
    });
    it('the ask loop paces by its timer only: animation frames add no requests', async () => {
        // a1b43eb1 woke the loop on the next animation frame too; on a busy page that only added requests and work
        const g = globalThis as { requestAnimationFrame?: unknown };
        const had = g.requestAnimationFrame;
        g.requestAnimationFrame = (f: () => void) => setImmediate(f); // not a timer: Windows timers tick about every 15 ms
        try {
            const dev = new FakeRc2();
            const { src } = await sourceOn(dev);
            const r0 = dev.requests;
            await sleep(300);
            const n = dev.requests - r0;
            src.close();
            expect(n).toBeGreaterThan(5);
            expect(n).toBeLessThan(45); // the timer alone: at most one every RC2_POLL_MS 10 ms, 30 in 300 ms
        } finally {
            g.requestAnimationFrame = had;
        }
    });

    it('a refused claim: Rc2Error claim, the device closed again; control: the same device claims when allowed', async () => {
        const dev = new FakeRc2();
        dev.claimFails = true;
        const err = await new R.DjiRc2Device(dev, { hub: null }).open().catch((e: unknown) => e);
        expect(err).toBeInstanceOf(R.Rc2Error);
        expect((err as InstanceType<Rc2Mod['Rc2Error']>).why).toBe('claim');
        expect(dev.opened).toBe(false);
        expect(dev.calls).toEqual(['open', 'config 1', 'claim 0', 'close']);
        dev.claimFails = false;
        const ok = new R.DjiRc2Device(dev, { hub: null });
        await ok.open();
        expect(ok.opened).toBe(true);
        await ok.close();
    });
    it('a controller that never answers: Rc2Error silent, released and closed', async () => {
        const dev = new FakeRc2();
        dev.silent = true;
        const err = await new R.DjiRc2Device(dev, { hub: null, wait: (ms) => sleep(ms / 50) }).open().catch((e: unknown) => e);
        expect((err as { why?: string }).why).toBe('silent');
        await until(() => dev.calls.includes('close'));
        expect(dev.calls).toContain('release 0');
    });
    it('a device without the stick channel is not taken', async () => {
        const dev = new FakeRc2();
        dev.configurations[0].interfaces.shift();
        expect(R.hasStickChannel(dev)).toBe(false);
        const err = await new R.DjiRc2Device(dev, { hub: null }).open().catch((e: unknown) => e);
        expect((err as { why?: string }).why).toBe('claim');
        expect(dev.calls).toEqual([]);
    });
});

describe('unplug and letting go', () => {
    it('unplugged: onEnd unplug, no frame after it, and Controls disarm a pilot armed by Space', async () => {
        const dev = new FakeRc2();
        dev.values = [1024, 1024, 364, 1024, 1024, 1024]; // throttle at the bottom: the from-zero gate arms
        const { rc, src, frames, hub } = await sourceOn(dev);
        const session = { sim: null, paused: false, input: () => undefined, beforeStep: null };
        const controls = new C.Controls(session as never);
        const profile: Profile = {
            version: 1, deviceKey: src.key, deviceName: 'DJI RC 2', deadband: 0.025, created: '2026-11-13T00:00:00.000Z', mode: 2, wizard: 2,
            axes: { roll: { index: 0, invert: false, center: 0, min: -1, max: 1 }, pitch: { index: 1, invert: false, center: 0, min: -1, max: 1 }, throttle: { index: 2, invert: false, center: 0, min: -1, max: 1 }, yaw: { index: 3, invert: false, center: 0, min: -1, max: 1 } },
            arm: { kind: 'key' }, angleMode: null
        } as unknown as Profile;
        controls.setProfile(profile);
        controls.source = 'hid';
        src.onFrame = (f) => { frames.push({ t: f.t, axes: Float32Array.from(f.axes), buttons: f.buttons }); controls.raw(f); };
        await until(() => frames.length > 3);
        // the page's frame loop: Controls.tick about every 10 ms (a single late tick counts as a stalled page, not as silence)
        const ticker = setInterval(() => controls.tick(performance.now()), 10);
        controls.toggleArm();
        await sleep(30);
        const gate = (controls as unknown as { gate: { armed: boolean } }).gate;
        expect(controls.block).toBeNull();
        expect(gate.armed).toBe(true);
        const ends: string[] = [];
        rc.onEnd = (why) => ends.push(why);
        hub.disconnect(dev);
        const n = frames.length;
        await sleep(200);
        clearInterval(ticker);
        expect(ends).toEqual(['unplug']);
        expect(frames.length).toBe(n);
        expect(rc.opened).toBe(false);
        expect(hub.listening).toBe(0);
        expect(controls.block).toBe('stale');
        expect(gate.armed).toBe(false);
        src.close();
    });
    it('HidSource.close lets the interface go and the asking stops', async () => {
        const dev = new FakeRc2();
        const { rc, src, frames } = await sourceOn(dev);
        await until(() => frames.length > 2);
        src.close();
        await until(() => dev.calls.includes('close'));
        const asked = dev.requests;
        await sleep(60);
        expect(dev.requests - asked).toBeLessThanOrEqual(1);
        expect(dev.calls).toContain('release 0');
        expect(rc.opened).toBe(false);
    });
});

describe('a later visit', () => {
    it('a granted RC 2 with a saved profile flies without the chooser; one without a profile is let go', async () => {
        const dev = new FakeRc2();
        const hub = new FakeHub([dev]);
        const saved = { deviceKey: 'hid:2ca3:1021:DJI RC 2:12:d' } as Profile;
        const got = await R.findSavedRc2((k) => (k === saved.deviceKey ? saved : null), hub);
        expect(got?.kind).toBe('hid');
        expect(got?.profile).toBe(saved);
        const seen: number[] = [];
        got!.hid!.onFrame = (f) => seen.push(f.axes[0]);
        await until(() => seen.length > 2);
        expect(seen.length).toBeGreaterThan(2);
        got!.hid!.close();
        const other = new FakeRc2();
        expect(await R.findSavedRc2(() => null, new FakeHub([other]))).toBeNull();
        await until(() => other.calls.includes('close'));
        expect(other.calls).toEqual(expect.arrayContaining(['open', 'claim 0', 'release 0', 'close']));
        expect(await R.findSavedRc2(() => saved, null)).toBeNull();
    });
});
