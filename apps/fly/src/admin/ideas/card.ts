// One card of the Ideas kanban. Closed: kind, urgency, pilot, contact and landing chips, the words (a
// few lines), a move handle. Open: everything the pilot sent (contact, language, page, scene, release,
// technical details to open or download), the column and urgency selects, the owner's comments, the
// public title in four languages with the landing switch, the e-mail reply, the e-mails about it with
// their state (Cancel while one has not gone, Send for one that waits). A visitor's words are always
// text, never markup. tab.ts owns the state; this file only draws and reports.
import { h } from '../../ui/dom';
import { t } from '../i18n';
import { CANCELLABLE, IDEA_STATUSES, PUBLIC_LANGS, PUBLIC_TITLE_MAX, SENDABLE, URGENCIES, diagnosticsUrl } from './api';
import type { Idea, IdeaAnswer, IdeaMail, IdeaStatus, IdeasClient, Urgency } from './api';
import { landingBlocker, missingLangs, neighbour, onLanding, thanksDue, thanksPending } from './board';
import { mailSaid, replyForm } from './mail';

/** What happens once the server accepted a card's call, before the card is redrawn from its answer. */
export interface RunAfter {
    /** draft keys whose text was just sent: emptied first, so the redrawn boxes are empty and a second click sends nothing */
    clear?: readonly string[];
    /** what the owner is told, from the server's answer ('' says nothing) */
    say?: (a: IdeaAnswer) => string;
}

/** What a card needs from the tab: the client, the per-card state, and how to report a change. */
export interface CardHost {
    readonly client: IdeasClient;
    isOpen(id: string): boolean;
    toggle(id: string): void;
    isBusy(id: string): boolean;
    /** a kanban move (drag, keys, select); `focus` puts the focus back on the card's handle after it */
    move(id: string, to: IdeaStatus, focus?: boolean): void;
    /**
     * One call for one card (none while another call of the card runs): busy while it runs; on success the
     * `after.clear` drafts are emptied, the card is redrawn from the server's answer and `after.say` is
     * shown; on failure every draft is kept. Resolves whether the server accepted it.
     */
    run(id: string, call: () => Promise<IdeaAnswer>, after?: RunAfter): Promise<boolean>;
    /** unsent value of a field (text, or 'true'/'false' for a switch), kept across redraws (undefined: none, show the stored value) */
    draft(key: string): string | undefined;
    setDraft(key: string, v: string | undefined): void;
    /** the thank-you dialog for this idea */
    thanks(i: Idea): void;
    /** seconds an e-mail waits before it goes (the server's undo window) */
    readonly undoSeconds: number;
}

const when = (iso: string | null): string => (iso ? new Date(iso).toLocaleString() : '');

function chip(cls: string, text: string, attrs: Record<string, string> = {}): HTMLElement {
    return h('span', { class: `badge ${cls}`, ...attrs }, text);
}

export function card(i: Idea, host: CardHost): HTMLLIElement {
    const open = host.isOpen(i.id);
    const busy = host.isBusy(i.id);
    const li = h('li', { class: `idea-card${open ? ' open' : ''}${busy ? ' busy' : ''}`, 'data-idea': i.id, 'data-status': i.status, draggable: open ? 'false' : 'true', 'aria-busy': busy ? 'true' : undefined });
    li.addEventListener('dragstart', (e) => {
        e.dataTransfer?.setData('text/plain', i.id);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
        li.classList.add('dragging');
    });
    li.addEventListener('dragend', () => li.classList.remove('dragging'));

    const handle = h('button', { type: 'button', class: 'handle', 'data-action': 'handle', 'aria-label': t('admin.ideas.card.handle', { id: i.id }), title: t('admin.ideas.help'), 'aria-keyshortcuts': 'ArrowLeft ArrowRight' }, '⠿');
    handle.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        const to = neighbour(i.status, e.key === 'ArrowLeft' ? -1 : 1);
        if (to) host.move(i.id, to, true);
    });

    const head = h('div', { class: 'idea-head' },
        handle,
        chip(`k-${i.kind}`, t(`admin.ideas.kind.${i.kind}`), { 'data-chip': 'kind' }),
        i.urgency ? chip(`u-${i.urgency}`, t(`admin.ideas.urgency.${i.urgency}`), { 'data-chip': 'urgency' }) : null,
        i.fromPilot ? chip('pilot', t('admin.ideas.card.pilot'), { 'data-chip': 'pilot' }) : null,
        i.contact ? chip(i.email ? 'mail' : 'contact', i.email ? t('admin.ideas.card.hasEmail') : t('admin.ideas.card.hasContact'), { 'data-chip': 'contact' }) : null,
        onLanding(i) ? chip('landing', t('admin.ideas.card.onLanding'), { 'data-chip': 'landing' }) : null,
        i.suspect ? chip('warn', t('admin.ideas.card.suspect')) : null);
    // a seeded feature has no words of a pilot: its public title stands in
    const words = h('p', { class: 'idea-text' }, i.text || i.public.title.en || t('admin.ideas.card.noText'));
    const meta = h('p', { class: 'idea-meta muted' }, [i.id, when(i.ts)].filter(Boolean).join(' · '));
    const toggle = h('button', { type: 'button', class: 'btn small', 'data-action': 'details', 'aria-expanded': String(open), onclick: () => host.toggle(i.id) },
        open ? t('admin.ideas.card.close') : t('admin.ideas.card.open'));
    const foot = h('div', { class: 'idea-foot' }, toggle,
        thanksDue(i) ? h('button', { type: 'button', class: 'btn small', 'data-action': 'thanks', onclick: () => host.thanks(i) },
            thanksPending(i) ? t('admin.ideas.thanks.review') : t('admin.ideas.thanks.open')) : null);
    li.append(head, words, meta, foot);
    if (open) li.append(details(i, host));
    return li;
}

