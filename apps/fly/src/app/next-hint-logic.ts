// When the crash hint "Want another place? Press N for the next scene" shows (v0.9 item 11, the owner's
// message 22): a visitor who crashes and crashes may not know the scene can be changed. Pure rules; the
// feature (builtin/next-hint.ts) and its widget (ui/next-hint.ts) draw them.
//   - the visit's 3rd crash, and again the 6th, while N was not used;
//   - never once N was used (next-used.ts), and not with scenes.autoSwitch on (the crash already goes
//     to the next scene);
//   - what it says depends on the input: a touch screen has no N (a Next scene button instead), a radio
//     whose profile maps the next-scene function names its switch, everything else names the key.

/** The crashes of a visit at which the hint shows. */
export const HINT_AT: readonly number[] = [3, 6];
/** The hint goes away by itself after this long (a new scene, N or its close button end it sooner). */
export const HINT_MS = 12000;

export interface HintDue {
    /** crashes so far in this visit, this one included (a replayed crash is not one) */
    crashes: number;
    /** N was used in this browser, ever */
    nextUsed: boolean;
    /** scenes.autoSwitch */
    autoSwitch: boolean;
}

export function hintDue(o: HintDue): boolean {
    return HINT_AT.includes(o.crashes) && !o.nextUsed && !o.autoSwitch;
}

export type HintKind = 'key' | 'radio' | 'touch';

export interface HintInput {
    /** the input in use (Controls.source) */
    source: 'hid' | 'gamepad' | 'touch' | 'keyboard' | 'sim' | null;
    /** the radio's profile maps the next-scene function (Switches.ranges has scene.next) */
    radioSwitch: boolean;
}

export function hintKind(o: HintInput): HintKind {
    if (o.source === 'touch') return 'touch';
    if ((o.source === 'hid' || o.source === 'gamepad') && o.radioSwitch) return 'radio';
    return 'key';
}
