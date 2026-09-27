// The bake reads scene files whole (bake.ts wholeFileSystem): found on the live C acceptance
// (2026-09-27) — bd04e182 serves lod-meta.json brotli-encoded, splat-transform's Range reads got
// encoded fragments and the bake failed with "Expected property name ... at position 1".
import { describe, expect, it } from 'vitest';
// tools/bench does not depend on splat-transform; the app does (same package the bake uses)
import * as st from '../../../apps/fly/node_modules/@playcanvas/splat-transform';
import { wholeFileSystem } from '../../../apps/fly/src/bake';

/** A server that, like CloudFront with a compressed object, answers a Range request with bytes the
 *  page cannot use as JSON (here: the first encoded byte), and a plain GET with the decoded file. */
function server(body: string) {
    const seen: { url: string; range: string | null }[] = [];
    const f = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const range = new Headers(init?.headers).get('Range');
        seen.push({ url: String(url), range });
        if (range) return new Response('\x1b', { status: 206, headers: { 'Content-Range': `bytes 0-0/${body.length}` } });
        return new Response(body, { status: 200 });
    };
    return { f, seen };
}

async function readAll(fs: st.ReadFileSystem, name: string): Promise<string> {
    const src = await fs.createSource(name);
    const bytes = await src.read().readAll();
    src.close();
    return new TextDecoder().decode(bytes);
}

describe('bake file reads', () => {
    it('reads each file with one plain GET and returns the decoded bytes', async () => {
        const body = JSON.stringify({ version: 1, count: 3 });
        const s = server(body);
        const fs = wholeFileSystem(st, 'https://cdn.example/scene/v1/', s.f as typeof fetch);
        const text = await readAll(fs, 'lod-meta.json');
        expect(JSON.parse(text)).toEqual({ version: 1, count: 3 });
        expect(s.seen).toEqual([{ url: 'https://cdn.example/scene/v1/lod-meta.json', range: null }]);
    });

    it('control: the library\'s URL reader sends a Range probe to the same server', async () => {
        const body = JSON.stringify({ version: 1, count: 3 });
        const s = server(body);
        const orig = globalThis.fetch;
        globalThis.fetch = s.f as typeof fetch;
        try {
            const fs = new st.UrlReadFileSystem('https://cdn.example/scene/v1/');
            await readAll(fs, 'lod-meta.json').catch(() => '');
        } finally {
            globalThis.fetch = orig;
        }
        expect(s.seen.some((x) => x.range === 'bytes=0-0')).toBe(true);
    });
});
