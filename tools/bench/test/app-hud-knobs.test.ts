// The sticks on the flight view's arm card, and F3's line about the device's reports (v0.9 lane E review,
// apps/fly/src/ui/hud.ts). The real Hud class on a fake DOM (helpers/fake-dom.ts), a frame at a time on
// a clock the test owns.
//
// The finding: the card's knobs were drawn inside the HUD's 10 Hz text gate (`now - last < 100`), so the
// green stick on the disarmed flight view showed a move 59 ms after it reached the page on average, up to
// 135 ms, at the owner's 30 Hz screen (a draw in every frame: 17 ms, at most 35), a delay our code added
// on top of the link's (simulated in the lane note). The knobs are the pilot's own stick
// and are drawn every frame; the text (steps, throttle %, telemetry) stays at 10 Hz. Negative controls:
// the text is still gated, a hidden card draws nothing, and a stick that did not move draws nothing new.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { LinkStats } from '../../../packages/input/src';
import { fakeDocument, FakeElement } from './helpers/fake-dom';

type HudModule = typeof import('../../../apps/fly/src/ui/hud');
let H: HudModule;
let doc: ReturnType<typeof fakeDocument>;
let clock = 0;

beforeAll(async () => {
    doc = fakeDocument();
    vi.stubGlobal('location', { search: '', pathname: '/en/fly/', href: 'http://127.0.0.1/en/fly/', origin: 'http://127.0.0.1' });
    vi.stubGlobal('document', doc);
    vi.stubGlobal('navigator', { languages: ['en'], language: 'en' });
    vi.stubGlobal('performance', { now: () => clock });
    vi.stubGlobal('innerWidth', 1600);
    vi.stubGlobal('ResizeObserver', class { observe(): void { /* no layout */ } });
    vi.stubGlobal('MutationObserver', class { observe(): void { /* no layout */ } });
    vi.stubGlobal('requestAnimationFrame', () => 0);
    vi.stubGlobal('addEventListener', () => undefined);
    H = await import('../../../apps/fly/src/ui/hud');
});

afterEach(() => vi.restoreAllMocks());

/** The flight session as far as Hud.update reads it. */
function fakeSession(o: { armed?: boolean; crashed?: boolean } = {}) {
    return {
        hud: () => ({ armed: !!o.armed, crashed: !!o.crashed, throttlePct: 0, speed: 0, altitude: 0, timeS: 0, crashes: 0, volts: 16.8, roll: 0, pitch: 0 }),
        sim: { ch: new Float32Array(8) },
        walls: 'on',
        renderer: { latencyStats: () => ({ periodMs: 33.3, inputToScreenMs: 80 }) }
    };
}

type View = {
    ch: Float32Array; armKind: 'axis'; armLabel: string; mode: 1 | 2; source: 'gamepad' | 'hid' | 'keyboard'; easy: boolean;
    link: ((now: number) => LinkStats) | null;
};
const newView = (): View => ({ ch: new Float32Array([0, 0, -1, 0, -1, -1, 0, 0]), armKind: 'axis', armLabel: 'CH5', mode: 2, source: 'gamepad', easy: false, link: null });

/** A HUD on the page. */
function mounted() {
    const hud = new H.Hud();
    const ui = new FakeElement('div');
    hud.mount(ui as unknown as HTMLElement);
    return { hud, ui };
}

/** One display frame at page time `t`. */
function frame(hud: InstanceType<HudModule['Hud']>, t: number, view: View, session = fakeSession(), block: 'center' | 'throttle' | 'switch' | null = 'switch'): void {
    clock = t;
    hud.update(session as never, block, { p50: 33.3, p99: 40 }, view as never);
}

