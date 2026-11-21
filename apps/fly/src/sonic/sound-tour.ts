// "What is this sound?" (train 4, lane tutor-air; decision 5 of the brief, after the first outside feedback of 2026-11-20): key G in
// any flight by sound, a lesson or the free flight. The flight freezes (the pause reason 'tour': the craft holds, the lesson's clocks
// stand), every sound goes quiet, and each sound the engine was playing a moment ago is named and then played alone from its
// direction, once each, the safety ones first; then "Back to the flight." and the flight goes on. Nothing audible: one line that
// says so and how to hear something. G again (or any other pause) ends the tour at once.
// The engine's own plan says what is audible (SonicEngine.activeCues); the sound's name is the package's `cue.<id>.name`, never
// typed here. The glossary of every sound stays a lesson of the lesson menu.
import { LAYER_IDS } from '@shramko/sonic-fpv';
import type { ActiveCue, CueEvent, CueId, SpeechLine, Vec3 } from '@shramko/sonic-fpv';
import { cueBase } from './sound-panel';

/** The pause reason of the tour (app/context.ts PauseReason). */
export const TOUR_PAUSE = 'tour' as const;
/** How long each sound plays alone, s (the brief: 2-3 s). */
export const TOUR_PLAY_S = 2.5;
/** The quiet after each sound before the next name, ms. */
export const TOUR_GAP_MS = 400;

/** One sound of the tour: its cue (no sector suffix) and where it came from a moment ago. */
export interface TourCue {
    readonly cue: CueId;
    readonly name: string;
    readonly dir: Vec3 | null;
    readonly distance: number | null;
}

/** The flight's hold (FlightContext.pause / resume, the reason 'tour'). */
export interface TourHold {
    pause(reason: typeof TOUR_PAUSE): void;
    resume(reason: typeof TOUR_PAUSE): void;
}

/** What of the mode the tour drives (the bridge and its engine). */
export interface TourSound {
    /** the cues the engine planned in its last frame (SonicEngine.activeCues) */
    activeCues(): readonly ActiveCue[];
    /** the engine's gate now (a lesson's taught cues), put back at the end */
    readonly audibleNow: readonly CueId[] | null;
    setAudible(cues: readonly CueId[] | null): void;
    cue(e: CueEvent): void;
    /** a line the pilot asked for (voiced with the narrator off too); resolves when it ends */
    say(line: SpeechLine, interrupt: boolean): Promise<void>;
}

/** The large card (moment-card.ts): the name of the sound playing, or null. */
export interface TourCard {
    showCue(cue: CueId | null): void;
}

export interface TourOptions {
    /** the sound's name in the pilot's language (the package's `cue.<id>.name`), or null when it has none (not named, not played) */
    name(cue: CueId): string | null;
    /** the pilot's key for the tour, for the "nothing sounds" line */
    key(): string;
    wait(ms: number): Promise<void>;
}

/** The sounds audible in the engine's last plan: each cue once (sectors folded), the safety layer first, then the layers' order. */
export function audibleCues(active: readonly ActiveCue[], name: (cue: CueId) => string | null): TourCue[] {
    const seen = new Map<CueId, { c: TourCue; rank: number; i: number }>();
    active.forEach((a, i) => {
        const cue = cueBase(a.id);
        if (seen.has(cue)) return;
        const n = name(cue);
        if (n === null) return;
        const rank = LAYER_IDS.indexOf(a.layer);
        seen.set(cue, { c: { cue, name: n, dir: a.dir, distance: a.distance }, rank: rank < 0 ? LAYER_IDS.length : rank, i });
    });
    return [...seen.values()].sort((a, b) => a.rank - b.rank || a.i - b.i).map((x) => x.c);
}

export type TourEnd = 'none' | 'done' | 'stopped';

export class SoundTour {
    private run = 0;
    private on = false;
    private prev: readonly CueId[] | null = null;

    constructor(
        private readonly hold: TourHold,
        private readonly sound: TourSound,
        private readonly card: TourCard,
        private readonly o: TourOptions
    ) {}

    /** The tour holds the flight now. */
    get running(): boolean {
        return this.on;
    }

    /** G: the tour; G while it runs ends it. Resolves when it ended. */
    async start(): Promise<TourEnd> {
        if (this.on) {
            this.stop();
            return 'stopped';
        }
        const cues = audibleCues(this.sound.activeCues(), (c) => this.o.name(c));
        if (cues.length === 0) {
            await this.sound.say({ key: 'sonic.say.tourNone', params: { key: this.o.key() } }, true);
            return 'none';
        }
        const id = ++this.run;
        this.on = true;
        this.prev = this.sound.audibleNow;
        this.hold.pause(TOUR_PAUSE);
        this.sound.setAudible([]);
        for (let i = 0; i < cues.length; i++) {
            const c = cues[i] as TourCue;
            this.card.showCue(c.cue);
            await this.sound.say({ key: 'sonic.say.tourName', params: { n: i + 1, of: cues.length, name: c.name } }, i === 0);
            if (id !== this.run) return 'stopped';
            this.sound.setAudible([c.cue]);
            this.sound.cue({ kind: 'repeat-cue', cue: c.cue, dir: c.dir, index: 0, of: 1, durS: TOUR_PLAY_S, distanceM: c.distance });
            await this.o.wait(TOUR_PLAY_S * 1000 + TOUR_GAP_MS);
            if (id !== this.run) return 'stopped';
            this.sound.setAudible([]);
        }
        this.card.showCue(null);
        await this.sound.say({ key: 'sonic.say.helpCut' }, false);
        if (id !== this.run) return 'stopped';
        this.end();
        return 'done';
    }

    /** Ends the tour now (G again, another pause, the mode stopping): the sounds and the flight go on. Nothing when none runs. */
    stop(): void {
        if (!this.on) return;
        this.run++;
        this.end();
    }

    private end(): void {
        this.on = false;
        this.sound.setAudible(this.prev);
        this.prev = null;
        this.card.showCue(null);
        this.hold.resume(TOUR_PAUSE);
    }
}
