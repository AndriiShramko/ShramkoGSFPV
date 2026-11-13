// Train 1, lane rooms: the server's clock on this page (rooms-plan.md 2.2, NTP style). The client sends
// {type: "ping", t: <its ms>}, the server answers {type: "pong", t, s: <serverMs>}; each round trip gives an offset
// s - (t + t_back) / 2, and the offset in use is the median of the last 8 (a slow answer does not move it).

/** Round trips the offset is the median of (rooms-plan.md 2.2). */
export const CLOCK_SAMPLES = 8;

interface Sample { offset: number; rtt: number }

export class ServerClock {
    private samples: Sample[] = [];

    /** One pong: `sent` the ping's local ms, `server` the pong's serverMs, `back` the local ms it arrived. */
    add(sent: number, server: number, back: number): void {
        if (!(back >= sent) || !Number.isFinite(server)) return;
        this.samples.push({ offset: server - (sent + back) / 2, rtt: back - sent });
        if (this.samples.length > CLOCK_SAMPLES) this.samples.shift();
    }

    /** Round trips kept (at most 8). */
    get count(): number {
        return this.samples.length;
    }

    /** serverMs - localMs; null before the first pong */
    get offset(): number | null {
        if (this.samples.length === 0) return null;
        const o = this.samples.map((s) => s.offset).sort((a, b) => a - b);
        const n = o.length;
        return n % 2 ? o[(n - 1) / 2] : (o[n / 2 - 1] + o[n / 2]) / 2;
    }

    /** the median round trip, ms; null before the first pong */
    get rtt(): number | null {
        if (this.samples.length === 0) return null;
        const r = this.samples.map((s) => s.rtt).sort((a, b) => a - b);
        return r[Math.floor((r.length - 1) / 2)];
    }

    /** the server's ms at local `localMs` (null before the first pong) */
    serverNow(localMs: number): number | null {
        const o = this.offset;
        return o === null ? null : localMs + o;
    }

    reset(): void {
        this.samples = [];
    }
}
