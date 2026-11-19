// The Messages list (lane ux4a, complaint U1: "a problem must say what it is and whom to tell"): every line the
// message service (ui/messages.ts) showed, newest first, with its time and kind; a problem keeps what to do and a
// "Send to the author" button. Opened by Shift+H (action messages.open, app/builtin/hud.ts), by the top-row button
// (messagesButton, app/builtin/top.ts) and by the "+N more in Messages" line of the stack. Esc and its 44 px cross
// close it (app/builtin/pause.ts closeTop finds the .panel-x).
import { h } from './dom';
import { t, locale } from '../i18n';
import { dialogOpen } from '../devices/keyboard';
import { messages, type MessageCenter } from './messages';
import type { LoggedMessage, MessageKind } from '../messages-logic';
import type { KeyHint } from '@gsfpv/prefs';

/** What the list needs from the flight page: where it goes, and the pause while it is up (the mouse is free to click). */
export interface MessagesHost {
    parent: HTMLElement;
    pause(): void;
    resume(): void;
}

const ICON: Record<MessageKind, string> = { info: 'i', done: '✓', problem: '!', progress: '…' };

const SELECTOR = '.panel.messages-panel';

/** The clock time of a message (its `at` is on the performance clock). */
function clock(e: LoggedMessage): string {
    const ms = (typeof performance.timeOrigin === 'number' ? performance.timeOrigin : Date.now() - performance.now()) + e.at;
    return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(ms));
}

function item(e: LoggedMessage, center: MessageCenter, close: () => void): HTMLLIElement {
    const kind = t(`messages.kind.${e.kind}`);
    const li = h('li', { class: `msg-item msg-${e.kind}`, 'data-kind': e.kind, 'data-id': e.id },
        h('span', { class: 'msg-icon', 'aria-hidden': 'true' }, ICON[e.kind]),
        h('div', { class: 'msg-body' },
            h('div', { class: 'msg-meta muted small' }, `${clock(e)} · ${kind}`),
            h('div', { class: 'msg-text' }, e.text),
            e.fix ? h('div', { class: 'msg-fix' }, e.fix) : null,
            e.kind === 'problem' && center.canReport
                ? h('button', { type: 'button', class: 'btn msg-send', 'data-action': 'message-send', onclick: () => { close(); center.report(e); } }, t('messages.send'))
                : null));
    return li;
}

/** Opens the list (one at a time); returns its root. */
export function openMessages(host: MessagesHost, center: MessageCenter = messages): HTMLElement {
    const open = host.parent.querySelector<HTMLElement>(SELECTOR);
    if (open) return open;
    const list = h('ul', { class: 'msg-list', 'data-testid': 'messages-list' });
    const empty = h('p', { class: 'muted' }, t('messages.empty'));
    let unwatch = (): void => undefined;
    const close = (): void => {
        unwatch();
        root.remove();
        host.resume();
    };
    const x = h('button', { type: 'button', class: 'panel-x', 'data-action': 'messages-close', 'aria-label': t('common.close'), 'aria-keyshortcuts': 'Escape', title: `${t('common.close')} (Esc)`, onclick: close }, '×');
    const root = h('div', { class: 'panel interactive messages-panel', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'msg-title', tabindex: -1, 'data-testid': 'messages-panel' },
        h('div', { class: 'panel-head' }, h('h2', { id: 'msg-title' }, t('messages.title')), x),
        empty, list);
    const fill = (): void => {
        const all = center.log.all();
        list.replaceChildren(...all.map((e) => item(e, center, close)));
        empty.hidden = all.length > 0;
        // a problem that comes while the list is up is seen here
        if (center.log.unreadProblems() > 0) center.markRead();
    };
    host.pause();
    host.parent.append(root);
    fill();
    unwatch = center.watch(fill);
    root.focus();
    return root;
}

/** Shift+H and the top-row button: a second press closes the list; over another window it does nothing (that window has the keys). */
export function toggleMessages(host: MessagesHost, center: MessageCenter = messages): boolean {
    const open = host.parent.querySelector<HTMLElement>(SELECTOR);
    if (open) { open.querySelector<HTMLButtonElement>('.panel-x')?.click(); return true; }
    if (dialogOpen()) return false;
    openMessages(host, center);
    return true;
}

/** The top-row button: an icon with the count of problems not read yet; its name says the key. */
export function messagesButton(host: MessagesHost, caps: readonly KeyHint[], center: MessageCenter = messages): HTMLButtonElement {
    const count = h('span', { class: 'msg-count', 'data-testid': 'messages-unread', hidden: true });
    const btn = h('button', { type: 'button', class: 'btn icon msg-top', 'data-action': 'messages-open', 'aria-keyshortcuts': caps.map((c) => c.aria).join(' ') || undefined, onclick: () => openMessages(host, center) },
        h('span', { class: 'msg-top-icon', 'aria-hidden': 'true' }, '✉'), count);
    const paint = (): void => {
        const n = center.log.unreadProblems();
        count.hidden = n === 0;
        count.textContent = String(n);
        const keys = caps.length ? ` (${caps.map((c) => c.cap).join(', ')})` : '';
        const name = `${t('messages.title')}${keys}${n > 0 ? `: ${t('messages.unread', { n })}` : ''}`;
        btn.setAttribute('aria-label', name);
        btn.title = name;
    };
    paint();
    center.watch(paint);
    return btn;
}
