// The two buttons at the top edge: the Controls screen and the pause menu.
import { h } from '../../ui/dom';
import { t } from '../../i18n';
import type { Feature } from '../context';

export const topActions: Feature = {
    id: 'top-actions',
    install(ctx) {
        ctx.ui.append(h('div', { class: 'top-actions' },
            h('button', { type: 'button', class: 'btn', 'data-action': 'open-controls', onclick: () => ctx.input.openRadio() }, t('top.controls')),
            h('button', { type: 'button', class: 'btn', 'data-action': 'pause', onclick: () => ctx.menu.open() }, t('top.pause'))));
    }
};
