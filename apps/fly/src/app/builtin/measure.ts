// The menu's "Measurements": renderer, output rate, frame times, input, load time, walls, and the
// tunnelling self-test run now; copyable as JSON.
import { GSPLAT_RENDERER_RASTER_GPU_SORT } from 'playcanvas';
import { measurePanel } from '../../ui/panels';
import { t } from '../../i18n';
import type { FlightSession } from '../../session';
import type { Controls } from '../../controls';
import type { Feature } from '../context';

function measureReport(s: FlightSession, c: Controls): Record<string, unknown> {
    const fs = s.frameStats();
    const tt = s.collision ? s.tunnelSelfTest(5, 25) : null;
    return {
        renderer: s.renderer.currentRenderer === GSPLAT_RENDERER_RASTER_GPU_SORT ? 'WebGPU, GPU sort' : `renderer ${s.renderer.currentRenderer}`,
        outputHz: fs.hz,
        frameP50: fs.p50,
        frameP99: fs.p99,
        physicsHz: 1000,
        inputSource: c.source,
        inputHz: null,
        pipelineMs: null,
        loadMs: s.timings.visibleMs,
        collision: s.collision ? `voxel ${Math.round(s.collision.voxelResolution * 1000) / 10} cm, ${s.collision.flipXY ? 'format 1.0' : 'format 1.1'}${s.wallsOn ? '' : ', switched off'}` : 'none',
        walls: s.walls,
        tunnelSelfTest: tt ? t('tunnel.pass', { n: tt.passes, v: tt.speed, bad: tt.penetrations }) : '—',
        simCore: s.log.header.simCore,
        preset: s.presetId,
        date: new Date().toISOString()
    };
}

export const measure: Feature = {
    id: 'measure',
    install(ctx) {
        ctx.menu.add({
            id: 'pause.measure', action: null, labelKey: 'pause.measure', order: 80, section: 'tools',
            run: () => {
                ctx.pause('panel');
                measurePanel(ctx.ui, measureReport(ctx.session, ctx.controls), () => ctx.resume('panel'));
            }
        });
    }
};
