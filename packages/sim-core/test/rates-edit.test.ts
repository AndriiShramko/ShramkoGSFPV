// The rates editor's model (rates-edit.ts): fields and bounds per type, typed text to CLI integers,
// "copy as CLI" read back by the diff import, and the type switch that keeps the curve. Each check
// has a control that must fail: a parser that takes "12abc", a CLI line changed by hand, a type switch
// that keeps the numbers.
import { describe, expect, it } from 'vitest';
import {
    RATE_AXES, RATE_BOUNDS, RATE_FIELDS, RATES_TYPES, axisRate, copyRates, curveSamples, fieldsInBounds, fitCost, fitRates, fullStickRates,
    parseBetaflightDiff, rateField, ratesCli, readField, readRateLimit, setpointRate, shownText, withField
} from '../src/index';
import type { RatesConfig, RatesType } from '../src/index';

const VERSION_45 = '# Betaflight / STM32F405 (S405) 4.5.1 Mar 19 2025 / 10:06:16 (77d01ba3b) MSP API: 1.46';
/** CLI lines as a minimal `diff` the import reads (one profile, one rate profile). */
const asDiff = (cli: string) => `# version\n${VERSION_45}\n\nprofile 0\n\nrateprofile 0\n${cli}\n`;
const same = (r: number, s: number, e: number) => ({ rcRate: r, rate: s, expo: e });
const cfg = (type: RatesType, a: [number, number, number], b = a, c = a, rateLimit = 1998, quickRcExpo?: boolean): RatesConfig => {
    const out: RatesConfig = { type, roll: same(...a), pitch: same(...b), yaw: same(...c), rateLimit };
    if (quickRcExpo !== undefined) out.quickRcExpo = quickRcExpo;
    return out;
};
const ACTUAL_DEFAULT = cfg('ACTUAL', [7, 67, 0]);

/** Largest |a - b| over the stick 0..1 (41 points) of one axis. */
function gap(a: RatesConfig, b: RatesConfig, axis: 'roll' | 'pitch' | 'yaw'): number {
    let w = 0;
    for (let i = 0; i <= 40; i++) w = Math.max(w, Math.abs(axisRate(a, axis, i / 40) - axisRate(b, axis, i / 40)));
    return w;
}

describe('fields per type', () => {
    it('each type has its Configurator names; the maxima are Betaflight\'s limits', () => {
        const names = Object.fromEntries(RATES_TYPES.map((t) => [t, RATE_FIELDS[t].map((x) => x.name).join('/')]));
        expect(names).toEqual({
            BETAFLIGHT: 'rcRate/superRate/expo', RACEFLIGHT: 'rate/acroPlus/expo', KISS: 'rcRate/rate/rcCurve',
            ACTUAL: 'centerSensitivity/maxRate/expo', QUICK: 'rcRate/maxRate/expo'
        });
        for (const t of RATES_TYPES) for (const fd of RATE_FIELDS[t]) {
            expect(fd.max, `${t} ${fd.key}`).toBe(RATE_BOUNDS[t][fd.key]);
            expect(fd.min).toBeGreaterThanOrEqual(fd.key === 'rcRate' ? 1 : 0);
        }
    });

    it('shown values: Actual 7 / 67 is 70 and 670 deg/s, Betaflight 100 is 1.00, Raceflight expo is a plain number', () => {
        expect(shownText(rateField('ACTUAL', 'rcRate'), 7)).toBe('70');
        expect(shownText(rateField('ACTUAL', 'rate'), 67)).toBe('670');
        expect(rateField('ACTUAL', 'rate').unit).toBe('degs');
        expect(shownText(rateField('BETAFLIGHT', 'rcRate'), 100)).toBe('1.00');
        expect(shownText(rateField('QUICK', 'rate'), 67)).toBe('670');
        expect(shownText(rateField('RACEFLIGHT', 'expo'), 50)).toBe('50');
    });
});

