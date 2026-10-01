// A small blackbox log WRITER for tests, written from the documented format (Blackbox-Internals.md
// encodings and predictors; the single-field TAG8_8SVB case and the nibble order of TAG8_4S16 as
// the firmware writes them). It lets the tests produce logs with known values: a round trip through
// our decoder must give them back exactly.

export interface FieldSpec {
    name: string;
    signed: boolean;
    iPredictor: number;
    iEncoding: number;
    pPredictor: number;
    pEncoding: number;
}

class Bytes {
    private buf = new Uint8Array(1 << 16);
    length = 0;
    push(b: number): void {
        if (this.length === this.buf.length) {
            const n = new Uint8Array(this.buf.length * 2);
            n.set(this.buf);
            this.buf = n;
        }
        this.buf[this.length++] = b & 0xff;
    }
    text(s: string): void {
        for (let i = 0; i < s.length; i++) this.push(s.charCodeAt(i));
    }
    uvb(v: number): void {
        let u = v >>> 0;
        while (u > 127) {
            this.push((u & 0x7f) | 0x80);
            u = Math.floor(u / 128);
        }
        this.push(u);
    }
    svb(v: number): void {
        const s = v | 0;
        this.uvb(((s << 1) ^ (s >> 31)) >>> 0);
    }
    bytes(): Uint8Array {
        return this.buf.slice(0, this.length);
    }
}

function tag8_8svb(o: Bytes, vals: number[]): void {
    if (vals.length === 1) {
        o.svb(vals[0]);
        return;
    }
    let header = 0;
    vals.forEach((v, i) => {
        if (v !== 0) header |= 1 << i;
    });
    o.push(header);
    for (const v of vals) if (v !== 0) o.svb(v);
}

function tag2_3s32(o: Bytes, v: number[]): void {
    const fits = (bits: number) => v.every((x) => x >= -(1 << (bits - 1)) && x < 1 << (bits - 1));
    if (fits(2)) o.push((0 << 6) | ((v[0] & 3) << 4) | ((v[1] & 3) << 2) | (v[2] & 3));
    else if (fits(4)) {
        o.push((1 << 6) | (v[0] & 0x0f));
        o.push(((v[1] & 0x0f) << 4) | (v[2] & 0x0f));
    } else if (fits(6)) {
        o.push((2 << 6) | (v[0] & 0x3f));
        o.push(v[1] & 0x3f);
        o.push(v[2] & 0x3f);
    } else {
        const size = (x: number) => (x >= -128 && x < 128 ? 0 : x >= -32768 && x < 32768 ? 1 : x >= -8388608 && x < 8388608 ? 2 : 3);
        const sel = size(v[0]) | (size(v[1]) << 2) | (size(v[2]) << 4);
        o.push((3 << 6) | sel);
        for (const x of v) for (let b = 0; b <= size(x); b++) o.push(x >> (8 * b));
    }
}

function tag8_4s16(o: Bytes, v: number[]): void {
    const size = (x: number) => (x === 0 ? 0 : x >= -8 && x < 8 ? 1 : x >= -128 && x < 128 ? 2 : 3);
    o.push(size(v[0]) | (size(v[1]) << 2) | (size(v[2]) << 4) | (size(v[3]) << 6));
    // nibble stream, high nibble first
    const nib: number[] = [];
    for (const x of v) {
        const s = size(x);
        if (s === 1) nib.push(x & 0xf);
        else if (s === 2) nib.push((x >> 4) & 0xf, x & 0xf);
        else if (s === 3) nib.push((x >> 12) & 0xf, (x >> 8) & 0xf, (x >> 4) & 0xf, x & 0xf);
    }
    if (nib.length % 2) nib.push(0);
    for (let i = 0; i < nib.length; i += 2) o.push((nib[i] << 4) | nib[i + 1]);
}

function tag2_3svariable(o: Bytes, v: number[]): void {
    const inR = (x: number, bits: number) => x >= -(1 << (bits - 1)) && x < 1 << (bits - 1);
    if (v.every((x) => inR(x, 2))) o.push(((v[0] & 3) << 4) | ((v[1] & 3) << 2) | (v[2] & 3));
    else if (inR(v[0], 5) && inR(v[1], 5) && inR(v[2], 4)) {
        o.push((1 << 6) | ((v[0] & 0x1f) << 1) | ((v[1] & 0x1f) >> 4));
        o.push(((v[1] & 0x0f) << 4) | (v[2] & 0x0f));
    } else if (inR(v[0], 8) && inR(v[1], 7) && inR(v[2], 7)) {
        o.push((2 << 6) | ((v[0] & 0xff) >> 2));
        o.push(((v[0] & 0x03) << 6) | ((v[1] & 0x7f) >> 1));
        o.push(((v[1] & 0x01) << 7) | (v[2] & 0x7f));
    } else {
        const size = (x: number) => (x >= -128 && x < 128 ? 0 : x >= -32768 && x < 32768 ? 1 : x >= -8388608 && x < 8388608 ? 2 : 3);
        o.push((3 << 6) | size(v[0]) | (size(v[1]) << 2) | (size(v[2]) << 4));
        for (const x of v) for (let b = 0; b <= size(x); b++) o.push(x >> (8 * b));
    }
}

