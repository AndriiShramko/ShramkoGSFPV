// The OSD (ui/hud.ts): on the page after the scene's notes, updated every frame; F3 shows frame stats.
import type { Feature } from '../context';

export const hud: Feature = {
    id: 'hud',
    install(ctx) {
        ctx.hud.mount(ctx.ui);
        ctx.events.on('frame', () => {
            const s = ctx.session;
            ctx.hud.update(s, ctx.controls.block, s.frameStats(), ctx.controls.view());
        });
        ctx.keys.on('frameStats.toggle', (e) => { ctx.hud.toggleFrameStats(); e.preventDefault(); });
    }
};
