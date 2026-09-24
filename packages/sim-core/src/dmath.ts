// Deterministic elementary functions for the simulation core.
//
// JavaScript engines may implement Math.sin/cos/atan2/exp differently (V8, SpiderMonkey and
// JavaScriptCore do not promise identical last-bit results). The simulation must produce the
// same bits in Node and in every browser, so it only uses + - * / and Math.sqrt (IEEE-754
// correctly rounded) and the functions below, which are ports of the public-domain fdlibm /
// musl algorithms built from those operations only.

const TOINT = 1.5 / 2.220446049250313e-16; // 1.5 * 2^52, round-to-nearest-integer trick

const INVPIO2 = 6.36619772367581382433e-1;
const PIO2_1 = 1.57079632673412561417e0;
const PIO2_1T = 6.07710050650619224932e-11;
const PIO2_2 = 6.07710050630396597660e-11;
const PIO2_2T = 2.02226624879595063154e-21;
const PIO2_3 = 2.02226624871116645580e-21;
const PIO2_3T = 8.47842766036889956997e-32;
const PIO4 = 0.78539816339744827900;

const S1 = -1.66666666666666324348e-1;
const S2 = 8.33333333332248946124e-3;
const S3 = -1.98412698298579493134e-4;
const S4 = 2.75573137070700676789e-6;
const S5 = -2.50507602534068634195e-8;
const S6 = 1.58969099521155010221e-10;

const C1 = 4.16666666666666019037e-2;
const C2 = -1.38888888888741095749e-3;
const C3 = 2.48015872894767294178e-5;
const C4 = -2.75573143513906633035e-7;
const C5 = 2.08757232129817482790e-9;
const C6 = -1.13596475577881948265e-11;

/** Largest |x| the three-part Cody-Waite reduction handles exactly enough (2^19 * pi/2). */
const REDUCE_LIMIT = 823549.6;

function kSin(x: number, y: number, iy: number): number {
    const z = x * x;
    const w = z * z;
    const r = S2 + z * (S3 + z * S4) + z * w * (S5 + z * S6);
    const v = z * x;
    if (iy === 0) return x + v * (S1 + z * r);
    return x - ((z * (0.5 * y - v * r) - y) - v * S1);
}

function kCos(x: number, y: number): number {
    const z = x * x;
    const w = z * z;
    const r = z * (C1 + z * (C2 + z * C3)) + w * w * (C4 + z * (C5 + z * C6));
    const hz = 0.5 * z;
    const ww = 1.0 - hz;
    return ww + (((1.0 - ww) - hz) + (z * r - x * y));
}

// out[0] = y0, out[1] = y1, returns quadrant n
const red = [0, 0];
function remPio2(x: number): number {
    if (!(x >= -REDUCE_LIMIT && x <= REDUCE_LIMIT)) {
        throw new RangeError(`dmath: argument ${x} outside deterministic range`);
    }
    const fn = x * INVPIO2 + TOINT - TOINT;
    let r = x - fn * PIO2_1;
    let w = fn * PIO2_1T;
    let t = r;
    w = fn * PIO2_2;
    r = t - w;
    w = fn * PIO2_2T - ((t - r) - w);
    t = r;
    w = fn * PIO2_3;
    r = t - w;
    w = fn * PIO2_3T - ((t - r) - w);
    const y0 = r - w;
    red[0] = y0;
    red[1] = (r - y0) - w;
    return fn;
}

export function dsin(x: number): number {
    if (x !== x) return NaN;
    if (x >= -PIO4 && x <= PIO4) {
        if (x > -7.450580596923828e-9 && x < 7.450580596923828e-9) return x;
        return kSin(x, 0, 0);
    }
    const n = remPio2(x);
    const q = ((n % 4) + 4) % 4;
    switch (q) {
        case 0: return kSin(red[0], red[1], 1);
        case 1: return kCos(red[0], red[1]);
        case 2: return -kSin(red[0], red[1], 1);
        default: return -kCos(red[0], red[1]);
    }
}

export function dcos(x: number): number {
    if (x !== x) return NaN;
    if (x >= -PIO4 && x <= PIO4) {
        if (x > -7.450580596923828e-9 && x < 7.450580596923828e-9) return 1.0;
        return kCos(x, 0);
    }
    const n = remPio2(x);
    const q = ((n % 4) + 4) % 4;
    switch (q) {
        case 0: return kCos(red[0], red[1]);
        case 1: return -kSin(red[0], red[1], 1);
        case 2: return -kCos(red[0], red[1]);
        default: return kSin(red[0], red[1], 1);
    }
}

const ATANHI = [4.63647609000806093515e-1, 7.85398163397448278999e-1, 9.82793723247329054082e-1, 1.57079632679489655800e0];
const ATANLO = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17];
const AT = [
    3.33333333333329318027e-1, -1.99999999998764832476e-1, 1.42857142725034663711e-1,
    -1.11111104054623557880e-1, 9.09088713343650656196e-2, -7.69187620504482999495e-2,
    6.66107313738753120669e-2, -5.83357013379057348645e-2, 4.97687799461593236017e-2,
    -3.65315727442169155270e-2, 1.62858201153657823623e-2
];

