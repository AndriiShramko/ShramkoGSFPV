// Lane look (docs/wip/look.md): what a second pilot sees. The near rule (apps/fly/src/rooms/remote-stage.ts nearAlpha): a
// remote drone nearer to the flight camera than NEAR_HIDE_M has no name tag (and no body: the page probe
// tools/bench/src/rooms-two-page.ts nearHidden reads that on a real page), with a fade band above it; and a paused pilot
// (the same pose again and again) is drawn in its colour, not grey as a lost one.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Entity } from 'playcanvas';
import { fakeDocument, FakeElement } from './helpers/fake-dom';
import { NEAR_FADE_M, NEAR_HIDE_M, nearAlpha } from '../../../apps/fly/src/rooms/remote-stage';
import { NameTags } from '../../../apps/fly/src/rooms/tags';
import { RemoteTrack } from '../../../apps/fly/src/rooms/interp';
import { FLAG_ARMED, FLAG_PAUSED } from '../../../apps/fly/src/rooms/codec';
import type { Pose } from '../../../apps/fly/src/rooms/codec';

/** a flight camera at the origin looking along -z; every point lands in the middle of a 1280 x 800 view */
const camera = {
    camera: { worldToScreen: (_w: unknown, s: { set(x: number, y: number, z: number): void }) => { s.set(640, 400, 1); return s; } },
    forward: { x: 0, y: 0, z: -1 },
    getPosition: () => ({ x: 0, y: 0, z: 0 })
} as unknown as Entity;

function tagsAt(distM: number): { slots: number[]; opacity: string | undefined } {
    const parent = new FakeElement('div');
    const tags = new NameTags(parent as unknown as HTMLElement, () => camera);
    tags.update([{ slot: 1, nick: 'Pilot-0001', pos: [0, 0, -distM], frozen: false }], true);
    const el = (tags.root as unknown as FakeElement).children[0] as FakeElement | undefined;
    return { slots: tags.slots, opacity: el?.style.opacity };
}

afterEach(() => vi.unstubAllGlobals());

describe('lane look: the near rule', () => {
    it('hides a drone up to NEAR_HIDE_M, fades it over NEAR_FADE_M, draws it whole beyond', () => {
        expect(NEAR_HIDE_M).toBeGreaterThan(0);
        expect(nearAlpha(0)).toBe(0);
        expect(nearAlpha(NEAR_HIDE_M)).toBe(0);
        expect(nearAlpha(NEAR_HIDE_M + NEAR_FADE_M / 2)).toBeCloseTo(0.5, 6);
        expect(nearAlpha(NEAR_HIDE_M + NEAR_FADE_M)).toBe(1);
        expect(nearAlpha(8)).toBe(1);
        expect(nearAlpha(Number.NaN)).toBe(0);
    });

    it('a drone at the camera (two pilots at one start point) has no name tag', () => {
        vi.stubGlobal('document', fakeDocument());
        expect(tagsAt(0).slots).toEqual([]);
        expect(tagsAt(0.1).slots).toEqual([]);
        expect(tagsAt(NEAR_HIDE_M * 0.9).slots).toEqual([]);
    });

    it('a drone in the fade band has a fading tag, one at 3 m a whole one', () => {
        vi.stubGlobal('document', fakeDocument());
        const mid = tagsAt(NEAR_HIDE_M + NEAR_FADE_M / 2);
        expect(mid.slots).toEqual([1]);
        expect(Number(mid.opacity)).toBeCloseTo(0.5, 3);
        const far = tagsAt(3);
        expect(far.slots).toEqual([1]);
        expect(Number(far.opacity)).toBe(1);
    });
});

describe('lane look: a paused pilot is not a lost one', () => {
    const pose = (tick: number, flags: number): Pose => ({ flags, seq: tick & 0xffff, tick, pos: [1, 2, 3], quat: [0, 0, 0, 1], vel: [0.5, 0, 0], throttle: 0 });

    it('the same paused pose again and again: drawn still, where it is, not frozen', () => {
        const tr = new RemoteTrack();
        for (let t = 0; t <= 3000; t += 66) tr.push(1000 + t, pose(500, FLAG_ARMED | FLAG_PAUSED), t);
        const sh = tr.sample(5000)!;
        expect(sh.frozen).toBe(false);
        expect(sh.pos).toEqual([1, 2, 3]);
    });

    it('control: a flying pilot whose poses stop is frozen (grey) after the extrapolation', () => {
        const tr = new RemoteTrack();
        tr.push(1000, pose(500, FLAG_ARMED), 0);
        expect(tr.sample(5000)!.frozen).toBe(true);
    });
});