/** Where the right-hand well's knob is drawn: the `transform` of its `.rb-kg`, the second well. */
const rightKnob = (hud: InstanceType<HudModule['Hud']>): string | null => {
    const kgs = (hud.root as unknown as FakeElement).querySelectorAll('.rb-kg');
    return kgs[1]?.getAttribute('transform') ?? null;
};
const leftKnob = (hud: InstanceType<HudModule['Hud']>): string | null => {
    const kgs = (hud.root as unknown as FakeElement).querySelectorAll('.rb-kg');
    return kgs[0]?.getAttribute('transform') ?? null;
};
const cardRows = (hud: InstanceType<HudModule['Hud']>): string[] => (hud.root as unknown as FakeElement).querySelectorAll('ol').flatMap((ol) => ol.children.map((li) => li.textContent));
const cardHidden = (hud: InstanceType<HudModule['Hud']>): boolean => !!(hud.root as unknown as FakeElement).querySelector('.arm-card')?.classList.contains('hidden');

describe('the arm card\'s knobs are the pilot\'s stick: drawn every frame, not at the text\'s 10 Hz', () => {
    it('a stick moved between two text updates is drawn on the very next frame', () => {
        const { hud } = mounted();
        const view = newView();
        const s = fakeSession();
        frame(hud, 1000, view, s); // the text gate opens: the card is drawn
        expect(cardHidden(hud)).toBe(false);
        expect(rightKnob(hud)).toBe('translate(0.0 0.0)');
        view.ch[0] = 0.5; // roll: the right well, x; 0.5 of a 46-unit travel
        frame(hud, 1033, view, s); // 33 ms later (a 30 Hz frame): still inside the gate's 100 ms
        expect(rightKnob(hud)).toBe('translate(23.0 0.0)');
        view.ch[1] = -1; // pitch: the right well, y (down)
        frame(hud, 1066, view, s);
        expect(rightKnob(hud)).toBe('translate(23.0 46.0)');
        view.ch[3] = -0.25; // yaw: the left well, x
        frame(hud, 1099, view, s);
        expect(leftKnob(hud)).toBe('translate(-11.5 46.0)'); // throttle -1 is the bottom of the left well
    });

    it('every frame of a sweep at 30 Hz shows the stick where it is, 0 ms behind (the 10 Hz gate was 0 to 100 ms behind)', () => {
        const { hud } = mounted();
        const view = newView();
        const s = fakeSession();
        frame(hud, 1000, view, s);
        let behind = 0;
        for (let i = 1; i <= 60; i++) {
            const t = 1000 + i * 33.3;
            view.ch[0] = Math.sin(i * 0.4);
            frame(hud, t, view, s);
            const want = `translate(${(view.ch[0] * 46).toFixed(1)} 0.0)`;
            if (rightKnob(hud) !== want) behind++;
        }
        expect(behind).toBe(0);
    });

    it('control: the text of the card is still the 10 Hz one (the throttle % moves at the next text update only)', () => {
        const { hud } = mounted();
        const view = newView();
        const s = fakeSession();
        frame(hud, 1000, view, s);
        const before = cardRows(hud).find((r) => /\d+ ?%/.test(r));
        view.ch[2] = 0; // throttle half
        frame(hud, 1033, view, s);
        expect(cardRows(hud).find((r) => /\d+ ?%/.test(r))).toBe(before); // text: not yet
        frame(hud, 1100, view, s); // the gate opens
        expect(cardRows(hud).find((r) => /\d+ ?%/.test(r))).not.toBe(before);
        expect(cardRows(hud).find((r) => /\d+ ?%/.test(r))).toMatch(/50/);
    });

    it('control: a card that is not up draws nothing (armed and flying, or on the keyboard)', () => {
        const { hud } = mounted();
        const view = newView();
        const flying = fakeSession({ armed: true });
        frame(hud, 1000, view, flying);
        expect(cardHidden(hud)).toBe(true);
        const was = rightKnob(hud);
        view.ch[0] = 0.8;
        frame(hud, 1033, view, flying);
        expect(rightKnob(hud)).toBe(was); // nothing drawn while flying

        const kbd = newView();
        kbd.source = 'keyboard';
        const { hud: h2 } = mounted();
        frame(h2, 1000, kbd);
        kbd.ch[0] = 0.8;
        frame(h2, 1033, kbd);
        expect(rightKnob(h2)).toBeNull(); // the keyboard has no radio drawing: nothing was ever painted
    });

    it('control: a card that goes away at the next text update stops following the stick', () => {
        const { hud } = mounted();
        const view = newView();
        frame(hud, 1000, view);
        view.ch[0] = 0.5;
        frame(hud, 1033, view);
        expect(rightKnob(hud)).toBe('translate(23.0 0.0)');
        frame(hud, 1100, view, fakeSession({ armed: true })); // armed: the card hides
        expect(cardHidden(hud)).toBe(true);
        view.ch[0] = -0.5;
        frame(hud, 1133, view, fakeSession({ armed: true }));
        expect(rightKnob(hud)).toBe('translate(23.0 0.0)');
    });

    it('control: a card that shows only a reason (no signal) has no drawing, and the knobs are not painted', () => {
        const { hud } = mounted();
        const view = newView();
        frame(hud, 1000, view, fakeSession(), 'switch');
        expect(rightKnob(hud)).toBe('translate(0.0 0.0)');
        // the radio went quiet: the text gate opens with block 'stale' (a reason, no steps, no drawing)
        frame(hud, 1100, view, fakeSession(), 'stale' as never);
        view.ch[0] = 0.9;
        frame(hud, 1133, view, fakeSession(), 'stale' as never);
        expect(rightKnob(hud)).toBe('translate(0.0 0.0)');
        // and back: the drawing is painted again, then every frame
        frame(hud, 1200, view, fakeSession(), 'switch');
        expect(rightKnob(hud)).toBe('translate(41.4 0.0)');
        view.ch[0] = -0.9;
        frame(hud, 1233, view, fakeSession(), 'switch');
        expect(rightKnob(hud)).toBe('translate(-41.4 0.0)');
    });
});

