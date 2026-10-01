import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeBlackbox, type DecodedLog } from '../src/decode';
import { BlackboxWriter, type FieldSpec } from './encode';

const FIX = join(__dirname, '..', 'fixtures');
const sha = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');

/** Our rows in the official CSV's column order, without the rows blackbox_decode drops. */
function canonicalRows(log: DecodedLog, columns: string[]): { rows: number[][]; dropped: number } {
    // blackbox_decode (master) does not know event types 15 (disarm) and 30 (flight mode): after one
    // it loses sync and drops main frames until the next I-frame. We decode them; the comparison
    // leaves exactly those rows out.
    const drop = new Uint8Array(log.main.length);
    for (const e of log.events) {
        if (e.kind !== 'flightMode' && e.kind !== 'disarm') continue;
        for (let k = e.frameIndex; k < log.main.length && log.mainKind[k] !== 0x49; k++) drop[k] = 1;
    }
    const src = columns.map((c) => (log.main.has(c) ? { main: log.main.col(c), slow: -1 } : { main: null, slow: log.slow.names.indexOf(c) }));
    const rows: number[][] = [];
    let dropped = 0;
    for (let k = 0; k < log.main.length; k++) {
        if (drop[k]) {
            dropped++;
            continue;
        }
        const s = log.mainSlow[k];
        rows.push(src.map((c) => (c.main ? c.main[k] : s >= 0 ? log.slow.row(s)[c.slow] : 0)));
    }
    return { rows, dropped };
}

describe('decoder against the official blackbox_decode', () => {
    const vec = JSON.parse(readFileSync(join(FIX, 'pid-analyzer-good_tune-first64k.official.json'), 'utf8'));
    const bytes = new Uint8Array(readFileSync(join(FIX, 'pid-analyzer-good_tune-first64k.bbl')));

    it('Betaflight 3.1.5 excerpt: all 2130 official rows x 35 columns match bit for bit', () => {
        expect(sha(bytes)).toBe(vec.excerptSha256);
        const logs = decodeBlackbox(bytes);
        expect(logs.length).toBe(1);
        const log = logs[0];
        expect(log.sys.firmware).toBe('Betaflight 3.1.5 (4646f9d) OMNIBUSF4');
        // the excerpt ends in the middle of a frame: that last frame is the only damaged one
        expect(log.stats.corrupt).toBe(1);
        const { rows, dropped } = canonicalRows(log, vec.columns);
        expect(rows.length).toBe(vec.rows);
        expect(dropped).toBe(3); // the three frames after the flight-mode event at the start
        expect(rows.slice(0, 3)).toEqual(vec.firstRows);
        expect(rows[rows.length - 1]).toEqual(vec.lastRow);
        expect(sha(rows.map((r) => r.join(',')).join('\n'))).toBe(vec.rowsSha256);
        // P frames log every 8th iteration ("P interval:1/8"), I frames every 32nd.
        const it = log.main.col('loopIteration');
        expect(it[2] - it[1]).toBe(8);
    });

    it('negative control: one changed byte changes the rows and the hash, and the damage stays local', () => {
        const bad = bytes.slice();
        bad[40000] ^= 0x10;
        const log = decodeBlackbox(bad)[0];
        const good = decodeBlackbox(bytes)[0];
        const { rows } = canonicalRows(log, vec.columns);
        expect(sha(rows.map((r) => r.join(',')).join('\n'))).not.toBe(vec.rowsSha256);
        // rows that differ from the clean decode (by time) stay within a couple of I-frame intervals
        const t0 = good.main.col('time');
        const byTime = new Map<number, number>();
        for (let k = 0; k < good.main.length; k++) byTime.set(t0[k], k);
        let differ = 0;
        const t1 = log.main.col('time');
        for (let k = 0; k < log.main.length; k++) {
            const g = byTime.get(t1[k]);
            if (g === undefined || JSON.stringify(log.main.row(k)) !== JSON.stringify(good.main.row(g))) differ++;
        }
        expect(differ).toBeGreaterThan(0);
        expect(differ).toBeLessThanOrEqual(2 * 32);
        expect(Math.abs(log.main.length - good.main.length)).toBeLessThanOrEqual(2 * 32);
    });
});

// ---- round trip through our own writer ------------------------------------------------------------
const F = (name: string, signed: boolean, iP: number, iE: number, pP: number, pE: number): FieldSpec => ({ name, signed, iPredictor: iP, iEncoding: iE, pPredictor: pP, pEncoding: pE });
// Every encoding (0 SVB, 1 UVB, 3 NEG14, 6 TAG8_8SVB incl. a single-field group, 7 TAG2_3S32,
// 8 TAG8_4S16, 9 NULL, 10 TAG2_3SVARIABLE) and every main-frame predictor (0-6, 8, 9, 11).
const FIELDS: FieldSpec[] = [
    F('loopIteration', false, 0, 1, 6, 9),
    F('time', false, 0, 1, 2, 0),
    ...[0, 1, 2].map((i) => F(`axisP[${i}]`, true, 0, 0, 1, 7)),
    ...[0, 1, 2, 3].map((i) => F(`gyroADC[${i}]`, true, 0, 0, 3, 8)),
    ...[0, 1, 2].map((i) => F(`accSmooth[${i}]`, true, 0, 0, 3, 10)),
    F('vbatLatest', false, 9, 3, 1, 6),
    F('servo[0]', false, 8, 0, 1, 0),
    ...[0, 1, 2, 3, 4].map((i) => F(`rcCommand[${i}]`, true, 0, 0, 1, 6)),
    F('motor[0]', false, 11, 1, 3, 0),
    ...[1, 2, 3].map((i) => F(`motor[${i}]`, false, 5, 0, 3, 0)),
    F('debug[0]', true, 4, 0, 1, 0)
];

