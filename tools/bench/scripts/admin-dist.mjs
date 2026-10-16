// The admin page as a release would carry it, without the landing: builds apps/fly (vite) and lays out what
// scripts/build-release.mjs lays out for it - dist/admin/index.html, dist/fly/<every vite output but index.html
// and admin/>, no source maps - plus an empty csp-hashes.conf (serve-csp.mjs needs the file; the admin page is
// served under nginx.conf's admin CSP, which has no per-page hashes). The bytes of the admin bundle are those of a
// full release (the vite build is the same); only the landing pages are missing.
// Usage: node tools/bench/scripts/admin-dist.mjs [out-dir]     (default .cache/outreach-copy/dist-new)
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '');
const out = process.argv[2] ?? join(ROOT, '.cache', 'outreach-copy', 'dist-new');
const fly = join(ROOT, 'apps', 'fly');
execSync('npx vite build', { cwd: fly, stdio: 'inherit' });
const built = join(fly, 'dist');
if (!existsSync(join(built, 'admin', 'index.html'))) throw new Error('missing apps/fly/dist/admin/index.html');
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'admin'), { recursive: true });
mkdirSync(join(out, 'fly'), { recursive: true });
cpSync(join(built, 'admin', 'index.html'), join(out, 'admin', 'index.html'));
for (const name of readdirSync(built)) if (name !== 'index.html' && name !== 'admin') cpSync(join(built, name), join(out, 'fly', name), { recursive: true });
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
for (const f of walk(join(out, 'fly'))) if (f.endsWith('.map')) rmSync(f);
writeFileSync(join(out, 'csp-hashes.conf'), '');
console.log(`admin dist in ${out}`);
