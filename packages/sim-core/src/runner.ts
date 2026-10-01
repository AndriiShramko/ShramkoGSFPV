// Fixed-step runner, input log, lives and trace hash.
//
// The physics runs at exactly 1000 steps per simulated second. Frames call advanceTo(t) with
// the page clock; inputs are queued with their own timestamps and applied at the first tick
// at or after that time. Each applied sample is logged together with the tick that actually
// used it, so a replay reproduces the flight bit-for-bit no matter how frames were split.
//
// Two log formats (docs/architecture-v03.md C.9):
// - gsfpv-input-log/2 (v0.3), `new Runner(sim, header)`. The run is a chain of lives: a life
//   starts at the first spawn, at every respawn and at every change of a 'life' setting, and its
//   LifeHeader carries the params, the scene and the start state, so each life replays on its own.
//   A record is Int32 tick*4 + kind plus 8 Float32: ticks reach 6.2 days, where format /1 wrapped
//   at 35.79 min (D-e). The kept lives are bounded by count and bytes (D-f). The respawn director
//   and the flight stats run inside the step loop, so a respawn lands on the same tick at any
//   frame split.
// - gsfpv-input-log/1 (v0.2), `new Runner(sim, log, traceHash)`: kept, unchanged, until its
//   callers move to lives.

import { Sim, S, DT_US } from './sim';
import type { SimEvent, ContactWorld } from './sim';
import { Sha256, sha256Hex } from './sha256';
import { compileParams, hoverSolve } from './params';
import type { ParamOverrides, PresetJson, SimParams } from './params';
import type { LifeHeader, RespawnOpts, RespawnReason, WorldEvent } from './contracts';
import type { RespawnDirector } from './director';
import type { FlightStats } from './stats';

export const MAX_CATCHUP_STEPS = 250;

export interface InputSample {
    tUs: number; // sim-clock microseconds
    ch: ArrayLike<number>;
    /** optional id of the input event (latency measurement); not part of the physics or the log */
    id?: number;
}

export interface LogHeader {
    format: 'gsfpv-input-log/1';
    simCore: string;
    preset: string;
    configHash: string;
    collisionSha256: string | null;
    spawn: [number, number, number, number];
    seed: number;
}

/** Binary log: Int32 t_us + Float32 ch[8] per record. t_us odd = respawn (ch[0..3] = x, y, z, yaw). */
export class InputLog {
    header: LogHeader;
    private buf: ArrayBuffer;
    private view: DataView;
    count = 0;
    static readonly REC = 4 + 8 * 4;

    constructor(header: LogHeader, capacity = 1 << 16) {
        this.header = header;
        this.buf = new ArrayBuffer(capacity * InputLog.REC);
        this.view = new DataView(this.buf);
    }

    private grow(): void {
        const nb = new ArrayBuffer(this.buf.byteLength * 2);
        new Uint8Array(nb).set(new Uint8Array(this.buf));
        this.buf = nb;
        this.view = new DataView(nb);
    }

    push(tUs: number, ch: ArrayLike<number>): void {
        if ((this.count + 1) * InputLog.REC > this.buf.byteLength) this.grow();
        const o = this.count * InputLog.REC;
        this.view.setInt32(o, tUs, true);
        for (let i = 0; i < 8; i++) this.view.setFloat32(o + 4 + i * 4, ch[i] ?? 0, true);
        this.count++;
    }

    record(i: number, ch: Float32Array): number {
        const o = i * InputLog.REC;
        for (let k = 0; k < 8; k++) ch[k] = this.view.getFloat32(o + 4 + k * 4, true);
        return this.view.getInt32(o, true);
    }

    bytes(): Uint8Array {
        return new Uint8Array(this.buf, 0, this.count * InputLog.REC);
    }

    static fromBytes(header: LogHeader, bytes: Uint8Array): InputLog {
        const n = Math.floor(bytes.length / InputLog.REC);
        const log = new InputLog(header, Math.max(16, n));
        new Uint8Array(log.buf).set(bytes.subarray(0, n * InputLog.REC));
        log.count = n;
        return log;
    }

    /** Log of the last `seconds` before tick `endTick`, re-based to start at tick 0 state? No: keeps absolute ticks. */
    slice(fromTick: number, toTick: number): InputLog {
        const out = new InputLog(this.header, 1024);
        const ch = new Float32Array(8);
        for (let i = 0; i < this.count; i++) {
            const t = this.record(i, ch);
            const tick = Math.floor(t / DT_US);
            if (tick >= fromTick && tick <= toTick) out.push(t, ch);
        }
        return out;
    }
}

export interface TrajectoryPoint {
    t: number; // s
    p: [number, number, number];
    q: [number, number, number, number];
    v: [number, number, number];
    motors: [number, number, number, number];
    throttle: number;
    armed: boolean;
    crashed: boolean;
}

// ---------------------------------------------------------------- format /2 records (C.9)

export const LOG_FORMAT_V2 = 'gsfpv-input-log/2';
/** bytes per record, the same 36 as format /1: Int32 code + 8 Float32 channels */
export const REC_BYTES = 36;
export const REC_INPUT = 0;
export const REC_RESPAWN = 1;
export const REC_WORLD = 2;
/** the largest tick a code holds: (2^31 - 1) >> 2 = 536 870 911, 6.2 days at 1 kHz */
export const MAX_LOG_TICK = 0x1fffffff;

/** Reason codes of respawn records (ch[7]). Saved logs depend on this order: append only, never reorder. */
export const RESPAWN_REASONS: readonly RespawnReason[] = ['crash', 'stuck-flipped', 'stuck-wedged', 'manual-start', 'manual-rewind', 'settings', 'scene', 'world'];
export const RESPAWN_FLAG_PLATFORM = 1;
export const RESPAWN_FLAG_KEEP_ARMED = 2;
/** the craft went back along its recorded path (a rewind), not to the start: counted by the stats (D.1 "rewinds") */
export const RESPAWN_FLAG_REWIND = 4;

