// The crosshair over the centre of the flight view (v0.7 lane D1, a pilot's idea). What it looks
// like comes from the settings through ../../crosshair.ts; this feature only puts that SVG on the
// page and redraws it when a crosshair setting changes. Off by default. Sized in vmin (a share of the
// window's shorter side, the view fills the window), so a resize needs no work here. Hidden in cinema
// mode and the clean view by crosshair.css; never in a recording (the recorder takes the canvas only).
import { h } from '../../ui/dom';
import { crosshairSpec, crosshairSvg } from '../../crosshair';
import type { Feature } from '../context';
import './crosshair.css';

// window.__gsfpv.crosshair: the mark on the page now (shape, or null when none), for the acceptance
declare module '../test-hook' {
    interface TestHook {
        crosshair?: () => { shape: string | null; sizeVmin: number; shown: boolean };
    }
}

export const crosshair: Feature = {
    id: 'crosshair',
    install(ctx) {
        const el = h('div', { class: 'crosshair', 'aria-hidden': 'true', 'data-testid': 'crosshair', hidden: true });
        ctx.ui.prepend(el); // under every panel and card of the flight view
        let size = 0;
        const draw = (): void => {
            const spec = crosshairSpec((id) => ctx.prefs.get(id));
            const svg = crosshairSvg(spec);
            el.hidden = svg === null;
            // the markup is built from the settings' fixed options and clamped numbers only
            el.innerHTML = svg ?? '';
            size = spec.sizePct;
            el.style.setProperty('--crosshair-size', `${size}vmin`);
        };
        draw();
        ctx.prefs.onChange((c) => { if (c.id.startsWith('crosshair.')) draw(); });
        ctx.hook.crosshair = () => ({ shape: el.hidden ? null : el.querySelector('svg')?.getAttribute('data-shape') ?? null, sizeVmin: size, shown: !el.hidden && el.getClientRects().length > 0 });
    }
};
