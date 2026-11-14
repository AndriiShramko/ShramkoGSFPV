// Walls first, then the action (walls stage W3, the owner's rule: an action that needs walls gets them
// by itself and goes on). No DOM and no GPU here, so the order is unit tested
// (tools/bench/test/walls-first.test.ts); walls.ts gives the real steps, the features call withWalls.

/** The steps that bring walls in, in the order they are tried. */
export interface WallsSteps {
    /** the session flies on walls now (shipped, published, built or from the store) */
    has(): boolean;
    /** resolves when the page has decided where its walls come from (the store was asked) */
    ready(): Promise<void>;
    /** walls waiting for the craft to park (from the store): put them in now; true when it did */
    takeQueued(): boolean;
    /** the build in this browser (with its progress line); one at a time */
    build(): Promise<void>;
}

/**
 * Walls for this scan in use, built here only when no other source has them. Calls that come while
 * a build runs wait for that build (one build, never two). Resolves true when the session has walls.
 */
export function ensureWalls(steps: WallsSteps): () => Promise<boolean> {
    let running: Promise<boolean> | null = null;
    const go = async (): Promise<boolean> => {
        if (steps.has()) return true;
        await steps.ready();
        if (steps.has()) return true;
        if (steps.takeQueued() && steps.has()) return true;
        await steps.build();
        // the build left its walls queued for the next start (the pilot flew meanwhile): the action takes them now
        if (!steps.has()) steps.takeQueued();
        return steps.has();
    };
    return () => {
        if (steps.has()) return Promise.resolve(true);
        if (!running) running = go().catch(() => false).finally(() => { running = null; });
        return running;
    };
}

/** What withWalls did: ran at once, ran after a build, or did not run (no walls came, or the scene changed meanwhile). */
export type WithWalls = 'now' | 'built' | 'failed' | 'moved';

/**
 * Run `then` on walls: at once when the scan has them, else after `build` brought them, if the pilot
 * is still on the same scene. `started` runs once when a build has to happen first (a short line).
 */
export async function withWalls(o: { has: () => boolean; build: (() => Promise<boolean>) | null; scene: () => string; started?: () => void; later?: (f: () => void) => void }, then: () => void): Promise<WithWalls> {
    if (o.has()) {
        then();
        return 'now';
    }
    if (!o.build) return 'failed';
    const at = o.scene();
    o.started?.();
    const ok = await o.build();
    if (o.scene() !== at) return 'moved';
    if (!ok || !o.has()) {
        // the build failed: the action is not dropped, it runs when walls come in later (one press of the
        // walls button, not the button and the key again), if the pilot is still on this scene
        o.later?.(() => { if (o.scene() === at && o.has()) then(); });
        return 'failed';
    }
    then();
    return 'built';
}
