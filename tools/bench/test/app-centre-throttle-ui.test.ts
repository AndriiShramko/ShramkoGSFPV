// Lane center-throttle, stage 2 (docs/wip/center-throttle.md 2, the five places): the screens of the left stick's style.
//  - the arm card's offer (ui/arm-offer-logic.ts): shown after the throttle has rested in the centre for 3 s while the
//    gate waits for it in the from-zero style; not after 2.5 s, not while the stick moves, not at the bottom, not in the
//    centred style, not for another block; the controller's arm input (ch[4] changing) takes it while it is shown and
//    never when it is not (control: the same flip before 3 s does nothing);
//  - the HUD (ui/hud.ts) puts the offer on its arm card and calls the throttle host's `centred` on the arm input; in the
//    centred style acro shows the one line about the direct throttle, angle does not;
//  - the HUD chip (ui/mode-chip.ts) shows the style under the mode and its popover picks the other one;
//  - the summary panel's chip, the how-to-fly card's line, the Controls / check screen's two-way row (a press saves the
//    choice into the profile; a rest seen on the check screen is kept when the profile had none);
//  - every string of locales/fly/throttle in en, es, pl and ru, and every English line that says "arm" also says "motors"
//    (the owner's words: DJI pilots have never armed anything).
// The 3 s is an estimate (arm-offer-logic.ts OFFER_MS); the tolerances are the calibration wizard's TUNING.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Profile } from '../../../packages/input/src';
import { FakeStorage } from '../../../packages/prefs/test/helpers';
import { fakeDocument, FakeElement } from './helpers/fake-dom';

type OfferMod = typeof import('../../../apps/fly/src/ui/arm-offer-logic');
type HudMod = typeof import('../../../apps/fly/src/ui/hud');
type ChipMod = typeof import('../../../apps/fly/src/ui/mode-chip');
type SumMod = typeof import('../../../apps/fly/src/ui/summary');
type CardMod = typeof import('../../../apps/fly/src/ui/controls-card-logic');
type RowMod = typeof import('../../../apps/fly/src/ui/throttle-style-row');
type I18n = typeof import('../../../apps/fly/src/i18n');
let O: OfferMod, H: HudMod, MC: ChipMod, SM: SumMod, CL: CardMod, R: RowMod, I: I18n;
let clock = 0;

beforeAll(async () => {
    vi.stubGlobal('location', { search: '', pathname: '/en/fly/', href: 'http://127.0.0.1/en/fly/', origin: 'http://127.0.0.1' });
    vi.stubGlobal('document', fakeDocument());
    vi.stubGlobal('navigator', { languages: ['en'], language: 'en' });
    vi.stubGlobal('performance', { now: () => clock });
    vi.stubGlobal('innerWidth', 1600);
    vi.stubGlobal('innerHeight', 900);
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    vi.stubGlobal('localStorage', new FakeStorage());
    vi.stubGlobal('ResizeObserver', class { observe(): void { /* no layout */ } });
    vi.stubGlobal('MutationObserver', class { observe(): void { /* no layout */ } });
    vi.stubGlobal('requestAnimationFrame', () => 0);
    vi.stubGlobal('addEventListener', () => undefined);
    vi.stubGlobal('removeEventListener', () => undefined);
    O = await import('../../../apps/fly/src/ui/arm-offer-logic');
    H = await import('../../../apps/fly/src/ui/hud');
    MC = await import('../../../apps/fly/src/ui/mode-chip');
    SM = await import('../../../apps/fly/src/ui/summary');
    CL = await import('../../../apps/fly/src/ui/controls-card-logic');
    R = await import('../../../apps/fly/src/ui/throttle-style-row');
    I = await import('../../../apps/fly/src/i18n');
});
afterEach(() => vi.restoreAllMocks());

type Style = 'centred' | 'zero' | null;
/** Offer frames every 33 ms from `t0` to `t1` with the throttle at `thr` (a function of time) and the arm input `arm`. */
function run(o: InstanceType<OfferMod['ArmOffer']>, t0: number, t1: number, thr: (t: number) => number, style: Style = 'zero', block: 'throttle' | 'switch' | 'center' = 'throttle', arm = -1) {
    let last = { show: false, accept: false };
    for (let t = t0; t <= t1; t += 33) last = o.update({ style, block, throttle: thr(t), arm, now: t });
    return last;
}
const DJI_REST = 11 / 660; // the DJI's measured rest offset, known-devices.ts

