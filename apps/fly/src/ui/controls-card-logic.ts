// The "How to fly" card as data (v0.10 lane K, docs/wip/v10-k.md; the owner's message 23, item 1: gamers on the keyboard
// found no word that Space is up and Shift is down). Pure: no DOM, no page state, so Node tests drive every rule here
// (tools/bench/test/app-controls-card.test.ts) and ui/controls-card.ts only draws what this returns.
//
// Three things live here:
//  - which card the input in use gets (cardKind) and what is on it (cardModel). The caps of the flying keys are read from the
//    tables the keyboard flies with (play/keys.ts GAME_KEYS / MODE2_KEYS) and the caps of every other key from the keymap
//    (the caller passes `caps`, the router's own `keysFor`): the card has no list of key names of its own;
//  - when the card opens by itself (shouldOpen, Settle): once per visit, when the scan is ready, an input is chosen and nothing
//    else is up, after a short quiet time;
//  - the small reminder of the first seconds of the first flight (FirstFlightReminder).

import { GAME_KEYS, MODE2_KEYS } from '../play/keys';
import type { GameAxis, KeyAxis, KeyBind, PlayProfile } from '../play/keys';

/** The card the input in use gets: the game scheme, the pilot keys, the touch pads, a radio or gamepad. */
export type CardKind = 'game' | 'pilot' | 'touch' | 'radio';

/** Controls.source: the device flying now (sim is the test pilot, null is "nothing chosen yet"). */
export type InputSource = 'hid' | 'gamepad' | 'touch' | 'keyboard' | 'sim' | null;

/** Which card the input in use gets; null: none yet (no input chosen) or none ever (the test pilot flies the model). */
export function cardKind(source: InputSource, play: PlayProfile): CardKind | null {
    switch (source) {
        case 'keyboard': return play === 'easy' ? 'game' : 'pilot';
        case 'touch': return 'touch';
        case 'hid':
        case 'gamepad': return 'radio';
        default: return null;
    }
}

// ------------------------------------------------------------------ caps from the tables the keyboard flies with

const ARROWS: Readonly<Record<string, string>> = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' };

/** The cap text of one KeyboardEvent.code of the flying tables; `space` is the word the page uses for Space (localised). */
export function capOfCode(code: string, space = 'Space'): string {
    if (code === 'Space') return space;
    if (code.startsWith('Shift')) return 'Shift';
    if (Object.hasOwn(ARROWS, code)) return ARROWS[code];
    const m = /^Key([A-Z])$/.exec(code);
    return m ? m[1] : code;
}

/** The codes of one side of one axis of a layout, in table order. */
function codes<A extends string>(layout: readonly KeyBind<A>[], axis: A, dir: 1 | -1): string[] {
    return layout.filter((k) => k.axis === axis && k.dir === dir).map((k) => k.code);
}

/** Unique caps of some codes (Left Shift and Right Shift are one cap), in order. */
const capsOf = (cs: readonly string[], space: string): string[] => [...new Set(cs.map((c) => capOfCode(c, space)))];

/** What the game card shows of the game layout. */
export interface GameCaps {
    /** the vertical pair: Space and Shift */
    up: string[];
    down: string[];
    /** W A S D: forward, strafe left, back, strafe right (the letter keys of those axes) */
    wasd: [string, string, string, string];
    /** the turn keys: the arrows first, then the letters, left before right */
    turn: string[];
}

/** The game card's caps, from the game layout (play/keys.ts GAME_KEYS: the table keyboard flying itself reads). */
export function gameCaps(layout: readonly KeyBind<GameAxis>[] = GAME_KEYS, space = 'Space'): GameCaps {
    const letter = (axis: GameAxis, dir: 1 | -1): string => capsOf(codes(layout, axis, dir).filter((c) => c.startsWith('Key')), space)[0] ?? '';
    const turn = (dir: 1 | -1): string[] => codes(layout, 'turn', dir);
    const arrowsFirst = (cs: string[]): string[] => [...cs.filter((c) => c.startsWith('Arrow')), ...cs.filter((c) => !c.startsWith('Arrow'))];
    return {
        up: capsOf(codes(layout, 'lift', 1), space),
        down: capsOf(codes(layout, 'lift', -1), space),
        wasd: [letter('forward', 1), letter('strafe', -1), letter('forward', -1), letter('strafe', 1)],
        // left keys then right keys, arrows before letters inside each side: ← → Q E reads as the pairs
        turn: capsOf([...arrowsFirst(turn(-1)).slice(0, 1), ...arrowsFirst(turn(1)).slice(0, 1), ...arrowsFirst(turn(-1)).slice(1), ...arrowsFirst(turn(1)).slice(1)], space)
    };
}