describe('typed text', () => {
    it('reads commas and dots, moves values onto the step and into the bounds, and says so', () => {
        expect(readField(rateField('BETAFLIGHT', 'rcRate'), '1,25')).toEqual({ ok: true, stored: 125, adjusted: false });
        expect(readField(rateField('ACTUAL', 'rate'), '675')).toEqual({ ok: true, stored: 68, adjusted: true }); // 10 deg/s steps
        expect(readField(rateField('ACTUAL', 'rate'), '5000')).toEqual({ ok: true, stored: 200, adjusted: true });
        expect(readField(rateField('KISS', 'rate'), '1')).toEqual({ ok: true, stored: 99, adjusted: true }); // KISS rate <= 0.99
        expect(readField(rateField('QUICK', 'rcRate'), '0')).toEqual({ ok: true, stored: 1, adjusted: true }); // RC Rate >= 0.01
        expect(readRateLimit('1500')).toEqual({ ok: true, stored: 1500, adjusted: false });
        expect(readRateLimit('99')).toEqual({ ok: true, stored: 200, adjusted: true });
    });

    it('refuses text that is not a number; control: parseFloat would have taken "12abc"', () => {
        for (const bad of ['', 'abc', '12abc', '1e3', '--1', '1.2.3', 'NaN', 'Infinity']) expect(readField(rateField('ACTUAL', 'rate'), bad), bad).toEqual({ ok: false });
        expect(readRateLimit('fast')).toEqual({ ok: false });
        expect(Number.parseFloat('12abc')).toBe(12);
    });

    it('withField changes one integer of a copy; fieldsInBounds says when a stored config is outside the editor', () => {
        const c = withField(ACTUAL_DEFAULT, 'pitch', 'rate', 80);
        expect(c.pitch.rate).toBe(80);
        expect(ACTUAL_DEFAULT.pitch.rate).toBe(67);
        expect(c.roll).toEqual(ACTUAL_DEFAULT.roll);
        expect(fieldsInBounds(c)).toBe(true);
        expect(fieldsInBounds(withField(c, 'yaw', 'rcRate', 0))).toBe(false);
        expect(fieldsInBounds({ ...c, rateLimit: 100 })).toBe(false);
    });

    it('full-stick rates and curve samples follow the flight\'s own setpoint', () => {
        expect(fullStickRates(ACTUAL_DEFAULT)).toEqual({ roll: 670, pitch: 670, yaw: 670 });
        const q = cfg('QUICK', [100, 67, 30], [100, 67, 30], [100, 67, 30], 1998, true);
        const s = curveSamples(q, 'roll', 11);
        expect(s).toHaveLength(11);
        expect(s[5]).toBe(setpointRate('QUICK', 0.5, q.roll, 1998, true));
        expect(s[10]).toBeCloseTo(670, 9);
    });
});

describe('copy as CLI', () => {
    const configs: RatesConfig[] = [
        cfg('BETAFLIGHT', [100, 70, 20], [110, 72, 25], [90, 60, 0], 1800),
        cfg('RACEFLIGHT', [37, 80, 50]),
        cfg('KISS', [100, 70, 10], [100, 70, 10], [120, 50, 0]),
        ACTUAL_DEFAULT,
        cfg('QUICK', [100, 67, 30], [100, 67, 30], [90, 60, 0], 1998, true),
        cfg('QUICK', [150, 90, 0], [150, 90, 0], [150, 90, 0], 1998, false)
    ];
    it('every type reads back to the same config through the Betaflight diff import', () => {
        for (const c of configs) {
            const text = ratesCli(c);
            expect(text).toContain(`set rates_type = ${c.type}`);
            const r = parseBetaflightDiff(asDiff(text));
            expect(r.errors, text).toEqual([]);
            expect(r.rates, text).toEqual(copyRates(c));
        }
    });

    it('control: one line changed by hand reads back to another config', () => {
        const text = ratesCli(configs[0]).replace('set pitch_srate = 72', 'set pitch_srate = 27');
        expect(parseBetaflightDiff(asDiff(text)).rates).not.toEqual(configs[0]);
    });
});