export function datan(xin: number): number {
    if (xin !== xin) return NaN;
    const neg = xin < 0;
    let x = neg ? -xin : xin;
    if (x >= 7.378697629483821e19) { // 2^66
        const z = ATANHI[3] + ATANLO[3];
        return neg ? -z : z;
    }
    let id: number;
    if (x < 0.4375) {
        if (x < 3.725290298461914e-9) return xin; // 2^-28
        id = -1;
    } else if (x < 1.1875) {
        if (x < 0.6875) { id = 0; x = (2.0 * x - 1.0) / (2.0 + x); } else { id = 1; x = (x - 1.0) / (x + 1.0); }
    } else if (x < 2.4375) {
        id = 2; x = (x - 1.5) / (1.0 + 1.5 * x);
    } else {
        id = 3; x = -1.0 / x;
    }
    const z = x * x;
    const w = z * z;
    const s1 = z * (AT[0] + w * (AT[2] + w * (AT[4] + w * (AT[6] + w * (AT[8] + w * AT[10])))));
    const s2 = w * (AT[1] + w * (AT[3] + w * (AT[5] + w * (AT[7] + w * AT[9]))));
    if (id < 0) {
        const r = x - x * (s1 + s2);
        return neg ? -r : r;
    }
    const r = ATANHI[id] - ((x * (s1 + s2) - ATANLO[id]) - x);
    return neg ? -r : r;
}

const PI = 3.1415926535897931160e0;
const PI_LO = 1.2246467991473531772e-16;
const PI_O_2 = 1.5707963267948965580e0;

export function datan2(y: number, x: number): number {
    if (x !== x || y !== y) return NaN;
    if (x === 1.0) return datan(y);
    if (y === 0) {
        // atan2(±0, +x) = ±0 ; atan2(±0, -x) = ±pi
        if (x > 0 || (x === 0 && 1 / x > 0)) return y;
        return (1 / y > 0) ? PI : -PI;
    }
    if (x === 0) return y > 0 ? PI_O_2 : -PI_O_2;
    const ay = y < 0 ? -y : y;
    const ax = x < 0 ? -x : x;
    let z: number;
    const q = ay / ax;
    if (q > 1.152921504606847e18) { // 2^60
        z = PI_O_2 + 0.5 * PI_LO;
    } else if (x < 0 && q < 8.673617379884035e-19) { // 2^-60
        z = 0.0;
    } else {
        z = datan(q);
    }
    if (x > 0) return y < 0 ? -z : z;
    return y < 0 ? (z - PI_LO) - PI : PI - (z - PI_LO);
}

const LN2HI = 6.93147180369123816490e-1;
const LN2LO = 1.90821492927058770002e-10;
const INVLN2 = 1.44269504088896338700e0;
const P1 = 1.66666666666666019037e-1;
const P2 = -2.77777777770155933842e-3;
const P3 = 6.61375632143793436117e-5;
const P4 = -1.65339022054652515390e-6;
const P5 = 4.13813679705723846039e-8;

const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);
const HI = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1 ? 1 : 0; // little-endian: high word is [1]

/** Exact 2^k for integer k in [-1022, 1023]. */
function pow2(k: number): number {
    u32[HI] = ((k + 1023) << 20) >>> 0;
    u32[1 - HI] = 0;
    return f64[0];
}

export function dexp(xin: number): number {
    if (xin !== xin) return NaN;
    if (xin > 709.782712893384) return Infinity;
    if (xin < -745.1332191019411) return 0;
    let x = xin;
    let hi = 0;
    let lo = 0;
    let k = 0;
    const ax = x < 0 ? -x : x;
    if (ax > 0.34657359027997264) { // 0.5 ln2
        if (ax < 1.0397207708399179) { // 1.5 ln2
            k = x < 0 ? -1 : 1;
        } else {
            k = (INVLN2 * x + TOINT) - TOINT;
        }
        hi = x - k * LN2HI;
        lo = k * LN2LO;
        x = hi - lo;
    } else if (ax < 3.725290298461914e-9) {
        return 1.0 + x;
    }
    const t = x * x;
    const c = x - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
    if (k === 0) return 1.0 - ((x * c) / (c - 2.0) - x);
    const y = 1.0 - ((lo - (x * c) / (2.0 - c)) - hi);
    if (k >= -1021 && k <= 1023) return y * pow2(k);
    // denormal / overflow edge: split the scaling
    return k > 0 ? y * pow2(1023) * pow2(k - 1023) : y * pow2(-1000) * pow2(k + 1000);
}

/** Round-half-away-from-zero clamp helper, deterministic. */
export function clamp(v: number, lo: number, hi: number): number {
    return v < lo ? lo : v > hi ? hi : v;
}

export const DEG2RAD = 0.017453292519943295;
export const RAD2DEG = 57.29577951308232;
