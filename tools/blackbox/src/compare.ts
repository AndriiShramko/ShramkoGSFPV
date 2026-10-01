// Compare our decoder with a CSV written by the official `blackbox_decode` (betaflight/blackbox-tools)
// run with `--unit-vbat raw --unit-amperage raw --unit-flags raw` (all other units are raw by
// default except the frame time, which stays in microseconds).
//
// Rows are matched by the frame time: both decoders emit one row per accepted main frame and the
// time is unique per frame. Every shared column must match exactly on every matched row.
// `loopIteration` is compared separately: blackbox_decode (master, 2026-07) reads only the
// "num/denom" form of the "P interval" header, so for Betaflight 4.x logs ("P interval:4") it counts
// one iteration per logged frame, while the firmware logs every 4th iteration (the Blackbox
// Explorer reads it that way, and so do we).

import type { DecodedLog } from './decode';

export interface CompareResult {
    officialRows: number;
    ourRows: number;
    matchedRows: number;
    onlyOfficial: number;
    onlyOurs: number;
    comparedColumns: string[];
    skippedColumns: string[];
    /** cells compared (matched rows x compared columns) */
    cells: number;
    mismatchedCells: number;
    maxAbsDiff: number;
    firstMismatch: { time: number; column: string; ours: number; official: number } | null;
    loopIteration: { officialStep: number[]; ourStep: number[]; ourStepMatchesHeader: boolean };
    /** rows only we emit that follow a disarm or flight-mode event (see below) */
    onlyOursAfterEvent?: number;
}

function splitCsvLine(line: string): string[] {
    return line.split(',').map((s) => s.trim());
}

/** Column name in the official CSV -> our field name ("time (us)" -> "time"). */
function baseName(h: string): string {
    return h.replace(/\s*\(.*\)\s*$/, '');
}

