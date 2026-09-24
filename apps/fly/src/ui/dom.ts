// Minimal DOM helpers for the simulator UI (no framework in the hot app).

type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    attrs: Record<string, string | number | boolean | EventListener | undefined> = {},
    ...children: Child[]
): HTMLElementTagNameMap[K] {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (v === undefined || v === false) continue;
        if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
        else if (k === 'class') el.className = String(v);
        else if (v === true) el.setAttribute(k, '');
        else el.setAttribute(k, String(v));
    }
    for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(typeof c === 'string' ? document.createTextNode(c) : c);
    return el;
}

export function clear(el: Element): void {
    while (el.firstChild) el.firstChild.remove();
}

/** A modal panel over the flight view; returns the panel element. */
export function panel(title: string, onClose?: () => void): { root: HTMLDivElement; body: HTMLDivElement; close: () => void } {
    const body = h('div', { class: 'panel-body' });
    const closeBtn = onClose ? h('button', { class: 'panel-x', type: 'button', 'aria-label': 'Close', onclick: () => onClose() }, '×') : null;
    const root = h('div', { class: 'panel interactive', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, h('div', { class: 'panel-head' }, h('h2', {}, title), closeBtn), body);
    return { root, body, close: () => root.remove() };
}

export function fmt(n: number, digits = 1): string {
    return Number.isFinite(n) ? n.toFixed(digits) : '—';
}
