import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
    SuperSplatCatalog, SuperSplatError, MemoryStore, normalizeQuery, exploreQueryString, cleanSearch, supersplSearchUrl,
    pickRandomTopRated, CATALOG_TTL_MS, UNSUPPORTED_FORMATS, formatVerdict
} from '../src/index';
import type { CatalogStore, ExploreItem, ExploreQuery } from '../src/index';

// Every check has a negative control that must fire (J.0). The proxy is faked here with its documented
// answer shape (apps/api/server.py, tested in apps/api/tests); one test runs the real Python whitelist
// on what this client sends.

const S3 = 'https://s3-eu-west-1.amazonaws.com/images.playcanvas.com/splat';

/** One scene as the proxy returns it. */
function wire(i: number, over: Record<string, unknown> = {}): Record<string, unknown> {
    const id = i.toString(16).padStart(8, '0');
    return {
        id, version: 1, title: `Scene ${i}`, author: `user${i}`, likes: 1000 - i, views: 50000 - i, sizeBytes: 1e8 + i,
        thumbs: { s: `${S3}/${id}/v1/s.webp`, m: `${S3}/${id}/v1/m.webp`, l: `${S3}/${id}/v1/l.webp`, xl: `${S3}/${id}/v1/xl.webp`, mov: `${S3}/${id}/v1/mov.webp` },
        createdAt: '2025-05-08T01:57:48.770Z', license: null, downloadable: false, description: `about ${i}`, format: 'sog', ...over
    };
}

type Answer = Response | Error | Promise<Response>;

