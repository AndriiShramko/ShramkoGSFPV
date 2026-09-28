// Pause: P or Esc opens the pause menu (inside it they continue: app/menu.ts), Esc over a panel
// opened from the menu closes that panel, and a tab going hidden pauses into the menu.
import { V02_PAUSE_ITEMS } from '@gsfpv/prefs';
import { dialogOpen } from '../../devices/keyboard';
import { q } from '../env';
import type { Feature } from '../context';

export const pause: Feature = {
    id: 'pause',
    install(ctx) {
        // Continue: the menu closes and releases its pause; nothing else to do
        ctx.menu.add({ id: 'pause.continue', action: V02_PAUSE_ITEMS.resume, labelKey: 'pause.continue', order: 10, section: 'flight', run: () => undefined });
        ctx.keys.on('pause.toggle', (e) => {
            if (!dialogOpen()) ctx.menu.open();
            // Esc over a screen opened from the menu (settings, replays...) closes it; a screen that
            // is not a panel (the drone picker) takes Esc over while it is up
            else if (e.code === 'Escape') Array.from(ctx.ui.querySelectorAll<HTMLButtonElement>('.panel .panel-x')).pop()?.click();
        });
        document.addEventListener('visibilitychange', () => {
            // already paused (Controls, settings, a picker): a pause menu on top would resume the flight under it
            if (document.visibilityState === 'hidden' && !ctx.menu.isOpen && !ctx.session.paused && !q.get('simradio') && q.get('lat') !== '1') ctx.menu.open();
        });
    }
};