/** Everything about one idea, and what the owner can do with it. */
function details(i: Idea, host: CardHost): HTMLElement {
    const sent = [
        i.contact ? h('li', { 'data-field': 'contact' }, t('admin.ideas.card.contact', { contact: i.contact })) : h('li', { class: 'muted', 'data-field': 'contact' }, t('admin.ideas.card.noContact')),
        i.locale ? h('li', {}, t('admin.ideas.card.lang', { lang: i.locale })) : null,
        i.page ? h('li', {}, t('admin.ideas.card.page', { page: i.page })) : null,
        i.scene ? h('li', {}, h('a', { href: `/en/fly/?scene=${encodeURIComponent(i.scene)}`, target: '_blank', rel: 'noopener' }, t('admin.ideas.card.scene', { id: i.scene }))) : null,
        i.release ? h('li', {}, t('admin.ideas.card.release', { release: i.release })) : null,
        i.diagnostics === true
            ? h('li', { 'data-field': 'diagnostics' },
                h('a', { href: diagnosticsUrl(i.id), target: '_blank', rel: 'noopener', 'data-action': 'diagnostics' }, t('admin.ideas.card.diagnostics')), ' · ',
                h('a', { href: diagnosticsUrl(i.id), download: `${i.id}.json`, 'data-action': 'download' }, t('admin.ideas.card.download')))
            : i.diagnostics === 'skipped' ? h('li', { class: 'warn' }, t('admin.ideas.card.diagSkipped')) : null
    ];

    const column = h('select', { 'data-field': 'status', 'aria-label': t('admin.ideas.card.column') }) as HTMLSelectElement;
    for (const s of IDEA_STATUSES) column.append(h('option', { value: s }, t(`admin.ideas.col.${s}`)));
    column.value = i.status;
    column.addEventListener('change', () => host.move(i.id, column.value as IdeaStatus));
    const urgency = h('select', { 'data-field': 'urgency', 'aria-label': t('admin.ideas.urgency.label') }) as HTMLSelectElement;
    urgency.append(h('option', { value: '' }, t('admin.ideas.urgency.none')));
    for (const u of URGENCIES) urgency.append(h('option', { value: u }, t(`admin.ideas.urgency.${u}`)));
    urgency.value = i.urgency ?? '';
    urgency.addEventListener('change', () => void host.run(i.id, () => host.client.setUrgency(i.id, (urgency.value || null) as Urgency | null)));

    const summary = PUBLIC_LANGS.map((l) => i.summary[l]).find(Boolean);
    return h('div', { class: 'idea-details' },
        i.text ? h('p', { class: 'idea-full' }, i.text) : null,
        h('ul', { class: 'idea-sent' }, ...sent),
        h('div', { class: 'idea-row' }, field(t('admin.ideas.card.column'), column), field(t('admin.ideas.urgency.label'), urgency)),
        summary ? h('section', { class: 'idea-sec' }, h('h3', {}, t('admin.ideas.thanks.summary')), h('p', { class: 'idea-full' }, summary)) : null,
        comments(i, host),
        publicEditor(i, host),
        replyForm(i, host),
        i.mails.length ? h('section', { class: 'idea-sec', 'data-field': 'mails' }, h('h3', {}, t('admin.ideas.mails')),
            h('ul', { class: 'idea-list' }, ...i.mails.map((m) => mailRow(i, m, host)))) : null);
}

