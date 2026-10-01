// The pause menu, which is now the summary panel (docs/architecture-v03.md D.2, item 7): one button
// per registered menu item, in order, each with the keys that do the same thing (from the keymap,
// 1.2), then the contact link; with the summary's data (app/builtin/summary.ts) the stats of the
// flight on the left and every keyboard shortcut under the menu. app/menu.ts owns what the items do
// and which keys run them. Up / Down move between the menu's buttons; the first one has the focus.
import type { KeyHint } from '@gsfpv/prefs';
import { h, panel } from './dom';
import { modeChip, statsColumn, keysBlock } from './summary';
import type { SummaryData } from './summary';
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
 * the page then), `onClose` for the panel's x. `summary`: the stats and the keys beside the menu
 * (null: the menu alone). Returns the function that takes the menu off the page.
 */
export function pauseMenu(parent: HTMLElement, entries: readonly PauseMenuEntry[], pick: (index: number) => void, onClose: () => void, summary: SummaryData | null = null): () => void {
    const p = panel(t('pause.title'), onClose);
    p.root.classList.add('pause-menu', 'summary');
    if (summary) p.root.classList.add('has-stats');
    const chip = summary ? modeChip(summary.mode) : null;
    if (chip) p.root.querySelector('.panel-head h2')?.after(chip);
    const menu = h('nav', { class: 'sum-col sum-menu', 'aria-label': t('summary.menu') });
    entries.forEach((it, i) => {
        const ks = it.keys;
        // the caps are for the eye; a screen reader gets the same keys from aria-keyshortcuts
        const caps = ks.length ? h('span', { class: 'pm-keys', 'aria-hidden': 'true' }, ...ks.map((x) => h('kbd', {}, x.cap))) : null;
        menu.append(h('button', { type: 'button', class: 'btn block', 'data-action': it.id, 'aria-keyshortcuts': ks.length ? ks.map((x) => x.aria).join(' ') : undefined, disabled: it.disabled, onclick: () => pick(i) },
            h('span', { class: 'pm-label' }, t(it.labelKey)), caps));
    });
    menu.append(h('a', { class: 'btn block', href: `/${locale}/#contact`, target: '_blank', rel: 'noopener' }, h('span', { class: 'pm-label' }, t('pause.contact'))));
    const right = h('div', { class: 'sum-col' }, menu);
    if (summary) right.append(keysBlock(summary));
    p.body.append(h('div', { class: 'sum-grid' }, summary ? statsColumn(summary) : null, right));
    // Up / Down walk the menu (arrows fly only outside a dialog: devices/keyboard.ts dialogOpen)
    p.root.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        const list = Array.from(menu.querySelectorAll<HTMLElement>('.btn:not([disabled])'));
        const at = list.indexOf(document.activeElement as HTMLElement);
        if (!list.length) return;
        const next = at < 0 ? 0 : (at + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length;
        list[next].focus();
        e.preventDefault();
    });
    parent.append(p.root);
    menu.querySelector<HTMLElement>('.btn:not([disabled])')?.focus({ preventScroll: true });
    return p.close;
}
