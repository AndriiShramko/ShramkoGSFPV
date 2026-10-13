// E-mails from the Ideas kanban. The server (lane B) sends them from the owner's Gmail, never by itself:
// - the reply form of a card: the owner's answer, queued behind the undo window (Cancel on the card while
//   it waits; the server quotes the pilot's words);
// - the thank-you when a pilot's idea is done (owner's item 7): the owner writes what was done and how in
//   the pilot's language, the server makes the e-mail as a DRAFT, the owner reads the whole e-mail and only
//   its Send queues it (again behind the undo window). Not now, Esc or Edit send nothing.
import { h } from '../../ui/dom';
import { t } from '../i18n';
import { PUBLIC_LANGS } from './api';
import type { Idea, IdeaMail, IdeasClient, PublicLang } from './api';
import { thanksDraft } from './board';
import type { CardHost } from './card';

/** The reply form of an open card; without an e-mail address it only says why there is no one to write to. */
export function replyForm(i: Idea, host: CardHost): HTMLElement {
    const sec = h('section', { class: 'idea-sec', 'data-field': 'reply' }, h('h3', {}, t('admin.ideas.reply.title')));
    if (!i.email) {
        sec.append(h('p', { class: 'muted' }, t('admin.ideas.reply.noEmail')));
        return sec;
    }
    const key = `${i.id}:reply`;
    const text = h('textarea', { rows: 4, maxlength: 4000, 'data-field': 'reply-text', 'aria-label': t('admin.ideas.reply.placeholder'), placeholder: t('admin.ideas.reply.placeholder') }) as HTMLTextAreaElement;
    text.value = host.draft(key) ?? '';
    text.addEventListener('input', () => host.setDraft(key, text.value));
    const send = h('button', { type: 'button', class: 'btn small primary', 'data-action': 'reply' }, t('admin.ideas.reply.send'));
    send.addEventListener('click', async () => {
        const answer = text.value.trim();
        if (!answer) return text.focus();
        const ok = await host.run(i.id, () => host.client.reply(i.id, answer), () => t('admin.ideas.reply.queued', { email: i.email, s: host.undoSeconds }));
        if (ok) host.setDraft(key, undefined);
    });
    sec.append(h('p', { class: 'muted' }, t('admin.ideas.reply.to', { email: i.email })), text, h('div', { class: 'bar' }, send));
    return sec;
}

/** What the thank-you dialog needs from the tab. */
export interface ThanksHost {
    readonly client: IdeasClient;
    readonly undoSeconds: number;
    /** the card replaced by the server's answer */
    update(i: Idea): void;
    say(msg: string, bad?: boolean): void;
}

/** The pilot's language when the dictionaries have it, else English. */
const pilotLang = (i: Idea): PublicLang => ((PUBLIC_LANGS as readonly string[]).includes(i.locale) ? (i.locale as PublicLang) : 'en');

/**
 * The thank-you dialog. Step 1: what was done and how, in the pilot's language (the summary the server
 * keeps); "Make the e-mail" asks the server for the draft (POST ideas/done, nothing is sent). Step 2: the
 * whole e-mail as it will go; Send queues it (POST ideas/send-done). A draft already waiting opens at step 2.
 */
export function openThanks(start: Idea, host: ThanksHost): HTMLDialogElement {
    let idea = start;
    const lang = pilotLang(idea);
    const status = h('p', { class: 'muted', role: 'status', 'data-field': 'thanks-status' });
    const summary = h('textarea', { rows: 6, maxlength: 2000, 'data-field': 'thanks-summary' }) as HTMLTextAreaElement;
    summary.value = idea.summary[lang] ?? '';
    const make = h('button', { type: 'button', class: 'btn primary', 'data-action': 'thanks-make' }, t('admin.ideas.thanks.make'));
    const step1 = h('div', { 'data-step': 'summary' },
        h('label', { class: 'field' }, h('span', {}, t('admin.ideas.thanks.summaryLabel', { lang })), summary),
        h('div', { class: 'bar' }, make));
    const to = h('input', { type: 'text', readonly: true, 'data-field': 'thanks-to' }) as HTMLInputElement;
    const subject = h('input', { type: 'text', readonly: true, 'data-field': 'thanks-subject' }) as HTMLInputElement;
    const body = h('textarea', { rows: 12, readonly: true, 'data-field': 'thanks-body' }) as HTMLTextAreaElement;
    const send = h('button', { type: 'button', class: 'btn primary', 'data-action': 'thanks-send' }, t('admin.ideas.thanks.send'));
    const edit = h('button', { type: 'button', class: 'btn', 'data-action': 'thanks-edit' }, t('admin.ideas.thanks.edit'));
    const step2 = h('div', { 'data-step': 'draft', hidden: true },
        h('label', { class: 'field' }, h('span', {}, t('admin.ideas.thanks.to')), to),
        h('label', { class: 'field' }, h('span', {}, t('admin.ideas.thanks.subject')), subject),
        h('label', { class: 'field' }, h('span', {}, t('admin.ideas.thanks.body')), body),
        h('div', { class: 'bar' }, send, edit));
    const later = h('button', { type: 'button', class: 'btn', 'data-action': 'thanks-later' }, t('admin.ideas.thanks.later'));
    const dialog = h('dialog', { class: 'dialog', 'data-testid': 'thanks-dialog', 'aria-labelledby': 'thanks-title' },
        h('h2', { id: 'thanks-title' }, t('admin.ideas.thanks.title')),
        h('p', {}, t('admin.ideas.thanks.lead')),
        step1, step2, status, h('div', { class: 'bar' }, later)) as HTMLDialogElement;

    const fail = (e: unknown): void => {
        status.textContent = t('admin.ideas.error', { why: e instanceof Error ? e.message : String(e) });
        status.className = 'bad';
    };
    const showDraft = (d: IdeaMail): void => {
        to.value = d.to;
        subject.value = d.subject;
        body.value = d.plain;
        step1.hidden = true;
        step2.hidden = false;
        status.textContent = '';
        send.focus();
    };
    make.addEventListener('click', async () => {
        const text = summary.value.trim();
        if (!text) return summary.focus();
        make.disabled = true;
        try {
            const r = await host.client.done(idea.id, { [lang]: text });
            idea = r.idea;
            host.update(idea);
            if (r.draft) showDraft(r.draft);
            else { status.textContent = t('admin.ideas.thanks.noEmail'); status.className = 'warn'; }
        } catch (e) {
            fail(e);
        } finally {
            make.disabled = false;
        }
    });
    edit.addEventListener('click', () => { step2.hidden = true; step1.hidden = false; summary.focus(); });
    send.addEventListener('click', async () => {
        send.disabled = true;
        try {
            const done = await host.client.sendDone(idea.id);
            host.update(done);
            host.say(t('admin.ideas.thanks.queued', { email: to.value, s: host.undoSeconds }));
            dialog.close();
        } catch (e) {
            send.disabled = false;
            fail(e);
        }
    });
    later.addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => dialog.remove());
    document.body.append(dialog);
    dialog.showModal();
    const waiting = thanksDraft(idea);
    if (waiting) showDraft(waiting);
    else summary.focus();
    return dialog;
}
