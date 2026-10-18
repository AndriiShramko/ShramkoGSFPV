// Gamepad API (compatibility path; many radios also appear as gamepads). Polled at ~500 Hz with
// a MessageChannel loop, not in requestAnimationFrame, so input sampling is independent of the
// frame rate. Chromium traps: an axis may read exactly 0.0 until it has once been near centre,
// and a pad only appears after a deflection > 0.5 — the arm gate's "passed centre" rule covers it.
// Some pads (e.g. a DJI controller) report only changes: Gamepad.timestamp stands still while the
// sticks do. Their held values are still true while the pad is connected, so they are sent again
// (arrival = this poll) before the arm gate's 100 ms stale rule would disarm them in flight. A pad
// that is gone sends nothing, so the gate still goes stale and disarms.
//
// The stamp (v0.8, the owner's item 7): a new sample is stamped with Gamepad.timestamp, the moment
// the browser's gamepad thread took it (the page clock, as WebHID's event.timeStamp), not the moment
// this loop got to it: while the main thread draws a heavy scan the loop waits, and the physics,
// which applies an input at its stamp (simclock.ts), would then start the move that much later.
// Measured on a release drawing a scan at the owner's 30 Hz with 25 ms of load per frame
// (tools/bench/scripts/input-latency-probe.mjs, evidence/2026-10-16/v08-b-latency.json).
// gamepadStamp has the rule: a repeat keeps its arrival, and stamps never go backwards.
//
// v0.9 lane E (the owner's item 12, a Bluetooth radio that feels 300 ms late; docs/wip/v09-e.md): the
// latency harness (tools/bench/test/pad-timeline.test.ts) runs this file and its v0.7 / v0.8 versions
// on synthetic link timelines. What it found and what changed here:
//   - a pad whose Gamepad.timestamp does not move while its values do was only noticed at the 20 ms
//     keep-alive (10 ms late on average, 21 ms at worst, in v0.7 and v0.8 alike): a value that moved
//     is a new sample whatever the timestamp says;
//   - a timestamp that goes backwards is not trusted (the physics would apply the move before it
//     happened): the poll time is used;
//   - pollNow(): a frame reads the pad once more just before it draws and steps the physics, so a
//     report the browser published after the loop's last look (up to 2 ms before the frame) is not
//     held back a whole display period (33 ms on a 30 Hz screen);
//   - link: every new sample is noted in a LinkMeter (@gsfpv/input link.ts), so the Controls screen
//     and F3 can say how often this pad's reports really arrive.

import { FRAME_BUTTONS, LinkMeter } from '@gsfpv/input';
import type { RawFrame } from '@gsfpv/input';

/** A connected pad with no new hardware sample repeats its last values this often (gate: 100 ms). */
const KEEPALIVE_MS = 20;
/** Gamepad.timestamp older than this (or ahead of now) is not this page clock's sample time: the poll time is used. */
const STAMP_MAX_AGE_MS = 100;

/** A polling loop that did not come round for this long (ms) was blocked by the page. */
const STALL_MS = 12;

/**
 * When a polled sample happened on this page's clock: a new sample (`fresh`) its Gamepad.timestamp
 * when that is a plausible time (not ahead of `now`, at most STAMP_MAX_AGE_MS old, not before the
 * previous sample's own timestamp `lastTs`: a clock that goes backwards says nothing about when the
 * move happened), else `now`, the time of this poll.
 */
export function gamepadSampleTime(fresh: boolean, timestamp: number, now: number, lastTs = -Infinity): number {
    return fresh && Number.isFinite(timestamp) && timestamp <= now && now - timestamp <= STAMP_MAX_AGE_MS && timestamp >= lastTs ? timestamp : now;
}

