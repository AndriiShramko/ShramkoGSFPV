// Our own drawing of a generic radio transmitter (inline SVG built once with DOM calls; set()
// only changes attributes and classes). It shows WHICH stick to move and WHERE: the target well
// is outlined, a dashed ghost knob travels the requested path (always one way: it fades in where
// the stick starts, moves, waits at the goal and fades out, so the loop never reads as "and back
// again"), an arrow sits beside the well (so the pilot's own knob never hides it), a ring fills
// while the move is held, and a check mark appears when it is taken. A let-go is drawn as the
// knob springing back from where it was pushed. The pilot's real knobs are drawn live on top.
// The wizard uses the large drawing, the in-flight arm card a mini one.
import './wizard.css';
import { t } from '../i18n';

export type Side = 'L' | 'R';
type Fn4 = 'roll' | 'pitch' | 'throttle' | 'yaw';
type Dir = 'up' | 'down' | 'right' | 'centre' | 'stir';

/** SW 'on' / 'off': flip the arm switch to that position; 'flip': to the other one than now. */
export type ArtTarget = { side: Side | 'both'; dir: Dir } | { side: 'SW'; dir: 'flip' | 'on' | 'off' } | null;

export interface ArtState {
    mode: 1 | 2;
    target: ArtTarget;
    /** A second instruction on one well, e.g. "leave the throttle down" while the sticks are let go. */
    also?: { side: Side; dir: 'down' } | null;
    knobL: [number, number] | null; // x (right +), y (up +) in -1..1; null = unknown: grey knob at centre
    knobR: [number, number] | null;
    hold: number; // 0..1 ring around the target knob (only for side L/R)
    ok: boolean; // check mark on the target; the ghost stops at its goal
    sw: boolean | null; // arm lever: ON, OFF, null unknown
    tol: number; // dashed "let go here" zone, fraction of travel (0 = none)
    /** Where the stick rests on a one-well target (x right +, y up +), default the centre: the
     *  other axis of that stick stays where it is (a yaw let-go with the throttle down is at the bottom).
     *  A push starts here; a let-go ends here. */
    home?: [number, number] | null;
    /** Where the ghost starts on a one-well target when that is not `home`: the throttle push starts
     *  at the bottom, a let-go starts where the stick was pushed. */
    from?: [number, number] | null;
    /** false: the other wells stay bright (the check screen, where every stick is being tried). */
    dimOthers?: boolean;
    label: string; // aria-label
}

export interface RadioArt {
    readonly el: SVGSVGElement;
    set(s: ArtState): void;
}

/** Which stick carries a function. Mode 2: throttle and yaw left. Mode 1: pitch and yaw left. */
export function sideOf(fn: Fn4, mode: 1 | 2): Side {
    if (fn === 'yaw') return 'L';
    if (fn === 'roll') return 'R';
    return (fn === 'throttle') === (mode === 2) ? 'L' : 'R';
}

/** Knob positions from mapped channels (-1..1; throttle -1 = down). Unknown (NaN) sits at 0. */
export function knobsFrom(m: Record<Fn4, number>, mode: 1 | 2): { L: [number, number]; R: [number, number] } {
    const z = (v: number): number => (Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0);
    const thrLeft = mode === 2;
    return { L: [z(m.yaw), z(thrLeft ? m.throttle : m.pitch)], R: [z(m.roll), z(thrLeft ? m.pitch : m.throttle)] };
}

const NS = 'http://www.w3.org/2000/svg';
const TRAVEL = 46; // knob travel radius in user units
const KNOB_R = 12;
const RING = 2 * Math.PI * 20;
const REACH = 0.95; // where the ghost's push ends: at the edge, where the pilot's knob will be
const LETGO_FROM: [number, number] = [0.6, 0.6]; // "let go of both sticks": spring back from a corner
let uid = 0;

const clamp1 = (v: number): number => Math.max(-1, Math.min(1, v));

function s<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, ...kids: SVGElement[]): SVGElementTagNameMap[K] {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    for (const c of kids) el.append(c);
    return el;
}

/** A small check mark as inline SVG (not a font glyph: it looks the same in every font). */
export function tickIcon(): SVGSVGElement {
    return s('svg', { viewBox: '0 0 16 16', 'aria-hidden': 'true', class: 'tick' }, s('path', { d: 'M3 8.5 L6.5 12 L13 4.5' }));
}

function cls(el: Element, name: string, on: boolean): void {
    if (el.classList.contains(name) !== on) el.classList.toggle(name, on);
}

function attr(el: Element, name: string, v: string): void {
    if (el.getAttribute(name) !== v) el.setAttribute(name, v);
}

interface Well {
    side: Side;
    g: SVGGElement;
    well: SVGRectElement;
    ghostPos: SVGGElement; // shown or hidden; the stir circles around its origin
    ghost: SVGGElement; // animated by a CSS class along --sx/--sy -> --ex/--ey
    arrow: SVGPathElement;
    tol: SVGCircleElement;
    shaft: SVGLineElement;
    kg: SVGGElement;
    knob: SVGCircleElement;
    hold: SVGCircleElement;
    ok: SVGPathElement;
    label: SVGTextElement;
}

