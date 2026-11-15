// J1 (E5 of train 3): in the edit view the course's arrows between the gates (course/view.ts 'course-chevron', lane
// course4's file) were as thick as in the flight and hid the scan and the handles. The edit view draws them at a share of
// their width: each arrow's x and y scale (its thickness; z is its length) times `share`, its full scale remembered per
// entity so share 1 puts it back. Pure over the node interface below (PlayCanvas GraphNode has it).

/** the part of a PlayCanvas GraphNode this walker reads and writes */
export interface ScaleNode {
    readonly name: string;
    readonly children: readonly ScaleNode[];
    getLocalScale(): { x: number; y: number; z: number };
    setLocalScale(x: number, y: number, z: number): void;
}

/** the entity name course/view.ts gives each arm of an arrow */
export const ARROW_NAME = 'course-chevron';

const full = new WeakMap<object, readonly [number, number, number]>();

/** Every arrow under `root` drawn at `share` of its full width (1: full). Returns how many arrows it set. */
export function shareArrows(root: ScaleNode, share: number): number {
    let n = 0;
    const walk = (node: ScaleNode): void => {
        if (node.name === ARROW_NAME) {
            let f = full.get(node);
            if (!f) {
                const s = node.getLocalScale();
                f = [s.x, s.y, s.z];
                full.set(node, f);
            }
            const s = node.getLocalScale();
            const x = f[0] * share;
            const y = f[1] * share;
            if (s.x !== x || s.y !== y || s.z !== f[2]) node.setLocalScale(x, y, f[2]);
            n++;
        }
        for (const c of node.children) walk(c);
    };
    walk(root);
    return n;
}
