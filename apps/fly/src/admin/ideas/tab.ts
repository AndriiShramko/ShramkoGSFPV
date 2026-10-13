// The admin's Ideas tab (owner's item 3): every pilot's idea and bug and the owner's notes as a kanban,
// New / Accepted (the work queue) / In progress / Done / Rejected. It replaces the Reports tab and keeps
// what that tab did (every report with its words and what the pilot sent, bug details to open or
// download). Move a card by dragging it onto a column, by its handle and the left/right arrow keys, or
// by the Column select in the open card (touch). Filters and a search narrow the board; nothing is
// waiting to be saved here, every change goes to the server at once (ideas/api.ts) and the card shows
// the server's answer. A pilot's idea that reaches Done opens the thank-you draft (ideas/mail.ts).
import { h, clear } from '../../ui/dom';
import { t } from '../i18n';
import type { AdminClient } from '../api';
import { IDEA_KINDS, IDEA_STATUSES, IdeasClient } from './api';
import type { Idea, IdeaKind, IdeaStatus } from './api';
import { ALL_IDEAS, columns, moveBody, thanksDue } from './board';
import type { IdeaFilter } from './board';
import { card } from './card';
import type { CardHost } from './card';
import { openThanks } from './mail';

export class IdeasTab implements CardHost {
    readonly root: HTMLElement;
    readonly client: IdeasClient;
    private ideas: Idea[] = [];
    private unreadable = 0;
    private filter: IdeaFilter = { ...ALL_IDEAS, kinds: new Set(ALL_IDEAS.kinds) };
    private readonly opened = new Set<string>();
    private readonly busy = new Set<string>();
    private readonly drafts = new Map<string, string>();
    private readonly board = h('div', { class: 'board', 'data-testid': 'idea-board' });
    private readonly bar = h('div', { class: 'bar filters', role: 'search' });
    private readonly shown = h('span', { class: 'muted', 'data-testid': 'idea-shown', 'aria-live': 'polite' });
    private readonly warn = h('p', { class: 'warn', 'data-testid': 'idea-unreadable' });

    constructor(api: AdminClient, private readonly say: (msg: string, bad?: boolean) => void) {
        this.client = new IdeasClient(api);
        this.buildFilters();
        this.root = h('div', { class: 'tab-body' },
            h('section', { class: 'card' }, this.bar, h('p', { class: 'muted' }, t('admin.ideas.help')), this.warn),
            this.board);
    }

    async load(): Promise<void> {
        const r = await this.client.list();
        this.ideas = r.ideas;
        this.unreadable = r.unreadable;
        this.render();
    }

    /** Nothing waits to be saved here: every change is sent at once. */
    async flush(): Promise<void> {}

    // ---------------- CardHost ----------------

    isOpen(id: string): boolean { return this.opened.has(id); }
    isBusy(id: string): boolean { return this.busy.has(id); }
    draft(key: string): string | undefined { return this.drafts.get(key); }
    setDraft(key: string, v: string | undefined): void { if (v === undefined) this.drafts.delete(key); else this.drafts.set(key, v); }

    toggle(id: string): void {
        if (!this.opened.delete(id)) this.opened.add(id);
        this.render();
        this.focus(id, '[data-action=details]');
    }

    move(id: string, to: IdeaStatus, focus = false): void {
        const i = this.ideas.find((x) => x.id === id);
        const body = i ? moveBody(i, to) : null;
        if (!i || !body || this.busy.has(id)) return;
        void this.run(id, () => this.client.setStatus(body.id, body.status), (done) => t('admin.ideas.moved', { id, column: t(`admin.ideas.col.${done.status}`) })).then((ok) => {
            if (focus) this.focus(id, '.handle');
            const now = this.ideas.find((x) => x.id === id);
            if (ok && now && now.status === 'done' && i.status !== 'done' && thanksDue(now)) this.thanks(now);
        });
    }

    async run(id: string, call: () => Promise<Idea>, done?: (i: Idea) => string): Promise<boolean> {
        this.busy.add(id);
        this.render();
        try {
            const idea = await call();
            this.busy.delete(id);
            this.update(idea);
            if (done) this.say(done(idea));
            return true;
        } catch (e) {
            this.busy.delete(id);
            this.render();
            this.say(t('admin.ideas.error', { why: e instanceof Error ? e.message : String(e) }), true);
            return false;
        }
    }

    thanks(i: Idea): void {
        openThanks(i, { client: this.client, update: (x) => this.update(x), say: this.say });
    }

