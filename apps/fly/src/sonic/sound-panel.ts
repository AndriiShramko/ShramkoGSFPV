// The sound panel of the Fly by Sound mode: how a deaf pilot hears (v0.13, the owner's message 41: "it would be good to show this
// sound visually at these steps: you only play the sound, and there is nothing in the picture that matches it"; message 42: deaf
// pilots must be able to train and check it too; plan M41-25; the sound package's merge review W14; lane v13-look L2-2). It draws
// what the engine plans, never a guess of its own:
//
//   radar    seen from above, the nose up: every active cue with a direction (FlyBySoundEngine.plan.cues, the heading frame) at
//            its direction and, when it has one, its distance (rings at 1, 2 and 4 m); an icon and a colour per kind (wall,
//            floor or ceiling, open way, target (a gate's hum, notes and shape), checkpoint, wrong way, praise; a pillar's shape
//            trace is an obstacle's, the wall kind). A cue whose direction rises or falls 20 degrees
//            or more carries an "above" or "below" mark; one almost straight up or down (the ceiling over the craft, the floor
//            under it) sits at the top or the bottom of the height bar instead. The open way above or below: since the
//            package's lane s13-elev its chime comes from the middle of that way (plan.freeWay.dir, middleM), so its own
//            direction carries the mark; with the pilot's "Sound from above and below" off (SonicPrefs.heightDirection) it
//            sounds from ahead and its pitch tells the way (M41-14), so the mark comes from the plan's side. The target note
//            (height.target) comes from its target with that setting on (plan.height.target.dir, the cue's dir): then it is
//            on the radar too, as the target's, at that direction and marked above or below by it; off, the bar alone.
//            A cue without a direction (a touch, a checkpoint's chime, praise) shows on the craft in the middle for a moment.
//   height   a bar from the floor to the room's top with the craft's height tone (plan.height.heightM; drawn jagged while the
//            tone is rough, outside the lesson's band) and the target note (plan.height.target.heightM), bolder for noteS of
//            every periodS, as the engine plays it about once a second; the ceiling's and the floor's sounds at its ends.
//   now      while a step plays a sound three times (M41-5; the runner's view().playing): that sound's icon, its name in the
//            sound glossary's words (the package's dictionaries: cue.<id>.name, four languages) and "2 of 3".
//
// Hidden from screen readers (aria-hidden: the speech already says it); never takes a pointer. Pure up to SoundPanel:
// cueKind, radarItems and heightBar are what Node tests hold (tools/bench/test/sonic-panels.test.ts).
import type { ActiveCue, FramePlan, FreeWay } from '@shramko/sonic-fpv';
import { contrastRatio } from './look';
import { MARK_CONTRAST, swatch } from './attitude';
import type { Box, Scheme, Swatch } from './attitude';

/** What a cue is, for its icon and colour. The first seven show on the radar; the rest are the height bar's or not drawn. */
export type CueKind = 'wall' | 'surface' | 'open' | 'target' | 'checkpoint' | 'wrong' | 'praise' | 'tone' | 'tick' | 'room';
export const RADAR_KINDS: readonly CueKind[] = ['wall', 'surface', 'open', 'target', 'checkpoint', 'wrong', 'praise'];

/** A cue id without its sector or preview suffix: 'safety.wall:front' and 'safety.wall:preview' are 'safety.wall'. */
export function cueBase(id: string): string {
    const i = id.indexOf(':');
    return i < 0 ? id : id.slice(0, i);
}

const KIND_OF: Readonly<Record<string, CueKind>> = {
    'safety.wall': 'wall',
    'safety.obstacle': 'wall',
    'safety.touch': 'wall',
    'safety.floor': 'surface',
    'safety.ceiling': 'surface',
    'safety.free': 'open',
    'safety.wrong-way': 'wrong',
    'safety.wrong-side': 'wrong',
    'safety.reset': 'checkpoint',
    'target.checkpoint': 'checkpoint',
    'target.praise': 'praise',
    'target.fanfare': 'praise',
    'target.stage': 'praise',
    // sonic-keys: the answer sound (a digit taken, not taken, a question waiting) is a short blip, not a place on the radar
    'target.answer': 'tick',
    'target.hum': 'target',
    'target.off': 'target',
    'target.note': 'target',
    'target.lap': 'target',
    // the shape trace of a gate is the target's; of a pillar, an obstacle's (it traces the nearest solid object when no gate is next)
    'shape.ring': 'target',
    'shape.square': 'target',
    'shape.cube': 'target',
    'shape.pillar': 'wall',
    'height.tone': 'tone',
    'height.rough': 'tone',
    'height.target': 'tone',
    'speed.tick': 'tick',
    'room.bed': 'room'
};

