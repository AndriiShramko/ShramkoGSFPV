// The landing's roadmap as data (apps/site/src/lib/roadmap.ts, apps/site/scripts/roadmap.mjs; owner's item 3,
// docs/wip/v07-c.md): the parser drops what the page cannot show (unknown status or kind, no English
// title, a repeated id), the board groups and counts, the runtime refresh keeps the snapshot on every
// kind of failure, and the prebuild snapshot comes from the live store when it answers, else the seed.
// Every rule is shown with its control: the same input with only the broken part fixed is kept.
import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildBoard, groupsOf, loadLive, parseRoadmap, viewItems } from '../../../apps/site/src/lib/roadmap';
import type { ViewItem } from '../../../apps/site/src/lib/roadmap';

const REPO = join(__dirname, '..', '..', '..');
const GROUPS = ['radio', 'controls', 'drone', 'crash', 'camera', 'scenes', 'walls', 'settings'];
const item = (o: Record<string, unknown> = {}) => ({ id: 'F-a', kind: 'feature', status: 'done', title: { en: 'A', pl: 'A pl' }, fromPilot: false, ...o });
const doc = (...items: unknown[]) => ({ v: 1, items });

describe('parseRoadmap', () => {
    it('drops an item with an unknown status; the same item with a known status is kept (control)', () => {
        expect(parseRoadmap(doc(item({ status: 'someday' })))).toEqual([]);
        expect(parseRoadmap(doc(item({ status: 'accepted' })))).toEqual([]); // a store status is not a public one
        expect(parseRoadmap(doc(item({ status: 'planned' })))?.map((x) => x.status)).toEqual(['planned']);
    });

    it('drops an unknown kind, a missing English title and a bad id; keeps the rest of the document', () => {
        const got = parseRoadmap(doc(item({ id: 'k', kind: 'wish' }), item({ id: 't', title: { pl: 'tylko' } }), item({ id: 'bad id' }), item({ id: 'ok' })));
        expect(got?.map((x) => x.id)).toEqual(['ok']);
    });

    it('keeps the first of a repeated id, cleans optional fields, never invents a pilot', () => {
        const got = parseRoadmap(doc(item({ id: 'x', title: { en: ' First ' }, group: 'Radio!', order: '3', release: 'abc1234', done: '2026-10-13', fromPilot: 'yes' }), item({ id: 'x', title: { en: 'Second' } })));
        expect(got).toEqual([{ id: 'x', kind: 'feature', status: 'done', title: { en: 'First' }, fromPilot: false, release: 'abc1234', done: '2026-10-13' }]);
    });

    it('refuses a document that is not a v1 roadmap', () => {
        expect(parseRoadmap({ v: 2, items: [item()] })).toBeNull();
        expect(parseRoadmap({ v: 1, items: {} })).toBeNull();
        expect(parseRoadmap('{"v":1}')).toBeNull();
        expect(parseRoadmap(doc(item()))?.length).toBe(1);
    });
});

describe('viewItems and buildBoard', () => {
    const items = parseRoadmap(doc(
        item({ id: 'b', group: 'drone', order: 2, title: { en: 'B', pl: 'B pl' } }),
        item({ id: 'a', group: 'radio', order: 1, title: { en: 'A' } }),
        item({ id: 'p', status: 'planned', order: 5, fromPilot: true }),
        item({ id: 'w', status: 'in_progress', order: 4 }),
        item({ id: 'n', title: { en: 'No group' } }),
        item({ id: 'u', group: 'unknown-group', order: 3 })
    ))!;

    it('orders by order, shows the language asked for or English, keeps the pilot mark', () => {
        const v = viewItems(items, 'pl');
        expect(v.map((x) => x.id)).toEqual(['a', 'b', 'u', 'w', 'p', 'n']);
        expect(v.find((x) => x.id === 'b')?.title).toBe('B pl');
        expect(v.find((x) => x.id === 'a')?.title).toBe('A');
        expect(v.find((x) => x.id === 'p')?.fromPilot).toBe(true);
        expect(viewItems(items, 'xx').find((x) => x.id === 'b')?.title).toBe('B');
    });

    it('counts each column and groups done items in the page order, the rest under one trailing group', () => {
        const b = buildBoard(viewItems(items, 'en'), GROUPS);
        expect(b.counts).toEqual({ done: 4, in_progress: 1, planned: 1 });
        expect(b.done.map((g) => [g.group, g.items.map((x) => x.id)])).toEqual([['radio', ['a']], ['drone', ['b']], [null, ['u', 'n']]]);
        expect(b.inProgress.map((x) => x.id)).toEqual(['w']);
        expect(b.planned.map((x) => x.id)).toEqual(['p']);
    });

    it('an answer without the optional group keeps the group the snapshot gave the id (control: without it, "More")', () => {
        const snap = viewItems(items, 'en');
        const bare = parseRoadmap(doc(item({ id: 'a' })))!;
        expect(viewItems(bare, 'en', groupsOf(snap))[0].group).toBe('radio');
        expect(viewItems(bare, 'en')[0].group).toBeNull();
    });
});

