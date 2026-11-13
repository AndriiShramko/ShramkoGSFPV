// A seeded random source for the course generator (mulberry32: integer arithmetic only, so every JavaScript engine gives
// the same sequence; the package's own copy of packages/sonic-fpv/src/util/rng.ts). The generator draws its numbers in one
// fixed order; changing that order changes the courses and needs a new generator version.

export interface Rng {
    /** uniform in [0, 1) */
    next(): number;
    /** uniform integer in [lo, hi] */
    int(lo: number, hi: number): number;
}

export function createRng(seed: number): Rng {
    let a = Math.trunc(seed) >>> 0;
    const next = (): number => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return { next, int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)) };
}
