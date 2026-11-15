// Lane sonic4, stage V1-measure (the owner's message 51: "at the normal speed of an FPV flight the sounds become a mess").
// A course made by N over a scan's walls (the page's course worker, run here in Node), flown by the package's ear pilot
// (src/pilot: it steers by the planner's frame through perceive.ts only) at set speeds, with the cue planner as the page
// runs it. Per flight it counts the mess: streams sounding at once, cue onsets per second, spoken words per 10 s, and the
// lead time of the gate hum, the wall cues and the floor and ceiling cues; on a touch or a fail it writes what was heard
// and what was planned in the last seconds. Node only, no page, no GPU.
//
//   cd tools/bench && npx tsx src/sonic-speed-measure.ts --walls <dir with scene.voxel.json/.bin> --scene 70b50d42
//       --spawn x,y,z [--course-seed 1] [--track file.json] [--speeds 2,5,8,12] [--seeds 1,2,3] [--line on|off]
//       [--loudest] [--out file.json]
// --track caches the generated course (written when missing, read when present). The speed cap of the lesson is set to the
// flight's speed here (assists.maxSpeedMps, as the package's ladder does): a measuring switch of this tool only.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { openVoxelCollision, sphereOverlaps } from '@gsfpv/collision';
import type { VoxelMetadata } from '@gsfpv/collision';
import { COURSE_DEFAULTS, fitCourse, freeSpace, generateCourse, qualityBounds, qualityMap } from '@gsfpv/tracks';
import type { SessionEvent, SonicObject, TrackFile, Vec3 } from '../../../packages/sonic-fpv/src';
import { createLessonRunner, scanFreeLesson } from '../../../packages/sonic-fpv/src';
import { BODY_RADIUS_M } from '../../../packages/sonic-fpv/src/lesson';
import { CuePlanner, type FramePlan } from '../../../packages/sonic-fpv/src/cues/planner';
import { defaultPrefs } from '../../../packages/sonic-fpv/src/prefs';
import { getBuiltinTheme } from '../../../packages/sonic-fpv/src/theme';
import { Craft, CRAFT_ACCEL_MPS2, CRAFT_CLIMB_MPS, CRAFT_YAW_DPS } from '../../../packages/sonic-fpv/src/pilot/craft';
import { EarPilot, REACTION_MS, TURN_DPS } from '../../../packages/sonic-fpv/src/pilot/ear-pilot';
import { DEFAULT_HEARING, Ear, type Percepts } from '../../../packages/sonic-fpv/src/pilot/perceive';
import { buildScanLesson, scanCourseLesson } from '../../../apps/fly/src/sonic/scan-lesson';
import { REPO } from './evidence';

const DT_MS = 20;
const TIME_FACTOR = 3;
const TOUCH_QUIET_MS = 500;
/** the closing speed of a cue is read over this long after its onset, ms */
const CLOSING_WINDOW_MS = 200;
/** a cue whose distance closes slower than this is not counted for lead time, m/s */
const CLOSING_MIN_MPS = 0.5;
/** what the failure record keeps before the touch or fail, ms */
const TAIL_MS = 2500;

function arg(name: string): string | null {
    const i = process.argv.indexOf(name);
    return i >= 0 && process.argv[i + 1] ? (process.argv[i + 1] as string) : null;
}
const nums = (s: string): number[] => s.split(',').map(Number);
const r2 = (x: number): number => Math.round(x * 100) / 100;
const median = (a: readonly number[]): number => {
    if (a.length === 0) return NaN;
    const s = [...a].sort((x, y) => x - y);
    return s[Math.floor((s.length - 1) / 2)] as number;
};
const pct = (a: readonly number[], p: number): number => {
    if (a.length === 0) return NaN;
    const s = [...a].sort((x, y) => x - y);
    return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))] as number;
};

type CueClass = 'hum' | 'wall' | 'floorceil' | 'other';
const classOf = (cue: string): CueClass => (cue === 'target.hum' ? 'hum' : cue === 'safety.floor' || cue === 'safety.ceiling' ? 'floorceil' : cue.startsWith('safety.') && cue !== 'safety.free' ? 'wall' : 'other');

function loadWalls(dir: string): ReturnType<typeof openVoxelCollision> {
    const meta = JSON.parse(readFileSync(join(dir, 'scene.voxel.json'), 'utf8')) as VoxelMetadata;
    let bin: Uint8Array = readFileSync(join(dir, 'scene.voxel.bin'));
    if (bin[0] === 0x1f && bin[1] === 0x8b) bin = gunzipSync(bin);
    return openVoxelCollision(meta, bin);
}

