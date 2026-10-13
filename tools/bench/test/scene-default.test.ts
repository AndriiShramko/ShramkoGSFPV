// "Save as this scan's default" (v0.7 lane E, item 3; apps/fly/src/app/scene-default.ts): the mapping
// from what is flown to the catalogue entry, and the save itself through the real admin API server
// (apps/api/server.py on 127.0.0.1, a throwaway data folder, a made-up password: no real secret, no
// Telegram, nothing leaves this machine). Every claim has a control that must fire.
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CatalogScene, SceneCatalog } from '../../../packages/scenes/src';
import { ADMIN_HINT_KEY, AdminClient, adminHinted } from '../../../apps/fly/src/admin/api';
import { flownWind, sceneDefaultPatch, saveSceneDefault, withSceneDefault } from '../../../apps/fly/src/app/scene-default';
import type { FlownDefaults } from '../../../apps/fly/src/app/scene-default';
import type { WindSpec } from '../../../apps/fly/src/session/wind-source';

const REPO = join(__dirname, '..', '..', '..');

const PLAIN: FlownDefaults = { walls: 'on', dropFloaters: 0, scale: 1, ceilingM: null, wind: { source: 'scene' } };
const TUNED: FlownDefaults = { walls: 'off', dropFloaters: 6, scale: 2, ceilingM: 12.5, wind: { source: 'custom', fromDeg: 0, speed: 5, gust: 2 } };

const ALPHA: CatalogScene = {
    id: 'aaaa1111', title: 'Alpha field', author: 'Test', license: 'CC BY 4.0', kind: 'exterior', collision: true,
    walls: 'on', dropFloaters: 4, scale: 1.5, ceilingM: 30, wind: { fromDeg: 200, speed: 3, gust: 1, source: 'climate' }
};
const BETA: CatalogScene = { id: 'bbbb2222', title: 'Beta room', author: 'Test', license: 'CC BY 4.0', kind: 'interior', collision: true, walls: 'off', dropFloaters: 2 };
const CAT: SceneCatalog = { collections: [], scenes: [ALPHA, BETA] };

