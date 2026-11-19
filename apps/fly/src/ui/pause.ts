// The pause menu, which is now the summary panel (docs/architecture-v03.md D.2, item 7): one button
// per registered menu item, in order, each with the keys that do the same thing (from the keymap,
// 1.2), then the contact link; with the summary's data (app/builtin/summary.ts) the stats of the
// flight on the left and every keyboard shortcut under the menu. app/menu.ts owns what the items do
// and which keys run them. Up / Down move between the menu's buttons; the first one has the focus.
import type { KeyHint } from '@gsfpv/prefs';
import { h, panel } from './dom';
import { modeChip, throttleChip, statsColumn, keysBlock } from './summary';
import type { SummaryData } from './summary';
import { t, locale } from '../i18n';
import { consentSettingsShown, openConsent } from '../app/analytics';

/** One button of the menu: `id` is its data-action, `keys` its key-caps (keysFor of its action). */
export interface PauseMenuEntry {
    id: string;
    labelKey: string;
    /** a text that says the item's state now (recording: "Recording 0:42 - stop"); else t(labelKey) */
    label?: string;
    keys: readonly KeyHint[];
    disabled?: boolean;
    /** the item opens another page: a link to it, in a new tab (the flight stays paused under the menu) */
    href?: string;
    /** above the pilot's menu level (app/menu-levels.ts): drawn inside the collapsed "More (n)" */
    more?: boolean;
}

/** What the menu does beyond its items: "Always show everything" under "More", and the item that takes the focus. */
export interface PauseMenuOptions {
    showAll?: () => void;
    focus?: string | null;
}

/** A button of the walk with Up / Down: shown now (not inside a closed "More"), or the "More" line itself. */
const walkable = (el: HTMLElement): boolean => el.tagName === 'SUMMARY' || !el.closest('details:not([open])');

/** A link of the menu opens another page in a new tab: a screen reader hears so, the eye sees the item alone (review R8). */
const newTab = (): HTMLElement => h('span', { class: 'visually-hidden' }, ` ${t('pause.newTab')}`);

/**
 * Show the menu; `pick` runs with the entry's index when a button is pressed (the menu is still on
 * the page then), `onClose` for the panel's x. `summary`: the stats and the keys beside the menu
 * (null: the menu alone); `rows`: whole-width rows above them. Returns the function that takes the menu off the page.
 */
export function pauseMenu(parent: HTMLElement, entries: readonly PauseMenuEntry[], pick: (index: number) => void, onClose: () => void, summary: SummaryData | null = null, rows: readonly HTMLElement[] = [], opts: PauseMenuOptions = {}): () => void {
    const p = panel(t('pause.title'), onClose);
    p.root.classList.add('pause-menu', 'summary');
    if (summary) p.root.classList.add('has-stats');
    const chip = summary ? modeChip(summary.mode) : null;
    if (chip) p.root.querySelector('.panel-head h2')?.after(chip);
    const thr = summary ? throttleChip(summary.throttle) : null;
    if (thr) (chip ?? p.root.querySelector('.panel-head h2'))?.after(thr);
    const menu = h('nav', { class: 'sum-col sum-menu', 'aria-label': t('summary.menu') });
    const button = (it: PauseMenuEntry, i: number): HTMLElement => {
        const ks = it.keys;
        // the caps are for the eye; a screen reader gets the same keys from aria-keyshortcuts
        const caps = ks.length ? h('span', { class: 'pm-keys', 'aria-hidden': 'true' }, ...ks.map((x) => h('kbd', {}, x.cap))) : null;
        const label = h('span', { class: 'pm-label' }, it.label ?? t(it.labelKey));
        return it.href ? h('a', { class: 'btn block', 'data-action': it.id, href: it.href, target: '_blank', rel: 'noopener' }, label, newTab())
            : h('button', { type: 'button', class: 'btn block', 'data-action': it.id, 'aria-keyshortcuts': ks.length ? ks.map((x) => x.aria).join(' ') : undefined, disabled: it.disabled, onclick: () => pick(i) }, label, caps);
    };
    entries.forEach((it, i) => { if (!it.more) menu.append(button(it, i)); });
    // the items above the pilot's level: one press away, never removed (their keys run them while the menu is up)
    const hidden = entries.map((it, i) => (it.more ? button(it, i) : null)).filter((x): x is HTMLElement => x !== null);
    if (hidden.length) {
        const all = opts.showAll ? h('button', { type: 'button', class: 'btn block pm-show-all', 'data-action': 'menu-show-all', onclick: () => opts.showAll?.() }, h('span', { class: 'pm-label' }, t('menu.showAll'))) : null;
        menu.append(h('details', { class: 'pm-more', 'data-testid': 'pause-more' },
            h('summary', { class: 'btn block', 'data-action': 'menu-more' }, h('span', { class: 'pm-label' }, t('menu.more', { n: hidden.length }))),
            ...hidden, all));
    }
    menu.append(h('a', { class: 'btn block', href: `/${locale}/#contact`, target: '_blank', rel: 'noopener' }, h('span', { class: 'pm-label' }, t('pause.contact')), newTab()));
    // stats | menu | keys on a wide screen, stats | menu over keys below 1100 px, one column on a phone
    // rows of other features above the columns (the scene size, E.7)
    if (rows.length) p.body.append(h('div', { class: 'sum-rows' }, ...rows));
    p.body.append(h('div', { class: 'sum-grid' }, summary ? statsColumn(summary) : null, menu, summary ? keysBlock(summary) : null));
    // the simulator's "footer": the analytics choice again (app/analytics.ts; not on test pages, which have no GA)
    if (consentSettingsShown()) p.body.append(h('p', { class: 'pm-cookies' }, h('button', { type: 'button', class: 'linkish', 'data-action': 'cookie-settings', onclick: () => openConsent() }, t('consent.settings'))));
    // Up / Down walk the menu (arrows fly only outside a dialog: devices/keyboard.ts dialogOpen)
    p.root.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        const list = Array.from(menu.querySelectorAll<HTMLElement>('.btn:not([disabled])')).filter(walkable);
        const at = list.indexOf(document.activeElement as HTMLElement);
        if (!list.length) return;
        const next = at < 0 ? 0 : (at + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length;
        list[next].focus();
        e.preventDefault();
    });
    parent.append(p.root);
    const first = (opts.focus ? menu.querySelector<HTMLElement>(`[data-action="${opts.focus}"]:not([disabled])`) : null) ?? menu.querySelector<HTMLElement>('.btn:not([disabled])');
    first?.focus({ preventScroll: true });
    return p.close;
}
