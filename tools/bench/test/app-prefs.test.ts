// The page's preferences store as the fly app opens it (apps/fly/src/app/prefs.ts, the lead step
// before wave 2 in docs/architecture-v03.md J): one store per page, the v0.2 keys migrated at the
// first v0.3 boot, the URL's settings in the session layer, a real PresetResolver. The claim: for a
// setting the first boot migrated, the store gives the value the app itself uses, at the first
// boot, after the pilot changes it through the app, and at the next boot. Checked for the stick
// mode (controls.ts getStickMode) and the walls switch (flightwalls.ts initialWallsOn over the
// admin's showcase.json value, the pilot's key and ?walls=, then app/walls.ts switching).
// Negative controls: a writer that bypasses the bridge, a store without the migration, a walls
// host without the bridge, a resolver without the presets: each must give a mismatch.
// Node: the app modules read location, document and matchMedia when they load, so those are
// stubbed first and the modules are imported after.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FakeStorage, REPO, resolver } from '../../../packages/prefs/test/helpers';
import { MemoryBackend, PrefsStore, SCHEMA } from '../../../packages/prefs/src';
import type { ShowcaseScene } from '../../../apps/fly/src/ui/scenes';
import type { SceneRef } from '../../../apps/fly/src/app/context';

type AppPrefs = typeof import('../../../apps/fly/src/app/prefs');
type AppControls = typeof import('../../../apps/fly/src/controls');
type AppWalls = typeof import('../../../apps/fly/src/app/walls');
type FlightWalls = typeof import('../../../apps/fly/src/flightwalls');
type AppContext = typeof import('../../../apps/fly/src/app/context');

let P: AppPrefs, C: AppControls, W: AppWalls, FW: FlightWalls, CX: AppContext;
/** the page's localStorage; each test puts a fresh one in place */
let storage = new FakeStorage();

beforeAll(async () => {
    vi.stubGlobal('location', { search: '', pathname: '/fly/', href: 'http://127.0.0.1/fly/', origin: 'http://127.0.0.1' });
    vi.stubGlobal('document', { cookie: '', documentElement: { lang: '' } });
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    vi.stubGlobal('localStorage', storage);
    P = await import('../../../apps/fly/src/app/prefs');
    C = await import('../../../apps/fly/src/controls');
    W = await import('../../../apps/fly/src/app/walls');
    FW = await import('../../../apps/fly/src/flightwalls');
    CX = await import('../../../apps/fly/src/app/context');
});

afterEach(() => P.closePagePrefs());

function freshStorage(init: Record<string, string> = {}): FakeStorage {
    storage = new FakeStorage(init);
    vi.stubGlobal('localStorage', storage);
    return storage;
}

/** One page load: the store as boot.ts opens it, on this test's storage, with no IndexedDB and no listeners. */
function openPage(showcase: readonly ShowcaseScene[], query = ''): PrefsStore {
    P.closePagePrefs();
    return P.openPagePrefs(showcase, query, {
        storage: storage as unknown as Storage,
        win: null,
        doc: null,
        cookieDoc: null,
        debounceMs: 0,
        openKv: async () => ({ get: async () => undefined, put: async () => undefined, close: () => undefined })
    });
}

const SHOWCASE = (JSON.parse(readFileSync(join(REPO, 'apps', 'fly', 'public', 'showcase.json'), 'utf8')) as { scenes: ShowcaseScene[] }).scenes;