describe('what is flown -> the catalogue entry (sceneDefaultPatch, withSceneDefault)', () => {
    it('a tuned flight sets every field; custom wind is saved as manual', () => {
        const p = sceneDefaultPatch(TUNED);
        expect(p.set).toEqual({ walls: 'off', dropFloaters: 6, scale: 2, ceilingM: 12.5, wind: { fromDeg: 0, speed: 5, gust: 2, source: 'manual' } });
        expect(p.drop).toEqual([]);
        expect(p.kept).toEqual([]);
    });

    it('the catalogue defaults are written as absent fields (no filter, size 1, no ceiling); the scan\'s wind is not removed', () => {
        const p = sceneDefaultPatch(PLAIN);
        expect(p.set).toEqual({ walls: 'on' });
        expect(p.drop.sort()).toEqual(['ceilingM', 'dropFloaters', 'scale']);
        const e = withSceneDefault(CAT, ALPHA.id, p)!.scenes[0];
        for (const k of ['ceilingM', 'dropFloaters', 'scale'] as const) expect(k in e).toBe(false);
        expect(e.wind).toEqual(ALPHA.wind);
    });

    it('Scene size above the catalogue\'s x4 keeps the entry\'s size; control: x4 itself is saved', () => {
        const big = sceneDefaultPatch({ ...TUNED, scale: 10 });
        expect(big.kept).toEqual(['scale']);
        expect('scale' in big.set || big.drop.includes('scale')).toBe(false);
        expect(withSceneDefault(CAT, ALPHA.id, big)!.scenes[0].scale).toBe(1.5);
        expect(sceneDefaultPatch({ ...TUNED, scale: 4 }).set.scale).toBe(4); // control
    });

    it('the scan\'s own wind flown leaves the entry\'s wind (and its climate source) alone; the live wind is kept and said', () => {
        const own = sceneDefaultPatch({ ...TUNED, wind: { source: 'scene' } });
        expect(own.kept).toEqual([]);
        expect(withSceneDefault(CAT, ALPHA.id, own)!.scenes[0].wind).toEqual(ALPHA.wind);
        const live = sceneDefaultPatch({ ...TUNED, wind: { source: 'now' } });
        expect(live.kept).toEqual(['wind-live']);
        expect(withSceneDefault(CAT, ALPHA.id, live)!.scenes[0].wind).toEqual(ALPHA.wind);
        // control: the custom wind does replace it
        expect(withSceneDefault(CAT, ALPHA.id, sceneDefaultPatch(TUNED))!.scenes[0].wind?.source).toBe('manual');
    });

    it('wind switched off (the pilot\'s setting for every scan) keeps the entry\'s climate wind and says so; still air picked for the scan is saved as a calm manual wind', () => {
        const off = sceneDefaultPatch({ ...TUNED, wind: { source: 'off' } });
        expect(off.kept).toEqual(['wind-off']);
        expect('wind' in off.set || off.drop.includes('wind')).toBe(false);
        expect(withSceneDefault(CAT, ALPHA.id, off)!.scenes[0].wind).toEqual(ALPHA.wind);
        // control: still air picked for this scan does change the entry (a known calm, not "no wind known")
        const calm = sceneDefaultPatch({ ...TUNED, wind: { source: 'custom', fromDeg: 90, speed: 0, gust: 0 } });
        expect(calm.kept).toEqual([]);
        expect(withSceneDefault(CAT, ALPHA.id, calm)!.scenes[0].wind).toEqual({ fromDeg: 90, speed: 0, gust: 0, source: 'manual' });
    });

    it('which wind was flown: still air from wind off, from a calm custom wind, from a scan without wind; a flown wind by its source', () => {
        const spec = (source: WindSpec['source']): WindSpec => ({ fromDeg: 120, speed: 4, gust: 1, compassDeg: 0, hasCompass: false, source });
        const mine = { fromDeg: 45, speed: 7, gust: 3 };
        const calm = { fromDeg: 45, speed: 0, gust: 0 };
        expect(flownWind(null, 'off', mine)).toEqual({ source: 'off' });
        expect(flownWind(null, 'custom', calm)).toEqual({ source: 'custom', fromDeg: 45, speed: 0, gust: 0 });
        expect(flownWind(null, 'scene', calm)).toEqual({ source: 'scene' }); // the scan has no wind
        expect(flownWind(null, 'now', calm)).toEqual({ source: 'scene' }); // no live answer, no wind of its own
        // control: custom numbers with wind that do not fly yet (a change waiting for the flight) save nothing
        expect(flownWind(null, 'custom', mine)).toEqual({ source: 'scene' });
        // a flown wind is what it is, whatever the mode says now; custom keeps the flown numbers (control: not the stored ones)
        expect(flownWind(spec('custom'), 'custom', mine)).toEqual({ source: 'custom', fromDeg: 120, speed: 4, gust: 1 });
        expect(flownWind(spec('now'), 'now', mine)).toEqual({ source: 'now' });
        expect(flownWind(spec('scene'), 'now', mine)).toEqual({ source: 'scene' }); // the live wind fell back to the scan's
    });

    it('a scan without walls says nothing about them; control: one with walls does', () => {
        expect('walls' in sceneDefaultPatch({ ...TUNED, walls: null }).set).toBe(false);
        expect(sceneDefaultPatch(TUNED).set.walls).toBe('off');
    });

    it('only the scan\'s entry changes, the input is not touched, an unknown scan is refused', () => {
        const before = JSON.stringify(CAT);
        const next = withSceneDefault(CAT, ALPHA.id, sceneDefaultPatch(TUNED))!;
        expect(JSON.stringify(CAT)).toBe(before);
        expect(next.scenes[1]).toEqual(BETA);
        expect(next.scenes[0]).not.toEqual(ALPHA); // control: the target did change
        expect(withSceneDefault(CAT, 'cccc3333', sceneDefaultPatch(TUNED))).toBeNull();
    });
});

// ---- the real admin API server
const PASSWORD = 'made-up-test-password-not-used-anywhere-7f3a';
const DRIVER = [
    'import os, sys',
    'sys.path.insert(0, sys.argv[1])',
    'import admin',
    'os.environ["ADMIN_PASSWORD_HASH"] = admin.make_hash(sys.argv[2])',
    'import server',
    'from http.server import ThreadingHTTPServer',
    's = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)',
    'print(s.server_address[1], flush=True)',
    's.serve_forever()'
].join('\n');

let proc: ChildProcess | null = null;
let dataDir = '';
let base = '';
const realFetch = globalThis.fetch;
const jar = { cookie: '' };
const posts: string[] = [];

beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'gsfpv-scene-default-'));
    // a clean environment: the data folder and the bare minimum to run Python (no TG_*, no real hash)
    const env: Record<string, string> = { DATA_DIR: dataDir, PYTHONIOENCODING: 'utf-8' };
    for (const k of ['PATH', 'Path', 'SYSTEMROOT', 'SystemRoot', 'TEMP', 'TMP']) if (process.env[k]) env[k] = process.env[k]!;
    proc = spawn(process.env.PYTHON ?? 'python', ['-I', '-c', DRIVER, join(REPO, 'apps', 'api'), PASSWORD], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    proc.stderr!.on('data', (d) => { err += String(d); });
    const port = await new Promise<number>((resolve, reject) => {
        proc!.stdout!.once('data', (d) => resolve(Number(String(d).trim())));
        proc!.once('exit', (c) => reject(new Error(`API server exited ${c}: ${err.slice(0, 500)}`)));
    });
    base = `http://127.0.0.1:${port}`;
    // the page's relative fetch, against that server, with the browser's cookie jar
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
        const headers = new Headers(init?.headers);
        if (jar.cookie) headers.set('Cookie', jar.cookie);
        if ((init?.method ?? 'GET') === 'POST') posts.push(url);
        const r = await realFetch(base + url, { method: init?.method, body: init?.body, headers });
        const set = r.headers.get('set-cookie');
        if (set) {
            const kv = set.split(';')[0];
            jar.cookie = kv.endsWith('=') ? '' : kv;
        }
        return r;
    }) as typeof fetch;
}, 30000);