describe('loadLive: the runtime refresh', () => {
    const known = new Map<string, string>();
    const answer = (status: number, body: string): typeof fetch => (async () => new Response(body, { status, headers: { 'content-type': 'application/json' } })) as typeof fetch;

    it('a good answer replaces the snapshot, dropping the item with an unknown status', async () => {
        const live = await loadLive(answer(200, JSON.stringify(doc(item({ id: 'new', status: 'in_progress' }), item({ id: 'odd', status: 'maybe' })))), 'en', known);
        expect(live?.map((x: ViewItem) => [x.id, x.status])).toEqual([['new', 'in_progress']]);
    });

    it('every failure keeps the snapshot (null): HTTP 500 or 404, not JSON, wrong version, nothing usable, network, timeout', async () => {
        const good = JSON.stringify(doc(item()));
        expect(await loadLive(answer(500, good), 'en', known)).toBeNull();
        expect(await loadLive(answer(404, good), 'en', known)).toBeNull();
        expect(await loadLive(answer(200, '<html>'), 'en', known)).toBeNull();
        expect(await loadLive(answer(200, JSON.stringify({ v: 2, items: [item()] })), 'en', known)).toBeNull();
        expect(await loadLive(answer(200, JSON.stringify(doc())), 'en', known)).toBeNull();
        expect(await loadLive(answer(200, JSON.stringify(doc(item({ status: 'someday' })))), 'en', known)).toBeNull();
        expect(await loadLive((async () => { throw new TypeError('Failed to fetch'); }) as typeof fetch, 'en', known)).toBeNull();
        const hang = ((_u: unknown, init?: RequestInit) => new Promise((_r, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))))) as typeof fetch;
        expect(await loadLive(hang, 'en', known, 30)).toBeNull();
        // control: the same good body with 200 is taken
        expect((await loadLive(answer(200, good), 'en', known))?.length).toBe(1);
    });
});

describe('the prebuild snapshot (apps/site/scripts/roadmap.mjs)', () => {
    const script = join(REPO, 'apps', 'site', 'scripts', 'roadmap.mjs');
    /** one run of the script (async: the test's own HTTP server must keep answering meanwhile) */
    const run = async (url = '') => {
        const out = join(mkdtempSync(join(tmpdir(), 'gsfpv-roadmap-')), 'roadmap.json');
        await new Promise<void>((ok, bad) => execFile(process.execPath, [script], { env: { ...process.env, ROADMAP_URL: url, ROADMAP_OUT: out } }, (e) => (e ? bad(e) : ok())));
        return JSON.parse(readFileSync(out, 'utf8')) as { source: string; roadmap: unknown };
    };

    it('without ROADMAP_URL: the seed, every item kept, the store status accepted published as planned', async () => {
        const snap = await run();
        expect(snap.source).toBe('seed');
        const seed = JSON.parse(readFileSync(join(REPO, 'apps', 'api', 'locales', 'roadmap-seed.json'), 'utf8')) as { items: { id: string; status: string }[] };
        const items = parseRoadmap(snap.roadmap)!;
        expect(items.map((x) => x.id)).toEqual(seed.items.map((x) => x.id));
        expect(items.find((x) => x.id === 'F-radio-switches-for-respawn-and-rewind')?.status).toBe('planned');
        expect(new Set(items.map((x) => x.group))).toEqual(new Set(GROUPS));
    });

    it('with ROADMAP_URL: the live answer when usable, the seed when not (control)', async () => {
        let body = JSON.stringify(doc(item({ id: 'live-only' })));
        let status = 200;
        const srv = createServer((_q, r) => { r.writeHead(status, { 'content-type': 'application/json' }); r.end(body); });
        await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
        const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/api/roadmap`;
        try {
            const live = await run(url);
            expect([live.source, parseRoadmap(live.roadmap)?.map((x) => x.id)]).toEqual(['live', ['live-only']]);
            status = 503;
            expect((await run(url)).source).toBe('seed');
            status = 200;
            body = JSON.stringify(doc(item({ status: 'someday' })));
            expect((await run(url)).source).toBe('seed');
        } finally {
            srv.close();
        }
    });
});
