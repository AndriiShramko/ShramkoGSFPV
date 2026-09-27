// The pause menu: the registered menu items in order, each with the keys that do the same thing
// (from the keymap, docs/architecture-v03.md 1.2), and the contact link.
import { keysFor } from '@gsfpv/prefs';
import { h, panel } from './dom';
import { t, locale } from '../i18n';
import type { MenuItem } from '../app/context';

/**
 * Show the menu; `pick` runs when an item is chosen, `onClose` for the panel's x. Returns the
 * function that takes the menu off the page.
 */
export function pauseMenu(parent: HTMLElement, items: readonly MenuItem[], pick: (item: MenuItem) => void, onClose: () => void): () => void {
    const p = panel(t('pause.title'), onClose);
    p.root.classList.add('pause-menu');
    for (const it of items) {
        const ks = it.action ? keysFor(it.action) : [];
        // the caps are for the eye; a screen reader gets the same keys from aria-keyshortcuts
        const caps = ks.length ? h('span', { class: 'pm-keys', 'aria-hidden': 'true' }, ...ks.map((x) => h('kbd', {}, x.cap))) : null;
        p.body.append(h('button', { type: 'button', class: 'btn block', 'data-action': it.id, 'aria-keyshortcuts': ks.length ? ks.map((x) => x.aria).join(' ') : undefined, disabled: it.enabled?.() === false, onclick: () => pick(it) },
            h('span', { class: 'pm-label' }, t(it.labelKey)), caps));
    }
    p.body.append(h('a', { class: 'btn block', href: `/${locale}/#contact`, target: '_blank', rel: 'noopener' }, h('span', { class: 'pm-label' }, t('pause.contact'))));
    parent.append(p.root);
    return p.close;
}
