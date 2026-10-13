// One card of the Ideas kanban. Closed: kind, urgency, pilot, contact and landing chips, the words (a
// few lines), a move handle. Open: everything the pilot sent (contact, language, page, scene, release,
// technical details to open or download), the column and urgency selects, the owner's comments, the
// public title in four languages with the landing switch, the e-mail reply, the thank-you e-mail. A
// visitor's words are always text, never markup. tab.ts owns the state; this file only draws and reports.
import { h } from '../../ui/dom';
import { t } from '../i18n';
import { IDEA_STATUSES, PUBLIC_LANGS, URGENCIES, diagnosticsUrl } from './api';
import type { Idea, IdeaPublic, IdeaStatus, IdeasClient, Urgency } from './api';
import { LANDING_GROUPS, emailOf, landingBlocker, missingLangs, onLanding, thanksDue } from './board';
import { replyForm } from './mail';

/** What a card needs from the tab: the client, the per-card state, and how to report a change. */
export interface CardHost {
    readonly client: IdeasClient;
    isOpen(id: string): boolean;
    toggle(id: string): void;
    isBusy(id: string): boolean;
    /** a kanban move (drag, keys, select); `focus` puts the focus back on the card's handle after it */
    move(id: string, to: IdeaStatus, focus?: boolean): void;
    /** one call for one card: busy while it runs, the card replaced by the server's answer, `done` said */
    run(id: string, call: () => Promise<Idea>, done?: (i: Idea) => string): Promise<boolean>;
    /** unsent text of a field, kept across redraws (undefined: none, show the stored value) */
    draft(key: string): string | undefined;
    setDraft(key: string, v: string | undefined): void;
    /** the thank-you dialog for this idea */
    thanks(i: Idea): void;
}

const when = (iso: string | null): string => (iso ? new Date(iso).toLocaleString() : '');

function chip(cls: string, text: string, attrs: Record<string, string> = {}): HTMLElement {
    return h('span', { class: `badge ${cls}`, ...attrs }, text);
}

export function card(i: Idea, host: CardHost): HTMLLIElement {
    const open = host.isOpen(i.id);
    const busy = host.isBusy(i.id);
    const li = h('li', { class: `idea${open ? ' open' : ''}${busy ? ' busy' : ''}`, 'data-idea': i.id, 'data-status': i.status, draggable: open ? 'false' : 'true', 'aria-busy': busy ? 'true' : undefined });
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
        const at = IDEA_STATUSES.indexOf(i.status) + (e.key === 'ArrowLeft' ? -1 : 1);
        if (at >= 0 && at < IDEA_STATUSES.length) host.move(i.id, IDEA_STATUSES[at], true);
    });

    const email = emailOf(i.contact);
    const head = h('div', { class: 'idea-head' },
        handle,
        chip(`kind ${i.kind}`, t(`admin.ideas.kind.${i.kind}`), { 'data-chip': 'kind' }),
        chip(`urg ${i.urgency}`, t(`admin.ideas.urgency.${i.urgency}`), { 'data-chip': 'urgency' }),
        i.fromPilot ? chip('pilot', t('admin.ideas.card.pilot'), { 'data-chip': 'pilot' }) : null,
        i.contact ? chip(email ? 'mail' : 'contact', email ? t('admin.ideas.card.hasEmail') : t('admin.ideas.card.hasContact'), { 'data-chip': 'contact' }) : null,
        onLanding(i) ? chip('landing', t('admin.ideas.card.onLanding'), { 'data-chip': 'landing' }) : null,
        i.suspect ? chip('warn', t('admin.ideas.card.suspect')) : null);
    const words = h('p', { class: 'idea-text' }, i.text || t('admin.ideas.card.noText'));
    const meta = h('p', { class: 'idea-meta muted' }, [i.id, when(i.ts)].filter(Boolean).join(' · '));
    const toggle = h('button', { type: 'button', class: 'btn small', 'data-action': 'details', 'aria-expanded': String(open), onclick: () => host.toggle(i.id) },
        open ? t('admin.ideas.card.close') : t('admin.ideas.card.open'));
    const foot = h('div', { class: 'idea-foot' }, toggle,
        thanksDue(i) ? h('button', { type: 'button', class: 'btn small', 'data-action': 'thanks', onclick: () => host.thanks(i) }, t('admin.ideas.thanks.open')) : null);
    li.append(head, words, meta, foot);
    if (open) li.append(details(i, host));
    return li;
}