describe('the arm card offers the centred style when the stick rests in the centre', () => {
    it('shows after 3 s at rest in the centre, not after 2.5 s', () => {
        const o = new O.ArmOffer();
        expect(run(o, 0, 2500, () => DJI_REST).show).toBe(false);
        expect(run(o, 2533, 3100, () => DJI_REST).show).toBe(true);
        expect(O.OFFER_MS).toBe(3000);
    });
    it('a moving stick, the bottom, the centred style or another block: no offer', () => {
        expect(run(new O.ArmOffer(), 0, 6000, (t) => 0.1 * Math.sin(t / 150)).show).toBe(false);
        expect(run(new O.ArmOffer(), 0, 6000, () => -0.5).show).toBe(false);
        expect(run(new O.ArmOffer(), 0, 6000, () => DJI_REST, 'centred').show).toBe(false);
        expect(run(new O.ArmOffer(), 0, 6000, () => DJI_REST, 'zero', 'switch').show).toBe(false);
        expect(run(new O.ArmOffer(), 0, 6000, () => DJI_REST, null).show).toBe(false);
    });
    it('the controller\'s arm input takes it while shown; control: the same flip before 3 s does nothing', () => {
        const o = new O.ArmOffer();
        run(o, 0, 3300, () => DJI_REST);
        expect(o.update({ style: 'zero', block: 'throttle', throttle: DJI_REST, arm: 1, now: 3333 })).toEqual({ show: false, accept: true });
        const c = new O.ArmOffer();
        run(c, 0, 1000, () => DJI_REST);
        expect(c.update({ style: 'zero', block: 'throttle', throttle: DJI_REST, arm: 1, now: 1033 }).accept).toBe(false);
    });
});

function fakeSession() {
    return {
        hud: () => ({ armed: false, crashed: false, throttlePct: 50, speed: 0, altitude: 0, timeS: 0, crashes: 0, volts: 16.8, roll: 0, pitch: 0 }),
        sim: { ch: new Float32Array(8) },
        walls: 'on',
        renderer: { latencyStats: () => ({ periodMs: 33.3, inputToScreenMs: 80 }) }
    };
}
const djiView = (arm = -1) => ({ ch: new Float32Array([0, 0, DJI_REST, 0, arm, 1, 0, 0]), armKind: 'toggle', armLabel: 'button 3', mode: 2, source: 'hid', easy: false, link: null, game: false });

describe('the HUD: the offer on the arm card, the arm input takes it, the acro line', () => {
    function hudWith(style: () => Style, acro = () => false) {
        const hud = new H.Hud();
        hud.mount(new FakeElement('div') as unknown as HTMLElement);
        const took: number[] = [];
        hud.throttle = { style, acro, centred: () => took.push(clock) };
        return { hud, took, root: hud.root as unknown as FakeElement };
    }
    const frames = (hud: InstanceType<HudMod['Hud']>, t0: number, t1: number, view = djiView(), block: 'throttle' | null = 'throttle') => {
        for (let t = t0; t <= t1; t += 33) { clock = t; hud.update(fakeSession() as never, block, { p50: 33, p99: 40 }, view as never); }
    };
    it('from zero with the stick in the centre: the offer after 3 s, with its button and the controller\'s button named', () => {
        const { hud, took, root } = hudWith(() => 'zero');
        frames(hud, 0, 2500);
        expect(root.querySelector('[data-testid="arm-offer"]')?.hidden).toBe(true);
        frames(hud, 2533, 3400);
        const offer = root.querySelector('[data-testid="arm-offer"]');
        expect(offer?.hidden).toBe(false);
        expect(offer?.textContent).toContain('Fly with the stick in the centre');
        expect(offer?.textContent).toContain('button 3');
        (root.querySelector('[data-action="throttle-centred"]') as FakeElement).click();
        expect(took.length).toBe(1);
        // the DJI start/stop button (a toggle: ch[4] flips) takes it too
        frames(hud, 3433, 3433, djiView(1));
        expect(took.length).toBe(2);
    });
    it('control: in the centred style there is no offer and the arm input takes nothing', () => {
        const { hud, took, root } = hudWith(() => 'centred');
        frames(hud, 0, 4000);
        frames(hud, 4033, 4033, djiView(1));
        expect(root.querySelector('[data-testid="arm-offer"]')?.hidden).toBe(true);
        expect(took.length).toBe(0);
        // the card has no arming steps in this style: its one line says how the motors start
        expect(root.querySelector('ol')?.hidden).toBe(true);
        expect(root.querySelector('.reason')?.textContent).toContain('no arming needed');
    });
    it('the centred style in acro: one line that the throttle is direct; angle: none', () => {
        let acro = true;
        const { hud, root } = hudWith(() => 'centred', () => acro);
        frames(hud, 0, 200, djiView(), null);
        const line = root.querySelector('[data-testid="acro-throttle"]');
        expect(line?.hidden).toBe(false);
        expect(line?.textContent).toContain('half power');
        acro = false;
        frames(hud, 300, 500, djiView(), null);
        expect(line?.hidden).toBe(true);
    });
});

