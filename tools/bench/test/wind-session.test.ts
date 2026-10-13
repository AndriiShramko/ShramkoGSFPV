// A flight session with wind (v0.7 lane E, docs/wip/v07-e.md sections 3 and 6): every life header
// describes the flight model its Sim flies, so the log replays to the live flight. The case a review
// found: walls that arrive while the scan is flown (walls.ts queues refined or tab-built walls,
// FlightSession takes them at a restart) move the floor the wind's gradient measures from. The new
// model must measure from the new floor AND its header must say so; before the fix the Sim measured
// from the old floor while the header named the new one, and every replay of a windy flight diverged.
//
// The session is the real FlightSession (apps/fly/src/session/index.ts) started through its public
// start() with a renderer that draws nothing, the scene's CDN answered by a fake fetch (fixture
// 39e63ce9, served without walls), and the walls handed over as the tab hands them (queueCollision).
// No network, no GPU. Controls: the two floors differ (so "the new floor" is a real check), and the
// same log with the other floor in its header replays to another hash (so the replay check sees a
// header that disagrees with the Sim).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { S, lifeConfigHash, replayLives } from '../../../packages/sim-core/src';
import type { Life, LifeHeader, Runner } from '../../../packages/sim-core/src';
import { openVoxelCollision } from '../../../packages/collision/src';
import type { VoxelMetadata } from '../../../packages/collision/src';
import { FlightSession } from '../../../apps/fly/src/session';
import type { SessionOptions } from '../../../apps/fly/src/session';
import { depsFor } from '../../../apps/fly/src/session/replay';
import type { WindSpec } from '../../../apps/fly/src/session/wind-source';

const SCENE = '39e63ce9';
const FIX = join(__dirname, '..', '..', '..', 'fixtures', SCENE);
const settingsJson = readFileSync(join(FIX, 'settings.json'), 'utf8');
const json1 = new Uint8Array(readFileSync(join(FIX, 'scene.voxel.json')));
const binRaw = new Uint8Array(readFileSync(join(FIX, 'scene.voxel.bin')));
const bin = binRaw[0] === 0x1f && binRaw[1] === 0x8b ? new Uint8Array(gunzipSync(binRaw)) : binRaw;
const meta1 = JSON.parse(new TextDecoder().decode(json1)) as VoxelMetadata;
/** "Refined" walls: the same voxels 4 cm lower, so another floor under the spawn. */
const meta2 = JSON.parse(JSON.stringify(meta1)) as VoxelMetadata;
meta2.gridBounds.min[1] -= 0.04;
meta2.gridBounds.max[1] -= 0.04;
const json2 = new TextEncoder().encode(JSON.stringify(meta2));
const SHA1 = 'a'.repeat(64);
const SHA2 = 'b'.repeat(64);

const WIND: WindSpec = { fromDeg: 270, speed: 6, gust: 2, compassDeg: 0, hasCompass: false, source: 'custom' };

