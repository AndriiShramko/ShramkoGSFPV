// A6: SHA-256 of the full trace is identical in Node and Chrome and across frame splits.
//
// A6_CHROME selects the browser half:
// - 'system' (default): the system Chrome, visible (browser.ts), the lab page from FLY_BASE, the
//   scene's collision from the public bucket, as on the owner's PC;
// - 'chromium': a Playwright Chromium (A6_CHROMIUM = its executable), headless, where no system
//   Chrome or display exists; the lab page's collision request is answered from the repo fixture
//   (the same bytes the Node half reads), so nothing leaves the machine;
// - 'off': Node only. The evidence then says the browser half did not run and scope 'node-only'.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { chromium } from 'playwright';
import type { Browser, Page } from 'playwright';
import { runDeterminism, replayDeterminism } from '@gsfpv/input/sim';
import { launch, visibility } from './browser';
import { loadScene } from './scenes';
import { params } from './presets';
import { REPO, writeEvidence } from './evidence';

const BASE = process.env.FLY_BASE ?? 'http://localhost:5190/fly/lab/';
const MODE = (process.env.A6_CHROME ?? 'system') as 'system' | 'chromium' | 'off';
/**
 * Trace hash of this script on sim-core/0.2.0 with the v0.3 presets. A model change on purpose
 * re-records it with evidence; any other change of the hash fails A6.
 * - 2026-10-01 (W2-2): 1d01ca5b16ae... The contact step resolves every touching duct when the first
 *   contact pins the body (sim.ts pinnedContacts, B12's frozen corner). This script's craft lies on
 *   its side on the floor from 1.25 s: 1218 of its ticks are pinned, and from tick 1271 on its other
 *   touching ducts get their impulse too. No crash before or after; every split and the replay agree
 *   (evidence/2026-10-01/v03-a6-determinism.json, v03-w2-2-model-why.json).
 * - 2026-09-26: dda474a21626... (sim-core/0.2.0 before that fix); sim-core/0.1.0 (v0.2) gave d3d4e0e380c8...
 */
const REFERENCE = '1d01ca5b16aef6edce77d10de52517cbb609ace4fa05e47c3dccdf13111fff65';
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

function fixtureFile(name: string): Buffer {
    const b = readFileSync(join(REPO, 'fixtures', '39e63ce9', name));
    return b[0] === 0x1f && b[1] === 0x8b ? gunzipSync(b) : b;
}

async function browserHalf(): Promise<{ chrome: Record<string, unknown> | null; vis: string; log: string[]; browserName: string }> {
    let browser: Browser;
    let page: Page;
    let log: string[] = [];
    let browserName = 'system Chrome (visible)';
    if (MODE === 'chromium') {
        browser = await chromium.launch({ headless: true, executablePath: process.env.A6_CHROMIUM });
        browserName = `Playwright Chromium ${browser.version()} (headless)`;
        page = await browser.newPage();
        page.on('console', (m) => log.push(`${m.type()}: ${m.text()}`.slice(0, 400)));
        page.on('pageerror', (e) => log.push(`pageerror: ${e.message}`.slice(0, 400)));
        await page.route(/splats\.playcanvas\.com\/39e63ce9\/v1\/scene\.voxel\.(json|bin)(\?.*)?$/, (route) => {
            const name = route.request().url().includes('.json') ? 'scene.voxel.json' : 'scene.voxel.bin';
            return route.fulfill({ status: 200, body: fixtureFile(name), headers: { 'access-control-allow-origin': '*', 'content-type': 'application/octet-stream' } });
        });
    } else {
        const l = await launch();
        browser = l.browser;
        page = l.page;
        log = l.console;
        // system Chrome, or the bundled Chromium where there is none (browser.ts)
        browserName = `${l.which.kind === 'system-chrome' ? 'system Chrome' : 'Playwright Chromium (no system Chrome)'} ${l.which.version ?? ''} (visible)`;
    }
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
    return { chrome, vis, log, browserName };
}

const b = MODE === 'off' ? null : await browserHalf();
const chrome = b?.chrome ?? null;
const ref = node[0].hash;
const chromeHashes = [
    ...((chrome?.splits as { hash: string }[]) ?? []).map((x) => x.hash),
    (chrome?.replayFromInputLog as { hash: string } | undefined)?.hash,
    (chrome?.rafPaced as { hash: string } | undefined)?.hash
];
const allNode = [...node.map((x) => x.hash), nodeReplay.hash];
const nodeSame = allNode.every((h) => h === ref);
const same = [...allNode, ...(b ? chromeHashes : [])].every((h) => h === ref);
const ctlChrome = (chrome?.control as { hash: string } | undefined)?.hash;
const controlFired = nodeCtl.hash !== ref && (!b || (!!ctlChrome && ctlChrome !== ref));
const matchesReference = ref === REFERENCE;
const browserOk = !b || (chrome?.status === 'done' && b.vis === 'visible');
const pass = nodeSame && same && controlFired && matchesReference && browserOk;
const file = writeEvidence('v03-a6-determinism', {
    pass,
    scope: b ? 'node+browser' : 'node-only',
    referenceHash: ref,
    recordedReference: { hash: REFERENCE, matches: matchesReference, previous: ['dda474a216260e7696f971fb6c10756bc7d6d8d512451fa327ff2d5ba02fb3b2 (sim-core/0.2.0 before the pinned-contact fix, 2026-09-26)', 'd3d4e0e380c8ca533ebdd462398c436ac1030ced791b7a0e2b399878cf4caf72 (sim-core/0.1.0, evidence/2026-09-24/a6-determinism.json)'] },
    script: 'SimRadio channel script (arm, climb, chirps, square waves, a flip, yaw spins, dive), 30 s, 250 Hz, +-400 us jitter, seed 42; scene 39e63ce9 collision',
    node: { splits: node, replayFromInputLog: { hash: nodeReplay.hash, ticks: nodeReplay.ticks }, allEqual: nodeSame },
    browser: b ? { name: b.browserName, collision: MODE === 'chromium' ? 'repo fixture answered through page.route (same bytes as the Node half)' : 'public bucket' } : { status: 'not run (A6_CHROME=off)' },
    chrome,
    visibility: b?.vis ?? null,
    control: { name: 'Math.random in the sim step must change the hash', nodeHash: nodeCtl.hash, chromeHash: ctlChrome ?? null, fired: controlFired },
    consoleErrors: (b?.log ?? []).filter((l) => l.startsWith('error') || l.startsWith('pageerror'))
});
console.log('A6', pass ? 'PASS' : 'FAIL', b ? '' : '(node only)', ref, matchesReference ? '(= reference)' : '(reference ' + REFERENCE.slice(0, 12) + ')', JSON.stringify({ node: allNode.map((h) => h.slice(0, 12)), chrome: chromeHashes.map((h) => h?.slice(0, 12)), ctl: [nodeCtl.hash.slice(0, 12), ctlChrome?.slice(0, 12)] }), '->', file);
