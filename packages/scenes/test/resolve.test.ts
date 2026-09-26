import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveScene, posterUrl, knownVersion, SceneError, CDN, VERSION_WINDOWS } from '../src/index';
import type { ResolvedScene } from '../src/index';

// Replays the CDN as it really was (fixtures/cdn-layout.json, written by fixtures/record.mjs): the
// status of settings.json for v1..v64 (GET) and of every file the resolver may look for (HEAD). A
// request outside the recording answers 599 and fails the test, so a changed request pattern means
// "record again". A one-byte ranged GET of a file stored with a Content-Encoding fails the way Chrome
// fails it (ERR_CONTENT_DECODING_FAILED); Node's fetch would not, which hid this from the first census.
// Responses are held until the test releases a round, so round trips can be counted.

interface RecordedScene { why: string; settings: number[]; files: Record<string, number>; encoded: string[]; bodies: Record<string, unknown> }
const LAYOUT = JSON.parse(readFileSync(new URL('./fixtures/cdn-layout.json', import.meta.url), 'utf8')) as { cdn: string; scenes: Record<string, RecordedScene> };

type Fault = number | 'drop';
type How = 'get' | 'head' | 'range';

function cdn(faults: Record<string, Fault[]> = {}) {
    const seen: string[] = [];
    const unrecorded: string[] = [];
    let held: Array<() => void> = [];
    const answer = (url: string, how: How): Response | 'decode-error' => {
        const [id, dir, file, extra] = url.startsWith(`${CDN}/`) ? url.slice(CDN.length + 1).split('/') : [];
        const sc = LAYOUT.scenes[id];
        const v = /^v(\d+)$/.exec(dir ?? '')?.[1];
        const key = `${dir}/${file}`;
        let status: number | undefined;
        if (sc && v && !extra) status = file === 'settings.json' && how === 'get' ? sc.settings[Number(v) - 1] : how !== 'get' ? sc.files[key] : undefined;
        if (status === undefined) {
            unrecorded.push(url);
            return new Response('', { status: 599 });
        }
        if (status !== 200) return new Response('<Error><Code>AccessDenied</Code></Error>', { status });
        if (how === 'head') return new Response(null, { status });
        if (how === 'range') return sc.encoded.includes(key) ? 'decode-error' : new Response('x', { status: 206 });
        return new Response(JSON.stringify(sc.bodies[v!]), { status, headers: { 'content-type': 'application/json' } });
    };
    const f = (url: string, init?: RequestInit): Promise<Response> => {
        seen.push(url);
        const how: How = init?.method === 'HEAD' ? 'head' : (init?.headers as Record<string, string> | undefined)?.Range ? 'range' : 'get';
        const fault = faults[url.slice(CDN.length + 1)]?.shift();
        return new Promise((ok, fail) => held.push(() => {
            if (fault === 'drop') return fail(new TypeError('Failed to fetch'));
            if (typeof fault === 'number') return ok(new Response('', { status: fault }));
            const r = answer(url, how);
            if (r === 'decode-error') fail(new TypeError('Failed to fetch'));
            else ok(r);
        }));
    };
    /** Run a resolve, answering every request made so far once per round. */
    async function run(p: Promise<ResolvedScene>): Promise<{ s?: ResolvedScene; error?: SceneError; rounds: number }> {
        let done = false;
        let s: ResolvedScene | undefined;
        let error: SceneError | undefined;
        p.then((x) => { s = x; }, (e: unknown) => { error = e as SceneError; }).finally(() => { done = true; });
        let rounds = 0;
        for (;;) {
            // let every promise chain settle (setImmediate: a Windows setTimeout(0) waits ~15 ms)
            for (let i = 0; i < 20; i++) await new Promise((ok) => setImmediate(ok));
            if (done) {
                expect(unrecorded, 'requests outside the recording').toEqual([]);
                return { s, error, rounds };
            }
            if (!held.length) throw new Error('resolve is stuck with nothing in flight');
            rounds++;
            const now = held;
            held = [];
            now.forEach((release) => release());
        }
    }
    const settingsAsked = () => seen.filter((u) => u.endsWith('/settings.json')).map((u) => Number(/\/v(\d+)\//.exec(u)![1]));
    return { f, seen, run, settingsAsked };
}

// Expected answers: the version and format the explore API and superspl.at's own viewer name for each
// scene; walls: whether scene.voxel.json exists in that version folder.
const CASES: Array<[id: string, v: number, kind: 'lod-meta' | 'meta', walls: boolean, rounds: number]> = [
    ['39e63ce9', 1, 'lod-meta', true, 1],
    ['7a475d38', 1, 'lod-meta', true, 1],
    ['887f27aa', 1, 'lod-meta', true, 1],
    ['49b32aba', 1, 'meta', false, 1],
    ['cc75cd86', 1, 'lod-meta', false, 1],
    ['ed14f498', 1, 'lod-meta', true, 1],
    ['9d09ab82', 2, 'lod-meta', true, 2],
    ['ddea3bba', 2, 'lod-meta', true, 2],
    ['3994d932', 2, 'meta', false, 2],
    ['f41cc5f3', 5, 'meta', true, 2],
    ['9c1aba09', 5, 'lod-meta', false, 2],
    ['534f5d7d', 10, 'meta', false, 3],
    ['d2d4ae2d', 26, 'meta', false, 4],
    ['cdf3de4b', 28, 'lod-meta', false, 4]
];

describe('resolveScene against the recorded CDN', () => {
    it.each(CASES)('%s -> v%i %s, walls %s, %i round trip(s)', async (id, v, kind, walls, rounds) => {
        const c = cdn();
        const r = await c.run(resolveScene(id, c.f));
        expect(r.error).toBeUndefined();
        const s = r.s!;
        expect(s.version).toBe(v);
        expect(s.contentKind).toBe(kind);
        expect(s.contentUrl).toBe(`${CDN}/${id}/v${v}/${kind}.json`);
        // walls come from the CDN, from the same version folder
        expect(s.collisionUrl).toBe(walls ? `${CDN}/${id}/v${v}/scene.voxel.json` : null);
        expect(s.settings).toEqual(LAYOUT.scenes[id].bodies[String(v)]);
        expect(r.rounds).toBe(rounds);
    });

    it('item 8 had two causes, both in the recording: v1 is gone, and v2 lod-meta.json is gzip-encoded', () => {
        const sc = LAYOUT.scenes['9d09ab82'];
        expect(sc.settings[0]).toBe(403);
        expect(sc.settings[1]).toBe(200);
        expect(Object.entries(sc.files).filter(([k, st]) => k.startsWith('v1/') && st !== 403)).toEqual([]);
        // the old one-byte range check fails on these in Chrome, so even a v1 upload read as "does not exist"
        expect(sc.encoded).toContain('v2/lod-meta.json');
        expect(LAYOUT.scenes.cc75cd86.encoded).toContain('v1/lod-meta.json');
    });

    it('a v1 scene costs one round trip of 8 small requests', async () => {
        const c = cdn();
        await c.run(resolveScene('39e63ce9', c.f));
        expect(c.settingsAsked()).toEqual([1, 2, 3, 4, 5]);
        expect(c.seen.length).toBe(8);
    });

    it('a stale folder below the current one is never chosen', async () => {
        for (const id of ['3994d932', '534f5d7d', '9c1aba09', 'f41cc5f3']) {
            const c = cdn();
            const { s } = await c.run(resolveScene(id, c.f));
            const present = LAYOUT.scenes[id].settings.flatMap((st, i) => (st === 200 ? [i + 1] : []));
            expect(present.length).toBeGreaterThan(1);
            expect(s!.version).toBe(Math.max(...present));
        }
    });

    it('synthetic: the widest real gap (f41cc5f3, v2 -> v5) and one wider, moved across a window edge', async () => {
        // no recorded scene has a stale folder just below a window edge; these two put one there
        const synthetic = (id: string, present: number[]) => {
            const settings = Array.from({ length: 64 }, (_, i) => (present.includes(i + 1) ? 200 : 403));
            const files: Record<string, number> = {};
            for (const v of [1, ...present]) for (const f of ['lod-meta.json', 'meta.json', 'scene.compressed.ply', 'scene.voxel.json']) files[`v${v}/${f}`] = present.includes(v) && f === 'meta.json' ? 200 : 403;
            LAYOUT.scenes[id] = { why: 'synthetic', settings, files, encoded: [], bodies: Object.fromEntries(present.map((v) => [String(v), { version: 2, cameras: [] }])) };
        };
        synthetic('5e000003', [3, 6]);
        synthetic('5e000004', [2, 6]);
        for (const id of ['5e000003', '5e000004']) {
            const c = cdn();
            const { s } = await c.run(resolveScene(id, c.f));
            expect(s!.version).toBe(6);
        }
    });

    it('a scene that is not there is not-found after asking each version once', async () => {
        const c = cdn();
        const { error } = await c.run(resolveScene('00000000', c.f));
        expect(error).toBeInstanceOf(SceneError);
        expect(error!.code).toBe('not-found');
        const last = VERSION_WINDOWS[VERSION_WINDOWS.length - 1][1];
        expect(c.settingsAsked().sort((a, b) => a - b)).toEqual(Array.from({ length: last }, (_, i) => i + 1));
    });

    it.each(['8830149e', '528c3eea'])('legacy compressed PLY %s is "unsupported", not "does not exist"', async (id) => {
        const c = cdn();
        const { error } = await c.run(resolveScene(id, c.f));
        expect(error!.code).toBe('unsupported');
        expect(error!.message).toMatch(/compressed PLY/);
    });

    it('invalid ids and taken-down scenes are refused before any request', async () => {
        const c = cdn();
        expect(((await resolveScene('not-an-id', c.f).catch((x: unknown) => x)) as SceneError).code).toBe('invalid-link');
        expect(((await resolveScene('39e63ce9', c.f, ['39e63ce9']).catch((x: unknown) => x)) as SceneError).code).toBe('blocked');
        expect(c.seen.length).toBe(0);
    });
});

describe('resolveScene when requests fail (faults injected into the recording)', () => {
    it('one dropped request is retried: item 8 still resolves to v2', async () => {
        const c = cdn({ '9d09ab82/v2/settings.json': ['drop'], '9d09ab82/v2/lod-meta.json': [503] });
        const { s } = await c.run(resolveScene('9d09ab82', c.f));
        expect(s!.version).toBe(2);
        expect(s!.contentKind).toBe('lod-meta');
    });

    it('a version that could not be ruled out makes a missing scene a network error', async () => {
        const c = cdn({ '00000000/v3/settings.json': [503, 503] });
        const { error } = await c.run(resolveScene('00000000', c.f));
        expect(error!.code).toBe('network');
    });

    it('offline is a network error', async () => {
        const f = async (): Promise<Response> => { throw new TypeError('Failed to fetch'); };
        const e = (await resolveScene('39e63ce9', f).catch((x: unknown) => x)) as SceneError;
        expect(e.code).toBe('network');
    });

    it('a format lookup that never answers is a network error, not "no content"', async () => {
        const c = cdn({ '39e63ce9/v1/lod-meta.json': ['drop', 'drop'] });
        const { error } = await c.run(resolveScene('39e63ce9', c.f));
        expect(error!.code).toBe('network');
    });

    it('a walls lookup that never answers still offers the walls: the walls loader reads a 403 as none', async () => {
        const c = cdn({ '3994d932/v2/scene.voxel.json': [500, 500] });
        const { s } = await c.run(resolveScene('3994d932', c.f));
        expect(s!.collisionUrl).toBe(`${CDN}/3994d932/v2/scene.voxel.json`);
    });

    it('trade-off: with a stale v1 AND v2 silent twice, the older edit opens instead of an error', async () => {
        const c = cdn({ '3994d932/v2/settings.json': ['drop', 'drop'] });
        const { s } = await c.run(resolveScene('3994d932', c.f));
        expect(s!.version).toBe(1);
    });
});

describe('posters follow the version folder', () => {
    afterEach(() => { vi.unstubAllGlobals(); });

    function fakeStorage() {
        const m = new Map<string, string>();
        return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); }, m };
    }

    it('without browser storage everything is v1 and nothing throws', async () => {
        vi.stubGlobal('localStorage', undefined);
        expect(posterUrl('9d09ab82')).toMatch(/\/9d09ab82\/v1\/m\.webp$/);
        const c = cdn();
        const { s } = await c.run(resolveScene('9d09ab82', c.f));
        expect(s!.version).toBe(2);
    });

    it('a resolved republished scene keeps its poster folder; v1 scenes add nothing', async () => {
        const st = fakeStorage();
        vi.stubGlobal('localStorage', st);
        const c = cdn();
        await c.run(resolveScene('39e63ce9', c.f));
        expect(st.m.size).toBe(0);
        await c.run(resolveScene('9d09ab82', c.f));
        expect(knownVersion('9d09ab82')).toBe(2);
        expect(posterUrl('9d09ab82', 'xl')).toBe('https://s3-eu-west-1.amazonaws.com/images.playcanvas.com/splat/9d09ab82/v2/xl.webp');
        expect(posterUrl('39e63ce9')).toBe('https://s3-eu-west-1.amazonaws.com/images.playcanvas.com/splat/39e63ce9/v1/m.webp');
    });

    it('a broken stored value falls back to v1', () => {
        const st = fakeStorage();
        st.setItem('gsfpv.versions.v1', '{"not":"a list"}');
        vi.stubGlobal('localStorage', st);
        expect(knownVersion('9d09ab82')).toBe(1);
    });
});
