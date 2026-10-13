// The crosshair (v0.7 lane D1; a pilot's idea: "a crosshair in the centre"): the settings
// crosshair.shape / size / color / opacity (packages/prefs/src/defs/crosshair.ts) become one SVG
// mark over the centre of the view. app/builtin/crosshair.ts puts it on the page; this module only
// decides what is drawn.
//
// The mark is a page overlay, never part of the drawn scan, so a recording (which takes the canvas
// only, cinema.ts) never shows it; cinema mode and the clean view hide it (fly.css rules in
// app/builtin/crosshair.css). Pure: no DOM (tools/bench/test/flight-ux.test.ts).
import { CROSSHAIR_COLORS, CROSSHAIR_SHAPES } from '@gsfpv/prefs';

/** The marks crosshair.shape offers (@gsfpv/prefs CROSSHAIR_SHAPES); 'off' draws nothing. */
export type CrosshairShape = 'off' | 'dot' | 'cross' | 'circle' | 'ringDot';

/** What is drawn: the shape, its size (% of the view's shorter side), its CSS colour and opacity. */
export interface CrosshairSpec { shape: CrosshairShape; sizePct: number; color: string; opacity: number }

/** The CSS colour of each colour the setting offers (its options: @gsfpv/prefs CROSSHAIR_COLORS). */
export const CROSSHAIR_CSS: Readonly<Record<string, string>> = {
    green: '#4ade80', white: '#ffffff', yellow: '#facc15', red: '#f87171', cyan: '#22d3ee', magenta: '#e879f9', black: '#000000'
};

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** The spec from the four settings (`get`: the prefs store's get); out-of-range values are clamped, unknown ones fall back. */
export function crosshairSpec(get: (id: string) => unknown): CrosshairSpec {
    const shape = String(get('crosshair.shape'));
    const color = String(get('crosshair.color'));
    const size = Number(get('crosshair.size'));
    const opacity = Number(get('crosshair.opacity'));
    return {
        shape: (CROSSHAIR_SHAPES.includes(shape) ? shape : 'off') as CrosshairShape,
        sizePct: Number.isFinite(size) ? clamp(size, 1, 20) : 4,
        color: CROSSHAIR_CSS[CROSSHAIR_COLORS.includes(color) ? color : 'green'] ?? CROSSHAIR_CSS.green,
        opacity: Number.isFinite(opacity) ? clamp(opacity, 0.1, 1) : 0.8
    };
}

/** The mark's parts on a 100 x 100 box centred on the view: line segments, rings and dots. */
interface Parts { lines: [number, number, number, number][]; rings: number[]; dots: number[] }

function partsOf(shape: CrosshairShape): Parts {
    switch (shape) {
        case 'dot': return { lines: [], rings: [], dots: [9] };
        // four arms with a gap in the middle, so the centre of the view stays visible
        case 'cross': return { lines: [[50, 6, 50, 38], [50, 62, 50, 94], [6, 50, 38, 50], [62, 50, 94, 50]], rings: [], dots: [] };
        case 'circle': return { lines: [], rings: [44], dots: [] };
        case 'ringDot': return { lines: [], rings: [44], dots: [6] };
        default: return { lines: [], rings: [], dots: [] };
    }
}

/**
 * The SVG of the mark, or null when the crosshair is off. Each part is drawn twice: a dark (or, for
 * a black mark, light) halo under it, so it reads on any scan, bright sky or dark room.
 */
export function crosshairSvg(spec: CrosshairSpec): string | null {
    if (spec.shape === 'off') return null;
    const p = partsOf(spec.shape);
    const halo = spec.color === CROSSHAIR_CSS.black ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.55)';
    const draw = (stroke: string, w: number, fill: string): string => [
        ...p.lines.map(([x1, y1, x2, y2]) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round"/>`),
        ...p.rings.map((r) => `<circle cx="50" cy="50" r="${r}" fill="none" stroke="${stroke}" stroke-width="${w}"/>`),
        ...p.dots.map((r) => `<circle cx="50" cy="50" r="${r + (fill === halo ? 3 : 0)}" fill="${fill}"/>`)
    ].join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100%" height="100%" opacity="${spec.opacity}" aria-hidden="true" focusable="false" data-shape="${spec.shape}">`
        + `<g>${draw(halo, 11, halo)}</g><g>${draw(spec.color, 5, spec.color)}</g></svg>`;
}
