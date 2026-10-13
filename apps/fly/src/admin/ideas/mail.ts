// E-mails from the Ideas kanban, both sent by the server from the owner's Gmail (lane B) and only on an
// explicit click here: the reply form on a card (the owner's answer; the server quotes the pilot's words
// above it) and the thank-you dialog when a pilot's idea is done (the server drafts it in the pilot's
// language, the owner may edit it, Send sends it, Not now sends nothing).
import { h } from '../../ui/dom';
import { t } from '../i18n';
import type { Idea, IdeasClient } from './api';
import type { CardHost } from './card';

/** The reply form of an open card; without an e-mail address it only says why there is no one to write to. */
export function replyForm(i: Idea, email: string | null, host: CardHost): HTMLElement {
    const sec = h('section', { class: 'idea-sec', 'data-field': 'reply' }, h('h3', {}, t('admin.ideas.reply.title')));
    if (!email) {
        sec.append(h('p', { class: 'muted' }, t('admin.ideas.reply.noEmail')));
        return sec;
    }
    const key = `${i.id}:reply`;
    const text = h('textarea', { rows: 4, maxlength: 5000, 'data-field': 'reply-text', 'aria-label': t('admin.ideas.reply.placeholder'), placeholder: t('admin.ideas.reply.placeholder') }) as HTMLTextAreaElement;
    text.value = host.draft(key) ?? '';
    text.addEventListener('input', () => host.setDraft(key, text.value));
    const send = h('button', { type: 'button', class: 'btn small primary', 'data-action': 'reply' }, t('admin.ideas.reply.send'));
    send.addEventListener('click', async () => {
        const answer = text.value.trim();
        if (!answer) return text.focus();
        if (await host.run(i.id, () => host.client.reply(i.id, answer), () => t('admin.ideas.reply.sent', { email }))) host.setDraft(key, undefined);
    });
    sec.append(h('p', { class: 'muted' }, t('admin.ideas.reply.to', { email })), text, h('div', { class: 'bar' }, send));
    return sec;
}

/** What the thank-you dialog needs from the tab. */
export interface ThanksHost {
    readonly client: IdeasClient;
    /** the card replaced by the server's answer after the e-mail went out */
    update(i: Idea): void;
    say(msg: string, bad?: boolean): void;
}

/**
 * The thank-you dialog: asks the server for its draft (nothing is sent), shows it editable, and sends it
 * only when Send is pressed. Closing it any other way (Not now, Esc) sends nothing.
 */
export function openThanks(i: Idea, host: ThanksHost): HTMLDialogElement {
    const status = h('p', { class: 'muted', role: 'status' }, t('admin.ideas.thanks.loading'));
    const to = h('input', { type: 'text', readonly: true, 'data-field': 'thanks-to' }) as HTMLInputElement;
    const subject = h('input', { type: 'text', maxlength: 200, 'data-field': 'thanks-subject' }) as HTMLInputElement;
    const body = h('textarea', { rows: 10, maxlength: 10000, 'data-field': 'thanks-body' }) as HTMLTextAreaElement;
    const send = h('button', { type: 'button', class: 'btn primary', 'data-action': 'thanks-send', disabled: true }, t('admin.ideas.thanks.send'));
    const later = h('button', { type: 'button', class: 'btn', 'data-action': 'thanks-later' }, t('admin.ideas.thanks.later'));
    const dialog = h('dialog', { class: 'dialog', 'data-testid': 'thanks-dialog', 'aria-labelledby': 'thanks-title' },
        h('h2', { id: 'thanks-title' }, t('admin.ideas.thanks.title')),
        h('p', {}, t('admin.ideas.thanks.lead')),
        status,
        h('label', { class: 'field' }, h('span', {}, t('admin.ideas.thanks.to')), to),
        h('label', { class: 'field' }, h('span', {}, t('admin.ideas.thanks.subject')), subject),
        h('label', { class: 'field' }, h('span', {}, t('admin.ideas.thanks.body')), body),
        h('div', { class: 'bar' }, send, later)) as HTMLDialogElement;
    later.addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => dialog.remove());
    send.addEventListener('click', async () => {
        send.disabled = true;
        try {
            const done = await host.client.sendThanks(i.id, subject.value.trim(), body.value);
            host.update(done);
            host.say(t('admin.ideas.thanks.sent', { email: to.value }));
            dialog.close();
        } catch (e) {
            send.disabled = false;
            status.textContent = t('admin.ideas.error', { why: e instanceof Error ? e.message : String(e) });
            status.className = 'bad';
        }
    });
    document.body.append(dialog);
    dialog.showModal();
    void host.client.thanksDraft(i.id).then(
        (d) => {
            to.value = d.to;
            subject.value = d.subject;
            body.value = d.body;
            status.textContent = '';
            send.disabled = !d.to || !d.body.trim();
            subject.focus();
        },
        (e: unknown) => {
            status.textContent = t('admin.ideas.thanks.failed', { why: e instanceof Error ? e.message : String(e) });
            status.className = 'bad';
        }
    );
    return dialog;
}
