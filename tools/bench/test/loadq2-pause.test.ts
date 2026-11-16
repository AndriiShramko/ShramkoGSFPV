// loadq2 (R2-rest): the frame rate keeper rests while the flight is paused (apps/fly/src/app/quality.ts setPaused).
// Measured on the release of 8d078948 (U:/Temp/gsfpv-train3/loadq2/rest/r-govlog-pause-c1.json, Lublin 2f1ddf5f,
// desktop-weak, CPU 1, the rise off): behind the pause menu 3230 of 7907 frames were held for the GPU queue, the
// intervals alternated about 18 ms and 2 ms, and the keeper stepped the flight down 0 -> 1 -> 2 while 132 to 214
// pictures a second were drawn. The frames below follow that log.
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../apps/fly/src/app/env', () => ({ q: new URLSearchParams('') }));
vi.mock('@gsfpv/render-pc', () => import('../../../packages/render-pc/src/governor'));

const { Quality } = await import('../../../apps/fly/src/app/quality');

/** The renderer fields Quality reads, nothing more. */
class FakeRenderer {
    renderScale = 1;
    frameTime = 0;
    frameAfterSkip = false;
    framesHeld = 0;
    streamTicks = 0;
    budgetM = 0;
    setRenderScale(s: number): void { this.renderScale = s; }
    setSplatBudgetMillions(m: number): void { this.budgetM = m; }
}

type Q = InstanceType<typeof Quality>;

function make(): { q: Q; r: FakeRenderer } {
    const r = new FakeRenderer();
    const q = new Quality(r as never);
    q.apply();
    return { q, r };
}

/** Frames for `ms` from r.frameTime: interval dt(i), held(i) for the GPU queue. */
function frames(q: Q, r: FakeRenderer, ms: number, dt: (i: number) => number, held: (i: number) => boolean): void {
    const end = r.frameTime + ms;
    for (let i = 0; r.frameTime < end; i++) {
        r.frameTime += dt(i);
        if (held(i)) r.framesHeld++;
        q.frame(r.frameTime);
    }
}

/** The old Quality has no setPaused: the optional call keeps the negative control a failed assertion. */
function pause(q: Q, on: boolean): void {
    (q as unknown as { setPaused?: (on: boolean) => void }).setPaused?.(on);
}

/** 8 s of a smooth flight (4 ms frames, none held): the keeper learns the period and is calm at the top step. */
function calmFlight(q: Q, r: FakeRenderer): void {
    frames(q, r, 8000, () => 4, () => false);
}

/** The measured pause: about 18.6 and 2.4 ms in turn, every frame held. */
const pauseDt = (i: number): number => (i % 2 === 0 ? 18.6 : 2.4);

describe('loadq2 R2-rest: the keeper rests while the flight is paused', () => {
    it('the held frames behind the pause menu do not step the flight down', () => {
        const { q, r } = make();
        calmFlight(q, r);
        expect(q.governor.step).toBe(0);
        pause(q, true);
        frames(q, r, 10000, pauseDt, () => true);
        expect(q.governor.step).toBe(0);
        expect(r.budgetM).toBe(q.governor.topBudgetMillions);
    });

    it('the still rise of a pause may start: the keeper is calm as it was when the pause began', () => {
        const { q, r } = make();
        calmFlight(q, r);
        expect(q.keeperCalm).toBe(true);
        pause(q, true);
        const calm: boolean[] = [];
        for (let s = 0; s < 5; s++) {
            frames(q, r, 1000, pauseDt, () => true);
            calm.push(q.keeperCalm);
        }
        expect(calm).toEqual([true, true, true, true, true]);
    });

    it('after the pause the keeper judges again: a slow flight still steps down', () => {
        const { q, r } = make();
        calmFlight(q, r);
        pause(q, true);
        frames(q, r, 3000, pauseDt, () => true);
        pause(q, false);
        frames(q, r, 3000, () => 40, () => false);
        expect(q.governor.step).toBeGreaterThan(0);
    });
});
