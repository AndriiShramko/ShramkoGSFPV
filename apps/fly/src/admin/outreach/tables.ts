// The two tables of the Outreach tab: the groups (with sort by any column, filters, search and the "worth more
// work" highlight) and the posts (with their measurements over time). Both are drawn into a scroll box of their
// own (the sticky header and first column stay in view), so a long table never runs the page thousands of pixels
// long, on a phone too. Filters keep their place while the snapshot is refreshed. No write goes anywhere.
import { h, clear } from '../../ui/dom';
import { t } from '../i18n';
import { age, checkpoint, date, dateTime, int, num, word } from './fmt';
import {
    ALL_GROUPS, ALL_POSTS, ANY, NONE, checkpointStrip, facet, groupMatches, nextSort, postMatches, safeUrl, scoreBand, sortGroups, sortPosts
} from './model';
import type { GroupFilter, PostFilter, Sort } from './model';
import type { GroupRow, OutreachView, PostRow } from './api';

export interface Col<R> { key: string; label: string; sortable: boolean; cls?: string; cell: (r: R) => Node | string }

/** A table in its scroll box: headers that sort (aria-sort), one row per item. */
export class DataTable<R> {
    readonly wrap = h('div', { class: 'table-wrap', tabindex: 0, role: 'region' });
    private readonly head = h('tr');
    private readonly body = h('tbody');

    constructor(private readonly cols: Col<R>[], private readonly rowOf: (r: R) => { id: string; cls?: string }, onSort: (key: string) => void, testid: string, label: string) {
        this.wrap.setAttribute('aria-label', label);
        for (const c of cols) {
            const inner = c.sortable
                ? h('button', { type: 'button', class: 'sort', 'data-sort': c.key, onclick: () => onSort(c.key) }, c.label, h('span', { class: 'arrow', 'aria-hidden': 'true' }))
                : h('span', { class: 'th-text' }, c.label);
            this.head.append(h('th', { scope: 'col', class: c.cls ?? '', 'data-col': c.key, 'aria-sort': c.sortable ? 'none' : undefined }, inner));
        }
        this.wrap.append(h('table', { class: 'data', 'data-testid': testid }, h('thead', {}, this.head), this.body));
    }

    draw(rows: R[], sort: Sort): void {
        for (const th of this.head.querySelectorAll('th[aria-sort]')) {
            const on = th.getAttribute('data-col') === sort.key;
            th.setAttribute('aria-sort', on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none');
            const arrow = th.querySelector('.arrow');
            if (arrow) arrow.textContent = on ? (sort.dir === 'asc' ? '▲' : '▼') : '';
        }
        clear(this.body);
        for (const r of rows) {
            const { id, cls } = this.rowOf(r);
            const tr = h('tr', { 'data-row': id, class: cls ?? '' });
            for (const c of this.cols) tr.append(h('td', { class: c.cls ?? '', 'data-col': c.key }, c.cell(r)));
            this.body.append(tr);
        }
    }
}

const badge = (kind: string, text: string): HTMLElement => h('span', { class: `badge st-${kind}` }, text);
const link = (url: string | null, text: string): Node | string => {
    const u = safeUrl(url);
    return u ? h('a', { href: u, target: '_blank', rel: 'noopener noreferrer' }, text) : text;
};
/** A stored state as a coloured badge: up is good, removed and banned bad, waiting is a warning. */
const stateBadge = (s: string): HTMLElement => badge(['published'].includes(s) ? 'ok' : ['removed', 'banned', 'declined'].includes(s) ? 'bad' : ['sent', 'pending'].includes(s) ? 'warn' : 'plain', word('s', s));
const clipped = (text: string | null, title = text): HTMLElement => h('span', { class: 'clip', title: title ?? '' }, text ?? '—');

/** One filter select: Any, the values found in the rows, and "not set" when some row has none. */
function filterSelect(label: string, name: string, onChange: (v: string) => void): HTMLSelectElement {
    const s = h('select', { 'data-filter': name, 'aria-label': label, title: label }) as HTMLSelectElement;
    s.addEventListener('change', () => onChange(s.value));
    return s;
}

function fillSelect(s: HTMLSelectElement, values: string[], text: (v: string) => string): string {
    const keep = s.value || ANY;
    clear(s);
    s.append(h('option', { value: ANY }, `${s.getAttribute('aria-label')}: ${t('admin.outreach.filter.any')}`));
    for (const v of values) s.append(h('option', { value: v }, text(v)));
    s.value = values.includes(keep) ? keep : ANY;
    return s.value;
}

const faceted = (v: string, group?: string): string => (v === NONE ? t('admin.outreach.filter.none') : group ? word(group, v) : v);

export class GroupsSection {
    readonly root: HTMLElement;
    private view: OutreachView | null = null;
    private filter: GroupFilter = { ...ALL_GROUPS };
    private sort: Sort = { key: 'score', dir: 'desc' };
    private readonly table: DataTable<GroupRow>;
    private readonly search = h('input', { type: 'search', class: 'grow', 'data-testid': 'og-search', 'aria-label': t('admin.outreach.filter.search'), placeholder: t('admin.outreach.filter.search') }) as HTMLInputElement;
    private readonly selects: Record<'verdict' | 'state' | 'lang' | 'topic' | 'wave', HTMLSelectElement>;
    private readonly worth = h('input', { type: 'checkbox', 'data-filter': 'worth' }) as HTMLInputElement;
    private readonly count = h('p', { class: 'muted shown', 'data-testid': 'og-shown', 'aria-live': 'polite' });

