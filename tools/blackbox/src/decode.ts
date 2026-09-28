// Betaflight blackbox log (.BBL / .BFL / .TXT) decoder.
//
// Written from the documented log format: "Blackbox Logging Internals" (betaflight.com,
// docs/development/Blackbox-Internals.md: frame types, predictors 0-10, encodings, log
// structure, P-frame sampling, validation heuristic), plus facts read from the firmware that
// writes the logs (Betaflight 4.5 / 2026.6 src/main/blackbox: predictor 11 MINMOTOR, the
// single-field TAG8_8SVB case, the event payloads, "P interval" printed as one integer = 1/N).
// No code of the firmware, of blackbox-tools or of Blackbox Explorer (all GPL-3.0) was copied.
// Node-only tooling: nothing here ships with the simulator.

export type FrameKind = 'I' | 'P' | 'S' | 'G' | 'H' | 'E';

export interface FrameDef {
    names: string[];
    signed: number[];
    predictor: number[];
    encoding: number[];
}

export interface BlackboxEvent {
    kind: 'syncBeep' | 'inflightAdjustment' | 'loggingResume' | 'disarm' | 'flightMode' | 'logEnd';
    code: number;
    /** index of the next main frame when the event was read */
    frameIndex: number;
    data: Record<string, number>;
}

export interface DecodeStats {
    frames: Record<FrameKind, number>;
    /** frames whose length or following byte showed damage */
    corrupt: number;
    /** main frames decoded but rejected (time or iteration jumped, or no I-frame to start from) */
    rejectedMain: number;
    /** event frames with an unknown type */
    unknownEvents: number;
    /** bytes skipped while searching for a frame start */
    skippedBytes: number;
    /** true if the log closed with the "End of log" event */
    cleanEnd: boolean;
}

/** A growable column store: one Float64Array per field (values are exact integers up to 2^53). */
export class Columns {
    readonly names: string[];
    private cols: Float64Array[];
    length = 0;
    private cap = 0;
    constructor(names: string[], initial = 4096) {
        this.names = names;
        this.cap = initial;
        this.cols = names.map(() => new Float64Array(initial));
    }
    push(row: ArrayLike<number>): void {
        if (this.length === this.cap) {
            this.cap *= 2;
            this.cols = this.cols.map((c) => {
                const n = new Float64Array(this.cap);
                n.set(c);
                return n;
            });
        }
        for (let i = 0; i < this.cols.length; i++) this.cols[i][this.length] = row[i];
        this.length++;
    }
    index(name: string): number {
        return this.names.indexOf(name);
    }
    has(name: string): boolean {
        return this.names.includes(name);
    }
    /** The column of `name`, trimmed to the number of rows. */
    col(name: string): Float64Array {
        const i = this.names.indexOf(name);
        if (i < 0) throw new Error(`no field ${name}`);
        return this.cols[i].subarray(0, this.length);
    }
    row(k: number): number[] {
        return this.cols.map((c) => c[k]);
    }
}

export interface DecodedLog {
    /** 1-based position in the file */
    index: number;
    headers: Record<string, string>;
    defs: Partial<Record<'I' | 'P' | 'S' | 'G' | 'H', FrameDef>>;
    main: Columns;
    /** 'I' or 'P' per main frame */
    mainKind: Uint8Array;
    /** index into `slow` of the slow frame in force at each main frame (-1 before the first one) */
    mainSlow: Int32Array;
    slow: Columns;
    gps: Columns;
    /** index of the next main frame when each GPS frame was read */
    gpsAtMain: number[];
    gpsHome: Columns;
    events: BlackboxEvent[];
    stats: DecodeStats;
    /** the numbers the predictors and unit conversions need, read from the headers */
    sys: SysConfig;
}

export interface SysConfig {
    dataVersion: number;
    iInterval: number;
    pNum: number;
    pDenom: number;
    minthrottle: number;
    maxthrottle: number;
    motorOutputLow: number;
    motorOutputHigh: number;
    vbatref: number;
    acc1G: number;
    /** deg/s per gyro LSB (gyro_scale header is a float in hex; Betaflight writes 1.0) */
    gyroScale: number;
    firmware: string;
    /** e.g. { major: 4, minor: 5, patch: 1 } from "Betaflight 4.5.1 (77d01ba3b) STM32F405" */
    version: { major: number; minor: number; patch: number } | null;
}

