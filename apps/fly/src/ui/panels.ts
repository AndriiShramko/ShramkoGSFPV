// Panels opened from the pause menu, and the first-visit warning (split from ui/flight.ts, v0.3 wave
// 1): measurements, replays. The features in app/builtin/ open them and hold the pause. v0.2's
// settings panel is gone (W2-1): Settings is generated from the prefs schema (ui/settings/), writes
// every change to the store at once and has no Apply button.
import { h, clear, panel, fmt } from './dom';
import { t } from '../i18n';

export function measurePanel(parent: HTMLElement, report: Record<string, unknown>, onClose: () => void): void {
    const p = panel(t('measure.title'), () => { p.close(); onClose(); });
    const rows: [string, string][] = [
        [t('measure.renderer'), String(report.renderer)],
        [t('measure.output'), `${fmt(report.outputHz as number, 1)} Hz`],
        [t('measure.frame'), `${fmt(report.frameP50 as number, 1)} / ${fmt(report.frameP99 as number, 1)} ms`],
        [t('measure.physics'), `${fmt(report.physicsHz as number, 0)} Hz`],
        [t('measure.input'), `${report.inputSource ?? '—'} · ${fmt(report.inputHz as number, 0)} Hz`],
        [t('measure.pipeline'), report.pipelineMs === null ? t('measure.notMeasured') : `${fmt(report.pipelineMs as number, 1)} ms`],
        [t('measure.load'), `${fmt((report.loadMs as number) / 1000, 2)} s`],
        [t('measure.collision'), String(report.collision)],
        [t('measure.tunnel'), String(report.tunnelSelfTest)]
    ];
    const dl = h('dl', { class: 'measure' });
    for (const [k, val] of rows) dl.append(h('dt', {}, k), h('dd', {}, val));
    const hz = report.outputHz as number;
    const copyBtn = h('button', { type: 'button', class: 'btn', 'data-action': 'copy-report' }, t('measure.copy'));
    copyBtn.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(JSON.stringify(report, null, 2)); copyBtn.textContent = t('measure.copied'); } catch { /* clipboard blocked */ }
    });
    p.body.append(dl, h('p', { class: 'muted small' }, t('measure.note', { hz: fmt(hz, 0), ms: fmt(1000 / Math.max(1, hz), 0) })), copyBtn);
    parent.append(p.root);
}

export function replaysPanel(parent: HTMLElement, items: { label: string; play: () => void; exportCsv: () => void; exportJson: () => void }[], onClose: () => void): void {
    const p = panel(t('replays.title'), () => { p.close(); onClose(); });
    if (items.length === 0) p.body.append(h('p', { class: 'muted' }, t('replays.empty')));
    for (const it of items) {
        p.body.append(h('div', { class: 'replay-row' }, h('span', {}, it.label),
            h('button', { type: 'button', class: 'btn', onclick: () => { p.close(); it.play(); } }, t('replays.play')),
            h('button', { type: 'button', class: 'btn', onclick: it.exportCsv }, 'CSV'),
            h('button', { type: 'button', class: 'btn', onclick: it.exportJson }, 'JSON')));
    }
    parent.append(p.root);
    void clear;
}

export function warningModal(parent: HTMLElement, onOk: () => void): void {
    const p = panel(t('warning.title'));
    p.body.append(h('p', {}, t('warning.text')), h('button', { type: 'button', class: 'btn primary', 'data-action': 'warning-ok', onclick: () => { p.close(); onOk(); } }, t('warning.ok')));
    parent.append(p.root);
}
