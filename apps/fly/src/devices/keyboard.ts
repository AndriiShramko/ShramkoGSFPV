// Keyboard input (development and latency measurement).
// Manual flying: W/S throttle, A/D yaw, arrows roll/pitch, Space = arm toggle, M = angle mode.
// F13..F24 are reserved for the latency harness: each press is one numbered input event that
// travels the normal path (queue -> physics tick -> marker in the next rendered frame).

import type { FlightSession } from '../session';

export class KeyboardSource {
    private down = new Set<string>();
    private ch = new Float32Array([0, 0, -1, 0, -1, 0, 0, 0]);
    private throttle = 0;
    private armed = false;
    private angle = false;
    latencyId = 0;
    private session: FlightSession;
    private timer = 0;

    constructor(session: FlightSession) {
        this.session = session;
        addEventListener('keydown', this.onDown, { capture: true });
        addEventListener('keyup', this.onUp, { capture: true });
        // 500 Hz sampling of held keys, independent of the frame rate
        this.timer = window.setInterval(() => this.tick(performance.now()), 2);
    }

    private onDown = (e: KeyboardEvent): void => {
        if (/^F(1[3-9]|2[0-4])$/.test(e.code)) {
            // latency probe: one numbered event at the OS-stamped time
            this.latencyId++;
            this.session.input(this.ch, e.timeStamp, this.latencyId);
            e.preventDefault();
            return;
        }
        if (e.code === 'Space' && !e.repeat) { this.armed = !this.armed; this.emit(e.timeStamp); e.preventDefault(); }
        if (e.code === 'KeyM' && !e.repeat) { this.angle = !this.angle; this.emit(e.timeStamp); }
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) {
            this.down.add(e.code);
            e.preventDefault();
        }
    };

    private onUp = (e: KeyboardEvent): void => {
        this.down.delete(e.code);
    };

    private tick(t: number): void {
        const d = this.down;
        if (d.size === 0 && this.ch[0] === 0 && this.ch[1] === 0 && this.ch[3] === 0 && !d.has('KeyW') && !d.has('KeyS')) return;
        if (d.has('KeyW')) this.throttle = Math.min(1, this.throttle + 0.004);
        if (d.has('KeyS')) this.throttle = Math.max(0, this.throttle - 0.006);
        this.emit(t);
    }

    private emit(t: number): void {
        const d = this.down;
        this.ch[0] = (d.has('ArrowRight') ? 0.6 : 0) - (d.has('ArrowLeft') ? 0.6 : 0);
        this.ch[1] = (d.has('ArrowUp') ? 0.6 : 0) - (d.has('ArrowDown') ? 0.6 : 0);
        this.ch[3] = (d.has('KeyD') ? 0.5 : 0) - (d.has('KeyA') ? 0.5 : 0);
        this.ch[2] = this.throttle * 2 - 1;
        this.ch[4] = this.armed ? 1 : -1;
        this.ch[5] = this.angle ? 1 : -1;
        this.session.input(this.ch, t);
    }

    dispose(): void {
        removeEventListener('keydown', this.onDown, { capture: true });
        removeEventListener('keyup', this.onUp, { capture: true });
        clearInterval(this.timer);
    }
}