describe('switching type keeps the curve', () => {
    it('the same type comes back unchanged', () => {
        expect(fitRates(ACTUAL_DEFAULT, 'ACTUAL')).toEqual({ config: ACTUAL_DEFAULT, worst: { roll: 0, pitch: 0, yaw: 0 } });
    });

    it('Actual 70 / 670 into every type: full stick within 10 deg/s, the whole curve within 40 deg/s; control: keeping the numbers misses by hundreds', () => {
        for (const t of RATES_TYPES.filter((x) => x !== 'ACTUAL')) {
            const fit = fitRates(ACTUAL_DEFAULT, t);
            expect(fit.config.type).toBe(t);
            expect(fieldsInBounds(fit.config), t).toBe(true);
            expect(Math.abs(fullStickRates(fit.config).roll - 670), t).toBeLessThanOrEqual(10);
            expect(fit.worst.roll, t).toBe(gap(fit.config, ACTUAL_DEFAULT, 'roll'));
            expect(fit.worst.roll, t).toBeLessThan(40);
            // a naive switch: the same integers under the new type
            const naive: RatesConfig = { ...copyRates(ACTUAL_DEFAULT), type: t };
            expect(gap(naive, ACTUAL_DEFAULT, 'roll'), t).toBeGreaterThan(100);
        }
    });

    it('Betaflight into Quick is almost exact (Quick is Betaflight\'s super-rate curve with a max-rate knob)', () => {
        const bf = cfg('BETAFLIGHT', [100, 70, 0]);
        const fit = fitRates(bf, 'QUICK');
        // 2 x 100 = 200 deg/s at the centre, as Betaflight's 200 x 1.00; the max rate's 10 deg/s steps move it by one
        expect(Math.abs(fit.config.roll.rcRate - 100)).toBeLessThanOrEqual(1);
        expect(fit.worst.roll).toBeLessThan(5);
    });

    it('per axis, and back again close to where it started', () => {
        const bf = cfg('BETAFLIGHT', [100, 70, 20], [120, 75, 10], [90, 50, 0], 1998);
        const there = fitRates(bf, 'ACTUAL').config;
        expect(there.roll).not.toEqual(there.yaw);
        const back = fitRates(there, 'BETAFLIGHT');
        for (const ax of RATE_AXES) expect(gap(back.config, bf, ax), ax).toBeLessThan(25);
    });

    it('the search is within 1 % of an exhaustive search over every rc rate and rate near its expo', () => {
        // An exhaustive search of every triple (run once outside the suite, 16 s for 4 cases) found the same
        // optimum in 3 cases and one 0.2 % lower (Quick -> Raceflight, a valley of slope 8:1).
        const cases: [RatesConfig, RatesType][] = [[ACTUAL_DEFAULT, 'BETAFLIGHT'], [cfg('KISS', [120, 60, 30]), 'QUICK'], [cfg('QUICK', [100, 67, 30]), 'RACEFLIGHT']];
        for (const [from, to] of cases) {
            const target: number[] = [];
            for (let i = 0; i <= 40; i++) target.push(axisRate(from, 'roll', i / 40));
            const fit = fitRates(from, to).config.roll;
            const got = fitCost(target, to, fit, 1998);
            const [fr, fs, fe] = RATE_FIELDS[to];
            let best = Infinity;
            for (let e = Math.max(fe.min, fit.expo - 2); e <= Math.min(fe.max, fit.expo + 2); e++) {
                for (let r = fr.min; r <= fr.max; r++) for (let s = fs.min; s <= fs.max; s++) best = Math.min(best, fitCost(target, to, { rcRate: r, rate: s, expo: e }, 1998));
            }
            expect(got, `${from.type} -> ${to}`).toBeLessThanOrEqual(best * 1.01);
            // control: the objective tells a poor fit apart (the lowest corner of the grid at the same expo)
            expect(fitCost(target, to, { rcRate: fr.min, rate: fs.min, expo: fit.expo }, 1998)).toBeGreaterThan(best * 10);
        }
    });

    it('is deterministic and keeps the rate limit; Quick\'s stick expo survives Quick -> Quick only', () => {
        const q = cfg('QUICK', [100, 67, 30], [100, 67, 30], [100, 67, 30], 1500, true);
        expect(fitRates(q, 'KISS')).toEqual(fitRates(q, 'KISS'));
        expect(fitRates(q, 'KISS').config.rateLimit).toBe(1500);
        expect(fitRates(ACTUAL_DEFAULT, 'QUICK').config.quickRcExpo).toBe(false);
        expect(fitRates(q, 'QUICK').config.quickRcExpo).toBe(true);
    });
});
