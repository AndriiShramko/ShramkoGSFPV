// v0.12 Fly by Sound, lane v12-flight step 10, plan section 8 item 6 (docs/wip/v12-plan.md): can a refined wall grid for Winter Garden be shipped with
// the release, so that no tester's PC has to refine first? What it would be, measured on the real thing, in two parts.
//
//   1  The page's own refine (1.6 cm, the walls box's "Refine walls to 1.6 cm") run in headless Chrome on this PC's GPU, on Winter Garden at its own size
//      (x1, the plain simulator page: at x5 the walls box refuses, see below). Its time, Gaussians, octree and bytes: raw, gzipped in the page, brotli in Node.
//      The baked bytes are written to .cache/refined/7a475d38/ (gitignored) for part 2.
//   2  Node, on those bytes through x5 (8 cm cells flown): the scene sampler's cost per frame (30 rays, the plan's 1 ms budget), and the proof of
//      tools/bench/src/sonic-track-check.ts for the ring track on the refined walls.
//
// Found on the way and kept for the report: in the Fly by Sound lesson the page flies Winter Garden at x5, and the walls box (apps/fly/src/walls.ts) reads the
// FLOWN cell size (16 cm) as the shipped grid's resolution, so its plan predicts 263 M octree nodes for 1.6 cm and refuses ("octree"), and finds no refined
// walls in the browser's store either: a refine cannot be made or used at x5 in the page as it is. Measured in the lesson page (the first checks below).
//
// Evidence: evidence/<date>/sonic-garden-refine.json. Holds the GPU lock (the bake runs on the GPU).
//   cd apps/fly && npx vite --port 5342 --strictPort            (another shell)
//   cd tools/bench && LAB=http://localhost:5342 npx tsx src/sonic-garden-refine.ts
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import { createSceneSampler, parseTrack, yawQuat } from '../../../packages/sonic-fpv/src';
import type { FlightSample, Vec3 } from '../../../packages/sonic-fpv/src';
import { openVoxelCollision } from '@gsfpv/collision';
import type { VoxelMetadata } from '@gsfpv/collision';
import { ScanSonicWorld } from '../../../apps/fly/src/sonic/scan-world';
import { launch } from './browser';
import { REPO, today, writeEvidence } from './evidence';
import { INIT, lock, probe, unlock, waitFlying } from './sonic-garden-pilot';
import { checkTrack, flownCollision, DEFAULT_TRACK } from './sonic-track-check';

const LAB = (process.env.LAB ?? '').replace(/\/$/, '');
if (!LAB) throw new Error('LAB=http://localhost:<vite port> is needed');
const NAME = 'sonic-garden-refine';
const REFINED = join(REPO, '.cache', 'refined', '7a475d38');
mkdirSync(REFINED, { recursive: true });
process.on('SIGINT', () => {
    unlock();
    process.exit(130);
});

