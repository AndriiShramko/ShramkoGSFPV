// v0.12 Fly by Sound, lane v12-flight step 10 (docs/wip/v12-plan.md 4.2): the proof that a track file can be flown on the real
// walls of its scan. A track is a chain of gates laid out by hand in the scan frame (plan 2.7); here it is seen as the flight
// sees it: through the scene transform the lesson forces (T(p) = s * p + t, Winter Garden x5), against the scan's own voxel
// walls as the session builds them for flying (the same octree, cells s times larger: transformCollision), with the flight
// model's own overlap and sweep tests (sphereOverlaps, VoxelContactWorld.sweepOne: a sphere swept along a segment is proven
// free by its inflated cover, so no step size can miss a wall).
//
// What is proven, in flown metres, for a margin (default 0.5 m, the plan's number):
//   start     a sphere of the margin's radius at the start pose is free;
//   openings  every gate's opening (its disc or square, from the centre out to the frame) and the frame itself (the ring's tube,
//             the square's bars), swept by a sphere of the margin's radius, touches no wall;
//   legs      the polyline start, gate 1, gate 2, ... swept by a sphere of the margin's radius touches no wall;
//   approach  the straight run through each gate along its axis (up to 3 m before and after) the same;
//   direction every gate's axis (its local -Z, the way it is passed) is within 35 degrees of the leg in, so a pilot who flies the
//             leg crosses the gate forward and inside its opening (the lesson runner's rule, goals.ts: a pass counts only from
//             the gate's +Z side to its -Z side). The leg out is not held to it: after a gate the course may turn back (a
//             crossing of an earlier gate's plane the wrong way is no pass and no miss); its angle is reported.
// And measured, not proven by the threshold: the free radius (the largest sphere that touches no wall, bisection on the same
// overlap test) at the start, over each opening and frame, and every 0.25 m along each leg: the margin the course really has.
// Controls (run every time, in the evidence): the proof is applied at the margin the track really has, plus and minus 2 cm (it
// passes at the lower, fails at the higher); the same track with a gate pushed into the nearest wall, and with a gate carried
// through the wall, each fails in the right place.
//
//   cd tools/bench && npx tsx src/sonic-track-check.ts [--track <file>] [--margin <m>]   (Node only: no browser, no GPU;
//                                                      the scan's walls from .cache/scenes, downloaded once)
// Evidence: evidence/<date>/sonic-track-check.json and sonic-track-check.png (the course seen from above). Exit 1 on a failure.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { parseTrack, trackToObjects, yawQuat } from '../../../packages/sonic-fpv/src';
import type { TrackFile, Vec3 } from '../../../packages/sonic-fpv/src';
import { sphereOverlaps } from '@gsfpv/collision';
import type { VoxelCollision } from '@gsfpv/collision';
import { LESSON_SPEED_MPS, MARGIN_M, checkTrack, flownCollision, flownStart, frame, nearestWall, provenMargin, withGateAt } from '@gsfpv/tracks';
import { REPO, today, writeEvidence } from './evidence';

// The proof itself lives in packages/tracks/src/check.ts (train 1, lane tracks, T1); re-exported here for the tests and
// benches that import it from this file.
export {
    APPROACH_M,
    AXIS_TOLERANCE_DEG,
    CAP_M,
    LESSON_SPEED_MPS,
    MARGIN_M,
    PROBE_STEP_M,
    checkTrack,
    flownCollision,
    freeRadius,
    nearestWall,
    outlineOf,
    provenMargin,
    sweeperOf,
    withGateAt
} from '@gsfpv/tracks';
export type { GateReport, LegReport, Sweeper, TrackReport } from '@gsfpv/tracks';

const DEG = Math.PI / 180;
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec3): Vec3 => mul(a, 1 / (len(a) || 1));
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const r3 = (n: number): number => Math.round(n * 1000) / 1000;
const v3 = (a: Vec3): Vec3 => [r3(a[0]), r3(a[1]), r3(a[2])];
const angleDeg = (a: Vec3, b: Vec3): number => Math.acos(Math.max(-1, Math.min(1, dot(unit(a), unit(b))))) / DEG;

// ------------------------------------------------------------------ a picture from above

function crc32(buf: Uint8Array): number {
    let crc = 0xffffffff;
    for (let n = 0; n < buf.length; n++) {
        let c = (crc ^ buf[n]!) & 0xff;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        crc = (crc >>> 8) ^ c;
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
    const len4 = Buffer.alloc(4);
    len4.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), Buffer.from(data)]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len4, td, crc]);
}

export function pngBytes(w: number, h: number, rgb: Uint8Array): Buffer {
    const raw = Buffer.alloc((w * 3 + 1) * h);
    for (let y = 0; y < h; y++) {
        raw[y * (w * 3 + 1)] = 0;
        Buffer.from(rgb.buffer, rgb.byteOffset + y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1);
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0);
    ihdr.writeUInt32BE(h, 4);
    ihdr[8] = 8;
    ihdr[9] = 2;
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array(0))]);
}

