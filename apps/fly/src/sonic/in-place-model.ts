// Fly by Sound switched on in place (train 3, lane sonic3; docs/wip/sonic3-plan.md "The direct road"). The owner, message 51:
// "I already said that this flying by sound must be switched on for any scene." One key (Backslash) and one pause item turn the
// mode on over the flight that runs: the same tab, the same scene, the same place; the cues start at once, a scan without walls
// gets them by itself (lessons.ts wallsForFree), N makes a course; the same key turns it off and the flight goes on. Nobody is
// sent to a start screen. This file is the switch itself, pure (Node tests hold it); in-place.ts wires it to the page.
import { SCAN_FREE_ID, scanFreeLesson } from '@shramko/sonic-fpv';
import type { LessonDef } from '@shramko/sonic-fpv';
import type { SonicEntry } from './entry';

/** What of the flight now the free flight is made from: the world's id and its size flown (a built-in world: its own, s = 1). */
export interface FlownNow {
    readonly scene: { readonly id: string };
    readonly transform: { readonly s: number; readonly t: readonly number[] };
}

/**
 * The free flight over the world flown now, at its size now (the package's scan-free template, any scene id): the walls, the floor
 * and the height heard, no track, no clock. Its intro is one short line (sonic.say.inPlaceOn): the pilot is flying already.
 */
export function freeHere(now: FlownNow): LessonDef {
    const t = now.transform;
    const lesson = scanFreeLesson(now.scene.id, [t.s, t.t[0] ?? 0, t.t[1] ?? 0, t.t[2] ?? 0]);
    return { ...lesson, intro: [{ key: 'sonic.say.inPlaceOn' }] };
}

/** A pilot who never flew by sound: no lesson progress saved and never chose "I already fly by sound". */
export function firstTimer(progress: Readonly<Record<string, unknown>>, fliesBySound: boolean): boolean {
    return !fliesBySound && Object.keys(progress).length === 0;
}

/** What the switch needs of the page (in-place.ts gives the real ones; tests give fakes). */
export interface InPlaceDeps<S> {
    /** the flight now */
    flown(): FlownNow;
    /** the sound made at the press (one AudioContext); null when the browser gives no sound */
    start(): Promise<S | null>;
    /** the sound let go after the mode is off */
    stop(setup: S): void;
    /** the page's entry (entry-state.ts setSonicEntry): the mode's keys follow it at once (app/flight.ts KeyRouter sonic) */
    setEntry(e: SonicEntry | null): void;
    /** installs the mode on the running flight (feature.ts installSonicFlight); resolves to what takes it out */
    install(e: SonicEntry): Promise<() => void>;
    /** a pilot who never flew by sound (firstTimer over the saved prefs) */
    firstTime(): boolean;
    /** marks that he flies by sound now, so the introduction is said once (store.ts setFliesBySound) */
    markFlies(): void;
    /** the mode's lessons beside the flight (a new tab of the start screen) */
    lessons(): void;
    /** the mode did not come up: said and shown, the flight goes on without it */
    failed(e: unknown): void;
}

/** Fly by Sound on and off over the running flight. */
export class InPlaceSwitch<S> {
    private off: (() => void) | null = null;
    private setup: S | null = null;
    private busy = false;

    constructor(private readonly d: InPlaceDeps<S>) {}

    get on(): boolean {
        return this.off !== null;
    }

    /** The key and the pause item: on when off, off when on. Resolves to the state after the press. */
    toggle(): Promise<boolean> {
        if (this.off) {
            this.switchOff();
            return Promise.resolve(false);
        }
        return this.switchOn();
    }

    async switchOn(): Promise<boolean> {
        if (this.off || this.busy) return this.on;
        this.busy = true;
        try {
            const setup = await this.d.start();
            if (setup === null) {
                this.d.failed(new Error('no sound in this browser'));
                return false;
            }
            const first = this.d.firstTime();
            const entry = {
                setup,
                lessonId: SCAN_FREE_ID,
                world: null,
                free: freeHere(this.d.flown()),
                here: true,
                intro: first,
                leave: () => this.switchOff(),
                lessons: () => this.d.lessons()
            } as unknown as SonicEntry;
            this.d.setEntry(entry);
            try {
                this.off = await this.d.install(entry);
            } catch (e) {
                this.d.setEntry(null);
                this.d.stop(setup);
                this.d.failed(e);
                return false;
            }
            this.setup = setup;
            if (first) this.d.markFlies();
            return true;
        } finally {
            this.busy = false;
        }
    }

    /** The mode out (its keys, prefs, assists and sounds as they were), the entry cleared; the flight goes on where it is. */
    switchOff(): void {
        const off = this.off;
        if (!off) return;
        this.off = null;
        off();
        this.d.setEntry(null);
        if (this.setup !== null) this.d.stop(this.setup);
        this.setup = null;
    }
}