/** The course the page's worker lays for N (apps/fly/src/course/worker.ts 'generate'), same steps, no deadline. */
function makeCourse(col: ReturnType<typeof openVoxelCollision>, scene: string, spawn: Vec3, seed: number): TrackFile {
    const quality = qualityMap(col);
    const box = qualityBounds(quality, spawn as unknown as [number, number, number]);
    const free = freeSpace(col, { spawn: spawn as unknown as [number, number, number], bounds: box ?? undefined });
    const got = fitCourse(free, col, { seed, scene: { id: scene, version: 1 }, transform: [1, 0, 0, 0], created: '2026-11-15T00:00:00Z', quality: box ? quality : undefined } as never, COURSE_DEFAULTS.gatesMin, generateCourse, null);
    if (!got.track) throw new Error('no course fits');
    return { ...(got.track as unknown as TrackFile), laps: 1 };
}

/** words of each spoken line (package locales/en.json) */
function wordsOf(key: string, dict: Record<string, string>): number {
    const s = dict[key];
    if (typeof s !== 'string') return 0;
    return s.split(/\s+/).filter((w) => w !== '').length;
}

interface Onset {
    readonly key: string;
    readonly cls: CueClass;
    readonly cue: string;
    readonly t: number;
    readonly d0: number;
    readonly series: { t: number; d: number }[];
    readonly speed: number;
    readonly offDeg: number;
    /** the craft's velocity along the cue's direction at its onset, m/s */
    readonly closing: number;
}

export interface FlightMeasure {
    readonly speedMps: number;
    readonly seed: number;
    readonly line: boolean;
    readonly why: string;
    readonly passed: boolean;
    readonly gates: number;
    readonly gatesTotal: number;
    readonly timeS: number;
    readonly medianSpeed: number;
    readonly streams: { readonly median: number; readonly worstSecondMean: number; readonly maxFrame: number; readonly heardMedian: number };
    readonly onsetsPerS: number;
    readonly wordsPer10s: number;
    readonly lead: Record<string, { readonly n: number; readonly median: number; readonly p10: number; readonly min: number; readonly late: number }>;
    readonly hum: { readonly n: number; readonly turnNeedDpsMedian: number; readonly turnNeedDpsMax: number; readonly spareSMedian: number; readonly spareSMin: number };
    readonly brakeNeedMps2Max: number;
    readonly tail: object | null;
}