describe('ctx.prefs: one store per page', () => {
    it('opens once: a second open gives the same store; the v0.2 keys are migrated on the first boot only', () => {
        freshStorage({ 'gsfpv.stickMode': '1', 'gsfpv.warned': '1' });
        const a = openPage(SHOWCASE);
        expect(P.openPagePrefs(SHOWCASE, '')).toBe(a);
        expect(P.pagePrefs()).toBe(a);
        expect(a.migrated?.from).toBe(0);
        expect(a.migrated?.moved).toEqual(expect.arrayContaining(['gsfpv.stickMode', 'gsfpv.warned']));
        expect(storage.m.has('gsfpv.prefs.v1')).toBe(true);
        // the legacy keys are only read (rollback to v0.2 still finds them)
        expect(storage.writes.filter((k) => k !== 'gsfpv.prefs.v1')).toEqual([]);
        const b = openPage(SHOWCASE);
        expect(b).not.toBe(a);
        expect(b.migrated).toBeNull();
        expect(b.collection('ui').warned).toBe(true);
    });

    it('the resolver: drone preset fields and the admin\'s walls default reach the defaults', () => {
        freshStorage();
        const scenes: ShowcaseScene[] = [...SHOWCASE, { id: 'abcdef12', title: 'noisy', author: 'x', license: 'x', kind: 'interior', collision: true, walls: 'off' }];
        const s = openPage(scenes);
        expect(s.defaultOf('physics.vCrash', { drone: 'pavo20pro-3s' })).toBe(4);
        expect(s.defaultOf('camera.fovDeg', { drone: 'pavo20pro-3s' })).toBe(115);
        expect(s.defaultOf('physics.idlePct', { drone: 'pavo20pro-3s' })).toBeCloseTo(10, 9);
        expect(s.defaultOf('scene.walls', { scene: 'abcdef12' })).toBe('off');
        expect(s.defaultOf('scene.walls', { scene: '39e63ce9' })).toBe('on');
        expect(s.defaultOf<{ s: number }>('scene.transform', { scene: '39e63ce9' }).s).toBe(1);
        // control: the same store without presets or the curated list falls back
        const bare = new PrefsStore(SCHEMA, new MemoryBackend(), { field: () => undefined });
        expect(bare.defaultOf('physics.idlePct', { drone: 'pavo20pro-3s' })).toBe(5.5);
        expect(bare.defaultOf('scene.walls', { scene: 'abcdef12' })).toBe('on');
    });

    it('the URL\'s settings go into the session layer and are never stored', () => {
        freshStorage();
        const s = openPage(SHOWCASE, 'scene=39e63ce9&drone=pavopico-2s&g=1.62&walls=off&set.display.hud=0');
        expect(s.get('drone.current')).toBe('pavopico-2s');
        expect(s.get('physics.gravity')).toBe(1.62);
        expect(s.get('scene.walls', { scene: '39e63ce9' })).toBe('off');
        expect(s.get('display.hud')).toBe(false);
        expect(s.explicitList()).toEqual([]);
    });

    it('window.__gsfpv.prefs: get, set, reset, explicitList, export', () => {
        freshStorage();
        const hook = P.prefsHook(openPage(SHOWCASE));
        expect(hook.writable()).toBe(true);
        expect(hook.set('physics.vCrash', 6.5, { drone: 'pavo20pro-3s' })).toEqual({ ok: true, value: 6.5, clamped: false });
        expect(hook.get('physics.vCrash', { drone: 'pavo20pro-3s' })).toBe(6.5);
        expect(hook.explicitList()).toEqual([{ id: 'physics.vCrash', scope: 'drone', key: 'pavo20pro-3s', value: 6.5 }]);
        expect((hook.export().settings.drone as Record<string, Record<string, unknown>>)['pavo20pro-3s']['physics.vCrash']).toBe(6.5);
        hook.reset('physics.vCrash', { drone: 'pavo20pro-3s' });
        expect(hook.get('physics.vCrash', { drone: 'pavo20pro-3s' })).toBe(4);
        expect(hook.explicitList()).toEqual([]);
    });
});

describe('stick mode: the store gives the value the app uses', () => {
    const app = () => String(C.getStickMode());

    it('first boot, a change on the Controls screen, the next boot: equal each time', () => {
        freshStorage({ 'gsfpv.stickMode': '1' });
        const s = openPage(SHOWCASE);
        expect(app()).toBe('1');
        expect(s.get('input.stickMode')).toBe(app());
        expect(s.isExplicit('input.stickMode')).toBe(true);
        C.setStickMode(2); // the Controls screen's writer
        expect(app()).toBe('2');
        expect(s.get('input.stickMode')).toBe(app());
        C.setStickMode(1);
        const next = openPage(SHOWCASE);
        expect(next.migrated).toBeNull();
        expect(next.get('input.stickMode')).toBe(app());
        expect(app()).toBe('1');
    });

    it('never chosen: the default 2 on both sides, and nothing explicit', () => {
        freshStorage();
        const s = openPage(SHOWCASE);
        expect(s.get('input.stickMode')).toBe(app());
        expect(s.isExplicit('input.stickMode')).toBe(false);
    });

    it('the app reads the store, not v0.2\'s key (wave 2, W2-3): a v0.2-style write to that key after the first boot changes nothing', () => {
        freshStorage({ 'gsfpv.stickMode': '1' });
        const s = openPage(SHOWCASE);
        storage.setItem('gsfpv.stickMode', '2');
        expect(app()).toBe('1');
        expect(s.get('input.stickMode')).toBe(app());
    });

    it('control: a store that did not migrate gives the default, not the pilot\'s mode 1', () => {
        freshStorage({ 'gsfpv.stickMode': '1' });
        openPage(SHOWCASE);
        const unmigrated = new PrefsStore(SCHEMA, new MemoryBackend(), resolver());
        expect(unmigrated.get('input.stickMode')).not.toBe(app());
    });
});

