// The open card of the Ideas kanban: one idea at a time in a side panel (a <dialog> opened modal, up to
// 720 px wide on the right; the whole screen on a phone) instead of a card growing inside its kanban
// column, which is ~200 px wide on a desktop: there the public titles showed 13 characters. The panel
// draws the card's chips and card.ts `details` (what the pilot sent, the column and urgency, comments,
// the public titles in four languages, the reply by e-mail, the e-mails, the thank-you). Modal: the board
// behind is inert and Tab stays in the panel; Esc or Close closes it and tab.ts puts the focus back on the
// card's Details button. The server's answers redraw it in place (draw): scroll position and focus kept.
import { h, clear } from '../../ui/dom';
import { t } from '../i18n';
import type { Idea } from './api';
import { chips, details, thanksButton, when } from './card';
import type { CardHost } from './card';

/** The attributes that name a control of the panel across a redraw (a mail's buttons also need their mail). */
const KEY_ATTRS = ['data-field', 'data-action', 'data-mail'] as const;

export class IdeaPanel {
    readonly dialog: HTMLDialogElement;
    private shown: string | null = null;

    /** `closed` runs as the panel closes (Esc, Close, or close()), with the idea it showed. */
    constructor(private readonly closed: (id: string) => void) {
        this.dialog = h('dialog', { class: 'idea-panel', 'data-testid': 'idea-panel', 'aria-labelledby': 'idea-panel-title' }) as HTMLDialogElement;
        // Esc closes it here and now, like Close: the focus is back on the card before the next key is
        // handled (the dialog's own close event comes a task later; it is the fallback if Esc cannot be held)
        this.dialog.addEventListener('cancel', (e) => {
            e.preventDefault();
            this.close();
        });
        this.dialog.addEventListener('close', () => this.finish());
    }

    /** The idea the panel shows, or null while it is closed. */
    get id(): string | null {
        return this.shown;
    }

    /** Shows this idea; the focus goes to the panel's Close button (the first thing Tab reaches in it). */
    open(i: Idea, host: CardHost): void {
        const fresh = !this.dialog.open || this.shown !== i.id;
        this.draw(i, host);
        if (!this.dialog.open) this.dialog.showModal();
        // another card starts at its top (the browser would bring back where the last one was scrolled)
        if (fresh) this.dialog.scrollTop = 0;
        this.dialog.querySelector<HTMLElement>('[data-action=panel-close]')?.focus();
    }

    /** Redraws the open panel from the idea as the server has it now, where it was scrolled, the focus where it was. */
    draw(i: Idea, host: CardHost): void {
        const d = this.dialog;
        const top = d.scrollTop;
        const active = document.activeElement instanceof HTMLElement && d.contains(document.activeElement) ? document.activeElement : null;
        const key = active ? KEY_ATTRS.filter((a) => active.hasAttribute(a)).map((a) => `[${a}="${CSS.escape(active.getAttribute(a) ?? '')}"]`).join('') : '';
        const busy = host.isBusy(i.id);
        this.shown = i.id;
        clear(d);
        d.setAttribute('data-panel-idea', i.id);
        d.setAttribute('data-status', i.status);
        d.classList.toggle('busy', busy);
        if (busy) d.setAttribute('aria-busy', 'true'); else d.removeAttribute('aria-busy');
        const close = h('button', { type: 'button', class: 'btn small', 'data-action': 'panel-close', onclick: () => this.close() }, t('admin.ideas.panel.close'));
        const thanks = thanksButton(i, host);
        d.append(
            h('header', { class: 'panel-head' }, h('h2', { id: 'idea-panel-title' }, `${t(`admin.ideas.kind.${i.kind}`)} ${i.id}`), close),
            h('div', { class: 'panel-body' },
                h('div', { class: 'idea-head' }, ...chips(i)),
                h('p', { class: 'idea-meta muted' }, [t(`admin.ideas.col.${i.status}`), when(i.ts)].filter(Boolean).join(' · ')),
                thanks ? h('div', { class: 'idea-foot' }, thanks) : null,
                details(i, host)));
        d.scrollTop = top;
        if (key) d.querySelector<HTMLElement>(key)?.focus({ preventScroll: true });
    }

    close(): void {
        if (this.dialog.open) this.dialog.close();
        this.finish();
    }

    /** Once per close: empty the panel and tell the tab (which puts the focus back on the card). */
    private finish(): void {
        const id = this.shown;
        if (!id) return;
        this.shown = null;
        clear(this.dialog);
        for (const a of ['data-panel-idea', 'data-status', 'aria-busy']) this.dialog.removeAttribute(a);
        this.closed(id);
    }
}
