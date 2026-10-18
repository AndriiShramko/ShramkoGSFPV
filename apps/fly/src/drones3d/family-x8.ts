// The coaxial X8 cinelifter (v0.9 lane D): iFlight Taurus X8 V3 O4. Four arms, two XING2 3110 motors on each arm end
// (one above pulling, one below, each with an 8-inch tri-blade), two carbon decks with the stack between, the 6S 5600
// pack on top at the back as the counterweight, the DJI O4 Air Unit Pro at the front, two antennas, tall TPU legs.
// The camera is the payload (payloads.ts): a cinema camera hangs under the frame between the legs, the lens ahead of
// the discs; a GoPro stands on the front of the top deck; "none" leaves the empty mount. The body of a camera stays out of
// the propeller discs: its front face is at z = -94 or behind (the discs of the front motors start at |z| = 47 from
// their centres, docs/research/drone-models.md), only the round lens pokes forward between them.
import { antenna, CORNERS, djiCamera, djiModule, DJI_SIZES, motor, pack, prop, standoff, strap } from './components';
import { bmpcc, gopro, komodo } from './cine-cameras';
import type { Build } from './build';
import { at, Kit } from './kit';
import type { Model } from './kit';
import { barOutline, cylinder, extrudeOutline, roundedBox, sphere, tube } from './shapes';
import { IDENTITY } from './xform';