/** One e-mail of the thread: what, to whom, its state, and Cancel / Send while that still means something. */
function mailRow(i: Idea, m: IdeaMail, host: CardHost): HTMLElement {
    const state = m.state === 'queued' && m.notBefore ? t('admin.ideas.mail.queuedUntil', { time: when(m.notBefore) })
        : m.state === 'sent' && m.sentAt ? t('admin.ideas.mail.sentAt', { time: when(m.sentAt) })
            : t(`admin.ideas.mail.state.${m.state}`);
    const act = (action: 'cancel' | 'send'): HTMLButtonElement => h('button', { type: 'button', class: 'btn small', 'data-action': `mail-${action}`, 'data-mail': m.id,
        onclick: () => void host.run(i.id, () => (action === 'cancel' ? host.client.cancelMail(m.id) : host.client.sendMail(m.id)),
            { say: (a) => mailSaid(m.kind, a.mail, host.undoSeconds) }) }, t(`admin.ideas.mail.${action}`));
    // a draft thank-you is sent from its dialog, where the owner reads it first
    const draftThanks = m.kind === 'done' && m.state === 'draft';
    return h('li', { 'data-mail': m.id, 'data-state': m.state, class: m.state === 'failed' || m.state === 'unknown' ? 'warn' : '' },
        h('span', {}, `${t(`admin.ideas.mail.${m.kind}`)} · ${m.to || t('admin.ideas.mail.noAddress')} · `),
        h('strong', {}, state),
        m.error ? h('span', { class: 'muted' }, ` · ${m.error}`) : null,
        draftThanks ? null : h('span', { class: 'mail-acts' }, SENDABLE.has(m.state) ? act('send') : null, CANCELLABLE.has(m.state) ? act('cancel') : null));
}

function comments(i: Idea, host: CardHost): HTMLElement {
    const key = `${i.id}:comment`;
    const input = h('textarea', { rows: 2, maxlength: 2000, 'data-field': 'comment', 'aria-label': t('admin.ideas.comment.placeholder'), placeholder: t('admin.ideas.comment.placeholder') }) as HTMLTextAreaElement;
    input.value = host.draft(key) ?? '';
    input.addEventListener('input', () => host.setDraft(key, input.value));
    const add = h('button', { type: 'button', class: 'btn small', 'data-action': 'comment' }, t('admin.ideas.comment.add'));
    add.addEventListener('click', async () => {
        const text = input.value.trim();
        if (!text) return input.focus();
        void host.run(i.id, () => host.client.comment(i.id, text), { clear: [key] });
    });
    const by = (b: string): string => (b === 'telegram' ? ' · Telegram' : b && b !== 'admin' ? ` · ${b}` : '');
    return h('section', { class: 'idea-sec' }, h('h3', {}, t('admin.ideas.comments')),
        i.comments.length ? h('ul', { class: 'idea-list' }, ...i.comments.map((c) => h('li', {}, h('span', { class: 'muted' }, `${when(c.at)}${by(c.by)}: `), c.text))) : null,
        input, h('div', { class: 'bar' }, add));
}

/** The public title in four languages and the landing switch; saved by its button. */
function publicEditor(i: Idea, host: CardHost): HTMLElement {
    const title = { ...i.public.title };
    const note = h('p', { class: 'muted', 'data-field': 'public-note' });
    // the switch is a draft like the titles: a redraw before Save (another card's answer, a filter) keeps it
    const showKey = `${i.id}:visible`;
    const show = h('input', { type: 'checkbox', 'data-field': 'visible' }) as HTMLInputElement;
    const shown = host.draft(showKey);
    show.checked = shown === undefined ? i.public.visible : shown === 'true';
    show.addEventListener('change', () => host.setDraft(showKey, String(show.checked)));
    const refresh = (): void => {
        const block = landingBlocker(title, i.status);
        const missing = missingLangs(title).filter((l) => l !== 'en');
        note.textContent = block === 'title' ? t('admin.ideas.public.needTitle')
            : block === 'status' ? t('admin.ideas.public.needStatus')
                : missing.length ? t('admin.ideas.public.missing', { langs: missing.join(', ') }) : '';
    };
    const inputs = PUBLIC_LANGS.map((l) => {
        const key = `${i.id}:title:${l}`;
        const typed = host.draft(key);
        const input = h('input', { type: 'text', maxlength: PUBLIC_TITLE_MAX, 'data-field': `title-${l}`, value: typed ?? title[l] ?? '' }) as HTMLInputElement;
        const take = (): void => { if (input.value.trim()) title[l] = input.value.trim(); else delete title[l]; };
        if (typed !== undefined) take();
        input.addEventListener('input', () => {
            host.setDraft(key, input.value);
            take();
            refresh();
        });
        return field(t('admin.ideas.public.field', { lang: l }), input);
    });
    const save = h('button', { type: 'button', class: 'btn small primary', 'data-action': 'save-public' }, t('admin.ideas.public.save'));
    save.addEventListener('click', () => void host.run(i.id, () => host.client.setPublic(i.id, title, show.checked),
        { clear: [...PUBLIC_LANGS.map((l) => `${i.id}:title:${l}`), showKey], say: () => t('admin.ideas.public.saved') }));
    refresh();
    return h('section', { class: 'idea-sec' }, h('h3', {}, t('admin.ideas.public.title')),
        h('div', { class: 'idea-grid' }, ...inputs),
        h('label', { class: 'check' }, show, ' ', t('admin.ideas.public.show')), note, h('div', { class: 'bar' }, save));
}

export function field(label: string, input: HTMLElement): HTMLElement {
    return h('label', { class: 'field' }, h('span', {}, label), input);
}
