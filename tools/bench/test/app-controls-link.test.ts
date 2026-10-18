// How the device in use reaches the flight and F3 (v0.9 lane E, apps/fly/src/controls.ts useDevice,
// app/input.ts): a gamepad reads itself once more before each frame steps the physics (the session's
// beforeStep), the hook follows the scene to the next session and goes away with the input, and the
// F3 line gets the device's link meter only for a radio or gamepad. Negative controls: touch and
// keyboard have no meter and no hook; a session that is swapped away keeps no hook.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { LinkStats } from '../../../packages/input/src';

type AppControls = typeof import('../../../apps/fly/src/controls');
let C: AppControls;
const doc = { cookie: '', documentElement: { lang: '' }, visibilityState: 'visible' };

beforeAll(async () => {
    vi.stubGlobal('location', { search: '', pathname: '/fly/', href: 'http://127.0.0.1/fly/', origin: 'http://127.0.0.1' });
    vi.stubGlobal('document', doc);
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    C = await import('../../../apps/fly/src/controls');
});

afterEach(() => vi.restoreAllMocks());

class FakeSession {
    sim = { crashed: false };
    beforeStep: (() => void) | null = null;
    input(): void { /* not needed */ }
}

const STATS: LinkStats = { n: 100, hz: 50, meanMs: 20, jitterMs: 3.4, maxGapMs: 28, ageMs: 10, bunched: 0, verdict: 'slow' };

describe('Controls.useDevice', () => {
    it('a gamepad\'s read-before-the-frame is the session\'s beforeStep, and it follows a new scene', () => {
        const s1 = new FakeSession();
        const c = new C.Controls(s1 as never);
        let polls = 0;
        c.useDevice(() => { polls++; }, () => STATS);
        expect(s1.beforeStep).not.toBeNull();
        s1.beforeStep!();
        expect(polls).toBe(1);
        const s2 = new FakeSession();
        c.setSession(s2 as never); // the scene switch (flight.swapSession)
        s2.beforeStep!();
        expect(polls).toBe(2);
    });

    it('control: a new Controls, or an input with no device to read, leaves the session with no hook', () => {
        const s = new FakeSession();
        const c = new C.Controls(s as never);
        expect(s.beforeStep).toBeNull();
        c.useDevice(() => undefined, null);
        c.useDevice(null, null); // the keyboard or touch took over
        expect(s.beforeStep).toBeNull();
        const s2 = new FakeSession();
        c.setSession(s2 as never);
        expect(s2.beforeStep).toBeNull();
    });

    it('F3 gets the link meter for a radio or a gamepad only', () => {
        const c = new C.Controls(new FakeSession() as never);
        c.useDevice(null, () => STATS);
        for (const src of ['hid', 'gamepad'] as const) {
            c.source = src;
            expect(c.view().link?.(0)).toEqual(STATS);
        }
        for (const src of ['keyboard', 'touch', 'sim', null] as const) {
            c.source = src;
            expect(c.view().link, String(src)).toBeNull();
        }
    });

    it('control: a device with no meter gives F3 nothing, whatever the source', () => {
        const c = new C.Controls(new FakeSession() as never);
        c.useDevice(null, null);
        c.source = 'gamepad';
        expect(c.view().link).toBeNull();
    });
});
