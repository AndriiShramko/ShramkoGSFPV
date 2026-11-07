// Review of lane v12-flight, D1 (docs/wip/v12-flight-review.md): the input Fly by Sound flies when no radio is found, and what the
// page remembers of it. In the plain simulator a pilot with no radio found sees the Controls screen, and closing it flies the
// keyboard as a STAND-IN that is not remembered (InputHost.openRadio's onClose: use(c, false)), so the radio of last time is looked
// for again next time. Fly by Sound skips that screen (a sight-first wizard) and flew the keyboard through the ordinary path, which
// REMEMBERS it: radioProfiles.last became { kind: 'keyboard' } and the radio was never looked for again, in Fly by Sound or in the
// plain simulator, until the pilot opened Controls and picked it by hand.
// The app modules read location, document and matchMedia when they load, so those are stubbed first (as app-known-controller).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkStore } from '../../../packages/prefs/test/helpers';
import type { Profile } from '../../../packages/input/src/calib';

type AppControls = typeof import('../../../apps/fly/src/controls');
let C: AppControls;
const doc = { cookie: '', documentElement: { lang: '' }, visibilityState: 'visible' };

beforeAll(async () => {
    vi.stubGlobal('location', { search: '', pathname: '/fly/', href: 'http://127.0.0.1/fly/', origin: 'http://127.0.0.1' });
    vi.stubGlobal('document', doc);
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    C = await import('../../../apps/fly/src/controls');
});

afterAll(() => {
    vi.unstubAllGlobals();
});

class FakeSession {
    sim = { crashed: false };
    input(): void {
        /* no flight here */
    }
}

/** The radio of last time, as the page saved it (the shape app-modes.test.ts uses). */
const TX16S = {
    version: 1, deviceKey: 'hid:1209:4f54:Radiomaster TX16S Joystick:19', deviceName: 'Radiomaster TX16S Joystick', deadband: 0, created: '2026-09-26T19:44:02.118Z', mode: 2, wizard: 2,
    axes: { roll: { index: 0, invert: false, center: 0.004, min: -0.999, max: 0.999 }, pitch: { index: 1, invert: false, center: -0.002, min: -0.999, max: 0.999 }, throttle: { index: 2, invert: false, center: -0.999, min: -0.999, max: 0.999 }, yaw: { index: 3, invert: false, center: 0.001, min: -0.999, max: 0.999 } },
    arm: { kind: 'axis', index: 4, threshold: 0.4985, onAbove: true, off: -0.999, on: 0.999 }, angleMode: null
};
const LAST_RADIO = { kind: 'hid' as const, key: TX16S.deviceKey };

/** The page's store with the radio as the last input, and the input host its flight makes (what the Controls screen and the note do are recorded). */
async function page(last: typeof LAST_RADIO | null = LAST_RADIO) {
    const store = mkStore();
    if (last) store.updateCollection('radioProfiles', (d) => { d.last = last; });
    C.useStore(() => store);
    // KeyboardSource (made by InputHost) listens on the window and the document, and samples on a timer
    vi.stubGlobal('addEventListener', () => undefined);
    vi.stubGlobal('window', { setInterval: () => 0, clearInterval: () => undefined, setTimeout: () => 0, clearTimeout: () => undefined });
    vi.stubGlobal('document', { ...doc, addEventListener: () => undefined, querySelector: () => null });
    try {
        const { InputHost } = await import('../../../apps/fly/src/app/input');
        const c = new C.Controls(new FakeSession() as never);
        const host = new InputHost({ controls: c } as never);
        const opened: boolean[] = [];
        let noted = 0;
        host.openRadio = (first = false) => {
            opened.push(first);
        };
        host.note = () => {
            noted++;
        };
        return { host, c, opened, noted: () => noted };
    } finally {
        vi.stubGlobal('document', doc);
    }
}

describe('review D1: the keyboard Fly by Sound flies when no radio is found is a stand-in, not the pilot\'s choice', () => {
    it('no radio found: the keyboard flies at once with its note and no Controls screen, and the radio of last time is still the one looked for', async () => {
        const { host, c, opened, noted } = await page();
        await host.start(Promise.resolve(null), { kind: 'keyboard', profile: null });
        expect(c.source).toBe('keyboard');
        expect(opened).toEqual([]);
        expect(noted()).toBe(1);
        expect(C.loadLastInput()).toEqual(LAST_RADIO);
    });

    it('control: a radio that is found flies, is noted, and is remembered as before', async () => {
        const { host, c, opened, noted } = await page({ kind: 'keyboard' } as never);
        const profile = C.parseProfile(JSON.stringify(TX16S)) as Profile;
        const hid = { onFrame: null as unknown, close: () => undefined };
        await host.start(Promise.resolve({ kind: 'hid', profile, hid: hid as never }), { kind: 'keyboard', profile: null });
        expect(c.source).toBe('hid');
        expect(opened).toEqual([]);
        expect(noted()).toBe(1);
        expect(C.loadLastInput()).toEqual(LAST_RADIO);
    });

    it('control: the plain simulator with nothing found opens the Controls screen, and the radio of last time is kept', async () => {
        const { host, opened, noted } = await page();
        await host.start(Promise.resolve(null));
        expect(opened).toEqual([true]);
        expect(noted()).toBe(0);
        expect(C.loadLastInput()).toEqual(LAST_RADIO);
    });

    it('control (the mechanism, what fly() did before the fix): a keyboard handed to start() as the input found is remembered in place of the radio', async () => {
        const { host } = await page();
        await host.start(Promise.resolve({ kind: 'keyboard', profile: null }));
        expect(C.loadLastInput()).toEqual({ kind: 'keyboard' });
    });

    it('control: the keyboard the pilot picks on the Controls screen is his choice and is remembered', async () => {
        const { host } = await page();
        host.use({ kind: 'keyboard', profile: null });
        expect(C.loadLastInput()).toEqual({ kind: 'keyboard' });
    });
});
