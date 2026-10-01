// Plain-text rendering of a fit report.

import type { FitReport } from './fit';

const fmt = (x: number, unit: string): string => {
    if (!Number.isFinite(x)) return 'n/a';
    const a = Math.abs(x);
    const s = a !== 0 && (a < 1e-3 || a >= 1e5) ? x.toExponential(3) : Number(x.toPrecision(4)).toString();
    return unit ? `${s} ${unit}` : s;
};

export function renderReport(r: FitReport, title: string): string {
    const out: string[] = [];
    const l = r.log;
    out.push(`== ${title}`);
    out.push(`firmware: ${l.firmware}${l.craft ? ` | craft: ${l.craft}` : ''}${l.date ? ` | ${l.date}` : ''}`);
    out.push(`duration ${l.durationS.toFixed(1)} s, flying ${l.flyingS.toFixed(1)} s, ${l.sampleHz} Hz | rpm: ${l.hasRpm ? 'yes' : 'NO'} | accelerometer: ${l.hasAcc ? 'yes' : 'NO'} | GPS: ${l.hasGps ? 'yes' : 'no'} | attitude: ${typeof l.attitude === 'string' ? l.attitude : `estimated (RMS vs the flight controller's: roll ${l.attitude.fcDiffDeg.roll.toFixed(1)}, pitch ${l.attitude.fcDiffDeg.pitch.toFixed(1)} deg)`}`);
    out.push('');
    out.push('Identified:');
    const names = Object.keys(r.estimates);
    if (!names.length) out.push('  (nothing)');
    for (const k of names) {
        const e = r.estimates[k];
        const se = Number.isFinite(e.se) ? ` +- ${fmt(e.se, '')}` : '';
        out.push(`  ${k.padEnd(22)} ${fmt(e.value, e.unit).padEnd(16)}${se.padEnd(14)} [${e.confidence}] ${e.basis}`);
    }
    if (r.rates) {
        const m = r.rates.maxDegS;
        out.push(`  ${'rates'.padEnd(22)} ${r.rates.config.type} max ${m.roll.toFixed(0)}/${m.pitch.toFixed(0)}/${m.yaw.toFixed(0)} deg/s${r.rates.setpointErrDegS ? `; setpoint check ${r.rates.setpointErrDegS.map((x) => x.toFixed(1)).join('/')} deg/s` : ''}${r.rates.stickP995 ? `; stick used up to ${r.rates.stickP995.map((x) => (x * 100).toFixed(0)).join('/')} %` : ''}`);
    }
    out.push('');
    out.push('Not identifiable from this log:');
    if (!r.notIdentified.length) out.push('  (none)');
    for (const n of r.notIdentified) out.push(`  - ${n.what}: ${n.why}`);
    if (r.preset) {
        out.push('');
        out.push(`Proposed changes to preset ${r.preset.id} (source tag, confidence):`);
        if (!r.preset.fields.length) out.push('  (none)');
        for (const f of r.preset.fields) {
            out.push(`  ${f.field.padEnd(26)} ${JSON.stringify(f.now)} -> ${JSON.stringify(f.proposed)}  [${f.confidence}] ${f.source}`);
            out.push(`  ${''.padEnd(26)} ${f.note}`);
        }
    }
    return out.join('\n');
}