/** A fake proxy: records every request, answers from `serve`; `hold` keeps answers until released. */
function proxy(serve: (u: URL) => Answer = pageOf(Array.from({ length: 300 }, (_, i) => wire(i))), hold = false) {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    let open = 0;
    let maxOpen = 0;
    const held: Array<() => void> = [];
    const fetch = (url: string, init?: RequestInit): Promise<Response> => {
        calls.push({ url, init });
        open++;
        maxOpen = Math.max(maxOpen, open);
        return new Promise<Response>((ok, fail) => {
            const go = () => {
                open--;
                const a = serve(new URL(url, 'https://gsfpv.test'));
                if (a instanceof Error) fail(a);
                else void Promise.resolve(a).then(ok, fail);
            };
            if (hold) held.push(go);
            else queueMicrotask(go);
        });
    };
    return { fetch, calls, held, release: () => held.splice(0).forEach((g) => g()), maxOpen: () => maxOpen };
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

/** Pages of a pool the way the proxy pages them. */
function pageOf(pool: Array<Record<string, unknown>>, headers: Record<string, string> = { 'cache-control': 'public, max-age=600', 'x-cache': 'miss' }) {
    return (u: URL): Response => {
        const skip = Number(u.searchParams.get('skip'));
        const limit = Number(u.searchParams.get('limit'));
        return json({ ok: true, query: {}, total: pool.length, fetchedAt: 1790000000, items: pool.slice(skip, skip + limit) }, 200, headers);
    };
}

function clock(t = 1_000_000) {
    const c = { t, now: () => c.t };
    return c;
}

const Q: ExploreQuery = { sort: 'starred', order: -1, features: ['walkable'], skip: 0, limit: 16 };

async function code(p: Promise<unknown>): Promise<string> {
    try {
        await p;
        return 'resolved';
    } catch (e) {
        return e instanceof SuperSplatError ? e.code : `other: ${String(e)}`;
    }
}

describe('query normalisation (mirrors the proxy whitelist)', () => {
    it('fills defaults, forces all-time trending and orders features like the upstream', () => {
        expect(normalizeQuery({})).toEqual({ sort: 'trending', order: -1, time: 'all', features: [], search: '', skip: 0, limit: 32 });
        expect(normalizeQuery({ sort: 'trending', time: 'week' }).time).toBe('all');
        expect(normalizeQuery({ sort: 'views', time: 'week' }).time).toBe('week'); // control
        expect(normalizeQuery({ features: ['downloadable', 'walkable', 'walkable'] }).features).toEqual(['walkable', 'downloadable']);
    });

    it('cleans the search text the way superspl.at does, within 80 code points', () => {
        expect(cleanSearch('  gothic \t\n church  ')).toBe('gothic church');
        expect(cleanSearch('<b>x</b>')).toBe('bx/b');
        expect(cleanSearch('a')).toBe(''); // one letter is no search
        expect(cleanSearch('ab')).toBe('ab'); // control
        expect(cleanSearch('a\u0000b\u0085c')).toBe('a b c');
        expect(cleanSearch('x\ud800y')).toBe('x y'); // a lone surrogate would make encodeURIComponent throw
        const emoji = '\u{1F681}'.repeat(100); // 2 UTF-16 units each
        expect(Array.from(cleanSearch(emoji))).toHaveLength(80);
        expect(() => encodeURIComponent(cleanSearch('x'.repeat(79) + emoji))).not.toThrow(); // never half a pair
        expect(Array.from(cleanSearch('y'.repeat(200)))).toHaveLength(80);
    });

    it('refuses what the proxy would refuse; the edges pass', () => {
        const bad: Array<Partial<ExploreQuery> | Record<string, unknown>> = [
            { sort: 'likes' }, { order: 0 }, { time: 'hour' }, { features: ['indoor'] }, { skip: -1 }, { skip: 10001 }, { skip: 1.5 },
            { limit: 0 }, { limit: 49 }, { limit: Number.NaN }
        ];
        for (const q of bad) expect(() => normalizeQuery(q as Partial<ExploreQuery>), JSON.stringify(q)).toThrow(SuperSplatError);
        for (const q of [{ skip: 0 }, { skip: 10000 }, { limit: 1 }, { limit: 48 }, { sort: 'size' as const, order: 1 as const, time: 'day' as const }]) {
            expect(() => normalizeQuery(q)).not.toThrow(); // control
        }
    });

    it('builds one canonical query string per page', () => {
        const a = exploreQueryString(normalizeQuery({ ...Q, search: ' gothic  church ', features: ['downloadable', 'walkable'] }));
        expect(a).toBe('sort=starred&order=-1&time=all&features=walkable%2Cdownloadable&search=gothic+church&skip=0&limit=16');
        expect(exploreQueryString(normalizeQuery({ ...Q, features: ['walkable', 'downloadable'], search: 'gothic church' }))).toBe(a);
        expect(exploreQueryString(normalizeQuery({ ...Q, skip: 16 }))).not.toBe(exploreQueryString(normalizeQuery(Q))); // control
    });

    // python3 on Linux CI, python on Windows (where python3 may be the store's stub)
    const py = ['python3', 'python'].find((c) => spawnSync(c, ['--version']).status === 0);
    it.skipIf(!py)('every query string this client sends passes the real proxy whitelist unchanged', () => {
        const queries: Partial<ExploreQuery>[] = [
            {}, Q, { sort: 'trending', time: 'week' }, { sort: 'size', order: 1, time: 'day', features: ['downloadable'], skip: 10000, limit: 48 },
            { search: 'gothic church' }, { search: '  <x>  y%z&sort=views  ' }, { search: '\u{1F681}'.repeat(90) }, { search: 'za\u017c\u00f3\u0142\u0107 g\u0119\u015bl\u0105 ja\u017a\u0144' },
            { search: 'a\u0000b\u2028c\u00a0d\ufeffe' }, { search: 'x'.repeat(200) }
        ];
        const sent = queries.map((q) => ({ qs: exploreQueryString(normalizeQuery(q)), search: normalizeQuery(q).search }));
        const api = fileURLToPath(new URL('../../../apps/api', import.meta.url));
        const script = [
            'import json, sys', `sys.path.insert(0, ${JSON.stringify(api)})`, 'import server',
            'out = []',
            'for c in json.load(sys.stdin):',
            '    try:',
            '        q = server.parse_explore_query(c["qs"]); out.append({"ok": True, "search": q["search"]})',
            '    except server.BadParam as e:',
            '        out.append({"ok": False, "param": e.param})',
            'print(json.dumps(out))'
        ].join('\n');
        const control = { qs: 'sort=likes&order=-1', search: '' };
        const r = spawnSync(py!, ['-c', script], { input: JSON.stringify([...sent, control]), encoding: 'utf8' });
        expect(r.stderr).toBe('');
        const got = JSON.parse(r.stdout) as Array<{ ok: boolean; search?: string; param?: string }>;
        expect(got.slice(0, -1)).toEqual(sent.map((s) => ({ ok: true, search: s.search })));
        expect(got.at(-1)).toEqual({ ok: false, param: 'sort' }); // control: the harness does see a refusal
    });
});

describe('SuperSplatCatalog.explore', () => {
    it('asks our proxy (never PlayCanvas) without cookies and maps the items', async () => {
        const p = proxy();
        const cat = new SuperSplatCatalog({ fetch: p.fetch });
        const page = await cat.explore(Q);
        expect(p.calls.map((c) => c.url)).toEqual(['/api/superspl/explore?sort=starred&order=-1&time=all&features=walkable&skip=0&limit=16']);
        expect(p.calls[0].init?.credentials).toBe('omit');
        expect(page).toMatchObject({ total: 300, fetchedAt: 1790000000000, from: 'network', proxy: 'miss' });
        expect(page.items).toHaveLength(16);
        expect(page.items[0]).toEqual({
            id: '00000000', version: 1, title: 'Scene 0', author: 'user0', license: null, downloadable: false, likes: 1000, views: 50000,
            sizeBytes: 1e8, thumb: `${S3}/00000000/v1/m.webp`, thumbs: wire(0).thumbs, createdAt: '2025-05-08T01:57:48.770Z',
            description: 'about 0', format: 'sog', walkable: true
        });
        const other = await new SuperSplatCatalog({ fetch: proxy().fetch }).explore({ ...Q, features: [] });
        expect(other.items[0].walkable).toBeNull(); // control: not asked for walkable -> unknown
    });

    it('drops malformed items and falls back to the S3 poster pattern', async () => {
        const items = [wire(1, { id: '../x' }), 'junk', wire(2, { version: 3, thumbs: { m: 'https://evil.example/m.webp' } })];
        const cat = new SuperSplatCatalog({ fetch: proxy(() => json({ ok: true, total: 3, fetchedAt: 1, items })).fetch });
        const page = await cat.explore(Q);
        expect(page.items.map((x) => x.id)).toEqual(['00000002']);
        expect(page.items[0].thumbs.m).toBeNull();
        expect(page.items[0].thumb).toBe(`${S3}/00000002/v3/m.webp`);
    });

    it('a page in the tab cache makes no request until it expires', async () => {
        const p = proxy();
        const c = clock();
        const cat = new SuperSplatCatalog({ fetch: p.fetch, now: c.now });
        await cat.explore(Q);
        c.t += CATALOG_TTL_MS - 1;
        const again = await cat.explore({ ...Q, features: ['walkable', 'walkable'], time: 'all' });
        expect(again.from).toBe('session');
        expect(again.items).toHaveLength(16);
        expect(p.calls).toHaveLength(1);
        c.t += 2; // control: expired -> one request
        expect((await cat.explore(Q)).from).toBe('network');
        expect(p.calls).toHaveLength(2);
    });

    it('the store outlives the catalogue object (a reload in the same tab)', async () => {
        const store = new MemoryStore();
        const p = proxy();
        await new SuperSplatCatalog({ fetch: p.fetch, store }).explore(Q);
        expect((await new SuperSplatCatalog({ fetch: p.fetch, store }).explore(Q)).from).toBe('session');
        expect(p.calls).toHaveLength(1);
        await new SuperSplatCatalog({ fetch: p.fetch, store: new MemoryStore() }).explore(Q); // control: new store
        expect(p.calls).toHaveLength(2);
    });

    it('keeps a page only as long as the proxy says it stays fresh; a stale copy is not kept', async () => {
        const c = clock();
        const short = proxy(pageOf([wire(0)], { 'cache-control': 'public, max-age=30', 'x-cache': 'hit' }));
        const cat = new SuperSplatCatalog({ fetch: short.fetch, now: c.now });
        await cat.explore(Q);
        c.t += 29_000;
        await cat.explore(Q);
        expect(short.calls).toHaveLength(1); // control: still fresh
        c.t += 2_000;
        await cat.explore(Q);
        expect(short.calls).toHaveLength(2);
        const stale = proxy(pageOf([wire(0)], { 'cache-control': 'no-cache', 'x-cache': 'stale' }));
        const cat2 = new SuperSplatCatalog({ fetch: stale.fetch, now: c.now });
        expect((await cat2.explore(Q)).proxy).toBe('stale');
        await cat2.explore(Q);
        expect(stale.calls).toHaveLength(2);
    });

    it('no max-age, no keeping: a hit in its last second is asked again; every request bypasses the HTTP cache (review C8)', async () => {
        const c = clock();
        const last = proxy(pageOf([wire(0)], { 'cache-control': 'no-cache', 'x-cache': 'hit' }));
        const cat = new SuperSplatCatalog({ fetch: last.fetch, now: c.now });
        expect((await cat.explore(Q)).proxy).toBe('hit');
        await cat.explore(Q);
        expect(last.calls).toHaveLength(2);
        // the browser's own cache would replay an answer and its max-age would count twice: never asked of it
        expect(last.calls.map((x) => x.init?.cache)).toEqual(['no-store', 'no-store']);
        const kept = proxy(pageOf([wire(0)], { 'cache-control': 'public, max-age=1', 'x-cache': 'hit' }));
        const cat2 = new SuperSplatCatalog({ fetch: kept.fetch, now: c.now });
        await cat2.explore(Q);
        await cat2.explore(Q);
        expect(kept.calls).toHaveLength(1); // control: the same hit with a max-age is kept
    });

    it('data in the tab is never older than the 10 min of the proxy, whatever the age of its copy (D35, review C8)', async () => {
        // the proxy's header rule (apps/api/server.py _ok): max-age = whole seconds left of its 600, else no-cache
        const proxyHeaders = (ageS: number, cc?: string): Record<string, string> => {
            const fresh = Math.trunc(600 - ageS);
            return { 'cache-control': cc ?? (fresh > 0 ? `public, max-age=${fresh}` : 'no-cache'), 'x-cache': ageS === 0 ? 'miss' : 'hit' };
        };
        /** How old the data is when this tab lets go of it (s): the proxy's copy age plus the time kept here. */
        const oldestShown = async (ageS: number, cc?: string): Promise<number> => {
            const c = clock();
            const exps: number[] = [];
            const store: CatalogStore = {
                getItem: () => null,
                setItem: (k, v) => { if (!k.endsWith('index')) exps.push((JSON.parse(v) as { exp: number }).exp); },
                removeItem: () => undefined
            };
            await new SuperSplatCatalog({ fetch: proxy(pageOf([wire(0)], proxyHeaders(ageS, cc))).fetch, now: c.now, store }).explore(Q);
            return ageS + (exps.length ? (Math.max(...exps) - c.t) / 1000 : 0);
        };
        for (const age of [0, 1, 299.5, 598.9, 599, 599.5, 599.99, 600]) expect(await oldestShown(age), `copy ${age} s old`).toBeLessThanOrEqual(600);
        expect(await oldestShown(300, 'public, max-age=600')).toBe(900); // control: the measure does catch an over-long keep
    });

    it('keeps at most maxStored pages, dropping the oldest', async () => {
        const store = new MemoryStore();
        const p = proxy();
        const cat = new SuperSplatCatalog({ fetch: p.fetch, store, maxStored: 2 });
        for (const skip of [0, 16, 32]) await cat.explore({ ...Q, skip });
        await cat.explore({ ...Q, skip: 16 });
        await cat.explore({ ...Q, skip: 32 });
        expect(p.calls).toHaveLength(3); // control: the two newest are kept
        await cat.explore({ ...Q, skip: 0 });
        expect(p.calls).toHaveLength(4);
        cat.clear();
        await cat.explore({ ...Q, skip: 32 });
        expect(p.calls).toHaveLength(5);
    });

    it('works when the store throws (private mode, quota)', async () => {
        const broken: CatalogStore = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('quota'); }, removeItem: () => { throw new Error('denied'); } };
        const p = proxy();
        const cat = new SuperSplatCatalog({ fetch: p.fetch, store: broken });
        expect((await cat.explore(Q)).items).toHaveLength(16);
        expect((await cat.explore(Q)).from).toBe('network');
        expect(p.calls).toHaveLength(2);
    });

    it('the same page asked twice at once is one request', async () => {
        const p = proxy(undefined, true);
        const cat = new SuperSplatCatalog({ fetch: p.fetch });
        const a = cat.explore(Q);
        const b = cat.explore({ ...Q, features: ['walkable'] });
        await Promise.resolve();
        expect(p.calls).toHaveLength(1);
        p.release();
        const [ra, rb] = await Promise.all([a, b]);
        expect(ra.items).toEqual(rb.items);
        expect((await cat.explore(Q)).from).toBe('session'); // settled and cached
        const c = cat.explore({ ...Q, skip: 16 }); // control: another page is another request
        const d = cat.explore({ ...Q, skip: 32 });
        await Promise.resolve();
        expect(p.calls).toHaveLength(3);
        p.release();
        await Promise.all([c, d]);
    });

    it('maps every proxy error; errors are not cached', async () => {
        const cases: Array<[Answer, string, number | null]> = [
            [json({ ok: false, error: 'bad-param', param: 'sort' }, 400), 'bad-query', null],
            [json({ ok: false, error: 'rate-limited', retryAfter: 60 }, 429, { 'retry-after': '60' }), 'rate-limited', 60],
            [json({ ok: false, error: 'busy', retryAfter: 12 }, 503, { 'retry-after': '12' }), 'busy', 12],
            [json({ ok: false, error: 'upstream', detail: 'timeout' }, 502), 'upstream', null],
            [new Response('<html>502 Bad Gateway</html>', { status: 502 }), 'upstream', null],
            [new Response('<html>403</html>', { status: 403 }), 'upstream', null],
            [new TypeError('Failed to fetch'), 'network', null],
            [json('not json {', 200), 'bad-response', null],
            [json({ ok: false }), 'bad-response', null]
        ];
        for (const [answer, want, retry] of cases) {
            const p = proxy(() => answer);
            const cat = new SuperSplatCatalog({ fetch: p.fetch });
            const err = await cat.explore(Q).catch((e: unknown) => e as SuperSplatError);
            expect(err, want).toBeInstanceOf(SuperSplatError);
            expect([(err as SuperSplatError).code, (err as SuperSplatError).retryAfterS]).toEqual([want, retry]);
            await cat.explore(Q).catch(() => undefined);
            expect(p.calls, `${want} is not cached`).toHaveLength(2);
        }
    });

    it('switched off or given a bad query, it asks nothing', async () => {
        const p = proxy();
        expect(await code(new SuperSplatCatalog({ fetch: p.fetch, enabled: false }).explore(Q))).toBe('disabled');
        expect(await code(new SuperSplatCatalog({ fetch: p.fetch }).explore({ ...Q, limit: 49 }))).toBe('bad-query');
        expect(p.calls).toHaveLength(0);
        expect(await code(new SuperSplatCatalog({ fetch: p.fetch, enabled: true }).explore(Q))).toBe('resolved'); // control
        expect(p.calls).toHaveLength(1);
    });
});

