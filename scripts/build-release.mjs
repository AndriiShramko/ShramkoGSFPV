// Assemble one static release from the landing (Next export) and the simulator (Vite build):
//   dist/                 site out/ + /fly/assets + /{locale}/fly/index.html (lang per copy)
//   dist.tgz, SHA256SUMS  what goes to the hub (built here or in CI, never on the server)
// Usage: node scripts/build-release.mjs [--skip-build]
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const DIST = join(ROOT, 'dist');
const LOCALES = ['en', 'es', 'pl', 'ru'];
const skip = process.argv.includes('--skip-build');
// GA4 property "ShramkoGSFPV" (public Measurement ID, not a secret). The site loads it only after
// the visitor accepts analytics cookies; override with NEXT_PUBLIC_GA_ID= (empty) to build without GA.
process.env.NEXT_PUBLIC_GA_ID ??= 'G-E7X0ES0QBE';

const run = (cmd, cwd = ROOT) => execSync(cmd, { cwd, stdio: 'inherit', env: process.env });

if (!skip) {
    run('pnpm --filter @gsfpv/site build');
    run('pnpm --filter @gsfpv/fly build');
}
const siteOut = join(ROOT, 'apps', 'site', 'out');
const flyOut = join(ROOT, 'apps', 'fly', 'dist');
if (!existsSync(siteOut) || !existsSync(flyOut)) throw new Error('missing build output (apps/site/out or apps/fly/dist)');

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });
cpSync(siteOut, DIST, { recursive: true });
// simulator: assets and data under /fly/, the HTML shell under every locale
mkdirSync(join(DIST, 'fly'), { recursive: true });
for (const name of readdirSync(flyOut)) {
    if (name === 'index.html') continue;
    cpSync(join(flyOut, name), join(DIST, 'fly', name), { recursive: true });
}
const flyHtml = readFileSync(join(flyOut, 'index.html'), 'utf8');
for (const l of LOCALES) {
    mkdirSync(join(DIST, l, 'fly'), { recursive: true });
    writeFileSync(join(DIST, l, 'fly', 'index.html'), flyHtml.replace('<html lang="en">', `<html lang="${l}">`));
}
// the simulator must never ship source maps or lab pages
for (const f of walk(join(DIST, 'fly'))) {
    if (f.endsWith('.map')) rmSync(f);
}
if (existsSync(join(DIST, 'fly', 'lab'))) rmSync(join(DIST, 'fly', 'lab'), { recursive: true, force: true });

// pre-compressed copies for gzip_static
const GZ = /\.(html|js|css|json|txt|xml|svg|wasm|mjs)$/;
let gz = 0;
for (const f of walk(DIST)) {
    if (GZ.test(f) && statSync(f).size > 1024) {
        writeFileSync(`${f}.gz`, gzipSync(readFileSync(f), { level: 9 }));
        gz++;
    }
}

// sanity checks that must never ship. Words are searched in what a person can see: scripts
// dropped, attribute NAMES dropped (an <input placeholder="..."> is fine, its value is checked)
const FORBIDDEN = /\b(undefined|TODO|PLACEHOLDER)\b|[Ll]orem ipsum/; // case matters: Spanish "todo" is a word
const visible = (html) => html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/\s[a-zA-Z_:][-a-zA-Z0-9_:.]*=/g, ' ');
const bad = [];
for (const f of walk(DIST)) {
    if (!/\.(html|js|txt|xml|json)$/.test(f)) continue;
    const s = readFileSync(f, 'utf8');
    if (f.endsWith('.html') && FORBIDDEN.test(visible(s))) bad.push(`placeholder text: ${f}: ${visible(s).match(FORBIDDEN)?.[0]}`);
    if (/(ghp_|gho_|github_pat_)[A-Za-z0-9]{20,}|BEGIN [A-Z ]*PRIVATE KEY|bot\d{8,}:[A-Za-z0-9_-]{30,}/.test(s)) bad.push(`secret-like string: ${f}`);
    if (f.endsWith('.html') && /[?&](lat|simradio|lagFrames)=/.test(s)) bad.push(`test switch linked: ${f}`);
}
if (bad.length) {
    console.error(bad.join('\n'));
    process.exit(1);
}

const sha = (() => { try { return execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim(); } catch { return 'nogit'; } })();
writeFileSync(join(DIST, 'release.json'), JSON.stringify({ sha, built: new Date().toISOString() }) + '\n');
run(`tar czf dist.tgz -C dist .`);
const h = createHash('sha256').update(readFileSync(join(ROOT, 'dist.tgz'))).digest('hex');
writeFileSync(join(ROOT, 'SHA256SUMS'), `${h}  dist.tgz\n`);
console.log(JSON.stringify({ dist: DIST, files: walk(DIST).length, gzipped: gz, sha, sha256: h, bytes: statSync(join(ROOT, 'dist.tgz')).size }));

function walk(dir, out = []) {
    for (const n of readdirSync(dir)) {
        const p = join(dir, n);
        if (statSync(p).isDirectory()) walk(p, out); else out.push(p);
    }
    return out;
}
