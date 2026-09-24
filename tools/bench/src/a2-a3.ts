// A2: vendored collision loads both voxel formats; A3: rate curves match compiled Betaflight.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { openVoxelCollision, UnsupportedVoxelFormatError } from '@gsfpv/collision';
import type { VoxelCollision, VoxelMetadata } from '@gsfpv/collision';
import { setpointRate, rawRate } from '@gsfpv/sim-core';
import type { RatesType } from '@gsfpv/sim-core';
import { REPO } from './evidence';
import { loadScene } from './scenes';

interface FloorProbe { from: number[]; hit: number[] | null; drop: number | null; surroundHits: number; ok: boolean }

/**
 * A start point in a correctly oriented scan: it is free, a ray straight down hits a floor within
 * 0.05-5 m whose surface faces up, and the scan surrounds it at pilot height (at least 12 of 16
 * horizontal rays hit geometry within 60 m). A wrong X/Y flip is a point reflection, so a floor
 * can still be found below — but the pilot then sits outside or under the scan and the
 * surrounding walls are missing, which is what the control detects.
 */
function probeFloor(col: VoxelCollision, p: number[]): FloorProbe {
    const free = col.isFreeAt(p[0], p[1], p[2]);
    let surroundHits = 0;
    for (let i = 0; i < 16; i++) {
        const a = (i / 16) * 2 * Math.PI;
        if (col.queryRay(p[0], p[1], p[2], Math.cos(a), 0, Math.sin(a), 60)) surroundHits++;
    }
    const hit = col.queryRay(p[0], p[1], p[2], 0, -1, 0, 20);
    if (!hit) return { from: p, hit: null, drop: null, surroundHits, ok: false };
    const drop = p[1] - hit.y;
    const n = col.querySurfaceNormal(hit.x, hit.y, hit.z, 0, -1, 0);
    const ok = free && drop > 0.05 && drop < 5 && n.ny > 0.7 && surroundHits >= 12;
    return { from: p, hit: [hit.x, hit.y, hit.z], drop, surroundHits, ok };
}

async function rawBytes(id: string): Promise<{ meta: VoxelMetadata; bin: Uint8Array }> {
    const s = await loadScene(id); // makes sure the files are cached
    void s;
    const dirs = [join(REPO, 'fixtures', id), join(REPO, '.cache', 'scenes', id)];
    for (const d of dirs) {
        try {
            const meta = JSON.parse(readFileSync(join(d, 'scene.voxel.json'), 'utf8')) as VoxelMetadata;
            let bin = new Uint8Array(readFileSync(join(d, 'scene.voxel.bin')));
            if (bin[0] === 0x1f && bin[1] === 0x8b) bin = new Uint8Array(gunzipSync(bin));
            return { meta, bin };
        } catch { /* next */ }
    }
    throw new Error(`no cached collision for ${id}`);
}

export async function runA2(): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {};
    let pass = true;
    for (const id of ['39e63ce9', '887f27aa']) {
        const sc = await loadScene(id);
        const { meta, bin } = await rawBytes(id);
        const starts = [sc.settings.position, ...sc.settings.extra];
        const right = openVoxelCollision(meta, bin);
        const wrong = openVoxelCollision(meta, bin, { forceFlip: !right.flipXY });
        const r = starts.map((p) => probeFloor(right, p));
        const w = starts.map((p) => probeFloor(wrong, p));
        const spawn = r[0];
        const rightOk = r.filter((x) => x.ok).length;
        const wrongOk = w.filter((x) => x.ok).length;
        const itemPass = spawn.ok && wrongOk < rightOk && !w[0].ok;
        pass = pass && itemPass;
        out[id] = {
            version: meta.version,
            flipXY: right.flipXY,
            voxelResolution: meta.voxelResolution,
            collisionSha256: sc.sha256,
            spawn: spawn,
            startPoints: starts.length,
            floorFoundCorrectFlip: rightOk,
            control: { name: 'wrong flip must miss the floor from the spawn', spawnWithWrongFlip: w[0], floorFoundWrongFlip: wrongOk, fired: !w[0].ok },
            pass: itemPass
        };
    }
    // unknown format -> explicit error
    let unknownError = '';
    try {
        const { meta, bin } = await rawBytes('39e63ce9');
        openVoxelCollision({ ...meta, version: '2.0' }, bin);
    } catch (e) {
        unknownError = e instanceof UnsupportedVoxelFormatError ? e.message : `wrong error: ${String(e)}`;
    }
    out.unknownVersion = { error: unknownError, pass: unknownError.startsWith('Unsupported voxel collision format version') };
    pass = pass && (out.unknownVersion as { pass: boolean }).pass;
    return { pass, results: out };
}

interface VectorSet { id: number; type: RatesType; rc_rate: number; rate: number; expo: number; rate_limit: number; x: number[]; omega: number[] }

/** A deliberately broken Actual curve (x^3 instead of x^5) — the negative control. */
function brokenActual(x: number, R: number, S: number, E: number): number {
    const a = Math.abs(x);
    const e = E / 100;
    const ex = a * (x * x * x * e + x * (1 - e));
    const c = R * 10;
    const m = Math.max(0, S * 10 - c);
    return x * c + m * ex;
}

export function runA3(): Record<string, unknown> {
    const table = JSON.parse(readFileSync(join(REPO, 'packages', 'sim-core', 'test', 'vectors', 'rates-bf451.json'), 'utf8'));
    const sets: VectorSet[] = table.sets;
    let maxErr = 0;
    let points = 0;
    let fails = 0;
    let ctlMax = 0;
    const perType: Record<string, { sets: number; maxErr: number }> = {};
    for (const s of sets) {
        const ax = { rcRate: s.rc_rate, rate: s.rate, expo: s.expo };
        const pt = (perType[s.type] ??= { sets: 0, maxErr: 0 });
        pt.sets++;
        for (let i = 0; i < s.x.length; i++) {
            const got = setpointRate(s.type, s.x[i], ax, s.rate_limit);
            const err = Math.abs(got - s.omega[i]);
            points++;
            if (err > 1e-9) fails++;
            if (err > maxErr) maxErr = err;
            if (err > pt.maxErr) pt.maxErr = err;
            if (s.type === 'ACTUAL') {
                const lim = Math.min(s.rate_limit, 1998);
                const bad = Math.max(-lim, Math.min(lim, brokenActual(s.x[i], s.rc_rate, s.rate, s.expo)));
                ctlMax = Math.max(ctlMax, Math.abs(bad - s.omega[i]));
            }
        }
    }
    void rawRate;
    return {
        pass: fails === 0 && ctlMax > 1e-9,
        source: table.source,
        build: table.build,
        sets: sets.length,
        points,
        tolerance: 1e-9,
        maxAbsErrorDegPerS: maxErr,
        failingPoints: fails,
        perType,
        control: { name: 'Actual curve with x^3 instead of x^5 must fail', maxAbsErrorDegPerS: ctlMax, fired: ctlMax > 1e-9 }
    };
}