export function radioArt(opts: { mini?: boolean } = {}): RadioArt {
    const mini = !!opts.mini;
    const markerId = `rb-ah-${++uid}`;
    const svg = s('svg', { viewBox: '0 0 400 250', class: mini ? 'rb rb-mini' : 'rb' });
    if (mini) svg.setAttribute('aria-hidden', 'true');
    else svg.setAttribute('role', 'img');
    svg.append(
        s('defs', {}, s('marker', { id: markerId, viewBox: '0 0 10 10', refX: 6, refY: 5, markerWidth: 3.5, markerHeight: 3.5, orient: 'auto-start-reverse' }, s('path', { d: 'M0,0 L10,5 L0,10 z', class: 'rb-ah' }))),
        // body with two grips
        s('path', { class: 'rb-body', d: 'M60 44 H340 Q384 44 384 92 V168 Q384 236 330 236 Q300 236 286 214 H114 Q100 236 70 236 Q16 236 16 168 V92 Q16 44 60 44 Z' })
    );
    // shoulder switches: the left one is the one we ask for as ARM; the right one is decoration
    const swLever = s('line', { class: 'rb-sw-lever', x1: 77, y1: 32, x2: 77, y2: 10 });
    const swGhost = s('line', { class: 'rb-ghost-lever rb-off', x1: 77, y1: 32, x2: 77, y2: 10 });
    const swBase = s('rect', { class: 'rb-sw-base', x: 62, y: 30, width: 30, height: 18, rx: 5 });
    const swText = s('text', { class: 'rb-lbl rb-arm-lbl rb-off', x: 77, y: 66 });
    swText.textContent = t('arm.button'); // the same word as the on-screen ARM button
    const swOk = s('path', { class: 'rb-sw-ok rb-off', d: 'M100 30 L106 36 L117 24' });
    const swHalo = s('circle', { class: 'rb-sw-halo rb-off', cx: 77, cy: 28, r: 27 });
    const sw = s('g', { class: 'rb-sw' }, swBase, swLever, swGhost);
    svg.append(
        swHalo, sw, swText, swOk,
        s('g', { class: 'rb-sw' }, s('rect', { class: 'rb-sw-base', x: 308, y: 30, width: 30, height: 18, rx: 5 }), s('line', { class: 'rb-sw-lever rb-idle', x1: 323, y1: 32, x2: 323, y2: 10 })),
        s('rect', { class: 'rb-screen', x: 172, y: 56, width: 56, height: 30, rx: 5 })
    );

    const mkWell = (side: Side, cx: number): Well => {
        const ghost = s('g', {}, s('circle', { class: 'rb-ghost', r: KNOB_R }));
        const ghostPos = s('g', { class: 'rb-off' }, ghost);
        const arrow = s('path', { class: 'rb-arrow rb-off', d: 'M0 0', 'marker-end': `url(#${markerId})` });
        const tol = s('circle', { class: 'rb-tol rb-off', r: 20 });
        const shaft = s('line', { class: 'rb-shaft', x1: 0, y1: 0, x2: 0, y2: 0 });
        const knob = s('circle', { class: 'rb-knob unknown', r: mini ? 20 : KNOB_R }); // mini: readable at 96 px
        const hold = s('circle', { class: 'rb-hold rb-off', r: 20, transform: 'rotate(-90)', 'stroke-dasharray': `0 ${RING}` });
        const ok = s('path', { class: 'rb-ok rb-off', d: 'M-7 0 L-2 5 L8 -6' });
        const kg = s('g', { class: 'rb-kg' }, hold, knob, ok);
        const label = s('text', { class: 'rb-lbl', x: 0, y: 94 });
        const well = s('rect', { class: 'rb-well', x: -58, y: -58, width: 116, height: 116, rx: 18 });
        const g = s('g', { class: 'rb-w', transform: `translate(${cx} 150)` },
            well,
            s('circle', { class: 'rb-ring', r: TRAVEL }),
            s('line', { class: 'rb-cross', x1: -TRAVEL, y1: 0, x2: TRAVEL, y2: 0 }),
            s('line', { class: 'rb-cross', x1: 0, y1: -TRAVEL, x2: 0, y2: TRAVEL }),
            tol, ghostPos, arrow, shaft, kg, label);
        svg.append(g);
        return { side, g, well, ghostPos, ghost, arrow, tol, shaft, kg, knob, hold, ok, label };
    };
    const wells = [mkWell('L', 110), mkWell('R', 290)];

    let lastMode = 0;
    const set = (st: ArtState): void => {
        if (st.mode !== lastMode) {
            lastMode = st.mode;
            const ax = (k: Fn4): string => t(`wizard.axis.${k}`);
            wells[0].label.textContent = st.mode === 2 ? `${ax('throttle')} · ${ax('yaw')}` : `${ax('pitch')} · ${ax('yaw')}`;
            wells[1].label.textContent = st.mode === 2 ? `${ax('pitch')} · ${ax('roll')}` : `${ax('throttle')} · ${ax('roll')}`;
        }
        if (!mini) attr(svg, 'aria-label', st.label);
        const tg = st.target;
        const swTarget = tg !== null && tg.side === 'SW';
        const stick = tg !== null && tg.side !== 'SW' ? tg : null;
        for (const w of wells) {
            const main = stick !== null && (stick.side === 'both' || stick.side === w.side);
            const extra = !!st.also && st.also.side === w.side;
            let dir: Dir | null = main && stick ? stick.dir : null;
            if (extra && st.also) dir = st.also.dir;
            const single = main && stick !== null && stick.side === w.side;
            const home: [number, number] = single && st.home ? [clamp1(st.home[0]), clamp1(st.home[1])] : [0, 0];
            const from: [number, number] | null = single && st.from ? [clamp1(st.from[0]), clamp1(st.from[1])] : null;
            const at = `translate(${(home[0] * TRAVEL).toFixed(1)} ${(-home[1] * TRAVEL).toFixed(1)})`;
            cls(w.well, 'target', main || extra);
            cls(w.label, 'target', main || extra);
            cls(w.g, 'rb-dim', st.dimOthers !== false && tg !== null && !main && !extra);
            cls(w.g, 'rb-w-stir', dir === 'stir');
            // ghost path (x right +, y up +): a push starts where the stick rests and ends at the
            // edge; a let-go starts where the stick was pushed and springs back to its rest
            let a: [number, number] = home;
            let b: [number, number] = home;
            if (dir === 'up') { a = from ?? home; b = [a[0], REACH]; }
            else if (dir === 'down') { a = from ?? home; b = [a[0], -REACH]; }
            else if (dir === 'right') { a = from ?? home; b = [REACH, a[1]]; }
            else if (dir === 'centre') a = from ?? (single ? home : LETGO_FROM);
            const moving = dir !== null && dir !== 'stir' && !st.ok && (a[0] !== b[0] || a[1] !== b[1]);
            cls(w.ghostPos, 'rb-off', dir === null);
            attr(w.ghostPos, 'transform', dir === 'stir' ? at : '');
            attr(w.ghost, 'class', dir === 'stir' ? 'rb-g-stir' : moving ? 'rb-g-move' : 'rb-g-at');
            const px = (v: number): string => `${(v * TRAVEL).toFixed(1)}px`;
            attr(w.ghost, 'style', `--sx:${px(a[0])};--sy:${px(-a[1])};--ex:${px(b[0])};--ey:${px(-b[1])}`);
            // arrow beside the well
            const ax = w.side === 'L' ? -70 : 70;
            const d = dir === 'up' ? `M${ax} 34 L${ax} -30` : dir === 'down' ? `M${ax} -34 L${ax} 30` : dir === 'right' ? 'M-34 70 L30 70' : '';
            cls(w.arrow, 'rb-off', d === '');
            if (d) attr(w.arrow, 'd', d);
            // "let go here": the knob must sit inside this dashed zone
            const tolOn = dir === 'centre' && st.tol > 0;
            cls(w.tol, 'rb-off', !tolOn);
            if (tolOn) { attr(w.tol, 'r', (KNOB_R + 2 + st.tol * TRAVEL).toFixed(1)); attr(w.tol, 'transform', at); }
            // the pilot's knob
            const k = w.side === 'L' ? st.knobL : st.knobR;
            const x = k ? Math.max(-1, Math.min(1, k[0])) * TRAVEL : 0;
            const y = k ? -Math.max(-1, Math.min(1, k[1])) * TRAVEL : 0;
            attr(w.kg, 'transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
            attr(w.shaft, 'x2', x.toFixed(1));
            attr(w.shaft, 'y2', y.toFixed(1));
            cls(w.knob, 'unknown', k === null);
            const hold = single ? Math.max(0, Math.min(1, st.hold)) : 0;
            cls(w.hold, 'rb-off', hold <= 0.001);
            attr(w.hold, 'stroke-dasharray', `${(hold * RING).toFixed(1)} ${RING.toFixed(1)}`);
            cls(w.ok, 'rb-off', !(single && st.ok));
        }
        const swDir = tg !== null && tg.side === 'SW' ? tg.dir : null;
        cls(sw, 'target', swTarget);
        cls(swHalo, 'rb-off', !swTarget);
        cls(swGhost, 'rb-off', !swTarget);
        // the ghost lever goes to the asked position; 'flip' means away from where it is now
        cls(swGhost, 'to-off', swDir === 'off' || (swDir === 'flip' && st.sw === true));
        cls(swGhost, 'rb-done', swTarget && st.ok); // taken: the ghost rests at its goal
        cls(swText, 'rb-off', !swTarget);
        cls(swOk, 'rb-off', !(swTarget && st.ok));
        cls(swLever, 'on', st.sw === true);
        cls(swLever, 'unknown', st.sw === null);
    };
    return { el: svg, set };
}
