// W2-3 on the page, in Node (docs/architecture-v03.md B.2, C.3; the owner's items 15, 23 and
// 1/5/6/17): radio profiles live in the prefs store and v0.2's survive the first-boot migration;
// Controls puts the pilot's mode on ch[5] unless the radio's mode switch decides; the arm gate
// follows respawn.keepArmed. Each claim has a negative control that must fire. The app modules read
// location, document and matchMedia when they load, so those are stubbed first.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FakeStorage, REPO } from '../../../packages/prefs/test/helpers';
import type { PrefsStore } from '../../../packages/prefs/src';
import type { ShowcaseScene } from '../../../apps/fly/src/ui/scenes';
import type { Profile, RawFrame } from '../../../packages/input/src/calib';

type AppPrefs = typeof import('../../../apps/fly/src/app/prefs');
type AppControls = typeof import('../../../apps/fly/src/controls');

let P: AppPrefs, C: AppControls;
let storage = new FakeStorage();
const doc = { cookie: '', documentElement: { lang: '' }, visibilityState: 'visible' };

beforeAll(async () => {
    vi.stubGlobal('location', { search: '', pathname: '/fly/', href: 'http://127.0.0.1/fly/', origin: 'http://127.0.0.1' });
    vi.stubGlobal('document', doc);
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    vi.stubGlobal('localStorage', storage);
    P = await import('../../../apps/fly/src/app/prefs');
    C = await import('../../../apps/fly/src/controls');
});

afterEach(() => { P.closePagePrefs(); vi.restoreAllMocks(); });

function freshStorage(init: Record<string, string> = {}): FakeStorage {
    storage = new FakeStorage(init);
    vi.stubGlobal('localStorage', storage);
    return storage;
}

/** One page load, as boot.ts opens the store, on this test's storage. */
function openPage(): PrefsStore {
    P.closePagePrefs();
    return P.openPagePrefs(SHOWCASE, '', {
        storage: storage as unknown as Storage, win: null, doc: null, cookieDoc: null, debounceMs: 0,
        openKv: async () => ({ get: async () => undefined, put: async () => undefined, close: () => undefined })
    });
}
const SHOWCASE = (JSON.parse(readFileSync(join(REPO, 'apps', 'fly', 'public', 'showcase.json'), 'utf8')) as { scenes: ShowcaseScene[] }).scenes;

// ------------------------------------------------------------------ v0.2 shapes, as v0.2 saved them
const TX16S = {
    version: 1, deviceKey: 'hid:1209:4f54:Radiomaster TX16S Joystick:19', deviceName: 'Radiomaster TX16S Joystick', deadband: 0, created: '2026-09-26T19:44:02.118Z', mode: 2, wizard: 2,
    axes: { roll: { index: 0, invert: false, center: 0.004, min: -0.999, max: 0.999 }, pitch: { index: 1, invert: false, center: -0.002, min: -0.999, max: 0.999 }, throttle: { index: 2, invert: false, center: -0.999, min: -0.999, max: 0.999 }, yaw: { index: 3, invert: false, center: 0.001, min: -0.999, max: 0.999 } },
    arm: { kind: 'axis', index: 4, threshold: 0.4985, onAbove: true, off: -0.999, on: 0.999 }, angleMode: null
};
const PAD = { version: 1, deviceKey: 'gp:Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)', deviceName: 'Xbox Wireless Controller', deadband: 0.05, created: '2026-09-22T09:00:00.000Z', axes: { roll: { index: 2, invert: false, center: 0, min: -1, max: 1 }, pitch: { index: 3, invert: true, center: 0, min: -1, max: 1 }, throttle: { index: 1, invert: true, center: 0, min: -1, max: 1 }, yaw: { index: 0, invert: false, center: 0, min: -1, max: 1 } }, arm: { kind: 'button', bit: 0, toggle: true }, angleMode: null };
/** planted: an arm input no version reads; v0.2 parseProfile refused it too */
const BROKEN = { ...PAD, deviceKey: 'hid:broken', deviceName: 'Broken', arm: { kind: 'switch3', index: 5 } };
const V02 = {
    'gsfpv.profiles.v1': JSON.stringify({ [TX16S.deviceKey]: TX16S, [PAD.deviceKey]: PAD, [BROKEN.deviceKey]: BROKEN }),
    'gsfpv.lastInput': JSON.stringify({ kind: 'hid', key: TX16S.deviceKey }),
    'gsfpv.stickMode': '1'
};

