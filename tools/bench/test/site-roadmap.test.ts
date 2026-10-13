// The landing's roadmap as data (apps/site/src/lib/roadmap.ts, apps/site/scripts/roadmap.mjs; owner's item 3,
// docs/wip/v07-c.md): the parser drops what the page cannot show (unknown status or kind, no English
// title, a repeated id, a title over 240 or a text over 600 characters: lane B's limits), the board groups
// and counts, the runtime refresh keeps the snapshot on every kind of failure and when the answer misses
// most of the snapshot (a store never seeded), and the prebuild snapshot comes from the live store when
// it answers with the seeded roadmap, else the seed.
// Every rule is shown with its control: the same input with only the broken part fixed is kept.
import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TEXT_MAX, TITLE_MAX, buildBoard, coversSnapshot, groupsOf, loadLive, parseRoadmap, viewItems } from '../../../apps/site/src/lib/roadmap';
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

    it('takes a title up to 240 and a public text up to 600 characters (lane B\'s limits); one more is not shown', () => {
        expect([TITLE_MAX, TEXT_MAX]).toEqual([240, 600]);
        const long = parseRoadmap(doc(item({ id: 't', title: { en: 'T'.repeat(240) }, text: { en: 'x'.repeat(600), pl: 'y'.repeat(601) } })))!;
        expect([long[0].title.en.length, long[0].text?.en?.length, long[0].text?.pl]).toEqual([240, 600, undefined]);
        // control: one character more drops the text, and a title without English drops the item
        expect(parseRoadmap(doc(item({ id: 't', text: { en: 'x'.repeat(601) } })))![0].text).toBeUndefined();
        expect(parseRoadmap(doc(item({ id: 't', title: { en: 'T'.repeat(241) } })))).toEqual([]);
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

    it('the public text under a title comes in the language asked for, else English, else none', () => {
        const withText = parseRoadmap(doc(item({ id: 't', text: { en: 'Off by default', pl: 'Domyslnie wylaczony' } }), item({ id: 'n' })))!;
        expect(viewItems(withText, 'pl').map((v) => v.text)).toEqual(['Domyslnie wylaczony', undefined]);
        expect(viewItems(withText, 'es')[0].text).toBe('Off by default');
    });

    it('an answer without the optional group keeps the group the snapshot gave the id (control: without it, "More")', () => {
        const snap = viewItems(items, 'en');
        const bare = parseRoadmap(doc(item({ id: 'a' })))!;
        expect(viewItems(bare, 'en', groupsOf(snap))[0].group).toBe('radio');
        expect(viewItems(bare, 'en')[0].group).toBeNull();
    });
});

describe('loadLive: the runtime refresh', () => {
    const known: ViewItem[] = []; // an empty snapshot accepts any usable answer
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

    it('an answer that misses most of the snapshot (a store never seeded) keeps the snapshot; the grown roadmap is taken (control)', async () => {
        const snapshot = viewItems(parseRoadmap(doc(...Array.from({ length: 10 }, (_, k) => item({ id: `F-${k}`, group: 'radio' }))))!, 'en');
        const pilot = item({ id: 'R-1', status: 'planned', fromPilot: true });
        expect(await loadLive(answer(200, JSON.stringify(doc(pilot))), 'en', snapshot)).toBeNull();
        expect(await loadLive(answer(200, JSON.stringify(doc(pilot, ...[0, 1, 2, 3].map((k) => item({ id: `F-${k}` }))))), 'en', snapshot)).toBeNull(); // 4 of 10
        // control: the snapshot's items plus the pilot's idea is the roadmap grown, taken with the snapshot's groups
        const grown = await loadLive(answer(200, JSON.stringify(doc(...Array.from({ length: 10 }, (_, k) => item({ id: `F-${k}` })), pilot))), 'en', snapshot);
        expect([grown?.length, grown?.find((x) => x.id === 'F-3')?.group]).toEqual([11, 'radio']);
        // the owner hid a few: half of them is still the same roadmap
        expect(coversSnapshot(snapshot.slice(5), snapshot)).toBe(true);
        expect(coversSnapshot(snapshot.slice(6), snapshot)).toBe(false);
        expect(coversSnapshot([], [])).toBe(true);
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
        // lane B's store keeps no landing group: a seeded id takes its seed group, a new idea has none
        const seeded = (JSON.parse(readFileSync(join(REPO, 'apps', 'api', 'locales', 'roadmap-seed.json'), 'utf8')) as { items: { id: string; title: Record<string, string> }[] }).items
            .filter((x) => x.id !== 'F-recalibrate-button-in-controls').map((x) => item({ id: x.id, title: x.title }));
        let body = JSON.stringify(doc(item({ id: 'live-only' }), item({ id: 'F-recalibrate-button-in-controls' }), ...seeded));
        let status = 200;
        const srv = createServer((_q, r) => { r.writeHead(status, { 'content-type': 'application/json' }); r.end(body); });
        await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
        const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/api/roadmap`;
        try {
            const live = await run(url);
            expect([live.source, parseRoadmap(live.roadmap)?.slice(0, 2).map((x) => [x.id, x.group ?? null])]).toEqual(['live', [['live-only', null], ['F-recalibrate-button-in-controls', 'radio']]]);
            // a store that was never seeded (a wrong seed path on the server): one pilot item and one feature -> the seed
            body = JSON.stringify(doc(item({ id: 'live-only' }), item({ id: 'F-recalibrate-button-in-controls' })));
            expect((await run(url)).source).toBe('seed');
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

/** Everything that disagrees between the site dictionaries' groups and the seed's. */
function groupProblems(site: Record<string, Record<string, string>>, seedGroups: ReadonlySet<string>): string[] {
    const out: string[] = [];
    const want = Object.keys(site.en).join(',');
    for (const [l, groups] of Object.entries(site)) if (Object.keys(groups).join(',') !== want) out.push(`site ${l}: ${Object.keys(groups).join(',')}`);
    for (const g of seedGroups) if (!(g in site.en)) out.push(`seed: ${g}`);
    return out;
}

describe('the landing groups are one list', () => {
    const site = Object.fromEntries(['en', 'es', 'pl', 'ru'].map((l) => [l, (JSON.parse(readFileSync(join(REPO, 'packages', 'i18n', 'locales', 'site', `${l}.json`), 'utf8')) as { features: { groups: Record<string, string> } }).features.groups]));
    const seed = new Set((JSON.parse(readFileSync(join(REPO, 'apps', 'api', 'locales', 'roadmap-seed.json'), 'utf8')) as { items: { group: string }[] }).items.map((i) => i.group));

    it('every seed group has a title in each site dictionary, the same groups in the same order', () => {
        expect(Object.keys(site.en)).toEqual(GROUPS);
        expect(groupProblems(site, seed)).toEqual([]);
    });

    it('a group in the seed only, or a dictionary out of step, is caught (control)', () => {
        expect(groupProblems(site, new Set([...seed, 'wind']))).toEqual(['seed: wind']);
        const { walls: _w, ...noWalls } = site.pl;
        expect(groupProblems({ ...site, pl: noWalls }, seed)).toEqual(['site pl: radio,controls,drone,crash,camera,scenes,settings']);
    });
});