describe('F3\'s line about the device\'s reports', () => {
    const STATS = (verdict: LinkStats['verdict'], meanMs: number): LinkStats => ({ n: 100, hz: 1000 / meanMs, meanMs, jitterMs: 1.7, maxGapMs: meanMs * 1.5, ageMs: meanMs / 2, bunched: 0, verdict });
    const shown = (hud: InstanceType<HudModule['Hud']>, id: string): { shown: boolean; text: string } => {
        const el = (hud.root as unknown as FakeElement).querySelector(`[data-testid=${id}]`);
        return { shown: !!el && !el.hidden, text: el?.textContent ?? '' };
    };

    it('F3 on, a slow link: the numbers and the note; a fast one: the numbers only; no meter: nothing', () => {
        const { hud } = mounted();
        hud.toggleFrameStats();
        const view = newView();
        view.link = () => STATS('slow', 33);
        frame(hud, 1000, view);
        expect(shown(hud, 'input-line').shown).toBe(true);
        expect(shown(hud, 'input-line').text).toMatch(/every 33 ms/);
        expect(shown(hud, 'link-hint').shown).toBe(true);
        expect(shown(hud, 'link-hint').text).toMatch(/33/);

        view.link = () => STATS('ok', 1);
        frame(hud, 1300, view); // the line is rewritten four times a second
        expect(shown(hud, 'input-line').text).toMatch(/every 1\.0 ms/);
        expect(shown(hud, 'link-hint').shown).toBe(false);

        view.link = null;
        frame(hud, 1600, view);
        expect(shown(hud, 'input-line').shown).toBe(false);
        expect(shown(hud, 'link-hint').shown).toBe(false);
    });

    it('control: F3 off, the meter is not even asked', () => {
        const { hud } = mounted();
        const view = newView();
        let asked = 0;
        view.link = () => { asked++; return STATS('slow', 33); };
        frame(hud, 1000, view);
        frame(hud, 1300, view);
        expect(asked).toBe(0);
        expect(shown(hud, 'input-line').shown).toBe(false);
    });
});