/** The kind of a cue id (with or without its suffix), or null for one this build does not know. */
export function cueKind(id: string): CueKind | null {
    return KIND_OF[cueBase(id)] ?? null;
}

// ------------------------------------------------------------------ colours and icons

/** The disc of each kind, by the page's scheme: bright on the dark box, deep on the light one (4.5:1 against it either way). */
export const KIND_COLOURS: Readonly<Record<Scheme, Readonly<Record<CueKind, Swatch>>>> = {
    dark: {
        wall: swatch('#ff8c1a'),
        surface: swatch('#c4a5ff'),
        open: swatch('#39e07a'),
        target: swatch('#33d6ff'),
        checkpoint: swatch('#ff8fd8'),
        wrong: swatch('#ff5252'),
        praise: swatch('#ffe14d'),
        tone: swatch('#ffd400'),
        tick: swatch('#d0d0d0'),
        room: swatch('#d0d0d0')
    },
    light: {
        wall: swatch('#b34700'),
        surface: swatch('#5b3fbf'),
        open: swatch('#0a7a3a'),
        target: swatch('#006d8f'),
        checkpoint: swatch('#a3006b'),
        wrong: swatch('#c40000'),
        praise: swatch('#8a6a00'),
        tone: swatch('#7a4a00'),
        tick: swatch('#4a4a4a'),
        room: swatch('#4a4a4a')
    }
};

/** The box and its lines, by scheme; the glyph on a disc (black on the bright ones, white on the deep ones). */
export const PANEL: Readonly<Record<Scheme, { readonly bg: Swatch; readonly fg: Swatch; readonly ring: Swatch; readonly glyph: Swatch }>> = {
    dark: { bg: swatch('#000000'), fg: swatch('#ffffff'), ring: swatch('#9a9a9a'), glyph: swatch('#000000') },
    light: { bg: swatch('#ffffff'), fg: swatch('#000000'), ring: swatch('#666666'), glyph: swatch('#ffffff') }
};

/** Every pair of a mark and what it lies on: what the contrast rule holds (sonic-panels.test.ts). */
export function soundPairs(scheme: Scheme): Record<string, number> {
    const p = PANEL[scheme];
    const out: Record<string, number> = { 'line : box': contrastRatio(p.fg.lum, p.bg.lum), 'ring : box': contrastRatio(p.ring.lum, p.bg.lum) };
    for (const [k, c] of Object.entries(KIND_COLOURS[scheme])) {
        out[`${k} : box`] = contrastRatio(c.lum, p.bg.lum);
        out[`${k} glyph : ${k}`] = contrastRatio(p.glyph.lum, c.lum);
    }
    return out;
}
export { MARK_CONTRAST };

/** Each kind's glyph and the two elevation marks: SVG path data in a 24 x 24 box, filled even-odd. */
export const ICONS: Readonly<Record<CueKind | 'above' | 'below', string>> = {
    // bricks
    wall: 'M2 4h9v5H2zM13 4h9v5h-9zM2 11h4v5H2zM8 11h8v5H8zM18 11h4v5h-4zM2 18h9v4H2zM13 18h9v4h-9z',
    // a slab: a floor or a ceiling (the above or below mark says which)
    surface: 'M1 8.5h22v7H1z',
    // a way between two walls, an arrow through it
    open: 'M1 3h5v18H1zM18 3h5v18h-5zM12 3l5 6.5h-3.2V21h-3.6V9.5H7z',
    // a ring with its centre
    target: 'M12 1.5a10.5 10.5 0 1 0 0 21a10.5 10.5 0 1 0 0-21zM12 6a6 6 0 1 1 0 12a6 6 0 1 1 0-12zM12 9.3a2.7 2.7 0 1 0 0 5.4a2.7 2.7 0 1 0 0-5.4z',
    // a flag
    checkpoint: 'M4 2h2.6v20H4zM6.6 3h13l-3.4 4.5 3.4 4.5h-13z',
    // no way: a disc with a bar through it
    wrong: 'M12 1.5a10.5 10.5 0 1 0 0 21a10.5 10.5 0 1 0 0-21zM5 10h14v4H5z',
    // a star
    praise: 'M12 1.5l3.1 6.6 7.2.9-5.3 5 1.4 7.1L12 17.6l-6.4 3.5 1.4-7.1-5.3-5 7.2-.9z',
    // a note
    tone: 'M10 3h2.4v13.6A3.6 3.1 0 1 1 10 13.8zM12.4 3H20v3.4h-7.6z',
    // ticks
    tick: 'M3 5h18v3H3zM3 10.5h18v3H3zM3 16h18v3H3z',
    // a house: the room
    room: 'M12 2.5l10 9h-3V21H5v-9.5H2z',
    // a bar over an arrow up; an arrow down over a bar
    above: 'M3 1.5h18v3.5H3zM12 6.5l7 7.5h-4.4V22H9.4v-8H5z',
    below: 'M9.4 2h5.2v8H19l-7 7.5L5 10h4.4zM3 19h18v3.5H3z'
};

