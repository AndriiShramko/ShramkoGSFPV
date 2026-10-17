// The cameras a cinelifter may carry (v0.9 lane D, payloads.ts): RED KOMODO 6K and Blackmagic Pocket Cinema Camera 6K
// Pro with a lens, hung under the frame; a GoPro HERO13 Black standing on the top deck. Body sizes are the makers'
// (4 x 4 x 4 in; 180 x 112 x 123 mm; 71.8 x 50.8 x 33.6 mm); the lens is a compact prime of typical size (the makers
// of the drone name none). No logos. The lens points to -Z. docs/research/drone-models.md section 1.
import { cylinder, ring, roundedBox } from './shapes';
import { lens } from './components';
import type { Kit } from './kit';
import { at } from './kit';
import type { Affine } from './xform';

/** A lens with three rubber grip rings, its back at the origin of T and pointing to -Z. */
function cineLens(kit: Kit, T: Affine, r: number, len: number, glassR: number): void {
    lens(kit, T, { r, len, glassR });
    const A = at(T, { rot: [-90, 0, 0] });
    for (const f of [0.18, 0.34, 0.5]) kit.add('lens-grip', 'rubber', ring(r * 0.98, r * 1.04, len * 0.07, { segments: 40 }), at(A, { at: [0, len * f, 0] }));
}

/**
 * A cinema body hung from its top face: the origin is the middle of the top face, the body fills y in [-h, 0].
 * `komodo`: a 101.6 mm cube with the mount ring, side vents and a media door. Returns the camera's height h.
 */
export function komodo(kit: Kit, T: Affine): number {
    const s = 101.6;
    const B = at(T, { at: [0, -s / 2, 0] });
    kit.add('komodo-body', 'cine-body', roundedBox(s, s, s, { radius: 4.5, seg: 3 }), B);
    kit.add('komodo-mount', 'alu-silver', ring(31, 37, 3.4, { segments: 48 }), at(B, { at: [0, 0, -s / 2 - 1.4], rot: [90, 0, 0] }));
    cineLens(kit, at(B, { at: [0, 0, -s / 2 - 2] }), 33, 88, 25);
    // vents on the left, the media door on the right, two threaded inserts on top, a port panel at the back
    for (let i = 0; i < 6; i++) kit.add('komodo-vent', 'rubber', roundedBox(0.8, 3, 52, { radius: 0.3, seg: 1 }), at(B, { at: [-s / 2 - 0.1, -s * 0.28 + i * 11, 6] }));
    kit.add('komodo-door', 'alu-black', roundedBox(0.8, 46, 40, { radius: 0.5, seg: 1 }), at(B, { at: [s / 2 + 0.1, 8, 12] }));
    for (const sz of [-1, 1]) kit.add('komodo-insert', 'alu-silver', cylinder(3.2, 1.4, { segments: 16 }), at(B, { at: [0, s / 2 + 0.5, sz * 24] }));
    kit.add('komodo-ports', 'rubber', roundedBox(64, 30, 1.2, { radius: 0.5, seg: 1 }), at(B, { at: [0, -12, s / 2 + 0.2] }));
    for (let i = 0; i < 4; i++) kit.add('komodo-port', 'alu-silver', cylinder(3.4, 1.6, { segments: 12 }), at(B, { at: [-21 + i * 14, -12, s / 2 + 1.2], rot: [90, 0, 0] }));
    return s;
}

/** Blackmagic Pocket Cinema Camera 6K Pro: body, rear screen, EF lens, hung from its top face. Returns h. */
export function bmpcc(kit: Kit, T: Affine): number {
    const w = 180, h = 112, bodyD = 106;
    const B = at(T, { at: [0, -h / 2, 0] });
    kit.add('bmpcc-body', 'cine-body', roundedBox(w, h, bodyD, { radius: 6, seg: 3 }), B);
    // the grip on the right
    kit.add('bmpcc-grip', 'rubber', roundedBox(34, h * 0.96, bodyD * 0.6, { radius: 6, seg: 3 }), at(B, { at: [w / 2 - 17, 0, bodyD * 0.1] }));
    // the tilting 5-inch screen at the back
    kit.add('bmpcc-screen-frame', 'cine-body', roundedBox(w * 0.82, h * 0.78, 14, { radius: 3, seg: 2 }), at(B, { at: [-6, 0, bodyD / 2 + 6] }));
    kit.add('bmpcc-screen', 'screen', roundedBox(w * 0.74, h * 0.66, 1.2, { radius: 1, seg: 1 }), at(B, { at: [-6, 0, bodyD / 2 + 13.2] }));
    kit.add('bmpcc-mount', 'alu-silver', ring(32, 39, 3.4, { segments: 48 }), at(B, { at: [0, 0, -bodyD / 2 - 1.2], rot: [90, 0, 0] }));
    cineLens(kit, at(B, { at: [0, 0, -bodyD / 2 - 2] }), 36, 92, 28);
    kit.add('bmpcc-top-knob', 'alu-silver', cylinder(5, 3, { segments: 16 }), at(B, { at: [-30, h / 2 + 1, -20] }));
    return h;
}

/** GoPro HERO13 Black standing on y = 0, lens to -Z, with its two folding mounting fingers underneath. */
export function gopro(kit: Kit, T: Affine): void {
    const w = 71.8, h = 50.8, d = 33.6;
    const B = at(T, { at: [0, h / 2 + 4, 0] });
    kit.add('gopro-body', 'plastic', roundedBox(w, h, d, { radius: 6, seg: 3 }), B);
    lens(kit, at(B, { at: [-w * 0.2, h * 0.16, -d / 2 + 0.4] }), { r: 11, len: 5, glassR: 8.4 });
    kit.add('gopro-display', 'screen', roundedBox(24, 17, 0.8, { radius: 1.2, seg: 1 }), at(B, { at: [w * 0.22, h * 0.27, -d / 2 - 0.1] }));
    kit.add('gopro-display-2', 'screen', roundedBox(w * 0.34, h * 0.28, 0.8, { radius: 1.2, seg: 1 }), at(B, { at: [w * 0.2, -h * 0.2, -d / 2 - 0.1] }));
    for (const dx of [-5, 0, 5]) kit.add('gopro-finger', 'plastic', roundedBox(3.2, 14, d * 0.7, { radius: 0.8, seg: 1 }), at(T, { at: [dx, 2.5, 0] }));
    kit.add('gopro-mount', 'tpu', roundedBox(w * 0.8, 3, d * 1.05, { radius: 1, seg: 1 }), at(T, { at: [0, -0.5, 1] }));
}
