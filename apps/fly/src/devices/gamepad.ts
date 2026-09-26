// Gamepad API (compatibility path; many radios also appear as gamepads). Polled at ~500 Hz with
// a MessageChannel loop, not in requestAnimationFrame, so input sampling is independent of the
// frame rate. Chromium traps: an axis may read exactly 0.0 until it has once been near centre,
// and a pad only appears after a deflection > 0.5 — the arm gate's "passed centre" rule covers it.
// Some pads (e.g. a DJI controller) report only changes: Gamepad.timestamp stands still while the
// sticks do. Their held values are still true while the pad is connected, so they are sent again
// (arrival = this poll) before the arm gate's 100 ms stale rule would disarm them in flight. A pad
// that is gone sends nothing, so the gate still goes stale and disarms.

import type { RawFrame } from '@gsfpv/input';

/** A connected pad with no new hardware sample repeats its last values this often (gate: 100 ms). */
const KEEPALIVE_MS = 20;

export function gamepadKey(g: Gamepad): string {
    return `gp:${g.id}:${g.axes.length}:${g.buttons.length}:${g.mapping}`;
}

export class GamepadSource {
    index = -1;
    id = '';
    frame: RawFrame = { t: 0, axes: new Float32Array(8), buttons: 0 };
    onFrame: ((f: RawFrame) => void) | null = null;
    onConnect: ((g: Gamepad) => void) | null = null;
    /** new hardware samples per second (repeats of held values are not counted) */
    rateHz = 0;
    private ch = new MessageChannel();
    private running = false;
    private last = 0;
    private lastTs = -1; // a pad whose timestamp is 0 still sends its first frame
    private lastEmit = -1e9;
    private rateN = 0;
    private rateT0 = 0;

    start(): void {
        if (this.running) return;
        this.running = true;
        this.ch.port1.onmessage = () => this.loop();
        this.ch.port2.postMessage(0);
        addEventListener('gamepadconnected', this.onConn);
    }

    stop(): void {
        this.running = false;
        removeEventListener('gamepadconnected', this.onConn);
    }

    private onConn = (e: GamepadEvent): void => {
        if (this.index < 0) {
            this.index = e.gamepad.index;
            this.id = e.gamepad.id;
        }
        this.onConnect?.(e.gamepad);
    };

    private loop(): void {
        if (!this.running) return;
        const now = performance.now();
        if (document.visibilityState === 'visible' && now - this.last >= 2) {
            this.last = now;
            this.poll(now);
        }
        // keep spinning; yield to the event loop between iterations
        if (document.visibilityState === 'visible') this.ch.port2.postMessage(0);
        else setTimeout(() => this.ch.port2.postMessage(0), 100);
    }

    /** This source's pad if it is connected: at its slot, or the same pad back at another slot. */
    private pad(): Gamepad | null {
        const pads = navigator.getGamepads ? navigator.getGamepads() : [];
        const mine = (p: Gamepad | null | undefined): p is Gamepad => !!p && p.connected !== false && (!this.id || p.id === this.id);
        const at = this.index >= 0 ? pads[this.index] : null;
        if (mine(at)) return at;
        // never another pad once one is chosen: its axes through this pad's profile could arm
        for (const p of pads) {
            if (!mine(p)) continue;
            this.index = p.index;
            this.id = p.id;
            return p;
        }
        return null;
    }

    private poll(now: number): void {
        const g = this.pad();
        if (!g) return; // gone: no frames, so the arm gate's stale rule disarms
        const fresh = g.timestamp !== this.lastTs;
        if (!fresh && now - this.lastEmit < KEEPALIVE_MS) return;
        this.lastTs = g.timestamp;
        const f = this.frame;
        f.t = now;
        for (let i = 0; i < 8; i++) f.axes[i] = i < g.axes.length ? g.axes[i] : 0;
        let b = 0;
        for (let i = 0; i < Math.min(24, g.buttons.length); i++) if (g.buttons[i].pressed) b |= 1 << i;
        f.buttons = b;
        if (fresh) {
            this.rateN++;
            if (now - this.rateT0 >= 1000) {
                this.rateHz = (this.rateN * 1000) / (now - this.rateT0);
                this.rateN = 0;
                this.rateT0 = now;
            }
        }
        this.lastEmit = now;
        this.onFrame?.(f);
    }

    get key(): string {
        const pads = navigator.getGamepads ? navigator.getGamepads() : [];
        const g = this.index >= 0 ? pads[this.index] : null;
        return g ? gamepadKey(g) : '';
    }
}