// ------------------------------------------------------------------ the radar

/** A cue's direction counts as rising or falling from this sine of its elevation (20 degrees). */
export const ELEVATION_SIN = Math.sin((20 * Math.PI) / 180);
/** The target note's cue: on the height bar, and on the radar when it has a direction (lane s13-elev's heightDirection). */
export const TARGET_NOTE_ID = 'height.target';
/** A cue whose direction lies within this of straight up or down (its level part under it) goes on the height bar. */
export const VERTICAL_LEVEL = 0.42;
/** The radar's outer ring, metres; rings at 1, 2 and 4 m. */
export const RADAR_FAR_M = 8;
export const RADAR_RINGS_M: readonly number[] = [1, 2, 4];

/** Where a distance lies on the radar, as a share of its radius (the craft's own disc inside 0.3, the rim at RADAR_FAR_M). */
export function radiusOf(distanceM: number | null): number {
    if (distanceM === null || !Number.isFinite(distanceM)) return 0.86;
    return 0.34 + 0.56 * Math.min(1, Math.log1p(Math.max(0, distanceM)) / Math.log1p(RADAR_FAR_M));
}

export interface RadarItem {
    readonly id: string;
    readonly kind: CueKind;
    /** on the radar, shares of its radius: x right, y down (the nose up) */
    readonly x: number;
    readonly y: number;
    /** the cue's direction rises or falls (20 degrees or more), or the open way lies above or below */
    readonly elev: 'above' | 'below' | null;
    /** a cue almost straight up or down: drawn at that end of the height bar, not on the radar */
    readonly bar: 'top' | 'bottom' | null;
    /** no direction: the craft's own (drawn on it, for a moment) */
    readonly event: boolean;
    /** the plan says a hazard is urgent */
    readonly urgent: boolean;
}

/**
 * The cues of a plan as the radar and the bar draw them. The height, speed and room cues are the bar's or none; a cue this build
 * does not know is left out. `freeWay`: the plan's, whose side marks the open way's chime above or below.
 */
export function radarItems(cues: readonly ActiveCue[], freeWay: FreeWay | null, urgent = false): RadarItem[] {
    const out: RadarItem[] = [];
    for (const c of cues) {
        // the target note is the height bar's; when it comes from its target (the package's heightDirection on: a gate's centre,
        // the band's middle ahead) it is on the radar too, at that direction, as the target's
        const kind = c.id === TARGET_NOTE_ID && c.dir !== null ? 'target' : cueKind(c.id);
        if (kind === null || !RADAR_KINDS.includes(kind)) continue;
        const hot = urgent && (kind === 'wall' || kind === 'surface');
        if (c.dir === null) {
            out.push({ id: c.id, kind, x: 0, y: 0, elev: null, bar: null, event: true, urgent: hot });
            continue;
        }
        const [dx, dy, dz] = c.dir;
        const len = Math.hypot(dx, dy, dz) || 1;
        const level = Math.hypot(dx, dz) / len;
        const sinEl = dy / len;
        let elev: RadarItem['elev'] = sinEl >= ELEVATION_SIN ? 'above' : sinEl <= -ELEVATION_SIN ? 'below' : null;
        if (elev === null && kind === 'open') {
            // the chime of a way above or below sounds from ahead (its pitch says which): the plan's side, else the cue's own suffix;
            // a preview of the chime (the glossary, a step's three plays) has neither
            const i = c.id.indexOf(':');
            const suffix = i < 0 ? '' : c.id.slice(i + 1);
            const side = suffix === 'preview' ? null : (freeWay?.side ?? suffix);
            if (side === 'up') elev = 'above';
            else if (side === 'down') elev = 'below';
        }
        if (level < VERTICAL_LEVEL) {
            out.push({ id: c.id, kind, x: 0, y: 0, elev: sinEl > 0 ? 'above' : 'below', bar: sinEl > 0 ? 'top' : 'bottom', event: false, urgent: hot });
            continue;
        }
        const r = radiusOf(c.distance);
        out.push({ id: c.id, kind, x: (dx / len / level) * r, y: (dz / len / level) * r, elev, bar: null, event: false, urgent: hot });
    }
    return out;
}

