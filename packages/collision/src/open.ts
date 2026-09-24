// Open SuperSplat voxel collision from bytes or URLs, with an explicit error for unknown formats.

import { VoxelCollision, FlippedVoxelCollision } from './vendor/voxel-collision';
import type { VoxelMetadata } from './vendor/voxel-collision';

export const SUPPORTED_VOXEL_VERSIONS = ['1.0', '1.1'];

export class UnsupportedVoxelFormatError extends Error {
    constructor(version: unknown) {
        super(`Unsupported voxel collision format version: ${JSON.stringify(version)} (supported: ${SUPPORTED_VOXEL_VERSIONS.join(', ')})`);
        this.name = 'UnsupportedVoxelFormatError';
    }
}

/** Same construction as the upstream loader, from already-downloaded bytes. */
export function openVoxelCollision(metadata: VoxelMetadata, bin: ArrayBuffer | Uint8Array, opts: { forceFlip?: boolean } = {}): VoxelCollision {
    const v = metadata.version;
    // Upstream treats a missing version as legacy 1.0; anything else must be a known version.
    if (v !== undefined && v !== null && !SUPPORTED_VOXEL_VERSIONS.includes(String(v))) {
        throw new UnsupportedVoxelFormatError(v);
    }
    const ab = bin instanceof Uint8Array ? bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) : bin;
    const view = new Uint32Array(ab as ArrayBuffer);
    if (view.length < metadata.nodeCount + metadata.leafDataCount) {
        throw new Error(`voxel data truncated: ${view.length} words, need ${metadata.nodeCount + metadata.leafDataCount}`);
    }
    const nodes = view.slice(0, metadata.nodeCount);
    const leafData = view.slice(metadata.nodeCount, metadata.nodeCount + metadata.leafDataCount);
    const isLegacy = !v || parseFloat(String(v)) < 1.1;
    const flip = opts.forceFlip !== undefined ? opts.forceFlip : isLegacy;
    return flip ? new FlippedVoxelCollision(metadata, nodes, leafData) : new VoxelCollision(metadata, nodes, leafData);
}

export interface FetchedCollision {
    collision: VoxelCollision;
    metadata: VoxelMetadata;
    jsonBytes: Uint8Array;
    binBytes: Uint8Array;
}

export class NoCollisionError extends Error {
    constructor(url: string, status: number) {
        super(`scene has no voxel collision (${status} for ${url})`);
        this.name = 'NoCollisionError';
    }
}

/** Fetch scene.voxel.json + .bin. A 403/404 means the scene has no collision. */
export async function fetchVoxelCollision(jsonUrl: string, fetchImpl: typeof fetch = fetch): Promise<FetchedCollision> {
    const jr = await fetchImpl(jsonUrl);
    if (jr.status === 403 || jr.status === 404) throw new NoCollisionError(jsonUrl, jr.status);
    if (!jr.ok) throw new Error(`voxel metadata ${jr.status} ${jr.statusText}`);
    const jsonBytes = new Uint8Array(await jr.arrayBuffer());
    const metadata = JSON.parse(new TextDecoder().decode(jsonBytes)) as VoxelMetadata;
    const binUrl = jsonUrl.replace('.voxel.json', '.voxel.bin');
    const br = await fetchImpl(binUrl);
    if (!br.ok) throw new Error(`voxel data ${br.status} ${br.statusText}`);
    const binBytes = new Uint8Array(await br.arrayBuffer());
    return { collision: openVoxelCollision(metadata, binBytes), metadata, jsonBytes, binBytes };
}
