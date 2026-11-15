// Lane sonic4, V1 left item 3: why the racing line (package cues/line.ts) makes the 2 m/s Wroclaw course fail on the gate
// frames. Node only, no page, no GPU. For each gate of an N course it measures the smoothed line where it meets the gate:
// the angle between the line and the gate's axis, where the line crosses the gate's plane, and where the chord the pilot
// flies (pure pursuit of the look-ahead point, LINE_LOOK_S x v, at least LINE_LOOK_MIN_M) crosses it; then, from the
// measuring tool's failure records (sonic-speed-measure.ts --out), where the craft was in the failing gate's frame.
//
//   cd tools/bench && npx tsx src/sonic-line-gate-audit.ts --walls <dir> --scene 70b50d42 --spawn x,y,z
//       --track <track.json> [--flights <sonic-speed-measure out.json>] [--speeds 2,5,8,12]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { openVoxelCollision } from '@gsfpv/collision';
import type { VoxelMetadata } from '@gsfpv/collision';
import type { SonicObject, TrackFile, Vec3 } from '../../../packages/sonic-fpv/src';
import { BODY_RADIUS_M } from '../../../packages/sonic-fpv/src/lesson';
import { LINE_LOOK_MIN_M, LINE_LOOK_S, RacingLine } from '../../../packages/sonic-fpv/src/cues/line';
import { toLocal } from '../../../packages/sonic-fpv/src/lesson/goals';
import { buildScanLesson } from '../../../apps/fly/src/sonic/scan-lesson';

function arg(name: string): string | null {
    const i = process.argv.indexOf(name);
    return i >= 0 && process.argv[i + 1] ? (process.argv[i + 1] as string) : null;
}
const r2 = (x: number): number => Math.round(x * 100) / 100;
const median = (a: readonly number[]): number => {
    if (a.length === 0) return NaN;
    const s = [...a].sort((x, y) => x - y);
    return s[Math.floor((s.length - 1) / 2)] as number;
};

/**
 * The clear half size of an opening for the craft's body, m: a ring's inner radius minus half the tube, a square's half side
 * minus half the bar, each minus the body radius. Offsets are measured the same way: round for a ring, square for a square.
 */
function clearRadius(g: SonicObject): number {
    const s = g.shape as { kind: string; diameter?: number; tube?: number; side?: number; bar?: number };
    if (s.kind === 'ring' && s.diameter !== undefined) return s.diameter / 2 - (s.tube ?? 0) / 2 - BODY_RADIUS_M;
    if ((s.kind === 'square' || s.kind === 'cube-frame') && s.side !== undefined) return s.side / 2 - (s.bar ?? 0) / 2 - BODY_RADIUS_M;
    return NaN;
}
function offsetOf(g: SonicObject, x: number, y: number): number {
    return g.shape.kind === 'ring' ? Math.hypot(x, y) : Math.max(Math.abs(x), Math.abs(y));
}

/** Where the segment a -> b crosses the gate's plane (local z = 0), in the gate's frame; null when it does not. */
function crossing(g: SonicObject, a: Vec3, b: Vec3): { x: number; y: number; forward: boolean } | null {
    const la = toLocal(g, a);
    const lb = toLocal(g, b);
    if (Math.sign(la[2]) === Math.sign(lb[2]) || la[2] === lb[2]) return null;
    const w = la[2] / (la[2] - lb[2]);
    return { x: la[0] + (lb[0] - la[0]) * w, y: la[1] + (lb[1] - la[1]) * w, forward: la[2] > 0 };
}

