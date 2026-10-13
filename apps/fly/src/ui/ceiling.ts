// "Ignore collisions above" (v0.7 lane E, the owner's item 10: a pilot crashed into floating sky
// splats). A small panel beside the flight view (the flight goes on, so the pilot can fly to the sky
// specks) with a slider for the height above the start, the voxel grid previewing it on the scan (the
// voxels above in violet: no longer walls; a translucent plane at the height), a live line of how many
// blocks of the walls go, and Apply, Off and the scan's own height. Closing it ends the preview.
// app/builtin/ceiling.ts turns heights above the start into the scan's own coordinates and back.
import { h } from './dom';
import { t, locale } from '../i18n';
import './ceiling.css';

export interface CeilingPanelHost {
    /** the slider's range and step, metres above the start in the flown scene */
    range: { lo: number; hi: number; step: number };
    /** the scan's own ceiling (the admin's), metres above the start; null: it has none */
    sceneDefault: number | null;
    /** the ceiling flown now, metres above the start; null: none */
    applied(): number | null;
    /** blocks of the walls above a ceiling at h, and the walls' blocks in all */
    count(h: number): { above: number; total: number };
    /** the grid's preview at h; null ends it */
    preview(h: number | null): void;
    /** the pilot's choice for this scan: a height, none ('off'), or the scan's own ('scene') */
    apply(choice: number | 'off' | 'scene'): void;
    onClose(): void;
}

export interface CeilingPanel {
    root: HTMLElement;
    /** the slider's value now, metres above the start */
    value(): number;
    close(): void;
}

/** the grid re-colours this long after the slider stops: a drag does not ask the worker every step */
const PREVIEW_MS = 120;

const num = (n: number, digits = 1): string => new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);

/** "1 230 of 56 789 blocks of the walls are above: they are no longer walls" (or that none are). */
export function ceilingEffectText(c: { above: number; total: number }): string {
    if (c.above === 0) return t('ceiling.effectNone');
    return t('ceiling.effect', { above: new Intl.NumberFormat(locale).format(c.above), total: new Intl.NumberFormat(locale).format(c.total) });
}

/** "Now: collisions ignored above 12.5 m (above the start)", or that every voxel is a wall. */
export function ceilingNowText(applied: number | null): string {
    return applied === null ? t('ceiling.appliedOff') : t('ceiling.appliedNow', { h: num(applied) });
}

export function ceilingPanel(parent: HTMLElement, host: CeilingPanelHost): CeilingPanel {
    const { lo, hi, step } = host.range;
    const clampH = (v: number): number => Math.min(hi, Math.max(lo, v));
    // where the slider starts: the ceiling flown, else the scan's own, else 10 m over the start
    const start = clampH(host.applied() ?? host.sceneDefault ?? Math.min(hi, 10));
    const range = h('input', { type: 'range', min: lo, max: hi, step, value: start, id: 'ce-h', 'data-action': 'ceiling-h', 'aria-describedby': 'ce-effect' }) as HTMLInputElement;
    const out = h('output', { class: 'fl-out', for: 'ce-h', 'data-testid': 'ceiling-h' });
    const effect = h('p', { class: 'fl-effect', id: 'ce-effect', role: 'status', 'data-testid': 'ceiling-effect' });
    const now = h('p', { class: 'muted small', 'data-testid': 'ceiling-applied' });
    const apply = h('button', { type: 'button', class: 'btn primary', 'data-action': 'ceiling-apply' }) as HTMLButtonElement;
    const off = h('button', { type: 'button', class: 'btn', 'data-action': 'ceiling-off' }, t('ceiling.off')) as HTMLButtonElement;
    const scene = host.sceneDefault === null ? null : h('button', { type: 'button', class: 'btn', 'data-action': 'ceiling-scene' }, t('ceiling.sceneDefault', { h: num(host.sceneDefault) })) as HTMLButtonElement;
    const x = h('button', { type: 'button', class: 'panel-x', 'data-action': 'ceiling-close', 'aria-label': t('common.close'), 'aria-keyshortcuts': 'Escape', title: `${t('common.close')} (Esc)` }, '×');
    const root = h('div', { class: 'panel interactive floaters-panel ceiling-panel', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'ce-title', tabindex: -1, 'data-testid': 'ceiling-panel' },
        h('div', { class: 'panel-head' }, h('h2', { id: 'ce-title' }, t('ceiling.title')), x),
        h('p', { class: 'fl-explain' }, t('ceiling.explain')),
        h('p', { class: 'fl-legend small' },
            h('span', { class: 'fl-swatch ceiling-above', 'aria-hidden': 'true' }), t('ceiling.legendAbove'),
            h('span', { class: 'fl-swatch keep', 'aria-hidden': 'true' }), t('ceiling.legendWall'),
            h('span', { class: 'fl-swatch drop ceiling-speck', 'aria-hidden': 'true' }), t('ceiling.legendSpeck')),
        h('label', { class: 'fl-label', for: 'ce-h' }, t('ceiling.height')),
        h('div', { class: 'fl-row' }, range, out),
        effect,
        h('div', { class: 'fl-actions' }, apply, off, scene),
        now);

    let timer = 0;
    const value = (): number => clampH(Number(range.value));
    const render = (): void => {
        const v = value();
        out.textContent = t('ceiling.value', { h: num(v) });
        const text = ceilingEffectText(host.count(v));
        if (effect.textContent !== text) effect.textContent = text;
        const applied = host.applied();
        now.textContent = ceilingNowText(applied);
        const same = applied !== null && Math.abs(applied - v) < step / 2;
        apply.disabled = same;
        apply.textContent = same ? t('ceiling.isApplied') : t('ceiling.apply', { h: num(v) });
        off.disabled = applied === null;
    };
    const previewSoon = (): void => {
        clearTimeout(timer);
        timer = window.setTimeout(() => host.preview(value()), PREVIEW_MS);
    };
    range.addEventListener('input', () => { render(); previewSoon(); });
    apply.addEventListener('click', () => { host.apply(value()); render(); });
    off.addEventListener('click', () => { host.apply('off'); render(); });
    scene?.addEventListener('click', () => {
        range.value = String(clampH(host.sceneDefault!));
        host.preview(value());
        host.apply('scene');
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
    root.focus({ preventScroll: true });
    return { root, value, close, };
}

/** Under the Settings row: what is ignored now, and the panel to set and see the height. */
export function ceilingRowExtra(o: { applied(): number | null; hasWalls(): boolean; open(): void }): { el: HTMLElement; refresh(): void } {
    const line = h('p', { class: 'small sr-extra-line', 'data-testid': 'ceiling-row-line' });
    const show = h('button', { type: 'button', class: 'btn sr-extra-btn', 'data-action': 'ceiling-open', onclick: () => o.open() }, t('ceiling.show'));
    const el = h('div', { class: 'sr-extra' }, line, show);
    const refresh = (): void => {
        const walls = o.hasWalls();
        line.textContent = walls ? ceilingNowText(o.applied()) : t('walls.none');
        show.hidden = !walls;
    };
    refresh();
    return { el, refresh };
}
