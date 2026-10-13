// Writes fixtures/v2-log.json: a flight saved by the format /2 writer (base commit cbc41e8, before log
// format /3), so log-format-v3.test.ts can prove that /2 logs still replay bit for bit after the
// change. Run ONLY at a commit whose writer still writes /2 (the output says which format it wrote):
//   npx tsx packages/sim-core/test/fixtures/v2-log-maker.ts
// The flight: a synthetic room whose floor and wall move with the scene scale (so the world record
// matters to the replay), the repo's bot pilot hovering, a world record (s = 1.1, floater filter 3),
// a dash into the wall with the respawn director's rewind, then a 'settings' life (tauMs 18).
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Runner, S, compileParams, lifeSim } from '../../src/index';
import type { WorldEvent } from '../../src/index';
import { PRESET, PlaneWorld, Pilot, attachDirector, header, runFrames } from '../log-kit';

/** The fixture's room under scene scale s: floor at 0.8 (s - 1), a wall at x = 2 s (solid beyond). */
export function v2Room(s: number): PlaneWorld {
    return new PlaneWorld([[0, 1, 0, 0.8 * (s - 1)], [-1, 0, 0, -2 * s]]);
}

export const V2_SCENE = { id: 'synthetic-v2', version: 1, transform: [1, 0, 0, 0] as [number, number, number, number], floaterMinBlocks: 0 };

function bytesB64(b: Uint8Array): string {
    return Buffer.from(b.buffer, b.byteOffset, b.byteLength).toString('base64');
}

function main(): void {
    const at: [number, number, number, number] = [0, 0.05, 0, 0];
    const sim = lifeSim(compileParams(PRESET), v2Room(1));
    const r = new Runner(sim, header({ at, scene: V2_SCENE, opts: { platform: true } }), { traceHash: true, runHash: true });
    r.onWorld = (ev: WorldEvent) => { r.sim.world = v2Room(ev.s); };
    attachDirector(r, at, { target: 'rewind', delayTicks: 600 });
    const p = new Pilot(r);
    let dashed = false;
    p.plan = (pp, s, lt) => {
        if (pp.phase === '') { pp.bot.setTask({ kind: 'hover', target: [0, 1, 0], yawDeg: 0 }, s); pp.phase = 'hover'; }
        else if (pp.phase === 'hover' && lt > 2500 && !dashed && s.armed) {
            pp.bot.setTask({ kind: 'dash', from: pp.here(s), dir: [1, 0, 0], speed: 7, yawDeg: 0 }, s);
            pp.phase = 'dash';
            dashed = true;
        }
    };
    runFrames(r, 60, 1_500_000);
    r.world({ s: 1.1, t: [0, 0, 0], floaterMinBlocks: 3 } as WorldEvent);
    runFrames(r, 60, 6_000_000, { phaseUs: 1_500_000 });
    const st = r.sim.s;
    r.newLife(lifeSim(compileParams(PRESET, { tauMs: 18 }), r.sim.world), header({ at: [st[S.px], st[S.py], st[S.pz], 0], overrides: { tauMs: 18 }, scene: { ...V2_SCENE, transform: [1.1, 0, 0, 0] }, opts: { keepArmed: true, platform: true }, reason: 'settings' }));
    runFrames(r, 60, 8_000_000, { phaseUs: 6_000_000 });
    const lives = r.lives();
    const live = r.liveLifeHash();
    const out = {
        about: 'A flight saved by the format /2 writer at commit cbc41e8 (packages/sim-core/test/fixtures/v2-log-maker.ts): synthetic room (v2Room), bot hover, world record s = 1.1, dash into the wall, director rewind, settings life tauMs 18. Each life: header, records (base64), endTick, traceHash over the ticks after hashFrom (the current life: its hash so far). final: the sim state after the last tick.',
        format: lives[0].header.format,
        lives: lives.map((l, i) => ({
            header: l.header,
            b64: bytesB64(l.bytes()),
            endTick: l.endTick,
            traceHash: i === lives.length - 1 ? live!.hash : l.traceHash,
            hashFrom: i === lives.length - 1 ? live!.from : l.hashFrom
        })),
        final: Array.from(r.sim.s),
        events: r.events.filter((e) => e.type === 'crash' || e.type === 'respawn').map((e) => ({ type: e.type, tick: e.tick }))
    };
    const file = join(dirname(fileURLToPath(import.meta.url)), 'v2-log.json');
    writeFileSync(file, JSON.stringify(out, null, 1) + '\n');
    console.log(`wrote ${file}: format ${out.format}, ${lives.length} lives, events ${JSON.stringify(out.events)}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
