// The menu's "Replays": the logs saved in this tab, each to play back or export as a trajectory.
import { replaysPanel } from '../../ui/panels';
import { exportTrajectory, lifeOf, playSaved } from '../logs';
import { videoExportOf } from './video-export';
import type { Feature } from '../context';

export const replays: Feature = {
    id: 'replays',
    install(ctx) {
        ctx.menu.add({
            id: 'pause.replays', action: null, labelKey: 'pause.replays', order: 70, section: 'tools',
            run: () => {
                const session = ctx.session;
                ctx.pause('panel');
                replaysPanel(ctx.ui, ctx.hook.savedLogs.map((l) => ({
                    label: l.label,
                    play: () => { ctx.resume('panel'); playSaved(session, l); },
                    exportCsv: () => exportTrajectory(session, 'csv'),
                    exportJson: () => exportTrajectory(session, 'json'),
                    // "Save as video" (F.3): the export holds its own pause before the panel's goes
                    video: ctx.scene.meta && videoExportOf(ctx) ? () => {
                        const lives = l.flight.lives.map((x) => lifeOf(x));
                        void videoExportOf(ctx)!({ lives, toTick: l.endTick });
                        ctx.resume('panel');
                    } : undefined
                })), () => ctx.resume('panel'));
            }
        });
    }
};
