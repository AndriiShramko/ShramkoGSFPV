import { describe, expect, it } from 'vitest';
import { MODE_CHANNEL, modeFromChannel } from '../src/index';
import type { FlightMode } from '../src/index';

const MODES: FlightMode[] = ['acro', 'angle', 'horizon'];

/** Every mode the page writes reads back as itself, also with switch noise up to 0.49. */
function roundTrips(read: (v: number) => FlightMode): string[] {
    const bad: string[] = [];
    for (const m of MODES) for (const d of [0, 0.2, -0.2, 0.49, -0.49]) {
        const v = MODE_CHANNEL[m] + d;
        if (Math.abs(v) > 1) continue; // channels live in [-1, 1]
        if (read(v) !== m) bad.push(`${m}${d >= 0 ? '+' : ''}${d} -> ${read(v)}`);
    }
    return bad;
}

describe('flight-mode channel contract (B.1)', () => {
    it('modeFromChannel(MODE_CHANNEL[m]) is m for every mode, with noise below half a step', () => {
        expect(roundTrips(modeFromChannel)).toEqual([]);
    });

    it('the three channel values are distinct and inside [-1, 1]', () => {
        const vals = MODES.map((m) => MODE_CHANNEL[m]);
        expect(new Set(vals).size).toBe(3);
        for (const v of vals) expect(Math.abs(v)).toBeLessThanOrEqual(1);
    });

    it('acro keeps v0.2\'s "not angle" value, so v0.2 keyboard and radio frames read the same', () => {
        // v0.2 writers: devices/keyboard.ts and calib.ts mapFrame send angle ? 1 : -1
        expect(modeFromChannel(-1)).toBe('acro');
        expect(modeFromChannel(1)).toBe('angle');
    });

    it('negative control: v0.2\'s two-way rule (angle if > 0.5, else acro) fails the round trip', () => {
        const v02 = (v: number): FlightMode => (v > 0.5 ? 'angle' : 'acro');
        expect(roundTrips(v02).length).toBeGreaterThan(0);
        expect(roundTrips(v02).every((s) => s.startsWith('horizon'))).toBe(true);
    });
});