function main(): void {
    const dir = arg('--walls');
    const trackFile = arg('--track');
    if (!dir || !trackFile) throw new Error('--walls and --track are needed');
    const scene = arg('--scene') ?? 'scan';
    const spawn = (arg('--spawn') ?? '0,0,0').split(',').map(Number) as unknown as Vec3;
    const speeds = (arg('--speeds') ?? '2,5,8,12').split(',').map(Number);
    const meta = JSON.parse(readFileSync(join(dir, 'scene.voxel.json'), 'utf8')) as VoxelMetadata;
    let bin: Uint8Array = readFileSync(join(dir, 'scene.voxel.bin'));
    if (bin[0] === 0x1f && bin[1] === 0x8b) bin = gunzipSync(bin);
    const col = openVoxelCollision(meta, bin);
    const track = JSON.parse(readFileSync(trackFile, 'utf8')) as TrackFile;
    const src = { collision: () => col as never, transform: () => ({ s: 1, t: [0, 0, 0] }) };
    const scan = buildScanLesson(track, { sceneId: scene, sceneVersion: 1, src, spawn: { pos: spawn, yawDeg: 0 } }, { course: true });
    const cps = ((scan.world as unknown as { checkpoints?: readonly { pos: Vec3 }[] }).checkpoints ?? []).map((c) => c.pos);
    // the runner builds the line from the start and the track's points (runner.ts lineTarget); a scan course's track is the
    // world's checkpoints (track.ts lessonTrack 'world')
    const line = new RacingLine([scan.start.pos, ...cps]);
    const pts = line.points;
    const cum: number[] = [0];
    for (let i = 1; i < pts.length; i++) cum.push((cum[i - 1] as number) + Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1], pts[i]![2] - pts[i - 1]![2]));
    const gates = [...scan.objects].filter((o) => o.order !== null).sort((a, b) => (a.order as number) - (b.order as number));
    const rows: object[] = [];
    const chordAt = new Map<string, Record<string, number | string>>();
    const angles: number[] = [];
    const lineOff: number[] = [];
    const chordOff: Record<number, number[]> = {};
    const chordMiss: Record<number, number> = {};
    let lineMiss = 0;
    let lineBackward = 0;
    let from = 0;
    for (const g of gates) {
        const clear = clearRadius(g);
        // the line's crossing of this gate's plane: the first one after the previous gate's crossing
        let at: { i: number; x: number; y: number; forward: boolean } | null = null;
        for (let i = from; i < pts.length - 1 && at === null; i++) {
            const c = crossing(g, pts[i] as Vec3, pts[i + 1] as Vec3);
            if (c !== null && Math.hypot(c.x, c.y) < 3) at = { i, ...c };
        }
        if (at === null) {
            rows.push({ gate: g.id, line: 'no crossing within 3 m of the centre' });
            lineMiss++;
            continue;
        }
        from = at.i + 1;
        const sG = cum[at.i] as number;
        const a = line.pointAt(sG - 1);
        const b = line.pointAt(sG + 1);
        const la = toLocal(g, a);
        const lb = toLocal(g, b);
        const t = [lb[0] - la[0], lb[1] - la[1], lb[2] - la[2]];
        const tl = Math.hypot(t[0]!, t[1]!, t[2]!) || 1;
        // the gate is passed from +Z to -Z: the axis in the gate's frame is (0, 0, -1)
        const angle = (Math.acos(Math.max(-1, Math.min(1, -t[2]! / tl))) * 180) / Math.PI;
        const off = offsetOf(g, at.x, at.y);
        angles.push(angle);
        lineOff.push(off);
        if (!at.forward) lineBackward++;
        if (off > clear) lineMiss++;
        const chords: Record<string, number | string> = {};
        for (const v of speeds) {
            const look = Math.max(LINE_LOOK_MIN_M, LINE_LOOK_S * v);
            // pure pursuit: the craft at s - look/2 flies toward s + look/2; its chord crosses the plane here
            const c = crossing(g, line.pointAt(sG - look / 2), line.pointAt(sG + look / 2));
            const d = c === null ? NaN : offsetOf(g, c.x, c.y);
            (chordOff[v] ??= []).push(d);
            if (!(d <= clear)) chordMiss[v] = (chordMiss[v] ?? 0) + 1;
            chords[`${v}`] = c === null ? 'no crossing' : r2(d);
        }
        chordAt.set(g.id, chords);
        rows.push({ gate: g.id, clearM: r2(clear), angleDeg: r2(angle), lineOffM: r2(off), forward: at.forward, chordOffM: chords });
    }
    process.stdout.write(`course ${track.id}: ${gates.length} gates, line ${r2(line.lengthM)} m from ${cps.length} checkpoints\n`);
    process.stdout.write(`clear half size ring ${r2(clearRadius(gates.find((g) => g.shape.kind === 'ring') ?? (gates[0] as SonicObject)))} m, square ${r2(clearRadius(gates.find((g) => g.shape.kind === 'square') ?? (gates[0] as SonicObject)))} m; line vs gate axis median ${r2(median(angles))} deg, max ${r2(Math.max(...angles))} deg, over 30 deg ${angles.filter((x) => x > 30).length}; line crossing off centre median ${r2(median(lineOff))} m, max ${r2(Math.max(...lineOff))} m; line outside the clear radius ${lineMiss}; line crossing from the exit side ${lineBackward}\n`);
    for (const v of speeds) process.stdout.write(`pursuit chord at ${v} m/s (look ${Math.max(LINE_LOOK_MIN_M, LINE_LOOK_S * v)} m): off centre median ${r2(median((chordOff[v] ?? []).filter(Number.isFinite)))} m, outside the clear radius ${chordMiss[v] ?? 0} of ${gates.length}\n`);
    if (process.argv.includes('--rows')) for (const r of rows) process.stdout.write(`${JSON.stringify(r)}\n`);
    const flightsFile = arg('--flights');
    if (flightsFile) {
        const d = JSON.parse(readFileSync(flightsFile, 'utf8')) as { flights: { speedMps: number; seed: number; line: boolean; why: string; passed: boolean; tail: { target: string | null; frames: { t: number; pos: Vec3; planned: string[] }[] } | null }[] };
        for (const f of d.flights) {
            if (f.passed || f.tail === null) continue;
            const g = gates.find((x) => x.id === f.tail?.target);
            const last = f.tail.frames[f.tail.frames.length - 1];
            if (!g || !last) continue;
            const l = toLocal(g, last.pos);
            const obstacle = last.planned.find((p) => p.startsWith('safety.obstacle@'));
            process.stdout.write(`flight line ${f.line ? 'on' : 'off'} ${f.speedMps} m/s seed ${f.seed} ${f.why} at gate ${g.id}: craft in the gate frame x ${r2(l[0])} y ${r2(l[1])} z ${r2(l[2])} (off axis ${r2(offsetOf(g, l[0], l[1]))} m, clear ${r2(clearRadius(g))} m, pursuit chord ${JSON.stringify(chordAt.get(g.id)?.[`${f.speedMps}`] ?? null)} m), ${obstacle ?? 'no obstacle cue'}\n`);
        }
    }
}

main();