export function compareWithOfficialCsv(log: DecodedLog, csv: string): CompareResult {
    const lines = csv.split(/\r?\n/).filter((l) => l.length > 0);
    const header = splitCsvLine(lines[0]).map(baseName);
    const main = log.main;
    const slowNames = log.slow.names;
    const timeCol = header.indexOf('time');
    if (timeCol < 0) throw new Error('official CSV has no time column');

    const compared: { csv: number; kind: 'main' | 'slow'; idx: number; name: string }[] = [];
    const skipped: string[] = [];
    header.forEach((h, c) => {
        if (h === 'loopIteration') return;
        const mi = main.names.indexOf(h);
        if (mi >= 0) return compared.push({ csv: c, kind: 'main', idx: mi, name: h });
        const si = slowNames.indexOf(h);
        if (si >= 0) return compared.push({ csv: c, kind: 'slow', idx: si, name: h });
        skipped.push(h); // computed by blackbox_decode (e.g. energyCumulative), not a logged field
    });

    const ourTime = main.col('time');
    const byTime = new Map<number, number>();
    for (let k = 0; k < main.length; k++) byTime.set(ourTime[k], k);
    const ourIter = main.col('loopIteration');
    const iterCol = header.indexOf('loopIteration');

    const res: CompareResult = {
        officialRows: lines.length - 1,
        ourRows: main.length,
        matchedRows: 0,
        onlyOfficial: 0,
        onlyOurs: 0,
        comparedColumns: compared.map((c) => c.name),
        skippedColumns: skipped,
        cells: 0,
        mismatchedCells: 0,
        maxAbsDiff: 0,
        firstMismatch: null,
        loopIteration: { officialStep: [], ourStep: [], ourStepMatchesHeader: true }
    };
    const cols = compared.map((c) => (c.kind === 'main' ? main.col(c.name) : null));
    const seen = new Uint8Array(main.length);
    const officialSteps = new Map<number, number>();
    let prevOfficialIter = NaN;
    for (let li = 1; li < lines.length; li++) {
        const cells = splitCsvLine(lines[li]);
        const t = Number(cells[timeCol]);
        if (iterCol >= 0) {
            const it = Number(cells[iterCol]);
            if (!Number.isNaN(prevOfficialIter)) officialSteps.set(it - prevOfficialIter, (officialSteps.get(it - prevOfficialIter) ?? 0) + 1);
            prevOfficialIter = it;
        }
        const k = byTime.get(t);
        if (k === undefined) {
            res.onlyOfficial++;
            continue;
        }
        seen[k] = 1;
        res.matchedRows++;
        const slowRow = log.mainSlow[k];
        compared.forEach((c, ci) => {
            const official = Number(cells[c.csv]);
            const ours = c.kind === 'main' ? cols[ci]![k] : slowRow >= 0 ? log.slow.row(slowRow)[c.idx] : 0;
            res.cells++;
            if (ours !== official) {
                res.mismatchedCells++;
                const d = Math.abs(ours - official);
                if (d > res.maxAbsDiff) res.maxAbsDiff = d;
                if (!res.firstMismatch) res.firstMismatch = { time: t, column: c.name, ours, official };
            }
        });
    }
    for (let k = 0; k < main.length; k++) if (!seen[k]) res.onlyOurs++;
    // loopIteration steps between consecutive rows: ours must follow the header's sampling.
    const ourSteps = new Map<number, number>();
    for (let k = 1; k < main.length; k++) {
        const d = ourIter[k] - ourIter[k - 1];
        ourSteps.set(d, (ourSteps.get(d) ?? 0) + 1);
    }
    const top = (m: Map<number, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map((e) => e[0]);
    res.loopIteration.officialStep = top(officialSteps);
    res.loopIteration.ourStep = top(ourSteps);
    res.loopIteration.ourStepMatchesHeader = res.loopIteration.ourStep[0] === log.sys.pDenom / log.sys.pNum || (log.sys.pNum > 1 && res.loopIteration.ourStep[0] <= Math.ceil(log.sys.pDenom / log.sys.pNum));
    // Where the extra rows are: blackbox_decode does not know event types 15 (disarm) and 30 (flight
    // mode) and drops the main frames that follow them until the next I-frame.
    res.onlyOursAfterEvent = 0;
    const eventFrames = log.events.filter((e) => e.kind === 'flightMode' || e.kind === 'disarm').map((e) => e.frameIndex);
    for (let k = 0; k < main.length; k++) {
        if (seen[k]) continue;
        const after = eventFrames.some((f) => k >= f && k < f + log.sys.iInterval);
        if (after) res.onlyOursAfterEvent++;
    }
    return res;
}

export interface GpsCompareResult {
    officialRows: number;
    ourRows: number;
    matchedRows: number;
    mismatches: number;
    maxCoordDiffDeg: number;
}

/**
 * GPS frames against blackbox_decode's `.gps.csv`: it prints coordinates in degrees (1e-7 units),
 * speed in m/s (cm/s units) and the course in degrees (0.1 units); numSat and altitude raw.
 */
export function compareGpsWithOfficialCsv(log: DecodedLog, csv: string): GpsCompareResult {
    const lines = csv.split(/\r?\n/).filter((l) => l.length > 0);
    const header = splitCsvLine(lines[0]).map(baseName);
    const g = log.gps;
    const res: GpsCompareResult = { officialRows: lines.length - 1, ourRows: g.length, matchedRows: 0, mismatches: 0, maxCoordDiffDeg: 0 };
    const byTime = new Map<number, number>();
    const t = g.col('time');
    for (let k = 0; k < g.length; k++) byTime.set(t[k], k);
    const scale: Record<string, [number, number]> = { 'GPS_coord[0]': [1e-7, 1e-7], 'GPS_coord[1]': [1e-7, 1e-7], GPS_speed: [0.01, 0.005], GPS_ground_course: [0.1, 0.05] };
    for (let li = 1; li < lines.length; li++) {
        const cells = splitCsvLine(lines[li]);
        const k = byTime.get(Number(cells[0]));
        if (k === undefined) continue;
        res.matchedRows++;
        header.forEach((h, c) => {
            if (!g.has(h)) return;
            const [mul, tol] = scale[h] ?? [1, 0];
            const ours = g.col(h)[k] * mul;
            const d = Math.abs(ours - Number(cells[c]));
            if (h.startsWith('GPS_coord') && d > res.maxCoordDiffDeg) res.maxCoordDiffDeg = d;
            if (d > tol + 1e-12) res.mismatches++;
        });
    }
    return res;
}