describe('radio profiles in the prefs store: v0.2 radios survive the move', () => {
    it('the first v0.3 boot: both readable v0.2 profiles fly unchanged, the last input and the stick mode with them', () => {
        freshStorage(V02);
        openPage();
        const all = C.loadProfiles();
        expect(Object.keys(all).sort()).toEqual([PAD.deviceKey, TX16S.deviceKey].sort());
        expect(all[TX16S.deviceKey]).toEqual(TX16S);
        expect(all[PAD.deviceKey]).toEqual(PAD);
        expect(C.profileFor(TX16S.deviceKey)).toEqual(TX16S);
        expect(C.loadLastInput()).toEqual({ kind: 'hid', key: TX16S.deviceKey });
        expect(C.getStickMode()).toBe(1);
    });

    it('they are in the document (exported with the settings) and still there at the next boot', () => {
        freshStorage(V02);
        openPage();
        P.closePagePrefs();
        const again = openPage();
        expect(again.migrated).toBeNull();
        expect(Object.keys(again.collection('radioProfiles').items).sort()).toEqual([PAD.deviceKey, TX16S.deviceKey].sort());
        expect(C.loadProfiles()[TX16S.deviceKey]).toEqual(TX16S);
        expect(again.exportFile().collections.radioProfiles?.items[TX16S.deviceKey]).toEqual(TX16S);
    });

    it('control: the planted broken profile is reported, not dropped in silence, and its old copy is never deleted', () => {
        freshStorage(V02);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const s = openPage();
        C.loadProfiles();
        expect(s.migrated?.ignored).toEqual(expect.arrayContaining([{ key: 'gsfpv.profiles.v1', why: '1 profile(s) this version cannot read' }]));
        expect(warn.mock.calls.flat().join(' ')).toMatch(/gsfpv\.profiles\.v1 was not moved.*1 profile\(s\) this version cannot read/);
        expect(JSON.parse(storage.getItem('gsfpv.profiles.v1') ?? '{}')[BROKEN.deviceKey]).toEqual(BROKEN);
        // and the clean set reports nothing
        freshStorage({ 'gsfpv.profiles.v1': JSON.stringify({ [TX16S.deviceKey]: TX16S }) });
        warn.mockClear();
        openPage();
        C.loadProfiles();
        expect(warn).not.toHaveBeenCalled();
    });

    it('a profile saved now (with a mode switch) is version 1, lands in the store only (v0.2 keys untouched), and reloads with its switch', () => {
        freshStorage(V02);
        openPage();
        const before = storage.getItem('gsfpv.profiles.v1');
        const p = { ...structuredClone(TX16S), modeSwitch: { input: { kind: 'axis', index: 5 }, modes: ['acro', 'horizon', 'angle'] } } as unknown as Profile;
        C.saveProfile(p);
        C.saveLastInput({ kind: 'hid', key: p.deviceKey });
        C.setStickMode(2);
        expect(storage.getItem('gsfpv.profiles.v1')).toBe(before);
        expect(storage.getItem('gsfpv.stickMode')).toBe('1');
        openPage();
        const back = C.profileFor(p.deviceKey);
        expect(back?.version).toBe(1);
        expect(back?.modeSwitch).toEqual({ input: { kind: 'axis', index: 5 }, modes: ['acro', 'horizon', 'angle'] });
        expect(C.getStickMode()).toBe(2);
    });

    it('parse tolerance: a mode switch this version cannot read is dropped and the profile kept; control: an unreadable arm input refuses the whole profile', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const odd = C.parseProfile(JSON.stringify({ ...TX16S, modeSwitch: { input: { kind: 'pot', index: 5 }, modes: ['acro', 'horizon', 'angle'] } }));
        expect(odd).not.toBeNull();
        expect(odd?.modeSwitch).toBeUndefined();
        expect(odd?.axes).toEqual(TX16S.axes);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(C.parseProfile(JSON.stringify(BROKEN))).toBeNull();
        expect(C.parseProfile(JSON.stringify(TX16S))).toEqual(TX16S);
    });
});

// ------------------------------------------------------------------ Controls: ch[5] and the arm gate
class FakeSession {
    sim = { crashed: false };
    sent: Float32Array[] = [];
    input(ch: ArrayLike<number>): void { this.sent.push(Float32Array.from(ch)); }
    get last(): Float32Array { return this.sent[this.sent.length - 1]; }
}
function controls(): { c: InstanceType<AppControls['Controls']>; s: FakeSession } {
    const s = new FakeSession();
    const c = new C.Controls(s as never);
    return { c, s };
}
const frame = (o: { thr?: number; arm?: number; ch6?: number } = {}): RawFrame => ({ t: performance.now(), axes: new Float32Array([0, 0, o.thr ?? -1, 0, o.arm ?? -1, o.ch6 ?? -1, 0, 0]), buttons: 0 });
const radio = (ms?: Profile['modeSwitch']): Profile => ({ ...(structuredClone(TX16S) as unknown as Profile), ...(ms ? { modeSwitch: ms } : {}) });

