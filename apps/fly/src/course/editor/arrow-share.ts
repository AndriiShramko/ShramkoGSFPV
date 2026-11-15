// J1 (E5 of train 3): in the edit view the course's arrows between the gates (course/view.ts 'course-chevron', lane
// course4's file) were as thick as in the flight and hid the scan and the handles. The edit view draws them at a share of
// their width: each arrow's x and y scale (its thickness; z is its length) times `share`, its full scale remembered per
// entity so share 1 puts it back. Pure over the node interface below (PlayCanvas GraphNode has it).
// Review EJ-4: a chevron about 2 m from the edit eye was still a wide band across the view at a third of its width; an
// arrow nearer the eye than ARROW_NEAR_M is thinner still, in proportion to its distance (never under ARROW_NEAR_MIN).

/** the part of a PlayCanvas GraphNode this walker reads and writes */
export interface ScaleNode {
    readonly name: string;
    readonly children: readonly ScaleNode[];
    getLocalScale(): { x: number; y: number; z: number };
    setLocalScale(x: number, y: number, z: number): void;
    /** the node's world position (PlayCanvas GraphNode.getPosition) */
    getPosition?(): { x: number; y: number; z: number };
}

/** the entity name course/view.ts gives each arm of an arrow */
export const ARROW_NAME = 'course-chevron';
/** the entity name of course/view.ts CourseStage's root (a child of the app's root): the walk starts there, not at the scene */
export const STAGE_NAME = 'course-stage';
/** an arrow nearer the edit eye than this (m) is drawn thinner in proportion to its distance (design estimate) */
export const ARROW_NEAR_M = 6;
/** the least share of `share` the nearness leaves (an arrow at the eye is still a hairline, not gone; design estimate) */
export const ARROW_NEAR_MIN = 0.15;

const full = new WeakMap<object, readonly [number, number, number]>();

/** the factor on `share` for an arrow `d` metres from the eye: 1 from ARROW_NEAR_M on, linear down to ARROW_NEAR_MIN */
export function nearShare(d: number): number {
    return Math.max(ARROW_NEAR_MIN, Math.min(1, d / ARROW_NEAR_M));
}

/**
 * Every arrow under `root` drawn at `share` of its full width (1: full); with `eye` (world, the edit view's) an arrow near it
 * thinner still (nearShare). Returns how many arrows it set.
 */
export function shareArrows(root: ScaleNode, share: number, eye: readonly number[] | null = null): number {
    let n = 0;
    const walk = (node: ScaleNode): void => {
        if (node.name === ARROW_NAME) {
            let f = full.get(node);
            if (!f) {
                const s = node.getLocalScale();
                f = [s.x, s.y, s.z];
                full.set(node, f);
            }
            let k = share;
            const p = eye && eye.length >= 3 ? node.getPosition?.() : undefined;
            if (p && eye) k *= nearShare(Math.hypot(p.x - eye[0]!, p.y - eye[1]!, p.z - eye[2]!));
            const s = node.getLocalScale();
            const x = f[0] * k;
            const y = f[1] * k;
            if (s.x !== x || s.y !== y || s.z !== f[2]) node.setLocalScale(x, y, f[2]);
            n++;
        }
        for (const c of node.children) walk(c);
    };
    walk(root);
    return n;
}
