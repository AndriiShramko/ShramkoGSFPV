// Shared helpers of the Fly by Sound recording harnesses and tests (lane v12-feedback, docs/wip/v12-feedback.md):
// a small release folder served by tools/bench/scripts/serve-csp.mjs, which sends the headers of deploy/nginx.conf
// (the enforced CSP, the Permissions-Policy per location), so a page under test meets the rules of the live site.
// A control is the same page served under the config as it was before v0.12 (firstCutConf).
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url)).replace(/[\\/]$/, '');
export const SERVE_CSP = join(REPO, 'tools', 'bench', 'scripts', 'serve-csp.mjs');
export const NGINX_CONF = join(REPO, 'deploy', 'nginx.conf');

/**
 * deploy/nginx.conf as it was before v0.12 step 1: the microphone off on the simulator page, no media-src in the
 * CSP, no /api/session/ location. A page that needs the microphone or a blob: audio source must fail under this text.
 */
export function firstCutConf(conf: string = readFileSync(NGINX_CONF, 'utf8')): string {
    let cut = conf.replace('camera=(), microphone=(self), geolocation=()', 'camera=(), microphone=(), geolocation=()');
    cut = cut.replace(" media-src 'self' blob:;", '');
    cut = cut.replace(/\n[ \t]*location \^~ \/api\/session\/ \{[\s\S]*?\n {4}\}\n/, '\n');
    return cut;
}

export async function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const s = createServer();
        s.on('error', reject);
        s.listen(0, '127.0.0.1', () => {
            const { port } = s.address() as { port: number };
            s.close(() => resolve(port));
        });
    });
}

export interface Served {
    readonly port: number;
    readonly origin: string;
    stop(): Promise<void>;
}

/** serve-csp.mjs on a free port (or on `fixedPort`, for a run that keeps to a range) for `dist`; resolves when it says it listens. `env`: API_PROXY, NGINX_CONF, ... */
export async function serveDist(dist: string, env: Record<string, string> = {}, fixedPort?: number): Promise<Served> {
    const port = fixedPort ?? (await freePort());
    const child: ChildProcess = spawn(process.execPath, [SERVE_CSP, dist, String(port)], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`serve-csp did not start: ${out}`)), 15000);
        child.stdout?.on('data', (b: Buffer) => {
            out += b.toString();
            if (out.includes('csp server on')) {
                clearTimeout(timer);
                resolve();
            }
        });
        child.stderr?.on('data', (b: Buffer) => { out += b.toString(); });
        child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`serve-csp exited ${code}: ${out}`)); });
    });
    return {
        port,
        origin: `http://127.0.0.1:${port}`,
        stop: () => new Promise<void>((resolve) => { child.removeAllListeners('exit'); child.on('exit', () => resolve()); child.kill(); })
    };
}

/**
 * A release folder of the given files (paths relative to its root, text or bytes). Every .html file gets its line in
 * csp-hashes.conf with 'self' (the pages hold no inline script), so serve-csp sends the ENFORCED policy for it.
 */
export function makeDist(files: Readonly<Record<string, string | Uint8Array>>): string {
    const root = mkdtempSync(join(tmpdir(), 'sonicrec-dist-'));
    const lines: string[] = [];
    for (const [path, content] of Object.entries(files)) {
        const file = join(root, ...path.split('/'));
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, content);
        if (path.endsWith('.html')) {
            lines.push(`"/${path}" "'self'";`);
            if (path.endsWith('/index.html')) lines.push(`"/${path.slice(0, -'index.html'.length)}" "'self'";`);
        }
    }
    writeFileSync(join(root, 'csp-hashes.conf'), `${lines.join('\n')}\n`);
    return root;
}