/** How long a cue stays drawn after the plan last had it, ms: a moment for one without a direction, a frame's gap for the rest. */
export const HOLD_EVENT_MS = 1200;
export const HOLD_MS = 150;

/** Keeps every item drawn for its hold after the plan drops it (a chime of 0.3 s is seen; a voice that skips a frame does not blink). */
export class CueMemory {
    private readonly kept = new Map<string, { item: RadarItem; until: number }>();

    update(items: readonly RadarItem[], now: number): RadarItem[] {
        for (const it of items) this.kept.set(it.id, { item: it, until: now + (it.event ? HOLD_EVENT_MS : HOLD_MS) });
        const out: RadarItem[] = [];
        for (const [id, k] of this.kept) {
            if (k.until < now) this.kept.delete(id);
            else out.push(k.item);
        }
        return out;
    }

    clear(): void {
        this.kept.clear();
    }
}

// ------------------------------------------------------------------ the height bar

export interface HeightBar {
    /** the bar's top, metres above the floor */
    readonly topM: number;
    /** the craft's height tone, metres above the floor; null when the lesson has no height layer */
    readonly toneM: number | null;
    /** the tone is rough (outside the lesson's band) */
    readonly rough: boolean;
    /** the target note's height, or null */
    readonly targetM: number | null;
    readonly periodS: number | null;
    readonly noteS: number | null;
    /** the target note sounds now (noteS of every periodS; the phase is the page's clock, not the engine's: see the lane doc) */
    readonly noteOn: boolean;
}

/** The bar from the plan's height layer. `topM`: the room's top (the attitude tape's scale), `nowMs` the page's clock. */
export function heightBar(plan: FramePlan | null, topM: number, nowMs: number): HeightBar {
    const h = plan?.height ?? null;
    const tg = h?.target ?? null;
    const periodS = tg && Number.isFinite(tg.periodS) && tg.periodS > 0 ? tg.periodS : null;
    const noteS = tg && Number.isFinite(tg.noteS) && tg.noteS > 0 ? tg.noteS : null;
    const top = Math.max(topM, h ? Math.ceil(h.heightM + 0.5) : 0, tg ? Math.ceil(tg.heightM + 0.5) : 0);
    return {
        topM: top,
        toneM: h ? h.heightM : null,
        rough: h ? h.rough > 0 : false,
        targetM: tg ? tg.heightM : null,
        periodS,
        noteS,
        noteOn: periodS !== null && noteS !== null ? ((nowMs / 1000) % periodS) < noteS : false
    };
}

// ------------------------------------------------------------------ drawing

/** Where a cue's disc is drawn, canvas pixels: its radius, and whether its elevation mark sits beside it. */
export interface DiscPlace {
    readonly id: string;
    readonly x: number;
    readonly y: number;
    readonly r: number;
    readonly mark: boolean;
}

export interface SoundLayout {
    readonly w: number;
    readonly h: number;
    readonly radar: { readonly cx: number; readonly cy: number; readonly r: number };
    readonly bar: Box;
    /** the radius of a cue's disc, px */
    readonly icon: number;
}

/** The canvas's width for a height `h`: the radar (h) and the height bar. */
export const SOUND_ASPECT = 1.36;

export function soundLayout(w: number, h: number): SoundLayout {
    const pad = Math.max(2, 0.03 * h);
    const barW = Math.max(26, 0.26 * h);
    const d = Math.min(h - 2 * pad, w - 3 * pad - barW);
    const radar = { cx: pad + d / 2, cy: h / 2, r: d / 2 };
    const bar = { x0: w - pad - barW, y0: pad, x1: w - pad, y1: h - pad };
    return { w, h, radar, bar, icon: Math.max(10, 0.12 * d) };
}

/**
 * The discs' places: a cue with a direction at it (inside the radar's rim), moved apart where two would touch (two sectors of one
 * wall, a hazard and the open way beside it: their directions are 45 degrees apart and close to the craft), a few steps, each
 * pair pushed apart along the line between them; the cues of the craft itself side by side on it, those of the ceiling and the
 * floor at the height bar's ends. Pure: the drawing and the page's report use the same places.
 */