describe('supersplSearchUrl (the same list on superspl.at)', () => {
    it('writes superspl.at\'s own parameters', () => {
        expect(supersplSearchUrl({ sort: 'starred', order: -1, features: ['walkable'] })).toBe('https://superspl.at/search?sort=likes&time=all&features=walkable');
        expect(supersplSearchUrl({ sort: 'trending', time: 'week' })).toBe('https://superspl.at/search?sort=trending');
        expect(supersplSearchUrl({ sort: 'createdAt', order: 1, time: 'month' })).toBe('https://superspl.at/search?sort=oldest&time=month');
        expect(supersplSearchUrl({ sort: 'size', order: -1, time: 'year' })).toBe('https://superspl.at/search?sort=largest&time=year');
        expect(supersplSearchUrl({ sort: 'views', order: -1, time: 'week', search: ' gothic  church ', features: ['downloadable', 'walkable'] }))
            .toBe('https://superspl.at/search?q=gothic%20church&sort=views&time=week&features=walkable,downloadable');
        expect(supersplSearchUrl()).toBe('https://superspl.at/search?sort=trending');
    });

    it('reads back to the same API list through superspl.at\'s table, except the 3 pairs its menu lacks', () => {
        // superspl.at's menu -> API (bundle TopNavSearchContext-*.js, 2026-09-27)
        const theirs: Record<string, [string, number]> = {
            trending: ['trending', -1], newest: ['createdAt', -1], oldest: ['createdAt', 1], views: ['views', -1],
            likes: ['starred', -1], largest: ['size', -1], smallest: ['size', 1]
        };
        const lost: string[] = [];
        for (const sort of ['trending', 'createdAt', 'views', 'starred', 'size'] as const) {
            for (const order of [1, -1] as const) {
                const u = new URL(supersplSearchUrl({ sort, order, time: 'day' }));
                const [s, o] = theirs[u.searchParams.get('sort')!];
                if (s !== sort || o !== order) lost.push(`${sort}:${order}`);
                expect(u.searchParams.get('time')).toBe(sort === 'trending' ? null : 'day');
            }
        }
        expect(lost).toEqual(['trending:1', 'views:1', 'starred:1']); // the control: a lost pair IS detected
    });
});