/** The pilot card's caps, from the Mode 2 layout (play/keys.ts MODE2_KEYS). */
export function pilotCaps(layout: readonly KeyBind[] = MODE2_KEYS, space = 'Space'): { throttle: string[]; yaw: string[]; sticks: string[] } {
    const pair = (axis: KeyAxis, plus: 1 | -1 = 1): string[] => capsOf([...codes(layout, axis, plus), ...codes(layout, axis, (plus === 1 ? -1 : 1))], space);
    return { throttle: pair('lift'), yaw: pair('yaw', -1), sticks: [...pair('pitch'), ...pair('roll', -1)] };
}

// ------------------------------------------------------------------ the card

/** One key of the vertical pair: its cap(s), the word, and the small line under it. */
export interface HeroKey { caps: string[]; word: string; sub: string }

/** One row: the caps (or a tag for a thing that is no key: the sticks), then what they do. */
export interface CardRow { id: string; caps: string[]; tag?: string; text: string }

export interface CardModel {
    kind: CardKind;
    /** the card's title */
    title: string;
    /** the line under the title: which input the card is for */
    sub: string;
    /** the vertical pair, game scheme only */
    hero: { up: HeroKey; down: HeroKey } | null;
    /** the two pads, touch only */
    pads: { left: string; leftText: string; right: string; rightText: string } | null;
    rows: CardRow[];
    /** a line above the buttons (click to capture the mouse; touch a stick to take off) */
    note: string | null;
    /** a small line at the foot */
    foot: string | null;
}

/** What the card needs from the page: the texts, the keymap's caps, and what the input in use is called. */
export interface CardEnv {
    /** the page's t() */
    t(key: string, params?: Record<string, string | number>): string;
    /** the caps of an action's keys in the keymap (the router's own `caps`, as text) */
    caps(action: string): string[];
    /** easy play's altitude help is on: the left touch stick climbs and sinks (else it is a throttle that stays) */
    altitudeHelp: boolean;
    /** a radio's arm control: its kind ('key': Space or the ARM button) and its name ("CH5", "button 3") */
    armKind: 'axis' | 'button' | 'toggle' | 'key' | null;
    armLabel: string;
}

/** The first cap of an action ("Esc" of Esc / P), or none. */
const first = (caps: string[]): string[] => caps.slice(0, 1);

