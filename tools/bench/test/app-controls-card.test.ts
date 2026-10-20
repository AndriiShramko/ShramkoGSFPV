// v0.10 lane K (docs/wip/v10-k.md): the "How to fly" card's pure parts. A negative control here runs the SHIPPED function with a fault
// put into its input (a moved layout, a keymap that moved K, a quiet time of 0); no control re-implements the logic it judges (the
// review found four that did, and they are gone). A fault in the code itself is the browser bench's job (accept-v10-keys, base build).
//  - which card an input gets; the caps come from the tables the keyboard flies with and from the keymap (a layout that moves
//    moves the card: the game card's hero, rows and note are driven through cardModel itself);
//  - the card carries the vertical pair (Space up, Shift down) for the game scheme and says what each input needs;
//  - every text the card uses exists in the four languages with the same placeholders;
//  - when the card opens by itself: once per visit, after the scan is ready and an input is chosen, never over another screen,
//    only after a quiet time (the control is a quiet time of 0: it opens at once);
//  - the take-off line on the ground is drawn for the game scheme and only spoken where a card already writes it (gateSpoken);
//  - the radio card's arm line follows the profile: no channel number is invented, a button is pressed, not flipped;
//  - the first-seconds reminder: starts at the first flight, lasts REMIND_MS, goes when Space or Shift is used, never comes back.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { REPO } from '../../../packages/prefs/test/helpers';
import { KEYMAP, keysFor } from '../../../packages/prefs/src';
import type { PlayProfile } from '../../../apps/fly/src/play/keys';
import { GAME_KEYS, MODE2_KEYS } from '../../../apps/fly/src/play/keys';
import type { KeyBind, GameAxis } from '../../../apps/fly/src/play/keys';
import { REMIND_MS, SETTLE_MS, FirstFlightReminder, Settle, cardKind, cardModel, gameCaps, gateSpoken, pilotCaps, radioArmText, shouldOpen } from '../../../apps/fly/src/ui/controls-card-logic';
import type { CardEnv, CardKind, InputSource, OpenInput } from '../../../apps/fly/src/ui/controls-card-logic';

const FLY = join(REPO, 'packages', 'i18n', 'locales', 'fly');
const LANGS = ['en', 'es', 'pl', 'ru'] as const;
/** The dictionary of a language as the page merges it (the flat file plus every namespace folder). */
function dict(lang: string): Record<string, string> {
    const d = JSON.parse(readFileSync(join(FLY, `${lang}.json`), 'utf8')) as Record<string, string>;
    for (const ns of readdirSync(FLY)) if (!ns.endsWith('.json')) Object.assign(d, JSON.parse(readFileSync(join(FLY, ns, `${lang}.json`), 'utf8')));
    return d;
}
const DICTS = Object.fromEntries(LANGS.map((l) => [l, dict(l)])) as Record<(typeof LANGS)[number], Record<string, string>>;

/** A t() over one language that throws on a missing key, so a text the card forgot to ship fails here. */
function strictT(lang: (typeof LANGS)[number]): CardEnv['t'] {
    return (key, params) => {
        const v = DICTS[lang][key];
        if (v === undefined) throw new Error(`missing text ${key} (${lang})`);
        return v.replace(/\{(\w+)\}/g, (_m, k: string) => String(params?.[k] ?? `{${k}}`));
    };
}
/** The router's caps as text, over the shipped keymap. */
const caps = (action: string): string[] => keysFor(action).map((k) => k.cap);
const env = (lang: (typeof LANGS)[number] = 'en', o: Partial<CardEnv> = {}): CardEnv => ({ t: strictT(lang), caps, altitudeHelp: true, armKind: 'axis', armLabel: 'CH5', ...o });
const KINDS: CardKind[] = ['game', 'pilot', 'touch', 'radio'];

