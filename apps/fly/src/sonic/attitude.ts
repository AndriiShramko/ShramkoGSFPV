// The attitude display of the Fly by Sound mode (v0.13, the owner's message 41: "the graphic shown now is completely unclear.
// There is no sense of the horizon, whether you climb or sink. Two black and grey parts. Think what to do so it is clearer, and as
// contrasting as possible for the low-sighted"; plan M41-24; lane v13-look L2-1). What he saw in v0.12 (docs/wip/v13-look.md
// L2-1): the camera's view of a lesson world, a flat untextured floor under a near-black background, two flat areas with no line,
// no marks and nothing that moved when the craft climbed or sank. This is an instrument beside the view instead:
//
//   dial     a large attitude indicator: a light sky over a dark ground (9:1 apart), a thick horizon line drawn white between two
//            black edges (the white reads on the ground, the black on the sky), pitch marks every 10 degrees (black on the sky,
//            white on the ground, with their numbers), a bank scale on a dark bezel (0, 10, 20, 30, 45, 60 degrees) and a sky
//            pointer that turns with the horizon, the craft's own yellow wings fixed in the middle.
//   tape     the height above the lesson's floor on a fixed scale from the floor to the room's top: the lesson's height band as a
//            green bar with its two edges across the tape, the height to fly at (the next gate's centre, else the band's) as a
//            cyan line, the craft as a yellow box with its height in it that moves up and down the tape.
//   arrow    the climb arrow: up or down from the craft's height, longer the faster it climbs or sinks (full length at 2 m/s),
//            none under 0.1 m/s.
//
// Every line and mark is at least 4.5:1 against what it lies on (ATTITUDE_PAIRS, held by tools/bench/test/sonic-panels.test.ts;
// measured on the page's pictures by tools/bench/src/v13-look-page.ts). Pure up to AttitudeDisplay: attitudeLayout, horizonOf,
// tapeOf and climbArrow are the geometry Node tests check; drawAttitude puts it on a canvas.
import { contrastRatio, luminance, srgbToLinear } from './look';
import type { Rgb } from './look';

export interface AttitudeState {
    /** sim-core attitude().roll, degrees: the right side below the horizon positive */
    readonly rollDeg: number;
    /** sim-core attitude().pitch, degrees: the nose below the horizon positive */
    readonly pitchDeg: number;
    /** metres above the lesson's floor */
    readonly heightM: number;
    /** vertical speed, m/s, up positive */
    readonly vyMps: number;
    /** the lesson's height band (LessonLayers.heightBandM), metres above the floor, or null */
    readonly bandM: readonly [number, number] | null;
    /** the height to fly at now (the sound package's targetHeightM: the next gate's centre, else the band's centre), or null */
    readonly targetM: number | null;
    /** the room's height above its floor (the top of its hollow), or null in the open */
    readonly roomM: number | null;
}

export type Scheme = 'dark' | 'light';

// ------------------------------------------------------------------ colours

/** A colour as the canvas takes it and its relative luminance (WCAG 2.x, from its sRGB channels). */
export interface Swatch {
    readonly css: string;
    readonly lum: number;
}

/** A swatch from '#rrggbb'. */
export function swatch(css: string): Swatch {
    const v = parseInt(css.slice(1), 16);
    const c: Rgb = [srgbToLinear(((v >> 16) & 255) / 255), srgbToLinear(((v >> 8) & 255) / 255), srgbToLinear((v & 255) / 255)];
    return { css, lum: luminance(c) };
}

/** The dial's colours: the same in a dark and a light page (the sky and the ground are the instrument's own). */
export const DIAL = {
    sky: swatch('#9fd4ff'),
    ground: swatch('#3d2208'),
    bezel: swatch('#141414'),
    white: swatch('#ffffff'),
    black: swatch('#000000'),
    wings: swatch('#ffd400')
} as const;

