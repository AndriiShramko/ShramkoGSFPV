// The Outreach tab's smaller blocks: the summary cards, the funnel, what to do next, the "worth more work"
// ranking, the medians per format / language / topic, the arrivals from Facebook and the empty state. Each is
// drawn from the server's view (apps/api/outreach.py build_view); nothing here works a number out or writes.
import { h, clear } from '../../ui/dom';
import { t } from '../i18n';
import { age, checkpoint, int, num, percent, word } from './fmt';
import { SLICE_DIMS, funnelBars, scoreBand, sliceName, visitRows } from './model';
import { SLICE_MODES } from './api';
import type { OutreachView, SliceMode } from './api';

const MORE_AFTER = 8;

/** A bar whose fill width goes through CSSOM (the admin's CSP has no inline style attributes). */
function meter(pct: number, band: string): HTMLElement {
    const fill = h('i', { class: 'fill' });
    fill.style.setProperty('--w', `${Math.max(0, Math.min(100, pct))}%`);
    return h('span', { class: `meter band-${band}`, 'aria-hidden': 'true' }, fill);
}

export function summaryCards(v: OutreachView): HTMLElement {
    const x = v.totals;
    const stat = (key: string, n: number, sub: string): HTMLElement =>
        h('div', { class: 'stat', 'data-stat': key }, h('span', { class: 'stat-n' }, int(n)), h('span', { class: 'stat-l' }, t(`admin.outreach.stat.${key}`)), h('span', { class: 'stat-s muted' }, sub));
    return h('section', { class: 'stats', 'data-testid': 'o-stats', 'aria-label': t('admin.outreach.stats.label') },
        stat('groups', x.groups, t('admin.outreach.sub.groups', { n: int(x.groups_known) })),
        stat('posted', x.posted, t('admin.outreach.sub.posted', { n: int(x.posts) })),
        stat('published', x.published, t('admin.outreach.sub.published', { n: int(x.posts_published) })),
        stat('removed', x.removed, t('admin.outreach.sub.removed', { banned: int(x.banned), posts: int(x.posts_removed) })),
        stat('reactions', x.reactions, t('admin.outreach.sub.reactions', { comments: int(x.comments), shares: int(x.shares), views: int(x.views) })));
}

export function funnelCard(v: OutreachView): HTMLElement {
    const rows = funnelBars(v.funnel).map((b) => h('li', { class: 'funnel-row', 'data-stage': b.stage },
        h('span', { class: 'funnel-label' }, t(`admin.outreach.funnel.${b.stage}`)),
        meter(b.width, b.stage === 'removed' ? 'low' : 'worth'),
        h('span', { class: 'funnel-n' }, int(b.n), b.ofPrev === null ? null : h('small', { class: 'muted' }, ` ${t('admin.outreach.funnel.ofprev', { pct: b.ofPrev })}`))));
    return h('section', { class: 'card', 'data-testid': 'o-funnel' }, h('h2', {}, t('admin.outreach.funnel.title')), h('ol', { class: 'funnel' }, ...rows));
}

function more(list: HTMLElement, items: Node[]): void {
    const hidden = items.length - MORE_AFTER;
    list.append(...items.slice(0, MORE_AFTER));
    if (hidden > 0) list.append(h('li', { class: 'muted' }, t('admin.outreach.next.more', { n: hidden })));
}

export function nextCard(v: OutreachView): HTMLElement {
    const d = v.due;
    const block = (key: string, items: Node[], hint?: string): HTMLElement => {
        const ul = h('ul', { class: 'plain', 'data-list': key });
        if (items.length) more(ul, items); else ul.append(h('li', { class: 'muted' }, t('admin.outreach.next.nothing')));
        return h('div', { class: 'next-block' }, h('h3', {}, t(`admin.outreach.next.${key}`), h('span', { class: 'badge' }, String(items.length))), hint ? h('p', { class: 'muted small' }, hint) : null, ul);
    };
    const checks = d.checks.map((c) => h('li', { 'data-post': c.post }, h('strong', {}, c.name), ' ', h('span', { class: 'badge st-warn' }, t('admin.outreach.next.due', { cp: checkpoint(c.due_cp_h) })),
        h('small', { class: 'muted' }, ` ${c.post} · ${t('admin.outreach.next.age', { age: age(c.age_h) })}`)));
    const unresolved = d.unresolved.map((u) => h('li', { 'data-post': u.post }, h('strong', {}, u.name), ' ', h('span', { class: 'badge st-warn' }, word('s', u.state)),
        h('small', { class: 'muted' }, ` ${u.post} · ${t('admin.outreach.next.age', { age: age(u.age_h) })}`)));
    const ready = d.ready.map((g) => h('li', { 'data-group': g.id }, h('strong', {}, g.name), ' ', h('span', { class: 'badge' }, word('v', g.verdict)),
        h('small', { class: 'muted' }, ` ${t('admin.outreach.next.fit', { fit: g.fit ?? '—' })} · ${int(g.members)} · ${g.lang ?? '—'}`)));
    return h('section', { class: 'card', 'data-testid': 'o-next' }, h('h2', {}, t('admin.outreach.next.title')),
        h('div', { class: 'next-grid' }, block('checks', checks), block('unresolved', unresolved, t('admin.outreach.next.unresolved.hint')), block('ready', ready, t('admin.outreach.next.ready.hint'))));
}