export const LOG_START = 'H Product:Blackbox flight data recorder by Nicholas Sherlock';
const MAX_FRAME_BYTES = 256;
const MAX_TIME_JUMP_US = 10_000_000;
const MAX_ITERATION_JUMP = 5000;

// Predictors (Blackbox-Internals.md; 11 = MINMOTOR from the firmware's field definitions).
const P_ZERO = 0, P_PREVIOUS = 1, P_STRAIGHT = 2, P_AVERAGE2 = 3, P_MINTHROTTLE = 4, P_MOTOR0 = 5, P_INC = 6, P_HOME = 7, P_1500 = 8, P_VBATREF = 9, P_LASTTIME = 10, P_MINMOTOR = 11;
// Encodings.
const E_SVB = 0, E_UVB = 1, E_NEG14 = 3, E_TAG8_8SVB = 6, E_TAG2_3S32 = 7, E_TAG8_4S16 = 8, E_NULL = 9, E_TAG2_3SVAR = 10;

const EVENT_KINDS: Record<number, BlackboxEvent['kind']> = { 0: 'syncBeep', 13: 'inflightAdjustment', 14: 'loggingResume', 15: 'disarm', 30: 'flightMode', 255: 'logEnd' };
const END_OF_LOG = 'End of log\0';

class Reader {
    pos: number;
    eof = false;
    constructor(readonly buf: Uint8Array, start: number, readonly end: number) {
        this.pos = start;
    }
    byte(): number {
        if (this.pos < this.end) return this.buf[this.pos++];
        this.eof = true;
        return 0;
    }
    /** Unsigned variable-byte (7 bits per byte, low group first, at most 5 bytes = 32 bits). */
    uvb(): number {
        let result = 0;
        let mul = 1;
        for (let i = 0; i < 5; i++) {
            if (this.pos >= this.end) {
                this.eof = true;
                return 0;
            }
            const c = this.buf[this.pos++];
            result += (c & 0x7f) * mul;
            if (c < 0x80) return result >>> 0;
            mul *= 128;
        }
        return 0; // longer than 5 bytes: not a valid 32-bit value
    }
    /** ZigZag-folded signed variable-byte. */
    svb(): number {
        const u = this.uvb();
        return ((u >>> 1) ^ -(u & 1)) | 0;
    }
}

const signExtend = (v: number, bits: number) => {
    const shift = 32 - bits;
    return (v << shift) >> shift;
};

function tag8_8svb(r: Reader, out: number[], count: number): void {
    if (count === 1) {
        // A group of one field is written without a header byte.
        out[0] = r.svb();
        return;
    }
    let header = r.byte();
    for (let i = 0; i < 8; i++, header >>= 1) {
        const v = header & 1 ? r.svb() : 0;
        if (i < count) out[i] = v;
    }
}

function tag2_3s32(r: Reader, out: number[]): void {
    const lead = r.byte();
    switch (lead >> 6) {
        case 0: // three 2-bit fields in the low 6 bits
            out[0] = signExtend((lead >> 4) & 3, 2);
            out[1] = signExtend((lead >> 2) & 3, 2);
            out[2] = signExtend(lead & 3, 2);
            break;
        case 1: {
            // 4-bit fields: first in the lead byte's low nibble, then high / low nibble of the next
            out[0] = signExtend(lead & 0x0f, 4);
            const b = r.byte();
            out[1] = signExtend(b >> 4, 4);
            out[2] = signExtend(b & 0x0f, 4);
            break;
        }
        case 2: // 6-bit fields: one per byte
            out[0] = signExtend(lead & 0x3f, 6);
            out[1] = signExtend(r.byte() & 0x3f, 6);
            out[2] = signExtend(r.byte() & 0x3f, 6);
            break;
        default: {
            // 2 bits per field (first field lowest) give its size in bytes, little-endian
            let sel = lead & 0x3f;
            for (let i = 0; i < 3; i++, sel >>= 2) {
                switch (sel & 3) {
                    case 0:
                        out[i] = signExtend(r.byte(), 8);
                        break;
                    case 1: {
                        const b0 = r.byte();
                        out[i] = signExtend(b0 | (r.byte() << 8), 16);
                        break;
                    }
                    case 2: {
                        const b0 = r.byte();
                        const b1 = r.byte();
                        out[i] = signExtend(b0 | (b1 << 8) | (r.byte() << 16), 24);
                        break;
                    }
                    default: {
                        const b0 = r.byte();
                        const b1 = r.byte();
                        const b2 = r.byte();
                        out[i] = (b0 | (b1 << 8) | (b2 << 16) | (r.byte() << 24)) | 0;
                    }
                }
            }
        }
    }
}