describe('Controls: ch[5] is the pilot\'s mode unless the radio\'s switch decides', () => {
    it('keyboard and touch: the pilot\'s mode on ch[5], and a change goes out at once', () => {
        for (const src of ['keyboard', 'touch'] as const) {
            const { c, s } = controls();
            c.source = src;
            c.channels([0, 0, -1, 0, -1, 1, 0, 0], 0); // the device's own ch[5] is not the mode
            expect(s.last[5]).toBe(1); // angle by default
            c.setMode('horizon');
            expect(s.last[5]).toBe(0);
            c.setMode('acro');
            expect(s.last[5]).toBe(-1);
            expect(c.flyingMode()).toBe('acro');
        }
    });

    it('a radio with a mode switch: CH6 decides, whatever the pilot picked; control: the same radio without one flies the pilot\'s mode', () => {
        const { c, s } = controls();
        c.setProfile(radio({ input: { kind: 'axis', index: 5 }, modes: ['acro', 'horizon', 'angle'] }));
        c.source = 'hid';
        c.mode = 'horizon';
        c.raw(frame({ ch6: -1 }));
        expect(s.last[5]).toBe(-1);
        expect(c.radioDecides()).toBe(true);
        expect(c.flyingMode()).toBe('acro');
        c.setMode('angle'); // a chip click: ch[5] stays the radio's
        c.raw(frame({ ch6: -1 }));
        expect(s.last[5]).toBe(-1);
        c.raw(frame({ ch6: 1 }));
        expect(s.last[5]).toBe(1);
        const ctl = controls();
        ctl.c.setProfile(radio());
        ctl.c.source = 'hid';
        ctl.c.mode = 'horizon';
        ctl.c.raw(frame({ ch6: -1 }));
        expect(ctl.s.last[5]).toBe(0);
        expect(ctl.c.radioDecides()).toBe(false);
    });

    it('a radio\'s report carries a new mode; nothing is re-sent for it (a silent radio must still go stale)', () => {
        const { c, s } = controls();
        c.setProfile(radio());
        c.source = 'hid';
        c.raw(frame());
        const n = s.sent.length;
        c.setMode('acro');
        expect(s.sent.length).toBe(n);
        c.raw(frame());
        expect(s.last[5]).toBe(-1);
    });
});

describe('Controls: the arm gate follows respawn.keepArmed (C.3)', () => {
    /** Arm the usual way, fly, crash, sit crashed, respawn: all with the switch left ON and the throttle at hover. */
    function crashAndRespawn(keep: boolean): { armedAfter: boolean; out4: number; block: string | null } {
        const { c, s } = controls();
        c.keepArmedAfterCrash = keep;
        c.setProfile(radio());
        c.source = 'hid';
        c.raw(frame({ arm: -1 }));
        c.raw(frame({ arm: 1 }));
        expect(c.gate.armed).toBe(true);
        c.raw(frame({ arm: 1, thr: 0 }));
        s.sim.crashed = true;
        for (let i = 0; i < 20; i++) c.raw(frame({ arm: 1, thr: 0 }));
        s.sim.crashed = false; // the respawn
        c.raw(frame({ arm: 1, thr: 0 }));
        return { armedAfter: c.gate.armed, out4: s.last[4], block: c.block };
    }

    it('on (the default): armed again at the respawn with no new flip', () => {
        expect(controls().c.keepArmedAfterCrash).toBe(true);
        expect(crashAndRespawn(true)).toEqual({ armedAfter: true, out4: 1, block: null });
    });

    it('control: off, the same pilot needs a new flip (the v0.2 rule)', () => {
        const r = crashAndRespawn(false);
        expect(r.armedAfter).toBe(false);
        expect(r.out4).toBe(-1);
        expect(r.block).toBe('throttle');
    });

    it('a change applies to the gate in use at once and survives a new profile (a new gate)', () => {
        const { c } = controls();
        c.keepArmedAfterCrash = false;
        expect(c.gate.keepArmedAfterCrash).toBe(false);
        c.setProfile(radio());
        expect(c.gate.keepArmedAfterCrash).toBe(false);
        c.keepArmedAfterCrash = true;
        expect(c.gate.keepArmedAfterCrash).toBe(true);
    });
});
