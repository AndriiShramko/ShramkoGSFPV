// Dependency licence gate (spec-compliance): only permissive licences in the dependency tree,
// no research-licensed Gaussian splatting code, no unknown licences.
// Reads `pnpm licenses list --json --prod` from stdin or runs it.
import { execSync } from 'node:child_process';

const ALLOWED = /^(OFL-1.1|MIT|Apache-2\.0|BSD-2-Clause|BSD-3-Clause|ISC|0BSD|CC0-1\.0|BlueOak-1\.0\.0|Unlicense|CC-BY-4\.0|Python-2\.0|MPL-2\.0)$/i;
const BANNED_NAMES = /(diff-gaussian-rasterization|sugar|2dgs|gaussian-opacity-fields|rade-gs|mip-splatting|stopthepop)/i;

const raw = execSync('pnpm licenses list --json --prod', { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const data = JSON.parse(raw);
const problems = [];
let count = 0;
for (const [license, pkgs] of Object.entries(data)) {
    for (const p of pkgs) {
        count++;
        const name = p.name ?? p.packageName ?? '?';
        if (BANNED_NAMES.test(name)) problems.push(`banned research package: ${name}`);
        const ok = license.split(/\s+(?:OR|AND)\s+|[()]/).filter(Boolean).some((l) => ALLOWED.test(l.trim()));
        if (!license || license === 'Unknown' || /NOASSERTION|UNLICENSED/i.test(license) || !ok) problems.push(`licence "${license}": ${name}@${(p.versions ?? [p.version]).join(',')}`);
    }
}
if (problems.length) {
    console.error(problems.join('\n'));
    process.exit(1);
}
console.log(`licences: ${count} packages ok`);