/** Everything about one idea, and what the owner can do with it. */
function details(i: Idea, host: CardHost): HTMLElement {
    const email = emailOf(i.contact);
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
    for (const u of URGENCIES) urgency.append(h('option', { value: u }, t(`admin.ideas.urgency.${u}`)));
    urgency.value = i.urgency;
    urgency.addEventListener('change', () => void host.run(i.id, () => host.client.setUrgency(i.id, urgency.value as Urgency)));

    return h('div', { class: 'idea-details' },
        i.text ? h('p', { class: 'idea-full' }, i.text) : null,
        h('ul', { class: 'idea-sent' }, ...sent),
        h('div', { class: 'idea-row' }, field(t('admin.ideas.card.column'), column), field(t('admin.ideas.urgency.label'), urgency)),
        comments(i, host),
        publicEditor(i, host),
        replyForm(i, email, host),
        i.mails.length ? h('section', { class: 'idea-sec' }, h('h3', {}, t('admin.ideas.mails')),
            h('ul', { class: 'idea-list' }, ...i.mails.map((m) => h('li', { class: m.ok ? '' : 'bad' },
                `${when(m.ts)} · ${t(`admin.ideas.mail.${m.kind}`)} · ${m.to}${m.ok ? '' : ` · ${t('admin.ideas.mail.failed')}`}`)))) : null);
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
        if (await host.run(i.id, () => host.client.comment(i.id, text))) host.setDraft(key, undefined);
    });
    return h('section', { class: 'idea-sec' }, h('h3', {}, t('admin.ideas.comments')),
        i.comments.length ? h('ul', { class: 'idea-list' }, ...i.comments.map((c) => h('li', {}, h('span', { class: 'muted' }, `${when(c.ts)}${c.via === 'telegram' ? ' · Telegram' : ''}: `), c.text))) : null,
        input, h('div', { class: 'bar' }, add));
}

/** The public title in four languages, the landing group and the switch; saved by its button. */
function publicEditor(i: Idea, host: CardHost): HTMLElement {
    const pub: IdeaPublic = { title: { ...i.public.title }, roadmap: i.public.roadmap, group: i.public.group };
    const note = h('p', { class: 'muted', 'data-field': 'public-note' });
    const show = h('input', { type: 'checkbox', 'data-field': 'roadmap' }) as HTMLInputElement;
    show.checked = pub.roadmap;
    const refresh = (): void => {
        const block = landingBlocker(pub, i.status);
        const missing = missingLangs(pub.title).filter((l) => l !== 'en');
        note.textContent = block === 'title' ? t('admin.ideas.public.needTitle')
            : block === 'status' ? t('admin.ideas.public.needStatus')
                : missing.length ? t('admin.ideas.public.missing', { langs: missing.join(', ') }) : '';
        show.disabled = block === 'title';
        if (show.disabled) show.checked = false;
    };
    const inputs = PUBLIC_LANGS.map((l) => {
        const key = `${i.id}:title:${l}`;
        const typed = host.draft(key);
        const input = h('input', { type: 'text', maxlength: 240, 'data-field': `title-${l}`, value: typed ?? pub.title[l] ?? '' }) as HTMLInputElement;
        const take = (): void => { if (input.value.trim()) pub.title[l] = input.value.trim(); else delete pub.title[l]; };
        if (typed !== undefined) take();
        input.addEventListener('input', () => {
            host.setDraft(key, input.value);
            take();
            refresh();
        });
        return field(t('admin.ideas.public.field', { lang: l }), input);
    });
    const group = h('select', { 'data-field': 'group', 'aria-label': t('admin.ideas.public.group') }) as HTMLSelectElement;
    group.append(h('option', { value: '' }, t('admin.ideas.public.groupNone')));
    for (const g of LANDING_GROUPS) group.append(h('option', { value: g }, t(`admin.ideas.group.${g}`)));
    group.value = pub.group ?? '';
    group.addEventListener('change', () => { pub.group = group.value || null; });
    show.addEventListener('change', () => { pub.roadmap = show.checked; });
    const save = h('button', { type: 'button', class: 'btn small primary', 'data-action': 'save-public' }, t('admin.ideas.public.save'));
    save.addEventListener('click', async () => {
        pub.roadmap = show.checked;
        if (await host.run(i.id, () => host.client.setPublic(i.id, pub), () => t('admin.ideas.public.saved'))) {
            for (const l of PUBLIC_LANGS) host.setDraft(`${i.id}:title:${l}`, undefined);
        }
    });
    refresh();
    return h('section', { class: 'idea-sec' }, h('h3', {}, t('admin.ideas.public.title')),
        h('div', { class: 'idea-grid' }, ...inputs, field(t('admin.ideas.public.group'), group)),
        h('label', { class: 'check' }, show, ' ', t('admin.ideas.public.show')), note, h('div', { class: 'bar' }, save));
}

export function field(label: string, input: HTMLElement): HTMLElement {
    return h('label', { class: 'field' }, h('span', {}, label), input);
}