describe('which card an input gets', () => {
    it('keyboard: the game scheme on easy play, the pilot keys on pilot; touch; a radio or a gamepad; none before a choice and none for the test pilot', () => {
        const table: [InputSource, PlayProfile, CardKind | null][] = [
            ['keyboard', 'easy', 'game'], ['keyboard', 'pilot', 'pilot'], ['touch', 'easy', 'touch'], ['touch', 'pilot', 'touch'],
            ['hid', 'easy', 'radio'], ['gamepad', 'pilot', 'radio'], [null, 'easy', null], ['sim', 'easy', null]
        ];
        for (const [source, play, want] of table) expect(cardKind(source, play), `${source} / ${play}`).toBe(want);
    });
});

describe('the caps are the tables the keyboard flies with, not a list of the card\'s own', () => {
    it('the game card names Space up, Shift down, W A S D and the turn keys as GAME_KEYS has them', () => {
        const g = gameCaps(GAME_KEYS, 'Space');
        expect(g.up).toEqual(['Space']);
        expect(g.down).toEqual(['Shift']);
        expect(g.wasd).toEqual(['W', 'A', 'S', 'D']);
        expect(g.turn).toEqual(['←', '→', 'Q', 'E']);
    });

    it('a changed layout changes the card: the shipped cardModel follows a moved Space and Shift (control: a typed-in card would keep saying Space and Shift)', () => {
        const moved: KeyBind<GameAxis>[] = GAME_KEYS.map((k) => (k.code === 'Space' ? { ...k, code: 'KeyZ' } : k.code === 'ShiftLeft' ? { ...k, code: 'KeyX' } : k));
        const g = gameCaps(moved, 'Space');
        expect(g.up).toEqual(['Z']);
        expect(g.down).toEqual(['X', 'Shift']);
        const m = cardModel('game', env('en', { gameKeys: moved }));
        expect(m.hero!.up.caps).toEqual(['Z']);
        expect(m.hero!.down.caps).toEqual(['X', 'Shift']);
        // the way off the ground in the note moves with it
        expect(m.note).toMatch(/\bZ\b/);
        expect(m.note).not.toMatch(/Space/);
        // and the shipped tables give the shipped card
        expect(cardModel('game', env()).hero!.up.caps).toEqual(['Space']);
    });

    it('the pilot card follows a moved Mode 2 layout the same way', () => {
        const moved: KeyBind[] = MODE2_KEYS.map((k) => (k.code === 'KeyW' ? { ...k, code: 'KeyI' } : k));
        const throttle = (m: ReturnType<typeof cardModel>): string[] => m.rows.find((r) => r.id === 'throttle')!.caps;
        expect(throttle(cardModel('pilot', env('en', { pilotKeys: moved })))).toEqual(['I', 'S']);
        expect(throttle(cardModel('pilot', env()))).toEqual(['W', 'S']);
    });

    it('the pilot card names Mode 2 as MODE2_KEYS has it', () => {
        const p = pilotCaps(MODE2_KEYS, 'Space');
        expect(p.throttle).toEqual(['W', 'S']);
        expect(p.yaw).toEqual(['A', 'D']);
        expect(p.sticks).toEqual(['↑', '↓', '←', '→']);
    });

    it('F, Esc, N, R, K come from the keymap: the card shows what keysFor says', () => {
        const m = cardModel('game', env());
        const cap = (id: string): string[] => m.rows.find((r) => r.id === id)!.caps;
        expect(cap('fullscreen')).toEqual(keysFor('fullscreen.toggle').map((k) => k.cap));
        expect(cap('pause')).toEqual(keysFor('pause.toggle').map((k) => k.cap).slice(0, 1));
        expect(cap('next')).toEqual(keysFor('scene.next').map((k) => k.cap));
        expect(cap('respawn')).toEqual(keysFor('respawn.start').map((k) => k.cap));
        expect(cap('again')).toEqual(keysFor('help.keys').map((k) => k.cap));
        // and a keymap that moved K would move the card (control): the caps are asked of the router, not typed
        const moved = cardModel('game', env('en', { caps: (a) => (a === 'help.keys' ? ['J'] : caps(a)) }));
        expect(moved.rows.find((r) => r.id === 'again')!.caps).toEqual(['J']);
    });

    it('Space is the page\'s own word where the page gives one (a localised cap)', () => {
        const ru = cardModel('game', env('ru'));
        expect(ru.hero!.up.caps).toEqual([DICTS.ru['arm.keys.space']]);
        expect(ru.hero!.up.caps).not.toEqual(['Space']);
        expect(cardModel('pilot', env('pl')).rows.find((r) => r.id === 'arm')!.caps).toEqual([DICTS.pl['arm.keys.space']]);
    });
});

