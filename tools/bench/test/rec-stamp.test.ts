// W4-1, live R1 (2026-10-02): 602 slots, 0 held for the encoder, but 25.7 % repeated pictures while
// the page drew 58.4 frames a second. A frame was put on the 1/60 s grid by the moment its work
// ended; a callback that ran half a period late (the main thread busy while the scan streams) took the
// next frame's slot, the next frame found its slot taken (unused), and the slot before repeated the
// previous picture. Stamped with the frame's own rAF time (the display frame it is for), each frame
// keeps its slot. The model: 60 Hz display frames, callbacks late by a repeating 0-14 ms pattern.
import { describe, expect, it } from 'vitest';
import { FramePacer } from '../../../apps/fly/src/cinema';

const P = 1000 / 60;
const LATE = [0, 3, 12, 1, 0, 14, 2, 0, 10, 0, 5, 13, 0, 1, 9, 0]; // ms after the frame's own time

function record(stamp: (frameTime: number, late: number) => number, n = 600): { slots: number; repeated: number; unused: number } {
    const pc = new FramePacer(60);
    let repeated = 0;
    for (let k = 0; k < n; k++) {
        const frameTime = 1000 + k * P;
        repeated += Math.max(0, pc.onRendered(stamp(frameTime, LATE[k % LATE.length])).slots.length - 1);
    }
    return { slots: pc.slotCount, repeated, unused: pc.unused };
}

describe('recorder stamps (W4-1)', () => {
    it('stamped with the frame\'s rAF time, late callbacks repeat nothing: one picture per slot', () => {
        const r = record((frameTime) => frameTime);
        expect(r.slots).toBe(600);
        expect(r.repeated).toBe(0);
        expect(r.unused).toBe(0);
    });

    it('control: stamped when the work ended (a callback late plus 1.6 ms of work), every callback over half a period late leaves a repeat', () => {
        const r = record((frameTime, late) => frameTime + late + 1.6);
        const over = LATE.filter((l) => l + 1.6 > P / 2).length * (600 / LATE.length);
        expect(r.repeated).toBeGreaterThanOrEqual(over - 2);
        expect(r.repeated / r.slots).toBeGreaterThan(0.2);
        expect(r.unused).toBeGreaterThan(0);
    });
});