/** The scene's CDN for resolveScene: settings and lod-meta in v1, no other version, no walls (they come from the tab). */
async function cdn(url: string | URL | Request): Promise<Response> {
    const u = String(url instanceof Request ? url.url : url);
    if (u.includes(`/${SCENE}/v1/settings.json`)) return new Response(settingsJson, { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (u.includes(`/${SCENE}/v1/lod-meta.json`)) return new Response(null, { status: 200 });
    return new Response(null, { status: 403 });
}

/** A renderer that draws nothing: every method a no-op, `app` an event source nobody fires. */
function nullRenderer(): NonNullable<SessionOptions['renderer']> {
    const app = { on() { /* no frames */ }, off() { /* no frames */ } };
    return new Proxy({}, {
        get: (_t, k) => (k === 'app' ? app : k === 'then' ? undefined : () => undefined)
    }) as NonNullable<SessionOptions['renderer']>;
}

/** Fly `ms` of sim time from the runner's tick now: arm switch off then on, throttle low then a little up. */
function fly(r: Runner, ms: number): void {
    const t0 = r.sim.tick;
    for (let i = 0; i < ms; i++) {
        r.enqueue({ tUs: (t0 + i) * 1000, ch: [0, 0, i < 300 ? -1 : 0.1, 0, i < 100 ? -1 : 1, -1, 0, 0] });
    }
    for (let t = t0 + 50; t <= t0 + ms; t += 50) r.advanceTo(t * 1000);
}

/** The scan's floor under a point, as a ray straight down through `meta`'s walls finds it (identity Scene size). */
function floorUnder(meta: VoxelMetadata, p: readonly number[]): number {
    const hit = openVoxelCollision(meta, bin).queryRay(p[0], p[1], p[2], 0, -1, 0, 500);
    if (!hit) throw new Error('no floor under the spawn in the fixture');
    return hit.y;
}

/**
 * The saved-log check of every life (a crash into the walls starts another): each replayed alone from
 * its own header on the session's walls, to its end (the current one to the tick now), beside the
 * hash the flight recorded (an ended life's traceHash, the current one's liveLifeHash).
 */
function lifeChecks(ses: FlightSession, lives: readonly Life[]): { recorded: string; replayed: string }[] {
    return lives.map((life, i) => {
        const current = i === lives.length - 1;
        const endTick = current ? ses.runner.sim.tick : life.endTick;
        const replayed = replayLives([life], depsFor(life.header, ses.wallsSource), { endTick }).hash;
        return { recorded: current ? ses.runner.liveLifeHash()!.hash : life.traceHash!, replayed };
    });
}

/** The same lives with another wind ground in their headers (each configHash made to match, as a writer would). */
function withGround(lives: readonly Life[], groundM: number): Life[] {
    return lives.map((life) => {
        const h = JSON.parse(JSON.stringify(life.header)) as LifeHeader;
        h.overrides.wind = { ...h.overrides.wind!, groundM };
        h.configHash = lifeConfigHash(h.presetSha256, h.overrides, h.simCore);
        return { ...life, header: h, bytes: life.bytes };
    });
}

/** Every life replays to the hash it recorded; control: with `otherGround` in the headers the first one does not. */
function expectReplays(ses: FlightSession, otherGround: number): void {
    const lives = ses.lives();
    for (const c of lifeChecks(ses, lives)) expect(c.replayed).toBe(c.recorded);
    const [first] = lifeChecks(ses, withGround(lives, otherGround));
    expect(first.replayed).not.toBe(first.recorded);
}

describe('a session with wind: the life header describes the model the Sim flies', () => {
    let ses: FlightSession | null = null;
    beforeEach(() => { vi.stubGlobal('fetch', cdn); });
    afterEach(() => {
        ses?.dispose();
        ses = null;
        vi.unstubAllGlobals();
    });

    const start = async (): Promise<FlightSession> => {
        ses = await FlightSession.start({} as HTMLCanvasElement, { sceneId: SCENE, renderer: nullRenderer(), drawScan: false, wind: WIND, windSeed: 7 });
        return ses;
    };

    it('walls taken while parked: the model measures from their floor, the header says so, the flight replays', async () => {
        const s = await start();
        expect(s.walls).toBe('none');
        const before = s.sim.p.wind!.groundM;
        s.queueCollision(json1, bin, SHA1, null); // parked at the spawn: swapped at once (a new model)
        expect(s.wallsPending).toBe(false);
        const floor = floorUnder(meta1, s.spawn);
        expect(Math.abs(floor - before)).toBeGreaterThan(0.01); // control: the walls moved the ground
        expect(s.sim.p.wind!.groundM).toBeCloseTo(floor, 6);
        expect(s.log.header.overrides.wind!.groundM).toBe(s.sim.p.wind!.groundM);
        fly(s.runner, 4000);
        expect(s.lives()[0].header.life.reason).toBe('start');
        expect(s.lives()[0].endTick).toBeGreaterThan(1000); // it flew (into the room's top: a crash, another life)
        // control: a header naming the ground the session had before the walls replays another flight
        expectReplays(s, before);
    });

    it('refined walls queued in flight and taken by R: the new floor, in the Sim and the header; control: the old floor replays apart', async () => {
        const s = await start();
        s.queueCollision(json1, bin, SHA1, null);
        fly(s.runner, 2000);
        expect(s.sim.s[S.hold]).toBe(0);
        let swapped = '';
        s.queueCollision(json2, bin, SHA2, (sha) => { swapped = sha; }); // flying: waits for a restart
        expect(s.wallsPending).toBe(true);
        const oldFloor = s.sim.p.wind!.groundM;
        s.respawnStart(); // R: the queued walls go in, a new flight model at the spawn
        expect(swapped).toBe(SHA2);
        expect(s.collisionSha256).toBe(SHA2);
        const newFloor = floorUnder(meta2, s.spawn);
        expect(Math.abs(newFloor - oldFloor)).toBeGreaterThan(0.01); // control: the refined walls have another floor
        expect(s.sim.p.wind!.groundM).toBeCloseTo(newFloor, 6);
        expect(s.log.header.overrides.wind!.groundM).toBe(s.sim.p.wind!.groundM);
        fly(s.runner, 4000);
        // control: the header the old order wrote (the Sim on the old floor, the header on the new one)
        // is the mismatch this replay check catches: the other floor in the header replays apart
        expectReplays(s, oldFloor);
    });
});
