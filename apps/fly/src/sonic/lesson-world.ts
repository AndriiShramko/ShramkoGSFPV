// A lesson world as the flight page flies it (v0.12 Fly by Sound, docs/wip/v12-plan.md 2.5 and 4.2 step 1).
//
// The sound package builds the world from its spec (@shramko/sonic-fpv createAnalyticWorld: a signed
// distance function, seeded and deterministic, named by its digest). The page flies it without any scan:
//   - walls: the same geometry seen as voxels at the world's voxelM (@gsfpv/collision analyticCollision,
//     a voxel is solid where solidAt says at its centre; the distance culls the lookup by cells and the
//     contact world's overlap tests in open air, AnalyticContactWorld);
//   - the walls' name in every life header is the world's digest, so a lesson's log replays on walls
//     rebuilt from the same spec, and on no others (session/replay.ts lifeProblem);
//   - the scene is made in memory: id lesson-<lesson id>, never a hex SuperSplat id, so the scene
//     library and the CDN never see it; nothing to draw (the helper's view is primitives, step 6);
//   - the craft starts at the lesson's start (or the world's own when the lesson gives none).
// Sound reads the same world through the contract's SonicWorld (castRay, objects).
import { createAnalyticWorld, makeSpec } from '@shramko/sonic-fpv';
import type { AnalyticWorldInfo, AnalyticWorldSpec, LessonDef, Pose } from '@shramko/sonic-fpv';
import { AnalyticContactWorld, analyticCollision } from '@gsfpv/collision';
import type { AnalyticVoxelCollision } from '@gsfpv/collision';
import type { ResolvedScene } from '@gsfpv/scenes';
import type { BuiltinWorld } from '../session';

/** Every built-in scene id starts with this; a SuperSplat id is hex, so the two never meet. */
export const LESSON_SCENE_PREFIX = 'lesson-';
/** The clear colour of a lesson world: a dark room, the primitives drawn light on it (step 6). */
export const LESSON_BACKGROUND: readonly number[] = [0.02, 0.02, 0.03];

/** A lesson id as the URL and the progress use it (sonic-fpv lesson ids): lower case, digits, dashes. */
const LESSON_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** The scene id a lesson world flies under; throws for an id that is not a lesson id. */
export function lessonSceneId(lessonId: string): string {
    if (!LESSON_ID.test(lessonId)) throw new RangeError(`not a lesson id: ${JSON.stringify(lessonId)}`);
    return `${LESSON_SCENE_PREFIX}${lessonId}`;
}

/** A scene id of a built-in lesson world (never a scan). */
export function isLessonScene(sceneId: string): boolean {
    return sceneId.startsWith(LESSON_SCENE_PREFIX);
}

/** A lesson world, built once: what sound reads, the walls the flight model flies, and the session's option. */
export interface LessonWorld {
    /** the world as sound reads it (rays with material, objects) and as the lessons place things in it */
    readonly world: AnalyticWorldInfo;
    /** the flight model's walls (the world seen as voxels) */
    readonly collision: AnalyticVoxelCollision;
    /** SessionOptions.world */
    readonly builtin: BuiltinWorld;
}

/** The in-memory scene of a built-in world: no camera, no content, no walls file. */
function memoryScene(id: string, version: number): ResolvedScene {
    return {
        id,
        version,
        settings: {},
        camera: null,
        contentUrl: '',
        contentKind: 'meta',
        content: [],
        collisionUrl: null,
        background: [...LESSON_BACKGROUND],
        tonemapping: undefined
    };
}

/**
 * Builds the world of `spec` for the scene `sceneId` (lessonSceneId). `start`: where the craft starts
 * (a lesson's own start); none = the world's. Throws the sound package's WorldSpecError for a spec this
 * build cannot build.
 */
export function buildLessonWorld(spec: AnalyticWorldSpec, sceneId: string, start?: Pose): LessonWorld {
    if (!isLessonScene(sceneId)) throw new RangeError(`a built-in world needs a ${LESSON_SCENE_PREFIX} scene id, got ${JSON.stringify(sceneId)}`);
    const world = createAnalyticWorld(spec);
    const collision = analyticCollision(world.bounds.min, world.bounds.max, world.voxelM, world.solidAt, world.sdf);
    const at = start ?? world.start;
    const builtin: BuiltinWorld = {
        scene: memoryScene(sceneId, world.version),
        collision,
        contact: new AnalyticContactWorld(collision),
        sha256: world.digest,
        spawn: [at.pos[0], at.pos[1], at.pos[2], at.yawDeg]
    };
    return { world, collision, builtin };
}

/** The world a lesson flies in, or null for a lesson without an analytic world (module 0, or a scan lesson). */
export function lessonWorldOf(lesson: LessonDef): LessonWorld | null {
    if (lesson.world.kind !== 'analytic') return null;
    return buildLessonWorld(lesson.world.spec, lessonSceneId(lesson.id), lesson.start);
}

/**
 * The world the helper's view draws for a lesson (a replay draws each lesson of a recording, v12-int step 5): the lesson's own,
 * the floor of an ears lesson (as lessonFlightWorld flies it), null for a scan lesson. Only the analytic world, without the walls
 * the flight model would need: cheap enough to make at every change of lesson in a replay.
 */
export function lessonViewWorld(lesson: LessonDef): AnalyticWorldInfo | null {
    if (lesson.world.kind === 'scan') return null;
    return createAnalyticWorld(lesson.world.kind === 'analytic' ? lesson.world.spec : makeSpec('open', { startHeightM: lesson.start.pos[1] }));
}

/**
 * The world the page flies while a lesson runs: the lesson's own; for the ears lessons (module 0: no world, the sources
 * are placed by the lesson alone) a floor and nothing else, so the page still has a craft that hovers at the lesson's
 * start; null for a scan lesson (module 7), which flies the scan itself.
 */
export function lessonFlightWorld(lesson: LessonDef): LessonWorld | null {
    if (lesson.world.kind === 'scan') return null;
    return lessonWorldOf(lesson) ?? buildLessonWorld(makeSpec('open', { startHeightM: lesson.start.pos[1] }), lessonSceneId(lesson.id), lesson.start);
}
