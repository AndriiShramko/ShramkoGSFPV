// Lane edit4b, gate numbers (design edit4 section 3, the owner's complaint E8: "you write there is a problem with gate N and I
// have no idea which gate that is, they carry no numbers"). In mode 'edit' every gate in view carries its number (from 1, as
// every message counts) in a label over its top: lime like the flight's number plate, the selected gate's yellow like its
// paint, a gate the check refuses red. A label that would lie over a nearer one, over the editor's bars or behind the eye is
// dropped (numberSpots, pure). The pointing (Services.pointAt, ./point.ts) flashes a label and draws the edge arrow.
import { badGates } from '../rules';
import { gateFlownPose, type V3 } from '../drag';
import type { EditorSeam } from '../seam';
import { GatePointer, type ArrowSpot } from './point';
import './life.css';

/** A label's box is at least this many CSS px wide and high (design: 16 px bold digits, at least a 24 px box) */
export const LABEL_BOX_PX = 28;
/** the label's bottom stands this far over the projected gate top */
export const LABEL_LIFT_PX = 4;
/** the label's point is over the gate's centre by this share of its opening, plus LABEL_TOP_M (a gate with no opening) */
export const LABEL_TOP_SHARE = 0.6;
export const LABEL_TOP_M = 0.3;

/** A gate's top on the page: its number (from 1), CSS px, and the depth along the view (m); null: behind the eye */
export interface NumberPoint {
    readonly n: number;
    readonly x: number;
    readonly y: number;
    readonly depth: number;
}
/** a label kept: the gate's number and the label's centre */
export interface NumberSpot {
    readonly n: number;
    readonly x: number;
    readonly y: number;
}
/** a page rectangle no label may lie over (left, top, right, bottom, CSS px) */
export type Box = readonly [number, number, number, number];

const overlaps = (ax: number, ay: number, bx: number, by: number, box: number): boolean => Math.abs(ax - bx) < box && Math.abs(ay - by) < box;

/**
 * The labels to draw: one per gate whose top is in front of the eye and whose label lies inside the w x h view and over none
 * of `blocked`; where two labels would overlap the nearer gate keeps its label (the numbers in `first`, the selected and the
 * pointed gate, keep theirs before any). Sorted by number.
 */
export function numberSpots(points: readonly (NumberPoint | null)[], w: number, h: number, blocked: readonly Box[] = [], first: readonly number[] = [], box = LABEL_BOX_PX): NumberSpot[] {
    const half = box / 2;
    const cands = points
        .filter((p): p is NumberPoint => p !== null && p.depth > 0 && Number.isFinite(p.x) && Number.isFinite(p.y))
        .map((p) => ({ n: p.n, x: p.x, y: p.y - LABEL_LIFT_PX - half, depth: p.depth, rank: first.includes(p.n) ? first.indexOf(p.n) : first.length }))
        .filter((p) => p.x - half >= 0 && p.x + half <= w && p.y - half >= 0 && p.y + half <= h)
        .filter((p) => !blocked.some((b) => p.x + half > b[0] && p.x - half < b[2] && p.y + half > b[1] && p.y - half < b[3]))
        .sort((a, b) => a.rank - b.rank || a.depth - b.depth || a.n - b.n);
    const kept: NumberSpot[] = [];
    for (const c of cands) if (!kept.some((k) => overlaps(k.x, k.y, c.x, c.y, box))) kept.push({ n: c.n, x: c.x, y: c.y });
    return kept.sort((a, b) => a.n - b.n);
}

/** the point a gate's label stands on: over the gate's centre by part of its opening (flown frame) */
export function labelPoint(pos: V3, opening: number): V3 {
    return [pos[0], pos[1] + LABEL_TOP_SHARE * opening + LABEL_TOP_M, pos[2]];
}

/** the editor's bars a label may not lie over (top bar, its menus, the selected gate's bar, the window, a question) */
const CHROME = '.ce-topbar, .ce-menu, .ce-gatebar, .ce-panel, .life-ask-back, .cl-edge';

function chromeBoxes(): Box[] {
    const out: Box[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(CHROME))) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) out.push([r.left, r.top, r.right, r.bottom]);
    }
    return out;
}

/** The DOM layer: one label per kept spot, reused by number, and the pointing's edge arrow. */
class NumberLayer {
    readonly root: HTMLDivElement;
    private readonly labels = new Map<number, HTMLDivElement>();
    private readonly arrow: HTMLButtonElement;

