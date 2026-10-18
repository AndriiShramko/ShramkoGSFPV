// The ducted families (v0.9 lane D): the 2.2-inch / 1.8-inch HD cinewhoops (Pavo20 Pro, Pavo20 Pro II 3S/4S, Pavo Pico:
// four PA12 ducts touching at their sides, motors on three-spoke mounts, a deck over the middle carrying the DJI unit
// at the front and the pack at the back) and the 65 mm tiny whoops (Meteor65 Pro, Air65: thin ducts, a canopy with
// the analog camera, the 1S pack under the board). Duct and prop sizes come from the Build. Front is -Z.
// docs/research/drone-models.md section 2.
import { antenna, CORNERS, djiCamera, djiModule, DJI_SIZES, microCam, motor, pack, prop, standoff, strap } from './components';
import type { DjiKind } from './components';
import type { Build } from './build';
import { at, Kit } from './kit';
import type { Model } from './kit';
import { cylinder, duct, extrudeOutline, barOutline, roundedBox, sphere, tube } from './shapes';
import { IDENTITY } from './xform';

/** A duct with its motor on a three-spoke mount and the propeller; returns the y of the prop plane. */
function ductWithMotor(k: Kit, b: Build, x: number, z: number, i: number, o: { rIn: number; rOut: number; H: number; shaftR: number; matDuct: 'pa12' | 'plastic'; propAt: number }): number {
    const I = IDENTITY;
    const [canD, canH] = b.canMm;
    k.add('duct', o.matDuct, duct({ inner: o.rIn, outer: o.rOut, height: o.H }), at(I, { at: [x, o.H / 2, z] }));
    const baseY = o.propAt - canH - 1.4;
    const len = o.rIn - canD * 0.45;
    for (let s = 0; s < 3; s++) {
        const ang = 90 + s * 120;
        const rad = (ang * Math.PI) / 180;
        const rc = canD * 0.45 + len / 2;
        k.add('motor-spoke', o.matDuct, roundedBox(len + 1.2, Math.max(1.1, o.H * 0.07), Math.max(1.2, o.rIn * 0.06), { radius: 0.35, seg: 1 }), at(I, { at: [x + Math.cos(rad) * rc, baseY + 0.7, z + Math.sin(rad) * rc], rot: [0, -ang, 0] }));
    }
    const M = at(I, { at: [x, baseY, z] });
    const top = motor(k, M, { canD, canH, shaftR: o.shaftR });
    prop(k, at(M, { at: [0, top + 1.0, 0] }), { diameter: b.propDiameterMm, blades: b.equipment.prop.blades, pitchRatio: b.equipment.prop.pitchRatio, ccw: i === 1 || i === 2 });
    return baseY + top + 1.0;
}

export function cinewhoop(b: Build): Model {
    const k = new Kit();
    const I = IDENTITY;
    const a = b.wheelbaseMm / (2 * Math.SQRT2);
    const D = b.propDiameterMm;
    const rIn = D / 2 + 0.9;
    const wall = Math.max(1.6, Math.min(0.055 * D, a - rIn - 0.3));
    const rOut = rIn + wall;
    const H = 0.42 * D;
    const propAt = H * 0.74;
    let propY = 0;
    CORNERS.forEach(([sx, sz], i) => { propY = ductWithMotor(k, b, sx * a, sz * a, i, { rIn, rOut, H, shaftR: 0.8, matDuct: 'pa12', propAt }); });

    // webs where neighbouring ducts touch, and the carbon plate under the middle
    const gap = Math.max(1.2, 2 * a - 2 * rOut) + 3.6;
    for (const sz of [-1, 1]) k.add('web', 'pa12', roundedBox(gap, H * 0.86, 7, { radius: 0.8, seg: 2 }), at(I, { at: [0, H * 0.43, sz * a] }));
    for (const sx of [-1, 1]) k.add('web', 'pa12', roundedBox(7, H * 0.86, gap, { radius: 0.8, seg: 2 }), at(I, { at: [sx * a, H * 0.43, 0] }));
    for (const [sx, sz] of CORNERS) k.add('plate-arm', 'carbon', extrudeOutline(barOutline(sx * 4, sz * 4, sx * (a * Math.SQRT2 - rIn * 0.78) / Math.SQRT2, sz * (a * Math.SQRT2 - rIn * 0.78) / Math.SQRT2, 9, 6), 1.2, 3.2));

    // deck over the middle: DJI unit at the front, pack at the back
    const video = b.equipment.video;
    const kind = video.kind as DjiKind;
    const [mw, mh, md] = DJI_SIZES[kind].module;
    const [cw, ch, cd] = DJI_SIZES[kind].camera;
    const p = b.pack;
    const deckY = H + 2.4;
    const zModule = -a * 0.42;
    const zPack = zModule + md / 2 + 3 + p.l / 2;
    const zFront = zModule - md / 2 - 3;
    const zRear = zPack + p.l / 2 + 2;
    const deckW = Math.max(p.w + 3, mw * 0.7);
    const deckL = zRear - zFront;
    k.add('deck', 'carbon', roundedBox(deckW, 2, deckL, { radius: 0.8, seg: 2 }), at(I, { at: [0, deckY, (zFront + zRear) / 2] }));
    for (const sz of [-1, 1]) standoff(k, at(I, { at: [0, H * 0.86, sz * a] }), deckY - 1 - H * 0.86, 1.3);
    djiModule(k, at(I, { at: [0, deckY + 1 + mh / 2, zModule] }), kind);
    const camZ = zFront - cd / 2 + 4;
    const camY = deckY + 1 + ch / 2 + 1.5;
    djiCamera(k, at(I, { at: [0, camY, camZ], rot: [b.tiltDeg, 0, 0] }), kind);
    // a small bracket under the camera
    k.add('cam-bracket', 'carbon', roundedBox(cw + 2, 1.6, cd * 0.7, { radius: 0.5, seg: 1 }), at(I, { at: [0, deckY + 1 + 0.8, camZ + 1] }));

    const PK = at(I, { at: [0, deckY + 1 + 1.4 + p.h / 2, zPack] });
    k.add('pack-pad', 'rubber', roundedBox(p.w * 0.8, 1.4, p.l * 0.7, { radius: 0.4, seg: 1 }), at(I, { at: [0, deckY + 1 + 0.7, zPack] }));
    pack(k, PK, p, b.equipment.battery.connector);
    strap(k, at(PK, { at: [0, 0, 0] }), { w: p.w, h: p.h, len: Math.max(6, D * 0.2), yBelow: p.h / 2 + 1.4 + 2 });
    antenna(k, at(I, { at: [0, deckY + 1, zRear] }), D * 0.9);

    // pins
    k.pin('motors', I, [a, propY - 2, -a], [0, 1, 0]);
    k.pin('props', I, [a + D * 0.3, propY + 1.5, -a - D * 0.22], [0, 1, 0]);
    k.pin('battery', I, [p.w / 2 + 1, deckY + 1 + 1.4 + p.h / 2, zPack], [1, 0, 0]);
    k.pin('camera', I, [0, camY, camZ - cd / 2 - 2], [0, 0, -1]);
    k.pin('frame', I, [-a - rOut * 0.7, H * 0.5, a * 0.0 - 2], [-1, 0, 0]);
    return k.finish([0.18, 0.58, 0.98]);
}

