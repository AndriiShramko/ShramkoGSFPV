// The "?" beside a setting (the owner's message 16: hovering the old "?" showed only a browser
// placeholder, "About Walls", and nothing said a click opens the text). A toggletip, the pattern a
// mouse, a keyboard, a screen reader and a finger all reach:
//   - a mouse resting on "?" shows the description after a short delay; it stays while the pointer
//     is on "?" or on the text itself (WCAG 1.4.13 hoverable), and goes when it leaves;
//   - keyboard focus on "?" shows it, and leaving takes it away;
//   - a click or a tap pins it open (aria-expanded true) until a second click, Esc, a click
//     elsewhere, or another "?" opens;
//   - Esc closes it without closing the screen under it (WCAG 1.4.13 dismissible);
//   - the button's aria-describedby names the text, so a screen reader reads it on focus;
//   - it is placed under "?" (above when there is no room) and kept inside the window. The Popover
//     API puts it in the top layer, out of the settings screen's scroll box and transform; a browser
//     without it gets the text appended to the page, fixed in the same place.
import { h } from './dom';

/** a resting pointer shows the text after this */
export const HOVER_MS = 300;
/** the pointer may cross the gap to the text in this time */
const LEAVE_MS = 200;
const GAP = 6;
const MARGIN = 8;

export type TipState = 'closed' | 'peek' | 'pinned';

let current: { close(): void } | null = null;

const popoverOk = (): boolean => typeof HTMLElement !== 'undefined' && typeof (HTMLElement.prototype as { showPopover?: unknown }).showPopover === 'function';

/** `name`: the button's accessible name ("About Walls"); `text`: the description; `id`: unique. */
export function toggletip(name: string, text: string, id: string): { button: HTMLButtonElement; bubble: HTMLElement; state(): TipState } {
    const bubble = h('div', { class: 'tip', id, role: 'tooltip', hidden: true, 'data-testid': 'tip' }, text);
    const button = h('button', { type: 'button', class: 'tip-btn', 'aria-label': name, 'aria-describedby': id, 'aria-expanded': 'false', 'data-action': 'help' }, '?') as HTMLButtonElement;
    const top = popoverOk();
    if (top) bubble.setAttribute('popover', 'manual');
    let state: TipState = 'closed';
    let enter = 0;
    let leave = 0;
    const timers = (): void => { clearTimeout(enter); clearTimeout(leave); };

    const place = (): void => {
        if (!button.isConnected) { close(); return; }
        const r = button.getBoundingClientRect();
        const vw = document.documentElement.clientWidth || innerWidth;
        const vh = document.documentElement.clientHeight || innerHeight;
        bubble.style.maxWidth = `${Math.min(320, vw - 2 * MARGIN)}px`;
        const b = bubble.getBoundingClientRect();
        const left = Math.min(Math.max(MARGIN, r.left + r.width / 2 - b.width / 2), Math.max(MARGIN, vw - MARGIN - b.width));
        let y = r.bottom + GAP;
        if (y + b.height > vh - MARGIN && r.top - GAP - b.height >= MARGIN) y = r.top - GAP - b.height;
        bubble.style.left = `${Math.round(left)}px`;
        bubble.style.top = `${Math.round(Math.max(MARGIN, y))}px`;
    };
    const onKey = (e: KeyboardEvent): void => {
        // the screen closed under an open tip: it goes too, and Esc belongs to whatever is there now
        if (!button.isConnected) { close(); return; }
        if (e.key !== 'Escape') return;
        e.preventDefault();
        e.stopPropagation();
        close();
        if (document.activeElement === document.body) button.focus();
    };
    const onDown = (e: PointerEvent): void => {
        const t = e.target as Node | null;
        if (t && (button.contains(t) || bubble.contains(t))) return;
        close();
    };

    function show(next: 'peek' | 'pinned'): void {
        timers();
        if (state === 'closed') {
            if (current && current.close !== close) current.close();
            current = { close };
            if (!top && bubble.parentElement !== document.body) document.body.append(bubble);
            bubble.hidden = false;
            if (top) (bubble as HTMLElement & { showPopover(): void }).showPopover();
            document.addEventListener('keydown', onKey, true);
            document.addEventListener('pointerdown', onDown, true);
            addEventListener('scroll', place, true);
            addEventListener('resize', place);
        }
        state = next;
        bubble.dataset.state = next;
        button.setAttribute('aria-expanded', String(next === 'pinned'));
        place();
    }

    function close(): void {
        timers();
        if (state === 'closed') return;
        state = 'closed';
        delete bubble.dataset.state;
        button.setAttribute('aria-expanded', 'false');
        if (top && bubble.matches(':popover-open')) (bubble as HTMLElement & { hidePopover(): void }).hidePopover();
        bubble.hidden = true;
        document.removeEventListener('keydown', onKey, true);
        document.removeEventListener('pointerdown', onDown, true);
        removeEventListener('scroll', place, true);
        removeEventListener('resize', place);
        if (current?.close === close) current = null;
    }

    const later = (): void => {
        clearTimeout(leave);
        if (state === 'peek') leave = window.setTimeout(close, LEAVE_MS);
    };
    button.addEventListener('pointerenter', (e) => {
        if (e.pointerType !== 'mouse') return; // a finger has no hover: the tap opens it
        clearTimeout(leave);
        if (state === 'closed') enter = window.setTimeout(() => show('peek'), HOVER_MS);
    });
    button.addEventListener('pointerleave', () => { clearTimeout(enter); later(); });
    bubble.addEventListener('pointerenter', () => clearTimeout(leave));
    bubble.addEventListener('pointerleave', later);
    button.addEventListener('focus', () => { if (button.matches(':focus-visible') && state === 'closed') show('peek'); });
    button.addEventListener('blur', () => { if (state === 'peek') close(); });
    button.addEventListener('click', () => (state === 'pinned' ? close() : show('pinned')));
    return { button, bubble, state: () => state };
}
