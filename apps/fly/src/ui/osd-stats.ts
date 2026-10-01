// The goggles-style stats card (docs/architecture-v03.md D.2, item 7): after a disarm with the
// switch it lists the flight like Betaflight's "--- STATS ---" screen, 8-10 monospace lines over
// the view. It takes no focus and blocks nothing (the pilot can arm at once); app/builtin/summary.ts
// decides when it comes and goes. "All stats" (and Enter or Esc) opens the summary panel.
import type { StatsBlock } from '@gsfpv/sim-core';
import { STAT_ROWS, statText } from '../app/builtin/summary-stats';
import type { Units, UnitWords } from '../app/builtin/summary-stats';
import { h } from './dom';
import { t } from '../i18n';
import './summary.css';

/** The unit words of the current language (stats.u.*). */
export function unitWords(): UnitWords {
    return { kmh: t('stats.u.kmh'), mph: t('stats.u.mph'), m: t('stats.u.m'), ft: t('stats.u.ft'), km: t('stats.u.km'), mi: t('stats.u.mi') };
}

export class StatsCard {
    readonly el: HTMLDivElement;
    private said: HTMLSpanElement;

    /** Put the card for `life` on `parent`; `onMore` opens the full panel. */
    constructor(parent: HTMLElement, life: StatsBlock, units: Units, onMore: () => void) {
        const w = unitWords();
        const rows = STAT_ROWS.filter((r) => r.card).map((r) =>
            h('div', { class: 'os-row', 'data-stat': r.id }, h('dt', {}, t(`stats.${r.id}`)), h('dd', {}, statText(r.id, life, null, units, w))));
        const more = h('button', { type: 'button', class: 'btn os-more', 'data-action': 'stats-more', 'aria-keyshortcuts': 'Enter Escape', onclick: () => onMore() }, t('stats.card.more'));
        // a region, not a live one: ten lines read out at every disarm would be noise; one short
        // sentence goes to the status line below instead
        this.el = h('div', { class: 'osd-stats interactive', role: 'region', 'aria-label': t('stats.title'), 'data-testid': 'osd-stats' },
            h('p', { class: 'os-title', 'aria-hidden': 'true' }, t('stats.card.title')),
            h('dl', {}, ...rows),
            h('div', { class: 'os-foot' }, h('span', {}, t('stats.card.hint')), more));
        this.said = h('span', { class: 'visually-hidden', role: 'status', 'data-testid': 'osd-stats-said' });
        parent.append(this.el, this.said);
        // a live region speaks when its text changes, not when it arrives with the text
        const text = t('stats.card.said', { t: statText('airtime', life, null, units, w), v: statText('maxSpeed', life, null, units, w) });
        setTimeout(() => { this.said.textContent = text; }, 100);
    }

    remove(): void {
        this.el.remove();
        this.said.remove();
    }
}