// ---------------- random, highest rated first ----------------

function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function items(n: number, over: (i: number) => Partial<ExploreItem> = () => ({})): ExploreItem[] {
    return Array.from({ length: n }, (_, i) => {
        const id = i.toString(16).padStart(8, '0');
        return {
            id, version: 1, title: `S${i}`, author: 'a', license: null, downloadable: false, likes: 1000 - i, views: 1, sizeBytes: 1,
            thumb: '', thumbs: { s: null, m: null, l: null, xl: null, mov: null }, createdAt: null, description: '', format: 'sog', walkable: true,
            ...over(i)
        };
    });
}

const id = (i: number) => i.toString(16).padStart(8, '0');

describe('pickRandomTopRated', () => {
    const pool = items(100).reverse(); // any order in, ranked inside

    it('is repeatable with the same rng', () => {
        const a = Array.from({ length: 20 }, ((r) => () => pickRandomTopRated(pool, { rng: r })!.item.id)(mulberry32(7)));
        const b = Array.from({ length: 20 }, ((r) => () => pickRandomTopRated(pool, { rng: r })!.item.id)(mulberry32(7)));
        const c = Array.from({ length: 20 }, ((r) => () => pickRandomTopRated(pool, { rng: r })!.item.id)(mulberry32(8)));
        expect(a).toEqual(b);
        expect(a).not.toEqual(c); // control: another seed, another sequence
    });

    it('draws only from the best-liked tier, all of it', () => {
        const rng = mulberry32(1);
        const seen = new Set<string>();
        for (let i = 0; i < 2000; i++) seen.add(pickRandomTopRated(pool, { rng })!.item.id);
        expect([...seen].sort()).toEqual(Array.from({ length: 20 }, (_, i) => id(i)));
        expect(pickRandomTopRated(pool, { rng: () => 0.999999 })!.item.id).toBe(id(19));
        expect(pickRandomTopRated(pool, { rng: () => 0.999999, tierSize: 100 })!.item.id).toBe(id(99)); // control: one big tier
    });

    it('goes down a tier only when every scene above was flown recently, is broken or on screen', () => {
        const recent = Array.from({ length: 18 }, (_, i) => id(i));
        const r = pickRandomTopRated(pool, { rng: () => 0.999999, recent, current: id(19), broken: [id(18)] });
        expect([r!.item.id, r!.tier, r!.candidates, r!.relaxed]).toEqual([id(39), 1, 20, false]);
        const ctl = pickRandomTopRated(pool, { rng: () => 0.999999, recent: recent.slice(1), current: id(19), broken: [id(18)] });
        expect([ctl!.item.id, ctl!.tier, ctl!.candidates]).toEqual([id(0), 0, 1]); // control: one left in tier 0 -> that one
    });

    it('skips the current scene, broken ones, unsupported formats and too few likes', () => {
        const zero = () => 0;
        expect(pickRandomTopRated(pool, { rng: zero })!.item.id).toBe(id(0)); // control: 0 picks the best
        expect(pickRandomTopRated(pool, { rng: zero, current: id(0) })!.item.id).toBe(id(1));
        expect(pickRandomTopRated(pool, { rng: zero, broken: [id(0)] })!.item.id).toBe(id(1));
        const ply = items(3, (i) => ({ format: i === 0 ? 'compressed.ply' : 'sog' }));
        expect(pickRandomTopRated(ply, { rng: zero })!.item.id).toBe(id(1));
        expect(pickRandomTopRated(ply, { rng: zero, isBroken: () => false })!.item.id).toBe(id(0)); // control
        expect(pickRandomTopRated(pool, { rng: zero, minLikes: 2000 })).toBeNull();
        expect(pickRandomTopRated(pool, { rng: zero, minLikes: 1000 })!.item.id).toBe(id(0)); // control
    });

    it('when everything was flown recently it allows recent scenes again, never the current or broken', () => {
        const small = items(5);
        const r = pickRandomTopRated(small, { rng: () => 0, recent: small.map((x) => x.id), current: id(0), broken: [id(1)] });
        expect([r!.item.id, r!.relaxed]).toEqual([id(2), true]);
        expect(pickRandomTopRated(small, { rng: () => 0, current: id(0), broken: small.slice(1).map((x) => x.id) })).toBeNull();
        expect(pickRandomTopRated([], { rng: () => 0 })).toBeNull();
    });

    it('a duplicate from shifting pages does not count twice; a bad rng value does not break it', () => {
        const dup = [...items(2), ...items(2)];
        const r = pickRandomTopRated(dup, { rng: () => 0.75 });
        expect([r!.item.id, r!.candidates]).toEqual([id(1), 2]);
        for (const bad of [1, -0.5, Number.NaN, Infinity]) expect(pickRandomTopRated(pool, { rng: () => bad })!.item.id).toMatch(/^[0-9a-f]{8}$/);
    });
});

