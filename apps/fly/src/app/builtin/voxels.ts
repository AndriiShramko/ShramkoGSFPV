// The voxel grid (V: off / over the scan / voxels only): the legend chip at the top right while it
// is shown, the key, and the test hook's handle. The controller is ctx.voxels (voxels.ts); the shell
// steps it every frame, the walls block (walls menu, settings) sets its style and opacity.
import { voxelLegend } from '../../ui/voxels';
import { t } from '../../i18n';
import type { Feature } from '../context';

export const voxels: Feature = {
    id: 'voxels',
    install(ctx) {
        const v = ctx.voxels;
        voxelLegend(ctx.ui, v);
        ctx.events.on('walls', () => v.touch());
        ctx.keys.on('voxels.cycle', (e) => {
            if (e.repeat) return;
            if (!ctx.session.collision) ctx.hud.flash(t('voxels.noWalls'), 3500);
            else ctx.hud.flash(t('voxels.flash', { mode: t(`voxels.mode.${v.cycle()}`) }));
        });
        ctx.hook.voxels = {
            stats: () => v.stats(),
            perf: () => ({ ...v.perf }),
            settled: () => v.settled,
            setMode: (m) => v.setMode(m),
            setStyle: (st) => v.configure({ style: st }),
            setOpacity: (a) => v.configure({ opacity: a }),
            setRadius: (m) => { v.radiusM = Math.max(2, Math.min(60, m)); }
        };
    }
};