export function placeDiscs(items: readonly RadarItem[], l: SoundLayout): DiscPlace[] {
    const { cx, cy, r } = l.radar;
    const ir = l.icon;
    const lim = Math.max(0, r - ir - 1);
    const keep = (q: { x: number; y: number }): void => {
        const k = Math.hypot(q.x - cx, q.y - cy);
        if (k > lim) {
            q.x = cx + ((q.x - cx) * lim) / k;
            q.y = cy + ((q.y - cy) * lim) / k;
        }
    };
    const radar = items.filter((it) => !it.event && !it.bar).map((it) => {
        const q = { id: it.id, x: cx + it.x * r, y: cy + it.y * r, r: ir, mark: it.elev !== null, dx: it.x, dy: it.y };
        keep(q);
        return q;
    });
    // the mark beside a disc makes it wider: kept apart as a disc 1.5 times as large
    const reach = (q: { r: number; mark: boolean }): number => q.r * (q.mark ? 1.5 : 1);
    for (let step = 0; step < 16; step++) {
        let moved = false;
        for (let i = 0; i < radar.length; i++) for (let j = i + 1; j < radar.length; j++) {
            const a = radar[i]!, b = radar[j]!;
            let ux = b.x - a.x, uy = b.y - a.y;
            let d = Math.hypot(ux, uy);
            const need = reach(a) + reach(b) + 2;
            if (d >= need) continue;
            if (d < 1e-6) {
                // on the same spot: apart across the first one's direction
                ux = -a.dy || 1;
                uy = a.dx;
                d = Math.hypot(ux, uy);
            }
            const push = (need - d) / 2 / d;
            a.x -= ux * push;
            a.y -= uy * push;
            b.x += ux * push;
            b.y += uy * push;
            keep(a);
            keep(b);
            moved = true;
        }
        if (!moved) break;
    }
    const out: DiscPlace[] = radar.map((q) => ({ id: q.id, x: q.x, y: q.y, r: q.r, mark: q.mark }));
    const events = items.filter((it) => it.event);
    events.forEach((it, i) => out.push({ id: it.id, x: cx + (i - (events.length - 1) / 2) * 1.6 * ir, y: cy, r: 1.15 * ir, mark: false }));
    const b = l.bar;
    for (const it of items) if (it.bar) out.push({ id: it.id, x: (b.x0 + b.x1) / 2, y: it.bar === 'top' ? b.y0 + 0.9 * ir : b.y1 - 0.9 * ir, r: 0.85 * ir, mark: false });
    return out;
}

type G = CanvasRenderingContext2D;

const paths = new Map<string, Path2D>();
function pathOf(d: string): Path2D {
    let p = paths.get(d);
    if (!p) {
        p = new Path2D(d);
        paths.set(d, p);
    }
    return p;
}

/** A glyph of ICONS centred at (x, y), `size` px across, in `css`. */
function glyph(g: G, name: keyof typeof ICONS, x: number, y: number, size: number, css: string): void {
    g.save();
    g.translate(x - size / 2, y - size / 2);
    g.scale(size / 24, size / 24);
    g.fillStyle = css;
    g.fill(pathOf(ICONS[name]), 'evenodd');
    g.restore();
}

/** A cue's disc: the kind's colour, a ring in the box's line colour (thicker when urgent), the glyph, the elevation mark beside it. */
function disc(g: G, it: Pick<RadarItem, 'kind' | 'elev' | 'urgent'>, x: number, y: number, r: number, scheme: Scheme): void {
    const p = PANEL[scheme];
    g.beginPath();
    g.arc(x, y, r, 0, 2 * Math.PI);
    g.fillStyle = KIND_COLOURS[scheme][it.kind].css;
    g.fill();
    g.lineWidth = it.urgent ? Math.max(3, 0.22 * r) : Math.max(1.5, 0.1 * r);
    g.strokeStyle = p.fg.css;
    g.stroke();
    glyph(g, it.kind, x, y, 1.25 * r, p.glyph.css);
    if (it.elev) {
        const s = 0.95 * r;
        const mx = x + r + 0.55 * s;
        g.beginPath();
        g.arc(mx, y, 0.62 * s, 0, 2 * Math.PI);
        g.fillStyle = p.bg.css;
        g.fill();
        glyph(g, it.elev, mx, y, s, p.fg.css);
    }
}

export interface SoundModel {
    readonly items: readonly RadarItem[];
    readonly bar: HeightBar;
}

