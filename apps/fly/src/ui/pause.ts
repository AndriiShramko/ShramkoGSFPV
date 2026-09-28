// The pause menu (split from ui/flight.ts, v0.3 wave 1): one button per registered menu item, in
// order, each with the keys that do the same thing (from the keymap, docs/architecture-v03.md 1.2),
// then the contact link. app/menu.ts owns what the items do and which keys run them.
import type { KeyHint } from '@gsfpv/prefs';
import { h, panel } from './dom';
import { t, locale } from '../i18n';

/** One button of the menu: `id` is its data-action, `keys` its key-caps (keysFor of its action). */
export interface PauseMenuEntry {
    id: string;
    labelKey: string;
    keys: readonly KeyHint[];
    disabled?: boolean;
}

/**
 * Show the menu; `pick` runs with the entry's index when a button is pressed (the menu is still on
 * the page then), `onClose` for the panel's x. Returns the function that takes the menu off the page.
 */
export function pauseMenu(parent: HTMLElement, entries: readonly PauseMenuEntry[], pick: (index: number) => void, onClose: () => void): () => void {
    const p = panel(t('pause.title'), onClose);
    p.root.classList.add('pause-menu');
    entries.forEach((it, i) => {
        const ks = it.keys;
        // the caps are for the eye; a screen reader gets the same keys from aria-keyshortcuts
        const caps = ks.length ? h('span', { class: 'pm-keys', 'aria-hidden': 'true' }, ...ks.map((x) => h('kbd', {}, x.cap))) : null;
        p.body.append(h('button', { type: 'button', class: 'btn block', 'data-action': it.id, 'aria-keyshortcuts': ks.length ? ks.map((x) => x.aria).join(' ') : undefined, disabled: it.disabled, onclick: () => pick(i) },
            h('span', { class: 'pm-label' }, t(it.labelKey)), caps));
    });
    p.body.append(h('a', { class: 'btn block', href: `/${locale}/#contact`, target: '_blank', rel: 'noopener' }, h('span', { class: 'pm-label' }, t('pause.contact'))));
    parent.append(p.root);
    return p.close;
}
