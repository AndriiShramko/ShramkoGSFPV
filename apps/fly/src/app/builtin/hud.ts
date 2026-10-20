// The OSD on the flight view (ui/hud.ts): put on the page here, in its place among the flight
// view's parts; H switches every text on the flight view off and on, F3 the frame line; the walls
// tag and the note when the walls are switched.
import { isFormField } from '../../ui/hud';
import { t } from '../../i18n';
import type { Feature } from '../context';
import { lodLine, lodReport } from '../lod';
import { drawingFor, drawingLine } from '../drawing';
import { cleanDraw } from '../clean-draw';

export const hud: Feature = {
    id: 'hud',
    install(ctx) {
        const h = ctx.hud;
        h.mount(ctx.ui);
        // arm kind 'key' (no switch on the radio): the on-screen ARM / DISARM button
        h.onArm = () => ctx.controls.toggleArm();
        // the walls tag itself the OSD reads from the flight (ui/hud.ts update)
        ctx.events.on('walls', ({ on }) => {
            h.flash(t(on ? 'walls.switchedOn' : 'walls.switchedOff'), 3500);
        });
        ctx.keys.on('hud.toggle', (e) => {
            // any form field (a slider too) keeps its H; a screen or a panel on top has its own keys
            if (e.repeat || isFormField(e.target) || document.querySelector('#ui .screen, #ui .panel')) return;
            h.toggleText();
        });
        ctx.keys.on('frameStats.toggle', (e) => {
            h.toggleFrameStats();
            e.preventDefault();
        });
        // F3's second line: the levels of detail at work (v0.8 item 8), and a third: how the scan is drawn (v0.9:
        // stochastic or sorted, who decided), four times a second while shown
        let lastDetail = 0;
        ctx.events.on('frame', ({ now }) => {
            if (!h.frameStatsShown || now - lastDetail < 250) return;
            lastDetail = now;
            h.setDetailLine(ctx.renderer.splatVisible ? lodLine(lodReport(ctx), t) : null);
            h.setDrawingLine(ctx.renderer.splatVisible ? drawingLine(drawingFor(ctx.prefs, ctx.scene, ctx.renderer.isWebGPU, ctx.renderer.gpuInfo), t, cleanDraw.held) : null);
        });
    }
};
