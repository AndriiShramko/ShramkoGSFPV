// Walls switch and voxel grid controls: the same block in the walls menu (the "Walls 5 cm ▾" line
// on the credit) and in Settings, plus the legend chip at the top right while the grid is shown.
// Everything applies at once; C and V do the same from the keyboard (main.ts).
import { h } from './dom';
import { t } from '../i18n';
import { VOXEL_MODES, VOXEL_STYLES } from '../voxels';
import type { VoxelController, VoxelMode, VoxelStyle } from '../voxels';

/** The pilot's walls switch for this scan (main.ts owns the flight side of it). */
export interface WallsSwitch {
    /** the scan has walls at all */
    has(): boolean;
    on(): boolean;
    set(on: boolean): void;
    /** showcase.json says "walls": "off" for this scan */
    adminOff: boolean;
}

const pct = (a: number): number => Math.round(a * 100);

/** One line about what the grid shows now, or why it shows nothing. */
export function voxelStatus(v: VoxelController): string {
    const s = v.stats();
    if (s.state === 'no-walls') return t('voxels.noWalls');
    if (s.state === 'failed') return t('voxels.failed', { msg: (s.error ?? '').slice(0, 120) });
    if (s.state === 'off') return t('voxels.keys');
    if (s.state === 'preparing') return t('voxels.preparing');
    const reach = Math.max(1, Math.round(s.radiusM));
    const line = t('voxels.status', { m: reach, k: Math.round(s.quads / 1000), cm: s.voxelCm ?? '—' });
    // the floater filter (G.3): what it dropped, or where to drop the pieces the grid highlights
    const dropped = s.dropped ? t('voxels.dropped', { pieces: s.dropped.pieces, n: s.dropped.minBlocks }) : '';
    if (s.floaters > 0) return [line, t('voxels.floaters', { n: s.floaters }), dropped || t('voxels.dropHint')].join(' · ');
    return dropped ? `${line} · ${dropped}` : line;
}

/**
 * The walls switch and the voxel controls. `id` keeps label ids unique when the block is on the
 * page twice (walls menu and settings).
 */
