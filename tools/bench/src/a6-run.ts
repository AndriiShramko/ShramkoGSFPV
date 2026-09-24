// A6: SHA-256 of the full trace is identical in Node and Chrome and across frame splits.
import { runDeterminism, replayDeterminism } from '@gsfpv/input/sim';
import { launch, visibility } from './browser';
import { loadScene } from './scenes';
import { params } from './presets';
import { writeEvidence } from './evidence';

const BASE = process.env.FLY_BASE ?? 'http://localhost:5190/fly/lab/';
const sc = await loadScene('39e63ce9');
const p = params('pavo20pro-3s');
const spawn: [number, number, number, number] = [sc.settings.position[0], sc.settings.position[1], sc.settings.position[2], (Math.atan2(sc.settings.target[0] - sc.settings.position[0], -(sc.settings.target[2] - sc.settings.position[2])) * 180) / Math.PI];

const node = [30, 60, 144, 240].map((hz) => {
    const r = runDeterminism(p, sc.world, spawn, hz);
    return { frameHz: r.frameHz, hash: r.hash, ticks: r.ticks, hitches: r.hitches, crashed: r.crashed };
});
const base = runDeterminism(p, sc.world, spawn, 60);
const nodeReplay = replayDeterminism(p, sc.world, spawn, base.log, base.ticks);
const nodeCtl = runDeterminism(p, sc.world, spawn, 60, Math.random);

const { browser, page, console: log } = await launch();
await page.goto(`${BASE}det.html?spawn=${encodeURIComponent(JSON.stringify(spawn))}`);
let chrome: Record<string, unknown> | null = null;
const t0 = Date.now();
while (Date.now() - t0 < 300000) {
    chrome = await page.evaluate(() => (window as unknown as { __det?: Record<string, unknown> }).__det ?? null);
    if (chrome && chrome.status !== 'running') break;
    await page.waitForTimeout(500);
}
const vis = await visibility(page);
await browser.close();

const ref = node[0].hash;
const chromeHashes = [
    ...((chrome?.splits as { hash: string }[]) ?? []).map((x) => x.hash),
    (chrome?.replayFromInputLog as { hash: string } | undefined)?.hash,
    (chrome?.rafPaced as { hash: string } | undefined)?.hash
];
const allNode = [...node.map((x) => x.hash), nodeReplay.hash];
const same = [...allNode, ...chromeHashes].every((h) => h === ref);
const ctlChrome = (chrome?.control as { hash: string } | undefined)?.hash;
const controlFired = nodeCtl.hash !== ref && !!ctlChrome && ctlChrome !== ref;
const pass = same && controlFired && chrome?.status === 'done' && vis === 'visible';
const file = writeEvidence('a6-determinism', {
    pass,
    referenceHash: ref,
    script: 'SimRadio channel script (arm, climb, chirps, square waves, a flip, yaw spins, dive), 30 s, 250 Hz, +-400 us jitter, seed 42; scene 39e63ce9 collision',
    node: { splits: node, replayFromInputLog: { hash: nodeReplay.hash, ticks: nodeReplay.ticks } },
    chrome,
    visibility: vis,
    control: { name: 'Math.random in the sim step must change the hash', nodeHash: nodeCtl.hash, chromeHash: ctlChrome, fired: controlFired },
    consoleErrors: log.filter((l) => l.startsWith('error') || l.startsWith('pageerror'))
});
console.log('A6', pass ? 'PASS' : 'FAIL', ref, JSON.stringify({ node: node.map((x) => x.hash.slice(0, 12)), chrome: chromeHashes.map((h) => h?.slice(0, 12)), ctl: [nodeCtl.hash.slice(0, 12), ctlChrome?.slice(0, 12)] }), '->', file);
