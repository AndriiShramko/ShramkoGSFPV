// The one header of every panel, window and menu of the fly page (lane uiaudit, decision U1): the panel's
// name, a collapse button where collapsing makes sense and a close button with a cross at the top right,
// each a 44 px target with a visible shape and an accessible name. Esc closes the top panel (topLayer);
// the size rule of U2 (fitInView) keeps a panel whole inside the view and scrolling inside itself.
// No dictionary here: the caller passes the words (common.close and the like).
import './panel-head.css';

/** One open panel as Esc sees it: its z-index and its place in the page (later is higher on a tie). */
export interface Layer {
    z: number;
    order: number;
}

/** The index of the top layer: the highest z-index, on a tie the later one in the page; -1 when none. */
export function topLayer(layers: readonly Layer[]): number {
    let best = -1;
    for (let i = 0; i < layers.length; i++) {
        const l = layers[i]!;
        if (best < 0) { best = i; continue; }
        const b = layers[best]!;
        if (l.z > b.z || (l.z === b.z && l.order >= b.order)) best = i;
    }
    return best;
}

export interface Box { left: number; top: number; width: number; height: number }
export interface Fit { left: number; top: number; maxWidth: number; maxHeight: number; scrolls: boolean }

/**
 * The size rule (U2): a panel is whole inside the view. It keeps its place where it fits, moves up or
 * left as far as it must, never above or left of the margin, and gets a height limit when it is taller
 * than the view: then it scrolls inside itself and its header (the close button) stays in view.
 */
export function fitInView(box: Box, view: { w: number; h: number }, margin = 8): Fit {
    const maxWidth = Math.max(0, view.w - 2 * margin);
    const maxHeight = Math.max(0, view.h - 2 * margin);
    const w = Math.min(box.width, maxWidth);
    const hgt = Math.min(box.height, maxHeight);
    const left = Math.max(margin, Math.min(box.left, view.w - margin - w));
    const top = Math.max(margin, Math.min(box.top, view.h - margin - hgt));
    return { left, top, maxWidth, maxHeight: view.h - margin - top, scrolls: box.height > view.h - margin - top };
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = ''): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    e.className = cls;
    if (text) e.textContent = text;
    return e;
}

export interface HeadWords {
    /** common.close in the page's language */
    close: string;
    /** a key that also closes it, shown in the title ("Esc", "F3") */
    key?: string;
    /** the collapse button's words when it is open and when it is folded (both or none) */
    collapse?: string;
    expand?: string;
}

export interface PanelHead {
    head: HTMLDivElement;
    close: HTMLButtonElement;
    fold: HTMLButtonElement | null;
    setFolded(folded: boolean): void;
}

/**
 * The header: name, optional collapse button, the cross. `onFold` gets the new folded state; the
 * caller hides its body. The cross carries the class panel-x, so Esc over dialogs finds it as before.
 */
export function panelHead(title: string, words: HeadWords, onClose: () => void, onFold?: (folded: boolean) => void): PanelHead {
    const head = el('div', 'panel-head ph-head');
    const name = el('h2', 'ph-title', title);
    const close = el('button', 'panel-x ph-x');
    close.type = 'button';
    close.setAttribute('aria-label', words.close);
    close.title = words.key ? `${words.close} (${words.key})` : words.close;
    close.dataset.action = 'panel-close';
    close.textContent = '×';
    close.addEventListener('click', () => onClose());
    let fold: HTMLButtonElement | null = null;
    let folded = false;
    const setFolded = (f: boolean): void => {
        folded = f;
        if (!fold) return;
        const word = f ? (words.expand ?? '') : (words.collapse ?? '');
        fold.setAttribute('aria-expanded', String(!f));
        fold.setAttribute('aria-label', word);
        fold.title = word;
        fold.textContent = f ? '▸' : '▾';
    };
    if (onFold && words.collapse && words.expand) {
        fold = el('button', 'ph-fold');
        fold.type = 'button';
        fold.dataset.action = 'panel-fold';
        fold.addEventListener('click', () => { setFolded(!folded); onFold(folded); });
        setFolded(false);
    }
    head.append(name);
    if (fold) head.append(fold);
    head.append(close);
    return { head, close, fold, setFolded };
}

/**
 * Esc over the page: clicks the close button of the top open panel among `closers` (buttons with the
 * class panel-x inside a .panel or a [data-panel] element). Returns false when none is open.
 */
export function closeTop(scope: ParentNode): boolean {
    const btns = Array.from(scope.querySelectorAll<HTMLButtonElement>('.panel .panel-x, [data-panel] .panel-x'))
        .filter((b) => b.getClientRects().length > 0 && !b.disabled);
    const layers = btns.map((b, order) => {
        const host = b.closest<HTMLElement>('.panel, [data-panel]');
        const z = host ? Number.parseInt(getComputedStyle(host).zIndex, 10) : 0;
        return { z: Number.isFinite(z) ? z : 0, order };
    });
    const i = topLayer(layers);
    if (i < 0) return false;
    btns[i]!.click();
    return true;
}