/** The box's own colours (the tape, the climb arrow), by the page's colour scheme. */
export interface BoxColours {
    readonly bg: Swatch;
    readonly fg: Swatch;
    /** the lesson's band */
    readonly band: Swatch;
    /** the height to fly at */
    readonly target: Swatch;
    /** the craft: its box on the tape and the climb arrow */
    readonly craft: Swatch;
    /** the text in the craft's box */
    readonly craftText: Swatch;
}

export const BOX: Readonly<Record<Scheme, BoxColours>> = {
    dark: { bg: swatch('#000000'), fg: swatch('#ffffff'), band: swatch('#39e07a'), target: swatch('#33d6ff'), craft: swatch('#ffd400'), craftText: swatch('#000000') },
    light: { bg: swatch('#ffffff'), fg: swatch('#000000'), band: swatch('#0a7a3a'), target: swatch('#006d8f'), craft: swatch('#7a4a00'), craftText: swatch('#ffffff') }
};

/** The least contrast of a line or mark against what it lies on (WCAG 1.4.3's text level, stricter than 1.4.11's 3:1). */
export const MARK_CONTRAST = 4.5;

/** Every pair of a mark and what it lies on, by name: what the contrast rule holds (sonic-panels.test.ts) and the page measures. */
export function attitudePairs(scheme: Scheme): Record<string, number> {
    const b = BOX[scheme];
    const r = (x: Swatch, y: Swatch): number => contrastRatio(x.lum, y.lum);
    return {
        'sky : ground': r(DIAL.sky, DIAL.ground),
        'horizon core : ground': r(DIAL.white, DIAL.ground),
        'horizon edge : sky': r(DIAL.black, DIAL.sky),
        'pitch mark : sky': r(DIAL.black, DIAL.sky),
        'pitch mark : ground': r(DIAL.white, DIAL.ground),
        'wings : ground': r(DIAL.wings, DIAL.ground),
        'wings edge : sky': r(DIAL.black, DIAL.sky),
        'bank tick : bezel': r(DIAL.white, DIAL.bezel),
        'tape tick : tape': r(b.fg, b.bg),
        'band : tape': r(b.band, b.bg),
        'target : tape': r(b.target, b.bg),
        'craft : tape': r(b.craft, b.bg),
        'craft text : craft': r(b.craftText, b.craft),
        'climb arrow : box': r(b.craft, b.bg)
    };
}

// ------------------------------------------------------------------ geometry

const DEG = Math.PI / 180;
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export interface Box {
    readonly x0: number;
    readonly y0: number;
    readonly x1: number;
    readonly y1: number;
}

export interface AttitudeLayout {
    /** the canvas, CSS pixels */
    readonly w: number;
    readonly h: number;
    /** the dial: centre, the radius of the sky and ground, the bezel's width around it */
    readonly dial: { readonly cx: number; readonly cy: number; readonly r: number; readonly bezel: number };
    /** the climb arrow's column */
    readonly arrow: Box;
    /** the height tape */
    readonly tape: Box;
    /** the tape's numbers, px */
    readonly font: number;
}

/** The canvas's width for a height `h`: the dial (h), the arrow's column and the tape. */
export const ATTITUDE_ASPECT = 1.62;

/** Where everything lies on a canvas of w x h CSS pixels (w about ATTITUDE_ASPECT x h). */
export function attitudeLayout(w: number, h: number): AttitudeLayout {
    const pad = Math.max(2, 0.03 * h);
    const d = Math.min(h - 2 * pad, (w - 2 * pad) / 1.55);
    const bezel = 0.075 * d;
    const dial = { cx: pad + d / 2, cy: h / 2, r: d / 2 - bezel, bezel };
    const gap = 0.04 * d;
    const ax0 = pad + d + gap;
    const arrow = { x0: ax0, y0: pad, x1: ax0 + 0.15 * d, y1: h - pad };
    const tape = { x0: arrow.x1 + gap, y0: pad, x1: w - pad, y1: h - pad };
    return { w, h, dial, arrow, tape, font: Math.max(11, Math.round(0.085 * h)) };
}

/** A point on the canvas. */
export type Pt = readonly [number, number];

