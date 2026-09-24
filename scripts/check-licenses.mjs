// Dependency licence gate (spec-compliance): only permissive licences in the dependency tree,
// no research-licensed Gaussian splatting code, no unknown licences.
// Reads `pnpm licenses list --json --prod` from stdin or runs it.
import { execSync } from 'node:child_process';

const ALLOWED = /^(OFL-1.1|MIT|Apache-2\.0|BSD-2-Clause|BSD-3-Clause|ISC|0BSD|CC0-1\.0|BlueOak-1\.0\.0|Unlicense|CC-BY-4\.0|Python-2\.0|MPL-2\.0)$/i;
const BANNED_NAMES = /(diff-gaussian-rasterization|sugar|2dgs|gaussian-opacity-fields|rade-gs|mip-splatting|stopthepop)/i;

// Build-time only, never in the static release: Next's image optimiser pulls sharp, whose
// prebuilt libvips binary is LGPL-3.0. `output: 'export'` ships no server and no sharp.
const BUILD_ONLY = [[/^@img\/sharp-/, 'libvips binary of sharp: Next build tooling, not shipped in dist/']];
const exceptions = [];

const raw = execSync('pnpm licenses list --json --prod', { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const data = JSON.parse(raw);
const problems = [];
let count = 0;
for (const [license, pkgs] of Object.entries(data)) {
    for (const p of pkgs) {
        count++;
        const name = p.name ?? p.packageName ?? '?';
        if (BANNED_NAMES.test(name)) problems.push(`banned research package: ${name}`);
        // SPDX: any OR-alternative whose AND-parts are ALL allowed
        const ok = license.replace(/[()]/g, ' ').split(/\s+OR\s+/).some((alt) => alt.split(/\s+AND\s+/).every((l) => ALLOWED.test(l.trim())));
        const excepted = BUILD_ONLY.find(([re]) => re.test(name));
        if (excepted && ok === false) { exceptions.push(`${name}: "${license}" — ${excepted[1]}`); continue; }
        if (!license || license === 'Unknown' || /NOASSERTION|UNLICENSED/i.test(license) || !ok) problems.push(`licence "${license}": ${name}@${(p.versions ?? [p.version]).join(',')}`);
    }
}
if (problems.length) {
    console.error(problems.join('\n'));
    process.exit(1);
}
if (exceptions.length) console.log(`build-only exceptions:\n  ${exceptions.join('\n  ')}`);
console.log(`licences: ${count} packages ok`);
