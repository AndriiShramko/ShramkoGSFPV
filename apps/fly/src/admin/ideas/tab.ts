// The admin's Ideas tab (owner's item 3): every pilot's idea and bug and the owner's notes as a kanban,
// New / Accepted (the work queue) / In progress / Done / Rejected. It replaces the Reports tab and keeps
// what that tab did (every report with its words and what the pilot sent, bug details to open or
// download). Move a card by dragging it onto a column, by its handle and the left/right arrow keys, or
// by the Column select in the open card (touch). Filters and a search narrow the board; a note form
// writes down an idea a pilot told the owner outside the form (item 8). Nothing waits to be saved here:
// every change goes to the server at once (ideas/api.ts) and the card shows the server's answer. A
// pilot's idea that reaches Done opens the thank-you dialog (ideas/mail.ts); e-mails go only on Send.
// While the server cannot read its ideas file (503 ideas-store) the tab says so in place of the board,
// with Try again; the Scenes tab is not affected. An e-mail that changed meanwhile (409) is re-read.
import { h, clear } from '../../ui/dom';
import { t } from '../i18n';
import type { AdminClient } from '../api';
import { IDEA_KINDS, IDEA_STATUSES, IdeasClient, PUBLIC_LANGS, URGENCIES } from './api';
import type { Idea, IdeaAnswer, IdeaKind, IdeaStatus, IdeasSetup, Urgency } from './api';
import { ALL_IDEAS, columns, moveBody, thanksDue } from './board';
import type { IdeaFilter } from './board';
import { card, field } from './card';
import type { CardHost, RunAfter } from './card';
import { changedMeanwhile, refusal, storeDown } from './errors';
import { openThanks } from './mail';

export class IdeasTab implements CardHost {
    readonly root: HTMLElement;
    readonly client: IdeasClient;
    private ideas: Idea[] = [];
    private unreadable = 0;
    private setup: IdeasSetup = { mail: false, mailFrom: null, bot: false, undoSeconds: 60 };
    private filter: IdeaFilter = { ...ALL_IDEAS, kinds: new Set(ALL_IDEAS.kinds) };
    private readonly opened = new Set<string>();
    private readonly busy = new Set<string>();
    private readonly drafts = new Map<string, string>();
    private readonly board = h('div', { class: 'board', 'data-testid': 'idea-board' });
    private readonly bar = h('div', { class: 'bar filters', role: 'search' });
    private readonly shown = h('span', { class: 'muted', 'data-testid': 'idea-shown', 'aria-live': 'polite' });
    private readonly warn = h('p', { class: 'warn', 'data-testid': 'idea-unreadable' });
    private readonly setupNote = h('p', { class: 'muted', 'data-testid': 'idea-setup' });
    private readonly down = h('section', { class: 'card', 'data-testid': 'idea-down', role: 'alert', hidden: true });
    private readonly controls: HTMLElement;

    constructor(api: AdminClient, private readonly say: (msg: string, bad?: boolean) => void) {
        this.client = new IdeasClient(api);
        this.buildFilters();
        this.controls = h('section', { class: 'card' }, this.bar, h('p', { class: 'muted' }, t('admin.ideas.help')), this.setupNote, this.warn, this.noteForm());
        this.root = h('div', { class: 'tab-body' }, this.down, this.controls, this.board);
    }

    get undoSeconds(): number { return this.setup.undoSeconds; }

    /** The board from the server; while the store cannot be read, the reason in its place (other errors go up). */
    async load(): Promise<void> {
        let r: Awaited<ReturnType<IdeasClient['list']>>;
        try {
            r = await this.client.list();
        } catch (e) {
            if (!storeDown(e)) throw e;
            this.showDown(e);
            return;
        }
        this.showDown(null);
        this.ideas = r.ideas;
        this.unreadable = r.unreadable;
        this.setup = r.setup;
        this.render();
    }

    /** The store's state: unusable (e: the 503) hides the board and offers Try again; null shows it. */
    private showDown(e: unknown): void {
        clear(this.down);
        this.down.hidden = this.board.hidden = this.controls.hidden = false;
        if (!e) { this.down.hidden = true; return; }
        this.board.hidden = this.controls.hidden = true;
        const msg = refusal(e);
        const retry = h('button', { type: 'button', class: 'btn small', 'data-action': 'ideas-retry' }, t('admin.ideas.down.retry'));
        retry.addEventListener('click', () => {
            retry.disabled = true;
            this.say('');
            void this.load().catch((x) => this.say(refusal(x), true)).finally(() => { retry.disabled = false; });
        });
        this.down.append(h('p', { class: 'warn' }, msg), h('div', { class: 'bar' }, retry));
        this.say(msg, true);
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
        void this.run(id, () => this.client.setStatus(body.id, body.status), { say: (a) => t('admin.ideas.moved', { id, column: t(`admin.ideas.col.${a.idea.status}`) }) }).then((ok) => {
            if (focus) this.focus(id, '.handle');
            const now = this.ideas.find((x) => x.id === id);
            if (ok && now && i.status !== 'done' && thanksDue(now)) this.thanks(now);
        });
    }