describe('what each card says', () => {
    it('the game card leads with the vertical pair: Space up, Shift down, hold to land, then the mouse, W A S D, F, Esc, N, R, K', () => {
        const m = cardModel('game', env());
        expect(m.hero).not.toBeNull();
        expect(m.hero!.up.caps).toEqual(['Space']);
        expect(m.hero!.up.word).toBe('Up');
        expect(m.hero!.down.caps).toEqual(['Shift']);
        expect(m.hero!.down.word).toBe('Down');
        expect(m.hero!.down.sub).toMatch(/land/);
        expect(m.rows.map((r) => r.id)).toEqual(['mouse', 'move', 'turn', 'fullscreen', 'pause', 'respawn', 'next', 'again']);
        expect(m.note).toMatch(/capture the mouse/);
    });

    it('the game card also names the way off the ground, W or Space, in every language (a pilot who closes it unread has the ground line)', () => {
        for (const lang of LANGS) {
            const note = cardModel('game', env(lang)).note!;
            expect(note, lang).toContain('W');
            expect(note, lang).toContain(DICTS[lang]['arm.keys.space']);
            expect(note, lang).not.toMatch(/\{\w+\}/);
            // the text carries both holes, or the caps passed in would never reach the pilot
            expect(DICTS[lang]['play.card.click'], lang).toContain('{fwd}');
            expect(DICTS[lang]['play.card.click'], lang).toContain('{up}');
        }
    });

    it('the pilot card has Space arm and no pair', () => {
        const m = cardModel('pilot', env());
        expect(m.hero).toBeNull();
        expect(m.rows[0]).toMatchObject({ id: 'arm', caps: ['Space'] });
        expect(m.rows.map((r) => r.id)).toEqual(['arm', 'throttle', 'yaw', 'sticks', 'mode', 'respawn', 'pause', 'next', 'again']);
    });

    it('the touch card draws two pads and says what the left one does by the altitude help', () => {
        const climb = cardModel('touch', env('en', { altitudeHelp: true }));
        const thr = cardModel('touch', env('en', { altitudeHelp: false }));
        expect(climb.pads?.leftText).toBe(DICTS.en['play.card.padLeftClimb']);
        expect(thr.pads?.leftText).toBe(DICTS.en['play.card.padLeftThrottle']);
        expect(climb.pads?.leftText).not.toBe(thr.pads?.leftText);
        expect(climb.rows).toEqual([]);
        expect(climb.note).toBe(DICTS.en['play.gate.touch']);
    });

    it('the radio card names the arm switch, or Space / ARM for a radio without one', () => {
        const sw = cardModel('radio', env('en', { armKind: 'axis', armLabel: 'CH6' }));
        const key = cardModel('radio', env('en', { armKind: 'key', armLabel: 'Space' }));
        expect(sw.rows.find((r) => r.id === 'arm')!.text).toMatch(/CH6/);
        expect(key.rows.find((r) => r.id === 'arm')!.text).toMatch(/Space/);
        expect(sw.rows.find((r) => r.id === 'arm')!.text).not.toBe(key.rows.find((r) => r.id === 'arm')!.text);
        expect(sw.rows.map((r) => r.id)).toEqual(['sticks', 'arm', 'mode', 'pause', 'next', 'again']);
        expect(sw.rows[0].tag).toBe('Sticks');
    });

    it('the radio card\'s arm line follows the profile: a channel only when the profile names one, a button is pressed, nothing set up has no number', () => {
        const arm = (armKind: CardEnv['armKind'], armLabel: string, lang: (typeof LANGS)[number] = 'en'): string => cardModel('radio', env(lang, { armKind, armLabel })).rows.find((r) => r.id === 'arm')!.text;
        expect(arm('axis', 'CH6')).toMatch(/CH6/);
        expect(arm('axis', 'CH6')).toMatch(/flip/);
        // a button or a toggle: pressed, named as the profile names it, never "flip the switch"
        for (const kind of ['button', 'toggle'] as const) {
            expect(arm(kind, 'button 3')).toMatch(/button 3/);
            expect(arm(kind, 'button 3')).toMatch(/press/);
            expect(arm(kind, 'button 3')).not.toMatch(/flip/);
            expect(arm(kind, 'Start/stop button')).toMatch(/Start\/stop button/);
        }
        // nothing set up (the Controls screen has no arm yet): no channel number out of thin air, and no half-sentence
        for (const lang of LANGS) {
            for (const none of [arm(null, '', lang), arm('axis', '', lang), arm('button', '', lang)]) {
                expect(none, lang).not.toMatch(/\d/);
                expect(none, lang).not.toMatch(/\{\w+\}/);
                expect(none, lang).toBe(DICTS[lang]['play.card.radioArmAny']);
            }
        }
        expect(arm('key', 'Space / ARM button')).toBe(DICTS.en['play.card.radioArmKey']);
        // the four cases read differently from each other, so one that fell through to another would show
        expect(new Set([arm('axis', 'CH6'), arm('button', 'button 3'), arm('key', ''), arm(null, '')]).size).toBe(4);
        // the helper on its own, on the shipped texts
        expect(radioArmText({ t: strictT('pl'), armKind: 'toggle', armLabel: 'przycisk 2' })).toBe(DICTS.pl['play.card.radioArmButton'].replace('{src}', 'przycisk 2'));
    });

    it('every text of every card exists in all four languages, and a card is never built from a missing one', () => {
        for (const lang of LANGS) {
            for (const kind of KINDS) {
                const m = cardModel(kind, env(lang));
                expect(m.title.length, `${kind} ${lang} title`).toBeGreaterThan(0);
                const texts = [m.sub, m.note ?? '', m.foot ?? '', ...m.rows.map((r) => r.text), ...(m.hero ? [m.hero.up.word, m.hero.up.sub, m.hero.down.word, m.hero.down.sub] : []), ...(m.pads ? [m.pads.left, m.pads.leftText, m.pads.right, m.pads.rightText] : [])];
                for (const x of texts) expect(x, `${kind} ${lang}`).not.toMatch(/\{\w+\}/); // no placeholder left open
            }
            for (const armKind of [null, 'axis', 'button', 'toggle', 'key'] as const) {
                for (const x of cardModel('radio', env(lang, { armKind, armLabel: armKind ? 'CH6' : '' })).rows.map((r) => r.text)) expect(x, `radio ${armKind} ${lang}`).not.toMatch(/\{\w+\}/);
            }
        }
        // the harness itself: a text that is not in a language fails the strict t(), so a forgotten key cannot pass the loops above
        expect(() => strictT('pl')('play.card.nonexistent')).toThrow(/missing text/);
    });

    it('the four languages carry the same keys and the same placeholders for everything the card adds', () => {
        const keys = Object.keys(DICTS.en).filter((k) => k.startsWith('play.card.') || k.startsWith('play.reminder.') || k === 'set.input.howToFly' || k === 'set.input.howToFly.help' || k === 'pause.howToFly');
        expect(keys.length).toBeGreaterThan(25);
        const holes = (s: string): string => (s.match(/\{\w+\}/g) ?? []).sort().join(',');
        for (const lang of ['es', 'pl', 'ru'] as const) for (const k of keys) {
            expect(DICTS[lang][k], `${k} (${lang})`).toBeTypeOf('string');
            expect(holes(DICTS[lang][k]), `${k} (${lang}) placeholders`).toBe(holes(DICTS.en[k]));
        }
        // the words of the pair are the ones the owner asked for, in every language the page speaks
        for (const lang of LANGS) {
            const m = cardModel('game', env(lang));
            expect(m.hero!.up.word.toLowerCase()).not.toBe(m.hero!.down.word.toLowerCase());
        }
    });
});

