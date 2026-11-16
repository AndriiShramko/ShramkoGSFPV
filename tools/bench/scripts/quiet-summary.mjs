// Lane quiet: one summary line set per quiet-probe.mjs output. Usage: node tools/bench/scripts/quiet-summary.mjs <out.json>...
import { readFileSync } from 'node:fs';

for (const f of process.argv.slice(2)) {
    const o = JSON.parse(readFileSync(f, 'utf8'));
    const S = o.samples || [];
    const phases = [];
    for (const s of S) if (phases.length === 0 || phases[phases.length - 1].phase !== s.phase) phases.push({ t: s.t, phase: s.phase });
    const firstMove = (tag) => { const a = S.filter((s) => s.tag === tag); const m = a.find((s) => s.speed > 0.5 || Math.abs(s.vy ?? 0) > 0.5); return m ? m.t : null; };
    let jumps = 0;
    for (let i = 1; i < S.length; i++) {
        const a = S[i - 1].pos, b = S[i].pos;
        if (a && b && S[i].t - S[i - 1].t < 0.5 && Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) > 2) jumps++;
    }
    const qBusy = S.filter((s) => (s.q ?? 0) > 0);
    const speech = (o.events || []).filter((e) => e.kind === 'speech' && e.key !== 'speech.end');
    console.log(`${f}: reader ${o.reader} narrator ${o.narrator} errors ${o.errors.length} fail ${o.fail ?? '-'}`);
    console.log(`  phases ${phases.map((p) => `${p.t}:${p.phase}`).join(' ')}`);
    console.log(`  first move w ${firstMove('w')} w2 ${firstMove('w2')} jumps ${jumps} queue busy samples ${qBusy.length} (from ${qBusy[0]?.t ?? '-'} to ${qBusy[qBusy.length - 1]?.t ?? '-'})`);
    console.log(`  shiftG at ${o.shiftG} course ready +${o.courseReady} first hum +${o.firstHum} target ${o.humTarget}`);
    console.log(`  spoken ${speech.length}: ${speech.map((e) => `${(e.t / 1000).toFixed(1)} ${e.key}`).join(' | ')}`);
}
