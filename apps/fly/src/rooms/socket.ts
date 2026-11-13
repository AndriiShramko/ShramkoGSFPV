// Train 1, lane rooms: the WebSocket of a room (docs/rooms-protocol.md "WebSocket"): hello, welcome, joined, left,
// snapshots, the clock's ping and pong, reconnect with backoff. Works with the browser's WebSocket and Node 22's global
// one (tools/bench/test/rooms-socket.test.ts runs it against apps/rooms/rooms.py).
import { ServerClock, CLOCK_SAMPLES } from './clock';
import { decodeSnapshot } from './codec';
import type { Snapshot } from './codec';
import type { RoomInfo } from './api';
import type { VoteMsg } from './vote';

export const PROTOCOL = 'rooms/1';
/** a ping at least this often: the server closes a socket silent for 70 s (docs/rooms-protocol.md) */
export const PING_EVERY_MS = 20000;
/** the first pings, one this far apart until the clock has 8 round trips (estimate) */
export const FIRST_PING_GAP_MS = 250;
/** waits before the next try after a lost connection (estimates); the last one repeats */
export const BACKOFF_MS: readonly number[] = [1000, 2000, 4000, 8000, 15000];
/** answers that end the joining: no new try helps (docs/rooms-protocol.md, error codes) */
export const FATAL: readonly string[] = ['hello', 'version', 'no-room', 'full'];

export interface Member { slot: number; nick: string }
export interface Welcome { type: 'welcome'; v: string; slot: number; nick: string; hostSlot: number | null; room: RoomInfo; members: Member[]; serverMs: number; vote?: VoteMsg | null }
export type SocketState = 'off' | 'connecting' | 'joined' | 'lost';

export interface RoomSocketEvents {
    welcome?(w: Welcome): void;
    joined?(m: Member, hostSlot: number | null): void;
    left?(slot: number, hostSlot: number | null): void;
    snapshot?(s: Snapshot, localMs: number): void;
    state?(s: SocketState): void;
    /** lane rooms2: a vote message (docs/rooms-protocol.md "Open rooms and votes") */
    vote?(m: VoteMsg): void;
    /** lane rooms2: a vote passed, the room flies this scan now */
    scene?(room: RoomInfo): void;
}

export interface RoomSocketOptions {
    url: string;
    room: string;
    nick: string;
    hostKey?: string;
    /** local ms (performance.now on the page) */
    now?: () => number;
    WebSocketImpl?: typeof WebSocket;
    backoffMs?: readonly number[];
}

export class RoomSocket {
    state: SocketState = 'off';
    slot: number | null = null;
    hostSlot: number | null = null;
    readonly members = new Map<number, string>();
    readonly clock = new ServerClock();
    /** why joining stopped (a fatal error code, or 'closed' by the page); null while it goes on */
    problem: string | null = null;
    room: RoomInfo | null = null;
    /** tries since the last welcome */
    private tries = 0;
    private ws: WebSocket | null = null;
    private timer: ReturnType<typeof setTimeout> | null = null;
    private pinger: ReturnType<typeof setTimeout> | null = null;
    private pingsSent = 0;
    private stopped = false;
    private readonly now: () => number;
    private readonly WS: typeof WebSocket;

    constructor(private readonly o: RoomSocketOptions, private readonly on: RoomSocketEvents = {}) {
        this.now = o.now ?? (() => performance.now());
        this.WS = o.WebSocketImpl ?? WebSocket;
    }

    connect(): void {
        this.stopped = false;
        this.problem = null;
        this.open();
    }

    /** One pose up (36 bytes); nothing while not joined. */
    sendPose(bytes: Uint8Array<ArrayBuffer>): boolean {
        if (this.state !== 'joined' || !this.ws || this.ws.readyState !== 1) return false;
        this.ws.send(bytes);
        return true;
    }