export function drawSounds(g: G, l: SoundLayout, m: SoundModel, scheme: Scheme): void {
    const p = PANEL[scheme];
    const { cx, cy, r } = l.radar;
    g.clearRect(0, 0, l.w, l.h);
    // the rings at 1, 2 and 4 m, the cross of the four sides
    g.strokeStyle = p.ring.css;
    g.lineWidth = 1.5;
    for (const d of RADAR_RINGS_M) {
        g.beginPath();
        g.arc(cx, cy, radiusOf(d) * r, 0, 2 * Math.PI);
        g.stroke();
    }
    g.lineWidth = 2;
    g.strokeStyle = p.fg.css;
    g.beginPath();
    g.arc(cx, cy, r - 1, 0, 2 * Math.PI);
    g.stroke();
    g.strokeStyle = p.ring.css;
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(cx, cy - r);
    g.lineTo(cx, cy - 0.2 * r);
    g.moveTo(cx, cy + 0.2 * r);
    g.lineTo(cx, cy + r);
    g.moveTo(cx - r, cy);
    g.lineTo(cx - 0.2 * r, cy);
    g.moveTo(cx + 0.2 * r, cy);
    g.lineTo(cx + r, cy);
    g.stroke();
    // the craft, its nose up
    g.fillStyle = p.fg.css;
    g.beginPath();
    g.moveTo(cx, cy - 0.15 * r);
    g.lineTo(cx + 0.1 * r, cy + 0.1 * r);
    g.lineTo(cx, cy + 0.04 * r);
    g.lineTo(cx - 0.1 * r, cy + 0.1 * r);
    g.closePath();
    g.fill();
    // the cues with a direction, then those of the craft itself on top of it (the bar's after the bar)
    const ir = l.icon;
    const places = placeDiscs(m.items, l);
    const byId = new Map(m.items.map((it) => [it.id, it]));
    for (const q of places) {
        const it = byId.get(q.id);
        if (it && !it.bar) disc(g, it, q.x, q.y, q.r, scheme);
    }
    // the height bar: the floor and the room's top, the tone, the target note, the sounds of the ceiling and the floor at its ends
    const b = l.bar;
    const bw = b.x1 - b.x0;
    const pad = Math.max(ir * 1.1, 0.08 * (b.y1 - b.y0));
    const y0 = b.y1 - pad, y1 = b.y0 + pad;
    const yOf = (mm: number): number => y0 - (Math.max(0, Math.min(mm, m.bar.topM)) / m.bar.topM) * (y0 - y1);
    g.strokeStyle = p.fg.css;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(b.x0 + bw / 2, y0);
    g.lineTo(b.x0 + bw / 2, y1);
    g.stroke();
    for (let mm = 0; mm <= m.bar.topM + 1e-9; mm += 1) {
        const y = yOf(mm);
        g.lineWidth = mm === 0 ? 3 : 1.5;
        g.beginPath();
        g.moveTo(b.x0 + (mm === 0 ? 0.08 : 0.32) * bw, y);
        g.lineTo(b.x1 - (mm === 0 ? 0.08 : 0.32) * bw, y);
        g.stroke();
    }
    if (m.bar.targetM !== null) {
        const y = yOf(m.bar.targetM);
        const c = KIND_COLOURS[scheme].target.css;
        g.strokeStyle = c;
        g.lineWidth = m.bar.noteOn ? Math.max(6, 0.06 * l.h) : Math.max(3, 0.025 * l.h);
        g.beginPath();
        g.moveTo(b.x0 + 0.06 * bw, y);
        g.lineTo(b.x1 - 0.06 * bw, y);
        g.stroke();
        if (m.bar.noteOn) {
            g.beginPath();
            g.arc(b.x0 + bw / 2, y, 0.42 * bw, 0, 2 * Math.PI);
            g.lineWidth = 2.5;
            g.stroke();
        }
    }
    if (m.bar.toneM !== null) {
        const y = yOf(m.bar.toneM);
        g.strokeStyle = KIND_COLOURS[scheme].tone.css;
        g.lineWidth = Math.max(4, 0.035 * l.h);
        g.lineJoin = 'miter';
        g.beginPath();
        if (m.bar.rough) {
            // jagged: the tone buzzes outside the lesson's band
            const n = 6;
            for (let i = 0; i <= n; i++) {
                const x = b.x0 + 0.04 * bw + (i / n) * 0.92 * bw;
                const dy = (i % 2 === 0 ? -1 : 1) * 0.06 * bw;
                if (i === 0) g.moveTo(x, y + dy);
                else g.lineTo(x, y + dy);
            }
        } else {
            g.moveTo(b.x0 + 0.04 * bw, y);
            g.lineTo(b.x1 - 0.04 * bw, y);
        }
        g.stroke();
        glyph(g, 'tone', b.x0 + bw / 2, y - 0.32 * bw, 0.5 * bw, p.fg.css);
    }
    for (const q of places) {
        const it = byId.get(q.id);
        if (it?.bar) disc(g, { ...it, elev: null }, q.x, q.y, q.r, scheme);
    }
}