    async run(id: string, call: () => Promise<IdeaAnswer>, after: RunAfter = {}): Promise<boolean> {
        if (this.busy.has(id)) return false; // a second click while the first call runs sends nothing
        this.busy.add(id);
        this.render();
        try {
            const a = await call();
            this.busy.delete(id);
            // the sent text leaves its draft BEFORE the redraw, or the new boxes would show it again
            for (const k of after.clear ?? []) this.drafts.delete(k);
            this.update(a.idea);
            const msg = after.say?.(a);
            if (msg) this.say(msg);
            return true;
        } catch (e) {
            this.busy.delete(id);
            // an e-mail that changed meanwhile (409): the card shows the idea as the server has it now
            if (changedMeanwhile(e)) await this.client.get(id).then((i) => this.update(i), () => undefined);
            this.render();
            // the store became unreadable after the board was drawn: the board gives way to the reason
            if (storeDown(e)) this.showDown(e);
            else this.say(refusal(e), true);
            return false;
        }
    }

    thanks(i: Idea): void {
        openThanks(i, { client: this.client, undoSeconds: this.setup.undoSeconds, update: (x) => this.update(x), say: this.say });
    }

    /** The server's answer replaces the card (or adds it: a new note). */
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

    /** "Write down an idea": what a pilot told the owner outside the form goes on the board as a note (item 8). */
    private noteForm(): HTMLElement {
        const text = h('textarea', { rows: 3, maxlength: 4000, 'data-field': 'note-text', 'aria-label': t('admin.ideas.note.text') }) as HTMLTextAreaElement;
        const contact = h('input', { type: 'text', maxlength: 200, 'data-field': 'note-contact' }) as HTMLInputElement;
        const lang = h('select', { 'data-field': 'note-lang' }) as HTMLSelectElement;
        lang.append(h('option', { value: '' }, t('admin.ideas.note.langNone')));
        for (const l of PUBLIC_LANGS) lang.append(h('option', { value: l }, l));
        const urgency = h('select', { 'data-field': 'note-urgency' }) as HTMLSelectElement;
        urgency.append(h('option', { value: '' }, t('admin.ideas.urgency.none')));
        for (const u of URGENCIES) urgency.append(h('option', { value: u }, t(`admin.ideas.urgency.${u}`)));
        const add = h('button', { type: 'button', class: 'btn small primary', 'data-action': 'note-add' }, t('admin.ideas.note.add'));
        add.addEventListener('click', async () => {
            if (!text.value.trim()) return text.focus();
            add.disabled = true;
            try {
                const { idea } = await this.client.addNote({ text: text.value.trim(), contact: contact.value.trim(), lang: lang.value, urgency: (urgency.value || null) as Urgency | null });
                text.value = '';
                contact.value = '';
                this.update(idea);
                this.say(t('admin.ideas.note.added', { id: idea.id }));
            } catch (e) {
                this.say(refusal(e), true);
            } finally {
                add.disabled = false;
            }
        });
        return h('details', { class: 'note-form', 'data-testid': 'note-form' },
            h('summary', {}, t('admin.ideas.note.title')),
            field(t('admin.ideas.note.text'), text),
            h('div', { class: 'idea-row' }, field(t('admin.ideas.note.contact'), contact), field(t('admin.ideas.note.lang'), lang)),
            h('div', { class: 'idea-row' }, field(t('admin.ideas.urgency.label'), urgency), h('div', { class: 'bar' }, add)));
    }

    private render(): void {
        const cols = columns(this.ideas, this.filter);
        const n = IDEA_STATUSES.reduce((s, k) => s + cols[k].length, 0);
        this.shown.textContent = t('admin.ideas.filter.shown', { n, total: this.ideas.length });
        this.warn.textContent = this.unreadable ? t('admin.ideas.unreadable', { n: this.unreadable }) : '';
        this.warn.hidden = !this.unreadable;
        this.setupNote.textContent = [
            this.setup.mail ? t('admin.ideas.setup.mail', { from: this.setup.mailFrom ?? '' }) : t('admin.ideas.setup.noMail'),
            this.setup.bot ? t('admin.ideas.setup.bot') : t('admin.ideas.setup.noBot')
        ].join(' ');
        this.setupNote.className = this.setup.mail ? 'muted' : 'warn';
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
        // a redraw while typing (another card's answer came back) keeps the focus where it was
        if (activeKey?.[0] && activeKey[1]) {
            const at = `[data-idea="${CSS.escape(activeKey[0])}"]`;
            this.board.querySelector<HTMLElement>(`${at} [data-field="${activeKey[1]}"], ${at} [data-action="${activeKey[1]}"]`)?.focus();
        }
    }
}
