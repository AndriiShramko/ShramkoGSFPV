// The A6 reference hash, pinned in vitest (lane E of v0.7: "with default settings the A6 hash 9cb46a35...
// does not change"). The same run as tools/bench/src/a6-run.ts's Node half: the determinism script on
// the 39e63ce9 fixture from the scene's own camera, 60 Hz frames. Until v0.7 only the bench script
// (which also writes evidence) compared it with the reference; a model change on purpose re-records
// it there and here together. Control: the same run with a perturbed thrust does not give it.
import { describe, expect, it } from 'vitest';
import { runDeterminism } from '@gsfpv/input/sim';
import { loadScene } from '../src/scenes';
import { params } from '../src/presets';

/** a6-run.ts REFERENCE (sim-core/0.3.0, w3-model: prop wash on every craft; 0.2.0 gave 1d01ca5b..., which the
 * same run gives with physics.propWash 0, below). */
const REFERENCE = '9cb46a358f1a9f82770a63934e8ef87954746b26918538935666f19094562c21';
const REFERENCE_0_2_0 = '1d01ca5b16aef6edce77d10de52517cbb609ace4fa05e47c3dccdf13111fff65';

describe('A6 reference hash (Node, fixture 39e63ce9)', () => {
    it('the determinism script still hashes to the recorded reference; control: a perturbed thrust does not', async () => {
        const sc = await loadScene('39e63ce9');
        const p = params('pavo20pro-3s');
        const pos = sc.settings.position, tgt = sc.settings.target;
        const spawn: [number, number, number, number] = [pos[0], pos[1], pos[2], (Math.atan2(tgt[0] - pos[0], -(tgt[2] - pos[2])) * 180) / Math.PI];
        expect(runDeterminism(p, sc.world, spawn, 60).hash).toBe(REFERENCE);
        let k = 0;
        expect(runDeterminism(p, sc.world, spawn, 60, () => (k++ % 7 === 0 ? 1 : 0)).hash).not.toBe(REFERENCE);
        // physics.propWash 0: the sim-core/0.2.0 reference bit for bit (the term is the only change of 0.3.0's flight)
        expect(runDeterminism(params('pavo20pro-3s', { wake: 0 }), sc.world, spawn, 60).hash).toBe(REFERENCE_0_2_0);
    }, 120000);
});
