// Lane tracks2, stage K1.2: the size of every drone of the simulator, measured from its preset by the simulator's own
// compileParams (boundRadius: body origin to the farthest collider sphere surface). The smallest is the smallest gate
// the course generator may lay.
//
//   cd tools/bench && npx tsx src/drone-sizes.ts
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { compileParams } from '@gsfpv/sim-core';

const dir = join(import.meta.dirname, '../../../packages/sim-core/presets');
const rows: { id: string; wheelbaseMm: number; boundRadiusM: number }[] = [];
for (const f of readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
    const p = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    const sp = compileParams(p);
    const wb = p.fields?.wheelbase_mm?.value ?? null;
    rows.push({ id: f.replace(/\.json$/, ''), wheelbaseMm: wb, boundRadiusM: Math.round(sp.boundRadius * 1e4) / 1e4 });
}
rows.sort((a, b) => a.boundRadiusM - b.boundRadiusM);
for (const r of rows) console.log(JSON.stringify(r));
