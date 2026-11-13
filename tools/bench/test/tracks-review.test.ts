// Lane review fixes of the course in flight (train 1, lane tracks; docs/wip/tracks.md "R review fixes").
// TR-4: CourseStage kept one box mesh across shows, and the engine freed it with its last mesh instance at the first hide(),
//       so every later show drew square gates and chevrons from a dead mesh. Node, NullGraphicsDevice, the real stage.
// TR-5: a rescale in flight left the gates where they were; CourseRun now says when the transform is not the one it was laid with.
// TR-8: a course under gatesMin is retried with derived seeds (deterministic) or refused.
import { describe, expect, it } from 'vitest';
import { AppBase, AppOptions, RenderComponentSystem } from '../../../apps/fly/node_modules/playcanvas/build/playcanvas/src/index.js';
// the engine's own null device (no GPU); not in the package's index, so from the same src tree the index uses
import { NullGraphicsDevice } from '../../../apps/fly/node_modules/playcanvas/build/playcanvas/src/platform/graphics/null/null-graphics-device.js';
import type { TrackFile } from '@shramko/sonic-fpv';
import { freeSpace, generateCourse } from '@gsfpv/tracks';
import { CourseStage } from '../../../apps/fly/src/course/view';
import { CourseRun, enoughGates } from '../../../apps/fly/src/course/run';
import { IDENTITY, SPAWN_A, threeRooms } from '../../../packages/tracks/test/worlds';

function stageOf(): CourseStage {
    const canvas = { width: 16, height: 16, clientWidth: 16, clientHeight: 16, getBoundingClientRect: () => ({ width: 16, height: 16, left: 0, top: 0 }), addEventListener() {}, removeEventListener() {}, style: {} };
    const device = new NullGraphicsDevice(canvas as never, {});
    const app = new AppBase(canvas as never);
    const opts = new AppOptions();
    opts.graphicsDevice = device;
    opts.componentSystems = [RenderComponentSystem];
    app.init(opts);
    return new CourseStage({ app, device } as never);
}

/** the stage's kept box mesh (private field, the same in the old code) still has its vertex buffer */
const alive = (s: CourseStage): boolean => { const m = (s as unknown as { boxMesh: { vertexBuffer: unknown } | null }).boxMesh; return m === null || m.vertexBuffer !== null; };

const walls = threeRooms();
const course = generateCourse(freeSpace(walls, { spawn: SPAWN_A }), walls, { seed: 7, scene: { id: '39e63ce9', version: 1 }, transform: IDENTITY });

describe('TR-4: the stage after a hide', () => {
    it('the box mesh is alive for the second show, and the chevrons are drawn again', () => {
        const stage = stageOf();
        const run = new CourseRun(course, { s: 1, t: [0, 0, 0] });
        stage.show(run.gates);
        stage.setNext(0, run.path, true);
        const first = stage.drawn;
        expect(first).toBeGreaterThan(0);
        expect(alive(stage)).toBe(true);
        stage.hide(); // Shift+T off
        expect(stage.drawn).toBe(0);
        expect(alive(stage)).toBe(true);
        stage.show(run.gates); // Shift+T on
        stage.setNext(0, run.path, true);
        expect(stage.drawn).toBe(first);
        expect(alive(stage)).toBe(true);
        stage.dispose();
    });
});

describe('TR-5: a rescale in flight', () => {
    it('the run knows it was laid at another transform', () => {
        const run = new CourseRun(course, { s: 1, t: [0, 0, 0] });
        expect(run.stale({ s: 1, t: [0, 0, 0] })).toBe(false); // control
        expect(run.stale({ s: 0.6, t: [2, 0, 2] })).toBe(true);
    });
});

describe('TR-8: too few gates', () => {
    const fake = (counts: number[]) => {
        const seeds: number[] = [];
        const make = (seed: number): TrackFile => {
            seeds.push(seed);
            const n = counts[seeds.length - 1] ?? 0;
            return { ...course, id: `g1.${seed.toString(36)}`, gates: course.gates.slice(0, 1).concat(Array.from({ length: Math.max(0, n - 1) }, (_, i) => ({ ...course.gates[0]!, id: `x${i}` }))).slice(0, n) } as TrackFile;
        };
        return { make, seeds };
    };

    it('a 1-gate course is retried and a later seed with enough gates wins; the seeds are the same every time', () => {
        const a = fake([1, 6]);
        const got = enoughGates(a.make, 1037613059, 4);
        expect(got.track?.gates.length).toBe(6);
        expect(got.tried).toBe(2);
        const b = fake([1, 6]);
        enoughGates(b.make, 1037613059, 4);
        expect(b.seeds).toEqual(a.seeds);
        expect(a.seeds[0]).toBe(1037613059);
        expect(a.seeds[1]).not.toBe(a.seeds[0]);
    });

    it('under gatesMin every time: no course, flagged short', () => {
        const got = enoughGates(fake([1, 2, 3]).make, 5, 4);
        expect(got.track).toBeNull();
        expect(got.short).toBe(true);
    });

    it('control: enough gates at once is taken at once', () => {
        expect(enoughGates(fake([17]).make, 1, 4).tried).toBe(1);
    });
});
