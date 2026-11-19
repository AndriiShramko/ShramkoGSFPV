// The face tracker's files (lane head4; list: src/sonic/head/assets.ts) under /fly/headtrack/: the wasm runtime copied from
// the pinned npm package @mediapipe/tasks-vision, the model downloaded once from Google's model store into
// node_modules/.cache/gsfpv-headtrack and checked by its sha256. Every file is checked by size and hash before it is served
// or written into the build: a changed file stops the build with what to do.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';
import { HEAD_ASSETS, HEAD_ASSET_DIR } from './src/sonic/head/assets';
import type { HeadAsset } from './src/sonic/head/assets';

const NPM_PACKAGE = '@mediapipe/tasks-vision/';
const CACHE_DIR = resolve(__dirname, '../../node_modules/.cache/gsfpv-headtrack');

function checked(a: HeadAsset, bytes: Buffer, where: string): Buffer {
    const sha = createHash('sha256').update(bytes).digest('hex');
    if (bytes.length !== a.bytes || sha !== a.sha256) {
        throw new Error(
            `head tracking: ${a.name} from ${where} is ${bytes.length} bytes, sha256 ${sha}; assets.ts pins ${a.bytes} bytes, ${a.sha256}. ` +
                'A new MediaPipe version or model: measure it again, then change assets.ts.'
        );
    }
    return bytes;
}

async function load(a: HeadAsset): Promise<Buffer> {
    if ('npm' in a.from) {
        const file = resolve(__dirname, 'node_modules', NPM_PACKAGE, a.from.npm.slice(NPM_PACKAGE.length));
        return checked(a, readFileSync(file), file);
    }
    const cached = resolve(CACHE_DIR, a.name);
    if (existsSync(cached)) return checked(a, readFileSync(cached), cached);
    const res = await fetch(a.from.url);
    if (!res.ok) throw new Error(`head tracking: ${a.from.url} answered ${res.status}; the build needs it once (then it is cached in ${CACHE_DIR}).`);
    const bytes = checked(a, Buffer.from(await res.arrayBuffer()), a.from.url);
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(cached, bytes);
    return bytes;
}

const TYPES: Record<string, string> = { '.js': 'text/javascript', '.wasm': 'application/wasm', '.task': 'application/octet-stream' };

export function headTrackAssets(): Plugin {
    let base = '/';
    return {
        name: 'gsfpv-headtrack-assets',
        configResolved(c) {
            base = c.base;
        },
        configureServer(server) {
            server.middlewares.use((req, res, next) => {
                const path = (req.url ?? '').split('?')[0] ?? '';
                const a = HEAD_ASSETS.find((x) => path === base + HEAD_ASSET_DIR + x.name);
                if (!a) return next();
                load(a).then(
                    (bytes) => {
                        res.setHeader('Content-Type', TYPES[a.name.slice(a.name.lastIndexOf('.'))] ?? 'application/octet-stream');
                        res.end(bytes);
                    },
                    (e: unknown) => next(e)
                );
            });
        },
        async generateBundle() {
            for (const a of HEAD_ASSETS) this.emitFile({ type: 'asset', fileName: HEAD_ASSET_DIR + a.name, source: await load(a) });
        }
    };
}
