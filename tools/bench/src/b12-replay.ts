// Replays a flight captured by b12-capture.ts in Node on the scene's collision (scenes.ts) and
// prints the story of each life: every `every` ticks the position, speed, up-vector y, sticks and
// contacts, and every crash / respawn with the ticks around it.
//   npx tsx src/b12-replay.ts <flight.json> [every=250] [fromTick] [toTick]
import { readFileSync } from 'node:fs';
import { LifePlayer, S } from '@gsfpv/sim-core';
import type { Life, LifeHeader, Sim, SimEvent } from '@gsfpv/sim-core';
import { loadScene } from './scenes';

interface SavedLifeLike { header: LifeHeader; b64: string; endTick: number; hash: string; hashFrom: number }

const [file, everyArg, fromArg, toArg] = process.argv.slice(2);
const every = Number(everyArg ?? 250);
const from = Number(fromArg ?? 0);
const to = Number(toArg ?? Infinity);
const j = JSON.parse(readFileSync(file, 'utf8')) as { flight: { lives: SavedLifeLike[]; hash: string } };
const scene = await loadScene('39e63ce9');
const unb64 = (s: string) => new Uint8Array(Buffer.from(s, 'base64'));
const f = (x: number, d = 3) => x.toFixed(d);
for (const [i, l] of j.flight.lives.entries()) {
    if (l.header.collisionSha256 !== null && l.header.collisionSha256 !== scene.sha256) throw new Error(`life ${i}: other walls ${l.header.collisionSha256} vs ${scene.sha256}`);
    const bytes = unb64(l.b64);
    const life: Life = { header: l.header, bytes: () => bytes, endTick: l.endTick, traceHash: l.hash, hashFrom: l.hashFrom };
    const p = new LifePlayer(life, { preset: () => l.header.presetJson ?? null, world: () => scene.world }, l.endTick, { hash: true });
    let contacts = 0;
    const show = (sim: Sim, tag = '') => {
        const s = sim.s;
        const v = Math.hypot(s[S.vx], s[S.vy], s[S.vz]);
        const upY = 1 - 2 * (s[S.qx] * s[S.qx] + s[S.qz] * s[S.qz]);
        const w = Math.hypot(s[S.wx], s[S.wy], s[S.wz]);
        console.log(`${tag}t ${sim.tick} p ${f(s[S.px])},${f(s[S.py])},${f(s[S.pz])} v ${f(s[S.vx], 2)},${f(s[S.vy], 2)},${f(s[S.vz], 2)} |v| ${f(v)} upY ${f(upY)} |w| ${f(w, 2)} ch ${Array.from(sim.ch.slice(0, 5), (c) => f(c, 2)).join(',')} armed ${s[S.armed]} crashed ${s[S.crashed]} contacts ${contacts}`);
    };
    console.log(`life ${i} ${l.header.life.reason} start ${l.header.life.startTick} end ${l.endTick} at ${l.header.life.at.map((x) => f(x)).join(',')} opts ${JSON.stringify(l.header.life.opts)}`);
    p.onEvent = (e: SimEvent) => {
        if (e.type === 'contact') { contacts++; return; }
        console.log('  event', JSON.stringify(e));
    };
    p.onStep = (sim: Sim) => { if (sim.tick >= from && sim.tick <= to && sim.tick % every === 0) show(sim, '  '); };
    p.stepTo(l.endTick);
    show(p.sim, '  end ');
    console.log(`  hash ${p.digest() === l.hash ? 'matches the page' : `DIFFERS ${p.digest()} vs ${l.hash}`}`);
}
