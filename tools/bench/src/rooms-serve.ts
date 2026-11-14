// Train 1, lane rooms (docs/wip/rooms.md, stage R3): the local rig of the two-page probe (rooms-two-page.ts).
// The release build in dist/ (node scripts/build-release.mjs) is served by tools/bench/scripts/serve-csp.mjs (the
// headers of deploy/nginx.conf, the enforced CSP), apps/rooms/rooms.py runs as a child process, and one front server
// on its own port passes everything to serve-csp except /api/rooms, which goes to rooms.py: plain HTTP and the
// WebSocket upgrade (serve-csp has no upgrade path), the way deploy/nginx.conf's two rooms locations do.
// `relay: false` starts rooms.py with --no-relay (a control: poses are taken and never relayed).
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createServer, request as httpRequest } from 'node:http';
import type { IncomingMessage, Server } from 'node:http';
import { connect } from 'node:net';
import type { Socket } from 'node:net';
import { join } from 'node:path';
import { REPO, freePorts, serveDist } from './sonicrec-serve';
import type { Served } from './sonicrec-serve';

export const ROOMS_PY = join(REPO, 'apps', 'rooms', 'rooms.py');

export interface RoomsRig {
    readonly origin: string;
    readonly roomsPort: number;
    /** the lines rooms.py printed (one per request) */
    readonly log: string[];
    stop(): Promise<void>;
}

function waitTcp(port: number, timeoutMs: number): Promise<void> {
    const t0 = Date.now();
    return new Promise((resolve, reject) => {
        const tryOnce = (): void => {
            const s = connect(port, '127.0.0.1');
            s.once('connect', () => { s.destroy(); resolve(); });
            s.once('error', () => {
                s.destroy();
                if (Date.now() - t0 > timeoutMs) reject(new Error(`rooms.py did not listen on ${port}`));
                else setTimeout(tryOnce, 100);
            });
        };
        tryOnce();
    });
}

const isRooms = (url: string | undefined): boolean => /^\/api\/rooms(?:\/|\?|$)/.test(url ?? '');

/** The raw request head of an upgrade, to write to rooms.py as it came. */
function head(req: IncomingMessage): string {
    const lines = [`${req.method} ${req.url} HTTP/1.1`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
    return `${lines.join('\r\n')}\r\n\r\n`;
}

export async function startRoomsRig(dist: string, o: { relay?: boolean; python?: string } = {}): Promise<RoomsRig> {
    // all three ports at once: under SONIC_PORTS a second pick would return the front's port, not bound yet (lane rooms2)
    const [roomsPort, frontPort, distPort] = await freePorts(3);
    const args = ['-X', 'utf8', '-u', ROOMS_PY, '--host', '127.0.0.1', '--port', String(roomsPort)];
    if (o.relay === false) args.push('--no-relay');
    const log: string[] = [];
    const py: ChildProcess = spawn(o.python ?? process.env.PYTHON ?? 'python', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const keep = (b: Buffer): void => { for (const l of b.toString().split(/\r?\n/)) if (l) log.push(l.slice(0, 300)); if (log.length > 400) log.splice(0, log.length - 400); };
    py.stdout?.on('data', keep);
    py.stderr?.on('data', keep);
    const killPy = (): void => { if (py.exitCode === null) py.kill(); };
    process.once('exit', killPy);
    let site: Served | null = null;
    let front: Server | null = null;
    try {
        await waitTcp(roomsPort, 10000);
        site = await serveDist(dist, { API_PROXY: `http://127.0.0.1:${roomsPort}` }, distPort);
        const sitePort = site.port;
        const sockets = new Set<Socket>();
        front = createServer((req, res) => {
            const port = isRooms(req.url) ? roomsPort : sitePort;
            const up = httpRequest({ host: '127.0.0.1', port, path: req.url, method: req.method, headers: { ...req.headers, 'x-forwarded-for': '127.0.0.1' } }, (r) => {
                res.writeHead(r.statusCode ?? 502, r.headers);
                r.pipe(res);
            });
            up.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
            req.pipe(up);
        });
        front.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
        front.on('upgrade', (req, sock: Socket, first: Buffer) => {
            if (!isRooms(req.url)) { sock.destroy(); return; }
            const back = connect(roomsPort, '127.0.0.1', () => {
                back.write(head(req));
                if (first.length) back.write(first);
                back.pipe(sock);
                sock.pipe(back);
            });
            sockets.add(back);
            const end = (): void => { back.destroy(); sock.destroy(); sockets.delete(back); };
            back.on('error', end);
            sock.on('error', end);
            back.on('close', end);
            sock.on('close', end);
        });
        await new Promise<void>((resolve, reject) => { front!.once('error', reject); front!.listen(frontPort, '127.0.0.1', () => resolve()); });
        const f = front;
        const s = site;
        return {
            origin: `http://127.0.0.1:${frontPort}`,
            roomsPort,
            log,
            stop: async () => {
                for (const x of sockets) x.destroy();
                await new Promise<void>((resolve) => f.close(() => resolve()));
                await s.stop();
                killPy();
                process.removeListener('exit', killPy);
            }
        };
    } catch (e) {
        front?.close();
        await site?.stop();
        killPy();
        throw e;
    }
}
