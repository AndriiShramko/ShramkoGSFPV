// Small numeric helpers for the fit: zero-phase low-pass, derivatives, least squares, robust stats.

/** Second-order Butterworth low-pass run forward then backward (no phase lag), cutoff fc at rate fs. */
export function lowpass(x: ArrayLike<number>, fs: number, fc: number): Float64Array {
    const n = x.length;
    const out = Float64Array.from(x);
    if (n < 3 || fc <= 0 || fc >= fs / 2) return out;
    const k = Math.tan((Math.PI * fc) / fs);
    const q = Math.SQRT1_2;
    const norm = 1 / (1 + k / q + k * k);
    const b0 = k * k * norm, b1 = 2 * b0, b2 = b0;
    const a1 = 2 * (k * k - 1) * norm, a2 = (1 - k / q + k * k) * norm;
    const pass = (v: Float64Array, from: number, to: number, step: number) => {
        // start from rest at the first value so the filter does not ring at the edge
        let x1 = v[from], x2 = v[from], y1 = v[from], y2 = v[from];
        for (let i = from; i !== to; i += step) {
            const xi = v[i];
            const yi = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
            x2 = x1; x1 = xi; y2 = y1; y1 = yi;
            v[i] = yi;
        }
    };
    pass(out, 0, n, 1);
    pass(out, n - 1, -1, -1);
    return out;
}

/** Central-difference derivative (one-sided at the ends). */
export function derivative(x: ArrayLike<number>, t: ArrayLike<number>): Float64Array {
    const n = x.length;
    const d = new Float64Array(n);
    for (let i = 0; i < n; i++) {
        const a = i > 0 ? i - 1 : i;
        const b = i < n - 1 ? i + 1 : i;
        const dt = t[b] - t[a];
        d[i] = dt > 0 ? (x[b] - x[a]) / dt : 0;
    }
    return d;
}

export interface OlsResult {
    beta: number[];
    /** standard errors from the residual variance (assumes independent samples: optimistic at kHz rates) */
    se: number[];
    r2: number;
    rmse: number;
    n: number;
}

/** Ordinary least squares y = X beta over the rows given by `rows(k)`; k runs over `idx`. */
export function ols(idx: ArrayLike<number>, p: number, rows: (k: number, out: number[]) => number): OlsResult | null {
    const xtx = new Float64Array(p * p);
    const xty = new Float64Array(p);
    const r = new Array<number>(p).fill(0);
    let n = 0, sy = 0, syy = 0;
    for (let j = 0; j < idx.length; j++) {
        const y = rows(idx[j], r);
        if (!Number.isFinite(y) || r.some((v) => !Number.isFinite(v))) continue;
        n++;
        sy += y;
        syy += y * y;
        for (let a = 0; a < p; a++) {
            xty[a] += r[a] * y;
            for (let b = a; b < p; b++) xtx[a * p + b] += r[a] * r[b];
        }
    }
    if (n <= p) return null;
    for (let a = 0; a < p; a++) for (let b = 0; b < a; b++) xtx[a * p + b] = xtx[b * p + a];
    const inv = invert(xtx, p);
    if (!inv) return null;
    const beta = new Array<number>(p).fill(0);
    for (let a = 0; a < p; a++) for (let b = 0; b < p; b++) beta[a] += inv[a * p + b] * xty[b];
    // residual sum of squares = y'y - 2 b'X'y + b'X'X b
    let bxty = 0, bxtxb = 0;
    for (let a = 0; a < p; a++) {
        bxty += beta[a] * xty[a];
        for (let b = 0; b < p; b++) bxtxb += beta[a] * xtx[a * p + b] * beta[b];
    }
    const rss = Math.max(0, syy - 2 * bxty + bxtxb);
    const tss = syy - (sy * sy) / n;
    const s2 = rss / (n - p);
    return {
        beta,
        se: beta.map((_, a) => Math.sqrt(Math.max(0, s2 * inv[a * p + a]))),
        r2: tss > 0 ? 1 - rss / tss : 0,
        rmse: Math.sqrt(rss / n),
        n
    };
}

function invert(m: Float64Array, p: number): Float64Array | null {
    const a = Float64Array.from(m);
    const inv = new Float64Array(p * p);
    for (let i = 0; i < p; i++) inv[i * p + i] = 1;
    for (let c = 0; c < p; c++) {
        let piv = c;
        for (let r = c + 1; r < p; r++) if (Math.abs(a[r * p + c]) > Math.abs(a[piv * p + c])) piv = r;
        const pv = a[piv * p + c];
        if (Math.abs(pv) < 1e-300) return null;
        if (piv !== c) {
            for (let k = 0; k < p; k++) {
                [a[c * p + k], a[piv * p + k]] = [a[piv * p + k], a[c * p + k]];
                [inv[c * p + k], inv[piv * p + k]] = [inv[piv * p + k], inv[c * p + k]];
            }
        }
        const d = 1 / a[c * p + c];
        for (let k = 0; k < p; k++) {
            a[c * p + k] *= d;
            inv[c * p + k] *= d;
        }
        for (let r = 0; r < p; r++) {
            if (r === c) continue;
            const f = a[r * p + c];
            if (f === 0) continue;
            for (let k = 0; k < p; k++) {
                a[r * p + k] -= f * a[c * p + k];
                inv[r * p + k] -= f * inv[c * p + k];
            }
        }
    }
    return inv;
}

export function median(v: ArrayLike<number>): number {
    const a = Array.from(v).filter(Number.isFinite).sort((x, y) => x - y);
    if (!a.length) return NaN;
    const h = a.length >> 1;
    return a.length % 2 ? a[h] : 0.5 * (a[h - 1] + a[h]);
}

export function percentile(v: ArrayLike<number>, q: number): number {
    const a = Array.from(v).filter(Number.isFinite).sort((x, y) => x - y);
    if (!a.length) return NaN;
    const i = Math.min(a.length - 1, Math.max(0, Math.round(q * (a.length - 1))));
    return a[i];
}

/**
 * Robust spread of per-block estimates: 1.4826 x median absolute deviation, divided by sqrt(K)
 * to give a standard error of the median-of-blocks estimate. Blocks are contiguous in time, so the
 * autocorrelation of kHz samples does not make it optimistic the way OLS standard errors are.
 */
export function blockStats(values: number[]): { value: number; se: number; k: number } {
    const v = values.filter(Number.isFinite);
    const m = median(v);
    const mad = median(v.map((x) => Math.abs(x - m)));
    return { value: m, se: v.length > 1 ? (1.4826 * mad) / Math.sqrt(v.length) : Infinity, k: v.length };
}

/** Split sorted sample indices into K groups of contiguous time. */
export function blocks(idx: number[], k: number): number[][] {
    const out: number[][] = [];
    const size = Math.ceil(idx.length / k);
    for (let i = 0; i < idx.length; i += size) out.push(idx.slice(i, i + size));
    return out;
}