    /** Leave the room (the server closes with 1000) and stop trying. */
    leave(): void {
        if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ type: 'leave' }));
        this.close('left');
    }

    /** Stop: no new try. */
    close(problem: string | null = null): void {
        this.stopped = true;
        if (problem) this.problem = problem;
        this.clearTimers();
        const ws = this.ws;
        this.ws = null;
        if (ws && ws.readyState <= 1) ws.close(1000);
        this.setState('off');
    }

    private setState(s: SocketState): void {
        if (this.state === s) return;
        this.state = s;
        this.on.state?.(s);
    }

    private clearTimers(): void {
        if (this.timer) clearTimeout(this.timer);
        if (this.pinger) clearTimeout(this.pinger);
        this.timer = this.pinger = null;
    }

    private open(): void {
        this.clearTimers();
        this.setState(this.tries === 0 && this.state !== 'lost' ? 'connecting' : 'lost');
        let ws: WebSocket;
        try {
            ws = new this.WS(this.o.url);
        } catch {
            this.retry();
            return;
        }
        ws.binaryType = 'arraybuffer';
        this.ws = ws;
        ws.onopen = () => {
            const hello: Record<string, unknown> = { type: 'hello', v: PROTOCOL, room: this.o.room, nick: this.o.nick };
            if (this.o.hostKey) hello.hostKey = this.o.hostKey;
            ws.send(JSON.stringify(hello));
        };
        ws.onmessage = (ev: MessageEvent) => {
            if (ws !== this.ws) return;
            if (typeof ev.data === 'string') this.text(ev.data);
            else if (ev.data instanceof ArrayBuffer) {
                const s = decodeSnapshot(ev.data);
                if (s) this.on.snapshot?.(s, this.now());
            }
        };
        ws.onclose = () => {
            if (ws !== this.ws) return;
            this.ws = null;
            this.slot = null;
            if (!this.stopped) this.retry();
        };
        ws.onerror = () => { /* onclose follows */ };
    }

    private retry(): void {
        this.clearTimers();
        if (this.stopped) return;
        this.setState('lost');
        const b = this.o.backoffMs ?? BACKOFF_MS;
        const wait = b[Math.min(this.tries, b.length - 1)];
        this.tries++;
        this.timer = setTimeout(() => this.open(), wait);
    }

    /** lane rooms2: propose a scan for the room (a vote) */
    propose(scene: string): void {
        if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ type: 'propose', scene: { id: scene } }));
    }

    /** lane rooms2: yes to the open vote */
    agree(): void {
        if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ type: 'agree' }));
    }

    private ping(): void {
        if (!this.ws || this.ws.readyState !== 1) return;
        this.ws.send(JSON.stringify({ type: 'ping', t: this.now() }));
        this.pingsSent++;
        this.pinger = setTimeout(() => this.ping(), this.pingsSent < CLOCK_SAMPLES ? FIRST_PING_GAP_MS : PING_EVERY_MS);
    }

    private text(data: string): void {
        let m: Record<string, unknown>;
        try { m = JSON.parse(data) as Record<string, unknown>; } catch { return; }
        const hostSlot = typeof m.hostSlot === 'number' ? m.hostSlot : null;
        switch (m.type) {
            case 'welcome': {
                const w = m as unknown as Welcome;
                this.tries = 0;
                this.slot = w.slot;
                this.hostSlot = hostSlot;
                this.room = w.room;
                this.members.clear();
                for (const x of w.members) this.members.set(x.slot, x.nick);
                this.setState('joined');
                this.on.welcome?.(w);
                this.pingsSent = 0;
                this.ping();
                break;
            }
            case 'joined':
                this.members.set(m.slot as number, m.nick as string);
                this.hostSlot = hostSlot;
                this.on.joined?.({ slot: m.slot as number, nick: m.nick as string }, hostSlot);
                break;
            case 'left':
                this.members.delete(m.slot as number);
                this.hostSlot = hostSlot;
                this.on.left?.(m.slot as number, hostSlot);
                break;
            case 'pong':
                if (typeof m.t === 'number' && typeof m.s === 'number') this.clock.add(m.t, m.s, this.now());
                break;
            case 'vote':
                if (m.scene && typeof (m.scene as { id?: unknown }).id === 'string') this.on.vote?.(m as unknown as VoteMsg);
                break;
            case 'scene':
                if (m.room && typeof m.room === 'object') {
                    this.room = m.room as RoomInfo;
                    this.on.scene?.(this.room);
                }
                break;
            case 'error':
                if (typeof m.code === 'string' && FATAL.includes(m.code)) this.close(m.code);
                break;
        }
    }
}
