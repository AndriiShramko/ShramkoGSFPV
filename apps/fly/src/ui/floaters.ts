// "Clean floating voxels" (the owner's message 16: "I move the slider and do not understand what
// changes"). The floater filter (prefs scene.dropFloaters, G.3) explained where it acts: a small
// panel beside the flight view while the voxel grid previews the slider's value on the scan
// (VoxelController.previewFloaters: the pieces that would go in red, the walls that stay in grey), a
// live line of what goes, one click for a suggested value, and Apply. Closing it ends the preview:
// the scan looks as before. In Settings the row says the same line and opens the panel.
import type { FloaterPreview } from '@gsfpv/collision';
import { h } from './dom';
import { t, locale } from '../i18n';

export interface FloaterPanelHost {
    /** what the filter drops at n on this scan's walls */
    count(n: number): FloaterPreview;
    /** the value to suggest (suggestMinBlocks); 0: nothing to clean */
    suggested: number;
    /** the side of one block in the flown scan, in cm */
    blockCm: number;
    /** the filter this scan flies with now */
    applied(): number;
    /** the grid's preview at n; null ends it */
    preview(n: number | null): void;
    /** the pilot's choice, stored for this scan (the flight follows the store) */
    apply(n: number): void;
    onClose(): void;
}

const MAX = 64;
/** the grid re-colours this long after the slider stops: a drag does not ask the worker every step */
const PREVIEW_MS = 120;

const num = (n: number): string => new Intl.NumberFormat(locale).format(n);

/** "Removes floating pieces: 44 · blocks: 1 230. The big walls stay." (or why nothing goes). */
export function effectText(p: FloaterPreview): string {
    if (p.minBlocks === 0) return t('floaters.effectOff');
    if (p.pieces === 0) return t('floaters.effectNone');
    return t('floaters.effect', { pieces: num(p.pieces), blocks: num(p.blocks) });
}

export interface FloaterPanel {
    root: HTMLElement;
    /** the slider's value now */
    value(): number;
    close(): void;
}

export function floaterPanel(parent: HTMLElement, host: FloaterPanelHost): FloaterPanel {
    const start = host.applied() || host.suggested;
    const range = h('input', { type: 'range', min: 0, max: MAX, step: 1, value: start, id: 'fl-n', 'data-action': 'floaters-n', 'aria-describedby': 'fl-effect' }) as HTMLInputElement;
    const out = h('output', { class: 'fl-out', for: 'fl-n', 'data-testid': 'floaters-n' });
    const effect = h('p', { class: 'fl-effect', id: 'fl-effect', role: 'status', 'data-testid': 'floaters-effect' });
    const now = h('p', { class: 'muted small', 'data-testid': 'floaters-applied' });
    const apply = h('button', { type: 'button', class: 'btn', 'data-action': 'floaters-apply' }) as HTMLButtonElement;
    const clean = h('button', { type: 'button', class: 'btn primary', 'data-action': 'floaters-clean' }, t('floaters.clean')) as HTMLButtonElement;
    const cleanNote = h('p', { class: 'muted small fl-note' });
    const x = h('button', { type: 'button', class: 'panel-x', 'data-action': 'floaters-close', 'aria-label': t('common.close'), 'aria-keyshortcuts': 'Escape', title: `${t('common.close')} (Esc)` }, '×');
    const root = h('div', { class: 'panel interactive floaters-panel', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'fl-title', 'data-testid': 'floaters-panel' },
        h('div', { class: 'panel-head' }, h('h2', { id: 'fl-title' }, t('floaters.title')), x),
        h('p', { class: 'fl-explain' }, t('floaters.explain')),
        h('p', { class: 'fl-legend small' },
            h('span', { class: 'fl-swatch drop', 'aria-hidden': 'true' }), t('floaters.legendDrop'),
            h('span', { class: 'fl-swatch keep', 'aria-hidden': 'true' }), t('floaters.legendKeep')),
        h('label', { class: 'fl-label', for: 'fl-n' }, t('floaters.size')),
        h('div', { class: 'fl-row' }, range, out),
        h('p', { class: 'muted small' }, t('floaters.block', { cm: num(Math.round(host.blockCm * 10) / 10) })),
        effect,
        h('div', { class: 'fl-actions' }, clean, apply),
        cleanNote,
        now);

    let timer = 0;
    const render = (): void => {
        const n = Number(range.value);
        const p = host.count(n);
        out.textContent = String(n);
        const text = effectText(p);
        if (effect.textContent !== text) effect.textContent = text;
        const applied = host.applied();
        now.textContent = applied ? t('floaters.appliedNow', { n: applied }) : t('floaters.appliedOff');
        apply.disabled = n === applied;
        apply.textContent = n === applied ? t('floaters.isApplied') : n === 0 ? t('floaters.turnOff') : t('floaters.apply', { n });
        clean.disabled = host.suggested === 0 || (applied === host.suggested && n === applied);
        cleanNote.textContent = host.suggested ? t('floaters.suggested', { n: host.suggested }) : t('floaters.nothing');
    };
    const previewSoon = (): void => {
        clearTimeout(timer);
        timer = window.setTimeout(() => host.preview(Number(range.value)), PREVIEW_MS);
    };
    range.addEventListener('input', () => { render(); previewSoon(); });
    apply.addEventListener('click', () => { host.apply(Number(range.value)); render(); });
    clean.addEventListener('click', () => {
        range.value = String(host.suggested);
        host.preview(host.suggested);
        host.apply(host.suggested);
        render();
    });
    const onKey = (e: KeyboardEvent): void => {
        if (e.key !== 'Escape' || !root.isConnected) return;
        e.preventDefault();
        e.stopPropagation();
        close();
    };
    let closed = false;
    function close(): void {
        if (closed) return;
        closed = true;
        clearTimeout(timer);
        removeEventListener('keydown', onKey, true);
        root.remove();
        host.preview(null);
        host.onClose();
    }
    x.addEventListener('click', close);
    addEventListener('keydown', onKey, true);
    parent.append(root);
    host.preview(start);
    render();
    range.focus();
    return { root, value: () => Number(range.value), close };
}

/** Under the Settings row: what the value there drops now, and the panel to see it on the scan. */
export function floaterRowExtra(o: { count(n: number): FloaterPreview | null; value(): number; open(): void }): { el: HTMLElement; refresh(): void } {
    const line = h('p', { class: 'small sr-extra-line', 'data-testid': 'floaters-row-effect' });
    const show = h('button', { type: 'button', class: 'btn sr-extra-btn', 'data-action': 'floaters-open', onclick: () => o.open() }, t('floaters.show'));
    const el = h('div', { class: 'sr-extra' }, line, show);
    const refresh = (): void => {
        const p = o.count(o.value());
        line.textContent = p ? effectText(p) : t('walls.none');
        show.hidden = !p;
    };
    refresh();
    return { el, refresh };
}
