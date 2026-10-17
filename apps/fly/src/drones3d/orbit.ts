// The turntable's camera, as numbers (v0.9 lane D): a yaw/pitch/distance around the model that turns slowly by itself,
// follows a drag with a little momentum, zooms with the wheel or a pinch, and eases to a view the legend asks for.
// No engine and no DOM, so a Node test drives it. Distances are in units of the model's own size (1 = fits the stage).

export interface OrbitState {
    /** degrees; 0 looks at the front of the model from straight ahead, positive moves the camera to the model's right (see viewPosition) */
    yaw: number;
    /** degrees above the floor */
    pitch: number;
    /** camera distance in model radii */
    dist: number;
}

export const PITCH_MIN = 4;
export const PITCH_MAX = 82;
export const DIST_MIN = 1.1;
export const DIST_MAX = 6.5;
/** the fastest a flick may leave the model spinning, degrees a second */
export const MAX_FLICK = 360;
/** degrees a second while nobody touches it */
export const AUTO_SPIN = 14;
/** seconds after the last touch before the turntable turns again */
export const IDLE_RESUME_S = 3.5;
/** the first view: three quarters from the front-right and a little above */
export const HOME: Readonly<OrbitState> = { yaw: 34, pitch: 22, dist: 2.7 };

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const wrap = (a: number): number => ((((a + 180) % 360) + 360) % 360) - 180;

export class Orbit {
    state: OrbitState = { ...HOME };
    /** the turntable turns when true and nobody is touching it */
    spin = true;
    /** the user prefers no motion: it never turns by itself */
    reduceMotion = false;
    private idle = 0;
    private vel = { yaw: 0, pitch: 0 };
    private dragging = false;
    private goal: OrbitState | null = null;

    /** Pointer down: stop the turn and the momentum. */
    grab(): void {
        this.dragging = true;
        this.vel.yaw = 0; this.vel.pitch = 0;
        this.idle = 0;
        this.goal = null;
    }

    /** A pointer move of dx, dy CSS pixels over a stage `size` pixels across (a stage's width is a turn of ~270 degrees). */
    drag(dx: number, dy: number, size: number, dt = 1 / 60): void {
        if (!this.dragging) return;
        const k = 270 / Math.max(120, size);
        this.state.yaw = wrap(this.state.yaw - dx * k);
        this.state.pitch = clamp(this.state.pitch + dy * k * 0.7, PITCH_MIN, PITCH_MAX);
        // the speed of the last moves, for the release
        const s = 1 / Math.max(1 / 240, dt);
        this.vel.yaw = clamp(this.vel.yaw * 0.6 + -dx * k * s * 0.4, -MAX_FLICK, MAX_FLICK);
        this.vel.pitch = clamp(this.vel.pitch * 0.6 + dy * k * 0.7 * s * 0.4, -MAX_FLICK, MAX_FLICK);
        this.idle = 0;
    }

    release(): void {
        this.dragging = false;
        this.idle = 0;
    }

    /** Wheel ticks (positive = away) or a pinch ratio change expressed the same way. */
    zoom(delta: number): void {
        this.state.dist = clamp(this.state.dist * Math.exp(delta * 0.0014), DIST_MIN, DIST_MAX);
        this.idle = 0;
        this.goal = null;
    }

    /** Arrow keys and the like: turn by degrees. */
    nudge(dyaw: number, dpitch: number): void {
        this.state.yaw = wrap(this.state.yaw + dyaw);
        this.state.pitch = clamp(this.state.pitch + dpitch, PITCH_MIN, PITCH_MAX);
        this.idle = 0;
        this.goal = null;
    }

    /** Ease to a view (a legend row asks to look at its part). */
    flyTo(to: Partial<OrbitState>): void {
        const g: OrbitState = { ...this.state, ...to };
        g.pitch = clamp(g.pitch, PITCH_MIN, PITCH_MAX);
        g.dist = clamp(g.dist, DIST_MIN, DIST_MAX);
        this.goal = g;
        this.idle = 0;
        this.vel.yaw = 0; this.vel.pitch = 0;
    }

    reset(): void {
        this.flyTo(HOME);
    }

    /** the player is working it (a drag, a momentum, a view change): it wants every frame; the idle turn does not */
    get interacting(): boolean {
        return this.dragging || this.goal !== null || Math.abs(this.vel.yaw) > 0.05 || Math.abs(this.vel.pitch) > 0.05;
    }

    get moving(): boolean {
        return this.dragging || this.goal !== null || Math.abs(this.vel.yaw) > 0.05 || Math.abs(this.vel.pitch) > 0.05 || (this.spin && !this.reduceMotion && this.idle >= IDLE_RESUME_S);
    }

    /** Advance by dt seconds. Returns true when the view changed (the stage needs a frame). */
    tick(dt: number): boolean {
        const before = `${this.state.yaw}|${this.state.pitch}|${this.state.dist}`;
        const s = this.state;
        if (this.goal) {
            const k = 1 - Math.exp(-dt * 6);
            let dy = wrap(this.goal.yaw - s.yaw);
            s.yaw = wrap(s.yaw + dy * k);
            s.pitch += (this.goal.pitch - s.pitch) * k;
            s.dist += (this.goal.dist - s.dist) * k;
            dy = Math.abs(wrap(this.goal.yaw - s.yaw));
            if (dy < 0.05 && Math.abs(this.goal.pitch - s.pitch) < 0.05 && Math.abs(this.goal.dist - s.dist) < 0.002) { s.yaw = this.goal.yaw; s.pitch = this.goal.pitch; s.dist = this.goal.dist; this.goal = null; }
        } else if (!this.dragging) {
            // momentum from the last drag, decaying
            if (Math.abs(this.vel.yaw) > 0.05 || Math.abs(this.vel.pitch) > 0.05) {
                s.yaw = wrap(s.yaw + this.vel.yaw * dt);
                s.pitch = clamp(s.pitch + this.vel.pitch * dt, PITCH_MIN, PITCH_MAX);
                const f = Math.exp(-dt * 4.5);
                this.vel.yaw *= f; this.vel.pitch *= f;
            } else {
                this.vel.yaw = 0; this.vel.pitch = 0;
                this.idle += dt;
                if (this.spin && !this.reduceMotion && this.idle >= IDLE_RESUME_S) s.yaw = wrap(s.yaw + AUTO_SPIN * dt);
            }
        }
        return before !== `${s.yaw}|${s.pitch}|${s.dist}`;
    }
}

/** Camera position for a state: a point on a sphere round `target`, `radius` the model's size in world units. Yaw 0 looks at the front (-Z side of the model) from in front of it. */
export function viewPosition(s: OrbitState, radius: number, target: readonly [number, number, number]): [number, number, number] {
    const yaw = (s.yaw * Math.PI) / 180, pitch = (s.pitch * Math.PI) / 180, d = s.dist * radius;
    return [target[0] + d * Math.sin(yaw) * Math.cos(pitch), target[1] + d * Math.sin(pitch), target[2] - d * Math.cos(yaw) * Math.cos(pitch)];
}