    /** The server's answer replaces the card (or adds it, if the store has a new one). */
    update(i: Idea): void {
        const at = this.ideas.findIndex((x) => x.id === i.id);
        if (at >= 0) this.ideas[at] = i; else this.ideas.unshift(i);
        this.render();
    }

    // ---------------- drawing ----------------

    private focus(id: string, sel: string): void {
        this.board.querySelector<HTMLElement>(`[data-idea="${CSS.escape(id)}"] ${sel}`)?.focus();
    }

    private buildFilters(): void {
        const search = h('input', { type: 'search', class: 'grow', 'data-testid': 'idea-search', 'aria-label': t('admin.ideas.filter.search'), placeholder: t('admin.ideas.filter.search') }) as HTMLInputElement;
        search.addEventListener('input', () => { this.filter = { ...this.filter, search: search.value }; this.render(); });
        const kinds = h('div', { class: 'bar', role: 'group', 'aria-label': t('admin.ideas.filter.kinds') });
        for (const k of IDEA_KINDS) {
            const b = h('button', { type: 'button', class: 'tab', 'data-kind': k, 'aria-pressed': 'true' }, t(`admin.ideas.kind.${k}`));
            b.addEventListener('click', () => {
                const next = new Set<IdeaKind>(this.filter.kinds);
                if (!next.delete(k)) next.add(k);
                this.filter = { ...this.filter, kinds: next };
                b.setAttribute('aria-pressed', String(next.has(k)));
                this.render();
            });
            kinds.append(b);
        }
        const select = <K extends 'minUrgency' | 'contact' | 'landing'>(key: K, values: readonly IdeaFilter[K][], label: string): HTMLSelectElement => {
            const s = h('select', { 'data-filter': key, 'aria-label': label }) as HTMLSelectElement;
            for (const v of values) s.append(h('option', { value: v }, t(`admin.ideas.filter.${key}.${v}`)));
            s.addEventListener('change', () => { this.filter = { ...this.filter, [key]: s.value }; this.render(); });
            return s;
        };
        this.bar.append(search,
            select('minUrgency', ['any', 'normal', 'high', 'urgent'], t('admin.ideas.urgency.label')),
            select('contact', ['any', 'yes', 'no'], t('admin.ideas.filter.contact.label')),
            select('landing', ['any', 'yes', 'no'], t('admin.ideas.filter.landing.label')),
            kinds, this.shown);
    }

    private render(): void {
        const cols = columns(this.ideas, this.filter);
        const n = IDEA_STATUSES.reduce((s, k) => s + cols[k].length, 0);
        this.shown.textContent = t('admin.ideas.filter.shown', { n, total: this.ideas.length });
        this.warn.textContent = this.unreadable ? t('admin.ideas.unreadable', { n: this.unreadable }) : '';
        this.warn.hidden = !this.unreadable;
        const scroll = [...this.board.querySelectorAll<HTMLElement>('.cards')].map((c) => c.scrollTop);
        const active = document.activeElement instanceof HTMLElement && this.board.contains(document.activeElement) ? document.activeElement : null;
        const activeKey = active ? [active.closest('[data-idea]')?.getAttribute('data-idea'), active.getAttribute('data-field') ?? active.getAttribute('data-action')] : null;
        clear(this.board);
        IDEA_STATUSES.forEach((s, k) => {
            const list = h('ol', { class: 'cards' });
            for (const i of cols[s]) list.append(card(i, this));
            if (!cols[s].length) list.append(h('li', { class: 'muted empty' }, t('admin.ideas.col.empty')));
            const col = h('section', { class: 'column', 'data-column': s, 'aria-label': t(`admin.ideas.col.${s}`) },
                h('h2', {}, t(`admin.ideas.col.${s}`), ' ', h('span', { class: 'muted', 'data-count': s }, String(cols[s].length))), list);
            col.addEventListener('dragover', (e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; col.classList.add('drop'); });
            col.addEventListener('dragleave', (e) => { if (!col.contains(e.relatedTarget as Node | null)) col.classList.remove('drop'); });
            col.addEventListener('drop', (e) => {
                e.preventDefault();
                col.classList.remove('drop');
                const id = e.dataTransfer?.getData('text/plain');
                if (id) this.move(id, s);
            });
            this.board.append(col);
            list.scrollTop = scroll[k] ?? 0;
        });
        // a redraw while typing (another card's answer came back) keeps the cursor where it was
        if (activeKey?.[0] && activeKey[1]) {
            const again = this.board.querySelector<HTMLElement>(`[data-idea="${CSS.escape(activeKey[0])}"] [data-field="${activeKey[1]}"], [data-idea="${CSS.escape(activeKey[0])}"] [data-action="${activeKey[1]}"]`);
            again?.focus();
        }
    }
}