export class BlackboxWriter {
    private out = new Bytes();
    private prev1: number[] | null = null;
    private prev2: number[] | null = null;
    private iteration = 0;
    constructor(
        readonly fields: FieldSpec[],
        readonly headers: Record<string, string>,
        readonly sys: { minthrottle: number; motorOutputLow: number; vbatref: number; iInterval: number; pDenom: number },
        slow: string[] = []
    ) {
        const o = this.out;
        o.text('H Product:Blackbox flight data recorder by Nicholas Sherlock\n');
        o.text('H Data version:2\n');
        o.text(`H I interval:${sys.iInterval}\n`);
        o.text(`H P interval:${sys.pDenom}\n`);
        o.text(`H Field I name:${fields.map((f) => f.name).join(',')}\n`);
        o.text(`H Field I signed:${fields.map((f) => (f.signed ? 1 : 0)).join(',')}\n`);
        o.text(`H Field I predictor:${fields.map((f) => f.iPredictor).join(',')}\n`);
        o.text(`H Field I encoding:${fields.map((f) => f.iEncoding).join(',')}\n`);
        o.text(`H Field P predictor:${fields.map((f) => f.pPredictor).join(',')}\n`);
        o.text(`H Field P encoding:${fields.map((f) => f.pEncoding).join(',')}\n`);
        if (slow.length) {
            o.text(`H Field S name:${slow.join(',')}\n`);
            o.text(`H Field S signed:${slow.map(() => 0).join(',')}\n`);
            o.text(`H Field S predictor:${slow.map(() => 0).join(',')}\n`);
            o.text(`H Field S encoding:${slow.map(() => 1).join(',')}\n`);
        }
        o.text(`H minthrottle:${sys.minthrottle}\n`);
        o.text(`H motorOutput:${sys.motorOutputLow},2047\n`);
        o.text(`H vbatref:${sys.vbatref}\n`);
        for (const [k, v] of Object.entries(headers)) o.text(`H ${k}:${v}\n`);
    }

    /** The loop iteration of the next frame to log (the caller skips iterations the sampling does not log). */
    get nextIteration(): number {
        return this.iteration;
    }

    private predict(pred: number, i: number, cur: number[]): number {
        const motor0 = this.fields.findIndex((f) => f.name === 'motor[0]');
        switch (pred) {
            case 0:
                return 0;
            case 1:
                return this.prev1![i];
            case 2:
                return 2 * this.prev1![i] - this.prev2![i];
            case 3:
                return Math.trunc((this.prev1![i] + this.prev2![i]) / 2);
            case 4:
                return this.sys.minthrottle;
            case 5:
                return cur[motor0];
            case 8:
                return 1500;
            case 9:
                return this.sys.vbatref;
            case 11:
                return this.sys.motorOutputLow;
            default:
                throw new Error(`writer: predictor ${pred}`);
        }
    }

    /** Log one main frame; values in field order. I or P is chosen from the iteration like the firmware. */
    frame(values: number[], iteration: number): void {
        const intra = iteration % this.sys.iInterval === 0 || !this.prev1;
        const o = this.out;
        o.push(intra ? 0x49 : 0x50);
        const deltas: number[] = [];
        this.fields.forEach((f, i) => {
            const pred = intra ? f.iPredictor : f.pPredictor;
            deltas.push(pred === 6 ? 0 : values[i] - this.predict(pred, i, values));
        });
        let i = 0;
        const enc = (k: number) => (intra ? this.fields[k].iEncoding : this.fields[k].pEncoding);
        while (i < this.fields.length) {
            const e = enc(i);
            if (e === 6) {
                let j = i + 1;
                while (j < i + 8 && j < this.fields.length && enc(j) === 6) j++;
                tag8_8svb(o, deltas.slice(i, j));
                i = j;
            } else if (e === 7) {
                tag2_3s32(o, deltas.slice(i, i + 3));
                i += 3;
            } else if (e === 10) {
                tag2_3svariable(o, deltas.slice(i, i + 3));
                i += 3;
            } else if (e === 8) {
                tag8_4s16(o, deltas.slice(i, i + 4));
                i += 4;
            } else {
                if (e === 0) o.svb(deltas[i]);
                else if (e === 1) o.uvb(deltas[i]);
                else if (e === 3) o.uvb(-deltas[i] & 0x3fff);
                else if (e !== 9) throw new Error(`writer: encoding ${e}`);
                i++;
            }
        }
        if (intra) {
            this.prev1 = values;
            this.prev2 = values;
        } else {
            this.prev2 = this.prev1;
            this.prev1 = values;
        }
        this.iteration = iteration + 1;
    }

    slowFrame(values: number[]): void {
        this.out.push(0x53);
        for (const v of values) this.out.uvb(v);
    }

    event(code: number, payload: number[]): void {
        this.out.push(0x45);
        this.out.push(code);
        for (const v of payload) this.out.uvb(v);
    }

    end(): Uint8Array {
        this.out.push(0x45);
        this.out.push(0xff);
        this.out.text('End of log\0');
        return this.out.bytes();
    }
}
