// Lane gen4a, stage A3: planCourse (packages/tracks/src/plan.ts) over the baked walls and the CDN walls of the catalogue
// scans, every level x spread x seed, each course judged by the rules of design gen4.md section 6 (G1-G7). Node only, no
// browser. One row per plan: the answer, its stats, the time and PASS/FAIL per rule; a summary per rule at the end.
//   npx tsx src/gen4-place-audit.ts [--walls DIR] [--scenes a,b] [--seeds 1,2,3] [--levels beginner,pro] [--enlarged] [--out FILE]
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { openVoxelCollision } from '@gsfpv/collision';
import type { VoxelCollision, VoxelMetadata } from '@gsfpv/collision';
import { FIT_BUDGET_MS, LEVELS, RING_MIN_DRONE_DIAMETERS, SMALLEST_DRONE_RADIUS_M, analyzeScan, flownCollision, planCourse, planRules, validateServerTrack } from '@gsfpv/tracks';
import type { CourseLevel, CourseRequest, CourseSpread, SceneTransform } from '@gsfpv/tracks';
import { loadScene } from './scenes';

function arg(name: string): string | null {
    const i = process.argv.indexOf(name);
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : null;
}
const r3 = (n: number): number => Math.round(n * 1000) / 1000;

/** the scans read from the CDN as the page does (no baked walls in the release folder) */
const CDN_SCENES = ['5dfeb49b', '7a475d38', '39e63ce9'];
/** the owner flew these enlarged (brief lines 537-540 and 579): --enlarged plans them at x15 too */
const ENLARGED = ['5dfeb49b', 'ab5efa0e'];
/** design section 6 */
const LUBLIN = '2f1ddf5f', WINTER_GARDEN = '7a475d38', SKULL = '5dfeb49b';
const GOOD_COMPACT = 0.8, GOOD_WIDE = 0.6, CITY_NEAR_MAX = 0.2;
/** gap-gen S3 (G6): plants flown at the owner's size keep this share of gates under the leaves' top */
const PLANTS_UNDER_TOP = 0.8;
const LEVEL_NAMES: CourseLevel[] = (arg('--levels')?.split(',') as CourseLevel[] | undefined) ?? ['beginner', 'medium', 'pro'];
const SPREADS: CourseSpread[] = ['compact', 'wide'];

function wallsFromDir(dir: string): VoxelCollision {
    const meta = JSON.parse(readFileSync(join(dir, 'scene.voxel.json'), 'utf8')) as VoxelMetadata;
    let bin: Uint8Array = readFileSync(join(dir, 'scene.voxel.bin'));
    if (bin[0] === 0x1f && bin[1] === 0x8b) bin = gunzipSync(bin);
    return openVoxelCollision(meta, bin);
}

