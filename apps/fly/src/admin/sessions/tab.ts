// The admin's Sessions tab (v0.12, Fly by Sound): the recordings pilots chose to send. Each is stored on the server first and then sent to the
// owner by Telegram and by e-mail from a persistent queue with retries; this tab shows what became of each channel, downloads the package (a
// plain link: the browser saves the stream, nothing passes through a script), sends one channel again, and deletes a recording on request
// (a pilot's or a parent's: the privacy page promises it). Nothing here edits a recording; Refresh reads again. Empty until the first one arrives.
import { h, clear } from '../../ui/dom';
import { locale, t } from '../i18n';
import type { AdminClient } from '../api';
import { ApiError } from '../api';
import { SessionsClient, packagePath } from './api';
import { CHANNELS, confirmed, formatBytes, formatLength, formatMiB, matches, rowState } from './model';
import type { ChannelName, ChannelView, SessionRow, SessionsAnswer, StateFilter } from './model';

const CONFIRM_MS = 6000;

function dateTime(iso: string | null | undefined): string {
    const d = iso ? new Date(iso) : null;
    return d !== null && !Number.isNaN(d.getTime()) ? d.toLocaleString(locale, { year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
}

/** The words of a stored value from the dictionary, else the value itself (a status a later server adds is readable at once, only not translated). */
function word(prefix: string, value: string): string {
    const key = `${prefix}.${value}`;
    const w = t(key);
    return w === key ? value.replace(/[_-]/g, ' ') : w;
}

export class SessionsTab {
    readonly root: HTMLElement;
    private readonly client: SessionsClient;
    private readonly head = h('section', { class: 'card s-head', 'data-testid': 's-head' });
    private readonly content = h('div', { class: 's-content' });
    /** the count and the table: redrawn on their own when the filter, the search or a "sure?" changes, so the search box keeps its focus and caret */
    private listBox: HTMLElement = h('div', { class: 's-list' });
    private answer: SessionsAnswer | null = null;
    private filter: StateFilter = 'all';
    private query = '';
    /** the action that asked "sure?" and waits for a second click: `delete:<id>` or `resend:<id>:<channel>` */
    private confirming: string | null = null;
    private confirmTimer: ReturnType<typeof setTimeout> | null = null;
    private busy = false;

    constructor(api: AdminClient, private readonly say: (msg: string, bad?: boolean) => void) {
        this.client = new SessionsClient(api);
        this.root = h('div', { class: 'tab-body sessions', 'data-testid': 'sessions' }, this.head, this.content);
    }

    /** Nothing waits to be saved here: the tab never writes without a click. */
    async flush(): Promise<void> {
        if (this.confirmTimer !== null) clearTimeout(this.confirmTimer);
    }

    async load(): Promise<void> {
        this.answer = await this.client.list();
        this.render();
    }

    private fail(e: unknown): void {
        this.say(t('admin.sessions.error', { why: e instanceof ApiError ? word('admin.sessions.reason', e.reason || `http-${e.status}`) : e instanceof Error ? e.message : String(e) }), true);
    }

    private async reload(button?: HTMLButtonElement): Promise<void> {
        if (this.busy) return;
        this.busy = true;
        if (button) button.disabled = true;
        try {
            await this.load();
            this.say('');
        } catch (e) {
            this.fail(e);
        } finally {
            this.busy = false;
            if (button) button.disabled = false;
        }
    }

    /** A click that must be confirmed by a second one within a few seconds (the button says so meanwhile). */
    private ask(key: string): boolean {
        if (this.confirming === key) {
            this.confirming = null;
            if (this.confirmTimer !== null) clearTimeout(this.confirmTimer);
            return true;
        }
        this.confirming = key;
        if (this.confirmTimer !== null) clearTimeout(this.confirmTimer);
        this.confirmTimer = setTimeout(() => {
            this.confirming = null;
            this.renderList();
        }, CONFIRM_MS);
        this.renderList();
        return false;
    }

    private async resend(r: SessionRow, channel: ChannelName): Promise<void> {
        if (confirmed(r.channels[channel]?.status) && !this.ask(`resend:${r.id}:${channel}`)) return;
        if (this.busy) return;
        this.busy = true;
        try {
            await this.client.resend(r.id, channel);
            await this.load();
            this.say(t('admin.sessions.resent', { channel: t(`admin.sessions.channel.${channel}`) }));
        } catch (e) {
            this.fail(e);
        } finally {
            this.busy = false;
        }
    }

    private async remove(r: SessionRow): Promise<void> {
        if (!this.ask(`delete:${r.id}`)) return;
        if (this.busy) return;
        this.busy = true;
        try {
            await this.client.remove(r.id);
            await this.load();
            this.say(t('admin.sessions.deleted'));
        } catch (e) {
            this.fail(e);
        } finally {
            this.busy = false;
        }
    }

    private channelCell(r: SessionRow, name: ChannelName): HTMLElement {
        const c: ChannelView | undefined = r.channels[name];
        const status = c?.status ?? 'queued';
        const bad = status === 'failed';
        const badge = h('span', { class: `badge ${confirmed(status) ? 'st-ok' : bad ? 'st-bad' : ''}`.trim(), 'data-status': status }, word('admin.sessions.channel.status', status));
        const detail = [c !== undefined && c.attempts > 1 ? t('admin.sessions.tries', { n: c.attempts }) : '', c?.error ? `(${c.error})` : ''].filter((x) => x !== '').join(' ');
        return h('td', { 'data-channel': name }, badge, detail === '' ? null : h('span', { class: 'muted' }, ` ${detail}`));
    }

    private row(r: SessionRow): HTMLElement {
        const s = r.summary;
        const state = rowState(r);
        const lesson = [s.lesson === '' ? '—' : s.lesson, s.path, s.locale].filter((x) => x !== '').join(' · ');
        const pilot = [s.minor ? (s.guardianConfirmed ? t('admin.sessions.minor.confirmed') : t('admin.sessions.minor.unconfirmed')) : t('admin.sessions.adult'), s.voice ? t('admin.sessions.voice') : t('admin.sessions.novoice')].join(', ');
        const actions = h('div', { class: 'bar' },
            h('a', { class: 'btn small', href: packagePath(r.id), download: `fly-by-sound-${r.id}.zip`, 'data-action': 'download' }, t('admin.sessions.download')),
            ...CHANNELS.map((c) => {
                const sure = this.confirming === `resend:${r.id}:${c}`;
                // the visible words are short (the column is narrow); the whole sentence is the button's accessible name
                return h('button', { type: 'button', class: 'btn small', 'data-action': `resend-${c}`, 'aria-label': sure ? t('admin.sessions.resend.sure.full') : t(`admin.sessions.resend.${c}.full`), onclick: () => void this.resend(r, c) }, sure ? t('admin.sessions.resend.sure') : t(`admin.sessions.resend.${c}`));
            }),
            h('button', { type: 'button', class: 'btn small', 'data-action': 'delete', ...(this.confirming === `delete:${r.id}` ? { 'aria-label': t('admin.sessions.delete.sure.full') } : {}), onclick: () => void this.remove(r) }, this.confirming === `delete:${r.id}` ? t('admin.sessions.delete.sure') : t('admin.sessions.delete')));
        return h('tr', { 'data-id': r.id, 'data-state': state },
            h('td', {}, dateTime(r.storedAt), h('br'), h('span', { class: `badge ${state === 'delivered' ? 'st-ok' : state === 'failed' ? 'st-bad' : ''}`.trim(), 'data-testid': 's-state' }, t(`admin.sessions.state.${state}`))),
            h('td', {}, lesson),
            h('td', {}, pilot),
            h('td', { class: 'n' }, formatLength(s.durationMs)),
            h('td', { class: 'n' }, formatBytes(r.bytes)),
            this.channelCell(r, 'telegram'),
            this.channelCell(r, 'email'),
            h('td', {}, actions));
    }

    private render(): void {
        clear(this.head);
        clear(this.content);
        const a = this.answer;
        if (a === null) return;
        const refresh = h('button', { type: 'button', class: 'btn small', 'data-action': 'refresh' }, t('admin.sessions.refresh')) as HTMLButtonElement;
        refresh.addEventListener('click', () => void this.reload(refresh));
        this.head.append(
            h('h2', { id: 's-title' }, t('admin.sessions.title')),
            h('p', { class: 'muted' }, t('admin.sessions.help')),
            h('p', { class: 'muted', 'data-testid': 's-retention' }, t('admin.sessions.retention', { days: a.retentionDays })),
            h('div', { class: 'bar' }, refresh));
        const cfg = a.config;
        const channelLine = (name: ChannelName): HTMLElement => {
            const c = cfg[name];
            const ok = c?.configured === true;
            return h('li', { class: ok ? '' : 'warn', 'data-channel': name, 'data-configured': String(ok) },
                ok ? t('admin.sessions.config.set', { channel: t(`admin.sessions.channel.${name}`), size: formatMiB(c?.maxBytes) }) : t('admin.sessions.config.unset', { channel: t(`admin.sessions.channel.${name}`) }));
        };
        this.content.append(
            h('section', { class: 'card', 'data-testid': 's-summary' },
                h('p', {}, t('admin.sessions.summary', { stored: a.totals.stored, delivered: a.totals.delivered, waiting: a.totals.waiting, failed: a.totals.failed, size: formatBytes(a.totals.bytes) })),
                h('ul', {}, channelLine('telegram'), channelLine('email'))));
        if (a.sessions.length === 0) {
            this.content.append(h('p', { class: 'muted', 'data-testid': 's-empty' }, t('admin.sessions.empty')));
            return;
        }
        const select = h('select', { id: 's-filter', 'data-testid': 's-filter' }, ...(['all', 'undelivered', 'failed'] as const).map((f) => h('option', { value: f }, t(`admin.sessions.filter.${f}`)))) as HTMLSelectElement;
        select.value = this.filter;
        select.addEventListener('change', () => {
            this.filter = select.value as StateFilter;
            this.renderList();
        });
        const search = h('input', { type: 'search', id: 's-search', 'data-testid': 's-search', value: this.query, 'aria-label': t('admin.sessions.search') }) as HTMLInputElement;
        search.addEventListener('input', () => {
            this.query = search.value;
            this.renderList();
        });
        this.listBox = h('div', { class: 's-list' });
        this.content.append(h('div', { class: 'bar' }, h('label', { class: 'field', for: 's-filter' }, h('span', {}, t('admin.sessions.filter')), select), h('label', { class: 'field', for: 's-search' }, h('span', {}, t('admin.sessions.search')), search)), this.listBox);
        this.renderList();
    }

    /** The count and the table of the rows that pass the filter and the search. */
    private renderList(): void {
        const a = this.answer;
        clear(this.listBox);
        if (a === null) return;
        const shown = a.sessions.filter((r) => matches(r, this.filter, this.query));
        const table = h('table', { class: 'data', 'aria-labelledby': 's-title', 'data-testid': 's-table' },
            h('thead', {}, h('tr', {}, ...['when', 'lesson', 'pilot', 'length', 'size', 'telegram', 'email', 'actions'].map((k) => h('th', { scope: 'col', class: k === 'length' || k === 'size' ? 'n' : '' }, h('span', { class: 'th-text' }, t(`admin.sessions.col.${k}`)))))),
            h('tbody', {}, ...shown.map((r) => this.row(r))));
        this.listBox.append(
            h('p', { class: 'muted', role: 'status', 'aria-live': 'polite', 'data-testid': 's-count' }, t('admin.sessions.count', { shown: shown.length, all: a.sessions.length })),
            h('div', { class: 'table-wrap', tabindex: '0', role: 'region', 'aria-label': t('admin.sessions.title') }, table));
    }
}
