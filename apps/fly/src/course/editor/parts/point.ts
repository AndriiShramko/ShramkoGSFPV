// Lane edit4b, pointing at a gate (design edit4 section 3, the owner's complaint E8): Services.pointAt(index, reason) selects
// the gate a message names (no camera move: the owner's rule E1), flashes its label and its paint three times in 1.5 s (with
// reduced motion: steady for 3 s), and while the gate is off screen or behind the eye an arrow at the view's edge, with the
// gate's number, points toward it; a click on the arrow turns the view to the gate (Services.frameSelection).
// Not a part of its own (no install): gate-numbers.ts holds the labels and drives this pointer each drawn frame.
import { t } from '../../../i18n';
import type { EditorSeam, PointReason } from '../seam';
import type { NumberPoint, NumberSpot } from './gate-numbers';
import { LIFE_LINES } from './life-texts';

/** the flash: this many times on within FLASH_MS; with reduced motion one steady mark of STEADY_MS */
export const FLASH_TIMES = 3;
export const FLASH_MS = 1500;
export const STEADY_MS = 3000;
/** the edge arrow stays this long after the pointing while the gate is not in view (long enough to read and to click) */
export const ARROW_MS = 10000;
/** the arrow's centre stays this far inside the view's edge (its button is 44 px) */
export const EDGE_PX = 30;

/** the edge arrow: the gate's number, the button's centre (CSS px) and the arrow sign toward the gate */
export interface ArrowSpot {
    readonly n: number;
    readonly x: number;
    readonly y: number;
    readonly glyph: string;
    readonly behind: boolean;
}

/** Whether the flash is on `ms` after the pointing: three on-halves in FLASH_MS, or one steady mark with reduced motion. */
export function flashOn(ms: number, reduced: boolean): boolean {
    if (ms < 0) return false;
    if (reduced) return ms < STEADY_MS;
    if (ms >= FLASH_MS) return false;
    return Math.floor(ms / (FLASH_MS / (2 * FLASH_TIMES))) % 2 === 0;
}

const GLYPHS = ['→', '↘', '↓', '↙', '←', '↖', '↑', '↗'];

/**
 * Where the edge arrow stands for a gate whose label point is `p` (null: behind the eye): on the view's edge (EDGE_PX inside)
 * on the line from the view's centre toward the point, with the sign of that direction; behind the eye at the bottom's
 * middle, pointing down (turn round). Null when the point is inside the view.
 */
export function edgeArrow(n: number, p: NumberPoint | null, w: number, h: number, edge = EDGE_PX): ArrowSpot | null {
    if (p === null) return { n, x: w / 2, y: h - edge, glyph: GLYPHS[2]!, behind: true };
    if (p.x >= 0 && p.x <= w && p.y >= 0 && p.y <= h) return null;
    const cx = w / 2;
    const cy = h / 2;
    const dx = p.x - cx;
    const dy = p.y - cy;
    const k = Math.min(dx === 0 ? Infinity : (cx - edge) / Math.abs(dx), dy === 0 ? Infinity : (cy - edge) / Math.abs(dy));
    const ang = Math.atan2(dy, dx);
    const step = Math.round(ang / (Math.PI / 4));
    return { n, x: cx + dx * k, y: cy + dy * k, glyph: GLYPHS[((step % 8) + 8) % 8]!, behind: false };
}

const reducedMotion = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The pointing as it stands: which gate (index from 0), why, when, and whether the paint is flashed now. */
export class GatePointer {
    private pointed: { index: number; id: string; reason: PointReason; at: number; reduced: boolean } | null = null;
    private painted = -1;
    private arrowShown: ArrowSpot | null = null;

    constructor(private readonly seam: EditorSeam) {}

    /** Services.pointAt: the provider; the returned function ends it (the editor closed) */
    install(): () => void {
        this.seam.provide('pointAt', (index, reason) => this.point(index, reason));
        const offs = [
            // another gate taken by the pilot ends the pointing at this one
            this.seam.on('selected', (e) => { if (this.pointed && e.index !== this.pointed.index) this.stop(); }),
            this.seam.on('mode', (e) => { if (e.mode === 'fly') this.stop(); }),
            this.seam.on('closed', () => this.stop())
        ];
        return () => { for (const o of offs) o(); this.stop(); };
    }

    point(index: number, reason: PointReason): void {
        const st = this.seam.state();
        const g = st?.course.gates[index];
        if (!st || !g) return;
        this.seam.select(index, 'point');
        this.pointed = { index, id: g.id, reason, at: performance.now(), reduced: reducedMotion() };
        this.seam.hook('b', { pointed: { index, n: index + 1, reason, reduced: this.pointed.reduced } });
    }

    /** the index flashed `now` (-1: none); turns the gate's paint on and off as the flash goes */
    flashing(now: number): number {
        const p = this.pointed;
        const st = this.seam.state();
        // the course changed under the pointing (the gate deleted, the order changed): nothing to point at
        if (p && st?.course.gates[p.index]?.id !== p.id) this.stop();
        const on = this.pointed !== null && flashOn(now - this.pointed.at, this.pointed.reduced) ? this.pointed.index : -1;
        if (on !== this.painted) {
            if (this.painted >= 0) this.seam.flashGate(this.painted, false);
            if (on >= 0) this.seam.flashGate(on, true);
            this.painted = on;
        }
        return on;
    }

    /** the edge arrow for this frame, null while the pointed gate's label is on screen or the pointing is over */
    arrow(points: readonly (NumberPoint | null)[], spots: readonly NumberSpot[], w: number, h: number, now: number): ArrowSpot | null {
        const p = this.pointed;
        if (!p || now - p.at > ARROW_MS || spots.some((s) => s.n === p.index + 1)) return (this.arrowShown = null);
        return (this.arrowShown = edgeArrow(p.index + 1, points[p.index] ?? null, w, h));
    }

    arrowTitle(): string {
        const a = this.arrowShown;
        return a ? t(a.behind ? LIFE_LINES.pointBehind : LIFE_LINES.pointArrow, { n: a.n }) : '';
    }

    /** a click on the edge arrow: the view turns to the gate (the one camera move, asked for by the pilot) */
    arrowPressed(): void {
        this.arrowShown = null;
        if (this.pointed) this.pointed = { ...this.pointed, at: -Infinity };
        this.seam.call('frameSelection');
    }

    private stop(): void {
        if (this.painted >= 0) this.seam.flashGate(this.painted, false);
        this.painted = -1;
        this.pointed = null;
        this.arrowShown = null;
    }
}