describe('every literal text the files of this lane name exists in all four languages', () => {
    it('t() keys of the card, its logic, the feature and play.ts', () => {
        const SRC = ['ui/controls-card.ts', 'ui/controls-card-logic.ts', 'app/builtin/how-to-fly.ts', 'app/builtin/play.ts', 'ui/hud.ts'];
        const names = new Set<string>();
        for (const f of SRC) for (const m of readFileSync(join(REPO, 'apps', 'fly', 'src', f), 'utf8').matchAll(/\bt\(\s*'([a-zA-Z0-9_.]+)'/g)) names.add(m[1]);
        // the dynamic one: the line under the title, one per kind
        for (const k of KINDS) names.add(`play.card.sub.${k}`);
        // the radio arm line picks its text by the profile; every one it can pick ships
        for (const k of ['radioArmSwitch', 'radioArmButton', 'radioArmAny', 'radioArmKey']) names.add(`play.card.${k}`);
        expect(names.size).toBeGreaterThan(20);
        for (const lang of LANGS) expect([...names].filter((k) => !DICTS[lang][k]), lang).toEqual([]);
        // control: the key the first version of the pause item had in mind does not exist
        expect(DICTS.en['pause.howtofly']).toBeUndefined();
        expect(DICTS.en['pause.howToFly']).toBe('How to fly');
    });
});

describe('when the card opens by itself', () => {
    const ready: OpenInput = { enabled: true, testPage: false, shown: false, source: 'keyboard', play: 'easy', blocked: false, hidden: false };

    it('once per visit, when an input is chosen and nothing else is up', () => {
        expect(shouldOpen(ready)).toBe(true);
        expect(shouldOpen({ ...ready, shown: true }), 'already shown in this visit').toBe(false);
        expect(shouldOpen({ ...ready, enabled: false }), '"Do not show again" ticked').toBe(false);
        expect(shouldOpen({ ...ready, testPage: true }), 'a test page').toBe(false);
        expect(shouldOpen({ ...ready, source: null }), 'no input chosen yet (the Controls dialog is up)').toBe(false);
        expect(shouldOpen({ ...ready, source: 'sim' }), 'the test pilot').toBe(false);
        expect(shouldOpen({ ...ready, hidden: true }), 'a background tab').toBe(false);
        for (const source of ['touch', 'hid', 'gamepad'] as const) expect(shouldOpen({ ...ready, source }), source).toBe(true);
    });

    it('never over another screen: the Controls dialog, a panel, the menu, the motion notice (blocked is the page\'s word for all of them)', () => {
        // blocked decides alone: every input that opens when the page is free stays shut when it is not
        for (const source of ['keyboard', 'touch', 'hid', 'gamepad'] as const) {
            expect(shouldOpen({ ...ready, source }), `${source} free`).toBe(true);
            expect(shouldOpen({ ...ready, source, blocked: true }), `${source} blocked`).toBe(false);
        }
    });

    it('after a quiet time: a blip of another screen restarts it (control: no settling opens between two screens)', () => {
        const s = new Settle();
        expect(s.free(0, true)).toBe(false);
        expect(s.free(SETTLE_MS - 1, true)).toBe(false);
        expect(s.free(SETTLE_MS, true)).toBe(true);
        // another screen opens for a moment: the clock starts again
        expect(s.free(SETTLE_MS + 10, false)).toBe(false);
        expect(s.free(SETTLE_MS + 20, true)).toBe(false);
        expect(s.free(SETTLE_MS + 20 + SETTLE_MS - 1, true)).toBe(false);
        expect(s.free(SETTLE_MS + 20 + SETTLE_MS, true)).toBe(true);
        const immediate = new Settle(0);
        expect(immediate.free(5, true)).toBe(true);
    });
});

describe('the take-off line on the ground', () => {
    it('is drawn for the game scheme, which has no ground card, and only spoken where a card of its own writes it (review: the line had no visible home)', () => {
        const table: [InputSource, boolean, boolean][] = [
            // source, game scheme flying, only spoken
            ['keyboard', true, false],
            ['keyboard', false, true],
            ['hid', false, true],
            ['gamepad', false, true],
            ['touch', false, false],
            [null, false, false],
            ['sim', false, false]
        ];
        for (const [source, game, spoken] of table) expect(gateSpoken(source, game), `${source} game=${game}`).toBe(spoken);
        // a radio never flies the game scheme (the view says game only for the keyboard), but if it did the radio card still owns the line
        expect(gateSpoken('hid', true)).toBe(true);
    });

    it('every input the How to fly card opens for has a way off the ground on the screen once the card is shut: a ground card or the drawn line', () => {
        // the pilot keyboard has its key card and a radio its arm card (both draw the line themselves); the rest draw the gate's line
        const groundCard = (kind: CardKind): boolean => kind === 'pilot' || kind === 'radio';
        for (const source of ['keyboard', 'touch', 'hid', 'gamepad'] as const) {
            for (const play of ['easy', 'pilot'] as const) {
                const kind = cardKind(source, play)!;
                expect(groundCard(kind) || !gateSpoken(source, kind === 'game'), `${source} / ${play}`).toBe(true);
            }
        }
    });
});

describe('the reminder of the first seconds of the first flight', () => {
    it('starts at the first flight, lasts REMIND_MS, and does not come back', () => {
        const r = new FirstFlightReminder();
        expect(r.update(0, false, true), 'on the ground').toBe(false);
        expect(r.update(1000, true, true), 'first take-off').toBe(true);
        expect(r.update(1000 + REMIND_MS - 1, true, true)).toBe(true);
        expect(r.update(1000 + REMIND_MS, true, true), 'time is up').toBe(false);
        expect(r.update(1000 + REMIND_MS + 5000, true, true), 'a second flight').toBe(false);
    });

    it('goes at once when Space or Shift is used, and stays away after "Do not show again"', () => {
        const r = new FirstFlightReminder();
        r.update(0, true, true);
        r.used();
        expect(r.update(100, true, true)).toBe(false);
        const off = new FirstFlightReminder();
        expect(off.update(0, true, false)).toBe(false);
        // a press before the first flight does not use the reminder up (control: it would never show)
        const early = new FirstFlightReminder();
        early.used();
        expect(early.update(10, true, true)).toBe(true);
    });

    it('does not run while the game scheme is not flying (the pause between two lives restarts nothing)', () => {
        const r = new FirstFlightReminder();
        expect(r.update(0, false, true)).toBe(false);
        expect(r.update(500, false, true)).toBe(false);
        expect(r.update(600, true, true)).toBe(true);
    });
});

describe('the keymap still routes K to the card', () => {
    it('help.keys is K, shipped and routed (the card and the pause menu item both ride on it)', () => {
        const b = KEYMAP.find((k) => k.action === 'help.keys');
        expect(b?.keys.map((k) => k.cap)).toEqual(['K']);
        expect(b?.status).toBe('shipped');
        expect(b?.flying).toBeUndefined();
    });
});
