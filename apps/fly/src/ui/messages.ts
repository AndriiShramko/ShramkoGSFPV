// The one message service of the flight page (lane ux4a, complaint U1). Every line for the pilot goes through
// tell(): Hud.flash (ui/hud.ts) calls it for the old callers, a feature with a problem calls
// tell({ kind: 'problem', from, text, fix }). The rules (how long, which lines, the last 50) are in
// messages-logic.ts; this file draws them. The stack keeps class hud-note, so the top row (ui/top-row.ts) and the
// course's lap block (course/hud.ts, course/note-slot.ts) keep measuring it as the one note at the top.
import { h } from './dom';
import { t } from '../i18n';
import { MessageLog, messagePlace, reportText } from '../messages-logic';
import type { LoggedMessage, PilotMessage } from '../messages-logic';

export type { MessageKind, PilotMessage } from '../messages-logic';

/** Draws the lines of the log at the top of the flight view; one per page (the `messages` singleton below). */
export class MessageCenter {
    readonly log = new MessageLog();
    /** the stack: class hud-note (measured by the top row and the course hud), hidden when no line is on the screen */
    readonly root = h('div', { class: 'hud-note msg-stack', role: 'status', 'aria-live': 'polite', hidden: true });
    private lines = new Map<number, HTMLDivElement>();
    /** the '+N more in Messages' line: a button that opens the list (ui/messages-panel.ts sets openList) */
    private more = h('button', { type: 'button', class: 'msg-more interactive', 'data-action': 'messages-more', hidden: true, onclick: () => this.openList?.() });
    /** opens the Messages list (ui/messages-panel.ts) */
    openList: (() => void) | null = null;
    private timer = 0;
    private parent: HTMLElement | null = null;
    private reporter: ((text: string) => void) | null = null;
    private scene: () => string | undefined = () => undefined;
    /** listeners of a change in the log (the Messages list, the count on its button) */
    private watchers = new Set<() => void>();

    /** Put the stack on the page (once); from then on every message is drawn. */
    mount(parent: HTMLElement): void {
        if (this.parent === parent) return;
        // a second mount (the Node tests build the page more than once) moves the stack
        if (!this.parent && typeof window !== 'undefined') window.addEventListener('resize', () => this.render());
        this.parent = parent;
        parent.append(this.root);
        this.render();
    }

    /** "Send to the author" opens the report form with this text (app/builtin/hud.ts gives openFeedback). */
    setReporter(fn: ((text: string) => void) | null): void {
        this.reporter = fn;
        this.render(true);
    }

    /** The scene id written into every message (for the report). */
    setScene(fn: () => string | undefined): void {
        this.scene = fn;
    }

    /** Called after every change of the log. */
    watch(fn: () => void): () => void {
        this.watchers.add(fn);
        return () => this.watchers.delete(fn);
    }

    tell(m: PilotMessage): LoggedMessage {
        const e = this.log.add(m, performance.now(), this.scene());
        this.render();
        return e;
    }

    /** The list was opened: no problem counts as unread (the count on the top-row button). */
    markRead(): void {
        this.log.markRead();
        for (const w of this.watchers) w();
    }

    close(id: number): void {
        this.log.close(id);
        this.render();
    }

    /** Opens the report form with a message's text, what to do, its feature and scene. */
    report(e: LoggedMessage): void {
        this.reporter?.(reportText(e));
    }

    get canReport(): boolean {
        return this.reporter !== null;
    }

    private render(rebuild = false): void {
        for (const w of this.watchers) w();
        if (!this.parent) return;
        if (rebuild) { for (const el of this.lines.values()) el.remove(); this.lines.clear(); }
        const now = performance.now();
        const { lines, more } = this.log.visible(now);
        const keep = new Set(lines.map((e) => e.id));
        for (const [id, el] of this.lines) if (!keep.has(id)) { el.remove(); this.lines.delete(id); }
        for (const e of lines) {
            const el = this.lines.get(e.id) ?? this.lineFor(e);
            this.fill(el, e);
            this.root.append(el); // in the order of visible(): problems first, then the newest
        }
        this.root.append(this.more);
        this.root.hidden = lines.length === 0;
        if (typeof window === 'undefined') return; // a page without a window (the Node tests' DOM): kept, not placed
        const place = messagePlace(window.innerWidth, window.innerHeight);
        this.root.classList.toggle('msg-side', place.side);
        // older lines fold into the "+N" line while the stack's bottom is below its limit (never the first line)
        let folded = 0;
        for (const e of lines) this.lines.get(e.id)!.hidden = false;
        for (let i = lines.length - 1; i > 0 && this.root.getBoundingClientRect().bottom > place.maxBottom; i--) {
            this.lines.get(lines[i].id)!.hidden = true;
            folded++;
        }
        const n = more + folded;
        this.more.hidden = n === 0;
        if (n > 0) this.more.textContent = t('messages.more', { n });
        this.schedule(now);
    }

    private schedule(now: number): void {
        clearTimeout(this.timer);
        const next = this.log.nextChange(now);
        if (Number.isFinite(next)) this.timer = window.setTimeout(() => this.render(), Math.max(50, next - now + 20));
    }

    private lineFor(e: LoggedMessage): HTMLDivElement {
        const el = h('div', { class: 'msg interactive', 'data-id': e.id });
        // the pointer (or a finger) on a line stops its time; a problem has no time
        el.addEventListener('pointerenter', () => { this.log.pause(e.id, performance.now()); this.schedule(performance.now()); });
        el.addEventListener('pointerleave', () => { this.log.resume(e.id, performance.now()); this.schedule(performance.now()); });
        this.lines.set(e.id, el);
        return el;
    }

    /** (Re)writes a line: its kind may change in place (progress -> done -> problem under one key). */
    private fill(el: HTMLDivElement, e: LoggedMessage): void {
        const sig = `${e.kind}\u0000${e.text}\u0000${e.fix ?? ''}`;
        if (el.dataset.sig === sig) return;
        el.dataset.sig = sig;
        el.dataset.kind = e.kind;
        if (e.key) el.dataset.key = e.key; else delete el.dataset.key;
        el.className = `msg msg-${e.kind} interactive`;
        el.setAttribute('role', e.kind === 'problem' ? 'alert' : 'none');
        el.replaceChildren();
        const body = h('div', { class: 'msg-body' }, h('div', { class: 'msg-text' }, e.text));
        el.append(body);
        if (e.kind !== 'problem') return;
        if (e.fix) body.append(h('div', { class: 'msg-fix' }, e.fix));
        if (this.reporter) body.append(h('button', { type: 'button', class: 'btn msg-send', 'data-action': 'message-send', onclick: () => this.report(e) }, t('messages.send')));
        el.append(h('button', { type: 'button', class: 'panel-x msg-x', 'data-action': 'message-close', 'aria-label': t('messages.close'), title: t('messages.close'), onclick: () => this.close(e.id) }, '×'));
    }
}

/** The page's one message service. */
export const messages = new MessageCenter();

/** Says something to the pilot: the one way every feature writes a line on the flight view (before the page is up it is only logged). */
export function tell(m: PilotMessage | string): void {
    messages.tell(typeof m === 'string' ? { text: m } : m);
}
