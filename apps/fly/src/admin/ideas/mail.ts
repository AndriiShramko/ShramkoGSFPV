// E-mails from the Ideas kanban. The server (lane B) sends them from the owner's Gmail, never by itself:
// - the reply form of a card: the owner's answer, queued behind the undo window (Cancel on the card while
//   it waits; the server quotes the pilot's words);
// - the thank-you when a pilot's idea is done (owner's item 7): the owner writes what was done and how in
//   the pilot's language, the server makes the e-mail as a DRAFT, the owner reads the whole e-mail and only
//   its Send queues it (again behind the undo window). Not now, Esc or Edit send nothing.
// Without Gmail set up on the server an e-mail is saved as waiting_setup and goes only after another Send:
// the owner is told what the server's answer says (mailSaid), never "queued" by default. A thank-you that
// waits for Gmail or failed is Sent again from the dialog, never written a second time.
import { h } from '../../ui/dom';
import { t } from '../i18n';
import { ApiError } from '../api';
import { PUBLIC_LANGS } from './api';
import type { Idea, IdeaMail, IdeasClient, PublicLang } from './api';
import { mailNotice, thanksPending } from './board';
import type { CardHost } from './card';

/**
 * What the owner is told about an e-mail the server just took, from its state in the answer: when it goes
 * (queued), that it is saved until Gmail is set up (waiting_setup), else its state. '' without a mail.
 */
export function mailSaid(kind: IdeaMail['kind'], m: IdeaMail | null, undoSeconds: number): string {
    if (!m) return '';
    const email = m.to || t('admin.ideas.mail.noAddress');
    switch (mailNotice(m)) {
        case 'queued': return t(kind === 'done' ? 'admin.ideas.thanks.queued' : 'admin.ideas.reply.queued', { email, s: undoSeconds });
        case 'waiting': return t(kind === 'done' ? 'admin.ideas.thanks.waiting' : 'admin.ideas.reply.waiting', { email });
        default: return t('admin.ideas.mail.now', { state: t(`admin.ideas.mail.state.${m.state}`) });
    }
}

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
    send.addEventListener('click', () => {
        const answer = text.value.trim();
        if (!answer) return text.focus();
        // the sent text leaves the box before the card is redrawn: a second click has nothing to send
        void host.run(i.id, () => host.client.reply(i.id, answer), { clear: [key], say: (a) => mailSaid('reply', a.mail, host.undoSeconds) });
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
 * whole e-mail as it will go; Send queues exactly that e-mail (a draft: POST ideas/send-done with its id;
 * one that waited for Gmail or failed: ideas/mail/send). A pending thank-you opens at step 2. When the
 * server says a newer draft replaced the one shown (409 stale-draft), the newer one is shown to read again.
 */
export function openThanks(start: Idea, host: ThanksHost): HTMLDialogElement {
    let idea = start;
    let shown: IdeaMail | null = null;
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

    const tell = (msg: string, cls: string): void => {
        status.textContent = msg;
        status.className = cls;
    };
    const fail = (e: unknown): void => tell(t('admin.ideas.error', { why: e instanceof Error ? e.message : String(e) }), 'bad');
    const showDraft = (m: IdeaMail): void => {
        shown = m;
        to.value = m.to;
        subject.value = m.subject;
        body.value = m.plain;
        step1.hidden = true;
        step2.hidden = false;
        // a new text would be a second thank-you next to one that only waits: Edit is for a draft only
        edit.hidden = m.state !== 'draft';
        if (m.state === 'draft') tell('', 'muted');
        else tell(t('admin.ideas.thanks.notSent', { state: t(`admin.ideas.mail.state.${m.state}`) }), 'warn');
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
            else tell(t('admin.ideas.thanks.noEmail'), 'warn');
        } catch (e) {
            fail(e);
        } finally {
            make.disabled = false;
        }
    });
    edit.addEventListener('click', () => { step2.hidden = true; step1.hidden = false; summary.focus(); });
    send.addEventListener('click', async () => {
        const m = shown;
        if (!m) return;
        send.disabled = true;
        try {
            const a = m.state === 'draft' ? await host.client.sendDone(idea.id, m.id) : await host.client.sendMail(m.id);
            idea = a.idea;
            host.update(idea);
            host.say(mailSaid('done', a.mail, host.undoSeconds));
            dialog.close();
        } catch (e) {
            if (e instanceof ApiError && e.status === 409 && e.reason === 'stale-draft') return void showNewer();
            fail(e);
        } finally {
            send.disabled = false;
        }
    });
    /** A newer draft replaced the one shown: fetch the idea and show what the server has now. */
    const showNewer = async (): Promise<void> => {
        try {
            idea = await host.client.get(idea.id);
            host.update(idea);
            const pending = thanksPending(idea);
            if (pending) {
                showDraft(pending);
                tell(t('admin.ideas.thanks.stale'), 'warn');
            } else {
                // sent, queued or cancelled meanwhile (Telegram, an agent): the card shows where it is
                dialog.close();
                host.say(t('admin.ideas.thanks.gone'), true);
            }
        } catch (e) {
            fail(e);
        }
    };
    later.addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => dialog.remove());
    document.body.append(dialog);
    dialog.showModal();
    const waiting = thanksPending(idea);
    if (waiting) showDraft(waiting);
    else summary.focus();
    return dialog;
}
