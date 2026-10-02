// The admin's Reports tab: pilots' bug reports and ideas as /api/report stored them, newest first.
// Read-only except the status (open/closed, kept by the server in report-status.json). A visitor's
// words are shown as text, never as markup; the technical details open as the stored JSON.
import { h, clear } from '../ui/dom';
import { t } from './i18n';
import type { AdminClient, ReportRow } from './api';

type Show = 'open' | 'closed' | 'all';

export class ReportsTab {
    readonly root: HTMLElement;
    private rows: ReportRow[] = [];
    private show: Show = 'open';
    private readonly list = h('div', { class: 'reports', 'data-testid': 'report-list' });
    private readonly filters = h('div', { class: 'bar', role: 'group' });

    constructor(private readonly api: AdminClient, private readonly say: (msg: string, bad?: boolean) => void) {
        this.root = h('div', { class: 'tab-body' }, h('section', { class: 'card' }, this.filters, this.list));
    }

    async load(): Promise<void> {
        this.rows = (await this.api.get<{ reports: ReportRow[] }>('reports')).reports;
        this.render();
    }

    /** Nothing waits to be saved here: a status change is sent at once. */
    async flush(): Promise<void> {}

    private render(): void {
        clear(this.filters);
        for (const k of ['open', 'closed', 'all'] as const) {
            const n = k === 'all' ? this.rows.length : this.rows.filter((r) => r.status === k).length;
            this.filters.append(h('button', { type: 'button', class: 'tab', 'data-show': k, 'aria-pressed': String(this.show === k), onclick: () => { this.show = k; this.render(); } },
                `${t(`admin.reports.${k}`)} (${n})`));
        }
        clear(this.list);
        const rows = this.rows.filter((r) => this.show === 'all' || r.status === this.show);
        if (!rows.length) this.list.append(h('p', { class: 'muted' }, t('admin.reports.empty')));
        for (const r of rows) this.list.append(this.card(r));
    }

    private card(r: ReportRow): HTMLElement {
        const toggle = h('button', { type: 'button', class: 'btn small', 'data-action': r.status === 'open' ? 'close' : 'reopen' },
            r.status === 'open' ? t('admin.reports.close') : t('admin.reports.reopen'));
        toggle.addEventListener('click', async () => {
            const status = r.status === 'open' ? 'closed' : 'open';
            toggle.disabled = true;
            try {
                await this.api.post('reports/status', { id: r.id, status });
                r.status = status;
                this.render();
            } catch (e) {
                toggle.disabled = false;
                this.say(e instanceof Error ? e.message : String(e), true);
            }
        });
        const id = encodeURIComponent(r.id);
        return h('article', { class: `report ${r.status}`, 'data-report': r.id },
            h('div', { class: 'report-head' },
                h('span', { class: `badge ${r.kind}` }, t(`admin.reports.${r.kind === 'bug' ? 'bug' : 'idea'}`)),
                h('code', {}, r.id),
                h('span', { class: 'muted' }, [new Date(r.ts).toLocaleString(), r.page, r.locale, r.release].filter(Boolean).join(' · ')),
                r.suspect ? h('span', { class: 'badge warn' }, t('admin.reports.suspect')) : null),
            h('p', { class: 'report-msg' }, r.message),
            h('div', { class: 'report-foot' },
                r.scene ? h('a', { href: `/en/fly/?scene=${encodeURIComponent(r.scene)}`, target: '_blank', rel: 'noopener' }, t('admin.reports.scene', { id: r.scene })) : null,
                r.contact ? h('span', {}, t('admin.reports.contact', { contact: r.contact })) : null,
                r.diagnostics === true ? h('a', { href: `/api/admin/reports/${id}/diagnostics`, target: '_blank', rel: 'noopener' }, t('admin.reports.diagnostics')) : null,
                h('span', { class: 'grow' }),
                toggle));
    }
}