/** TAG8_4S16, data version 2: a selector byte (2 bits per field, first field lowest), then a nibble stream, high nibble first. */
function tag8_4s16(r: Reader, out: number[]): void {
    let sel = r.byte();
    let half = false; // true when the low nibble of `cur` is still unread
    let cur = 0;
    for (let i = 0; i < 4; i++, sel >>= 2) {
        switch (sel & 3) {
            case 0:
                out[i] = 0;
                break;
            case 1:
                if (!half) {
                    cur = r.byte();
                    out[i] = signExtend(cur >> 4, 4);
                    half = true;
                } else {
                    out[i] = signExtend(cur & 0x0f, 4);
                    half = false;
                }
                break;
            case 2:
                if (!half) {
                    out[i] = signExtend(r.byte(), 8);
                } else {
                    const hi = cur & 0x0f;
                    cur = r.byte();
                    out[i] = signExtend((hi << 4) | (cur >> 4), 8);
                }
                break;
            default:
                if (!half) {
                    const hi = r.byte();
                    out[i] = signExtend((hi << 8) | r.byte(), 16);
                } else {
                    const n1 = cur & 0x0f;
                    const mid = r.byte();
                    cur = r.byte();
                    out[i] = signExtend((n1 << 12) | (mid << 4) | (cur >> 4), 16);
                }
        }
    }
}

/** TAG2_3SVARIABLE (encoding 10): like TAG2_3S32 but with 5/5/4-bit and 8/7/7-bit packings. */
function tag2_3svariable(r: Reader, out: number[]): void {
    const lead = r.byte();
    switch (lead >> 6) {
        case 0: // 2 bits each
            out[0] = signExtend((lead >> 4) & 3, 2);
            out[1] = signExtend((lead >> 2) & 3, 2);
            out[2] = signExtend(lead & 3, 2);
            break;
        case 1: {
            // 5, 5, 4 bits over two bytes
            const b = r.byte();
            out[0] = signExtend((lead & 0x3e) >> 1, 5);
            out[1] = signExtend(((lead & 0x01) << 4) | (b >> 4), 5);
            out[2] = signExtend(b & 0x0f, 4);
            break;
        }
        case 2: {
            // 8, 7, 7 bits over three bytes
            const b1 = r.byte();
            const b2 = r.byte();
            out[0] = signExtend(((lead & 0x3f) << 2) | (b1 >> 6), 8);
            out[1] = signExtend(((b1 & 0x3f) << 1) | (b2 >> 7), 7);
            out[2] = signExtend(b2 & 0x7f, 7);
            break;
        }
        default:
            tag2_3s32Bytes(r, lead, out);
    }
}

function tag2_3s32Bytes(r: Reader, lead: number, out: number[]): void {
    let sel = lead & 0x3f;
    for (let i = 0; i < 3; i++, sel >>= 2) {
        let v = 0;
        const n = (sel & 3) + 1;
        for (let k = 0; k < n; k++) v |= r.byte() << (8 * k);
        out[i] = n === 4 ? v | 0 : signExtend(v, 8 * n);
    }
}

