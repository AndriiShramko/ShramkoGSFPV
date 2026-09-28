// The menu's "Controls": the Controls screen (app/input.ts) takes the menu's place and its pause.
import type { Feature } from '../context';

export const controlsItem: Feature = {
    id: 'controls',
    install(ctx) {
        ctx.menu.add({ id: 'pause.radio', action: null, labelKey: 'pause.radio', order: 50, section: 'setup', run: () => ctx.input.openRadio() });
    }
};
