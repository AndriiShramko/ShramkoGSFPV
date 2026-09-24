// A1 probe, path 2: the SuperSplat viewer wrapper (createViewer) from @playcanvas/supersplat-viewer.
import { createViewer } from '@playcanvas/supersplat-viewer/viewer';
import '@playcanvas/supersplat-viewer/viewer.css';
import { fetchVoxelCollision } from '@gsfpv/collision';
import { resolveScene } from '@gsfpv/scenes';
import { RESOLUTION_FIXED } from 'playcanvas';
import type { AppBase, Entity } from 'playcanvas';

const out: Record<string, unknown> = { path: 'createViewer', status: 'running' };
(window as unknown as { __a1: unknown }).__a1 = out;

const frames = (n: number, app: AppBase) =>
    new Promise<void>((res) => {
        let k = 0;
        const tick = () => { if (++k >= n) res(); else app.once('frameend', tick); };
        app.once('frameend', tick);
    });

async function run() {
    const container = document.getElementById('v') as HTMLDivElement;
    const sc = await resolveScene('39e63ce9');
    const viewer = await createViewer({
        container,
        settings: sc.settings as never,
        contentUrl: sc.contentUrl,
        collisionUrl: sc.collisionUrl ?? undefined,
        ui: false
    } as never);
    await new Promise<void>((res) => (viewer.state.loaded ? res() : viewer.events.once('loaded:changed', () => res())));
    const app = viewer.app as AppBase;
    viewer.state.cameraMode = 'fly';
    viewer.state.inputEnabled = false;
    await frames(10, app);
    const privateUse: string[] = [];

    // 1) our camera pose: the only handle is the internal entity (found by name)
    const cam = app.root.findByName('camera') as Entity | null;
    privateUse.push("app.root.findByName('camera') — internal entity, not part of the viewer API");
    const P = [1.234, 1.5, -0.777];
    cam?.setPosition(P[0], P[1], P[2]);
    await frames(5, app);
    const got = cam?.getPosition();
    const camOk = !!got && Math.abs(got.x - P[0]) < 1e-6 && Math.abs(got.y - P[1]) < 1e-6 && Math.abs(got.z - P[2]) < 1e-6;

    // 2) render scale: set a fixed backbuffer size and see whether it survives
    const canvas = app.graphicsDevice.canvas as HTMLCanvasElement;
    const cw = canvas.clientWidth * devicePixelRatio;
    const sizes: Record<string, number[]> = {};
    for (const s of [0.5, 2]) {
        app.setCanvasResolution(RESOLUTION_FIXED, Math.round(cw * s), Math.round(canvas.clientHeight * devicePixelRatio * s));
        window.dispatchEvent(new Event('resize'));
        await frames(5, app);
        sizes[String(s)] = [canvas.width, canvas.height];
    }
    const scaleOk = Math.abs(sizes['0.5'][0] - Math.round(cw * 0.5)) <= 1 && Math.abs(sizes['2'][0] - Math.round(cw * 2)) <= 1;

    // 3) the flight model needs the collision too; the viewer does not expose its instance
    await fetchVoxelCollision(sc.collisionUrl!);
    const binLoads = performance.getEntriesByType('resource').filter((e) => e.name.includes('scene.voxel.bin')).length;

    Object.assign(out, {
        status: 'done',
        criteria: {
            ownCameraNotOverwritten: { pass: camOk, set: P, read: got ? [got.x, got.y, got.z] : null },
            renderScaleChangesBackbuffer: { pass: scaleOk, clientWidthPx: cw, sizes },
            collisionLoadedOnce: { pass: binLoads === 1, voxelBinDownloads: binLoads },
            noPrivateApi: { pass: privateUse.length === 0, uses: privateUse }
        },
        renderer: app.scene.gsplat.currentRenderer,
        visibility: document.visibilityState
    });
    void viewer;
}

run().catch((e) => Object.assign(out, { status: 'error', error: String(e?.stack ?? e) }));
