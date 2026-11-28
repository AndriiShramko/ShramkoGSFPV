import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CDN, SceneError, UNSUPPORTED_FILES, resolveScene } from '../src/index';
import { formatVerdict } from '../src/superspl';

// Every way superspl.at stores a scan (fixtures/superspl-kinds.json: one real public id per kind, the CDN's
// answers recorded read-only on 2026-11-20) goes through resolveScene against those answers: a kind the
// simulator reads resolves to its file, a kind no engine reads is 'unsupported' with the format's name.
// No network: a request outside the recording answers 599 and fails the test.

interface Kind { id: string; kind: string; version: number; cdn: Record<string, number> }
const KINDS = (JSON.parse(readFileSync(new URL('./fixtures/superspl-kinds.json', import.meta.url), 'utf8')) as { kinds: Kind[] }).kinds;
const byId = (id: string): Kind => KINDS.find((k) => k.id === id)!;

/** The CDN as recorded for one scan: settings.json of its version folder, HEAD of the files in `cdn`. */
function recorded(k: Kind) {
    const asked: string[] = [];
    const unrecorded: string[] = [];
    const f = async (url: string, init?: RequestInit): Promise<Response> => {
        asked.push(url);
        const [id, dir, file] = url.slice(CDN.length + 1).split('/');
        const v = Number(/^v(\d+)$/.exec(dir)?.[1]);
        if (id !== k.id || !v) {
            unrecorded.push(url);
            return new Response('', { status: 599 });
        }
        if (file === 'settings.json' && init?.method !== 'HEAD') {
            return v === k.version ? new Response('{"camera":{}}', { status: 200, headers: { 'content-type': 'application/json' } }) : new Response('', { status: 403 });
        }
        // walls are not part of a storage kind: the CDN of these scans has none
        if (file === 'scene.voxel.json') return new Response(null, { status: 403 });
        const status = v === k.version ? k.cdn[file] : 403;
        if (status === undefined) {
            unrecorded.push(url);
            return new Response('', { status: 599 });
        }
        return new Response(null, { status });
    };
    return { f, asked, unrecorded };
}

const OPENS: Record<string, { kind: 'meta' | 'lod-meta' | 'ply'; file: string }> = {
    'sog-v3': { kind: 'meta', file: 'meta.json' },
    'sog-v2': { kind: 'meta', file: 'meta.json' },
    'sog-v2-heavy': { kind: 'meta', file: 'meta.json' },
    'streamed-sog-v3': { kind: 'lod-meta', file: 'lod-meta.json' },
    'streamed-sog-v2': { kind: 'lod-meta', file: 'lod-meta.json' },
    'streamed-sog-v2-huge': { kind: 'lod-meta', file: 'lod-meta.json' },
    'compressed-ply': { kind: 'ply', file: 'scene.compressed.ply' },
    'compressed-ply-large': { kind: 'ply', file: 'scene.compressed.ply' }
};

describe('every storage kind of superspl.at (recorded CDN answers)', () => {
    it('the fixture names one real id for each kind the plan lists, a39abad1 first', () => {
        expect(KINDS[0].id).toBe('a39abad1');
        const kinds = new Set(KINDS.map((k) => k.kind));
        for (const k of [...Object.keys(OPENS), 'gsaf']) expect(kinds.has(k), k).toBe(true);
        for (const k of KINDS) expect(k.id).toMatch(/^[0-9a-f]{8}$/);
    });

    it.each(KINDS.filter((k) => OPENS[k.kind]).map((k) => [k.id, k.kind, k] as const))('%s (%s) resolves to the file the engine opens', async (_id, kind, k) => {
        const c = recorded(k);
        const s = await resolveScene(k.id, c.f);
        expect(c.unrecorded).toEqual([]);
        expect(s.contentKind).toBe(OPENS[kind].kind);
        expect(s.contentUrl).toBe(`${CDN}/${k.id}/v${k.version}/${OPENS[kind].file}`);
        expect(s.content).toEqual([{ url: s.contentUrl, kind: OPENS[kind].kind, verified: true }]);
    });

    it('a compressed PLY (a5d25fb4, c67edb74) opens, it is not refused', async () => {
        for (const id of ['a5d25fb4', 'c67edb74']) {
            const c = recorded(byId(id));
            const s = await resolveScene(id, c.f);
            expect(s.contentKind).toBe('ply');
        }
    });

    it('GSAF (5012e205) is "unsupported" and names GSAF, not "does not exist"', async () => {
        const c = recorded(byId('5012e205'));
        const e = (await resolveScene('5012e205', c.f).catch((x: unknown) => x)) as SceneError;
        expect(c.unrecorded).toEqual([]);
        expect(e).toBeInstanceOf(SceneError);
        expect(e.code).toBe('unsupported');
        expect(e.message).toMatch(/GSAF/);
        expect(UNSUPPORTED_FILES.map((u) => u.file)).toContain('scene.gsaf');
    });

    it('a folder with nothing at all is still not-found (control)', async () => {
        const empty: Kind = { id: '0e0e0e0e', kind: 'none', version: 1, cdn: { 'settings.json': 200, 'lod-meta.json': 403, 'meta.json': 403, 'scene.compressed.ply': 403, 'scene.gsaf': 403 } };
        const e = (await resolveScene(empty.id, recorded(empty).f).catch((x: unknown) => x)) as SceneError;
        expect(e.code).toBe('not-found');
    });

    it('a silent CDN about scene.gsaf is a network problem, not not-found', async () => {
        const k: Kind = { ...byId('5012e205'), cdn: { ...byId('5012e205').cdn, 'scene.gsaf': 503 } };
        const e = (await resolveScene(k.id, recorded(k).f).catch((x: unknown) => x)) as SceneError;
        expect(e.code).toBe('network');
    });

    it('the API formats: sog kinds open, compressed.ply is legacy (opens when chosen), gsaf does not open', () => {
        expect(['sog', 'ssog', 'sogs', 'compressed.ply', 'gsaf', ''].map(formatVerdict)).toEqual(['opens', 'opens', 'opens', 'legacy', 'unsupported', 'unknown']);
    });
});