/**
 * The course seen from above, flown metres: a column is dark when a wall stands in it anywhere between the lowest and the
 * highest gate (with the margin above and below), light otherwise; each gate is a bar across its opening, the legs are lines.
 */
export function topView(track: TrackFile, col: VoxelCollision, transform: readonly [number, number, number, number], pxPerM = 12): Buffer {
    const gates = trackToObjects(track, { transform });
    const start = flownStart(track, transform);
    const pts: Vec3[] = [...(start ? [start.pos] : []), ...gates.map((g) => g.pos)];
    const pad = 12;
    const x0 = Math.min(...pts.map((p) => p[0])) - pad, x1 = Math.max(...pts.map((p) => p[0])) + pad;
    const z0 = Math.min(...pts.map((p) => p[2])) - pad, z1 = Math.max(...pts.map((p) => p[2])) + pad;
    const yLo = Math.min(...pts.map((p) => p[1])) - 1, yHi = Math.max(...pts.map((p) => p[1])) + 1;
    const W = Math.ceil((x1 - x0) * pxPerM), H = Math.ceil((z1 - z0) * pxPerM);
    const img = new Uint8Array(W * H * 3).fill(235);
    const cell = 1 / pxPerM;
    for (let j = 0; j < H; j++) {
        for (let i = 0; i < W; i++) {
            const x = x0 + (i + 0.5) * cell, z = z0 + (j + 0.5) * cell;
            let hit = false;
            for (let y = yLo; y <= yHi && !hit; y += 0.5) hit = sphereOverlaps(col, x, y, z, 0.05);
            if (hit) {
                const p = (j * W + i) * 3;
                img[p] = 30;
                img[p + 1] = 30;
                img[p + 2] = 36;
            }
        }
    }
    const put = (x: number, z: number, rgb: readonly number[], r = 1): void => {
        const i = Math.round((x - x0) * pxPerM), j = Math.round((z - z0) * pxPerM);
        for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
            const a = i + di, b = j + dj;
            if (a < 0 || b < 0 || a >= W || b >= H) continue;
            const p = (b * W + a) * 3;
            img[p] = rgb[0]!;
            img[p + 1] = rgb[1]!;
            img[p + 2] = rgb[2]!;
        }
    };
    const line = (a: Vec3, b: Vec3, rgb: readonly number[], r = 1): void => {
        const n = Math.max(2, Math.ceil(len([b[0] - a[0], 0, b[2] - a[2]]) * pxPerM));
        for (let k = 0; k <= n; k++) put(a[0] + ((b[0] - a[0]) * k) / n, a[2] + ((b[2] - a[2]) * k) / n, rgb, r);
    };
    for (let i = 0; i + 1 < pts.length; i++) line(pts[i]!, pts[i + 1]!, [40, 120, 220], 0);
    gates.forEach((g, k) => {
        const { ex } = frame(g);
        const half = g.shape.kind === 'ring' ? g.shape.diameter / 2 : g.shape.kind === 'square' || g.shape.kind === 'cube-frame' ? g.shape.side / 2 : 1;
        line(add(g.pos, mul(ex, -half)), add(g.pos, mul(ex, half)), [230, 90, 20], 1);
        // the way it is passed: a short tick on the -z side
        const ez = frame(g).ez;
        line(g.pos, add(g.pos, mul(ez, -1.5)), [200, 40, 40], 0);
        put(g.pos[0], g.pos[2], [20, 160, 60], 2 + (k === 0 ? 1 : 0));
    });
    if (start) put(start.pos[0], start.pos[2], [20, 60, 220], 3);
    return pngBytes(W, H, img);
}

// ------------------------------------------------------------------ the command

function cliArg(name: string): string | null {
    const i = process.argv.indexOf(name);
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : null;
}

export const DEFAULT_TRACK = join(REPO, 'apps', 'fly', 'public', 'sonic', 'tracks', '7a475d38-rings-v1.json');