/**
 * Code of a record that takes effect at `slot`, the sim tick before the next step. An input for
 * tick k+1 is 4k+4 and a respawn or world change after tick k is 4k+1 or 4k+2, so slots never
 * go back in a stream and a replay applies records in stream order.
 */
export function recordCode(kind: number, slot: number): number {
    const t = kind === REC_INPUT ? slot + 1 : slot;
    if (!(t >= 0 && t <= MAX_LOG_TICK) || t !== Math.floor(t)) throw new RangeError(`tick ${t} is outside log format /2 (0..${MAX_LOG_TICK})`);
    return t * 4 + kind;
}

export function recordKind(code: number): number {
    return code & 3;
}

/** The sim tick at which the record takes effect (before the step to slot + 1). */
export function recordSlot(code: number): number {
    return (code & 3) === REC_INPUT ? (code >> 2) - 1 : code >> 2;
}

/** Options as a respawn record stores them: explicit booleans, radius and pack as Float32. */
export function normalizeRespawnOpts(o: RespawnOpts = {}): RespawnOpts {
    const out: RespawnOpts = { platform: o.platform === true, keepArmed: o.keepArmed === true };
    if (o.platformR !== undefined && o.platformR > 0) out.platformR = Math.fround(o.platformR);
    if (o.soc !== undefined && o.soc >= 0) out.soc = Math.fround(o.soc > 1 ? 1 : o.soc);
    return out;
}

export interface RespawnRecord {
    at: [number, number, number, number];
    opts: RespawnOpts;
    reason: RespawnReason;
    /** back along the recorded path (flag 4); false for the start and for a record without the flag */
    rewind: boolean;
}

function writeRespawn(out: Float32Array, at: ArrayLike<number>, o: RespawnOpts, reason: RespawnReason, rewind = false): void {
    const code = RESPAWN_REASONS.indexOf(reason);
    if (code < 0) throw new RangeError(`unknown respawn reason '${reason}'`);
    out[0] = at[0]; out[1] = at[1]; out[2] = at[2]; out[3] = at[3];
    out[4] = (o.platform ? RESPAWN_FLAG_PLATFORM : 0) | (o.keepArmed ? RESPAWN_FLAG_KEEP_ARMED : 0) | (rewind ? RESPAWN_FLAG_REWIND : 0);
    out[5] = o.platformR ?? 0;
    out[6] = o.soc ?? -1;
    out[7] = code;
}

/** Decodes a respawn record: ch[0..3] x, y, z, yaw; ch[4] flags (1 platform, 2 keepArmed, 4 rewind); ch[5] platform radius (0 = default); ch[6] soc (-1 = keep); ch[7] reason. */
export function readRespawn(ch: ArrayLike<number>): RespawnRecord {
    const f = ch[4] | 0;
    const opts: RespawnOpts = { platform: (f & RESPAWN_FLAG_PLATFORM) !== 0, keepArmed: (f & RESPAWN_FLAG_KEEP_ARMED) !== 0 };
    if (ch[5] > 0) opts.platformR = ch[5];
    if (ch[6] >= 0) opts.soc = ch[6];
    const reason = RESPAWN_REASONS[ch[7] | 0];
    if (reason === undefined) throw new RangeError(`unknown respawn reason code ${ch[7]}`);
    return { at: [ch[0], ch[1], ch[2], ch[3]], opts, reason, rewind: (f & RESPAWN_FLAG_REWIND) !== 0 };
}

/** Decodes a world record: ch[0] = s, ch[1..3] = t, ch[4] = floater minBlocks. */
export function readWorld(ch: ArrayLike<number>): WorldEvent {
    return { s: ch[0], t: [ch[1], ch[2], ch[3]], floaterMinBlocks: ch[4] };
}

/** Calls f for every record of a format /2 stream (ch is reused); returns the record count. */
export function forEachRecord(bytes: Uint8Array, f: (kind: number, slot: number, ch: Float32Array, index: number) => void): number {
    const c = new Cursor(bytes);
    for (; c.i < c.n; c.i++) {
        const code = c.code();
        c.load();
        f(code & 3, recordSlot(code), c.ch, c.i);
    }
    return c.n;
}

class Cursor {
    private readonly view: DataView;
    readonly n: number;
    i = 0;
    readonly ch = new Float32Array(8);
    constructor(bytes: Uint8Array) {
        this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        this.n = Math.floor(bytes.byteLength / REC_BYTES);
    }
    code(): number {
        return this.view.getInt32(this.i * REC_BYTES, true);
    }
    load(): void {
        const o = this.i * REC_BYTES + 4;
        for (let k = 0; k < 8; k++) this.ch[k] = this.view.getFloat32(o + k * 4, true);
    }
}

// ---------------------------------------------------------------- header v2 (C.9, removes D-g)

/** JSON with sorted keys and no whitespace. Refuses non-finite numbers: JSON would write them as null (C.7). */
export function canonicalJson(v: unknown): string {
    return JSON.stringify(canon(v, ''));
}

function canon(v: unknown, path: string): unknown {
    if (typeof v === 'number') {
        if (!Number.isFinite(v)) throw new RangeError(`non-finite number at ${path || 'the root'}`);
        return v;
    }
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map((x, i) => canon(x, `${path}[${i}]`));
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort()) {
        const x = (v as Record<string, unknown>)[k];
        if (x !== undefined) out[k] = canon(x, path ? `${path}.${k}` : k);
    }
    return out;
}

