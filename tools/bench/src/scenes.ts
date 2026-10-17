// Scene collision for Node harnesses: read from the local cache, download from the CDN if missing.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { openVoxelCollision, VoxelContactWorld } from '@gsfpv/collision';
import type { VoxelCollision, VoxelMetadata } from '@gsfpv/collision';
import { sha256Hex } from '@gsfpv/sim-core';
import { REPO } from './evidence';

const CDN = 'https://d28zzqy0iyovbz.cloudfront.net';
// the S3 path (s3-eu-west-1.amazonaws.com/splats.playcanvas.com) answers 403 since 2026-10-16: the walls come from CloudFront too

/** Files are kept exactly as the CDN stores them (S3 served the voxel data gzip-encoded; old caches may hold that). */
function decoded(b: Uint8Array): Uint8Array {
    return b.length > 2 && b[0] === 0x1f && b[1] === 0x8b ? new Uint8Array(gunzipSync(b)) : b;
}

async function cached(id: string, name: string, url: string): Promise<Uint8Array> {
    const fixture = join(REPO, 'fixtures', id, name);
    if (existsSync(fixture)) return decoded(new Uint8Array(readFileSync(fixture)));
    const dir = join(REPO, '.cache', 'scenes', id);
    const file = join(dir, name);
    if (existsSync(file)) return decoded(new Uint8Array(readFileSync(file)));
    mkdirSync(dir, { recursive: true });
    const r = await fetch(`${url}?cb=${Math.random().toString(36).slice(2)}`, { headers: { Origin: 'https://gsfpv.flyreelstudio.eu' } });
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    const b = new Uint8Array(await r.arrayBuffer());
    writeFileSync(file, b);
    return b;
}

export interface SceneSettings {
    position: [number, number, number];
    target: [number, number, number];
    fov: number;
    extra: [number, number, number][]; // other camera positions from animation keyframes
}

export async function sceneSettings(id: string): Promise<SceneSettings> {
    const j = JSON.parse(new TextDecoder().decode(await cached(id, 'settings.json', `${CDN}/${id}/v1/settings.json`)));
    const cam = j.cameras?.[0]?.initial ?? j.camera;
    const extra: [number, number, number][] = [];
    const pos: number[] | undefined = j.animTracks?.[0]?.keyframes?.values?.position;
    if (pos) for (let i = 0; i + 2 < pos.length; i += 3) extra.push([pos[i], pos[i + 1], pos[i + 2]]);
    return { position: cam.position, target: cam.target, fov: cam.fov, extra };
}

export interface LoadedScene {
    id: string;
    collision: VoxelCollision;
    world: VoxelContactWorld;
    metadata: VoxelMetadata;
    sha256: string;
    settings: SceneSettings;
}

export async function loadScene(id: string): Promise<LoadedScene> {
    const json = await cached(id, 'scene.voxel.json', `${CDN}/${id}/v1/scene.voxel.json`);
    const bin = await cached(id, 'scene.voxel.bin', `${CDN}/${id}/v1/scene.voxel.bin`);
    const metadata = JSON.parse(new TextDecoder().decode(json)) as VoxelMetadata;
    const collision = openVoxelCollision(metadata, bin);
    const both = new Uint8Array(json.length + bin.length);
    both.set(json, 0);
    both.set(bin, json.length);
    return { id, collision, world: new VoxelContactWorld(collision), metadata, sha256: sha256Hex(both), settings: await sceneSettings(id) };
}