    constructor() {
        const sel = (name: 'verdict' | 'state' | 'lang' | 'topic' | 'wave') =>
            filterSelect(t(`admin.outreach.filter.${name}`), name, (v) => { this.filter = { ...this.filter, [name]: v }; this.draw(); });
        this.selects = { verdict: sel('verdict'), state: sel('state'), lang: sel('lang'), topic: sel('topic'), wave: sel('wave') };
        this.search.addEventListener('input', () => { this.filter = { ...this.filter, search: this.search.value }; this.draw(); });
        this.worth.addEventListener('change', () => { this.filter = { ...this.filter, worthOnly: this.worth.checked }; this.draw(); });
        const rules = (g: GroupRow): string => Object.entries(g.policy).filter(([, v]) => v).map(([k, v]) => `${t(`admin.outreach.rule.${k}`)}: ${word('rv', v)}`).join(' · ');
        const cols: Col<GroupRow>[] = [
            { key: 'name', label: t('admin.outreach.col.name'), sortable: true, cls: 'first', cell: (g) => h('span', { class: 'gname', title: g.id }, link(g.url, g.name)) },
            { key: 'score', label: t('admin.outreach.col.score'), sortable: true, cls: 'n', cell: (g) => this.scoreCell(g) },
            { key: 'state', label: t('admin.outreach.col.state'), sortable: true, cell: (g) => stateBadge(g.state) },
            { key: 'posts', label: t('admin.outreach.col.posts'), sortable: true, cls: 'n', cell: (g) => h('span', { title: t('admin.outreach.posts.tip', { posts: g.posts, published: g.published, removed: g.removed }) }, String(g.posts), g.posts ? h('span', { class: 'muted' }, ` ${g.published}↑ ${g.removed}✕`) : null) },
            { key: 'verdict', label: t('admin.outreach.col.verdict'), sortable: true, cell: (g) => word('v', g.verdict) },
            { key: 'wave', label: t('admin.outreach.col.wave'), sortable: true, cls: 'n', cell: (g) => (g.wave === null ? '—' : String(g.wave)) },
            { key: 'lang', label: t('admin.outreach.col.lang'), sortable: true, cell: (g) => g.lang ?? '—' },
            { key: 'topic', label: t('admin.outreach.col.topic'), sortable: true, cell: (g) => g.topic ?? '—' },
            { key: 'members', label: t('admin.outreach.col.members'), sortable: true, cls: 'n', cell: (g) => int(g.members) },
            { key: 'fit', label: t('admin.outreach.col.fit'), sortable: true, cls: 'n', cell: (g) => (g.fit === null ? '—' : String(g.fit)) },
            { key: 'best_reactions', label: t('admin.outreach.col.best_reactions'), sortable: true, cls: 'n', cell: (g) => int(g.best_reactions) },
            { key: 'best_comments', label: t('admin.outreach.col.best_comments'), sortable: true, cls: 'n', cell: (g) => int(g.best_comments) },
            { key: 'last_post_at', label: t('admin.outreach.col.last_post_at'), sortable: true, cell: (g) => date(g.last_post_at) },
            { key: 'rules', label: t('admin.outreach.col.rules'), sortable: false, cell: (g) => clipped(rules(g)) },
            { key: 'note', label: t('admin.outreach.col.note'), sortable: false, cell: (g) => clipped(g.note) }
        ];
        this.table = new DataTable(cols, (g) => ({ id: g.id, cls: `${g.worth ? 'is-worth ' : ''}${g.state === 'banned' || g.removed > 0 ? 'is-bad' : ''}` }),
            (key) => { this.sort = nextSort(this.sort, key); this.draw(); }, 'og-table', t('admin.outreach.groups.title'));
        const bar = h('div', { class: 'bar filters', role: 'search' }, this.search, ...Object.values(this.selects),
            h('label', { class: 'check' }, this.worth, t('admin.outreach.filter.worth')));
        this.root = h('section', { class: 'card', 'data-testid': 'og-section' }, h('h2', {}, t('admin.outreach.groups.title')), bar, this.count, this.table.wrap);
    }