describe('formats the API does not name (review C9)', () => {
    // c67edb74 "Gothic Church - Kefermarkt": the best-liked walkable scene on 2026-10-01; the API gives its format
    // as '' and the CDN has only scene.compressed.ply for it (resolveScene: 'unsupported')
    const tier = items(20, (i) => (i === 0 ? { id: 'c67edb74', format: '' } : {}));

    it('only sog, ssog and sogs count as known; the pure picker never draws an unknown one', () => {
        expect(['sog', 'ssog', 'sogs', 'compressed.ply', '', 'ply', 'SOG'].map(formatVerdict))
            .toEqual(['opens', 'opens', 'opens', 'unsupported', 'unknown', 'unknown', 'unknown']);
        const count = (o: Partial<Parameters<typeof pickRandomTopRated>[1]>) => {
            const rng = mulberry32(3);
            let n = 0;
            for (let i = 0; i < 2000; i++) if (pickRandomTopRated(tier, { rng, ...o })!.item.id === 'c67edb74') n++;
            return n;
        };
        expect(count({})).toBe(0);
        // control: the rule before the fix (only 'compressed.ply' is broken) picks it about 1 time in 20
        expect(count({ isBroken: (it) => UNSUPPORTED_FORMATS.includes(it.format) })).toBeGreaterThan(50);
    });

    it('randomTopRated with a check: an unknown format is returned only when the check says it opens, each asked once', async () => {
        const pool = Array.from({ length: 40 }, (_, i) => wire(i, i === 0 ? { id: 'c67edb74', format: '' } : i === 1 ? { format: '' } : {}));
        const asked: string[] = [];
        const check = async (it: ExploreItem) => {
            asked.push(it.id);
            return it.id === 'c67edb74' ? ('no' as const) : ('yes' as const); // id(1): '' in the API, a SOG on the CDN
        };
        const draws = async (o: { check?: typeof check }) => {
            const cat = new SuperSplatCatalog({ fetch: proxy(pageOf(pool)).fetch });
            const got: string[] = [];
            for (let k = 0; k < 40; k++) got.push((await cat.randomTopRated({ rng: () => (k + 0.5) / 40, ...o }))!.item.id);
            return got;
        };
        const got = await draws({ check });
        expect(got).not.toContain('c67edb74');
        expect(got).toContain(id(1)); // control: a good scene with a blank format stays reachable
        expect(asked.sort()).toEqual([id(1), 'c67edb74']); // known formats are never checked; verdicts are kept
        const plain = await draws({});
        expect(plain).not.toContain('c67edb74');
        expect(plain).not.toContain(id(1)); // without a check an unknown format is not picked at all
        const unsure = new SuperSplatCatalog({ fetch: proxy(pageOf(pool)).fetch });
        const r = await unsure.randomTopRated({ rng: () => 0, check: async () => 'unknown' });
        expect(r!.item.id).toBe(id(2)); // no clear answer: not this time, the next scene of the tier instead
    });
});

