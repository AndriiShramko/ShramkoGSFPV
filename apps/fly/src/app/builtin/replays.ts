// The menu's "Replays": the logs saved in this tab, each to play back or export as a trajectory.
import { InputLog } from '@gsfpv/sim-core';
import { replaysPanel } from '../../ui/panels';
import { exportTrajectory } from '../logs';
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
                    play: () => { ctx.resume('panel'); session.startReplay(InputLog.fromBytes(l.header, l.bytes), 0, l.endTick); },
                    exportCsv: () => exportTrajectory(session, 'csv'),
                    exportJson: () => exportTrajectory(session, 'json')
                })), () => ctx.resume('panel'));
            }
        });
    }
};