    private scoreCell(g: GroupRow): Node | string {
        if (!this.view) return '';
        const band = scoreBand(g.score, this.view.worth_min);
        const fill = h('i', { class: 'fill' });
        fill.style.setProperty('--w', `${Math.max(0, Math.min(100, g.score ?? 0))}%`); // CSSOM: the admin's CSP forbids style attributes
        const meter = h('span', { class: `meter band-${band}`, 'aria-hidden': 'true' }, fill);
        return h('span', { class: `score band-${band}`, title: t(g.worth ? 'admin.outreach.score.worth' : 'admin.outreach.score.tip', { eng: num(g.eng), min: this.view.worth_min }) },
            g.score === null ? '—' : num(g.score), g.score === null ? null : meter);
    }

    update(view: OutreachView): void {
        this.view = view;
        const rows = view.groups;
        const keep = this.filter;
        this.filter = {
            ...keep,
            verdict: fillSelect(this.selects.verdict, facet(rows, (g) => g.verdict), (v) => faceted(v, 'v')),
            state: fillSelect(this.selects.state, facet(rows, (g) => g.state), (v) => faceted(v, 's')),
            lang: fillSelect(this.selects.lang, facet(rows, (g) => g.lang), (v) => faceted(v)),
            topic: fillSelect(this.selects.topic, facet(rows, (g) => g.topic), (v) => faceted(v)),
            wave: fillSelect(this.selects.wave, facet(rows, (g) => g.wave), (v) => (v === NONE ? faceted(v) : t('admin.outreach.wave', { n: v })))
        };
        this.draw();
    }

    private draw(): void {
        if (!this.view) return;
        const all = this.view.groups;
        const rows = sortGroups(all.filter((g) => groupMatches(g, this.filter)), this.sort);
        this.count.textContent = all.length ? t('admin.outreach.shown', { n: rows.length, total: all.length }) : t('admin.outreach.groups.none');
        this.table.draw(rows, this.sort);
    }
}

export class PostsSection {
    readonly root: HTMLElement;
    private view: OutreachView | null = null;
    private filter: PostFilter = { ...ALL_POSTS };
    private sort: Sort = { key: 'sent_at', dir: 'desc' };
    private readonly table: DataTable<PostRow>;
    private dueCp = new Map<string, number>();
    private readonly search = h('input', { type: 'search', class: 'grow', 'data-testid': 'op-search', 'aria-label': t('admin.outreach.filter.search'), placeholder: t('admin.outreach.filter.search') }) as HTMLInputElement;
    private readonly selects: Record<'state' | 'format' | 'lang' | 'kind', HTMLSelectElement>;
    private readonly count = h('p', { class: 'muted shown', 'data-testid': 'op-shown', 'aria-live': 'polite' });