describe('SuperSplatCatalog.topRated / randomTopRated', () => {
    it('asks 5 pages of 40 one at a time, best-liked all-time walkable, and ranks them', async () => {
        const pool = Array.from({ length: 500 }, (_, i) => wire(i, { likes: (i * 37) % 501 }));
        const sorted = [...pool].sort((a, b) => (b.likes as number) - (a.likes as number));
        const p = proxy(pageOf(sorted));
        const top = await new SuperSplatCatalog({ fetch: p.fetch }).topRated();
        expect(p.calls.map((c) => new URL(c.url, 'https://x').search)).toEqual([0, 40, 80, 120, 160].map((s) => `?sort=starred&order=-1&time=all&features=walkable&skip=${s}&limit=40`));
        expect(p.maxOpen()).toBe(1);
        expect(top).toHaveLength(200);
        expect(top.map((x) => x.likes)).toEqual(sorted.slice(0, 200).map((x) => x.likes));
    });

    it('stops at the end of the list and survives a failure after the first page', async () => {
        const p = proxy(pageOf(Array.from({ length: 50 }, (_, i) => wire(i))));
        expect(await new SuperSplatCatalog({ fetch: p.fetch }).topRated()).toHaveLength(50);
        expect(p.calls).toHaveLength(2);
        let n = 0;
        const flaky = proxy((u) => (++n === 2 ? json({ ok: false, error: 'busy' }, 503) : pageOf(Array.from({ length: 300 }, (_, i) => wire(i)))(u)));
        expect(await new SuperSplatCatalog({ fetch: flaky.fetch }).topRated()).toHaveLength(40);
        const down = proxy(() => json({ ok: false, error: 'busy' }, 503));
        expect(await code(new SuperSplatCatalog({ fetch: down.fetch }).topRated())).toBe('busy'); // control: first page lost -> error
    });

    it('randomTopRated reads one page while its best tier has a fresh scene, and goes on only when needed', async () => {
        const p = proxy();
        const cat = new SuperSplatCatalog({ fetch: p.fetch });
        const r = await cat.randomTopRated({ rng: () => 0.5, recent: [id(0)] });
        expect([r!.item.id, r!.tier, r!.candidates]).toEqual([id(10), 0, 19]);
        expect(p.calls).toHaveLength(1);
        const again = await cat.randomTopRated({ rng: () => 0.5 });
        expect(again!.item.id).toBe(id(10)); // 20 candidates, index 10
        expect(p.calls).toHaveLength(1); // the first page came from the tab cache
        // control: the whole first page flown recently -> the second page is read, tier 2 is drawn from
        const deep = await cat.randomTopRated({ rng: () => 0, recent: Array.from({ length: 40 }, (_, i) => id(i)) });
        expect([deep!.item.id, deep!.tier, deep!.relaxed]).toEqual([id(40), 2, false]);
        expect(p.calls).toHaveLength(2);
        // everything flown: every page is read, then recent scenes are allowed again
        const all = await cat.randomTopRated({ rng: () => 0, recent: Array.from({ length: 300 }, (_, i) => id(i)), current: id(0) });
        expect([all!.item.id, all!.relaxed]).toEqual([id(1), true]);
        expect(p.calls).toHaveLength(5);
    });

    it('randomTopRated counts a tier only once it is complete in the pages read', async () => {
        const p = proxy();
        const cat = new SuperSplatCatalog({ fetch: p.fetch });
        // pages of 30, tiers of 20: after page 1 tier 1 is half read, so a pick from it waits for page 2
        const r = await cat.randomTopRated({ rng: () => 0.999999, pageSize: 30, recent: Array.from({ length: 20 }, (_, i) => id(i)) });
        expect([r!.item.id, r!.tier]).toEqual([id(39), 1]);
        expect(p.calls).toHaveLength(2);
    });
});
