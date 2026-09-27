// The pause menu's Replays: the logs saved in this tab (the crash panel's Save) played back from
// their inputs, and the trajectory as CSV / JSON.
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
                ctx.pause('panel');
                const s = ctx.session;
                replaysPanel(ctx.ui, ctx.hook.savedLogs.map((l) => ({
                    label: l.label,
                    play: () => { ctx.resume('panel'); s.startReplay(InputLog.fromBytes(l.header, l.bytes), 0, l.endTick); },
                    exportCsv: () => exportTrajectory(s, 'csv'),
                    exportJson: () => exportTrajectory(s, 'json')
                })), () => ctx.resume('panel'));
            }
        });
    }
};
