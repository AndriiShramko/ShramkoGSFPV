// Architecture rules that CI enforces (a light replacement for dependency-cruiser):
//  1. packages/sim-core imports nothing outside itself and never touches DOM globals.
//  2. packages/collision imports nothing but itself (vendored code + our wrappers), no DOM.
//  3. apps/site never imports playcanvas or the simulator packages.
//  4. no Betaflight-looking identifiers were pasted into our sources (formulas only, no GPL code).
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const problems = [];

function walk(dir, out = []) {
    if (!existsSync(dir)) return out;
    for (const n of readdirSync(dir)) {
        if (n === 'node_modules' || n === '.next' || n === 'out' || n === 'dist') continue;
        const p = join(dir, n);
        if (statSync(p).isDirectory()) walk(p, out); else if (/\.(ts|tsx|mjs|js)$/.test(n)) out.push(p);
    }
    return out;
}

const importRe = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;
function imports(file) {
    const s = readFileSync(file, 'utf8');
    const out = [];
    let m;
    while ((m = importRe.exec(s))) out.push(m[1] ?? m[2]);
    return { s, out };
}

const DOM = /\b(window|document|navigator|localStorage|requestAnimationFrame|HTMLElement)\s*[.(]/;

for (const f of walk(join(ROOT, 'packages', 'sim-core', 'src'))) {
    const { s, out } = imports(f);
    for (const i of out) if (!i.startsWith('.')) problems.push(`sim-core imports ${i} (${f})`);
    if (DOM.test(s)) problems.push(`sim-core touches the DOM (${f})`);
    if (/Math\.(random|sin|cos|tan|atan2?|exp|log|pow)\s*\(/.test(s) && !f.endsWith('dmath.ts')) problems.push(`sim-core uses non-deterministic Math (${f})`);
    if (/\bDate\.now\s*\(|performance\.now\s*\(/.test(s)) problems.push(`sim-core reads a clock (${f})`);
}
for (const f of walk(join(ROOT, 'packages', 'collision', 'src'))) {
    const { s, out } = imports(f);
    for (const i of out) if (!i.startsWith('.')) problems.push(`collision imports ${i} (${f})`);
    if (DOM.test(s)) problems.push(`collision touches the DOM (${f})`);
}
for (const f of walk(join(ROOT, 'apps', 'site'))) {
    const { out } = imports(f);
    for (const i of out) if (/^(playcanvas|@gsfpv\/(render-pc|sim-core|collision|crash|input))/.test(i)) problems.push(`site imports ${i} (${f})`);
}
const BF = /\b(currentControlRateProfile|pidRuntime|rcCommandf|applyBetaflightRates|pidCoefficient|FEEDFORWARD_SCALE\s*\*)/;
for (const f of [...walk(join(ROOT, 'packages')), ...walk(join(ROOT, 'apps'))]) {
    if (f.includes(`${join('collision', 'src', 'vendor')}`)) continue;
    const s = readFileSync(f, 'utf8');
    if (BF.test(s)) problems.push(`Betaflight identifier found (${f})`);
}

if (problems.length) {
    console.error(problems.join('\n'));
    process.exit(1);
}
console.log('architecture rules: ok');
