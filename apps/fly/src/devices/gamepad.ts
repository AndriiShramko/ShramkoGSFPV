// Gamepad API (compatibility path; many radios also appear as gamepads). Polled at ~500 Hz with
// a MessageChannel loop, not in requestAnimationFrame, so input sampling is independent of the
// frame rate. Chromium traps: an axis may read exactly 0.0 until it has once been near centre,
// and a pad only appears after a deflection > 0.5 — the arm gate's "passed centre" rule covers it.

import type { RawFrame } from '@gsfpv/input';

export function gamepadKey(g: Gamepad): string {
    return `gp:${g.id}:${g.axes.length}:${g.buttons.length}:${g.mapping}`;
}

export class GamepadSource {
    index = -1;
    id = '';
    frame: RawFrame = { t: 0, axes: new Float32Array(8), buttons: 0 };
    onFrame: ((f: RawFrame) => void) | null = null;
    onConnect: ((g: Gamepad) => void) | null = null;
    rateHz = 0;
    private ch = new MessageChannel();
    private running = false;
    private last = 0;
    private lastTs = 0;
    private rateN = 0;
    private rateT0 = 0;
    private prev = new Float32Array(8);
    private prevButtons = -1;

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

    private poll(now: number): void {
        const pads = navigator.getGamepads ? navigator.getGamepads() : [];
        let g: Gamepad | null = this.index >= 0 ? pads[this.index] ?? null : null;
        if (!g) {
            for (const p of pads) if (p) { g = p; this.index = p.index; this.id = p.id; break; }
        }
        if (!g) return;
        // only emit on a new hardware sample
        if (g.timestamp === this.lastTs) return;
        this.lastTs = g.timestamp;
        const f = this.frame;
        f.t = now;
        let changed = false;
        for (let i = 0; i < 8; i++) {
            const v = i < g.axes.length ? g.axes[i] : 0;
            f.axes[i] = v;
            if (v !== this.prev[i]) { changed = true; this.prev[i] = v; }
        }
        let b = 0;
        for (let i = 0; i < Math.min(24, g.buttons.length); i++) if (g.buttons[i].pressed) b |= 1 << i;
        if (b !== this.prevButtons) changed = true;
        this.prevButtons = b;
        f.buttons = b;
        this.rateN++;
        if (now - this.rateT0 >= 1000) {
            this.rateHz = (this.rateN * 1000) / (now - this.rateT0);
            this.rateN = 0;
            this.rateT0 = now;
        }
        if (changed || true) this.onFrame?.(f);
    }

    get key(): string {
        const pads = navigator.getGamepads ? navigator.getGamepads() : [];
        const g = this.index >= 0 ? pads[this.index] : null;
        return g ? gamepadKey(g) : '';
    }
}
