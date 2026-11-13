// The local server of the courses' page probe (train 1, lane tracks, T3; tools/bench/src/tracks-page.ts). Models: sonicrec-serve.ts
// (the release folder under nginx's enforced CSP, /api/** proxied the way nginx does) and sonicrec-rig.ts + apps/api/tests/rig_server.py
// (the REAL API handler on a temporary DATA_DIR on this machine). Here the API is server.Handler itself (apps/api/server.py, its
// TrackStore on DATA_DIR/tracks), bound to 127.0.0.1 on a free port; nothing of it leaves this machine and nothing is mailed or posted.
// The release folder is dist/ of this tree (node scripts/build-release.mjs first).
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REPO, serveDist } from './sonicrec-serve';
import type { Served } from './sonicrec-serve';

const API_DIR = join(REPO, 'apps', 'api');

/** The API process: imports server.py with DATA_DIR set, serves its Handler on 127.0.0.1:0, prints {"api": port}, ends when stdin closes. */
const LAUNCH = [
    'import json, os, sys, threading',
    'sys.path.insert(0, sys.argv[1])',
    'import server',
    'from http.server import ThreadingHTTPServer',
    "s = ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)",
    "print(json.dumps({'api': s.server_address[1], 'data': str(server.DATA_DIR)}), flush=True)",
    'threading.Thread(target=lambda: (sys.stdin.read(), os._exit(0)), daemon=True).start()',
    's.serve_forever()'
].join('\n');

export interface TracksServed {
    /** the page's origin (serve-csp.mjs on dist/, /api/** to the API) */
    readonly site: string;
    /** the API's own origin (a test POSTs to it straight, as a client behind nginx would) */
    readonly api: string;
    /** the temporary DATA_DIR */
    readonly data: string;
    stop(): Promise<void>;
}

async function startApi(data: string): Promise<{ port: number; proc: ChildProcess }> {
    const python = process.env.PYTHON ?? 'python';
    // MIN_FREE_GB 0.1: the disk guard stays on but a nearly full temp disk of this machine does not refuse the probe's two saves (an estimate)
    const proc = spawn(python, ['-X', 'utf8', '-c', LAUNCH, API_DIR], {
        env: { ...process.env, DATA_DIR: data, MIN_FREE_GB: '0.1', PYTHONIOENCODING: 'utf-8' },
        stdio: ['pipe', 'pipe', 'pipe']
    });
    let err = '';
    proc.stderr?.on('data', (b: Buffer) => { err += b.toString(); });
    const port: number = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`the API did not start: ${err.slice(-400)}`)), 30000);
        let buf = '';
        proc.stdout?.on('data', (b: Buffer) => {
            buf += b.toString();
            if (buf.includes('\n')) {
                clearTimeout(timer);
                resolve((JSON.parse(buf.split('\n')[0] as string) as { api: number }).api);
            }
        });
        proc.on('exit', (code) => { clearTimeout(timer); reject(new Error(`the API exited ${code}: ${err.slice(-400)}`)); });
    });
    return { port, proc };
}

/** The release build of this tree and a local API on a fresh DATA_DIR. */
export async function serveTracks(dist = join(REPO, 'dist')): Promise<TracksServed> {
    if (!existsSync(join(dist, 'release.json'))) throw new Error(`no release build in ${dist}: node scripts/build-release.mjs first`);
    const data = mkdtempSync(join(tmpdir(), 'gsfpv-tracks-data-'));
    const api = await startApi(data);
    let site: Served;
    try {
        site = await serveDist(dist, { API_PROXY: `http://127.0.0.1:${api.port}` });
    } catch (e) {
        api.proc.kill();
        throw e;
    }
    return {
        site: site.origin,
        api: `http://127.0.0.1:${api.port}`,
        data,
        async stop() {
            await site.stop();
            api.proc.stdin?.end();
            await new Promise<void>((resolve) => {
                api.proc.once('exit', () => resolve());
                setTimeout(resolve, 5000);
            });
            api.proc.kill();
        }
    };
}
