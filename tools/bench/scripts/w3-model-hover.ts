// w3-model S2: the full-pack hover stick and motor command of the Air65 presets (the note's calibration point:
// Air65 Freestyle hovers at 35 % throttle on a full 300 mAh pack, Oscar Liang; the maker's motor table gives about 32 %).
// Run: npx tsx tools/bench/scripts/w3-model-hover.ts
import { hoverSolve } from '@gsfpv/sim-core';
import { params } from '../src/presets';

for (const id of ['air65-1s', 'air65champ-1s', 'air65iichamp-1s', 'meteor65pro-1s', 'pavo20pro-3s']) {
    const p = params(id);
    const h = hoverSolve(p, 1);
    console.log(id, JSON.stringify({ twr: p.twr, massG: Math.round(p.mass * 10000) / 10, stickPct: Math.round(h.stick * 1000) / 10, motorPct: Math.round(h.throttle * 1000) / 10 }));
}
