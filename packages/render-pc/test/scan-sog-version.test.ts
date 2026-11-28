// Lane n-scan (the owner's wish 5 of 2026-11-20: "the scan a39abad1 does not open; make every scan like it open").
// SuperSplat publishes SOG version 3 since 2026-11-10; engine 2.23.2 read 1 and 2 only and never settled on a 3: the
// pilot saw "Downloading the scan 0.0 MB" for ever (C:/dev/.gsfpv-lanes/designs/t7-scene-open.md). The renderer checks a
// SOG meta.json's version against ENGINE_SOG_VERSIONS before it hands the file to the engine. The recorded headers of real
// scans are packages/scenes/test/fixtures/superspl-kinds.json (no network). The control is the engine's own SOG parser
// (framework/parsers/sog.js loadTextures, loaded by path): the list and the pinned engine must agree, so the day the engine
// pin or SuperSplat's version moves, this test says so.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ENGINE_SOG_VERSIONS, lodChunkVersionProblem, sogVersion, sogVersionProblem, UnsupportedFormatError } from '../src/lod';

interface Kind { id: string; kind: string; meta?: Record<string, unknown>; chunkMeta?: Record<string, unknown> }
const KINDS = (JSON.parse(readFileSync(new URL('../../scenes/test/fixtures/superspl-kinds.json', import.meta.url), 'utf8')) as { kinds: Kind[] }).kinds;
const byId = (id: string): Kind => {
    const k = KINDS.find((x) => x.id === id);
    if (!k) throw new Error(`no fixture for ${id}`);
    return k;
};

describe('the SOG version check (n-scan)', () => {
    it('reads the owner\'s scan a39abad1 (SOG version 3, splat-transform 3.11.2) as a version the engine opens', () => {
        const meta = byId('a39abad1').meta;
        expect(sogVersion(meta)).toBe(3);
        expect(sogVersionProblem(meta)).toBeNull();
    });

    it('reads every recorded single SOG and every streamed chunk as a version the engine opens', () => {
        const metas = KINDS.flatMap((k) => [k.meta, k.chunkMeta]).filter((m): m is Record<string, unknown> => !!m);
        expect(metas.length).toBeGreaterThanOrEqual(4);
        for (const m of metas) expect(sogVersionProblem(m)).toBeNull();
    });

    it('takes a meta.json without a version as version 1 (the oldest SOG, `means.shape`)', () => {
        expect(sogVersion({ means: { shape: [100, 3] } })).toBe(1);
        expect(sogVersionProblem({ means: { shape: [100, 3] } })).toBeNull();
    });

    it('names a version the engine cannot read, and a version that is not a number', () => {
        expect(sogVersionProblem({ ...byId('a39abad1').meta, version: 4 })).toBe('SOG version 4');
        expect(sogVersionProblem({ version: '3' })).toBe('SOG version "3"');
        const e = new UnsupportedFormatError('SOG version 4', 'meta.json: SOG version 4');
        expect(e.format).toBe('SOG version 4');
        expect(e.name).toBe('UnsupportedFormatError');
    });

    it('a streamed scan: reads the first chunk next to lod-meta.json and checks its SOG version (f924b0f5, chunks v3)', async () => {
        const k = byId('f924b0f5') as Kind & { lodMeta: Record<string, unknown> };
        const lodUrl = 'https://d28zzqy0iyovbz.cloudfront.net/f924b0f5/v1/lod-meta.json';
        const asked: string[] = [];
        const get = (chunk: unknown) => async (u: string): Promise<unknown> => { asked.push(u); return chunk; };
        expect(await lodChunkVersionProblem(lodUrl, k.lodMeta, get(k.chunkMeta))).toBeNull();
        expect(asked).toEqual(['https://d28zzqy0iyovbz.cloudfront.net/f924b0f5/v1/0_0/meta.json']);
        expect(await lodChunkVersionProblem(lodUrl, k.lodMeta, get({ ...k.chunkMeta, version: 4 }))).toBe('SOG version 4');
        // a chunk that cannot be read is the network's matter, not a format: the engine's own request decides
        expect(await lodChunkVersionProblem(lodUrl, k.lodMeta, async () => { throw new Error('offline'); })).toBeNull();
        expect(await lodChunkVersionProblem(lodUrl, { lodLevels: 1 }, get(k.chunkMeta))).toBeNull();
    });
});

/** The engine's SOG parser (not exported by the package: loaded by path, like lod.test.ts loads the octree resource). */
type Parser = { loadTextures(url: { load: string; original: string }, cb: (err: unknown) => void, asset: unknown, meta: unknown): Promise<void> };
let makeParser: () => { parser: Parser; added: () => number };
beforeAll(async () => {
    const main = createRequire(import.meta.url).resolve('playcanvas');
    const file = join(dirname(main), 'playcanvas', 'src', 'framework', 'parsers', 'sog.js');
    const { SogParser } = (await import(pathToFileURL(file).href)) as { SogParser: new (app: unknown) => Parser };
    (globalThis as { window?: unknown }).window ??= { location: { href: 'https://cdn.example/' }, document: { baseURI: 'https://cdn.example/' } };
    makeParser = () => {
        let n = 0;
        const app = { graphicsDevice: {}, scene: {}, assets: { add: () => { n++; }, load: () => {}, get: () => null, remove: () => {}, _loader: { clearCache: () => {} } } };
        return { parser: new SogParser(app), added: () => n };
    };
});

/** What the engine does with a meta.json of this version: asks for its textures, or calls back with an error. */
async function engineReads(version: number): Promise<boolean> {
    const { parser, added } = makeParser();
    const errors: unknown[] = [];
    const asset = { options: {}, once: () => {}, on: () => {}, fire: () => {} };
    void parser.loadTextures({ load: 'https://cdn.example/x/v1/meta.json', original: 'meta.json' }, (err) => { if (err) errors.push(err); }, asset, { ...byId('a39abad1').meta, version }).catch((e: unknown) => errors.push(e));
    await new Promise((r) => setTimeout(r, 0));
    return errors.length === 0 && added() > 0;
}

describe('the pinned engine and ENGINE_SOG_VERSIONS agree (control: playcanvas sog.js)', () => {
    it('the engine asks for the textures of every listed version above 1, and refuses the next ones', async () => {
        for (const v of [2, 3, 4, 5]) expect(await engineReads(v), `SOG version ${v}`).toBe(ENGINE_SOG_VERSIONS.includes(v));
    });

    it('the engine reads the owner\'s scan a39abad1 (version 3)', async () => {
        expect(await engineReads(3)).toBe(true);
    });
});