export function rankingCard(v: OutreachView): HTMLElement {
    const rows = v.ranking.map((r, i) => h('li', { class: r.worth ? 'is-worth' : '', 'data-group': r.id },
        h('span', { class: 'rank-n' }, String(i + 1)), h('strong', { class: 'rank-name' }, r.name),
        h('span', { class: 'rank-score' }, num(r.score), meter(r.score, scoreBand(r.score, v.worth_min))),
        r.worth ? h('span', { class: 'badge st-ok' }, t('admin.outreach.rank.badge')) : null,
        h('small', { class: 'muted rank-why' }, t('admin.outreach.rank.row', { pub: percent(r.pub_rate), eng: num(r.eng), rem: percent(r.removed_rate) }))));
    return h('section', { class: 'card', 'data-testid': 'o-rank' }, h('h2', {}, t('admin.outreach.rank.title')),
        h('p', { class: 'muted small' }, t('admin.outreach.rank.help', { min: num(v.worth_min) })),
        rows.length ? h('ol', { class: 'rank' }, ...rows) : h('p', { class: 'muted' }, t('admin.outreach.rank.none')));
}

/** Medians per format, language, topic, kind, or all three at once; the picker is a row of toggle buttons. */
export class SlicesCard {
    readonly root: HTMLElement;
    private view: OutreachView | null = null;
    private mode: SliceMode = 'format';
    private readonly picker = h('div', { class: 'bar', role: 'group', 'aria-label': t('admin.outreach.slices.by') });
    private readonly wrap = h('div', { class: 'table-wrap short', tabindex: 0, role: 'region', 'aria-label': t('admin.outreach.slices.title') });

    constructor() {
        for (const m of SLICE_MODES) {
            this.picker.append(h('button', { type: 'button', class: 'tab', 'data-slice': m, 'aria-pressed': String(m === this.mode), onclick: () => { this.mode = m; this.draw(); } }, t(`admin.outreach.slices.mode.${m}`)));
        }
        this.root = h('section', { class: 'card', 'data-testid': 'o-slices' }, h('h2', {}, t('admin.outreach.slices.title')),
            h('p', { class: 'muted small' }, t('admin.outreach.slices.help')), this.picker, this.wrap);
    }

    update(v: OutreachView): void {
        this.view = v;
        this.draw();
    }

    private draw(): void {
        if (!this.view) return;
        for (const b of this.picker.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.getAttribute('data-slice') === this.mode));
        clear(this.wrap);
        const rows = this.view.slices[this.mode] ?? [];
        if (!rows.length) { this.wrap.append(h('p', { class: 'muted pad' }, t('admin.outreach.slices.none'))); return; }
        const dims = SLICE_DIMS[this.mode];
        const head = h('tr', {}, ...dims.map((d) => h('th', { scope: 'col', class: 'first' }, h('span', { class: 'th-text' }, t(`admin.outreach.col.${d}`)))),
            ...['n', 'measured', 'published', 'removed', 'reactions', 'comments', 'eng'].map((k) => h('th', { scope: 'col', class: 'n' }, h('span', { class: 'th-text' }, t(`admin.outreach.slices.col.${k}`)))));
        const body = rows.map((r) => h('tr', { 'data-slice-row': sliceName(r, this.mode).join('|') },
            ...sliceName(r, this.mode).map((s, i) => h('td', { class: i === 0 ? 'first' : '' }, dims[i] === 'kind' ? word('k', s) : s)),
            h('td', { class: 'n' }, int(r.n)), h('td', { class: 'n' }, int(r.measured)), h('td', { class: 'n' }, int(r.published)), h('td', { class: 'n' }, int(r.removed)),
            h('td', { class: 'n' }, num(r.median_reactions)), h('td', { class: 'n' }, num(r.median_comments)), h('td', { class: 'n strong' }, num(r.median_eng))));
        this.wrap.append(h('table', { class: 'data', 'data-testid': 'o-slice-table' }, h('thead', {}, head), h('tbody', {}, ...body)));
    }
}

export function visitsCard(v: OutreachView): HTMLElement {
    const vis = v.visits;
    if (!vis) return h('section', { class: 'card', 'data-testid': 'o-visits' }, h('h2', {}, t('admin.outreach.visits.title')), h('p', { class: 'muted' }, t('admin.outreach.visits.off')));
    const rows = visitRows(vis, v.groups).map((r) => h('li', { 'data-key': r.key }, h('strong', {}, r.name ?? r.key), r.name ? h('small', { class: 'muted' }, ` ${r.key}`) : null, h('span', { class: 'badge' }, int(r.count))));
    return h('section', { class: 'card', 'data-testid': 'o-visits' }, h('h2', {}, t('admin.outreach.visits.title')),
        h('p', {}, t('admin.outreach.visits.sub', { total: int(vis.total), days: vis.days })), vis.note ? h('p', { class: 'muted small' }, vis.note) : null,
        rows.length ? h('ul', { class: 'plain' }, ...rows) : h('p', { class: 'muted' }, t('admin.outreach.visits.zero')));
}

/** Nothing stored yet, or the stored file cannot be read; either way the vault has the records and a push restores the tab. */
export function emptyCard(unreadable: boolean): HTMLElement {
    return h('section', { class: 'card', 'data-testid': 'o-empty', role: unreadable ? 'alert' : 'status' },
        h('h2', {}, t(unreadable ? 'admin.outreach.unreadable.title' : 'admin.outreach.empty.title')),
        h('p', {}, t(unreadable ? 'admin.outreach.unreadable.text' : 'admin.outreach.empty.text')),
        h('p', {}, h('code', {}, 'python .claude/skills/fb-groups/scripts/fbgroups.py push')));
}
