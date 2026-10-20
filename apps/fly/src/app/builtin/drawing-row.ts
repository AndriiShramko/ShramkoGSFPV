// Under the Render row of Settings -> Display (v0.10 lane R, the owner's item 3): which class of device this is and what
// "Auto" stands for on it: the drawing, the splat budget and the resolution of that class's preset (the owner's from the
// admin over the built-in table). The pilot sees what Auto picked for him and, with the Device class row and the Splat
// budget row next to it, can correct it to the power of his computer, tablet or phone.
import { changedFields, canDrawStochastic, gpuName } from '@gsfpv/render-pc';
import { h } from '../../ui/dom';
import { t } from '../../i18n';
import type { FlightContext } from '../context';
import { cleanDraw } from '../clean-draw';
import { deviceFor, drawingDefaults, handheld, presetOf } from '../drawing';
import { deviceLine } from '../drawing-ask';

export function drawingRow(ctx: FlightContext): { el: HTMLElement; refresh(): void } {
    const line = h('p', { class: 'small sr-extra-line', 'data-testid': 'drawing-row-line' });
    const notes = h('div', { class: 'sr-extra-notes' });
    const el = h('div', { class: 'sr-extra' }, line, notes);
    const refresh = (): void => {
        const r = ctx.renderer;
        const choice = deviceFor(ctx.prefs, r.isWebGPU, r.gpuInfo);
        const preset = presetOf(choice);
        const out = deviceLine({
            choice,
            preset,
            canStochastic: canDrawStochastic({ webgpu: r.isWebGPU, handheld }),
            gpu: gpuName(r.gpuInfo),
            ownerChanged: changedFields(choice.cls, drawingDefaults()).length > 0,
            held: cleanDraw.held
        }, t);
        line.textContent = out.line;
        notes.replaceChildren(...out.notes.map((n) => h('p', { class: 'small muted sr-extra-line' }, n)));
    };
    refresh();
    return { el, refresh };
}