describe('walls switch: the store gives the value the app uses', () => {
    const SCENE = '39e63ce9';
    type Admin = 'on' | 'off' | undefined;
    type Stored = 'on' | 'off' | null;
    const showcaseWith = (admin: Admin): ShowcaseScene[] => SHOWCASE.map((s) => {
        if (s.id !== SCENE) return s;
        const { walls: _drop, ...rest } = s;
        return admin === undefined ? rest : { ...rest, walls: admin };
    });
    /** what app/flight.ts starts the flight with */
    const appInitial = (admin: Admin, forced: string | null) => (FW.initialWallsOn(admin, FW.loadWallsChoice(SCENE), forced) ? 'on' : 'off');
    const bootCase = (admin: Admin, stored: Stored, forced: string | null) => {
        freshStorage(stored === null ? {} : { [`gsfpv.walls.${SCENE}`]: stored });
        const s = openPage(showcaseWith(admin), forced === null ? `scene=${SCENE}` : `scene=${SCENE}&walls=${forced}`);
        return { store: s.get<string>('scene.walls', { scene: SCENE }), app: appInitial(admin, forced) };
    };
    const CASES: [Admin, Stored, string | null][] = [];
    for (const a of ['on', 'off', undefined] as Admin[]) for (const st of ['on', 'off', null] as Stored[]) for (const f of [null, 'on', 'off', 'junk']) CASES.push([a, st, f]);

    it('first boot: the same answer in all 36 cases of admin default, the pilot\'s v0.2-era key and ?walls=', () => {
        const bad = CASES.map(([a, st, f]) => ({ a, st, f, ...bootCase(a, st, f) })).filter((r) => r.store !== r.app);
        expect(bad).toEqual([]);
    });

    /** a flight's walls host over a fake session (walls loaded, switch state in wallsOn) */
    function host(prefs: PrefsStore | null, admin: Admin, on: boolean) {
        const session = { collision: {}, wallsOn: on, setWallsOn(v: boolean) { if (v === this.wallsOn) return false; this.wallsOn = v; return true; } };
        const scene: SceneRef = { id: SCENE, meta: showcaseWith(admin).find((s) => s.id === SCENE) };
        const h = W.wallsHost({ session: () => session as never, scene: () => scene, events: new CX.Bus(), clearCrash: () => undefined, prefs });
        return { h, live: () => (session.wallsOn ? 'on' : 'off') };
    }

    it('switched by the pilot (remembered), by the test hook (this load only), then the next boot: equal each time', () => {
        const rows: { step: string; store: string; app: string }[] = [];
        for (const admin of ['on', 'off', undefined] as Admin[]) for (const forced of [null, 'off', 'on']) {
            freshStorage();
            const q = forced === null ? `scene=${SCENE}` : `scene=${SCENE}&walls=${forced}`;
            let s = openPage(showcaseWith(admin), q);
            const { h, live } = host(s, admin, appInitial(admin, forced) === 'on');
            const get = () => s.get<string>('scene.walls', { scene: SCENE });
            rows.push({ step: `${admin}/${forced} boot`, store: get(), app: live() });
            h.set(live() !== 'on'); // walls menu / C / Settings: remembered
            rows.push({ step: `${admin}/${forced} pilot`, store: get(), app: live() });
            h.set(live() !== 'on', false); // __gsfpv.wallsSwitch.set: this load only
            rows.push({ step: `${admin}/${forced} hook`, store: get(), app: live() });
            s = openPage(showcaseWith(admin), q); // the next page load
            rows.push({ step: `${admin}/${forced} next boot`, store: get(), app: appInitial(admin, forced) });
        }
        expect(rows.filter((r) => r.store !== r.app)).toEqual([]);
        expect(rows.length).toBe(36);
    });

    it('control: a walls host without the bridge leaves the store behind, and the check sees it', () => {
        freshStorage();
        const s = openPage(showcaseWith('on'), `scene=${SCENE}`);
        const { h, live } = host(null, 'on', true);
        h.set(false);
        expect(live()).toBe('off');
        expect(s.get('scene.walls', { scene: SCENE })).not.toBe(live());
    });
});

describe('first-visit warning', () => {
    it('answered in this page: the ui collection follows (boot.ts mirrorWarned); control: without it the store says not warned', () => {
        freshStorage();
        const s = openPage(SHOWCASE);
        const app = () => storage.getItem('gsfpv.warned') === '1';
        expect(s.collection('ui').warned).toBe(app());
        storage.setItem('gsfpv.warned', '1'); // boot.ts's own write
        expect(s.collection('ui').warned).not.toBe(app()); // control: the store is behind until the bridge runs
        P.mirrorWarned(s);
        expect(s.collection('ui').warned).toBe(app());
        expect(openPage(SHOWCASE).collection('ui').warned).toBe(true);
    });
});
