// Lane editfix E2.4: Courses and Keys on the top bar always show what they did. When the window is already open and
// the part already on screen, scrolling to it changes nothing a person can see, so the part lights up for a moment.

/** how long the part stays lit (an estimate: long enough to be seen after the click, short enough not to linger) */
export const SHOWN_MS = 1200;

// Lane n-save (t7-plan Decision 1): after Fix all automatically, each moved gate's old place is shown a few seconds as a
// ghost: a dashed ring of the gate's opening where it stood and a dashed line to where it is now, drawn over the scene
// (an SVG layer that takes no clicks), redrawn every frame so it stays on the place while the view moves.

/** how long the ghosts stay (an estimate: long enough to see every moved gate after the overview, then out of the way) */
export const GHOST_MS = 5000;
/** the smallest ghost ring on the page, CSS px */
export const GHOST_MIN_PX = 10;
/** a moved gate: its old and new flown centre, its opening (flown m) */
export interface GhostGate {
    readonly was: readonly [number, number, number];
    readonly now: readonly [number, number, number];
    readonly opening: number;
}
/** a ghost on the page: the ring's centre and radius, the line's end at the new place (null: behind the eye) */
export interface GhostSpot {
    readonly x: number;
    readonly y: number;
    readonly r: number;
    readonly to: readonly [number, number] | null;
}
/** a flown point on the page: CSS px x, y and its depth, null behind the eye (course.ts project) */
export type Project = (p: readonly [number, number, number]) => readonly [number, number, number] | null;

/** Where the ghosts stand on the page now (pure): one per gate whose old place is in front of the eye. */
export function ghostSpots(gates: readonly GhostGate[], project: Project): GhostSpot[] {
    const out: GhostSpot[] = [];
    for (const g of gates) {
        const c = project(g.was);
        if (!c) continue;
        const top = project([g.was[0], g.was[1] + g.opening / 2, g.was[2]]);
        const r = Math.max(GHOST_MIN_PX, top ? Math.hypot(top[0] - c[0], top[1] - c[1]) : GHOST_MIN_PX);
        const to = project(g.now);
        out.push({ x: c[0], y: c[1], r, to: to ? [to[0], to[1]] : null });
    }
    return out;
}

const SVG = 'http://www.w3.org/2000/svg';

/** The ghosts' layer over the scene (created once, emptied when the time is up or show([]) is called). */
export class GateGhosts {
    private readonly svg: SVGSVGElement;
    private gates: readonly GhostGate[] = [];
    private until = 0;
    private frame = 0;

    constructor(parent: HTMLElement, private readonly project: Project, private readonly now: () => number = () => performance.now()) {
        this.svg = document.createElementNS(SVG, 'svg');
        this.svg.dataset.testid = 'save-ghosts';
        this.svg.setAttribute('aria-hidden', 'true');
        this.svg.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:5;overflow:visible';
        parent.append(this.svg);
    }

    /** shows these old places for GHOST_MS (an empty list takes the ghosts away at once) */
    show(gates: readonly GhostGate[]): void {
        this.gates = gates;
        this.until = this.now() + GHOST_MS;
        this.draw();
    }

    /** how many ghosts are on the page now (the probes read it) */
    count(): number {
        return this.svg.children.length;
    }

    private draw = (): void => {
        if (this.frame) cancelAnimationFrame(this.frame);
        this.frame = 0;
        const live = this.gates.length > 0 && this.now() < this.until;
        const parts: SVGElement[] = [];
        if (live) {
            for (const s of ghostSpots(this.gates, this.project)) {
                const ring = document.createElementNS(SVG, 'circle');
                ring.setAttribute('cx', String(s.x));
                ring.setAttribute('cy', String(s.y));
                ring.setAttribute('r', String(s.r));
                ring.setAttribute('style', 'fill:none;stroke:#ffb347;stroke-width:3;stroke-dasharray:8 6;opacity:0.9');
                parts.push(ring);
                if (s.to) {
                    const line = document.createElementNS(SVG, 'line');
                    line.setAttribute('x1', String(s.x));
                    line.setAttribute('y1', String(s.y));
                    line.setAttribute('x2', String(s.to[0]));
                    line.setAttribute('y2', String(s.to[1]));
                    line.setAttribute('style', 'stroke:#ffb347;stroke-width:2;stroke-dasharray:4 4;opacity:0.9');
                    parts.push(line);
                }
            }
        }
        this.svg.replaceChildren(...parts);
        if (live) this.frame = requestAnimationFrame(this.draw);
        else this.gates = [];
    };
}
export const SHOWN_CLASS = 'ce-shown';

interface Lit {
    classList: { add(c: string): void; remove(c: string): void };
    readonly offsetWidth: number;
}

const timers = new WeakMap<object, unknown>();

/** lights the part (class ce-shown) and takes it off after SHOWN_MS; a second press starts the light again */
export function flashPart(
    part: Lit,
    later: (fn: () => void, ms: number) => unknown = setTimeout,
    stop: (id: unknown) => void = (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
): void {
    const prev = timers.get(part);
    if (prev !== undefined) stop(prev);
    part.classList.remove(SHOWN_CLASS);
    void part.offsetWidth; // a fresh start of the CSS animation
    part.classList.add(SHOWN_CLASS);
    timers.set(
        part,
        later(() => {
            part.classList.remove(SHOWN_CLASS);
            timers.delete(part);
        }, SHOWN_MS),
    );
}
