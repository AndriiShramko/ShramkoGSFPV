// The HUD's wind dial (v0.7 lane E, the owner's item 10): a small ring under the OSD's top-right
// line. Its top is the drone's nose; an arrow shows where the wind blows relative to it, with the
// speed under the ring and the words "headwind", "tailwind", "from the left / right" for a screen
// reader; an N on the ring shows north when the scene has a compass heading. Hidden when there is
// neither wind nor a compass. The numbers come from ui/wind-view.ts.
import { h, fmt } from './dom';
import { t } from '../i18n';
import type { WindDialView } from './wind-view';
import './wind-dial.css';

const SVG = 'http://www.w3.org/2000/svg';

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
    const el = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    return el;
}

export class WindDial {
    readonly el: HTMLDivElement;
    private arrow: SVGGElement;
    /** the N on the ring: moved round it, kept upright */
    private north: SVGTextElement;
    private speed: HTMLSpanElement;
    private last = '';

    constructor() {
        const ring = svg('svg', { viewBox: '-32 -32 64 64', width: 64, height: 64, 'aria-hidden': 'true', focusable: 'false' });
        ring.append(svg('circle', { r: 27, class: 'wd-ring' }));
        // the nose: a small tick at the top
        ring.append(svg('path', { d: 'M0 -31 L0 -24', class: 'wd-nose' }));
        this.arrow = svg('g', { class: 'wd-arrow' });
        // tail upwind, head downwind: drawn pointing up, rotated to where the wind blows
        this.arrow.append(svg('path', { d: 'M0 15 L0 -12', class: 'wd-shaft' }), svg('path', { d: 'M-6 -6 L0 -15 L6 -6', class: 'wd-head' }));
        this.north = svg('text', { x: 0, y: -20, 'text-anchor': 'middle', 'dominant-baseline': 'central', class: 'wd-n' });
        this.north.textContent = t('wind.hud.north');
        ring.append(this.arrow, this.north);
        this.speed = h('span', { class: 'wd-speed' });
        this.el = h('div', { class: 'wind-dial', role: 'img', hidden: true, 'data-testid': 'wind-dial' }, ring as unknown as HTMLElement, this.speed);
    }

    /** Draw `v`; null (or neither wind nor compass) hides the dial. */
    update(v: WindDialView | null): void {
        const show = !!v && (v.toRelDeg !== null || v.northRelDeg !== null);
        if (this.el.hidden === show) this.el.hidden = !show;
        if (!v || !show) return;
        const key = `${v.toRelDeg?.toFixed(0)}|${v.speed?.toFixed(1)}|${v.northRelDeg?.toFixed(0)}`;
        if (key === this.last) return;
        this.last = key;
        const calm = v.toRelDeg === null || v.speed === null;
        this.arrow.style.display = calm ? 'none' : '';
        if (!calm) this.arrow.setAttribute('transform', `rotate(${v.toRelDeg!.toFixed(1)})`);
        this.north.style.display = v.northRelDeg === null ? 'none' : '';
        if (v.northRelDeg !== null) {
            const a = (v.northRelDeg * Math.PI) / 180;
            this.north.setAttribute('x', (20 * Math.sin(a)).toFixed(1));
            this.north.setAttribute('y', (-20 * Math.cos(a)).toFixed(1));
        }
        this.speed.textContent = calm ? '' : `${fmt(v.speed!, 1)} ${t('wind.hud.mps')}`;
        const label = calm ? t('wind.hud.calm') : t('wind.hud.aria', { speed: fmt(v.speed!, 1), side: t(`wind.hud.${v.side}`) });
        this.el.setAttribute('aria-label', label);
        this.el.title = label;
    }
}