/** The stamp a sample goes out with: its sample time, never before the previous stamp `prev` (the physics takes samples in order). */
export function gamepadStamp(fresh: boolean, timestamp: number, now: number, prev: number, lastTs = -Infinity): number {
    const t = gamepadSampleTime(fresh, timestamp, now, lastTs);
    return t > prev ? t : prev;
}

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
    /** how often new samples arrive: interval, jitter, longest gap (the Controls screen and F3 say it) */
    readonly link = new LinkMeter(0); // the browser's own sample times: no slack after a stall
    private ch = new MessageChannel();
    private running = false;
    private last = 0;
    private lastTs = -1; // a pad whose timestamp is 0 still sends its first frame
    private lastEmit = -1e9;
    private rateN = 0;
    private rateT0 = 0;
    private lastLoop = 0;

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
        // the loop came round late: the page was busy, and the samples it finds after that are late
        // for the page's reasons, not the link's (the meter leaves that gap out)
        if (this.lastLoop > 0 && now - this.lastLoop > STALL_MS && document.visibilityState === 'visible') this.link.stall(this.lastLoop, now);
        this.lastLoop = now;
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

    /**
     * Read the pad now, outside the loop's 2 ms rhythm. A display frame calls this just before it
     * draws the Controls screen or steps the physics: a report the browser published since the loop's
     * last look would otherwise wait for the next frame (a whole period: 33 ms on a 30 Hz screen).
     * Nothing new, nothing sent.
     */
    pollNow(): void {
        if (!this.running || document.visibilityState !== 'visible') return;
        const now = performance.now();
        this.last = now;
        this.poll(now);
    }

    private poll(now: number): void {
        const g = this.pad();
        if (!g) return; // gone: no frames, so the arm gate's stale rule disarms
        const stamped = g.timestamp !== this.lastTs;
        // a value that moved under a timestamp that did not is a new sample too (a browser or device
        // that does not stamp its reports): waiting for the keep-alive would be up to 20 ms late
        const fresh = stamped || this.moved(g);
        if (!fresh && now - this.lastEmit < KEEPALIVE_MS) return;
        const f = this.frame;
        // the sample's own time (the link meter takes it: a backwards one is dropped there) and the stamp
        // it goes out with, never before the previous stamp (the physics takes samples in order)
        const at = gamepadSampleTime(stamped, g.timestamp, now, this.lastTs);
        f.t = gamepadStamp(stamped, g.timestamp, now, f.t, this.lastTs);
        this.lastTs = g.timestamp;
        for (let i = 0; i < 8; i++) f.axes[i] = i < g.axes.length ? g.axes[i] : 0;
        let b = 0;
        for (let i = 0; i < Math.min(FRAME_BUTTONS, g.buttons.length); i++) if (g.buttons[i].pressed) b |= 1 << i;
        f.buttons = b;
        if (fresh) {
            this.link.note(at);
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

    /** Did an axis or a button of `g` change since the last frame sent? */
    private moved(g: Gamepad): boolean {
        const f = this.frame;
        for (let i = 0; i < 8; i++) {
            const x = Math.fround(i < g.axes.length ? g.axes[i] : 0);
            if (x !== f.axes[i] && !(x !== x && f.axes[i] !== f.axes[i])) return true; // NaN is NaN, not a move
        }
        let b = 0;
        for (let i = 0; i < Math.min(FRAME_BUTTONS, g.buttons.length); i++) if (g.buttons[i].pressed) b |= 1 << i;
        return b !== f.buttons;
    }

    /** What the known-controller table needs of this source's pad (its id string and its counts), or null when none is connected. */
    info(): { id: string; axes: { length: number }; buttons: { length: number } } | null {
        const pads = navigator.getGamepads ? navigator.getGamepads() : [];
        const g = this.index >= 0 ? pads[this.index] : null;
        return g ? { id: g.id, axes: { length: g.axes.length }, buttons: { length: g.buttons.length } } : null;
    }

    get key(): string {
        const pads = navigator.getGamepads ? navigator.getGamepads() : [];
        const g = this.index >= 0 ? pads[this.index] : null;
        return g ? gamepadKey(g) : '';
    }
}
