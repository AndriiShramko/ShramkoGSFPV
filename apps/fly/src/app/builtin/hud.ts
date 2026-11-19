// The OSD on the flight view (ui/hud.ts): put on the page here, in its place among the flight
// view's parts; H switches every text on the flight view off and on, F3 the frame line; the walls
// tag and the note when the walls are switched.
import { isFormField } from '../../ui/hud';
import { t } from '../../i18n';
import type { Feature, PauseReason } from '../context';
import { lodLine, lodReport } from '../lod';
import { drawingFor, drawingLine } from '../drawing';
import { cleanDraw } from '../clean-draw';
import { onRadioLost } from '../../devices/dji-rc2-source';
import { messages } from '../../ui/messages';
import { openMessages, toggleMessages, type MessagesHost } from '../../ui/messages-panel';
import { openFeedback } from './feedback';

/** The pauses that put a window over the flight view (the message lines wait under them, ui/messages.ts setCovered). */
const COVERING: ReadonlySet<PauseReason> = new Set<PauseReason>(['menu', 'panel', 'controls', 'export', 'help']);

export const hud: Feature = {
    id: 'hud',
    install(ctx) {
        const h = ctx.hud;
        h.mount(ctx.ui);
        // the message service (ui/messages.ts): every line carries the scene; a problem's "Send to the author" opens the report
        messages.setScene(() => ctx.scene?.id);
        messages.setReporter((text) => openFeedback(ctx, 'bug', { message: text }));
        // the Messages list: Shift+H, the top-row button (builtin/top.ts) and the stack's '+N more' line open it
        const list: MessagesHost = { parent: ctx.ui, pause: () => ctx.pause('panel'), resume: () => ctx.resume('panel') };
        messages.openList = () => openMessages(list);
        ctx.keys.on('messages.open', (e) => {
            if (e.repeat) return;
            if (toggleMessages(list)) e.preventDefault();
        });
        // the pause menu (the pilot's Esc frees the mouse and opens it) leads to the list: the lines wait under the menu
        ctx.menu.add({ id: 'pause.messages', action: 'messages.open', labelKey: 'messages.title', order: 74, section: 'tools', run: () => openMessages(list) });
        // a window over the flight (the windows that free the cursor, builtin/play.ts): the lines wait under it, time stopped
        ctx.events.on('pause', ({ on, reasons }) => {
            messages.setCovered(on && reasons.some((r) => COVERING.has(r)));
        });
        // arm kind 'key' (no switch on the radio): the on-screen ARM / DISARM button
        h.onArm = () => ctx.controls.toggleArm();
        // the walls tag itself the OSD reads from the flight (ui/hud.ts update)
        ctx.events.on('walls', ({ on }) => {
            h.flash(t(on ? 'walls.switchedOn' : 'walls.switchedOff'), 3500);
        });
        // review R10 (lane rc2): the DJI RC 2 or its bridge stopped by itself; the stale rule already stopped the motors
        onRadioLost(() => h.flash(t('usb.rc2.lost'), 8000));
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
            h.setDrawingLine(ctx.renderer.splatVisible ? drawingLine(drawingFor(ctx.prefs, ctx.scene, ctx.renderer.isWebGPU, ctx.renderer.gpuInfo), t, cleanDraw.held, ctx.renderer.drawn, ctx.renderer.plan.why) : null);
        });
    }
};
