// Lab page for the helper's view of Fly by Sound worlds (v0.12 lane v12-flight step 6, docs/wip/v12-plan.md 4.2): the
// real renderer of the simulator (SplatRenderer on WebGPU, else WebGL2) on a full-window canvas, a lesson world drawn as
// primitives by the page's own PrimitiveStage on the lesson background, the camera set from outside. No flight, no
// session. /fly/lab/sonic-primitives.html on the dev server (not in the production inputs of vite.config.ts);
// window.__sonicLab is what tools/bench/src/sonic-primitives-shot.ts drives.
import { SplatRenderer } from '@gsfpv/render-pc';
import { getLesson, quatAxisAngle, quatMultiply, trackToObjects, yawQuat } from '@shramko/sonic-fpv';
import type { SceneTransform, SonicObject, TrackFile, Vec3 } from '@shramko/sonic-fpv';
import { LESSON_BACKGROUND, lessonWorldOf } from '../src/sonic/lesson-world';
import { PrimitiveStage, objectPrims, worldPrims } from '../src/sonic/primitives';

const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = await SplatRenderer.create(canvas, { renderScale: 1, hFovDeg: 100 });
renderer.setBackground([...LESSON_BACKGROUND]);
renderer.start();
const stage = new PrimitiveStage(renderer);

/** The camera at `pos`, nose along yawDeg (0 = -Z, positive turns right), looking `pitchDeg` up. */
function look(pos: Vec3, yawDeg: number, pitchDeg = 0): void {
    const q = quatMultiply(yawQuat(yawDeg), quatAxisAngle([1, 0, 0], (pitchDeg * Math.PI) / 180));
    renderer.setPose(pos[0], pos[1], pos[2], q[0], q[1], q[2], q[3], 0);
}

/** Shows the world of a lesson; returns what the page needs to place the camera. */
function showLesson(lessonId: string): { prims: number; start: { pos: Vec3; yawDeg: number }; bounds: { min: Vec3; max: Vec3 }; landmarks: { id: string; pos: Vec3 }[]; objects: { id: string; pos: Vec3 }[] } {
    const lesson = getLesson(lessonId);
    const lw = lessonWorldOf(lesson);
    if (!lw) throw new Error(`lesson ${lessonId} has no analytic world`);
    stage.show(worldPrims(lw.world));
    return { prims: stage.count, start: lesson.start, bounds: lw.world.bounds, landmarks: [...lw.world.landmarks], objects: lw.world.objects().map((o) => ({ id: o.id, pos: o.pos })) };
}

/** Shows only objects (a scan's gates through the scene transform, or any list). */
function showObjects(objects: readonly SonicObject[]): number {
    stage.show(objectPrims(objects));
    return stage.count;
}

/** A track's gates in the flown world through `transform`. */
function showTrack(track: TrackFile, transform: SceneTransform): number {
    return showObjects(trackToObjects(track, { transform }));
}

const frames = { n: 0 };
renderer.app.on('frameend', () => { frames.n++; });

(window as unknown as { __sonicLab: unknown }).__sonicLab = {
    ready: true,
    isWebGPU: renderer.isWebGPU,
    frames,
    look,
    showLesson,
    showObjects,
    showTrack,
    setTarget: (id: string | null) => stage.setTarget(id),
    objectIds: () => stage.objectIds,
    count: () => stage.count
};