function parseHeaderLine(line: string, headers: Record<string, string>): void {
    const colon = line.indexOf(':');
    if (colon < 0) return;
    headers[line.slice(2, colon)] = line.slice(colon + 1);
}

const ints = (s: string | undefined): number[] => (s ? s.split(',').map((x) => Number.parseInt(x, 10)) : []);

function sysConfig(h: Record<string, string>): SysConfig {
    const iInterval = Math.max(1, Number.parseInt(h['I interval'] ?? '32', 10) || 32);
    let pNum = 1;
    let pDenom = 1;
    const p = h['P interval'];
    if (p !== undefined) {
        const slash = p.indexOf('/');
        if (slash >= 0) {
            // Cleanflight / Betaflight 3.x: "num/denom" logging rate
            pNum = Number.parseInt(p.slice(0, slash), 10) || 1;
            pDenom = Number.parseInt(p.slice(slash + 1), 10) || 1;
        } else {
            // Betaflight 4.x: one P frame every N iterations
            pDenom = Math.max(1, Number.parseInt(p, 10) || 1);
        }
    }
    const motorOutput = ints(h.motorOutput);
    const minthrottle = Number.parseInt(h.minthrottle ?? '1150', 10);
    const maxthrottle = Number.parseInt(h.maxthrottle ?? '1850', 10);
    let gyroScale = 1;
    const gs = h.gyro_scale ?? h['gyro.scale'];
    if (gs) {
        const bits = Number.parseInt(gs, 16) >>> 0;
        const dv = new DataView(new ArrayBuffer(4));
        dv.setUint32(0, bits);
        gyroScale = dv.getFloat32(0);
    }
    const fw = h['Firmware revision'] ?? '';
    const vm = /Betaflight\s+(\d+)\.(\d+)\.(\d+)/.exec(fw);
    return {
        dataVersion: Number.parseInt(h['Data version'] ?? '1', 10),
        iInterval,
        pNum,
        pDenom,
        minthrottle,
        maxthrottle,
        motorOutputLow: motorOutput.length === 2 ? motorOutput[0] : minthrottle,
        motorOutputHigh: motorOutput.length === 2 ? motorOutput[1] : maxthrottle,
        vbatref: Number.parseInt(h.vbatref ?? '4095', 10),
        acc1G: Number.parseInt(h.acc_1G ?? '1', 10),
        gyroScale,
        firmware: fw,
        version: vm ? { major: Number(vm[1]), minor: Number(vm[2]), patch: Number(vm[3]) } : null
    };
}

/** Byte offsets of every log start marker in the file. */
export function findLogStarts(buf: Uint8Array): number[] {
    const marker = new TextEncoder().encode(LOG_START);
    const starts: number[] = [];
    outer: for (let i = buf.indexOf(marker[0]); i >= 0 && i <= buf.length - marker.length; i = buf.indexOf(marker[0], i + 1)) {
        for (let k = 1; k < marker.length; k++) if (buf[i + k] !== marker[k]) continue outer;
        starts.push(i);
    }
    return starts;
}

/** Decode every log in a blackbox file. */
export function decodeBlackbox(buf: Uint8Array): DecodedLog[] {
    const starts = findLogStarts(buf);
    return starts.map((s, i) => decodeOne(buf, s, i + 1 < starts.length ? starts[i + 1] : buf.length, i + 1));
}