async function main(): Promise<void> {
    const root = arg('--walls') ?? 'U:/Temp/gsfpv-train3/walls/release';
    const out = arg('--out') ?? join(import.meta.dirname, '../../../evidence/2026-11-19/gen4/place.json');
    const only = arg('--scenes')?.split(',') ?? null;
    const seeds = (arg('--seeds') ?? '1,2,3').split(',').map(Number);
    const craftR = SMALLEST_DRONE_RADIUS_M; // a 65 mm whoop: the owner's smallest craft, the hardest fit (G1)
    const D = 2 * craftR;
    const baked = existsSync(root) ? readdirSync(root).filter((d) => /^[0-9a-f]{8}$/.test(d)) : [];
    const newest = (id: string): { dir: string; version: number } => {
        const v = Math.max(...readdirSync(join(root, id)).map((d) => /^v(\d+)$/.exec(d)).filter((m): m is RegExpExecArray => !!m).map((m) => Number(m[1])));
        return { dir: join(root, id, `v${v}`), version: v };
    };
    const all = [...baked.map((id) => ({ id, ...newest(id) })), ...CDN_SCENES.map((id) => ({ id, dir: null as string | null, version: 1 }))];
    const rows: Record<string, unknown>[] = [];
    const tally: Record<string, { pass: number; fail: number }> = {};
    const judge = (rules: Record<string, boolean>): void => {
        for (const [k, v] of Object.entries(rules)) {
            tally[k] ??= { pass: 0, fail: 0 };
            tally[k]![v ? 'pass' : 'fail']++;
        }
    };
    for (const s of all) {
        if (only && !only.includes(s.id)) continue;
        let base: VoxelCollision;
        try {
            base = s.dir ? wallsFromDir(s.dir) : (await loadScene(s.id)).collision;
        } catch (e) {
            rows.push({ id: s.id, error: String(e) });
            console.log(`${s.id} ERROR ${String(e).slice(0, 120)}`);
            continue;
        }
        for (const scale of process.argv.includes('--enlarged') && ENLARGED.includes(s.id) ? [1, 15] : [1]) {
            const T = [scale, 0, 0, 0] as unknown as SceneTransform;
            const walls = scale === 1 ? base : flownCollision(base, T);
            const a = analyzeScan(walls, T);
            for (const level of LEVEL_NAMES)
                for (const spread of SPREADS)
                    for (const seed of seeds) {
                        // lane w1-anchor: no pilot here (the spawn is the core): anchor null lays from the core, as this audit measured before
                        const request: CourseRequest = { seed, level, spread, anyQuality: false, anchor: null };
                        const t0 = performance.now();
                        const r = planCourse({ walls, transform: T, spawn: a.core, scene: { id: s.id, version: s.version }, created: '2026-11-19T00:00:00.000Z', craftRadiusM: craftR, request, elements: true });
                        const ms = Math.round(performance.now() - t0);
                        const head = { id: s.id, scale, level, spread, seed, kind: a.kind, ms };
                        if (!r.ok) {
                            const rules = { course: false, time: ms <= FIT_BUDGET_MS, ...(s.id === SKULL && scale === 1 ? { x1: false } : {}) };
                            judge(rules);
                            rows.push({ ...head, ok: false, fitSize: r.fitSize, rules });
                            console.log(`${s.id} x${scale} ${level} ${spread} ${seed} NO-ROOM fit ${r.fitSize} ${ms} ms`);
                            continue;
                        }
                        const st = r.stats;
                        const L = LEVELS[level];
                        const pr = planRules(request, craftR, a);
                        // a size is stored to the mm in scene units (generate.ts r3): flown at Scene size s it is off by up to
                        // s / 2 mm (the skull at x15: a 1.0625 m square stored as 0.071 flies as 1.065 m)
                        const tol = 1e-3 + 5e-4 * scale;
                        const minOpen = (r.shrunk ? RING_MIN_DRONE_DIAMETERS : L.openingD) * D - tol;
                        const rules: Record<string, boolean> = {
                            course: st.gates >= 1,
                            inside: st.outside === 0,
                            ground: st.underGround === 0,
                            detail: st.goodShare >= (spread === 'compact' ? GOOD_COMPACT : GOOD_WIDE),
                            nearCore: st.startToCoreM <= Math.max(a.coreRadiusM, pr.zoneR),
                            loop: st.closed || st.startFinishM <= pr.legMaxM,
                            opening: st.openingM >= minOpen && st.openingM <= 1.25 * L.openingD * D + tol,
                            // under gatesMin only at the ladder's floor (shrunk, or a level whose opening is 4 D): the
                            // course that fits instead of a refusal; counted as 'short' in the row
                            gates: st.gates <= L.gatesMax && (st.gates >= L.gatesMin || r.shrunk || L.openingD <= RING_MIN_DRONE_DIAMETERS),
                            server: validateServerTrack(r.track).ok,
                            time: ms <= FIT_BUDGET_MS
                        };
                        // gap-gen S1 (G7): a beginner course has the level's gatesMin, shrunk or not
                        if (level === 'beginner') rules.beginnerMin = st.gates >= L.gatesMin;
                        if (s.id === LUBLIN) rules.cityLow = st.nearGroundShare <= CITY_NEAR_MAX;
                        // gap-gen S3: at the owner's size the course stays in the detailed part: the finish as near the
                        // core as the start (compact), and plants keep their gates between the leaves
                        if (scale !== 1 && spread === 'compact') rules.finishNearCore = st.finishToCoreM <= Math.max(a.coreRadiusM, pr.zoneR);
                        // at x1 a plant tray's leaves stand lower than the smallest gate (4 D = 0.34 m): planCourse lays it
                        // without the plants rule there (never a refusal), so the rule is judged where the owner flies it
                        if (a.kind === 'plants' && scale !== 1) rules.underTop = st.underTopShare >= PLANTS_UNDER_TOP;
                        if (s.id === SKULL && scale === 1) rules.x1 = st.gates >= 1;
                        if (s.id === WINTER_GARDEN) {
                            // every gate under a ceiling of the analysis (G5: the course inside the glass house)
                            let under = 0;
                            for (const g of r.track.gates) {
                                const p = [g.pos[0]! * scale, g.pos[1]! * scale, g.pos[2]! * scale];
                                const tx = Math.floor((p[0]! - a.x0) / a.tileM), tz = Math.floor((p[2]! - a.z0) / a.tileM);
                                const t = tx >= 0 && tz >= 0 && tx < a.nx && tz < a.nz ? tz * a.nx + tx : -1;
                                if (t >= 0 && Number.isFinite(a.ceiling[t]!) && p[1]! < a.ceiling[t]!) under++;
                            }
                            rules.room = under === r.track.gates.length;
                        }
                        judge(rules);
                        const failed = Object.entries(rules).filter(([, v]) => !v).map(([k]) => k);
                        rows.push({ ...head, ok: true, shrunk: r.shrunk, eased: r.eased, short: st.gates < L.gatesMin, stats: { ...st, startFinishM: r3(st.startFinishM), startToCoreM: r3(st.startToCoreM), finishToCoreM: r3(st.finishToCoreM), underTopShare: r3(st.underTopShare), goodShare: r3(st.goodShare), nearGroundShare: r3(st.nearGroundShare), openingM: r3(st.openingM) }, coreRadiusM: r3(a.coreRadiusM), zoneR: r3(pr.zoneR), rules, failed });
                        console.log(`${s.id} x${scale} ${level} ${spread} ${seed} ${a.kind} gates ${st.gates} open ${r3(st.openingM)}${r.shrunk ? ' shrunk' : ''} good ${r3(st.goodShare)} top ${r3(st.underTopShare)} core ${r3(st.startToCoreM)}/${r3(st.finishToCoreM)} of ${r3(Math.max(a.coreRadiusM, pr.zoneR))} ${ms} ms ${failed.length ? 'FAIL ' + failed.join(',') : 'PASS'}`);
                    }
        }
    }
    const plans = rows.filter((r) => !('error' in r)).length;
    const failedPlans = rows.filter((r) => Array.isArray(r.failed) ? (r.failed as string[]).length > 0 : r.ok === false).length;
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify({ what: 'gen4a A3 gen4-place-audit: planCourse over the catalogue scans, rules of design gen4.md section 6', craftRadiusM: craftR, seeds, plans, failedPlans, tally, rows }, null, 1));
    console.log(`PLANS ${plans} FAILED ${failedPlans} ${JSON.stringify(tally)} -> ${out}`);
    process.exitCode = failedPlans ? 1 : 0;
}

void main();
