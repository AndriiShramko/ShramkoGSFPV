// The input in flight: every frame the arm gate hears about stale input or a hidden tab, and the
// pause menu opens the Controls screen (the input itself: app/input.ts).
import type { Feature } from '../context';

export const input: Feature = {
    id: 'input',
    install(ctx) {
        ctx.events.on('frame', ({ now }) => ctx.controls.tick(now));
        // Controls takes the menu's place: its own pause holds the flight while it is up
        ctx.menu.add({ id: 'pause.radio', action: null, labelKey: 'pause.radio', order: 50, section: 'setup', run: () => ctx.input.openRadio() });
    }
};
