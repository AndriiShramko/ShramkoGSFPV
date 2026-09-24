// A7 (Node part): the bot flies the scripted scenario on a scene; control: same plan in open volume.
import { Sim, Runner, InputLog, S } from '@gsfpv/sim-core';
import { VoxelContactWorld, syntheticOpen, findSphereSpawn } from '@gsfpv/collision';
import { Scenario, makePlan } from '@gsfpv/input/sim';
import { loadScene } from './scenes';
import { params } from './presets';

export async function flyScenario(sceneId: string, openVolume: boolean) {
    const sc = await loadScene(sceneId);
    const p = params('pavo20pro-3s');
    const plan = makePlan(sc.collision, p.boundRadius, sc.settings.position, sc.settings.target, 2 * p.vCrash, (x, y, z, r, o) => findSphereSpawn(sc.collision, x, y, z, r, o));
    const world = openVolume ? new VoxelContactWorld(syntheticOpen(0.05, 1000)) : sc.world;
    const sim = new Sim(p, world);
    sim.reset(plan.spawn[0], plan.spawn[1], plan.spawn[2], plan.spawnYawDeg);
    const log = new InputLog({ format: 'gsfpv-input-log/1', simCore: 'sim-core/0.1.0', preset: p.presetId, configHash: '', collisionSha256: sc.sha256, spawn: [...plan.spawn, plan.spawnYawDeg] as [number, number, number, number], seed: 0 });
    const runner = new Runner(sim, log, true);
    const scn = new Scenario(runner, plan);
    runner.trajectory = [];
    // disarmed sim hovers in air at start: hold position until armed by keeping it kinematic
    let t = 0;
    while (!scn.finished && sim.tick < 60000) {
        t += 16667; // 60 Hz frames
        runner.advanceTo(t);
    }
    return { plan, log: scn.log, ticks: sim.tick, startOverlaps: sim.startOverlaps, crashed: sim.s[S.crashed] > 0, events: runner.events.filter((e) => e.type !== 'contact').slice(0, 20), hash: runner.traceHash() };
}

if (process.argv[1]?.endsWith('a7-node.ts')) {
    for (const id of ['39e63ce9', '887f27aa']) {
        for (const open of [false, true]) {
            const r = await flyScenario(id, open);
            console.log(id, open ? 'OPEN' : 'SCENE', JSON.stringify({ phase: r.log.phase, phases: r.log.phases, hoverVz: r.log.hoverVz, maxSpeed: r.log.maxSpeed, crash: r.log.crash, tumble: r.log.tumbleMaxW, overl: r.startOverlaps, wall: r.plan.wallDir, box: r.plan.box[0] }));
        }
    }
}