function flyCourse(o: { col: ReturnType<typeof openVoxelCollision>; scene: string; spawn: Vec3; track: TrackFile; speedMps: number; seed: number; line: boolean; attendHum: boolean; dict: Record<string, string> }): FlightMeasure {
    const { col, speedMps: v, seed } = o;
    const src = { collision: () => col as never, transform: () => ({ s: 1, t: [0, 0, 0] }) };
    const scan = buildScanLesson(o.track, { sceneId: o.scene, sceneVersion: 1, src, spawn: { pos: o.spawn, yawDeg: 0 } }, { course: true });
    const base = scanCourseLesson(scanFreeLesson(o.scene, [1, 0, 0, 0]), o.track);
    const layers = { ...base.layers, racingLine: o.line };
    const lesson = { ...base, layers, assists: { ...base.assists, maxSpeedMps: v } };
    const run = createLessonRunner(lesson, { seed, start: scan.start, floorY: scan.floorY, objects: scan.objects, progress: null, sessionStartMs: 0 } as never);
    const prefs = { ...defaultPrefs(), beacon: true };
    const theme = getBuiltinTheme('soft');
    const planner = new CuePlanner({ theme, prefs, layers });
    const ear = new Ear(theme, prefs, { ...DEFAULT_HEARING, attendHum: o.attendHum, seed: DEFAULT_HEARING.seed * 7919 + seed });
    const pilot = new EarPilot({ speedMps: v });
    const craft = new Craft(scan.start, { speedMps: v, climbMps: Math.max(CRAFT_CLIMB_MPS, lesson.assists.maxClimbMps ?? 0), yawDps: CRAFT_YAW_DPS, accelMps2: CRAFT_ACCEL_MPS2 });
    const world = scan.world;
    const cps = (world as unknown as { checkpoints?: readonly { pos: Vec3 }[] }).checkpoints ?? [];
    let courseM = 0;
    let at: Vec3 = scan.start.pos;
    for (const c of cps) {
        courseM += Math.hypot(c.pos[0] - at[0], c.pos[1] - at[1], c.pos[2] - at[2]);
        at = c.pos;
    }
    const limitMs = (TIME_FACTOR * Math.max(courseM, 50) * 1000) / v;
    let t = 0;
    let result: string | null = null;
    let words = 0;
    const saidKeys: string[] = [];
    let spokenT0: number | null = null;
    const read = (evs: readonly SessionEvent[]): void => {
        for (const e of evs) {
            if (e.kind !== 'lesson') continue;
            if (e.what === 'attempt-pass' || e.what === 'passed') result ??= 'pass';
            else if (e.what === 'attempt-fail') result ??= 'fail';
        }
    };
    const take = (): void => {
        for (let guard = 0; guard < 64; guard++) {
            const a = run.takeActions();
            if (a.length === 0) return;
            let said = false;
            for (const x of a) {
                if (x.kind === 'place') craft.place(x.pose);
                else if (x.kind === 'cue') planner.cue(x.event, t);
                else if (x.kind === 'say') {
                    said = true;
                    saidKeys.push(`${r2(spokenT0 === null ? 0 : (t - spokenT0) / 1000)}:${x.line.key}`);
                    if (spokenT0 !== null) words += wordsOf(x.line.key, o.dict);
                } else if (x.kind === 'ask') read(run.answer(1, 'key', t));
            }
            if (said) read(run.spoken(t));
        }
    };
    read(run.begin(t));
    take();
    let touches = 0;
    let touching = false;
    let lastContact = -Infinity;
    let t0: number | null = null;
    const counts: number[] = [];
    const heardCounts: number[] = [];
    const perSecond = new Map<number, { sum: number; n: number }>();
    let onsets = 0;
    let prevKeys = new Set<string>();
    const open = new Map<string, Onset>();
    const done: Onset[] = [];
    const speeds: number[] = [];
    const targets = new Set<string>();
    const humOnsets: { turnNeedDps: number; spareS: number }[] = [];
    let lastTarget: string | null = null;
    let lastPos: Vec3 = [...craft.pos] as unknown as Vec3;
    const tail: { t: number; pos: number[]; speed: number; urgent: boolean; planned: string[]; heard: string[]; cmd: number[] }[] = [];
    while (result === null) {
        t += DT_MS;
        const p = craft.pos;
        const inside = sphereOverlaps(col as never, p[0], p[1], p[2], BODY_RADIUS_M);
        const fresh = inside && !touching && t - lastContact >= TOUCH_QUIET_MS;
        touching = inside;
        if (inside) lastContact = t;
        if (fresh) touches++;
        const sample = craft.sample(t, fresh);
        read(run.step(sample, world));
        if (run.phase === 'flying' && t0 === null) {
            t0 = t;
            spokenT0 = t;
        }
        take();
        if (touches > 0) result ??= 'touch';
        if (t0 !== null && t - t0 > limitMs) result ??= 'timeout';
        if (t > limitMs + 180_000) result ??= 'timeout';
        if (result !== null) break;
        const target = run.target() as SonicObject | null;
        const beacon = run.beaconTarget ? run.beaconTarget() : undefined;
        const plan: FramePlan = planner.plan({ sample, world, target, ...(beacon !== undefined ? { beacon } : {}), floorY: scan.floorY });
        const heard: Percepts = ear.hear(plan);
        const cmd = pilot.step(heard);
        if (t0 !== null) {
            const sp = Math.hypot(p[0] - lastPos[0], p[1] - lastPos[1], p[2] - lastPos[2]) / (DT_MS / 1000);
            speeds.push(sp);
            const n = plan.voices.length + (plan.height ? 1 : 0) + (plan.speed ? 1 : 0) + (plan.room ? 1 : 0);
            counts.push(n);
            heardCounts.push(heard.streams.length);
            const sec = Math.floor((t - t0) / 1000);
            const ps = perSecond.get(sec) ?? { sum: 0, n: 0 };
            ps.sum += n;
            ps.n++;
            perSecond.set(sec, ps);
            const keys = new Set<string>();
            for (const vc of plan.voices) {
                keys.add(vc.key);
                if (!prevKeys.has(vc.key)) {
                    onsets++;
                    const cls = classOf(vc.cue);
                    const offDeg = (Math.acos(Math.max(-1, Math.min(1, -vc.dir[2]))) * 180) / Math.PI;
                    // the craft's velocity along the cue's direction (craft.ts frame: x right, y up, -z forward, yaw only)
                    const ya = (craft.yaw * Math.PI) / 180;
                    const wd = [Math.cos(ya) * vc.dir[0] - Math.sin(ya) * vc.dir[2], vc.dir[1], Math.sin(ya) * vc.dir[0] + Math.cos(ya) * vc.dir[2]];
                    const closing = sample.vel[0] * wd[0]! + sample.vel[1] * wd[1]! + sample.vel[2] * wd[2]!;
                    if (cls !== 'other') open.set(vc.key, { key: vc.key, cls, cue: vc.cue, t, d0: vc.distance, series: [{ t, d: vc.distance }], speed: sp, offDeg, closing });
                } else if (vc.periodS !== null && vc.periodS > 0) onsets += DT_MS / 1000 / vc.periodS;
                const on = open.get(vc.key);
                if (on && t - on.t <= CLOSING_WINDOW_MS) on.series.push({ t, d: vc.distance });
            }
            for (const k of prevKeys) if (!keys.has(k) && open.has(k)) {
                done.push(open.get(k) as Onset);
                open.delete(k);
            }
            prevKeys = keys;
            const tid = target?.id ?? null;
            if (tid !== null && tid !== lastTarget) {
                targets.add(tid);
                lastTarget = tid;
                if (target) {
                    const dx = target.pos[0] - p[0];
                    const dy = target.pos[1] - p[1];
                    const dz = target.pos[2] - p[2];
                    const d = Math.hypot(dx, dy, dz);
                    const yawRad = (craft.yaw * Math.PI) / 180;
                    const fwd = [Math.sin(yawRad), -Math.cos(yawRad)];
                    const hd = Math.hypot(dx, dz) || 1;
                    const offDeg = (Math.acos(Math.max(-1, Math.min(1, (fwd[0]! * dx + fwd[1]! * dz) / hd))) * 180) / Math.PI;
                    const arriveS = d / v;
                    humOnsets.push({ turnNeedDps: offDeg / Math.max(0.05, arriveS - REACTION_MS / 1000), spareS: arriveS - REACTION_MS / 1000 - offDeg / TURN_DPS });
                }
            }
            tail.push({ t: r2((t - t0) / 1000), pos: p.map(r2), speed: r2(sp), urgent: plan.urgent, planned: plan.voices.map((x) => `${x.cue}@${r2(x.distance)}`), heard: heard.streams.map((s) => `${s.cue}:${s.side}${s.behind ? 'b' : ''}`), cmd: [r2(cmd.forwardMps), r2(cmd.lateralMps), r2(cmd.climbMps), r2(cmd.yawDps)] });
            while (tail.length > 0 && (t - t0) / 1000 - (tail[0] as { t: number }).t > TAIL_MS / 1000) tail.shift();
        }
        lastPos = [p[0], p[1], p[2]] as unknown as Vec3;
        craft.step(run.phase === 'flying' ? cmd : { forwardMps: 0, lateralMps: 0, climbMps: 0, yawDps: 0 }, DT_MS / 1000);
    }
    for (const x of open.values()) done.push(x);
    const flightS = t0 === null ? 0 : (t - t0) / 1000;
    const lead: FlightMeasure['lead'] = {};
    let brakeMax = 0;
    for (const cls of ['wall', 'floorceil', 'hum'] as const) {
        const leads: number[] = [];
        for (const on of done) {
            if (on.cls !== cls) continue;
            const closing = on.closing;
            if (!(closing >= CLOSING_MIN_MPS)) continue;
            // the last moment a full stop along the cue's direction still keeps the body off it (craft deceleration of the
            // package's craft model, an estimate there); for the hum the last moment is its arrival
            const stopM = cls === 'hum' ? 0 : (closing * closing) / (2 * CRAFT_ACCEL_MPS2) + BODY_RADIUS_M;
            leads.push((on.d0 - stopM) / closing);
            if (cls !== 'hum') brakeMax = Math.max(brakeMax, (closing * closing) / (2 * Math.max(0.05, on.d0 - BODY_RADIUS_M)));
        }
        lead[cls] = { n: leads.length, median: r2(median(leads)), p10: r2(pct(leads, 0.1)), min: r2(leads.length ? Math.min(...leads) : NaN), late: leads.filter((x) => x < REACTION_MS / 1000).length };
    }
    const secMeans = [...perSecond.values()].map((x) => x.sum / x.n);
    const passed = result === 'pass' && touches === 0;
    return {
        speedMps: v,
        seed,
        line: o.line,
        why: result as string,
        passed,
        gates: targets.size,
        gatesTotal: scan.objects.length,
        timeS: r2(flightS),
        medianSpeed: r2(median(speeds)),
        streams: { median: median(counts), worstSecondMean: r2(secMeans.length ? Math.max(...secMeans) : NaN), maxFrame: counts.length ? Math.max(...counts) : 0, heardMedian: median(heardCounts) },
        onsetsPerS: r2(flightS > 0 ? onsets / flightS : NaN),
        wordsPer10s: r2(flightS > 0 ? (words * 10) / flightS : NaN),
        lead,
        hum: { n: humOnsets.length, turnNeedDpsMedian: r2(median(humOnsets.map((h) => h.turnNeedDps))), turnNeedDpsMax: r2(humOnsets.length ? Math.max(...humOnsets.map((h) => h.turnNeedDps)) : NaN), spareSMedian: r2(median(humOnsets.map((h) => h.spareS))), spareSMin: r2(humOnsets.length ? Math.min(...humOnsets.map((h) => h.spareS)) : NaN) },
        brakeNeedMps2Max: r2(brakeMax),
        tail: passed ? null : { at: r2(flightS), target: lastTarget, said: saidKeys.slice(-6), frames: tail.filter((_, i) => i % 5 === 0 || i >= tail.length - 10) }
    };
}

