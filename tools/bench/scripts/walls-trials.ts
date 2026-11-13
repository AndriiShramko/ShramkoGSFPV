// Walls stage W1: ways of building walls for big scans, measured in a headless page of a local release.
// Usage (GPU lock and server by the caller):
//   node node_modules/tsx/dist/cli.mjs tools/bench/scripts/walls-trials.ts <site> <out.json> trials <scene:level@cm,level@cm;scene:...>
//   node node_modules/tsx/dist/cli.mjs tools/bench/scripts/walls-trials.ts <site> <out.json> ladder <scene,scene>
// trials: bakeTrial per step (nothing installed); for a scene with shipped walls each step is compared
// with them voxel by voxel at the shipped cell. ladder: ?bake=1 as the pilot gets it, then the drone is
// flown into the built walls (tunnelSelfTest: contacts and penetrations).
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { VoxelCollision, forEachBlock, blockDims, countSolidVoxelsFromBytes } from '../../../packages/collision/src/index';
import { pickBrowser } from '../src/chrome.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [site, outFile, mode, spec] = process.argv.slice(2);

function collision(json: Uint8Array, bin: Uint8Array): VoxelCollision {
    const meta = JSON.parse(new TextDecoder().decode(json));
    const words = new Uint32Array(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
    return new VoxelCollision(meta, words.subarray(0, meta.nodeCount), words.subarray(meta.nodeCount, meta.nodeCount + meta.leafDataCount));
}

/** Solid voxels of `a` (by their centres) that are solid in `b` too; b is read at its own cell. */
function inside(a: VoxelCollision, b: VoxelCollision): { solid: number; shared: number } {
    let solid = 0, shared = 0;
    const r = a.voxelResolution, rb = b.voxelResolution;
    const [bx1, by1, bz1] = blockDims(a);
    forEachBlock(a, [0, 0, 0], [bx1, by1, bz1], (bx, by, bz, lo, hi) => {
        for (let bit = 0; bit < 64; bit++) {
            if (!((bit < 32 ? lo >>> bit : hi >>> (bit - 32)) & 1)) continue;
            solid++;
            const ix = bx * 4 + (bit & 3), iy = by * 4 + ((bit >> 2) & 3), iz = bz * 4 + (bit >> 4);
            const jx = Math.floor((a.gridMinX + (ix + 0.5) * r - b.gridMinX) / rb);
            const jy = Math.floor((a.gridMinY + (iy + 0.5) * r - b.gridMinY) / rb);
            const jz = Math.floor((a.gridMinZ + (iz + 0.5) * r - b.gridMinZ) / rb);
            if (jx < 0 || jy < 0 || jz < 0 || jx >= b.numVoxelsX || jy >= b.numVoxelsY || jz >= b.numVoxelsZ) continue;
            if (b.isVoxelSolid(jx, jy, jz)) shared++;
        }
    });
    return { solid, shared };
}

const pick = pickBrowser({ expected: chromium.executablePath() });
const browser = await chromium.launch({ ...pick.launch, headless: true, args: ['--enable-precise-memory-info'] });
const out: Record<string, unknown>[] = [];
const fly = (scene: string, extra = '') => `${site}/en/fly/?scene=${scene}&nowarn=1&set.input.howToFly=false${extra}`;
const g = (page: any, f: string) => page.evaluate(f);

async function open(scene: string, extra = ''): Promise<{ page: any; ctx: any; r: Record<string, unknown> }> {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e: Error) => errors.push(String(e.message).slice(0, 160)));
    const r: Record<string, unknown> = { scene, errors };
    const t0 = Date.now();
    await page.goto(fly(scene, extra), { waitUntil: 'load', timeout: 180000 });
    await page.waitForFunction(() => ['ready', 'error'].includes((window as any).__gsfpv?.status), null, { timeout: 600000 });
    r.loadS = (Date.now() - t0) / 1000;
    return { page, ctx, r };
}

if (mode === 'trials') {
    for (const part of spec.split(';')) {
        const [scene, steps] = part.split(':');
        const { page, ctx, r } = await open(scene);
        r.trials = [];
        let shipped: VoxelCollision | null = null;
        const base = await g(page, '(() => { const u = window.__gsfpv.session.scene.contentUrl; return u.slice(0, u.lastIndexOf("/") + 1); })()');
        const wv = await g(page, 'window.__gsfpv.walls.voxelM ?? null');
        if (wv) {
            const [j, b] = await Promise.all(['scene.voxel.json', 'scene.voxel.bin'].map(async (f) => new Uint8Array(await (await fetch(base + f)).arrayBuffer())));
            shipped = collision(j, b);
            r.shipped = { voxelM: shipped.voxelResolution, solid: countSolidVoxelsFromBytes(j, b) };
        }
        for (const st of steps.split(',')) {
            const [level, cm] = st.split('@').map(Number);
            const t = Date.now();
            const res = await page.evaluate((o: { level: number; voxelM: number }) => (window as any).__gsfpv.bakeTrial(o), { level, voxelM: cm / 100 });
            res.wallS = (Date.now() - t) / 1000;
            if (res.ok && shipped) {
                const b64: string = await page.evaluate(async () => {
                    const b = (window as any).__gsfpv.bakedBytes;
                    const enc = async (u: Uint8Array) => { const s = await new Promise<string>((ok) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result)); fr.readAsDataURL(new Blob([u])); }); return s.slice(s.indexOf(',') + 1); };
                    return JSON.stringify([await enc(b.json), await enc(b.bin)]);
                });
                const [j, b] = (JSON.parse(b64) as string[]).map((s) => new Uint8Array(Buffer.from(s, 'base64')));
                const baked = collision(j, b);
                const a = inside(baked, shipped), s2 = inside(shipped, baked);
                // both read at the cell of the other: shares, not a voxel-exact match when cells differ
                res.agreement = { bakedSolid: a.solid, bakedInShipped: +(a.shared / a.solid).toFixed(4), shippedSolid: s2.solid, shippedFound: +(s2.shared / s2.solid).toFixed(4) };
            }
            (r.trials as unknown[]).push(res);
            console.log(scene, JSON.stringify(res).slice(0, 400));
        }
        out.push(r);
        writeFileSync(outFile, JSON.stringify(out, null, 1));
        await ctx.close();
    }
} else {
    for (const scene of spec.split(',')) {
        const { page, ctx, r } = await open(scene, '&bake=1');
        const tb = Date.now();
        await page.waitForFunction(() => ['in-use', 'failed', 'refused'].includes((window as any).__gsfpv?.walls?.state), null, { timeout: 1200000 }).catch((e: Error) => { r.wait = String(e).slice(0, 120); });
        r.bakeS = (Date.now() - tb) / 1000;
        r.state = await g(page, 'window.__gsfpv.walls.state');
        r.lastBake = await g(page, 'window.__gsfpv.walls.lastBake');
        r.said = await g(page, '(document.querySelector("[data-testid=bake-status]")?.textContent ?? "").trim()');
        r.hasCollision = await g(page, '!!window.__gsfpv.session.collision');
        r.wallHit = r.hasCollision ? await g(page, 'window.__gsfpv.session.tunnelSelfTest(20, 25, 11)') : null;
        await page.screenshot({ path: `U:/Temp/gsfpv-train2/shots/walls-ladder-${scene}.png` });
        out.push(r);
        console.log(JSON.stringify(r).slice(0, 600));
        writeFileSync(outFile, JSON.stringify(out, null, 1));
        await ctx.close();
    }
}
await browser.close();