export function tinyWhoop(b: Build): Model {
    const k = new Kit();
    const I = IDENTITY;
    const a = b.wheelbaseMm / (2 * Math.SQRT2);
    const D = b.propDiameterMm;
    const rIn = D / 2 + 0.7;
    const wall = Math.max(0.8, Math.min(0.065 * D, a - rIn - 0.3));
    const rOut = rIn + wall;
    const H = 0.36 * D;
    const propAt = H * 0.78;
    let propY = 0;
    CORNERS.forEach(([sx, sz], i) => { propY = ductWithMotor(k, b, sx * a, sz * a, i, { rIn, rOut, H, shaftR: 0.7, matDuct: 'plastic', propAt }); });

    // the body: a bridge across the middle, the board, the canopy, the camera
    const bodyY = H * 0.6;
    k.add('bridge', 'plastic', roundedBox(a * 0.62, 1.6, a * 2.15, { radius: 0.6, seg: 2 }), at(I, { at: [0, bodyY, 0] }));
    for (const sx of [-1, 1]) k.add('bridge-arm', 'plastic', roundedBox(a * 1.05, 1.6, 2.4, { radius: 0.5, seg: 1 }), at(I, { at: [sx * a * 0.52, bodyY, 0] }));
    k.add('board', 'pcb', roundedBox(a * 0.95, 1.1, a * 0.95, { radius: 0.4, seg: 1 }), at(I, { at: [0, bodyY + 1.6, 3] }));
    k.add('canopy', 'plastic', sphere(1, { rings: 10, segments: 28 }), at(I, { at: [0, bodyY + 3.6, -a * 0.18], scale: [a * 0.5, 4.4, a * 0.92], rot: [0, 0, 0] }));
    const camZ = -a * 0.18 - a * 0.92 + 1.5;
    microCam(k, at(I, { at: [0, bodyY + 3.4, camZ], rot: [b.tiltDeg, 0, 0] }), { w: 9.5, h: 9.5, d: 8, lensR: 3 });

    // the 1S pack under the board
    const p = b.pack;
    const PK = at(I, { at: [0, bodyY - 1 - p.h / 2, 3] });
    pack(k, PK, p, b.equipment.battery.connector);

    // the antenna: a thin whip from the back
    k.add('antenna', 'wire-black', tube([[0, bodyY + 2, a * 0.9], [0, bodyY + 6, a * 1.35], [0, bodyY + 16, a * 1.7]], 0.55, { radial: 6, sub: 5, endRadius: 0.45 }), I);

    k.pin('motors', I, [a, propY - 1.5, -a], [0, 1, 0]);
    k.pin('props', I, [a + D * 0.32, propY + 1.2, -a - D * 0.2], [0, 1, 0]);
    k.pin('battery', I, [p.w / 2 + 0.8, bodyY - 1 - p.h / 2, 3], [1, 0, 0]);
    k.pin('camera', I, [0, bodyY + 3.4, camZ - 6], [0, 0, -1]);
    k.pin('vtx', I, [0, bodyY + 2.6, 4], [0, 1, 0]);
    k.pin('frame', I, [-a - rOut * 0.7, H * 0.5, 0], [-1, 0, 0]);
    void cylinder;
    return k.finish([0.1, 0.78, 0.7]);
}