// ------------------------------------------------------------------ the panel on the page

/** A step playing a sound three times (the runner's view().playing). */
export interface Playing {
    readonly cue: string;
    readonly index: number;
    readonly of: number;
}

export interface SoundState {
    readonly plan: FramePlan | null;
    readonly playing: Playing | null;
    /** the room's top, metres above the floor (the attitude tape's scale top) */
    readonly topM: number;
    /** the page's clock, ms */
    readonly now: number;
}

/** What the page's test hook reports of the panel (v13-look-page.ts checks the picture at these places). */
export interface SoundReport {
    readonly shown: boolean;
    readonly scheme: Scheme;
    readonly canvas: { x: number; y: number; w: number; h: number } | null;
    readonly layout: SoundLayout | null;
    readonly items: readonly RadarItem[];
    /** where each item's disc is drawn (placeDiscs), canvas pixels */
    readonly places: readonly DiscPlace[];
    readonly bar: HeightBar | null;
    /** the card of a sound played three times: what it shows, or null */
    readonly now: { cue: string; kind: CueKind | null; name: string; count: string } | null;
    readonly freeWay: FreeWay | null;
    /** the engine's last plan as the panel read it: its time and every active cue's id (the truth the drawing is checked against) */
    readonly plan: { t: number; cues: string[] } | null;
    readonly draws: number;
    readonly drawMs: number;
}

export interface SoundPanelOptions {
    readonly parent: HTMLElement;
    /** the panel's own words (packages/i18n/locales/fly/soniclook) */
    readonly text: (key: string, vars?: Record<string, string | number>) => string;
    /** a cue's name in the sound glossary's words (the package's cue.<id>.name) */
    readonly cueName: (cueBase: string) => string;
    readonly scheme: () => Scheme;
}

/** The card of a sound played three times stays this long after the play (the runner's gap between plays is about 1 s), ms. */
export const NOW_HOLD_MS = 1400;

const SVG = 'http://www.w3.org/2000/svg';

export class SoundPanel {
    readonly root: HTMLElement;
    private readonly canvas: HTMLCanvasElement;
    private readonly nowBox: HTMLElement;
    private readonly nowDisc: SVGCircleElement;
    private readonly nowGlyph: SVGPathElement;
    private readonly nowName: HTMLElement;
    private readonly nowCount: HTMLElement;
    private readonly o: SoundPanelOptions;
    private readonly memory = new CueMemory();
    private readonly observer: ResizeObserver | null = null;
    private css = { w: 0, h: 0 };
    private key = '';
    private on = false;
    private items: readonly RadarItem[] = [];
    private bar: HeightBar | null = null;
    private freeWay: FreeWay | null = null;
    private planSeen: { t: number; cues: string[] } | null = null;
    private playing: { p: Playing; until: number } | null = null;
    private nowKey = '';
    private draws = 0;
    private drawMs = 0;

    constructor(o: SoundPanelOptions) {
        this.o = o;
        const root = document.createElement('div');
        root.className = 'sonic-sounds';
        root.dataset.testid = 'sonic-sounds';
        root.setAttribute('aria-hidden', 'true');
        root.hidden = true;
        const title = document.createElement('p');
        title.className = 'sonic-sounds-title';
        title.textContent = o.text('soniclook.sounds.title');
        const body = document.createElement('div');
        body.className = 'sonic-sounds-body';
        const canvas = document.createElement('canvas');
        const now = document.createElement('div');
        now.className = 'sonic-sounds-now';
        now.dataset.testid = 'sonic-sounds-now';
        now.hidden = true;
        const svg = document.createElementNS(SVG, 'svg');
        svg.setAttribute('viewBox', '-2 -2 28 28');
        svg.setAttribute('class', 'sonic-sounds-icon');
        const circle = document.createElementNS(SVG, 'circle');
        circle.setAttribute('cx', '12');
        circle.setAttribute('cy', '12');
        circle.setAttribute('r', '13');
        circle.setAttribute('stroke-width', '1.5');
        const path = document.createElementNS(SVG, 'path');
        path.setAttribute('fill-rule', 'evenodd');
        path.setAttribute('transform', 'translate(4.5 4.5) scale(0.625)');
        svg.append(circle, path);
        const name = document.createElement('span');
        name.className = 'sonic-sounds-name';
        const count = document.createElement('span');
        count.className = 'sonic-sounds-count';
        now.append(svg, name, count);
        body.append(canvas, now);
        root.append(title, body);
        o.parent.append(root);
        this.root = root;
        this.canvas = canvas;
        this.nowBox = now;
        this.nowDisc = circle;
        this.nowGlyph = path;
        this.nowName = name;
        this.nowCount = count;
        if (typeof ResizeObserver !== 'undefined') {
            this.observer = new ResizeObserver(() => this.measure());
            this.observer.observe(canvas);
        }
    }