function main(): void {
    const dir = arg('--walls');
    const scene = arg('--scene') ?? 'scan';
    if (!dir) throw new Error('--walls <dir> is needed');
    const spawn = nums(arg('--spawn') ?? '0,0,0') as unknown as Vec3;
    const t0 = Date.now();
    const col = loadWalls(dir);
    const trackFile = arg('--track');
    let track: TrackFile;
    if (trackFile && existsSync(trackFile)) track = JSON.parse(readFileSync(trackFile, 'utf8')) as TrackFile;
    else {
        track = makeCourse(col, scene, spawn, Number(arg('--course-seed') ?? '1'));
        if (trackFile) {
            mkdirSync(dirname(trackFile), { recursive: true });
            writeFileSync(trackFile, JSON.stringify(track));
        }
    }
    process.stdout.write(`walls and course ${((Date.now() - t0) / 1000).toFixed(0)} s\n`);
    const dict = JSON.parse(readFileSync(join(REPO, 'packages/sonic-fpv/locales/en.json'), 'utf8')) as Record<string, string>;
    const speeds = nums(arg('--speeds') ?? '2,5,8,12');
    const seeds = nums(arg('--seeds') ?? '1,2,3');
    const lines = (arg('--line') ?? 'off').split(',').map((x) => x === 'on');
    const flights: FlightMeasure[] = [];
    for (const line of lines)
        for (const v of speeds)
            for (const seed of seeds) {
                const f0 = Date.now();
                const m = flyCourse({ col, scene, spawn, track, speedMps: v, seed, line, attendHum: !process.argv.includes('--loudest'), dict });
                flights.push(m);
                process.stdout.write(`line ${line ? 'on' : 'off'} ${v} m/s seed ${seed}: ${m.why} gates ${m.gates}/${m.gatesTotal} t ${m.timeS} s v50 ${m.medianSpeed} streams ${m.streams.median}/${m.streams.worstSecondMean}/${m.streams.maxFrame} onsets/s ${m.onsetsPerS} words/10s ${m.wordsPer10s} lead wall ${m.lead.wall?.median}/${m.lead.wall?.min} fc ${m.lead.floorceil?.median}/${m.lead.floorceil?.min} hum spare ${m.hum.spareSMedian}/${m.hum.spareSMin} turn ${m.hum.turnNeedDpsMedian}/${m.hum.turnNeedDpsMax} brake ${m.brakeNeedMps2Max} (${((Date.now() - f0) / 1000).toFixed(0)} s)\n`);
            }
    const out = arg('--out');
    if (out) {
        mkdirSync(dirname(out), { recursive: true });
        writeFileSync(out, `${JSON.stringify({ scene, walls: dir, spawn, track: { id: track.id, gates: (track as unknown as { gates?: unknown[] }).gates?.length ?? null }, attendHum: !process.argv.includes('--loudest'), craft: { accelMps2: CRAFT_ACCEL_MPS2, yawDps: CRAFT_YAW_DPS }, pilot: { turnDps: TURN_DPS, reactionMs: REACTION_MS }, flights }, null, 1)}\n`);
    }
}

main();