describe('the HUD chip, the summary chip, the how-to-fly card', () => {
    it('the chip shows the style under the mode and its popover picks the other one', () => {
        let style: 'centred' | 'zero' = 'centred';
        const picked: string[] = [];
        const chip = new MC.ModeChip({
            current: () => 'angle', radio: () => null, pick: () => undefined, caps: [{ cap: 'M', aria: 'M' }] as never,
            throttle: { now: () => ({ style, pending: false }), pick: (s) => { picked.push(s); style = s; }, caps: [{ cap: 'J', aria: 'J' }] as never }
        });
        const el = chip.el as unknown as FakeElement;
        expect(el.querySelector('[data-testid="mode-chip-throttle"]')?.textContent).toBe('Stick in the centre');
        (el.querySelector('[data-action="throttle-zero"]') as FakeElement).click();
        expect(picked).toEqual(['zero']);
        expect(el.querySelector('[data-testid="mode-chip-throttle"]')?.textContent).toBe('From zero');
        expect(el.querySelector('[data-action="throttle-zero"]')?.getAttribute('aria-checked')).toBe('true');
    });
    it('control: with no radio or gamepad the chip has no style line', () => {
        const chip = new MC.ModeChip({ current: () => 'angle', radio: () => null, pick: () => undefined, caps: [] as never, throttle: { now: () => null, pick: () => undefined, caps: [] as never } });
        expect((chip.el as unknown as FakeElement).querySelector('[data-testid="mode-chip-throttle"]')?.hidden).toBe(true);
    });
    it('the summary panel says the style; none for touch and keyboard', () => {
        expect((SM.throttleChip('centred') as unknown as FakeElement).textContent).toBe('Left stick: Stick in the centre (camera drone)');
        expect(SM.throttleChip(null)).toBeNull();
    });
    it('the how-to-fly card: the centred style replaces the arm row with its own line and J', () => {
        const env = { t: I.t, caps: (a: string) => (a === 'throttle.style' ? ['J'] : ['X']), altitudeHelp: false, armKind: 'toggle' as const, armLabel: 'button 3' };
        const arm = (centred: boolean) => CL.cardModel('radio', { ...env, centred }).rows.find((r) => r.id === 'arm');
        expect(arm(true)?.text).toContain('no arming needed');
        expect(arm(true)?.caps).toEqual(['J']);
        expect(arm(false)?.text).not.toContain('no arming needed');
    });
});

describe('the Controls / check screen row', () => {
    const profile = (o: Partial<Profile> = {}): Profile => ({ version: 1, deviceKey: 'hid:test', deviceName: 'Test', ...o }) as unknown as Profile;
    it('says the detected style and a press saves the other into the profile', () => {
        const p = profile({ throttleRest: 'centre' });
        const row = R.throttleStyleRow(p, { save: false });
        const el = row.el as unknown as FakeElement;
        expect(el.getAttribute('data-style')).toBe('centred');
        expect(el.querySelector('[data-testid="throttle-style-title"]')?.textContent).toBe('Left stick: Stick in the centre (camera drone). Chosen automatically: your left stick rests in the centre.');
        (el.querySelector('[data-action="throttle-style-zero"]') as FakeElement).click();
        expect(p.throttleStyle).toBe('zero');
        expect(el.getAttribute('data-style')).toBe('zero');
        expect(el.querySelector('[data-testid="throttle-style-title"]')?.textContent).toContain('Your choice for this controller.');
    });
    it('the check screen keeps the rest it sees when the profile had none; control: a measured rest is kept', () => {
        const p = profile();
        const row = R.throttleStyleRow(p, { save: false, throttle: () => DJI_REST });
        for (clock = 0; clock <= 700; clock += 33) row.live();
        expect(p.throttleRest).toBe('centre');
        expect((row.el as unknown as FakeElement).getAttribute('data-style')).toBe('centred');
        const q = profile({ throttleRest: 'bottom' });
        const r2 = R.throttleStyleRow(q, { save: false, throttle: () => DJI_REST });
        for (clock = 1000; clock <= 1700; clock += 33) r2.live();
        expect(q.throttleRest).toBe('bottom');
    });
});

describe('the strings', () => {
    const dir = resolve(__dirname, '../../../packages/i18n/locales/fly/throttle');
    const read = (l: string): Record<string, string> => JSON.parse(readFileSync(resolve(dir, `${l}.json`), 'utf8'));
    it('every key in en, es, pl and ru, none empty', () => {
        const en = read('en');
        for (const l of ['es', 'pl', 'ru']) {
            const o = read(l);
            expect(Object.keys(o).sort()).toEqual(Object.keys(en).sort());
            for (const k of Object.keys(en)) expect(o[k].length, `${l} ${k}`).toBeGreaterThan(0);
        }
    });
    it('every English line that says "arm" also says what it means (the motors)', () => {
        const en = read('en');
        const bad = Object.entries(en).filter(([, v]) => /\barm(ing|ed)?\b/i.test(v) && !/motors/i.test(v)).map(([k]) => k);
        expect(bad).toEqual([]);
    });
});