function lcg(seed: number) {
    let s = seed >>> 0;
    return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

function writeLog(frames: number, seed: number, pDenom = 4, iInterval = 32) {
    const sys = { minthrottle: 1070, motorOutputLow: 48, vbatref: 1650, iInterval, pDenom };
    const w = new BlackboxWriter(FIELDS, { 'Firmware revision': 'Betaflight 4.5.1 (77d01ba3b) TEST', 'P ratio': String(iInterval / pDenom) }, sys, ['flightModeFlags', 'stateFlags']);
    const rnd = lcg(seed);
    const cur = FIELDS.map(() => 0);
    const truth: number[][] = [];
    let it = 0;
    let t = 1_000_000;
    // magnitudes that reach every size class of the tag encodings
    const step = (scale: number) => Math.round((rnd() - 0.5) * scale * (rnd() < 0.1 ? 400 : rnd() < 0.3 ? 20 : 1));
    for (let n = 0; n < frames; n++) {
        cur[0] = it;
        cur[1] = t;
        for (let i = 2; i < FIELDS.length; i++) {
            const f = FIELDS[i];
            if (f.name.startsWith('motor')) cur[i] = Math.max(48, Math.min(2047, (cur[i] || 400) + step(3)));
            else if (f.name === 'vbatLatest') cur[i] = Math.max(0, Math.min(1650, (cur[i] || 1600) + (rnd() < 0.05 ? -1 : 0)));
            else if (f.name === 'servo[0]') cur[i] = 1500 + step(2);
            else if (f.name === 'debug[0]') cur[i] = 1070 + step(3);
            else if (f.name.startsWith('rcCommand')) cur[i] = rnd() < 0.2 ? cur[i] + step(2) : cur[i];
            else cur[i] = Math.max(-30000, Math.min(30000, cur[i] + step(4)));
        }
        if (n === 5) w.slowFrame([2, 8]);
        if (n === 40) w.event(30, [3, 2]); // flight mode
        if (n === 90) w.event(0, [t - 500]); // sync beep
        w.frame(cur.slice(), it);
        truth.push(cur.slice());
        // next logged iteration: the firmware logs I every iInterval and P every pDenom iterations
        it += pDenom;
        t += pDenom * 250 + Math.round((rnd() - 0.5) * 20);
    }
    w.event(15, [4]); // disarm
    return { bytes: w.end(), truth };
}

describe('round trip through our own writer', () => {
    it('every encoding and predictor gives back the written values exactly, events kept', () => {
        const { bytes, truth } = writeLog(3000, 7);
        const log = decodeBlackbox(bytes)[0];
        expect(log.stats.corrupt).toBe(0);
        expect(log.stats.rejectedMain).toBe(0);
        expect(log.stats.cleanEnd).toBe(true);
        expect(log.main.length).toBe(truth.length);
        for (let k = 0; k < truth.length; k++) expect(log.main.row(k), `frame ${k}`).toEqual(truth[k]);
        expect(log.events.map((e) => e.kind)).toEqual(['flightMode', 'syncBeep', 'disarm', 'logEnd']);
        expect(log.events[0].data).toEqual({ flags: 3, lastFlags: 2 });
        expect(log.slow.row(0)).toEqual([2, 8]);
        expect(log.mainSlow[10]).toBe(0);
        expect(log.mainSlow[2]).toBe(-1);
    });

    it('two logs in one file decode separately; garbage before, between and after is skipped', () => {
        const a = writeLog(200, 1).bytes;
        const b = writeLog(300, 2).bytes;
        const junk = new Uint8Array([1, 2, 3, 0x49, 0x50, 9]);
        const file = new Uint8Array([...junk, ...a, ...junk, ...b, ...junk]);
        const logs = decodeBlackbox(file);
        expect(logs.map((l) => l.main.length)).toEqual([200, 300]);
    });

    it('negative control: the same bytes under a wrong P predictor header decode to different values', () => {
        const { bytes, truth } = writeLog(500, 3);
        // gyro fields use AVERAGE_2 (3); claim PREVIOUS (1) instead: same byte length, other values
        const from = 'H Field P predictor:6,2,1,1,1,3,3,3,3,';
        const to = 'H Field P predictor:6,2,1,1,1,1,1,1,1,';
        const at = new TextDecoder('latin1').decode(bytes).indexOf(from);
        expect(at).toBeGreaterThan(0);
        const wrong = bytes.slice();
        for (let q = 0; q < to.length; q++) wrong[at + q] = to.charCodeAt(q);
        const log = decodeBlackbox(wrong)[0];
        let differ = 0;
        for (let k = 0; k < Math.min(log.main.length, truth.length); k++) if (JSON.stringify(log.main.row(k)) !== JSON.stringify(truth[k])) differ++;
        expect(differ).toBeGreaterThan(100);
    });

    it('a log cut in the middle of a frame keeps every complete frame before the cut', () => {
        const { bytes, truth } = writeLog(400, 4);
        const cut = decodeBlackbox(bytes.slice(0, bytes.length - 200))[0];
        expect(cut.stats.cleanEnd).toBe(false);
        expect(cut.main.length).toBeGreaterThan(300);
        for (let k = 0; k < cut.main.length; k++) expect(cut.main.row(k)).toEqual(truth[k]);
    });
});