export interface Horizon {
    /** where the horizon crosses the line through the dial's centre along its normal */
    readonly centre: Pt;
    /** along the horizon, toward its right end */
    readonly u: Pt;
    /** across it, toward the sky */
    readonly n: Pt;
    /** pixels per degree of pitch */
    readonly pxPerDeg: number;
    /** the sky pointer's tip on the dial's edge */
    readonly pointer: Pt;
}

/** Degrees of pitch from the dial's centre to its edge. */
export const PITCH_SPAN_DEG = 40;
/** The pitch marks, degrees above (+) and below (-) the horizon. */
export const PITCH_MARKS: readonly number[] = [-30, -20, -10, 10, 20, 30];
/** The bank scale's ticks, degrees either side of the top. */
export const BANK_TICKS: readonly number[] = [0, 10, 20, 30, 45, 60];

/**
 * The horizon as the pilot sees it from the craft: a right roll turns it the other way (its right end rises), a nose down moves it
 * up (toward the sky's side), so the yellow wings sit where the nose and the wings are against the world.
 */
export function horizonOf(s: Pick<AttitudeState, 'rollDeg' | 'pitchDeg'>, dial: AttitudeLayout['dial']): Horizon {
    const phi = (Number.isFinite(s.rollDeg) ? s.rollDeg : 0) * DEG;
    const u: Pt = [Math.cos(phi), -Math.sin(phi)];
    const n: Pt = [-Math.sin(phi), -Math.cos(phi)];
    const pxPerDeg = dial.r / PITCH_SPAN_DEG;
    const off = clamp(Number.isFinite(s.pitchDeg) ? s.pitchDeg : 0, -90, 90) * pxPerDeg;
    return { centre: [dial.cx + n[0] * off, dial.cy + n[1] * off], u, n, pxPerDeg, pointer: [dial.cx + n[0] * dial.r, dial.cy + n[1] * dial.r] };
}

export interface Tape {
    /** the scale's top, metres above the floor (the bottom is the floor) */
    readonly topM: number;
    /** metres between two numbered ticks */
    readonly labelEveryM: number;
    /** the canvas y of a height */
    y(m: number): number;
}

/**
 * The tape's scale: the floor at the bottom, the room's top (to the half metre) at the top; in the open 4 m at least and a metre
 * over the band, the height to fly at and the craft. The scale grows with a craft that climbs over it, a metre at a time.
 */
export function tapeOf(s: AttitudeState, box: Box): Tape {
    const over = Math.max(0, s.bandM ? s.bandM[1] : 0, s.targetM ?? 0, s.heightM);
    const topM = s.roomM !== null && s.roomM > 0.5 && s.heightM <= s.roomM + 0.25 ? Math.ceil(s.roomM * 2) / 2 : Math.max(4, Math.ceil(over + 1));
    const pad = 0.07 * (box.y1 - box.y0);
    const y0 = box.y1 - pad;
    const y1 = box.y0 + pad;
    return { topM, labelEveryM: topM > 8 ? 2 : 1, y: (m: number) => y0 - (clamp(m, 0, topM) / topM) * (y0 - y1) };
}

/** The climb arrow: none under this vertical speed, m/s. */
export const CLIMB_MIN_MPS = 0.1;
/** The arrow is longest at this vertical speed, m/s. */
export const CLIMB_FULL_MPS = 2;

export interface ClimbArrow {
    readonly up: boolean;
    /** from the craft's height to the arrow's tip, canvas y */
    readonly from: number;
    readonly to: number;
}

/** The climb arrow from the craft's height, or null when the craft neither climbs nor sinks. */
export function climbArrow(s: AttitudeState, tape: Tape, box: Box): ClimbArrow | null {
    if (!Number.isFinite(s.vyMps) || Math.abs(s.vyMps) < CLIMB_MIN_MPS) return null;
    const up = s.vyMps > 0;
    const from = tape.y(s.heightM);
    const len = Math.max(0.12, Math.min(1, Math.abs(s.vyMps) / CLIMB_FULL_MPS)) * 0.45 * (box.y1 - box.y0);
    const to = clamp(up ? from - len : from + len, box.y0, box.y1);
    return { up, from, to };
}

