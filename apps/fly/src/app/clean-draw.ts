// REC and auto-record draw the clean picture (v0.10 lane R, the owner's item 2: "при записи видео (REC) рисовать
// «чисто»"). Stochastic drawing leaves a fine grain that a video encoder spends its bits on (docs/wip/v09-r.md: +20 to
// +30 % bytes, 8 to 15 dB against the clean frame), so while a recording runs the scan is drawn sorted, and the pilot's
// own drawing comes back when it stops, like the video export already does (builtin/video-export.ts).
//
// Pure bookkeeping, no engine and no DOM: whoever needs the clean picture takes a hold (a recording, the video export
// one day), the drawing feature (builtin/drawing.ts) reads `held` every time it decides what the engine draws, and hears
// of changes. Holds are counted, so two overlapping recordings (an auto-record that restarts) never let go early, and
// letting go twice does nothing.

export class SortedHold {
    private readonly holders = new Set<symbol>();
    private readonly listeners = new Set<() => void>();

    /** Something needs the sorted picture right now. */
    get held(): boolean {
        return this.holders.size > 0;
    }

    /** Hold the sorted drawing; the returned function lets go (once: calling it again changes nothing). */
    acquire(): () => void {
        const key = Symbol('sorted-hold');
        this.holders.add(key);
        this.fire();
        return () => {
            if (this.holders.delete(key)) this.fire();
        };
    }

    /** `fn` runs whenever `held` may have changed (a hold taken, the last one let go). Returns its unsubscribe. */
    onChange(fn: () => void): () => void {
        this.listeners.add(fn);
        return () => {
            this.listeners.delete(fn);
        };
    }

    private fire(): void {
        for (const fn of [...this.listeners]) fn();
    }
}

/** This page's hold: the recorder takes it, the drawing feature reads it. */
export const cleanDraw = new SortedHold();