export function cardModel(kind: CardKind, env: CardEnv): CardModel {
    const { t } = env;
    const space = t('arm.keys.space');
    /** the keymap's caps of an action, with Space in the page's own word (the flying tables go through capOfCode the same way) */
    const caps = (action: string): string[] => env.caps(action).map((c) => (c === 'Space' ? space : c));
    const row = (id: string, c: string[], text: string, tag?: string): CardRow => (tag === undefined ? { id, caps: c, text } : { id, caps: c, tag, text });
    const common = (): CardRow[] => [
        row('next', caps('scene.next'), t('play.card.next')),
        row('again', caps('help.keys'), t('play.card.again'))
    ];
    const base = { kind, title: t('play.card.title'), sub: t(`play.card.sub.${kind}`), hero: null, pads: null, note: null, foot: null };
    if (kind === 'game') {
        const g = gameCaps(GAME_KEYS, space);
        return {
            ...base,
            hero: {
                up: { caps: g.up, word: t('play.card.up'), sub: t('play.card.upSub') },
                down: { caps: g.down, word: t('play.card.down'), sub: t('play.card.downSub') }
            },
            rows: [
                row('mouse', [t('play.game.mouseKey')], t('play.game.mouse')),
                row('move', g.wasd, t('play.game.move')),
                row('turn', g.turn, t('play.game.turnKeys')),
                row('fullscreen', caps('fullscreen.toggle'), t('play.game.fullscreen')),
                row('pause', first(caps('pause.toggle')), t('play.game.pause')),
                row('respawn', caps('respawn.start'), t('arm.keys.respawn')),
                ...common()
            ],
            note: t('play.card.click'),
            foot: t('play.keys.pilotNote')
        };
    }
    if (kind === 'pilot') {
        const p = pilotCaps(MODE2_KEYS, space);
        return {
            ...base,
            rows: [
                row('arm', caps('arm.toggle'), t('arm.keys.arm')),
                row('throttle', p.throttle, t('arm.keys.throttle')),
                row('yaw', p.yaw, t('arm.keys.yaw')),
                row('sticks', p.sticks, t('arm.keys.sticks')),
                row('mode', caps('mode.cycle'), t('arm.keys.mode')),
                row('respawn', caps('respawn.start'), t('arm.keys.respawn')),
                row('pause', caps('pause.toggle'), t('arm.keys.pause')),
                ...common()
            ]
        };
    }
    if (kind === 'touch') {
        return {
            ...base,
            pads: {
                left: t('play.card.padLeft'),
                leftText: t(env.altitudeHelp ? 'play.card.padLeftClimb' : 'play.card.padLeftThrottle'),
                right: t('play.card.padRight'),
                rightText: t('play.card.padRightText')
            },
            rows: [],
            note: t('play.gate.touch')
        };
    }
    return {
        ...base,
        rows: [
            row('sticks', [], t('play.card.radioSticks'), t('play.card.capSticks')),
            row('arm', ['ARM'], env.armKind === 'key' ? t('play.card.radioArmKey') : t('play.card.radioArmSwitch', { src: env.armLabel || 'CH5' })),
            row('mode', caps('mode.cycle'), t('play.card.radioMode')),
            row('pause', first(caps('pause.toggle')), t('arm.keys.pause')),
            ...common()
        ]
    };
}

// ------------------------------------------------------------------ when the card opens by itself

/** What decides whether the card opens by itself now. */
export interface OpenInput {
    /** prefs input.howToFly: the pilot did not tick "Do not show again" */
    enabled: boolean;
    /** a test page (?nowarn, ?simradio, ?lat): the first-visit notices are off, and so is this */
    testPage: boolean;
    /** it already opened in this visit */
    shown: boolean;
    source: InputSource;
    play: PlayProfile;
    /** a screen is up that the card must not stand on or over (Controls, a panel, the menu, a picker, the crash panel, loading, a pause) */
    blocked: boolean;
    /** the tab is in the background */
    hidden: boolean;
}

export function shouldOpen(i: OpenInput): boolean {
    return i.enabled && !i.testPage && !i.shown && !i.hidden && !i.blocked && cardKind(i.source, i.play) !== null;
}

/** The page must be free of other screens this long before the card opens by itself (a screen that closes into another must not let it in between). */
export const SETTLE_MS = 350;

/** Counts how long the page has been free: `free(now, isFree)` is true once it has been free for `ms` without a break. */
export class Settle {
    private since: number | null = null;
    constructor(private readonly ms = SETTLE_MS) {}
    free(now: number, isFree: boolean): boolean {
        if (!isFree) { this.since = null; return false; }
        this.since ??= now;
        return now - this.since >= this.ms;
    }
}

// ------------------------------------------------------------------ the first seconds of the first flight

/** How long the small "Space up · Shift down" pill stays. */
export const REMIND_MS = 8000;

/**
 * The pill of the first seconds of the first flight of a visit (game scheme only). `flying`: the game scheme is flying and the
 * drone is armed and not crashed. It starts the first time that is true, lasts REMIND_MS, and goes at once when Space or Shift
 * is pressed (the pilot has found them); it never comes back in the visit. `enabled`: not after "Do not show again".
 */
export class FirstFlightReminder {
    private startedAt: number | null = null;
    private over = false;
    update(now: number, flying: boolean, enabled: boolean): boolean {
        if (this.over || !enabled) return false;
        if (this.startedAt === null) {
            if (!flying) return false;
            this.startedAt = now;
        }
        if (now - this.startedAt >= REMIND_MS) { this.over = true; return false; }
        return true;
    }
    /** Space or Shift pressed: the reminder has done its work. */
    used(): void { if (this.startedAt !== null) this.over = true; }
}