    constructor() {
        const sel = (name: 'state' | 'format' | 'lang' | 'kind') =>
            filterSelect(t(`admin.outreach.filter.${name}`), name, (v) => { this.filter = { ...this.filter, [name]: v }; this.draw(); });
        this.selects = { state: sel('state'), format: sel('format'), lang: sel('lang'), kind: sel('kind') };
        this.search.addEventListener('input', () => { this.filter = { ...this.filter, search: this.search.value }; this.draw(); });
        const cols: Col<PostRow>[] = [
            { key: 'group_name', label: t('admin.outreach.col.group_name'), sortable: true, cls: 'first', cell: (p) => h('span', { class: 'gname', title: p.id }, link(p.url, p.group_name), h('small', { class: 'muted' }, p.id)) },
            { key: 'kind', label: t('admin.outreach.col.kind'), sortable: true, cell: (p) => word('k', p.kind) },
            { key: 'format', label: t('admin.outreach.col.format'), sortable: true, cell: (p) => p.format },
            { key: 'lang', label: t('admin.outreach.col.lang'), sortable: true, cell: (p) => p.lang ?? '—' },
            { key: 'topic', label: t('admin.outreach.col.topic'), sortable: true, cell: (p) => p.topic ?? '—' },
            { key: 'sent_at', label: t('admin.outreach.col.sent_at'), sortable: true, cell: (p) => dateTime(p.sent_at) },
            { key: 'state', label: t('admin.outreach.col.state'), sortable: true, cell: (p) => stateBadge(p.state) },
            { key: 'checks', label: t('admin.outreach.col.checks'), sortable: false, cls: 'strip', cell: (p) => this.strip(p) },
            { key: 'eng', label: t('admin.outreach.col.eng'), sortable: true, cls: 'n', cell: (p) => (p.eng === null ? '—' : num(p.eng)) },
            { key: 'link', label: t('admin.outreach.col.link'), sortable: false, cell: (p) => clipped(`${word('lp', p.link_placement)}${p.first_comment !== 'none' ? ` · ${word('fc', p.first_comment)}` : ''}`) },
            { key: 'angle', label: t('admin.outreach.col.angle'), sortable: false, cell: (p) => clipped(p.angle) }
        ];
        this.table = new DataTable(cols, (p) => ({ id: p.id, cls: p.state === 'removed' ? 'is-bad' : '' }),
            (key) => { this.sort = nextSort(this.sort, key); this.draw(); }, 'op-table', t('admin.outreach.posts.title'));
        this.root = h('section', { class: 'card', 'data-testid': 'op-section' }, h('h2', {}, t('admin.outreach.posts.title')),
            h('p', { class: 'muted' }, t('admin.outreach.posts.legend')),
            h('div', { class: 'bar filters', role: 'search' }, this.search, ...Object.values(this.selects)), this.count, this.table.wrap);
    }

    /** The five checkpoints of a post, side by side: what was measured, or why not (due now, missed, still to come). */
    private strip(p: PostRow): Node {
        const cells = checkpointStrip(p, this.dueCp.get(p.id)).map(({ cp, state, check }) => {
            const body = state === 'taken' && check
                ? [`${check.reactions}/${check.comments}/${check.shares}`, check.admin_action !== 'none' ? h('b', { class: 'st-bad', title: word('act', check.admin_action) }, '!') : null]
                : [state === 'due' ? t('admin.outreach.cp.due') : state === 'missed' ? '–' : '·'];
            const tip = state === 'taken' && check
                ? t('admin.outreach.check.tip', { cp: checkpoint(cp), age: age(check.age_h), reactions: check.reactions, comments: check.comments, shares: check.shares, views: check.views === null ? '—' : int(check.views), action: word('act', check.admin_action) })
                : `${checkpoint(cp)}: ${t(`admin.outreach.cp.${state}`)}`;
            return h('span', { class: `cp cp-${state}`, 'data-cp': String(cp), title: tip }, h('small', {}, checkpoint(cp)), h('span', {}, ...body));
        });
        return h('span', { class: 'cps' }, ...cells);
    }

    update(view: OutreachView): void {
        this.view = view;
        this.dueCp = new Map(view.due.checks.map((d) => [d.post, d.due_cp_h]));
        const rows = view.posts;
        this.filter = {
            ...this.filter,
            state: fillSelect(this.selects.state, facet(rows, (p) => p.state), (v) => faceted(v, 's')),
            format: fillSelect(this.selects.format, facet(rows, (p) => p.format), (v) => faceted(v)),
            lang: fillSelect(this.selects.lang, facet(rows, (p) => p.lang), (v) => faceted(v)),
            kind: fillSelect(this.selects.kind, facet(rows, (p) => p.kind), (v) => faceted(v, 'k'))
        };
        this.draw();
    }

    private draw(): void {
        if (!this.view) return;
        const all = this.view.posts;
        const rows = sortPosts(all.filter((p) => postMatches(p, this.filter)), this.sort);
        this.count.textContent = all.length ? t('admin.outreach.shown', { n: rows.length, total: all.length }) : t('admin.outreach.posts.none');
        this.table.draw(rows, this.sort);
    }
}