export function x8(b: Build): Model {
    const k = new Kit();
    const I = IDENTITY;
    const a = b.wheelbaseMm / (2 * Math.SQRT2);
    const [canD, canH] = b.canMm;
    const D = b.propDiameterMm;
    const Y = 130, armT = 6;
    const P = b.equipment.prop;

    // arms and the bottom plate
    for (const [sx, sz] of CORNERS) k.add('arm', 'carbon', extrudeOutline(barOutline(sx * 22, sz * 22, sx * a, sz * a, 26, 21), Y, Y + armT));
    k.add('bottom-plate', 'carbon', roundedBox(100, armT, 140, { radius: 2, seg: 2 }), at(I, { at: [0, Y + armT / 2, 0] }));

    // coaxial pairs: the upper motor pulls from above the arm, the lower hangs under it, spinning the other way
    CORNERS.forEach(([sx, sz], i) => {
        const up = at(I, { at: [sx * a, Y + armT, sz * a] });
        const topU = motor(k, up, { canD, canH, shaftR: 2.5 });
        prop(k, at(up, { at: [0, topU + 1.6, 0] }), { diameter: D, blades: P.blades, pitchRatio: P.pitchRatio, ccw: i === 1 || i === 2, hubR: 6 });
        const low = at(I, { at: [sx * a, Y, sz * a], rot: [180, 0, 0] });
        const topL = motor(k, low, { canD, canH, shaftR: 2.5 });
        prop(k, at(I, { at: [sx * a, Y - topL - 1.6, sz * a], rot: [180, 0, 0] }), { diameter: D, blades: P.blades, pitchRatio: P.pitchRatio, ccw: !(i === 1 || i === 2), hubR: 6 });
    });

    // landing legs between the discs, tall enough for the hanging camera
    for (const [sx, sz] of CORNERS) {
        k.add('leg', 'tpu', tube([[sx * 68, Y + 2, sz * 68], [sx * 68, Y * 0.5, sz * 68], [sx * 71, 7, sz * 71]], 4.6, { radial: 12, sub: 6 }), I);
        k.add('foot', 'tpu', roundedBox(28, 5, 28, { radius: 2, seg: 2 }), at(I, { at: [sx * 71, 2.5, sz * 71] }));
    }

    // stack: standoffs, ESC and flight-controller boards, the top deck
    const standH = 34;
    for (const sx of [-1, 1]) for (const sz of [-1, 0, 1]) standoff(k, at(I, { at: [sx * 40, Y + armT, sz * 60] }), standH, 3.2);
    const topY = Y + armT + standH;
    for (const sx of [-1, 1]) k.add('esc', 'pcb', roundedBox(40, 1.8, 40, { radius: 0.8, seg: 1 }), at(I, { at: [sx * 24, Y + armT + 5, 12] }));
    k.add('fc', 'pcb', roundedBox(36, 1.8, 36, { radius: 0.8, seg: 1 }), at(I, { at: [0, Y + armT + 16, 4] }));
    for (const sx of [-1, 1]) k.add('capacitor', 'alu-black', cylinder(7, 16, { segments: 20 }), at(I, { at: [sx * 24, Y + armT + 14, 44] }));
    k.add('top-deck', 'carbon', roundedBox(100, 4, 156, { radius: 2, seg: 2 }), at(I, { at: [0, topY + 2, 3] }));

    // the pack, the counterweight at the back
    const p = b.pack;
    const packZ = 30;
    const PK = at(I, { at: [0, topY + 4 + 1.8 + p.h / 2, packZ] });
    k.add('pad', 'rubber', roundedBox(p.w * 0.8, 1.8, p.l * 0.7, { radius: 0.6, seg: 1 }), at(I, { at: [0, topY + 4 + 0.9, packZ] }));
    pack(k, PK, p, b.equipment.battery.connector);
    for (const dz of [-p.l * 0.3, p.l * 0.22]) strap(k, at(PK, { at: [0, 0, dz] }), { w: p.w, h: p.h, len: 16, yBelow: p.h / 2 + 1.8 + 4 });

    // the O4 Air Unit Pro: module in the stack front, camera on a CNC bracket ahead of the deck
    const kind = b.equipment.video.kind === 'dji-o3' ? 'dji-o3' : 'dji-o4-pro';
    const [, mh] = DJI_SIZES[kind].module;
    const [cw, ch, cd] = DJI_SIZES[kind].camera;
    djiModule(k, at(I, { at: [0, Y + armT + 3 + mh / 2, -42] }), kind);
    const camZ = -78 - cd / 2 + 4, camY = Y + armT + 17;
    djiCamera(k, at(I, { at: [0, camY, camZ], rot: [b.tiltDeg, 0, 0] }), kind);
    for (const sx of [-1, 1]) k.add('fpv-bracket', 'alu-black', roundedBox(3, ch + 10, cd + 4, { radius: 1, seg: 2 }), at(I, { at: [sx * (cw / 2 + 2.5), camY, camZ + 1] }));
    k.add('fpv-bracket-base', 'alu-black', roundedBox(cw + 8, 3, cd * 0.9, { radius: 1, seg: 2 }), at(I, { at: [0, camY - ch / 2 - 2.5, camZ + 3] }));

    // antennas and a GPS puck on a short mast
    for (const sx of [-1, 1]) antenna(k, at(I, { at: [sx * 38, topY + 4, 79] }), 95);
    k.add('gps-mast', 'rubber', cylinder(2.2, 26, { segments: 10 }), at(I, { at: [0, topY + 4 + 13, 70] }));
    k.add('gps-puck', 'plastic', cylinder(14, 6, { segments: 28, bevel: 1.4 }), at(I, { at: [0, topY + 4 + 29, 70] }));

    // the camera
    const payload = b.payload ?? 'none';
    const hangY = Y - 9;
    // the aluminium camera mount: a dampened carbon base under the bottom plate and a block that holds the camera
    k.add('mount-base', 'carbon', roundedBox(72, 4, 104, { radius: 1.5, seg: 2 }), at(I, { at: [0, Y - 3, -42] }));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.add('damper', 'rubber', sphere(3.6, { rings: 6, segments: 12 }), at(I, { at: [sx * 28, Y - 1.2, -42 + sz * 40] }));
    k.add('mount-block', 'alu-black', roundedBox(60, 5.5, 60, { radius: 1.5, seg: 2 }), at(I, { at: [0, hangY + 2.8, -42] }));
    let payloadPin: [number, number, number] | null = null;
    let payloadId: 'payload' | 'action' = 'payload';
    if (payload === 'komodo') {
        const h = komodo(k, at(I, { at: [0, hangY, -43.2] }));
        payloadPin = [101.6 / 2 + 1, hangY - h / 2, -43.2];
    } else if (payload === 'bmpcc6kpro') {
        const h = bmpcc(k, at(I, { at: [0, hangY, -41] }));
        payloadPin = [90 + 1, hangY - h / 2, -41];
    } else if (payload === 'gopro13') {
        gopro(k, at(I, { at: [0, topY + 4, -52] }));
        payloadPin = [36, topY + 4 + 30, -52];
        payloadId = 'action';
    }

    // pins
    k.pin('motors', I, [a, Y + armT + canH + 0.5, -a], [0, 1, 0]);
    k.pin('props', I, [a + D * 0.34, Y + armT + canH + 3, -a - D * 0.12], [0, 1, 0]);
    k.pin('battery', I, [p.w / 2 + 1, topY + 4 + 1.8 + p.h / 2, packZ], [1, 0, 0]);
    k.pin('camera', I, [0, camY, camZ - cd / 2 - 2], [0, 0, -1]);
    k.pin('frame', I, [-a * 0.5, Y + armT, -a * 0.5], [0, 1, 0]);
    if (payloadPin) k.pin(payloadId, I, payloadPin, [1, 0, 0]);
    return k.finish([0.86, 0.68, 0.32]);
}