// ------------------------------------------------------------------ drawing

/** What drawAttitude needs of a canvas context (CanvasRenderingContext2D). */
type G = CanvasRenderingContext2D;

const line = (g: G, a: Pt, b: Pt, width: number, css: string): void => {
    g.lineWidth = width;
    g.strokeStyle = css;
    g.beginPath();
    g.moveTo(a[0], a[1]);
    g.lineTo(b[0], b[1]);
    g.stroke();
};
const along = (p: Pt, v: Pt, k: number): Pt => [p[0] + v[0] * k, p[1] + v[1] * k];

/** A height in metres as the page writes it: the number in the page's language and (unless `unit` is false) the locales' metre symbol. */
export type HeightText = (metres: number, unit?: boolean) => string;

/** Draws the display for `s` on a context scaled to CSS pixels. `metres` writes a height with its unit. */
export function drawAttitude(g: G, l: AttitudeLayout, s: AttitudeState, scheme: Scheme, metres: HeightText): void {
    const box = BOX[scheme];
    const { cx, cy, r, bezel } = l.dial;
    g.clearRect(0, 0, l.w, l.h);
    g.lineCap = 'butt';
    g.lineJoin = 'miter';
    // the bezel, with the bank scale's ticks (fixed to the craft) and the zero index
    g.fillStyle = DIAL.bezel.css;
    g.beginPath();
    g.arc(cx, cy, r + bezel, 0, 2 * Math.PI);
    g.fill();
    for (const a of BANK_TICKS) {
        for (const side of a === 0 ? [1] : [-1, 1]) {
            const t = side * a * DEG;
            const dir: Pt = [Math.sin(t), -Math.cos(t)];
            const long = a === 0 || a === 30 || a === 60;
            line(g, along([cx, cy], dir, r + 0.08 * bezel), along([cx, cy], dir, r + (long ? 0.95 : 0.6) * bezel), Math.max(2, 0.018 * r), DIAL.white.css);
        }
    }
    const hz = horizonOf(s, l.dial);
    g.save();
    g.beginPath();
    g.arc(cx, cy, r, 0, 2 * Math.PI);
    g.clip();
    // the ground, then the sky on its side of the horizon
    g.fillStyle = DIAL.ground.css;
    g.fillRect(cx - r, cy - r, 2 * r, 2 * r);
    const far = 4 * r;
    const a0 = along(hz.centre, hz.u, -far), a1 = along(hz.centre, hz.u, far);
    g.fillStyle = DIAL.sky.css;
    g.beginPath();
    g.moveTo(a0[0], a0[1]);
    g.lineTo(a1[0], a1[1]);
    g.lineTo(...along(a1, hz.n, far));
    g.lineTo(...along(a0, hz.n, far));
    g.closePath();
    g.fill();
    // the pitch marks and their numbers: black on the sky, white on the ground. A small dial (a phone) keeps the marks of 10 and 20
    // degrees and drops the numbers where two would touch
    const markW = Math.max(2.5, 0.035 * r);
    const markFont = Math.max(11, Math.round(0.16 * r));
    const numbered = 10 * hz.pxPerDeg >= 1.3 * markFont;
    g.font = `700 ${markFont}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const m of PITCH_MARKS) {
        if (!numbered && Math.abs(m) > 20) continue;
        const half = (Math.abs(m) === 20 ? 0.42 : 0.3) * r;
        const p = along(hz.centre, hz.n, m * hz.pxPerDeg);
        const css = m > 0 ? DIAL.black.css : DIAL.white.css;
        line(g, along(p, hz.u, -half), along(p, hz.u, half), markW, css);
        g.fillStyle = css;
        if (numbered) for (const side of [-1, 1]) {
            const q = along(p, hz.u, side * (half + 0.13 * r));
            g.save();
            g.translate(q[0], q[1]);
            g.rotate(Math.atan2(hz.u[1], hz.u[0]));
            g.fillText(String(Math.abs(m)), 0, 0);
            g.restore();
        }
    }
    // the horizon: black edges, a white core
    const core = Math.max(4, 0.07 * r);
    const edge = Math.max(2, 0.035 * r);
    line(g, along(hz.centre, hz.u, -1.2 * r), along(hz.centre, hz.u, 1.2 * r), core + 2 * edge, DIAL.black.css);
    line(g, along(hz.centre, hz.u, -1.2 * r), along(hz.centre, hz.u, 1.2 * r), core, DIAL.white.css);
    g.restore();
    // the sky pointer (turns with the horizon) against the bank scale
    const tip = hz.pointer;
    const base = along([cx, cy], hz.n, r - 0.16 * r);
    const tri: Pt[] = [tip, along(base, hz.u, -0.09 * r), along(base, hz.u, 0.09 * r)];
    g.beginPath();
    g.moveTo(tri[0]![0], tri[0]![1]);
    g.lineTo(tri[1]![0], tri[1]![1]);
    g.lineTo(tri[2]![0], tri[2]![1]);
    g.closePath();
    g.lineWidth = Math.max(2, 0.03 * r);
    g.strokeStyle = DIAL.black.css;
    g.stroke();
    g.fillStyle = DIAL.wings.css;
    g.fill();
    // the craft's wings, fixed: yellow with a black edge
    const wingW = Math.max(4, 0.075 * r);
    const wingE = Math.max(2, 0.03 * r);
    const wings: [Pt, Pt][] = [
        [[cx - 0.66 * r, cy], [cx - 0.2 * r, cy]],
        [[cx - 0.2 * r, cy], [cx - 0.2 * r, cy + 0.13 * r]],
        [[cx + 0.2 * r, cy], [cx + 0.66 * r, cy]],
        [[cx + 0.2 * r, cy], [cx + 0.2 * r, cy + 0.13 * r]]
    ];
    g.lineCap = 'square';
    for (const [a, b] of wings) line(g, a, b, wingW + 2 * wingE, DIAL.black.css);
    const dot = 0.06 * r;
    g.fillStyle = DIAL.black.css;
    g.fillRect(cx - dot - wingE, cy - dot - wingE, 2 * (dot + wingE), 2 * (dot + wingE));
    for (const [a, b] of wings) line(g, a, b, wingW, DIAL.wings.css);
    g.fillStyle = DIAL.wings.css;
    g.fillRect(cx - dot, cy - dot, 2 * dot, 2 * dot);
    g.lineCap = 'butt';

    // ---- the tape
    const tb = l.tape;
    const tape = tapeOf(s, tb);
    const tw = tb.x1 - tb.x0;
    g.strokeStyle = box.fg.css;
    g.lineWidth = 2;
    g.strokeRect(tb.x0 + 1, tb.y0 + 1, tw - 2, tb.y1 - tb.y0 - 2);
    // the band: a green bar along the tape's inner side, its edges across the tape
    if (s.bandM) {
        const ya = tape.y(s.bandM[1]), yb = tape.y(s.bandM[0]);
        g.fillStyle = box.band.css;
        g.fillRect(tb.x0 + 0.04 * tw, ya, 0.16 * tw, yb - ya);
        // the edges stop short of the numbers (right-aligned at the tape's right)
        line(g, [tb.x0 + 0.04 * tw, ya], [tb.x0 + 0.74 * tw, ya], 2.5, box.band.css);
        line(g, [tb.x0 + 0.04 * tw, yb], [tb.x0 + 0.74 * tw, yb], 2.5, box.band.css);
    }
    // the ticks every half metre, numbered every labelEveryM
    g.font = `700 ${l.font}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
    g.textAlign = 'right';
    g.textBaseline = 'middle';
    g.fillStyle = box.fg.css;
    for (let m = 0; m <= tape.topM + 1e-9; m += 0.5) {
        const y = tape.y(m);
        const whole = Math.abs(m - Math.round(m)) < 1e-9;
        line(g, [tb.x0 + 0.22 * tw, y], [tb.x0 + (whole ? 0.42 : 0.32) * tw, y], whole ? 2.5 : 1.5, box.fg.css);
        if (whole && Math.round(m) % tape.labelEveryM === 0) g.fillText(String(Math.round(m)), tb.x1 - 0.06 * tw, y);
    }
    // the height to fly at
    if (s.targetM !== null && Number.isFinite(s.targetM)) {
        const y = tape.y(s.targetM);
        line(g, [tb.x0 + 0.04 * tw, y], [tb.x0 + 0.74 * tw, y], Math.max(3, 0.018 * l.h), box.target.css);
    }
    // the craft: a box with its height, pointing at the tape's scale
    const yc = tape.y(s.heightM);
    const bh = Math.max(l.font + 8, 0.17 * l.h);
    const bx0 = tb.x0 + 0.1 * tw;
    g.beginPath();
    g.moveTo(tb.x0 + 0.02 * tw, yc);
    g.lineTo(bx0, yc - bh / 2);
    g.lineTo(tb.x1 - 0.02 * tw, yc - bh / 2);
    g.lineTo(tb.x1 - 0.02 * tw, yc + bh / 2);
    g.lineTo(bx0, yc + bh / 2);
    g.closePath();
    g.fillStyle = box.craft.css;
    g.fill();
    g.lineWidth = 2;
    g.strokeStyle = box.fg.css;
    g.stroke();
    g.fillStyle = box.craftText.css;
    g.textAlign = 'center';
    // the height with its unit, smaller where the box is narrow (a phone), the number alone where even that does not fit
    const room = tb.x1 - 0.02 * tw - bx0 - 4;
    let label = metres(Math.max(0, s.heightM));
    let size = l.font;
    while (size > 9 && g.measureText(label).width > room) {
        size--;
        g.font = `700 ${size}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
    }
    if (g.measureText(label).width > room) label = metres(Math.max(0, s.heightM), false);
    g.fillText(label, (bx0 + tb.x1) / 2, yc + 1);
    // ---- the climb arrow
    const arrow = climbArrow(s, tape, l.arrow);
    if (arrow) {
        const ab = l.arrow;
        const mid = (ab.x0 + ab.x1) / 2;
        const half = (ab.x1 - ab.x0) / 2;
        const head = Math.min(Math.abs(arrow.to - arrow.from), 1.3 * half);
        const dir = arrow.up ? -1 : 1;
        const neck = arrow.to - dir * head;
        g.fillStyle = box.craft.css;
        g.strokeStyle = box.fg.css;
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(mid - 0.38 * half, arrow.from);
        g.lineTo(mid - 0.38 * half, neck);
        g.lineTo(mid - half, neck);
        g.lineTo(mid, arrow.to);
        g.lineTo(mid + half, neck);
        g.lineTo(mid + 0.38 * half, neck);
        g.lineTo(mid + 0.38 * half, arrow.from);
        g.closePath();
        g.fill();
        g.stroke();
    }
}

// ------------------------------------------------------------------ the display on the page

/** What the page's test hook reports of the display (v13-look-page.ts measures the picture at these places). */
export interface AttitudeReport {
    readonly shown: boolean;
    readonly state: AttitudeState | null;
    readonly scheme: Scheme;
    /** the canvas on the page, CSS pixels */
    readonly canvas: { x: number; y: number; w: number; h: number } | null;
    readonly layout: AttitudeLayout | null;
    readonly horizon: Horizon | null;
    readonly tape: { topM: number; craftY: number; targetY: number | null; bandY: [number, number] | null } | null;
    readonly arrow: ClimbArrow | null;
    /** draws so far and what the last took, ms */
    readonly draws: number;
    readonly drawMs: number;
}

export interface AttitudeOptions {
    readonly parent: HTMLElement;
    /** a height with its unit, in the page's language */
    readonly metres: HeightText;
    readonly scheme: () => Scheme;
}

/** States that draw the same picture (to a tenth of a degree, a centimetre, a centimetre a second) are drawn once. */
function stateKey(s: AttitudeState, scheme: Scheme, w: number, h: number, dpr: number): string {
    const f = (v: number | null, k: number): string => (v === null || !Number.isFinite(v) ? '-' : String(Math.round(v * k)));
    return [f(s.rollDeg, 10), f(s.pitchDeg, 10), f(s.heightM, 100), f(s.vyMps, 100), f(s.bandM ? s.bandM[0] : null, 100), f(s.bandM ? s.bandM[1] : null, 100), f(s.targetM, 100), f(s.roomM, 100), scheme, w, h, dpr].join(' ');
}

/**
 * The display: a box outside #ui (no live region: the mode's speech says what matters), hidden from screen readers, never taking
 * a pointer. `draw` once per frame with the craft's state; it draws only when the picture changes.
 */
export class AttitudeDisplay {
    readonly root: HTMLElement;
    private readonly canvas: HTMLCanvasElement;
    private readonly o: AttitudeOptions;
    private readonly observer: ResizeObserver | null = null;
    private css = { w: 0, h: 0 };
    private key = '';
    private state: AttitudeState | null = null;
    private draws = 0;
    private drawMs = 0;
    private on = false;

    constructor(o: AttitudeOptions) {
        this.o = o;
        const root = document.createElement('div');
        root.className = 'sonic-attitude';
        root.dataset.testid = 'sonic-attitude';
        root.setAttribute('aria-hidden', 'true');
        root.hidden = true;
        const canvas = document.createElement('canvas');
        root.append(canvas);
        o.parent.append(root);
        this.root = root;
        this.canvas = canvas;
        if (typeof ResizeObserver !== 'undefined') {
            this.observer = new ResizeObserver(() => this.measure());
            this.observer.observe(canvas);
        }
    }

    private measure(): void {
        this.css = { w: this.canvas.clientWidth, h: this.canvas.clientHeight };
        this.key = '';
    }

    /** Shown or hidden (the pref, a lesson running); hidden draws nothing. */
    show(on: boolean): void {
        if (on === this.on) return;
        this.on = on;
        this.root.hidden = !on;
        if (on) this.measure();
    }

    get shown(): boolean {
        return this.on;
    }

    draw(s: AttitudeState): void {
        this.state = s;
        if (!this.on) return;
        if (this.css.w === 0) this.measure();
        const { w, h } = this.css;
        if (w <= 0 || h <= 0) return;
        const dpr = Math.min(4, Math.max(1, globalThis.devicePixelRatio || 1));
        const scheme = this.o.scheme();
        const key = stateKey(s, scheme, w, h, dpr);
        if (key === this.key) return;
        this.key = key;
        const t0 = performance.now();
        const pw = Math.round(w * dpr), ph = Math.round(h * dpr);
        if (this.canvas.width !== pw || this.canvas.height !== ph) {
            this.canvas.width = pw;
            this.canvas.height = ph;
        }
        const g = this.canvas.getContext('2d');
        if (!g) return;
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawAttitude(g, attitudeLayout(w, h), s, scheme, this.o.metres);
        this.draws++;
        this.drawMs = performance.now() - t0;
    }

    report(): AttitudeReport {
        const s = this.state;
        const { w, h } = this.css;
        const layout = this.on && w > 0 ? attitudeLayout(w, h) : null;
        const r = this.on ? this.canvas.getBoundingClientRect() : null;
        const tape = layout && s ? tapeOf(s, layout.tape) : null;
        return {
            shown: this.on,
            state: s,
            scheme: this.o.scheme(),
            canvas: r ? { x: r.left, y: r.top, w: r.width, h: r.height } : null,
            layout,
            horizon: layout && s ? horizonOf(s, layout.dial) : null,
            tape: tape && s ? { topM: tape.topM, craftY: tape.y(s.heightM), targetY: s.targetM === null ? null : tape.y(s.targetM), bandY: s.bandM ? [tape.y(s.bandM[1]), tape.y(s.bandM[0])] : null } : null,
            arrow: layout && tape && s ? climbArrow(s, tape, layout.arrow) : null,
            draws: this.draws,
            drawMs: this.drawMs
        };
    }

    dispose(): void {
        this.observer?.disconnect();
        this.root.remove();
    }
}
