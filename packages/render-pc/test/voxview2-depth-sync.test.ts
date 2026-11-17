// Lane voxview2 V6: a render item that appears while the voxels show (the plate of a new next gate, a gate rebuilt by the
// edit mode, a drone that joins) gets its depth copy in the update it appears, not some frames later.
import { describe, expect, it } from 'vitest';
import * as vd from '../src/voxel-depth';

type Due = (sinceSync: number) => boolean;
const due = (): Due | undefined => (vd as unknown as { depthSyncDue?: Due }).depthSyncDue;

/** frames a new item spends without a copy when it appears at update `at` of a run of updates */
function lagFrames(at: number, updates: number): number {
    const f = due();
    let since = 0;
    const have = new Set<string>();
    let lag = 0;
    for (let u = 0; u < updates; u++) {
        const want = u >= at ? ['gate', 'plate'] : ['gate'];
        since++;
        if (f && f(since)) {
            since = 0;
            const d = vd.diffDepthCopies(have, want);
            for (const k of d.add) have.add(k);
            for (const k of d.drop) have.delete(k);
        }
        if (u >= at && !have.has('plate')) lag++;
    }
    return lag;
}

describe('voxview2 V6: depth copies follow new items in the same frame', () => {
    it('a plate made at any update has its copy in that update', () => {
        expect(typeof due()).toBe('function');
        for (let at = 1; at < 25; at++) expect(lagFrames(at, 40)).toBe(0);
    });
});