function decodeOne(buf: Uint8Array, start: number, end: number, index: number): DecodedLog {
    // ---- headers: lines "H name:value\n" until a line does not start with 'H'
    const headers: Record<string, string> = {};
    let pos = start;
    const dec = new TextDecoder('latin1');
    while (pos < end && buf[pos] === 0x48 /* H */ && buf[pos + 1] === 0x20) {
        let e = pos;
        while (e < end && buf[e] !== 0x0a) e++;
        parseHeaderLine(dec.decode(buf.subarray(pos, e)), headers);
        pos = e + 1;
    }
    const defs: DecodedLog['defs'] = {};
    for (const k of ['I', 'P', 'S', 'G', 'H'] as const) {
        const names = headers[`Field ${k} name`]?.split(',');
        const predictor = ints(headers[`Field ${k} predictor`]);
        const encoding = ints(headers[`Field ${k} encoding`]);
        if (k === 'P') {
            // P frames share the I-frame names and signedness.
            if (predictor.length) defs.P = { names: defs.I?.names ?? [], signed: defs.I?.signed ?? [], predictor, encoding };
            continue;
        }
        if (!names) continue;
        defs[k] = { names, signed: ints(headers[`Field ${k} signed`]), predictor, encoding };
    }
    const sys = sysConfig(headers);
    const I = defs.I;
    const P = defs.P;
    if (!I || !P) throw new Error(`log ${index}: missing the I or P field definitions`);
    if (sys.dataVersion < 2 && I.encoding.concat(P.encoding).includes(E_TAG8_4S16)) {
        throw new Error(`log ${index}: data version ${sys.dataVersion} TAG8_4S16 is not supported (Betaflight writes version 2)`);
    }
    const nMain = I.names.length;
    const iterIdx = I.names.indexOf('loopIteration');
    const timeIdx = I.names.indexOf('time');
    const motor0Idx = I.names.indexOf('motor[0]');
    // GPS home coordinates are predicted from the H frame, lat from GPS_home[0] and lon from [1].
    const G = defs.G;
    const H = defs.H;
    const homeIdx = [H?.names.indexOf('GPS_home[0]') ?? -1, H?.names.indexOf('GPS_home[1]') ?? -1];

    const main = new Columns(I.names, 65536);
    const kinds: number[] = [];
    const slowRef: number[] = [];
    const slow = new Columns(defs.S?.names ?? [], 64);
    const gps = new Columns(G?.names ?? [], 1024);
    const gpsAtMain: number[] = [];
    const gpsHome = new Columns(H?.names ?? [], 16);
    const events: BlackboxEvent[] = [];
    const stats: DecodeStats = { frames: { I: 0, P: 0, S: 0, G: 0, H: 0, E: 0 }, corrupt: 0, rejectedMain: 0, unknownEvents: 0, skippedBytes: 0, cleanEnd: false };

    let prev1: number[] | null = null; // last accepted main frame
    let prev2: number[] | null = null; // the one before
    let mainValid = false;
    let lastIter = -1;
    let lastTime = -1;
    let rollover = 0;
    let home: number[] | null = null;
    let lastSlowIndex = -1;
    const tmp: number[] = new Array(8).fill(0);

    const shouldHaveFrame = (i: number) => ((i % sys.iInterval) + sys.pNum - 1) % sys.pDenom < sys.pNum;
    const skippedSince = (last: number) => {
        if (last < 0) return 0;
        let n = 0;
        for (let i = last + 1; !shouldHaveFrame(i) && n < sys.iInterval * sys.pDenom; i++) n++;
        return n;
    };

    const predict = (def: FrameDef, i: number, raw: number, cur: number[], p1: number[] | null, p2: number[] | null): number => {
        switch (def.predictor[i]) {
            case P_ZERO:
                return raw;
            case P_PREVIOUS:
                return p1 ? raw + p1[i] : raw;
            case P_STRAIGHT:
                return p1 && p2 ? raw + 2 * p1[i] - p2[i] : raw;
            case P_AVERAGE2:
                return p1 && p2 ? raw + Math.trunc((p1[i] + p2[i]) / 2) : raw;
            case P_MINTHROTTLE:
                return raw + sys.minthrottle;
            case P_MOTOR0:
                return raw + cur[motor0Idx];
            case P_1500:
                return raw + 1500;
            case P_VBATREF:
                return raw + sys.vbatref;
            case P_LASTTIME:
                return raw + (prev1 ? prev1[timeIdx] : 0);
            case P_MINMOTOR:
                return raw + sys.motorOutputLow;
            case P_HOME:
                // lat for the first coordinate field, lon for the second
                if (!home) return raw;
                return raw + home[homeIdx[def.names[i].endsWith('[1]') ? 1 : 0]];
            default:
                throw new Error(`log ${index}: predictor ${def.predictor[i]} is not in the format`);
        }
    };

    /** Read one frame's fields into `cur`, applying predictors against p1 / p2. */
    const readFields = (r: Reader, def: FrameDef, cur: number[], p1: number[] | null, p2: number[] | null, skipped: number) => {
        const n = def.names.length;
        let i = 0;
        while (i < n) {
            if (def.predictor[i] === P_INC) {
                cur[i] = skipped + 1 + (p1 ? p1[i] : 0);
                i++;
                continue;
            }
            const enc = def.encoding[i];
            let group = 0;
            switch (enc) {
                case E_TAG8_8SVB: {
                    let j = i + 1;
                    while (j < i + 8 && j < n && def.encoding[j] === E_TAG8_8SVB) j++;
                    group = j - i;
                    tag8_8svb(r, tmp, group);
                    break;
                }
                case E_TAG2_3S32:
                    group = 3;
                    tag2_3s32(r, tmp);
                    break;
                case E_TAG2_3SVAR:
                    group = 3;
                    tag2_3svariable(r, tmp);
                    break;
                case E_TAG8_4S16:
                    group = 4;
                    tag8_4s16(r, tmp);
                    break;
            }
            if (group > 0) {
                for (let k = 0; k < group && i < n; k++, i++) cur[i] = predict(def, i, tmp[k], cur, p1, p2);
                continue;
            }
            let raw: number;
            switch (enc) {
                case E_SVB:
                    raw = r.svb();
                    break;
                case E_UVB:
                    raw = r.uvb();
                    break;
                case E_NEG14: {
                    const w = r.uvb() & 0xffff;
                    raw = -(w & 0x2000 ? (w | 0xc000) - 0x10000 : w);
                    break;
                }
                case E_NULL:
                    raw = 0;
                    break;
                default:
                    throw new Error(`log ${index}: encoding ${enc} is not supported (field ${def.names[i]})`);
            }
            const v = predict(def, i, raw, cur, p1, p2);
            // Fields are 32-bit in the firmware: wrap like it does.
            cur[i] = def.signed[i] ? v | 0 : v >>> 0;
            i++;
        }
    };

    const isMarker = (c: number) => c === 0x49 || c === 0x50 || c === 0x53 || c === 0x47 || c === 0x48 || c === 0x45;
    // Skip anything before the first frame marker after the headers.
    while (pos < end && !isMarker(buf[pos])) pos++;

    while (pos < end) {
        const marker = buf[pos];
        if (!isMarker(marker) || (marker === 0x47 && !G) || (marker === 0x48 && !H) || (marker === 0x53 && !defs.S)) {
            mainValid = false;
            stats.skippedBytes++;
            pos++;
            continue;
        }
        const frameStart = pos + 1;
        const r = new Reader(buf, frameStart, end);
        const kind = String.fromCharCode(marker) as FrameKind;
        let cur: number[] = [];
        let event: BlackboxEvent | null = null;
        let eventOk = true;
        let logEnded = false;
        let skipped = 0;
        switch (kind) {
            case 'I':
                cur = new Array(nMain).fill(0);
                readFields(r, I, cur, prev1, prev2, 0);
                break;
            case 'P':
                cur = new Array(nMain).fill(0);
                skipped = skippedSince(lastIter);
                readFields(r, P, cur, mainValid ? prev1 : null, mainValid ? prev2 : null, skipped);
                break;
            case 'S':
                cur = new Array(defs.S!.names.length).fill(0);
                readFields(r, defs.S!, cur, null, null, 0);
                break;
            case 'G':
                cur = new Array(G!.names.length).fill(0);
                readFields(r, G!, cur, null, null, 0);
                break;
            case 'H':
                cur = new Array(H!.names.length).fill(0);
                readFields(r, H!, cur, null, null, 0);
                break;
            case 'E': {
                const code = r.byte();
                const k = EVENT_KINDS[code];
                const data: Record<string, number> = {};
                switch (code) {
                    case 0:
                        data.time = r.uvb() + rollover;
                        break;
                    case 13: {
                        const fn = r.byte();
                        data.function = fn & 0x7f;
                        if (fn > 127) {
                            const b = [r.byte(), r.byte(), r.byte(), r.byte()];
                            data.value = new DataView(new Uint8Array(b).buffer).getFloat32(0, true);
                        } else data.value = r.svb();
                        break;
                    }
                    case 14:
                        data.logIteration = r.uvb();
                        data.time = r.uvb() + rollover;
                        break;
                    case 15:
                        data.reason = r.uvb();
                        break;
                    case 30:
                        data.flags = r.uvb();
                        data.lastFlags = r.uvb();
                        break;
                    case 255: {
                        let s = '';
                        for (let q = 0; q < END_OF_LOG.length; q++) s += String.fromCharCode(r.byte());
                        if (s === END_OF_LOG) logEnded = true;
                        else eventOk = false;
                        break;
                    }
                    default:
                        eventOk = false;
                }
                if (eventOk && k) event = { kind: k, code, frameIndex: main.length, data };
                break;
            }
        }
        const size = r.pos - frameStart;
        const next = r.pos < end ? buf[r.pos] : -1;
        // A frame is believed when it is short enough and the next byte starts a frame (or the log ends exactly there).
        const complete = !r.eof && size <= MAX_FRAME_BYTES && (logEnded || isMarker(next) || next === -1);
        if (!complete || (kind === 'E' && !eventOk)) {
            if (kind === 'E' && !eventOk && complete) stats.unknownEvents++;
            else stats.corrupt++;
            mainValid = false;
            pos = frameStart; // search again from the byte after this marker
            continue;
        }
        pos = r.pos;
        stats.frames[kind]++;

        if (kind === 'I' || kind === 'P') {
            // 32-bit microsecond timer: recover wraps.
            let t = cur[timeIdx] >>> 0;
            if (lastTime >= 0 && t < lastTime % 0x100000000 && ((t - (lastTime % 0x100000000)) >>> 0) < MAX_TIME_JUMP_US) rollover += 0x100000000;
            t += rollover;
            cur[timeIdx] = t;
            const iter = cur[iterIdx];
            const plausible = lastIter < 0 || (iter >= lastIter && iter < lastIter + MAX_ITERATION_JUMP && t >= lastTime && t < lastTime + MAX_TIME_JUMP_US);
            if (kind === 'I') {
                mainValid = plausible;
            } else if (mainValid && !plausible) {
                mainValid = false;
            }
            if (!mainValid) {
                stats.rejectedMain++;
                prev1 = prev2 = null;
                continue;
            }
            lastIter = iter;
            lastTime = t;
            main.push(cur);
            kinds.push(marker);
            slowRef.push(lastSlowIndex);
            if (kind === 'I') {
                prev1 = cur;
                prev2 = cur;
            } else {
                prev2 = prev1;
                prev1 = cur;
            }
        } else if (kind === 'S') {
            slow.push(cur);
            lastSlowIndex = slow.length - 1;
        } else if (kind === 'H') {
            home = cur;
            gpsHome.push(cur);
        } else if (kind === 'G') {
            const ti = G!.names.indexOf('time');
            if (ti >= 0) {
                let t = cur[ti] >>> 0;
                if (lastTime >= 0 && t < lastTime % 0x100000000 && ((t - (lastTime % 0x100000000)) >>> 0) < MAX_TIME_JUMP_US) t += 0x100000000;
                cur[ti] = t + rollover;
            }
            gps.push(cur);
            gpsAtMain.push(main.length);
        } else if (kind === 'E') {
            if (event) {
                events.push(event);
                if (event.kind === 'loggingResume') {
                    // Logging paused and resumed: accept the jump in iteration and time.
                    lastIter = event.data.logIteration;
                    lastTime = event.data.time;
                }
            }
            if (logEnded) {
                stats.cleanEnd = true;
                break;
            }
        }
    }
    return {
        index,
        headers,
        defs,
        main,
        mainKind: Uint8Array.from(kinds),
        mainSlow: Int32Array.from(slowRef),
        slow,
        gps,
        gpsAtMain,
        gpsHome,
        events,
        stats,
        sys
    };
}