async function main(): Promise<void> {
    const file = cliArg('--track') ?? DEFAULT_TRACK;
    const margin = Number(cliArg('--margin') ?? MARGIN_M);
    const parsed = parseTrack(readFileSync(file, 'utf8'));
    if (!parsed.ok) throw new Error(`${file}: ${parsed.issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`);
    const track = parsed.value;
    const { loadScene } = await import('./scenes');
    const scene = await loadScene(track.scene.id);
    const transform = track.transform;
    const col = flownCollision(scene.collision, transform);
    const t0 = performance.now();
    const report = checkTrack(track, col, transform, margin);
    const ms = Math.round(performance.now() - t0);
    const checks: { name: string; pass: boolean; value?: unknown }[] = [];
    const check = (name: string, pass: boolean, value?: unknown): void => {
        checks.push({ name, pass, value });
        console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${value === undefined ? '' : '  ' + JSON.stringify(value).slice(0, 300)}`);
    };
    console.log(`${track.id} v${track.version}: ${track.gates.length} gates, ${report.pathM} m of path, walls ${r3(col.voxelResolution * 100)} cm cells (${scene.metadata.voxelResolution * 100} cm x ${transform[0]}), the proof took ${ms} ms`);
    for (const g of report.gates) console.log(`  gate ${g.id}: centre ${g.centre.join(', ')} d ${g.diameterM} yaw ${g.yawDeg}  free ${g.freeM} m at ${g.freeAt.join(', ')}  axis ${g.axisInDeg} deg off the leg in, turn ${g.turnDeg} deg  ${g.clear && g.directionOk ? 'ok' : 'NOT OK'}`);
    for (const l of report.legs) console.log(`  leg ${l.from} -> ${l.to}: ${l.lengthM} m  free ${l.freeM} m at ${l.at.join(', ')}  ${l.clear ? 'ok' : 'NOT CLEAR'}`);

    check(`start, every opening, every frame, every leg and every run through a gate: a sphere of ${margin} m touches no wall (${track.gates.length} gates, ${report.legs.length} legs, flown at x${transform[0]})`, report.ok, report.issues.length ? report.issues : { minFreeM: report.minFreeM, pathM: report.pathM });
    check('every gate is passed forward: its axis is within 35 degrees of the leg in', report.gates.every((g) => g.directionOk), report.gates.map((g) => [g.id, g.axisInDeg, g.turnDeg]));
    // controls
    const proven = provenMargin(track, col, transform);
    check(`control: the proof is no empty test: the track passes at ${r3(proven - 0.02)} m and fails at ${r3(proven + 0.02)} m (the largest margin it holds is ${r3(proven)} m)`, proven > 0.1 && checkTrack(track, col, transform, proven - 0.02, false).ok && !checkTrack(track, col, transform, proven + 0.02, false).ok, { provenMarginM: r3(proven) });
    const mid = Math.floor(track.gates.length / 2);
    const g = trackToObjects(track, { transform })[mid]!;
    const wall = nearestWall(col, g.pos);
    if (wall) {
        const into = withGateAt(track, mid, add(wall.point, mul(wall.dir, 0.3)), transform);
        const r1 = checkTrack(into, col, transform, margin, false);
        check(`control: gate ${g.id} pushed 0.3 m into the nearest wall (${r3(wall.distance)} m away) is refused, and the refusal names that gate`, !r1.ok && r1.issues.some((s) => s.includes(`gate ${g.id}`)), r1.issues.slice(0, 3));
        const through = withGateAt(track, mid, add(wall.point, mul(wall.dir, 6)), transform);
        const r2 = checkTrack(through, col, transform, margin, false);
        check(`control: gate ${g.id} carried 6 m beyond the nearest wall makes a leg that crosses it, which is refused`, !r2.ok && r2.legs.some((l) => !l.clear), r2.legs.filter((l) => !l.clear).map((l) => `${l.from}->${l.to}`));
    } else check('control: a wall was found near the middle gate to push it into', false);
    const reversed: TrackFile = { ...track, gates: track.gates.map((gt, i) => (i === mid ? { ...gt, quat: yawQuat(180) } : gt)) };
    check('control: a gate turned half way round (its axis against the leg in) is refused as not passed forward', (() => { const r = checkTrack(reversed, col, transform, margin, false); return !r.ok && r.issues.some((s) => s.includes('deg off the leg in')); })(), undefined);

    const stamp = today();
    const dir = join(REPO, 'evidence', stamp);
    mkdirSync(dir, { recursive: true });
    const png = topView(track, col, transform);
    writeFileSync(join(dir, 'sonic-track-check.png'), png);
    const out = writeEvidence('sonic-track-check', {
        step: 'v12-flight 10: the Winter Garden ring track proven clear on the real walls',
        track: { id: track.id, version: track.version, file: file.replace(REPO, '').replace(/\\/g, '/'), gates: track.gates.length, transform },
        walls: { scene: track.scene.id, cm: r3(scene.metadata.voxelResolution * 100), flownCm: r3(col.voxelResolution * 100), sha256: scene.sha256 },
        marginM: margin,
        provenMarginM: r3(proven),
        proofMs: ms,
        estimate: { flightS: Math.round(report.pathM / LESSON_SPEED_MPS), note: 'path length over the lesson speed cap: an estimate, not a flight' },
        report,
        checks,
        pass: checks.every((c) => c.pass)
    });
    console.log(`evidence ${out}; picture evidence/${stamp}/sonic-track-check.png; ${checks.filter((c) => c.pass).length}/${checks.length} checks pass`);
    process.exitCode = checks.every((c) => c.pass) ? 0 : 1;
}

const argv1 = (process.argv[1] ?? '').replace(/\\/g, '/');
if (/\/sonic-track-check\.(ts|js|mjs)$/.test(argv1)) await main();
