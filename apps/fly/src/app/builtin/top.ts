// The buttons at the top right: Full screen (F), Settings (the gear, O), Feedback (a bug, an idea or cooperation, B), Controls (the Controls screen) and Pause (the pause menu).
import { h } from '../../ui/dom';
import { t } from '../../i18n';
import { openSettings } from './settings';
import { openFeedback } from './feedback';
import { fullscreenAvailable, isFullscreen, onFullscreenChange, toggleFullscreen } from '../../play/fullscreen';
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

/** Full screen drawn as SVG (corner brackets out to go in, in to come back): like the gear, no glyph that may turn into an emoji. */
function fullscreenIcon(on: boolean): SVGSVGElement {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '20');
    svg.setAttribute('height', '20');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', 'currentColor');
    p.setAttribute('stroke-width', '2');
    p.setAttribute('stroke-linecap', 'round');
    p.setAttribute('stroke-linejoin', 'round');
    p.setAttribute('d', on ? 'M9 4v5H4M15 4v5h5M20 15h-5v5M4 15h5v5' : 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5');
    svg.append(p);
    return svg;
}

export const topActions: Feature = {
    id: 'top-actions',
    install(ctx) {
        // v0.9: full screen (F) for a pilot who is distracted by the browser around the view; works with the captured mouse
        const fsCaps = ctx.keys.caps('fullscreen.toggle');
        const fsBtn = h('button', { type: 'button', class: 'btn icon fullscreen', 'data-action': 'fullscreen-toggle', 'aria-keyshortcuts': fsCaps.map((c) => c.aria).join(' ') || undefined, hidden: !fullscreenAvailable(), onclick: () => void toggleFullscreen() });
        const paintFullscreen = (on: boolean): void => {
            const label = `${t(on ? 'play.fullscreen.exit' : 'play.fullscreen.button')}${fsCaps.length ? ` (${fsCaps.map((c) => c.cap).join(', ')})` : ''}`;
            fsBtn.setAttribute('aria-label', label);
            fsBtn.title = label;
            fsBtn.setAttribute('aria-pressed', String(on));
            fsBtn.replaceChildren(fullscreenIcon(on));
        };
        paintFullscreen(isFullscreen());
        const offFullscreen = onFullscreenChange(paintFullscreen);
        // W2-1: the gear opens Settings; its key-cap (O) is in its name and tooltip, like the menu's
        const caps = ctx.keys.caps('settings.open');
        const name = `${t('settings.title')}${caps.length ? ` (${caps.map((c) => c.cap).join(', ')})` : ''}`;
        const settingsBtn = h('button', { type: 'button', class: 'btn gear', 'data-action': 'open-settings', 'aria-label': name, title: name, 'aria-keyshortcuts': caps.map((c) => c.aria).join(' ') || undefined, onclick: () => openSettings(ctx) });
        settingsBtn.append(gear());
        const fbCaps = ctx.keys.caps('feedback.open');
        const fbName = `${t('fb.menu')}${fbCaps.length ? ` (${fbCaps.map((c) => c.cap).join(', ')})` : ''}`;
        ctx.ui.append(h('div', { class: 'top-actions' },
            fsBtn,
            settingsBtn,
            h('button', { type: 'button', class: 'btn', 'data-action': 'open-feedback', title: fbName, 'aria-keyshortcuts': fbCaps.map((c) => c.aria).join(' ') || undefined, onclick: () => openFeedback(ctx) }, t('fb.button')),
            h('button', { type: 'button', class: 'btn', 'data-action': 'open-controls', onclick: () => ctx.input.openRadio() }, t('top.controls')),
            h('button', { type: 'button', class: 'btn', 'data-action': 'pause', onclick: () => ctx.menu.open() }, t('top.pause'))));
        return () => offFullscreen();
    }
};
