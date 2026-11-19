// Lane gen4a (train 4, design gen4.md section 3): one analysis of the scan's walls that gives the course generator a quality
// map in the scan's own proportion, the scanned territory, the ground and roof heights and the scan's kind. Stage S0: the
// interface only (the contract gen4b builds against); analyzeScan comes in stage A1.
import type { Vec3 } from './types';
import type { ScanKind } from './request';

export interface ScanAnalysis {
    readonly kind: ScanKind;
    /** the scene's unit (sceneUnitM of the flight's transform) */
    readonly unitM: number;
    /** tile side, flown m: max(one block, extentM / 48) */
    readonly tileM: number;
    /** world x and z of tile (0, 0)'s low corner */
    readonly x0: number;
    readonly z0: number;
    readonly nx: number;
    readonly nz: number;
    /** 0..1 per tile, 1 = the scan's best quarter (crisp x coverage) */
    readonly quality: Float32Array;
    /** 1 = scanned territory: tiles with voxels, holes closed by 2 tiles */
    readonly footprint: Uint8Array;
    /** world y of the TOP of the lowest dense run of layers; NaN none */
    readonly groundTop: Float32Array;
    /** world y of the highest dense layer in the tile and its 8 neighbours; NaN none */
    readonly roofTop: Float32Array;
    /** world y of the first dense layer above groundTop with >= 1 m free under it; NaN none */
    readonly ceiling: Float32Array;
    /** the quality-weighted centroid of the best tiles, flown world */
    readonly core: Vec3;
    /** the radius around the core holding half the best tiles' weight, flown m */
    readonly coreRadiusM: number;
    /** the scan's horizontal extent, flown m */
    readonly extentM: number;
}