    constructor(onArrow: () => void) {
        this.root = document.createElement('div');
        this.root.className = 'cl-nums';
        this.arrow = document.createElement('button');
        this.arrow.type = 'button';
        this.arrow.className = 'cl-edge interactive';
        this.arrow.hidden = true;
        this.arrow.addEventListener('click', (e) => {
            e.stopPropagation();
            onArrow();
        });
        this.root.appendChild(this.arrow);
        document.body.appendChild(this.root);
    }

    draw(spots: readonly NumberSpot[], selected: number, bad: ReadonlySet<number>, flash: number, arrow: ArrowSpot | null, arrowTitle: string): void {
        const seen = new Set<number>();
        for (const s of spots) {
            seen.add(s.n);
            let el = this.labels.get(s.n);
            if (!el) {
                el = document.createElement('div');
                el.className = 'cl-num';
                el.textContent = String(s.n);
                el.dataset.gate = String(s.n);
                this.root.appendChild(el);
                this.labels.set(s.n, el);
            }
            el.style.transform = `translate(${Math.round(s.x)}px, ${Math.round(s.y)}px) translate(-50%, -50%)`;
            el.classList.toggle('sel', s.n === selected + 1);
            el.classList.toggle('bad', s.n !== selected + 1 && bad.has(s.n - 1));
            el.classList.toggle('flash', s.n === flash + 1);
        }
        for (const [n, el] of this.labels) {
            if (seen.has(n)) continue;
            el.remove();
            this.labels.delete(n);
        }
        this.arrow.hidden = arrow === null;
        if (arrow) {
            this.arrow.textContent = `${arrow.glyph} ${arrow.n}`;
            this.arrow.title = arrowTitle;
            this.arrow.setAttribute('aria-label', arrowTitle);
            this.arrow.style.transform = `translate(${Math.round(arrow.x)}px, ${Math.round(arrow.y)}px) translate(-50%, -50%)`;
            this.arrow.classList.toggle('flash', flash >= 0);
        }
    }

    hide(): void {
        this.root.hidden = true;
    }

    show(): void {
        this.root.hidden = false;
    }

    remove(): void {
        this.root.remove();
        this.labels.clear();
    }
}

export function install(seam: EditorSeam): () => void {
    const pointer = new GatePointer(seam);
    const layer = new NumberLayer(() => pointer.arrowPressed());
    let mode: 'edit' | 'fly' = 'edit';
    const draw = (w: number, h: number): void => {
        const st = seam.state();
        if (!st || mode !== 'edit') return layer.hide();
        layer.show();
        const tr = seam.flown();
        const ids = st.course.gates.map((g) => g.id);
        const points = st.course.gates.map((g, i): NumberPoint | null => {
            const pose = gateFlownPose(g, tr);
            const p = seam.project(labelPoint(pose.pos, pose.opening));
            return p ? { n: i + 1, x: p[0], y: p[1], depth: p[2] } : null;
        });
        const now = performance.now();
        const flash = pointer.flashing(now);
        const first = [flash, st.selected].filter((i) => i >= 0).map((i) => i + 1);
        const spots = numberSpots(points, w, h, chromeBoxes(), first);
        const arrow = pointer.arrow(points, spots, w, h, now);
        layer.draw(spots, st.selected, badGates(st.problems, ids), flash, arrow, pointer.arrowTitle());
        seam.hook('b', { numbers: { mode, labels: spots.map((s) => s.n), spots: spots.map((s) => [s.n, Math.round(s.x), Math.round(s.y)]), gates: ids.length, arrow: arrow ? { n: arrow.n, x: Math.round(arrow.x), y: Math.round(arrow.y) } : null } });
    };
    const offs = [
        seam.on('frame', (e) => draw(e.w, e.h)),
        seam.on('mode', (e) => {
            mode = e.mode;
            if (mode === 'fly') {
                layer.hide();
                seam.hook('b', { numbers: { mode, labels: [], spots: [], gates: seam.state()?.course.gates.length ?? 0, arrow: null } });
            }
        }),
        seam.on('opened', () => { mode = 'edit'; }),
        pointer.install()
    ];
    return () => {
        for (const o of offs) o();
        layer.remove();
    };
}
