// The open-prop X family (v0.9 lane D): a 5-inch freestyle quad (Nazgul Evoque F5 V3: DJI O4 Air Unit Pro in a camera
// cage, deep stack, two antennas) and a 5-inch race quad (Mach R5 Sport: thin arms, a canopy, a micro analog
// camera, one antenna). Sizes from the Build: the motors sit on the preset's wheelbase diagonal, the discs are its
// prop diameter. Front is -Z. docs/research/drone-models.md section 2.
import { antenna, CORNERS, djiCamera, djiModule, microCam, motor, pack, prop, standoff, strap, DJI_SIZES } from './components';
import type { DjiKind } from './components';
import type { Build } from './build';
import { at, Kit } from './kit';
import type { Model } from './kit';
import { barOutline, cylinder, extrudeOutline, roundedBox, sphere, tube } from './shapes';
import { IDENTITY } from './xform';

export function openX(b: Build): Model {
    const k = new Kit();
    const I = IDENTITY;
    const racer = b.equipment.frame.style === 'racer';
    const a = b.wheelbaseMm / (2 * Math.SQRT2);
    const [canD, canH] = b.canMm;
    const armT = racer ? 4 : 5.5;
    const arm0 = racer ? 12 : 17, arm1 = racer ? 10 : 14;
    const stackH = racer ? 17 : 21;
    const plateT = racer ? 2.2 : 3;
    const bodyW = racer ? 32 : 42, bodyL = racer ? 64 : 80;

    // bottom plate: four arms from the middle, and the body plate over them
    for (const [sx, sz] of CORNERS) k.add('arm', 'carbon', extrudeOutline(barOutline(sx * 8, sz * 8, sx * a, sz * a, arm0, arm1), 0, armT));
    k.add('body-plate', 'carbon', roundedBox(bodyW, armT, bodyL, { radius: 1.2, seg: 2 }), at(I, { at: [0, armT / 2, 0] }));
    if (!racer) {
        // rubber-lined arm guards on a freestyle frame: the injection-moulded arm ends
        for (const [sx, sz] of CORNERS) k.add('arm-guard', 'tpu', roundedBox(arm1 + 3, armT + 2, arm1 + 3, { radius: 3, seg: 3 }), at(I, { at: [sx * a, (armT + 2) / 2 - 1, sz * a] }));
    }

    // stack: standoffs, two boards, the top plate
    const zs = bodyL / 2 - 6;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) standoff(k, at(I, { at: [sx * (bodyW / 2 - 5), armT, sz * zs] }), stackH, 2.1);
    const topY = armT + stackH;
    const zStack = racer ? 6 : 16;
    for (const y of [3.5, 9.5]) k.add('board', 'pcb', roundedBox(30.5, 1.6, 30.5, { radius: 0.5, seg: 1 }), at(I, { at: [0, armT + y, zStack] }));
    k.add('capacitor', 'alu-black', cylinder(3.6, 8, { segments: 16 }), at(I, { at: [6, armT + 4, zStack + 19], rot: [0, 0, 0] }));
    k.add('top-plate', 'carbon', roundedBox(bodyW, plateT, bodyL + 6, { radius: 1.2, seg: 2 }), at(I, { at: [0, topY + plateT / 2, 3] }));

    // the pack on a pad, two straps, the connector at the rear
    const p = b.pack;
    const packY = topY + plateT + 1.6 + p.h / 2;
    const packZ = racer ? 5 : 4;
    k.add('pad', 'rubber', roundedBox(p.w * 0.8, 1.6, p.l * 0.7, { radius: 0.5, seg: 1 }), at(I, { at: [0, topY + plateT + 0.8, packZ] }));
    const PK = at(I, { at: [0, packY, packZ] });
    pack(k, PK, p, b.equipment.battery.connector);
    for (const dz of [-p.l * 0.28, p.l * 0.2]) strap(k, at(PK, { at: [0, 0, dz] }), { w: p.w, h: p.h, len: 12, yBelow: p.h / 2 + 1.6 + plateT });

    // motors and propellers, props in: rear-right clockwise
    const shaftR = 2.5;
    CORNERS.forEach(([sx, sz], i) => {
        const M = at(I, { at: [sx * a, armT, sz * a] });
        const top = motor(k, M, { canD, canH, shaftR });
        prop(k, at(M, { at: [0, top + 1.6, 0] }), { diameter: b.propDiameterMm, blades: b.equipment.prop.blades, pitchRatio: b.equipment.prop.pitchRatio, ccw: (i === 1 || i === 2) });
        // three wires along the arm
        for (const [dx, mat] of [[-1.2, 'wire-red'], [0, 'wire-black'], [1.2, 'wire-black']] as const) {
            k.add('motor-wire', mat, tube([[sx * a + dx, armT + 1, sz * a - sz * canD * 0.3], [sx * a * 0.7 + dx, armT + 1.2, sz * a * 0.7], [sx * 14 + dx, armT + 2, sz * 14]], 0.55, { radial: 6, sub: 3 }), I);
        }
    });

    // video: a DJI unit in a camera cage, or a micro analog camera under a canopy
    const video = b.equipment.video;
    const tilt = b.tiltDeg;
    let camZ: number, camY: number, lensAt: [number, number, number];
    if (video.kind !== 'analog') {
        const kind = video.kind as DjiKind;
        const [cw, ch, cd] = DJI_SIZES[kind].camera;
        camZ = -bodyL / 2 - cd / 2 + 6;
        camY = armT + stackH * 0.55;
        const C = at(I, { at: [0, camY, camZ], rot: [tilt, 0, 0] });
        djiCamera(k, C, kind);
        // the cage: two cheeks and a roof of moulded plastic round the pivoting camera
        for (const sx of [-1, 1]) k.add('cage', 'tpu', roundedBox(2.2, ch + 8, cd + 4, { radius: 0.9, seg: 2 }), at(I, { at: [sx * (cw / 2 + 2), camY, camZ + 1] }));
        k.add('cage-roof', 'tpu', roundedBox(cw + 6.5, 2.2, cd + 4, { radius: 0.9, seg: 2 }), at(I, { at: [0, camY + ch / 2 + 3.2, camZ + 1] }));
        k.add('cage-floor', 'tpu', roundedBox(cw + 6.5, 2.2, cd - 4, { radius: 0.9, seg: 2 }), at(I, { at: [0, camY - ch / 2 - 3.2, camZ + 3] }));
        djiModule(k, at(I, { at: [0, armT + 2 + DJI_SIZES[kind].module[1] / 2 + 0.4, -bodyL / 2 + 21] }), kind);
        k.pin('camera', I, [0, camY, camZ - cd / 2 - 3], [0, 0, -1]);
        lensAt = [0, camY, camZ - cd / 2];
    } else {
        // micro analog camera in the front of the canopy; VTX board on the stack
        camZ = -bodyL / 2 - 4;
        camY = armT + stackH * 0.55;
        microCam(k, at(I, { at: [0, camY, camZ], rot: [tilt, 0, 0] }), { w: 19, h: 19, d: 17, lensR: 6.2 });
        k.add('canopy', 'tpu', sphere(1, { rings: 10, segments: 28 }), at(I, { at: [0, topY - 2, -bodyL * 0.22], scale: [bodyW * 0.52, stackH * 0.66, bodyL * 0.42] }));
        k.add('vtx-board', 'pcb', roundedBox(29, 1.5, 29, { radius: 0.5, seg: 1 }), at(I, { at: [0, topY - 1.2, zStack] }));
        k.add('vtx-shield', 'alu-silver', roundedBox(16, 2, 14, { radius: 0.5, seg: 1 }), at(I, { at: [0, topY - 0.1, zStack - 2] }));
        k.pin('camera', I, [0, camY, camZ - 10], [0, 0, -1]);
        k.pin('vtx', I, [0, topY, zStack], [0, 1, 0]);
        lensAt = [0, camY, camZ];
    }
    void lensAt;

    // antennas
    const ants = b.equipment.antennas;
    for (let i = 0; i < ants; i++) {
        const x = ants === 1 ? 0 : (i === 0 ? -10 : 10);
        antenna(k, at(I, { at: [x, topY + plateT, bodyL / 2 + 1], rot: [0, 0, 0] }), racer ? 52 : 60);
    }

    // pins
    const M0 = [CORNERS[0][0] * a, armT, CORNERS[0][1] * a] as const;
    k.pin('motors', I, [M0[0], armT + canH, M0[2]], [0, 1, 0]);
    k.pin('props', I, [M0[0] + b.propDiameterMm * 0.34, armT + canH + 3.5, M0[2] - b.propDiameterMm * 0.1], [0, 1, 0]);
    k.pin('battery', I, [p.w / 2 + 1, packY, packZ], [1, 0, 0]);
    k.pin('frame', I, [-a * 0.55, armT, -a * 0.55], [0, 1, 0]);

    return k.finish(racer ? [0.88, 0.1, 0.16] : [0.96, 0.46, 0.1]);
}