    private measure(): void {
        this.css = { w: this.canvas.clientWidth, h: this.canvas.clientHeight };
        this.key = '';
    }

    show(on: boolean): void {
        if (on === this.on) return;
        this.on = on;
        this.root.hidden = !on;
        if (on) this.measure();
        else {
            this.memory.clear();
            this.playing = null;
            this.showNow(null);
        }
    }

    get shown(): boolean {
        return this.on;
    }

    /** The card of a sound played three times: its icon, its name and the play's number (drawn only when it changes). */
    private showNow(p: Playing | null): void {
        const scheme = this.o.scheme();
        const key = p ? `${p.cue} ${p.index} ${p.of} ${scheme}` : '';
        if (key === this.nowKey) return;
        this.nowKey = key;
        if (!p) {
            this.nowBox.hidden = true;
            return;
        }
        const base = cueBase(p.cue);
        const kind = cueKind(base) ?? 'tone';
        const panel = PANEL[scheme];
        this.nowDisc.setAttribute('fill', KIND_COLOURS[scheme][kind].css);
        this.nowDisc.setAttribute('stroke', panel.fg.css);
        this.nowGlyph.setAttribute('d', ICONS[kind]);
        this.nowGlyph.setAttribute('fill', panel.glyph.css);
        this.nowName.textContent = this.o.cueName(base);
        this.nowCount.textContent = this.o.text('soniclook.sounds.play', { k: p.index, n: p.of });
        this.nowBox.dataset.cue = base;
        this.nowBox.hidden = false;
    }

    draw(s: SoundState): void {
        if (!this.on) return;
        const plan = s.plan;
        this.freeWay = plan?.freeWay ?? null;
        if (plan && plan.t !== this.planSeen?.t) this.planSeen = { t: plan.t, cues: plan.cues.map((c) => c.id) };
        else if (!plan) this.planSeen = null;
        this.items = this.memory.update(plan ? radarItems(plan.cues, plan.freeWay, plan.urgent) : [], s.now);
        this.bar = heightBar(plan, s.topM, s.now);
        if (s.playing) this.playing = { p: s.playing, until: s.now + NOW_HOLD_MS };
        else if (this.playing && this.playing.until < s.now) this.playing = null;
        this.showNow(this.playing ? this.playing.p : null);
        if (this.css.w === 0) this.measure();
        const { w, h } = this.css;
        if (w <= 0 || h <= 0) return;
        const dpr = Math.min(4, Math.max(1, globalThis.devicePixelRatio || 1));
        const scheme = this.o.scheme();
        const f = (v: number | null): string => (v === null ? '-' : String(Math.round(v * 100)));
        const key = [w, h, dpr, scheme, this.items.map((it) => `${it.id}/${f(it.x)}/${f(it.y)}/${it.elev}/${it.urgent}`).join(','), f(this.bar.toneM), this.bar.rough, f(this.bar.targetM), this.bar.noteOn, this.bar.topM].join(' ');
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
        drawSounds(g, soundLayout(w, h), { items: this.items, bar: this.bar }, scheme);
        this.draws++;
        this.drawMs = performance.now() - t0;
    }

    report(): SoundReport {
        const r = this.on ? this.canvas.getBoundingClientRect() : null;
        const p = this.playing ? this.playing.p : null;
        return {
            shown: this.on,
            scheme: this.o.scheme(),
            canvas: r ? { x: r.left, y: r.top, w: r.width, h: r.height } : null,
            layout: this.on && this.css.w > 0 ? soundLayout(this.css.w, this.css.h) : null,
            items: this.items,
            places: this.on && this.css.w > 0 ? placeDiscs(this.items, soundLayout(this.css.w, this.css.h)) : [],
            bar: this.bar,
            now: p && !this.nowBox.hidden ? { cue: cueBase(p.cue), kind: cueKind(p.cue), name: this.nowName.textContent ?? '', count: this.nowCount.textContent ?? '' } : null,
            freeWay: this.freeWay,
            plan: this.planSeen,
            draws: this.draws,
            drawMs: this.drawMs
        };
    }

    dispose(): void {
        this.observer?.disconnect();
        this.root.remove();
    }
}
