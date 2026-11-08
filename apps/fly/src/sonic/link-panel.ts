// The lesson's link in a field of its own (v12-optin review R1, R3): what the mode's Share shows when the browser refuses the
// clipboard (a pilot alone presses Control and C; the field has the focus and the whole link is selected, so a screen reader reads
// it) and what the visible Share shows a helper or a phone. A panel over the flight, which waits under it; Esc and x close it and
// the focus goes back. Outside the captions on purpose: they may be off, and a caption line goes after 12 s. The link is never
// written into a page field that other code reads (share/clipboard.ts copies through a scratch area of its own).
import { h, panel } from '../ui/dom';
import { t } from '../i18n';
import { copyText } from '../share/clipboard';
import './sonic.css';

/** Where the panel goes and what it holds while it is up (the flight's pause). */
export interface LinkPanelHost {
    readonly parent: HTMLElement;
    onOpen(): void;
    onClose(): void;
}

/** The panel's words: its title, and the copy keys' words for "press ... to copy it". */
export interface LinkPanelText {
    readonly title: string;
    readonly copyKeys: string;
}

/** Opens the panel with `url` selected in its field (one at a time: null when one is up already). */
export function openLinkPanel(host: LinkPanelHost, url: string, copied: boolean, text: LinkPanelText): { close(): void } | null {
    if (document.querySelector('.panel.sonic-link')) return null;
    let closed = false;
    const back = document.activeElement as HTMLElement | null;
    const close = (): void => {
        if (closed) return;
        closed = true;
        p.close();
        host.onClose();
        if (back?.isConnected) back.focus({ preventScroll: true });
    };
    const p = panel(text.title, close);
    p.root.classList.add('sonic-link');
    p.root.dataset.testid = 'sonic-link';
    p.root.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        e.stopPropagation();
        close();
    });
    const said = (ok: boolean): string => (ok ? t('sonic.link.copied') : t('sonic.link.select', { copy: text.copyKeys }));
    const status = h('p', { class: 'share-status', id: 'sonic-link-status', role: 'status', 'data-testid': 'sonic-link-status' }, said(copied));
    const field = h('input', { type: 'text', class: 'share-url', readonly: true, value: url, 'aria-label': t('sonic.link.field'), 'aria-describedby': 'sonic-link-status', 'data-testid': 'sonic-link-url' }) as HTMLInputElement;
    const select = (): void => {
        field.focus({ preventScroll: true });
        field.select();
    };
    const copy = h('button', { type: 'button', class: 'btn', 'data-action': 'sonic-link-copy', onclick: () => void copyText(url).then((ok) => {
        status.textContent = said(ok);
        select();
    }) }, t('share.copy'));
    // a phone's share sheet, where the browser has one (the lesson's link in it, no picture)
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    const native = typeof nav.share === 'function' ? h('button', { type: 'button', class: 'btn', 'data-action': 'sonic-link-native', onclick: () => void nav.share?.({ title: text.title, url }).catch(() => undefined) }, t('share.native')) : null;
    p.body.append(field, status, h('div', { class: 'share-targets' }, copy, native));
    host.onOpen();
    host.parent.append(p.root);
    select();
    return { close };
}
