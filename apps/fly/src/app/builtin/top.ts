// The buttons at the top right: Settings (the gear, O), Feedback (a bug, an idea or cooperation, B), Controls (the Controls screen) and Pause (the pause menu).
import { h } from '../../ui/dom';
import { t } from '../../i18n';
import { openSettings } from './settings';
import { openFeedback } from './feedback';
import type { Feature } from '../context';

/** A gear drawn as SVG: a glyph such as U+2699 turns into a colour emoji on some systems. */
function gear(): SVGSVGElement {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '20');
    svg.setAttribute('height', '20');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('fill', 'currentColor');
    p.setAttribute('d', 'M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.4 7.4 0 0 0-1.7-1L15 3h-4l-.4 2.6a7.4 7.4 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.6 7.6 0 0 0 0 2l-2.2 1.6 2 3.5 2.5-1a7.4 7.4 0 0 0 1.7 1L11 21h4l.4-2.6a7.4 7.4 0 0 0 1.7-1l2.5 1 2-3.5zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z');
    svg.append(p);
    return svg;
}

export const topActions: Feature = {
    id: 'top-actions',
    install(ctx) {
        // W2-1: the gear opens Settings; its key-cap (O) is in its name and tooltip, like the menu's
        const caps = ctx.keys.caps('settings.open');
        const name = `${t('settings.title')}${caps.length ? ` (${caps.map((c) => c.cap).join(', ')})` : ''}`;
        const settingsBtn = h('button', { type: 'button', class: 'btn gear', 'data-action': 'open-settings', 'aria-label': name, title: name, 'aria-keyshortcuts': caps.map((c) => c.aria).join(' ') || undefined, onclick: () => openSettings(ctx) });
        settingsBtn.append(gear());
        const fbCaps = ctx.keys.caps('feedback.open');
        const fbName = `${t('fb.menu')}${fbCaps.length ? ` (${fbCaps.map((c) => c.cap).join(', ')})` : ''}`;
        ctx.ui.append(h('div', { class: 'top-actions' },
            settingsBtn,
            h('button', { type: 'button', class: 'btn', 'data-action': 'open-feedback', title: fbName, 'aria-keyshortcuts': fbCaps.map((c) => c.aria).join(' ') || undefined, onclick: () => openFeedback(ctx) }, t('fb.button')),
            h('button', { type: 'button', class: 'btn', 'data-action': 'open-controls', onclick: () => ctx.input.openRadio() }, t('top.controls')),
            h('button', { type: 'button', class: 'btn', 'data-action': 'pause', onclick: () => ctx.menu.open() }, t('top.pause'))));
    }
};
