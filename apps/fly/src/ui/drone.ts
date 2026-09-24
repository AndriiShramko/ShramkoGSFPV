// Drone picker: preset cards; every number shows where it comes from (manufacturer / measured /
// estimate / Betaflight default). Also draws the rate curve of the preset.
import { compileParams, setpointRate } from '@gsfpv/sim-core';
import type { PresetJson } from '@gsfpv/sim-core';
import { PRESETS, DEFAULT_PRESET } from '../presets';
import { h, fmt } from './dom';
import { t } from '../i18n';

function srcLabel(src: string): string {
    if (src === 'manufacturer') return t('common.manufacturer');
    if (src === 'estimate') return t('common.estimate');
    if (src === 'bf-default') return t('common.bfDefault');
    if (src.startsWith('measured:')) return `${t('common.measured')} (${src.slice(9)})`;
    return src;
}

function row(p: PresetJson, key: string, label: string, render: (v: unknown) => string): HTMLElement | null {
    const f = p.fields[key];
    if (!f) return null;
    return h('div', { class: 'spec-row' }, h('span', { class: 'spec-k' }, label), h('span', { class: 'spec-v' }, render(f.value)), h('span', { class: `src src-${f.source.split(':')[0]}`, title: f.ref ?? '' }, srcLabel(f.source)));
}

function curve(p: PresetJson): HTMLCanvasElement {
    const c = h('canvas', { width: 220, height: 110, class: 'rate-curve', role: 'img', 'aria-label': 'rate curve' }) as HTMLCanvasElement;
    const sp = compileParams(p);
    const g = c.getContext('2d');
    if (!g) return c;
    const max = setpointRate(sp.rates.type, 1, sp.rates.roll, sp.rates.rateLimit);
    g.strokeStyle = '#2a3340';
    g.strokeRect(0.5, 0.5, 219, 109);
    g.strokeStyle = '#4ade80';
    g.lineWidth = 2;
    g.beginPath();
    for (let i = 0; i <= 100; i++) {
        const x = i / 100;
        const y = setpointRate(sp.rates.type, x, sp.rates.roll, sp.rates.rateLimit) / Math.max(1, max);
        const px = 4 + x * 212, py = 106 - y * 100;
        if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.stroke();
    g.fillStyle = '#9aa3ad';
    g.font = '11px ui-monospace, monospace';
    g.fillText(`${sp.rates.type} ${Math.round(max)} °/s`, 8, 14);
    return c;
}

export class DronePicker {
    readonly root: HTMLDivElement;
    onPick: ((id: string) => void) | null = null;

    constructor(parent: HTMLElement, current: string) {
        const cards = h('div', { class: 'drone-grid' });
        for (const [id, p] of Object.entries(PRESETS)) {
            const sp = compileParams(p);
            const card = h('div', { class: `drone-card ${id === current ? 'selected' : ''}`, 'data-preset': id },
                h('h3', {}, p.name, id === DEFAULT_PRESET ? h('span', { class: 'pill' }, t('drone.default')) : null),
                h('p', { class: 'muted' }, p.class),
                row(p, 'twr', t('drone.twr'), (v) => `${v}:1`),
                row(p, 'auw_g', t('drone.weight'), (v) => `${v} g`),
                row(p, 'wheelbase_mm', t('drone.wheelbase'), (v) => `${v} mm`),
                row(p, 'motor', t('drone.motor'), (v) => String(v)),
                row(p, 'battery', t('drone.battery'), (v) => String(v)),
                curve(p),
                h('p', { class: 'muted small' }, `hover ≈ ${fmt(((1 / Math.sqrt(sp.twr) - sp.idle) / (1 - sp.idle)) * 100, 0)} % throttle`),
                h('button', { type: 'button', class: 'btn primary', onclick: () => this.onPick?.(id) }, t('common.fly'))
            );
            cards.append(card);
        }
        this.root = h('div', { class: 'screen drones interactive' }, h('h1', {}, t('drone.title')), h('p', { class: 'muted' }, t('drone.sourceNote')), cards);
        parent.append(this.root);
    }

    remove(): void {
        this.root.remove();
    }
}
