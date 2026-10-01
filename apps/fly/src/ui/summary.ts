// The summary panel's stats and keys (docs/architecture-v03.md D.2, item 7: "at the end of a flight
// show the statistics, together with the panel of all settings, and write each key next to its
// item"). ui/pause.ts builds the panel (the menu items with their key-caps, as before) and puts
// these two blocks beside the menu: the stats of this flight, the session and the drone's lifetime
// on the left, every keyboard shortcut of the keymap under the menu. The data comes from
// app/builtin/summary.ts.
import type { StatsBlock } from '@gsfpv/sim-core';
import type { DroneTotals, KeyHint } from '@gsfpv/prefs';
import { STAT_ROWS, statText, statsText } from '../app/builtin/summary-stats';
import type { Units } from '../app/builtin/summary-stats';
import { unitWords } from './osd-stats';
import { h } from './dom';
import { t } from '../i18n';
import './summary.css';

/** One shipped binding of the keymap: its action, its name, its keys; `flying`: read by keyboard flying itself. */
export interface SummaryShortcut {
    action: string;
    labelKey: string;
    keys: readonly KeyHint[];
    flying: boolean;
}

/** What the panel shows beside the menu, taken when it opens. */
export interface SummaryData {
    /** the mode the craft flies now, e.g. 'angle' (null: none to show) */
    mode: string | null;
    life: StatsBlock;
    session: StatsBlock;
    lifetime: DroneTotals;
    /** the drone's name, for the lifetime column */
    drone: string;
    units: Units;
    shortcuts: readonly SummaryShortcut[];
}

/** Keyboard flying's own keys besides the keymap's (devices/keyboard.ts): the sticks. */
const STICK_KEYS: readonly { id: string; caps: string[]; aria: string }[] = [
    { id: 'throttle', caps: ['W', 'S'], aria: 'W S' },
    { id: 'yaw', caps: ['A', 'D'], aria: 'A D' },
    { id: 'sticks', caps: ['←', '↑', '→', '↓'], aria: 'ArrowLeft ArrowUp ArrowRight ArrowDown' }
];

const kbds = (caps: readonly string[]) => h('span', { class: 'kc-keys' }, ...caps.map((c) => h('kbd', {}, c)));

/** The text "Copy stats" puts on the clipboard. */
export function summaryText(d: SummaryData, date = new Date()): string {
    return statsText({
        title: t('stats.copyTitle', { drone: d.drone, date: date.toISOString().slice(0, 10) }),
        heads: [t('stats.life'), t('stats.session'), t('stats.lifetime')],
        label: (id) => t(`stats.${id}`),
        life: d.life, session: d.session, lifetime: d.lifetime, units: d.units, words: unitWords()
    });
}

/** The mode chip for the panel's title line. */
export function modeChip(mode: string | null): HTMLElement | null {
    if (!mode) return null;
    return h('span', { class: 'sum-mode', 'data-testid': 'summary-mode', 'data-mode': mode }, t('summary.mode', { mode: t(`summary.mode.${mode}`) }));
}

/** The left column: this flight, the session, the drone's lifetime; "Copy stats". */
export function statsColumn(d: SummaryData): HTMLElement {
    const w = unitWords();
    const head = h('tr', {}, h('td', {}), h('th', { scope: 'col' }, t('stats.life')), h('th', { scope: 'col' }, t('stats.session')), h('th', { scope: 'col' }, t('stats.lifetime')));
    const body = STAT_ROWS.map((r) => h('tr', { class: r.core ? 'core' : undefined, 'data-stat': r.id },
        h('th', { scope: 'row' }, t(`stats.${r.id}`)),
        h('td', { 'data-col': 'life' }, statText(r.id, d.life, null, d.units, w)),
        h('td', { 'data-col': 'session' }, statText(r.id, d.session, null, d.units, w)),
        h('td', { 'data-col': 'lifetime' }, r.lifetime ? statText(r.id, null, d.lifetime, d.units, w) : '—')));
    const table = h('table', { class: 'sum-table', 'data-testid': 'summary-stats' }, h('caption', { class: 'visually-hidden' }, t('stats.title')), h('thead', {}, head), h('tbody', {}, ...body));
    const status = h('span', { class: 'sum-copied', role: 'status', 'data-testid': 'stats-copied' });
    const copy = h('button', { type: 'button', class: 'btn', 'data-action': 'stats-copy', onclick: () => void copyText(summaryText(d), status) }, t('stats.copy'));
    return h('section', { class: 'sum-col sum-stats', 'aria-labelledby': 'sum-stats-h' },
        h('h3', { id: 'sum-stats-h' }, t('stats.title')),
        table,
        h('p', { class: 'sum-drone' }, t('stats.lifetimeOf', { drone: d.drone })),
        h('div', { class: 'sum-actions' }, copy, status));
}

/** Under the menu: every shipped key of the keymap with its name, then keyboard flying's keys. */
export function keysBlock(d: SummaryData): HTMLElement {
    const row = (s: SummaryShortcut) => h('li', { 'data-key-action': s.action, 'aria-keyshortcuts': s.keys.map((k) => k.aria).join(' ') }, kbds(s.keys.map((k) => k.cap)), h('span', {}, t(s.labelKey)));
    const routed = d.shortcuts.filter((s) => !s.flying);
    const flying = d.shortcuts.filter((s) => s.flying);
    return h('section', { class: 'sum-keys', 'aria-labelledby': 'sum-keys-h', 'data-testid': 'summary-keys' },
        h('h3', { id: 'sum-keys-h', class: 'sum-sub' }, t('summary.keys')),
        h('ul', {}, ...routed.map(row)),
        h('h3', { class: 'sum-sub', id: 'sum-kbd-h' }, t('summary.kbdFlying')),
        h('ul', { 'aria-labelledby': 'sum-kbd-h' }, ...flying.map(row), ...STICK_KEYS.map((k) => h('li', { 'data-key-flying': k.id }, kbds(k.caps), h('span', {}, t(`summary.kbd.${k.id}`))))));
}

/** The clipboard, or (blocked clipboard, an old browser) a selected text the pilot copies by hand. */
async function copyText(text: string, status: HTMLElement): Promise<void> {
    status.classList.remove('bad');
    try {
        await navigator.clipboard.writeText(text);
        status.textContent = t('stats.copied');
    } catch {
        const area = h('textarea', { class: 'sum-copy-text', readonly: true, rows: 6, 'aria-label': t('stats.copy') }, text) as HTMLTextAreaElement;
        status.parentElement?.after(area);
        area.select();
        let ok = false;
        try { ok = document.execCommand('copy'); } catch { ok = false; }
        status.textContent = ok ? t('stats.copied') : t('stats.copyFailed');
        status.classList.toggle('bad', !ok);
    }
}
