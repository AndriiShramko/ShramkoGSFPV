import { beforeAll, describe, expect, it } from 'vitest';
import { decodeBlackbox } from '../src/decode';
import { extractSignals } from '../src/signals';
import { fitLog, type FitReport } from '../src/fit';
import { synthLog, type SynthOptions } from './synth';
import type { SimParams } from '@gsfpv/sim-core';

// The simulator flies the H.4 script on the Pavo20 Pro preset and writes a real binary log (with
// sensor noise and one loop of rpm-telemetry delay); the fit must give back the numbers the
// simulator used. The controls change one physical term in the simulator and check that the fit
// follows it instead of returning the preset.

function fit(opt: SynthOptions, massG?: number): { r: FitReport; p: SimParams } {
    const { bytes, params, preset } = synthLog(opt);
    const log = decodeBlackbox(bytes)[0];
    expect(log.stats.corrupt).toBe(0);
    return { r: fitLog(extractSignals(log), { preset, massG }), p: params };
}
/** The proposed value, or the preset's own when the fit proposes no change (it equals the preset). */
function proposed(r: FitReport, name: string, preset: number): number {
    const f = r.preset!.fields.find((x) => x.field === name);
    return f ? (f.proposed as number) : preset;
}
const within = (x: number, target: number, rel: number) => expect(Math.abs(x / target - 1), `${x} vs ${target}`).toBeLessThan(rel);

describe('fit recovers the simulator from its own log (Pavo20 Pro preset)', () => {
    let r: FitReport;
    let p: SimParams;
    beforeAll(() => {
        ({ r, p } = fit({ attitudeDebug: true }, 151));
    });

    it('hover, TWR and the thrust curve', () => {
        const e = r.estimates;
        expect(e.hoverMotor.basis).toMatch(/still-hover/);
        within(e.twrHoverMatched.value, p.twr, 0.02);
        within(e.twrThrustFit.value, p.twr, 0.05);
        expect(e.hoverThrottle.value).toBeGreaterThan(20);
        expect(e.hoverThrottle.value).toBeLessThan(45);
    });

    it('motor lag, rotor inertia, yaw torque and roll/pitch inertia', () => {
        within(r.estimates.motorTau.value, p.tau * 1000, 0.1);
        within(r.estimates.rotorInertiaRatio.value * p.inertia[1], p.rotorInertia, 0.1);
        within(proposed(r, 'motor_kappa_m', p.kappa), p.kappa, 0.15);
        within(proposed(r, 'inertia_roll_pitch_kgm2', p.inertia[0]), p.inertia[0], 0.15);
    });

    it('duct drag from the coast-downs; our attitude agrees with the true one', () => {
        expect(r.estimates.ductDrag.basis).toMatch(/coast-down/);
        within(r.estimates.ductDrag.value, p.ductDrag, 0.1);
        expect(r.estimates.ductDrag.confidence).not.toBe('low');
        // the body drag is only weakly identified at these speeds: right order, not proposed
        within(r.estimates.quadDragPerM.value, (0.5 * p.rho * p.cda[0]) / p.mass, 0.8);
        expect(r.preset!.fields.find((f) => f.field === 'cda_horizontal_cm2')).toBeUndefined();
        const a = r.log.attitude;
        expect(typeof a).toBe('object');
        if (typeof a === 'object') {
            expect(a.fcDiffDeg.roll).toBeLessThan(1);
            expect(a.fcDiffDeg.pitch).toBeLessThan(1);
        }
    });

    it('rates, PIDs, throttle curve and idle come back from the header unchanged', () => {
        expect(r.rates!.setpointErrDegS!.every((x) => x < 1)).toBe(true);
        for (const f of ['rates', 'pid_roll', 'pid_pitch', 'pid_yaw', 'throttle', 'motor_idle']) {
            expect(r.preset!.fields.find((x) => x.field === f), f).toBeUndefined();
        }
        for (const f of r.preset!.fields) expect(f.source).toMatch(/^measured:(blackbox-2026-09-28|owner)$/);
    });
});

describe('controls: the fit follows the physics, not the preset', () => {
    it('rotor inertia 0 in the simulator: the fit finds about 0, not the preset 2e-7', () => {
        const { r, p } = fit({ attitudeDebug: true, overrides: { propInertia: 0 } });
        const ratio = r.estimates.rotorInertiaRatio?.value ?? 0;
        expect(Math.abs(ratio * p.inertia[1])).toBeLessThan(0.3e-7);
    });

    it('duct drag 0 in the simulator: the drag rate is reported as not distinguishable from 0', () => {
        const { r } = fit({ attitudeDebug: true, overrides: { ductDrag: 0 } });
        const k = r.estimates.ductDrag?.value;
        if (k !== undefined) expect(Math.abs(k)).toBeLessThan(0.1);
        else expect(r.notIdentified.some((n) => n.what === 'duct / rotor drag')).toBe(true);
    });

    it('motor tau 30 ms in the simulator: the fit says about 30', () => {
        const { r } = fit({ attitudeDebug: false, overrides: { tauMs: 30 } });
        within(r.estimates.motorTau.value, 30, 0.1);
        expect(r.log.attitude).toBe('estimated');
    });

    it('without rpm telemetry, what needs it is listed as not identifiable', () => {
        const { r, p } = fit({ attitudeDebug: true, noRpm: true });
        const missing = r.notIdentified.map((n) => n.what).join(' | ');
        expect(missing).toMatch(/motor lag tau/);
        expect(missing).toMatch(/rotor inertia/);
        expect(r.estimates.motorTau).toBeUndefined();
        // hover and drag do not need rpm
        within(r.estimates.twrHoverMatched.value, p.twr, 0.02);
        within(r.estimates.ductDrag.value, p.ductDrag, 0.15);
    });
});