const checks: { name: string; pass: boolean; value?: unknown }[] = [];
const check = (name: string, pass: boolean, value?: unknown): void => {
    checks.push({ name, pass, value });
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${value === undefined ? '' : '  ' + JSON.stringify(value).slice(0, 420)}`);
};
const mb = (n: number | null | undefined): number | null => (typeof n === 'number' ? Math.round((n / 1048576) * 10) / 10 : null);
const brotli = (b: Uint8Array): number => brotliCompressSync(b, { params: { [constants.BROTLI_PARAM_QUALITY]: 9, [constants.BROTLI_PARAM_SIZE_HINT]: b.length } }).length;

interface Walls {
    state: string;
    source: string;
    voxelM: number | null;
    plan: Record<string, unknown> | null;
    size: Record<string, unknown> | null;
    bake: Record<string, unknown> | null;
}
const wallsOf = (page: import('playwright').Page): Promise<Walls> =>
    page.evaluate(() => {
        const h = (window as unknown as { __gsfpv: { walls: { state: string; source: string; voxelM: number | null; plan: Record<string, unknown> | null; size: Record<string, unknown> | null }; bake?: Record<string, unknown> } }).__gsfpv;
        return { state: h.walls.state, source: h.walls.source, voxelM: h.walls.voxelM, plan: h.walls.plan, size: h.walls.size, bake: h.bake ?? null };
    });

const shippedBin = readFileSync(join(REPO, '.cache', 'scenes', '7a475d38', 'scene.voxel.bin'));
const shippedGzip = gzipSync(shippedBin, { level: 9 }).length;
const shippedBrotli = brotli(shippedBin);

await lock();
try {
    const L = await launch({ width: 1280, height: 720 });
    await L.context.addInitScript(INIT);
    await L.context.addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: LAB }]);
    const page = L.page;

    // ---- the lesson page: what the walls box says at x5
    await page.goto(`${LAB}/fly/?sonic=free-garden&nowarn=1`);
    await page.waitForSelector('[data-testid="sonic-start-asked"]', { timeout: 60000 });
    await page.focus('[data-testid="sonic-start-asked"]');
    await page.keyboard.press('Enter');
    await waitFlying(page, 'free-garden', 240000);
    await page.evaluate(() => (window as unknown as { __gsfpv: { walls: { ready: Promise<void> } } }).__gsfpv.walls.ready);
    const lesson = await wallsOf(page);
    const lp = await probe(page);
    check(`in the lesson at x5 the walls box reads the flown cell size (${lesson.voxelM && lesson.voxelM * 100} cm) as the grid's and refuses a refine (${JSON.stringify(lesson.plan)}): a refine can neither be made nor found in the store there`, lesson.voxelM !== null && Math.abs(lesson.voxelM - 0.16) < 1e-6 && lesson.state === 'none' && (lesson.plan as { action?: string } | null)?.action === 'refused', { walls: lesson.state, voxelM: lesson.voxelM, plan: lesson.plan, flown: lp.walls });

    // ---- part 1: the refine at x1, on the plain page
    await page.goto(`${LAB}/fly/?scene=7a475d38&nowarn=1`);
    await page.waitForFunction(() => (window as unknown as { __gsfpv?: { status?: string } }).__gsfpv?.status === 'ready', undefined, { timeout: 240000 });
    const kb = page.getByRole('button', { name: 'Keyboard' });
    if (await kb.count()) await kb.first().click();
    await page.evaluate(() => (window as unknown as { __gsfpv: { walls: { ready: Promise<void> } } }).__gsfpv.walls.ready);
    const x1 = await wallsOf(page);
    check(`at x1 the walls box offers the refine: ${x1.voxelM && x1.voxelM * 100} cm now, plan ${JSON.stringify(x1.plan)}`, x1.state === 'offer' && !!x1.voxelM && Math.abs(x1.voxelM - 0.032) < 1e-6, { state: x1.state, voxelM: x1.voxelM, plan: x1.plan, size: x1.size });
    const t0 = Date.now();
    const done = await page.evaluate(() =>
        Promise.race([
            (window as unknown as { __gsfpv: { walls: { refine(): Promise<void> } } }).__gsfpv.walls.refine().then(() => 'done'),
            new Promise<string>((r) => setTimeout(() => r('timeout'), 8 * 60 * 1000))
        ])
    );
    const refineS = Math.round((Date.now() - t0) / 100) / 10;
    const bake = (await wallsOf(page)).bake as { ok?: boolean; kind?: string; voxelM?: number; gaussians?: number; solidVoxels?: number; ms?: Record<string, number>; peakJsHeapMb?: number; binBytes?: number } | null;
    check(`the page's own refine finished: ${bake?.kind} to ${bake?.voxelM && bake.voxelM * 100} cm in ${refineS} s (the page's timer: ${bake?.ms?.total && Math.round(bake.ms.total / 100) / 10} s), ${bake?.gaussians && Math.round(bake.gaussians / 1e5) / 10} M Gaussians`, done === 'done' && bake?.ok === true && bake.kind === 'refine', { done, bake });
    if (!bake?.ok) throw new Error(`the refine did not finish: ${JSON.stringify(bake)}`);

    // the baked bytes to disk (base64 in slices), gzipped in the page too
    const total = await page.evaluate(() => {
        const b = (window as unknown as { __gsfpv: { bakedBytes?: { json: Uint8Array; bin: Uint8Array } } }).__gsfpv.bakedBytes!;
        return { json: b.json.length, bin: b.bin.length };
    });
    const pull = async (which: 'json' | 'bin', size: number): Promise<Buffer> => {
        const parts: Buffer[] = [];
        const SLICE = 3 * 1024 * 1024;
        for (let i = 0; i < size; i += SLICE) {
            const b64 = await page.evaluate(([w, from, n]) => {
                const u = (window as unknown as { __gsfpv: { bakedBytes: Record<string, Uint8Array> } }).__gsfpv.bakedBytes[w as string]!.subarray(from as number, (from as number) + (n as number));
                let s = '';
                for (let k = 0; k < u.length; k += 0x8000) s += String.fromCharCode.apply(null, Array.from(u.subarray(k, k + 0x8000)));
                return btoa(s);
            }, [which, i, SLICE] as const);
            parts.push(Buffer.from(b64, 'base64'));
        }
        return Buffer.concat(parts);
    };
    const jsonBytes = await pull('json', total.json);
    const binBytes = await pull('bin', total.bin);
    writeFileSync(join(REFINED, 'scene.voxel.json'), jsonBytes);
    writeFileSync(join(REFINED, 'scene.voxel.bin'), binBytes);
    const gzipPage = await page.evaluate(async () => {
        const b = (window as unknown as { __gsfpv: { bakedBytes: { bin: Uint8Array } } }).__gsfpv.bakedBytes.bin;
        return (await new Response(new Blob([b as unknown as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer()).byteLength;
    });
    const refinedBrotli = brotli(binBytes);
    check(`what it would weigh: raw ${mb(binBytes.length)} MB (the shipped 3.2 cm grid: ${mb(shippedBin.length)} MB), gzip ${mb(gzipPage)} MB in the page, brotli q9 ${mb(refinedBrotli)} MB in Node (shipped: ${mb(shippedBrotli)} MB)`, binBytes.length === total.bin && binBytes.length > shippedBin.length * 3, { rawBytes: binBytes.length, gzipPageBytes: gzipPage, brotliBytes: refinedBrotli, shipped: { raw: shippedBin.length, gzip: shippedGzip, brotli: shippedBrotli }, jsonBytes: jsonBytes.length });
    const errors = L.console.filter((m) => /^(error|pageerror)/i.test(m) && !/Failed to load resource/.test(m));
    check('no console error in the page', errors.length === 0, errors.slice(0, 5));
    await L.browser.close();

    // ---- part 2: Node, the refined bytes at x5
    const meta = JSON.parse(jsonBytes.toString('utf8')) as VoxelMetadata;
    const refined = openVoxelCollision(meta, binBytes);
    const flown = flownCollision(refined, [5, 0, 0, 0]);
    const parsed = parseTrack(readFileSync(DEFAULT_TRACK, 'utf8'));
    if (!parsed.ok) throw new Error('track');
    const track = parsed.value;
    check(`the refined grid is ${refined.voxelResolution * 100} cm cells (${flown.voxelResolution * 100} cm flown at x5): the same scan, the octree has ${refined.nodes.length} node words against the shipped grid's ${(readFileSync(join(REPO, '.cache', 'scenes', '7a475d38', 'scene.voxel.json'), 'utf8').match(/"nodeCount": (\d+)/) ?? [])[1]}`, Math.abs(flown.voxelResolution - 0.08) < 1e-6, { nodes: refined.nodes.length, leafData: refined.leafData.length });

    // a frame every 5 cm along the course's own legs, the nose along the leg: the sampler as the page runs it
    const legs: { pos: Vec3; yaw: number }[] = [];
    const pts: Vec3[] = [[2.5, 6.25, -17], ...track.gates.map((g) => [g.pos[0] * 5, g.pos[1] * 5, g.pos[2] * 5] as Vec3)];
    for (let i = 0; i + 1 < pts.length; i++) {
        const a = pts[i]!;
        const b = pts[i + 1]!;
        const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
        const yaw = (Math.atan2(b[0] - a[0], -(b[2] - a[2])) * 180) / Math.PI;
        for (let k = 0; k < Math.ceil(len / 0.05); k++) legs.push({ pos: [a[0] + ((b[0] - a[0]) * k * 0.05) / len, a[1] + ((b[1] - a[1]) * k * 0.05) / len, a[2] + ((b[2] - a[2]) * k * 0.05) / len], yaw });
    }
    const timeRun = (col: typeof flown): { p50: number; p95: number; p99: number; max: number; n: number } => {
        const w = new ScanSonicWorld('7a475d38', 1, { collision: () => col, transform: () => ({ s: 5, t: [0, 0, 0] }) }, track);
        const s = createSceneSampler();
        const ms: number[] = [];
        const frame = (p: { pos: Vec3; yaw: number }, i: number): FlightSample => ({ t: i * 16.7, tick: i * 17, pos: p.pos, vel: [0, 0, -3], quat: yawQuat(p.yaw), rate: [0, 0, 0], yawDeg: p.yaw, pitchDeg: 0, rollDeg: 0, sticks: [0, 0, 0, 0], armed: true, touched: false, paused: false });
        legs.slice(0, 300).forEach((p, i) => s.sample(frame(p, i), w));
        legs.forEach((p, i) => {
            const t = performance.now();
            s.sample(frame(p, i), w);
            ms.push(performance.now() - t);
        });
        ms.sort((a, b) => a - b);
        const q = (x: number): number => Math.round(ms[Math.floor(x * (ms.length - 1))]! * 1000) / 1000;
        return { n: ms.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: Math.round(ms[ms.length - 1]! * 1000) / 1000 };
    };
    const shippedCol = openVoxelCollision(JSON.parse(readFileSync(join(REPO, '.cache', 'scenes', '7a475d38', 'scene.voxel.json'), 'utf8')) as VoxelMetadata, shippedBin);
    const costShipped = timeRun(flownCollision(shippedCol, [5, 0, 0, 0]));
    const costRefined = timeRun(flown);
    check(`the scene sampler (30 rays) along the course in Node: refined 8 cm cells p50 ${costRefined.p50}, p95 ${costRefined.p95}, p99 ${costRefined.p99}, max ${costRefined.max} ms a frame; shipped 16 cm cells p50 ${costShipped.p50}, p95 ${costShipped.p95} (the plan's budget: p95 under 1 ms)`, costRefined.p95 < 1, { refined: costRefined, shipped: costShipped });
    const proof = checkTrack(track, flown, [5, 0, 0, 0], 0.5);
    check(`the ring track on the refined walls: every opening, frame, run and leg clear by 0.5 m (min free radius ${proof.minFreeM} m, legs ${Math.min(...proof.legs.map((l) => l.freeM))} m)`, proof.ok, proof.ok ? { minFreeM: proof.minFreeM } : proof.issues);

    const file = writeEvidence(NAME, {
        step: 'v12-flight 10, plan 8.6: the refined wall grid of Winter Garden, measured',
        page: `${LAB}/fly/ (Vite dev server), the scan from the scene CDN`,
        lessonAtX5: { walls: lesson.state, flownCellM: lesson.voxelM, plan: lesson.plan },
        refine: { seconds: refineS, bake },
        sizes: { rawBytes: binBytes.length, gzipPageBytes: gzipPage, brotliBytes: refinedBrotli, jsonBytes: jsonBytes.length, shippedRawBytes: shippedBin.length, shippedGzipBytes: shippedGzip, shippedBrotliBytes: shippedBrotli },
        raysNode: { refined8cm: costRefined, shipped16cm: costShipped },
        trackOnRefined: { ok: proof.ok, minFreeM: proof.minFreeM, startFreeM: proof.startFreeM },
        note: 'headless Chrome 156 on this PC (i9-7980XE, RTX 4090); the bake runs on the page\'s own WebGPU device; the rays are timed in Node (one core), where the shipped grid measured 0.33 ms p50 in step 3 and 0.35 to 0.39 ms in the page',
        checks,
        pass: checks.every((c) => c.pass)
    });
    console.log(`evidence ${file}; ${checks.filter((c) => c.pass).length}/${checks.length} checks pass`);
    process.exitCode = checks.every((c) => c.pass) ? 0 : 1;
} finally {
    unlock();
}