afterAll(() => {
    globalThis.fetch = realFetch;
    proc?.kill();
    try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* Windows may hold it a moment */ }
});

const draftOf = async (c: AdminClient): Promise<SceneCatalog> => (await c.get<{ draft: SceneCatalog }>('catalog')).draft;

describe('the save through the admin API (session cookie + X-CSRF, the server cleans the draft)', () => {
    it('saves a tuned flight into the scan\'s draft entry, the other scan untouched; controls: no CSRF, no session, unknown scan', async () => {
        const admin = new AdminClient();
        expect(await admin.login(PASSWORD)).toEqual({ ok: true });
        await admin.post('catalog/draft', { catalog: CAT });
        const before = await draftOf(admin);
        const betaBefore = before.scenes.find((s) => s.id === BETA.id);

        // wind switched off: the server keeps the entry's climate wind
        expect((await saveSceneDefault(admin, ALPHA.id, { ...TUNED, wind: { source: 'off' } })).ok).toBe(true);
        expect((await draftOf(admin)).scenes.find((s) => s.id === ALPHA.id)!.wind).toEqual(ALPHA.wind);

        const r = await saveSceneDefault(admin, ALPHA.id, TUNED);
        expect(r.ok).toBe(true);
        const after = await draftOf(admin);
        const a = after.scenes.find((s) => s.id === ALPHA.id)!;
        expect({ walls: a.walls, dropFloaters: a.dropFloaters, scale: a.scale, ceilingM: a.ceilingM, wind: a.wind })
            .toEqual({ walls: 'off', dropFloaters: 6, scale: 2, ceilingM: 12.5, wind: { fromDeg: 0, speed: 5, gust: 2, source: 'manual' } });
        expect(a.title).toBe(ALPHA.title);
        expect(after.scenes.find((s) => s.id === BETA.id)).toEqual(betaBefore);

        // back to the catalogue defaults: the server keeps the fields absent; the scan's wind stays
        expect((await saveSceneDefault(admin, ALPHA.id, PLAIN)).ok).toBe(true);
        const plain = (await draftOf(admin)).scenes.find((s) => s.id === ALPHA.id)!;
        for (const k of ['ceilingM', 'dropFloaters', 'scale'] as const) expect(k in plain).toBe(false);
        expect(plain.wind).toEqual({ fromDeg: 0, speed: 5, gust: 2, source: 'manual' });

        // control: an unknown scan is refused before any write
        const n = posts.length;
        expect(await saveSceneDefault(admin, 'cccc3333', TUNED)).toEqual({ ok: false, why: 'not-in-catalogue' });
        expect(posts.length).toBe(n);

        // control: the same browser session without the CSRF token (a page that never asked /session) is refused
        const noCsrf = new AdminClient();
        expect(await saveSceneDefault(noCsrf, ALPHA.id, TUNED)).toEqual({ ok: false, why: 'session' });
        expect((await draftOf(admin)).scenes.find((s) => s.id === ALPHA.id)).toEqual(plain);
        // ... and once it asks, it may (the flight page's path: resume() then save)
        expect(await noCsrf.resume()).toBe(true);
        expect((await saveSceneDefault(noCsrf, ALPHA.id, TUNED)).ok).toBe(true);

        // control: signed out, nothing is written
        await admin.logout();
        expect(jar.cookie).toBe('');
        expect(await saveSceneDefault(admin, ALPHA.id, PLAIN)).toEqual({ ok: false, why: 'session' });
    }, 30000);

    it('the admin hint follows the session: set by a login, cleared by a logout and by a 401; no storage = no hint', async () => {
        const mem = new Map<string, string>();
        const g = globalThis as { localStorage?: unknown };
        g.localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
        try {
            const c = new AdminClient();
            expect(adminHinted()).toBe(false);
            expect(await c.login(PASSWORD)).toEqual({ ok: true });
            expect(mem.get(ADMIN_HINT_KEY)).toBe('1');
            expect(adminHinted()).toBe(true);
            await c.logout();
            expect(adminHinted()).toBe(false);
            // a stale hint (the session ended elsewhere): /session answers 401 and the hint goes
            mem.set(ADMIN_HINT_KEY, '1');
            expect(await c.resume()).toBe(false);
            expect(adminHinted()).toBe(false);
        } finally {
            delete g.localStorage;
        }
        expect(adminHinted()).toBe(false);
    }, 30000);
});