export function wallsVoxelsControls(v: VoxelController, walls: WallsSwitch, id: string, cleanFloaters?: () => void): HTMLElement {
    const sw = h('button', { type: 'button', class: 'wv-switch', role: 'switch', 'aria-checked': 'true', 'aria-keyshortcuts': 'C', 'data-action': 'walls-toggle', 'aria-labelledby': `${id}-walls` },
        h('span', { class: 'wv-knob', 'aria-hidden': 'true' }), h('span', { class: 'wv-state' })) as HTMLButtonElement;
    sw.addEventListener('click', () => walls.set(!walls.on()));
    const wallsNote = h('p', { class: 'wv-note', 'data-testid': 'walls-note' });

    const seg = h('div', { class: 'wv-seg', role: 'radiogroup', 'aria-labelledby': `${id}-show` });
    const modeBtns = VOXEL_MODES.map((m) => {
        const b = h('button', { type: 'button', role: 'radio', 'aria-checked': 'false', 'data-action': `voxels-mode-${m}`, 'data-mode': m }, t(`voxels.mode.${m}`)) as HTMLButtonElement;
        b.addEventListener('click', () => v.setMode(m as VoxelMode));
        seg.append(b);
        return b;
    });
    const style = h('select', { 'data-action': 'voxels-style', 'aria-labelledby': `${id}-style` }) as HTMLSelectElement;
    for (const s of VOXEL_STYLES) style.append(h('option', { value: s }, t(`voxels.style.${s}`)));
    style.addEventListener('change', () => v.setStyle(style.value as VoxelStyle));
    const op = h('input', { type: 'range', min: 5, max: 100, step: 5, 'data-action': 'voxels-opacity', 'aria-labelledby': `${id}-opacity` }) as HTMLInputElement;
    const opOut = h('output', { class: 'wv-out' });
    op.addEventListener('input', () => v.setOpacity(Number(op.value) / 100));
    const status = h('p', { class: 'wv-note', role: 'status', 'data-testid': 'voxels-status' });
    // the floater filter, explained on the scan (ui/floaters.ts)
    const clean = cleanFloaters ? h('button', { type: 'button', class: 'btn wv-clean', 'data-action': 'floaters-open', onclick: () => cleanFloaters() }, t('floaters.open')) as HTMLButtonElement : null;

    const root = h('div', { class: 'wv', 'data-testid': `walls-voxels-${id}` },
        h('div', { class: 'wv-row' }, h('span', { id: `${id}-walls`, class: 'wv-label' }, t('walls.switch')), sw, h('kbd', { 'aria-hidden': 'true' }, 'C')),
        wallsNote,
        h('div', { class: 'wv-row wv-head' }, h('span', { id: `${id}-show`, class: 'wv-label' }, t('voxels.title')), h('kbd', { 'aria-hidden': 'true' }, 'V')),
        seg,
        h('div', { class: 'wv-row' }, h('span', { id: `${id}-style`, class: 'wv-label' }, t('voxels.style')), style),
        h('div', { class: 'wv-row' }, h('span', { id: `${id}-opacity`, class: 'wv-label' }, t('voxels.opacity')), op, opOut),
        status,
        clean);

    const render = (): void => {
        const has = walls.has();
        const on = walls.on();
        sw.disabled = !has;
        sw.setAttribute('aria-checked', String(has && on));
        sw.classList.toggle('on', has && on);
        (sw.querySelector('.wv-state') as HTMLElement).textContent = t(has && on ? 'walls.state.on' : 'walls.state.off');
        wallsNote.textContent = !has ? t('walls.none') : [on ? '' : t('walls.offHint'), walls.adminOff ? t('walls.adminOff') : ''].filter(Boolean).join(' ');
        wallsNote.hidden = wallsNote.textContent === '';
        for (const b of modeBtns) {
            const sel = b.dataset.mode === v.mode;
            b.setAttribute('aria-checked', String(sel));
            b.classList.toggle('on', sel);
            b.disabled = !has && b.dataset.mode !== 'off';
        }
        style.value = v.prefs.style;
        style.disabled = !has;
        const a = v.opacity;
        if (document.activeElement !== op) op.value = String(pct(a));
        op.disabled = !has;
        opOut.textContent = `${pct(a)} %`;
        const st = voxelStatus(v);
        if (status.textContent !== st) status.textContent = st;
        if (clean) clean.hidden = !has;
    };
    render();
    const off = v.onChange(() => { if (!root.isConnected && started) stop(); else render(); });
    let started = false;
    // the status line counts faces while chunks stream in; it stops with the block
    const timer = window.setInterval(() => {
        if (!root.isConnected) { if (started) stop(); return; }
        started = true;
        render();
    }, 500);
    function stop(): void {
        clearInterval(timer);
        off();
    }
    return root;
}

/** The chip at the top right while the grid is on: mode, style, opacity, the key; then what it shows. */
export function voxelLegend(parent: HTMLElement, v: VoxelController): HTMLElement {
    const main = h('div', { class: 'vl-main' });
    const sub = h('div', { class: 'vl-sub' });
    const chip = h('div', { class: 'voxel-legend', 'data-testid': 'voxel-legend', hidden: true, 'aria-hidden': 'true' }, h('span', { class: 'vl-dot', 'aria-hidden': 'true' }), h('div', {}, main, sub));
    parent.append(chip);
    const render = (): void => {
        const s = v.stats();
        const show = s.mode !== 'off' && s.state !== 'no-walls';
        chip.hidden = !show;
        if (!show) return;
        chip.dataset.style = s.style;
        const text = t(s.mode === 'only' ? 'voxels.legendOnly' : 'voxels.legend', { style: t(`voxels.style.${s.style}`), pct: pct(s.opacity) });
        if (main.textContent !== text) main.textContent = text;
        const st = voxelStatus(v);
        if (sub.textContent !== st) sub.textContent = st;
    };
    v.onChange(render);
    window.setInterval(render, 500);
    render();
    return chip;
}
