// A1 probe, path 1: PlayCanvas engine directly through packages/render-pc.
import { SplatRenderer } from '@gsfpv/render-pc';
import { fetchVoxelCollision } from '@gsfpv/collision';
import { resolveScene } from '@gsfpv/scenes';

const out: Record<string, unknown> = { path: 'engine', status: 'running' };
(window as unknown as { __a1: unknown }).__a1 = out;

const frames = (n: number, app: { once: (e: string, f: () => void) => void }) =>
    new Promise<void>((res) => {
        let k = 0;
        const tick = () => { if (++k >= n) res(); else app.once('frameend', tick); };
        app.once('frameend', tick);
    });

async function run() {
    const canvas = document.getElementById('c') as HTMLCanvasElement;
    const sc = await resolveScene('39e63ce9');
    const r = await SplatRenderer.create(canvas, {});
    await r.loadSplat(sc.contentUrl);
    const col = await fetchVoxelCollision(sc.collisionUrl!);
    void col;
    r.start();
    await frames(30, r.app);
    r.revealFullDetail();

    // 1) our camera pose survives frames
    const P = [1.234, 1.5, -0.777];
    r.setPose(P[0], P[1], P[2], 1, 0, 0, 0, 0);
    await frames(5, r.app);
    const got = r.camera.getPosition();
    const camOk = Math.abs(got.x - P[0]) < 1e-6 && Math.abs(got.y - P[1]) < 1e-6 && Math.abs(got.z - P[2]) < 1e-6;

    // 2) render scale changes the backbuffer
    const sizes: Record<string, number[]> = {};
    for (const s of [0.5, 1, 2]) {
        r.setRenderScale(s);
        await frames(3, r.app);
        sizes[String(s)] = [canvas.width, canvas.height];
    }
    const cw = canvas.clientWidth * devicePixelRatio;
    const scaleOk = Math.abs(sizes['0.5'][0] - Math.round(cw * 0.5)) <= 1 && Math.abs(sizes['2'][0] - Math.round(cw * 2)) <= 1;
    r.setRenderScale(1);

    // 3) collision downloaded once
    const binLoads = performance.getEntriesByType('resource').filter((e) => e.name.includes('scene.voxel.bin')).length;

    Object.assign(out, {
        status: 'done',
        criteria: {
            ownCameraNotOverwritten: { pass: camOk, set: P, read: [got.x, got.y, got.z] },
            renderScaleChangesBackbuffer: { pass: scaleOk, clientWidthPx: cw, sizes },
            collisionLoadedOnce: { pass: binLoads === 1, voxelBinDownloads: binLoads },
            noPrivateApi: { pass: null, note: 'checked statically against playcanvas.d.ts by the harness' }
        },
        renderer: r.currentRenderer,
        visibility: document.visibilityState
    });
}

run().catch((e) => Object.assign(out, { status: 'error', error: String(e?.stack ?? e) }));