/** UTF-8 like TextEncoder (lone surrogates become U+FFFD); sim-core has no platform encoder. */
function utf8(s: string): Uint8Array {
    const out: number[] = [];
    for (let i = 0; i < s.length; i++) {
        let c = s.charCodeAt(i);
        if (c >= 0xd800 && c < 0xe000) {
            const d = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
            if (c < 0xdc00 && d >= 0xdc00 && d < 0xe000) {
                c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
                i++;
            } else c = 0xfffd;
        }
        if (c < 0x80) out.push(c);
        else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
        else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
        else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return Uint8Array.from(out);
}

/** sha256 of the preset's canonical JSON: a later edit of the preset file changes it. */
export function presetSha256(p: PresetJson): string {
    return sha256Hex(utf8(canonicalJson(p)));
}

/** sha256(canonical { presetSha256, overrides, simCore }): the whole config a life flies with. */
export function lifeConfigHash(presetSha: string, overrides: ParamOverrides, simCore: string): string {
    return sha256Hex(utf8(canonicalJson({ presetSha256: presetSha, overrides, simCore })));
}

export interface LifeHeaderInput {
    simCore: string;
    preset: PresetJson;
    overrides?: ParamOverrides;
    collisionSha256?: string | null;
    scene?: LifeHeader['scene'];
    /** x, y, z, yawDeg where the life starts */
    at: [number, number, number, number];
    opts?: RespawnOpts;
    reason?: RespawnReason | 'start';
    /** embed the preset JSON (saved files), so the log survives later preset edits */
    embedPreset?: boolean;
}

/** A header for `new Runner` or `newLife`. The runner fills life.index, startTick, soc and ch. */
export function makeLifeHeader(o: LifeHeaderInput): LifeHeader {
    const overrides = JSON.parse(canonicalJson(o.overrides ?? {})) as ParamOverrides;
    const sha = presetSha256(o.preset);
    const h: LifeHeader = {
        format: LOG_FORMAT_V2,
        simCore: o.simCore,
        preset: o.preset.id,
        presetSha256: sha,
        overrides,
        configHash: lifeConfigHash(sha, overrides, o.simCore),
        collisionSha256: o.collisionSha256 ?? null,
        scene: o.scene ? (JSON.parse(JSON.stringify(o.scene)) as LifeHeader['scene']) : null,
        life: { index: 0, startTick: 0, at: [o.at[0], o.at[1], o.at[2], o.at[3]], opts: normalizeRespawnOpts(o.opts), soc: 1, ch: [], reason: o.reason ?? 'start' },
        seed: 0
    };
    if (o.embedPreset) h.presetJson = JSON.parse(JSON.stringify(o.preset)) as PresetJson;
    return h;
}

/** Why a header cannot start or replay a life, or null. */
export function lifeHeaderProblem(h: LifeHeader): string | null {
    const format = (h as { format?: unknown }).format;
    if (format !== LOG_FORMAT_V2) return `log format ${String(format)} is not ${LOG_FORMAT_V2}: logs saved by v0.2 (format /1) cannot be replayed by this version`;
    let hash: string;
    try {
        hash = lifeConfigHash(h.presetSha256, h.overrides, h.simCore);
    } catch (e) {
        return `the overrides are not JSON-safe: ${(e as Error).message}`;
    }
    return hash === h.configHash ? null : 'configHash does not match presetSha256 + overrides + simCore';
}

function cloneHeader(h: LifeHeader): LifeHeader {
    return JSON.parse(JSON.stringify(h)) as LifeHeader;
}

function stateBytes(sim: Sim): Uint8Array {
    return new Uint8Array(sim.s.buffer, sim.s.byteOffset, sim.s.byteLength);
}

// ---------------------------------------------------------------- lives (C.9, removes D-f)

/** Sim state where a trimmed life's kept records begin: its head was dropped to bound memory. */
export interface LifeSnapshot {
    tick: number;
    s: number[];
    ch: number[];
    /** the latest world record before the snapshot, null = the header's scene transform */
    world: WorldEvent | null;
}

export interface Life {
    header: LifeHeader;
    /** the records; for the current life a view of the live buffer, so copy it to keep it */
    bytes(): Uint8Array;
    endTick: number;
    /** sha256 of every tick's state after hashFrom, set when the life ends (option traceHash) */
    traceHash?: string;
    /**
     * traceHash covers the states of ticks after this one: the life start, or, when the head of a
     * long life was dropped, the start of its last segment (a replay cannot reproduce states it no
     * longer has). Unset = header.life.startTick.
     */
    hashFrom?: number;
    /** set when the head of a long life was dropped: the replay starts here instead of at the header */
    snapshot?: LifeSnapshot;
}

export interface RunnerOptions {
    /** hash every tick's state per life (Life.traceHash, what a saved log is checked against) */
    traceHash?: boolean;
    /** also hash the whole run across lives (Runner.traceHash(), for determinism checks): a second SHA-256 per tick */
    runHash?: boolean;
    /** lives kept, the current one included (30) */
    maxLives?: number;
    /** bytes kept over all lives (32 MiB); Infinity = unbounded */
    maxBytes?: number;
}

export const DEFAULT_MAX_LIVES = 30;
export const DEFAULT_MAX_BYTES = 32 * 1024 * 1024;
/** first buffer of a segment: 1820 records, 3.6 s at a 500 Hz radio */
const SEG_START_BYTES = 1820 * REC_BYTES;

class Segment {
    buf: ArrayBuffer;
    view: DataView;
    used = 0;
    readonly snap: LifeSnapshot | null;
    constructor(snap: LifeSnapshot | null, cap: number) {
        this.snap = snap;
        this.buf = new ArrayBuffer(cap);
        this.view = new DataView(this.buf);
    }
    get held(): number {
        return this.buf.byteLength + (this.snap ? 8 * (this.snap.s.length + this.snap.ch.length) : 0);
    }
    trim(): void {
        if (this.buf.byteLength === this.used) return;
        this.buf = this.buf.slice(0, this.used);
        this.view = new DataView(this.buf);
    }
}

class LifeRec implements Life {
    readonly header: LifeHeader;
    readonly segs: Segment[];
    traceHash?: string;
    hashFrom?: number;
    /** the whole life's hash, until its head is dropped */
    private full: Sha256 | null;
    /** from the start of the last segment, once there are two (the fallback after a trim) */
    private seg: Sha256 | null = null;
    private segFrom = -1;
    private end = -1;
    private readonly now: () => number;

    constructor(header: LifeHeader, now: () => number, hash: boolean, cap: number) {
        this.header = header;
        this.now = now;
        this.full = hash ? new Sha256() : null;
        this.segs = [new Segment(null, cap)];
    }
    /** hashes one tick's state (option traceHash); two hashers only while a long life has several segments */
    hashState(bytes: Uint8Array): void {
        this.full?.update(bytes);
        this.seg?.update(bytes);
    }
    get hashing(): boolean {
        return this.full !== null || this.seg !== null;
    }
    /** a new segment starts after `tick`: the fallback hash starts there */
    segmentAt(tick: number): void {
        if (!this.hashing) return;
        this.seg = new Sha256();
        this.segFrom = tick;
    }
    /** the head was dropped: the whole-life hash can no longer be reproduced */
    headDropped(): void {
        this.full = null;
    }
    get endTick(): number {
        return this.end >= 0 ? this.end : this.now();
    }
    get snapshot(): LifeSnapshot | undefined {
        return this.segs[0].snap ?? undefined;
    }
    get held(): number {
        let n = 0;
        for (const g of this.segs) n += g.held;
        return n;
    }
    bytes(): Uint8Array {
        if (this.segs.length === 1) return new Uint8Array(this.segs[0].buf, 0, this.segs[0].used);
        let n = 0;
        for (const g of this.segs) n += g.used;
        const out = new Uint8Array(n);
        let o = 0;
        for (const g of this.segs) {
            out.set(new Uint8Array(g.buf, 0, g.used), o);
            o += g.used;
        }
        return out;
    }
    close(tick: number): void {
        this.end = tick;
        this.segs[this.segs.length - 1].trim();
        if (this.full) {
            this.traceHash = this.full.digestHex();
            this.hashFrom = this.header.life.startTick;
        } else if (this.seg) {
            this.traceHash = this.seg.digestHex();
            this.hashFrom = this.segFrom;
        }
        this.full = null;
        this.seg = null;
    }
}

export class Runner {
    private simRef: Sim;
    /** format /1 log (v0.2 API); null in format /2 */
    log: InputLog | null = null;
    private queue: InputSample[] = [];
    private qHead = 0;
    private hash: Sha256 | null = null;
    private hashBytes: Uint8Array;
    hitches = 0;
    hitchSteps = 0;
    /** called after every step, before the director decides (for the HUD); keep cheap */
    onStep: ((sim: Sim) => void) | null = null;
    /** format /1 only: live trajectory samples (format /2 recomputes them from the log) */
    trajectory: TrajectoryPoint[] | null = null;
    private lastApplied = new Float32Array(8);
    /** every sim event in order; in format /2 also the 'respawn' events */
    events: SimEvent[] = [];
    /** id of the last input sample the physics has consumed */
    lastAppliedId = 0;

    // ---- format /2 only
    /** decides automatic respawns after every step; the respawn lands on that same tick */
    director: RespawnDirector | null = null;
    /** fed every step and every life, in the same order a replay feeds it */
    stats: FlightStats | null = null;
    /** a new life started (respawn or newLife), after the sim was placed */
    onLife: ((life: Life) => void) | null = null;
    /** a world record was logged: install the transformed collision into the sim now */
    onWorld: ((ev: WorldEvent) => void) | null = null;
    private readonly v2: boolean;
    private kept: LifeRec[] = [];
    private worldNow: WorldEvent | null = null;
    private lifeHash = false;
    private maxLives = DEFAULT_MAX_LIVES;
    private maxBytes = DEFAULT_MAX_BYTES;
    private segCap = Infinity;
    private readonly rec = new Float32Array(8);

    constructor(sim: Sim, header: LifeHeader, o?: RunnerOptions);
    /** v0.2 API, format /1: kept until its callers move to lives. */
    constructor(sim: Sim, log: InputLog | null, traceHash?: boolean);
    constructor(sim: Sim, a: LifeHeader | InputLog | null, b?: RunnerOptions | boolean) {
        this.simRef = sim;
        this.hashBytes = stateBytes(sim);
        if (a === null || a instanceof InputLog) {
            this.v2 = false;
            this.log = a;
            if (b === true) this.hash = new Sha256();
            this.lastApplied.fill(0);
            this.lastApplied[2] = -1;
            this.lastApplied[4] = -1;
            return;
        }
        const problem = lifeHeaderProblem(a);
        if (problem) throw new Error(problem);
        const o = typeof b === 'object' ? b : {};
        this.v2 = true;
        this.lifeHash = o.traceHash === true;
        if (o.runHash === true) this.hash = new Sha256();
        this.maxLives = Math.max(1, o.maxLives ?? DEFAULT_MAX_LIVES);
        this.maxBytes = o.maxBytes ?? DEFAULT_MAX_BYTES;
        // a life keeps at least its last two segments, so the budget always holds with 4 per budget
        this.segCap = Number.isFinite(this.maxBytes) ? Math.max(16, Math.floor(this.maxBytes / 4 / REC_BYTES)) * REC_BYTES : Infinity;
        this.lastApplied.set(sim.ch);
        const h = cloneHeader(a);
        const opts = normalizeRespawnOpts(h.life.opts);
        const at = h.life.at;
        // the header is the life's start state by construction: a replay places its sim the same way
        const n = sim.events.length;
        sim.respawn(at[0], at[1], at[2], at[3], opts);
        sim.events.length = n;
        h.life = { index: 0, startTick: sim.tick, at: [at[0], at[1], at[2], at[3]], opts, soc: sim.s[S.soc], ch: Array.from(sim.ch), reason: h.life.reason };
        this.open(h);
    }

    get sim(): Sim {
        return this.simRef;
    }

    get tUs(): number {
        return this.simRef.tick * DT_US;
    }

    enqueue(sample: InputSample): void {
        this.queue.push({ tUs: sample.tUs, ch: Float32Array.from(sample.ch as ArrayLike<number>), id: sample.id });
    }

    /**
     * Respawn between ticks. It is part of the log, so replays reproduce it. In format /2 it ends
     * the current life and starts the next one at this tick; the runner applies the Float32 values
     * it logs.
     */
    respawn(x: number, y: number, z: number, yawDeg: number, opts?: RespawnOpts, reason: RespawnReason = 'manual-start'): void {
        const sim = this.simRef;
        if (!this.v2) {
            const tick = sim.tick;
            this.log?.push(tick * DT_US + 1, [x, y, z, yawDeg, 0, 0, 0, 0]);
            const f = Float32Array.from([x, y, z, yawDeg]);
            sim.respawn(f[0], f[1], f[2], f[3]);
            // the v1 log has no lives, but the stats still start a new one (the page's v0.2 session)
            this.stats?.newLife([f[0], f[1], f[2]], reason, false);
            return;
        }
        this.respawnV2(x, y, z, yawDeg, opts, reason, reason === 'manual-rewind');
    }

    private respawnV2(x: number, y: number, z: number, yawDeg: number, opts: RespawnOpts | undefined, reason: RespawnReason, rewind: boolean): void {
        const sim = this.simRef;
        writeRespawn(this.rec, [x, y, z, yawDeg], normalizeRespawnOpts(opts), reason, rewind);
        this.push(recordCode(REC_RESPAWN, sim.tick), this.rec);
        const r = readRespawn(this.rec);
        const base = cloneHeader(this.cur().header);
        base.scene = this.sceneNow();
        this.worldNow = null;
        this.nextLife(sim, base, r);
    }

    /** The scene as the log has it now: the current life's header with its world records applied. */
    private sceneNow(): LifeHeader['scene'] {
        const sc = this.cur().header.scene;
        if (!sc) return null;
        const out = { ...sc, transform: [sc.transform[0], sc.transform[1], sc.transform[2], sc.transform[3]] as [number, number, number, number] };
        const w = this.worldNow;
        if (w) {
            out.transform = [w.s, w.t[0], w.t[1], w.t[2]];
            out.floaterMinBlocks = w.floaterMinBlocks;
        }
        return out;
    }

    /**
     * A 'life' setting changed (A.7): continue on a new Sim built from `header`'s params, with the
     * tick, the channels and the pack carried over. The runner fills life.index, startTick, soc and
     * ch, and, on the same scene (id and version), the scene transform: only world records change it,
     * so the log's value wins over a stale one in the caller's header (the life then replays alone).
     * The rest of the header is the caller's (params, scene, floaterMinBlocks, at, opts, reason).
     */
    newLife(sim: Sim, header: LifeHeader): void {
        if (!this.v2) throw new Error('newLife needs a format /2 runner');
        const problem = lifeHeaderProblem(header);
        if (problem) throw new Error(problem);
        const reason = header.life.reason;
        if (reason === 'start') throw new RangeError("newLife needs a respawn reason such as 'settings', not 'start'");
        const prev = this.simRef;
        if (sim === prev && header.configHash !== this.cur().header.configHash) throw new Error('a new config needs a new Sim built from it');
        writeRespawn(this.rec, header.life.at, normalizeRespawnOpts(header.life.opts), reason);
        this.push(recordCode(REC_RESPAWN, prev.tick), this.rec);
        const h = cloneHeader(header);
        const now = this.sceneNow();
        if (h.scene && now && h.scene.id === now.id && h.scene.version === now.version) h.scene.transform = now.transform;
        this.worldNow = null;
        this.nextLife(sim, h, readRespawn(this.rec));
    }

    /** Logs a world record (E.7) at the tick boundary, then calls onWorld with the Float32 values. */
    world(ev: WorldEvent): void {
        if (!this.v2) throw new Error('world records need a format /2 runner');
        const r = this.rec;
        r.fill(0);
        r[0] = ev.s; r[1] = ev.t[0]; r[2] = ev.t[1]; r[3] = ev.t[2]; r[4] = ev.floaterMinBlocks;
        this.push(recordCode(REC_WORLD, this.simRef.tick), r);
        const w = readWorld(r);
        this.worldNow = w;
        this.onWorld?.(w);
    }

    /** The kept lives, oldest first; the last one is the current life. */
    lives(): readonly Life[] {
        return this.kept.slice();
    }

    current(): Life {
        return this.cur();
    }

    /** Bytes the kept lives hold (record buffers and snapshots); at most maxBytes. */
    bytesKept(): number {
        let n = 0;
        for (const l of this.kept) n += l.held;
        return n;
    }

    /** Step until the sim clock reaches tUs (at most MAX_CATCHUP_STEPS). Returns steps taken. */
    advanceTo(tUs: number): number {
        let steps = 0;
        while (this.simRef.tick * DT_US + DT_US <= tUs) {
            if (steps >= MAX_CATCHUP_STEPS) {
                this.hitches++;
                const skip = Math.floor((tUs - this.simRef.tick * DT_US) / DT_US);
                this.hitchSteps += skip;
                return steps;
            }
            this.stepOnce();
            steps++;
        }
        return steps;
    }

    /** One tick: apply every queued sample with t <= the new tick time, then step. */
    stepOnce(): void {
        const sim = this.simRef;
        const nextT = (sim.tick + 1) * DT_US;
        let applied = false;
        while (this.qHead < this.queue.length && this.queue[this.qHead].tUs <= nextT) {
            const smp = this.queue[this.qHead++];
            for (let i = 0; i < 8; i++) this.lastApplied[i] = smp.ch[i] ?? 0;
            if (smp.id !== undefined) this.lastAppliedId = smp.id;
            applied = true;
        }
        if (this.qHead > 4096) {
            this.queue = this.queue.slice(this.qHead);
            this.qHead = 0;
        }
        if (applied) {
            // format /2 logs before applying, so a segment snapshot taken here is the state this record changes
            if (this.v2) this.push(recordCode(REC_INPUT, sim.tick), this.lastApplied);
            sim.setChannels(this.lastApplied);
            this.log?.push(nextT, this.lastApplied);
        }
        const nEv = sim.events.length;
        sim.step();
        for (let i = nEv; i < sim.events.length; i++) this.emit(sim.events[i]);
        if (sim.events.length > 256) sim.events.length = 0;
        if (this.hash) this.hash.update(this.hashBytes);
        if (this.lifeHash) this.cur().hashState(this.hashBytes);
        if (this.trajectory && sim.tick % 10 === 0) this.trajectory.push(trajPoint(sim));
        this.stats?.onStep(sim);
        this.onStep?.(sim);
        if (this.director) {
            const r = this.director.decide(this.simRef);
            if (r) {
                if (this.v2) this.respawnV2(r.x, r.y, r.z, r.yawDeg, r.opts, r.reason, r.rewind === true);
                else this.respawn(r.x, r.y, r.z, r.yawDeg, r.opts, r.reason);
            }
        }
    }

    /** SHA-256 of every tick's state since the runner started. Finalises the hash: call it once, at the end. */
    traceHash(): string {
        if (!this.hash) throw new Error(this.v2 ? 'run hash not enabled (RunnerOptions.runHash)' : 'trace hash not enabled');
        return this.hash.digestHex();
    }

    private emit(e: SimEvent): void {
        this.events.push(e);
        this.director?.onEvent(e);
        this.stats?.onEvent(e);
    }

    private cur(): LifeRec {
        return this.kept[this.kept.length - 1];
    }

    /** Ends the current life at this tick and places `next` (the same or a new Sim) as the next life's start. */
    private nextLife(next: Sim, header: LifeHeader, r: RespawnRecord): void {
        const prev = this.simRef;
        const tick = prev.tick;
        this.cur().close(tick);
        let opts = r.opts;
        if (next !== prev) {
            next.tick = tick;
            next.setChannels(prev.ch);
            // the pack carries over into the new model unless the respawn gives a fresh one
            if (opts.soc === undefined) opts = { ...opts, soc: prev.s[S.soc] };
            this.simRef = next;
            this.hashBytes = stateBytes(next);
        }
        const nEv = next.events.length;
        next.respawn(r.at[0], r.at[1], r.at[2], r.at[3], opts);
        const index = this.cur().header.life.index + 1;
        header.life = { index, startTick: tick, at: [r.at[0], r.at[1], r.at[2], r.at[3]], opts: { ...r.opts }, soc: next.s[S.soc], ch: Array.from(next.ch), reason: r.reason };
        this.open(header);
        this.stats?.newLife([r.at[0], r.at[1], r.at[2]], r.reason, r.rewind);
        for (let i = nEv; i < next.events.length; i++) this.emit(next.events[i]);
        this.onLife?.(this.cur());
    }

    private open(h: LifeHeader): void {
        const life = new LifeRec(h, () => this.simRef.tick, this.lifeHash, Math.min(SEG_START_BYTES, this.segCap));
        this.kept.push(life);
        this.enforce();
    }

    private push(code: number, ch: ArrayLike<number>): void {
        const life = this.cur();
        let seg = life.segs[life.segs.length - 1];
        if (seg.used + REC_BYTES > seg.buf.byteLength) seg = this.room(life, seg);
        const o = seg.used;
        const v = seg.view;
        v.setInt32(o, code, true);
        for (let i = 0; i < 8; i++) v.setFloat32(o + 4 + i * 4, ch[i] ?? 0, true);
        seg.used = o + REC_BYTES;
    }

    private room(life: LifeRec, seg: Segment): Segment {
        if (seg.buf.byteLength < this.segCap) {
            const nb = new ArrayBuffer(Math.min(this.segCap, seg.buf.byteLength * 2));
            new Uint8Array(nb).set(new Uint8Array(seg.buf, 0, seg.used));
            seg.buf = nb;
            seg.view = new DataView(nb);
        } else {
            // the segment is full: the next one starts from a snapshot of the state its first record changes
            seg.trim();
            const sim = this.simRef;
            seg = new Segment({ tick: sim.tick, s: Array.from(sim.s), ch: Array.from(sim.ch), world: this.worldNow }, Math.min(SEG_START_BYTES, this.segCap));
            life.segs.push(seg);
            life.segmentAt(sim.tick);
        }
        this.enforce();
        return seg;
    }

    /** Oldest lives go first; a single long life drops its oldest segments but keeps two. */
    private enforce(): void {
        while (this.kept.length > this.maxLives) this.kept.shift();
        let held = this.bytesKept();
        while (held > this.maxBytes && this.kept.length > 1) held -= this.kept.shift()!.held;
        const cur = this.cur();
        while (held > this.maxBytes && cur.segs.length > 2) {
            held -= cur.segs.shift()!.held;
            cur.headDropped();
        }
    }
}

export function trajPoint(sim: Sim): TrajectoryPoint {
    const s = sim.s;
    return {
        t: sim.tick / 1000,
        p: [s[S.px], s[S.py], s[S.pz]],
        q: [s[S.qw], s[S.qx], s[S.qy], s[S.qz]],
        v: [s[S.vx], s[S.vy], s[S.vz]],
        motors: [s[S.m0], s[S.m1], s[S.m2], s[S.m3]],
        throttle: (sim.ch[2] + 1) / 2,
        armed: s[S.armed] > 0,
        crashed: s[S.crashed] > 0
    };
}

/**
 * Replay a format /1 log from a fresh sim (same params, same spawn) and return the trace hash.
 * The runner applies records exactly at their logged ticks.
 */
export function replay(sim: Sim, log: InputLog, endTick: number, onStep?: (sim: Sim) => void): string {
    const h = new Sha256();
    const bytes = new Uint8Array(sim.s.buffer, sim.s.byteOffset, sim.s.byteLength);
    const ch = new Float32Array(8);
    let i = 0;
    let nextT = log.count > 0 ? log.record(0, ch) : Infinity;
    while (sim.tick < endTick) {
        const tickT = (sim.tick + 1) * DT_US;
        while (i < log.count && nextT <= tickT) {
            const t = log.record(i, ch);
            if ((t & 1) === 1) {
                // respawn happens between ticks, before the tick whose time is t-1
                sim.respawn(ch[0], ch[1], ch[2], ch[3]);
            } else {
                sim.setChannels(ch);
            }
            i++;
            nextT = i < log.count ? log.record(i, ch) : Infinity;
        }
        sim.step();
        h.update(bytes);
        onStep?.(sim);
    }
    return h.digestHex();
}

// ---------------------------------------------------------------- replays of format /2 lives

export interface ReplayDeps {
    /** the preset JSON with this sha256, when the header does not embed it (null: not available) */
    preset(sha: string): PresetJson | null;
    /** the scene's contact world; ev = the transform of a world record, null = the header scene's own */
    world(scene: LifeHeader['scene'], ev: WorldEvent | null): ContactWorld | null;
}

/** The params a life flew with, compiled from its header, never from the session (D-g). */
export function lifeParams(h: LifeHeader, deps: Pick<ReplayDeps, 'preset'>): SimParams {
    const problem = lifeHeaderProblem(h);
    if (problem) throw new Error(problem);
    const preset = h.presetJson ?? deps.preset(h.presetSha256);
    if (!preset) throw new Error(`preset ${h.preset} (sha256 ${h.presetSha256.slice(0, 12)}) is not available`);
    if (presetSha256(preset) !== h.presetSha256) throw new Error(`preset ${h.preset} differs from the one the log was written with`);
    return compileParams(preset, h.overrides);
}

/** A Sim for a life's params, set up the way the session sets up its own (auto-throttle reads hoverThr). */
export function lifeSim(p: SimParams, world: ContactWorld | null): Sim {
    const sim = new Sim(p, world);
    sim.hoverThr = hoverSolve(p, 1).motor;
    return sim;
}

interface Hooks {
    onStep?: (sim: Sim) => void;
    onEvent?: (e: SimEvent) => void;
    /** a respawn record was applied, before its events: where the live runner starts a life */
    onRespawn?: (r: RespawnRecord) => void;
}

/** Places a replay sim at the life's first state: its snapshot, or the header's start. */
function startLife(sim: Sim, life: Life, deps: ReplayDeps): void {
    const snap = life.snapshot;
    if (snap) {
        if (snap.s.length !== sim.s.length) throw new Error(`snapshot holds ${snap.s.length} state slots, this sim-core ${sim.s.length}`);
        sim.s.set(snap.s);
        sim.tick = snap.tick;
        sim.setChannels(snap.ch);
        if (snap.world) sim.world = deps.world(life.header.scene, snap.world);
        return;
    }
    const L = life.header.life;
    sim.tick = L.startTick;
    sim.setChannels(L.ch);
    const n = sim.events.length;
    sim.respawn(L.at[0], L.at[1], L.at[2], L.at[3], { ...normalizeRespawnOpts(L.opts), soc: L.soc });
    sim.events.length = n;
}

function emitFrom(sim: Sim, n: number, hooks: Hooks): void {
    if (hooks.onEvent) for (let i = n; i < sim.events.length; i++) hooks.onEvent(sim.events[i]);
}

/** Applies every record due at sim.tick. carrySoc: the pack of the previous model (a new Sim at a life boundary). */
function applyDue(sim: Sim, cur: Cursor, scene: LifeHeader['scene'], deps: ReplayDeps, hooks: Hooks, carrySoc?: number): void {
    while (cur.i < cur.n) {
        const code = cur.code();
        if (recordSlot(code) > sim.tick) return;
        cur.load();
        const kind = code & 3;
        if (kind === REC_INPUT) sim.setChannels(cur.ch);
        else if (kind === REC_RESPAWN) {
            const r = readRespawn(cur.ch);
            const opts = carrySoc !== undefined && r.opts.soc === undefined ? { ...r.opts, soc: carrySoc } : r.opts;
            const n = sim.events.length;
            sim.respawn(r.at[0], r.at[1], r.at[2], r.at[3], opts);
            hooks.onRespawn?.(r);
            emitFrom(sim, n, hooks);
        } else if (kind === REC_WORLD) sim.world = deps.world(scene, readWorld(cur.ch));
        cur.i++;
    }
}

/** hashFrom: only the states of ticks after it go into the hash (Life.hashFrom). */
function playTo(sim: Sim, cur: Cursor, endTick: number, scene: LifeHeader['scene'], deps: ReplayDeps, hash: Sha256 | null, hooks: Hooks, hashFrom = -Infinity): void {
    const bytes = stateBytes(sim);
    while (sim.tick < endTick) {
        applyDue(sim, cur, scene, deps, hooks);
        const n = sim.events.length;
        sim.step();
        emitFrom(sim, n, hooks);
        if (sim.events.length > 256) sim.events.length = 0;
        if (hash && sim.tick > hashFrom) hash.update(bytes);
        hooks.onStep?.(sim);
    }
}

/** Plays one life tick by tick, from its header (or snapshot) and its records only. */
export class LifePlayer {
    readonly sim: Sim;
    readonly life: Life;
    readonly endTick: number;
    onStep: ((sim: Sim) => void) | null = null;
    onEvent: ((e: SimEvent) => void) | null = null;
    private readonly deps: ReplayDeps;
    private readonly cur: Cursor;
    private readonly hash: Sha256 | null;

    /** o.hash false skips the trace hash (it costs more than the physics on long replays). */
    constructor(life: Life, deps: ReplayDeps, endTick = life.endTick, o: { hash?: boolean } = {}) {
        const h = life.header;
        this.life = life;
        this.deps = deps;
        this.sim = lifeSim(lifeParams(h, deps), deps.world(h.scene, null));
        startLife(this.sim, life, deps);
        this.endTick = Math.min(endTick, life.endTick);
        this.cur = new Cursor(life.bytes().slice());
        this.hash = o.hash === false ? null : new Sha256();
    }

    /** Steps until the sim reaches min(tick, endTick). */
    stepTo(tick: number): void {
        const hooks: Hooks = { onStep: this.onStep ?? undefined, onEvent: this.onEvent ?? undefined };
        playTo(this.sim, this.cur, Math.min(tick, this.endTick), this.life.header.scene, this.deps, this.hash, hooks, this.life.hashFrom ?? this.life.header.life.startTick);
    }

    get done(): boolean {
        return this.sim.tick >= this.endTick;
    }

    /** sha256 of the states stepped after life.hashFrom so far (what Life.traceHash holds); finalises the hash: call it once, at the end. */
    digest(): string {
        if (!this.hash) throw new Error('this player was made without a hash');
        return this.hash.digestHex();
    }
}

/** Replays one life on its own: params from its header, start from its header or snapshot. */
export function replayLife(life: Life, deps: ReplayDeps, endTick?: number, onStep?: (sim: Sim) => void, onEvent?: (e: SimEvent) => void): { hash: string; sim: Sim } {
    const p = new LifePlayer(life, deps, endTick);
    p.onStep = onStep ?? null;
    p.onEvent = onEvent ?? null;
    p.stepTo(p.endTick);
    return { hash: p.digest(), sim: p.sim };
}

/**
 * Replays kept lives in one pass, as the live run went: the respawn record at the end of each
 * life moves the craft into the next one (a changed config swaps in a Sim built from the next
 * header). The hash covers every tick, like Runner.traceHash over the same ticks. o.stats is fed
 * in the live runner's order (a FlightStats made like the live one ends with equal numbers).
 */
export function replayLives(
    lives: readonly Life[],
    deps: ReplayDeps,
    o: { endTick?: number; onStep?: (sim: Sim) => void; onEvent?: (e: SimEvent) => void; onLife?: (life: Life, index: number) => void; stats?: FlightStats } = {}
): { hash: string; sim: Sim } {
    if (lives.length === 0) throw new Error('no lives to replay');
    const st = o.stats;
    const hooks: Hooks = st
        ? {
            onStep: (sim) => { st.onStep(sim); o.onStep?.(sim); },
            onEvent: (e) => { st.onEvent(e); o.onEvent?.(e); },
            onRespawn: (r) => st.newLife([r.at[0], r.at[1], r.at[2]], r.reason, r.rewind)
        }
        : { onStep: o.onStep, onEvent: o.onEvent };
    const end = o.endTick ?? Infinity;
    const hash = new Sha256();
    let sim = lifeSim(lifeParams(lives[0].header, deps), deps.world(lives[0].header.scene, null));
    startLife(sim, lives[0], deps);
    o.onLife?.(lives[0], 0);
    for (let i = 0; i < lives.length; i++) {
        const life = lives[i];
        if (i > 0 && life.snapshot) throw new Error('only the oldest kept life can start from a snapshot');
        const cur = new Cursor(life.bytes().slice());
        const stop = Math.min(end, life.endTick);
        playTo(sim, cur, stop, life.header.scene, deps, hash, hooks);
        const next = lives[i + 1];
        if (!next || stop < life.endTick) break;
        let carrySoc: number | undefined;
        if (next.header.configHash !== life.header.configHash || next.header.collisionSha256 !== life.header.collisionSha256) {
            const fresh = lifeSim(lifeParams(next.header, deps), deps.world(next.header.scene, null));
            fresh.tick = sim.tick;
            fresh.setChannels(sim.ch);
            carrySoc = sim.s[S.soc];
            sim = fresh;
        }
        // the records at the life's last tick: the respawn that ended it, and any world change before it
        applyDue(sim, cur, next.header.scene, deps, hooks, carrySoc);
        o.onLife?.(next, i + 1);
    }
    return { hash: hash.digestHex(), sim };
}

/** The trajectory export, recomputed from the log (no live array any more, D-f): one point every `every` ticks. */
export function lifeTrajectory(life: Life, deps: ReplayDeps, every = 10): TrajectoryPoint[] {
    const out: TrajectoryPoint[] = [];
    replayLife(life, deps, undefined, (sim) => {
        if (sim.tick % every === 0) out.push(trajPoint(sim));
    });
    return out;
}
