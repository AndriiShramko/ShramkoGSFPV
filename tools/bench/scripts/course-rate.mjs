// Lane course3, stage G1-progress: the course generator's rates for the progress line's estimate, from the K1.1 audit
// (tools/bench/src/tracks-audit.ts --fit, one JSON per scan). For every scan: the free-space pass (freeMs), the mean ms of
// one generateCourse try (sum of row ms / sum of rows' tried) and the walls' size (leafDataCount of scene.voxel.json).
// Prints one line per scan and the fitted ms per million leaf words of a try and of the free-space pass.
// Usage: node tools/bench/scripts/course-rate.mjs <audit dir> <walls root> [<extra id>=<walls dir> ...]
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const [audit, root, ...extra] = process.argv.slice(2);
if (!audit || !root) {
    console.error('usage: course-rate.mjs <audit dir> <walls root> [id=dir ...]');
    process.exit(2);
}
const dirs = new Map(extra.map((e) => e.split('=')));
function wallsOf(id) {
    if (dirs.has(id)) return join(dirs.get(id), 'scene.voxel.json');
    const d = join(root, id);
    if (!existsSync(d)) return null;
    const v = readdirSync(d).filter((n) => /^v\d+$/.test(n)).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))).pop();
    return v ? join(d, v, 'scene.voxel.json') : null;
}
let sumTry = 0, sumLeafT = 0, sumFree = 0, sumLeafF = 0;
for (const f of readdirSync(audit).filter((n) => n.endsWith('.json'))) {
    const j = JSON.parse(readFileSync(join(audit, f), 'utf8'));
    const id = j.summary.scene;
    const wf = wallsOf(id);
    if (!wf || !existsSync(wf)) { console.log(`${id} no walls file`); continue; }
    const meta = JSON.parse(readFileSync(wf, 'utf8'));
    const leaf = meta.leafDataCount ?? 0;
    // CR-3: course-quality-audit.ts rows count fitCourse's tries as `fits` (the walk's own tries are `tries` there)
    const triedOf = (r) => r.tried ?? r.fits ?? 0;
    const rows = j.rows.filter((r) => r.ms > 0 && triedOf(r) > 0);
    const ms = rows.reduce((a, r) => a + r.ms, 0);
    const tried = rows.reduce((a, r) => a + triedOf(r), 0);
    const perTry = tried ? ms / tried : 0;
    const triesMean = rows.length ? tried / rows.length : 0;
    console.log(`${id} leafM=${(leaf / 1e6).toFixed(2)} nodesM=${((meta.nodeCount ?? 0) / 1e6).toFixed(2)} res=${meta.voxelResolution} freeMs=${j.summary.freeMs} msPerTry=${perTry.toFixed(0)} triesMean=${triesMean.toFixed(2)} msPerTryPerMLeaf=${leaf ? (perTry / (leaf / 1e6)).toFixed(0) : '-'}`);
    if (perTry > 0 && leaf > 0) { sumTry += perTry; sumLeafT += leaf / 1e6; }
    if (leaf > 0) { sumFree += j.summary.freeMs; sumLeafF += leaf / 1e6; }
}
console.log(`fit: msPerTry per M leaf = ${(sumTry / sumLeafT).toFixed(0)}; freeMs per M leaf = ${(sumFree / sumLeafF).toFixed(0)}`);
