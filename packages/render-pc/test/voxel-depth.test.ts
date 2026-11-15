// Lane voxview V1: the gates (World layer) give their depth to the voxel layer.
import { describe, expect, it } from 'vitest';
import { diffDepthCopies, joinsVoxelDepth } from '../src/voxel-depth';

const WORLD = 0, UI = 4, VOX = 1001, VOXDEPTH = 1000;

describe('voxel depth (V1)', () => {
    it('a gate in the World layer joins; a disabled one, a UI item and the voxels\u2019 own items do not', () => {
        expect(joinsVoxelDepth({ layers: [WORLD], enabled: true }, WORLD, [VOX, VOXDEPTH])).toBe(true);
        expect(joinsVoxelDepth({ layers: [WORLD], enabled: false }, WORLD, [VOX, VOXDEPTH])).toBe(false);
        expect(joinsVoxelDepth({ layers: [UI], enabled: true }, WORLD, [VOX, VOXDEPTH])).toBe(false);
        expect(joinsVoxelDepth({ layers: [VOX], enabled: true }, WORLD, [VOX, VOXDEPTH])).toBe(false);
        expect(joinsVoxelDepth({ layers: [WORLD, VOX], enabled: true }, WORLD, [VOX, VOXDEPTH])).toBe(false);
    });
    it('copies follow the scene: new items get one, gone items lose theirs', () => {
        const d = diffDepthCopies(['gate1', 'gate2', 'arrow1'], ['gate2', 'arrow1', 'gate3']);
        expect(d.add).toEqual(['gate3']);
        expect(d.drop).toEqual(['gate1']);
        const same = diffDepthCopies(['a'], ['a']);
        expect(same.add.length + same.drop.length).toBe(0);
    });
});
