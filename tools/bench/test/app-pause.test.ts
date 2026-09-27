// The flight page's pause stack (apps/fly/src/app/pause-stack.ts, docs/architecture-v03.md 1.1): the
// flight runs again only when every reason is released. Negative control: v0.2's one shared holder
// (the pause menu and every panel it opened held the same 'menu'), which resumes on the first
// release. Also on the real SimClock (apps/fly/src/simclock.ts): no sim time passes while any
// reason is held.
import { describe, expect, it } from 'vitest';
import { PauseStack } from '../../../apps/fly/src/app/pause-stack';
import type { PauseReason } from '../../../apps/fly/src/app/context';
import { SimClock } from '../../../apps/fly/src/simclock';

interface Pauser { hold(r: PauseReason): void; release(r: PauseReason): void; readonly paused: boolean }

/** v0.2: one boolean for the menu and every panel it opened. */
class SharedHolder implements Pauser {
    paused = false;
    constructor(private apply: (on: boolean) => void = () => undefined) {}
    hold(): void { this.paused = true; this.apply(true); }
    release(): void { this.paused = false; this.apply(false); }
}

/** The menu opens settings, the Controls screen opens over it and closes: is the flight still paused? */
function controlsOverSettings(p: Pauser): boolean {
    p.hold('panel');
    p.hold('controls');
    p.release('controls');
    return p.paused;
}

describe('pause stack', () => {
    it('two reasons: releasing one keeps the flight paused, releasing both resumes it', () => {
        const calls: [boolean, readonly PauseReason[]][] = [];
        const s = new PauseStack<PauseReason>((on, reasons) => calls.push([on, reasons]));
        s.hold('menu');
        s.hold('panel');
        s.release('menu');
        expect(s.paused).toBe(true);
        expect(s.reasons).toEqual(['panel']);
        s.release('panel');
        expect(s.paused).toBe(false);
        expect(calls).toEqual([[true, ['menu']], [true, ['menu', 'panel']], [true, ['panel']], [false, []]]);
    });

    it('a repeat hold and a release of a reason not held change nothing and report nothing', () => {
        let n = 0;
        const s = new PauseStack<PauseReason>(() => { n++; });
        s.hold('menu');
        s.hold('menu');
        s.release('panel');
        expect(n).toBe(1);
        s.release('menu');
        expect(s.paused).toBe(false);
        expect(n).toBe(2);
    });

    it('the Controls screen over settings: the stack stays paused; control: v0.2\'s shared holder resumes under settings', () => {
        expect(controlsOverSettings(new PauseStack<PauseReason>(() => undefined))).toBe(true);
        expect(controlsOverSettings(new SharedHolder())).toBe(false); // the control fires: the defect is visible
    });

    it('on the SimClock: no sim time passes while any reason is held (control: the shared holder lets 1 s run under a panel)', () => {
        const run = (make: (apply: (on: boolean) => void) => Pauser): number => {
            const clock = new SimClock();
            let now = 0;
            clock.restart(now);
            const p = make((on) => clock.pause(on, now));
            now = 1000; p.hold('menu');     // the pause menu
            now = 1500; p.hold('panel');    // settings opened from it
            now = 2000; p.release('menu');  // the menu closes under settings
            now = 3000; p.release('panel'); // settings closed: fly on
            return clock.toSimUs(3000) / 1000; // sim ms flown by the page's 3000 ms
        };
        expect(run((apply) => new PauseStack<PauseReason>((on) => apply(on)))).toBe(1000);
        expect(run((apply) => new SharedHolder(apply))).toBe(2000);
    });
});
