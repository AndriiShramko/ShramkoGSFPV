// Lane fix3a, stage X2-gate-one (finding 2 of integration A, message 51): the pilot is told "Fly through gate 1" and gate 1 is
// often behind the spawn (measured in Node, tools/bench/src/gate-one-audit.ts, docs/wip/fix3a.md: on the closed rings the
// nearest gate to the spawn is the last one and gate 1 is out of the spawn view on most seeds). The guide to the next gate:
// where it is against the camera, and where on the screen its arrow goes. Plain arithmetic, no DOM, no engine: the unit test
// (tools/bench/test/course-guide.test.ts) imports it without a page; course/hud.ts draws it.

/** the guide hides when the gate is in the frame and at most this far (design choice, not measured: about two legs' gap) */
export const GUIDE_NEAR_M = 12;
/** the gate counts as in the frame when its centre is inside this share of each half of the view (design choice) */
export const GUIDE_FRAME_SHARE = 0.85;
/** px kept free between the guide and the screen's edge or a block it must not cover (design choice) */
export const GUIDE_MARGIN_PX = 10;

export type V3 = readonly [number, number, number];

/** the camera in the flown world: its place and its right, up and forward unit vectors; tan of the half fovs */
export interface GuideCamera {
    readonly pos: V3;
    readonly right: V3;
    readonly up: V3;
    readonly fwd: V3;
    readonly tanH: number;
    readonly tanV: number;
}

export interface GuideAim {
    /** the gate is in the frame and near: no guide */
    readonly hide: boolean;
    /** whole metres from the camera to the gate's centre */
    readonly metres: number;
    /** behind the camera (forward component <= 0): the arrow goes to the nearer side with a turn mark */
    readonly behind: boolean;
    /** in the frame (then the guide stands over the gate itself) */
    readonly inFrame: boolean;
    /** 'left' or 'right': the side of the gate's horizontal bearing */
    readonly side: 'left' | 'right';
    /** bearing in the camera's frame, deg: 0 ahead, positive right, +-180 behind */
    readonly bearingDeg: number;
    /** screen direction from the view's centre (x right, y down), unit length; the arrow points along it */
    readonly dir: readonly [number, number];
    /** where the gate projects, in halves of the view (-1..1 is on screen); null when behind */
    readonly ndc: readonly [number, number] | null;
}

const dot = (a: V3, b: readonly number[]): number => a[0] * b[0]! + a[1] * b[1]! + a[2] * b[2]!;

/** Where the gate at `gate` stands for the camera `cam`. */
export function aimOf(cam: GuideCamera, gate: V3): GuideAim {
    const d = [gate[0] - cam.pos[0], gate[1] - cam.pos[1], gate[2] - cam.pos[2]];
    const x = dot(cam.right, d), y = dot(cam.up, d), z = dot(cam.fwd, d);
    const metres = Math.round(Math.hypot(d[0]!, d[1]!, d[2]!));
    const bearingDeg = (Math.atan2(x, z) * 180) / Math.PI;
    const side: 'left' | 'right' = x < 0 ? 'left' : 'right';
    if (z <= 1e-6) {
        // behind: the arrow lies on the side the shorter turn goes to, pointing out of the screen sideways
        return { hide: false, metres, behind: true, inFrame: false, side, bearingDeg, dir: [side === 'left' ? -1 : 1, 0], ndc: null };
    }
    const nx = x / z / cam.tanH, ny = -(y / z) / cam.tanV;
    const inFrame = Math.abs(nx) <= GUIDE_FRAME_SHARE && Math.abs(ny) <= GUIDE_FRAME_SHARE;
    const len = Math.hypot(nx, ny);
    const dir: [number, number] = len > 1e-9 ? [nx / len, ny / len] : [0, 1];
    return { hide: inFrame && metres <= GUIDE_NEAR_M, metres, behind: false, inFrame, side, bearingDeg, dir, ndc: [nx, ny] };
}

export interface Box { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number }

/**
 * The guide's centre on a vw x vh screen for a box of w x h: over the gate when it is in the frame, else on the edge along
 * the gate's direction from the centre (behind: half way down the nearer side). Kept GUIDE_MARGIN_PX inside the screen and
 * out of every box in `avoid` (the note, the lap block, the top row): a guide that would meet one goes down under it.
 */
export function placeGuide(a: GuideAim, vw: number, vh: number, w: number, h: number, avoid: readonly Box[]): { x: number; y: number } {
    const m = GUIDE_MARGIN_PX;
    const minX = m + w / 2, maxX = Math.max(minX, vw - m - w / 2);
    const minY = m + h / 2, maxY = Math.max(minY, vh - m - h / 2);
    const cx = vw / 2, cy = vh / 2;
    let x: number, y: number;
    if (a.inFrame && a.ndc) {
        // over the gate: the box's bottom a margin above the gate's centre
        x = cx + (a.ndc[0] * vw) / 2;
        y = cy + (a.ndc[1] * vh) / 2 - h / 2 - m;
    } else {
        // from the centre along dir to the edge of the room the box's centre may use
        const [dx, dy] = a.dir;
        const tx = dx > 0 ? (maxX - cx) / dx : dx < 0 ? (minX - cx) / dx : Infinity;
        const ty = dy > 0 ? (maxY - cy) / dy : dy < 0 ? (minY - cy) / dy : Infinity;
        const t = Math.max(0, Math.min(tx, ty));
        x = cx + dx * t;
        y = cy + dy * t;
    }
    x = Math.min(maxX, Math.max(minX, x));
    y = Math.min(maxY, Math.max(minY, y));
    // under every box it would meet (they all hang from the top); twice, since going down may meet a lower one
    for (let pass = 0; pass < 2; pass++) {
        for (const b of avoid) {
            const meets = x - w / 2 < b.right + m && x + w / 2 > b.left - m && y - h / 2 < b.bottom + m && y + h / 2 > b.top - m;
            if (meets) y = Math.max(y, b.bottom + m + h / 2);
        }
    }
    return { x, y: Math.min(y, Math.max(minY, vh - m - h / 2)) };
}
