// The page's preferences store as the fly app opens it (apps/fly/src/app/prefs.ts, the lead step
// before wave 2 in docs/architecture-v03.md J): one store per page, the v0.2 keys migrated at the
// first v0.3 boot, the URL's settings in the session layer, a real PresetResolver. The claim: for a
// setting the first boot migrated, the store gives the value the app itself uses, at the first
// boot, after the pilot changes it through the app, and at the next boot. Checked for the stick
// mode (controls.ts getStickMode). The walls switch has no key of its own any more: the store is
// its only place (one choice for every scan), and the flight follows the store (app/walls.ts).
// Negative controls: a writer that bypasses the bridge, a store without the migration, the
// per-scan walls rule, a resolver without the presets: each must give a mismatch.
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

describe('walls switch: one choice for every scan, and the flight follows the store', () => {
    // two scans: the admin switches the walls of NOISY off by default, CLEAN keeps them on
    const NOISY = '7a475d38', CLEAN = '39e63ce9';
    const showcase: ShowcaseScene[] = [{ ...SHOWCASE[0], id: NOISY, walls: 'off' }, { ...SHOWCASE[0], id: CLEAN, walls: 'on' }];
    /** a fake flight on a scan with walls: what FlightSession.start was given, and setWallsOn */
    const flight = (on: boolean) => ({ collision: {}, wallsOn: on, lives: 0, setWallsOn(v: boolean) { if (v === this.wallsOn) return false; this.wallsOn = v; this.lives++; return true; } });
    type Fake = ReturnType<typeof flight>;
    /** the page: its store, the walls host, the 'walls' events, and a scene switch as scene-host.ts does it */
    function page(query = '', start = CLEAN) {
        const store = openPage(showcase, query);
        let session: Fake = flight(FW.wallsWanted(store, start));
        let scene: SceneRef = { id: start, meta: showcase.find((x) => x.id === start) };
        const events = new CX.Bus<import('../../../apps/fly/src/app/context').AppEvents>();
        const seen: boolean[] = [];
        events.on('walls', ({ on }) => seen.push(on));
        const walls = W.wallsHost({ session: () => session as never, scene: () => scene, events, clearCrash: () => undefined, prefs: store });
        const switchTo = (id: string, made: Fake = flight(FW.wallsWanted(store, id))) => {
            session = made; // scene-host.ts: wallsOn: wallsWanted(ctx.prefs, id), then Flight.swapSession
            scene = { id, meta: showcase.find((x) => x.id === id) };
            events.emit('session', session as never);
        };
        return { store, walls, seen, switchTo, live: () => session.wallsOn, session: () => session };
    }

    it('the owner\'s case: off on one scan stays off on the next, also on a scan whose author has them on', () => {
        freshStorage();
        const p = page('', CLEAN);
        expect(p.live()).toBe(true);
        p.walls.set(false); // C
        expect([p.live(), p.seen]).toEqual([false, [false]]);
        p.switchTo(NOISY);
        expect(p.live()).toBe(false);
        p.switchTo(CLEAN);
        expect(p.live()).toBe(false);
        // the next page load, on either scan
        expect([FW.wallsWanted(openPage(showcase), CLEAN), FW.wallsWanted(openPage(showcase), NOISY)]).toEqual([false, false]);
    });

    it('control: the per-scan rule this replaces (the admin\'s value of the new scan) flies the next scan with walls on', () => {
        freshStorage();
        const p = page('', CLEAN);
        p.walls.set(false);
        p.switchTo(CLEAN);
        const perScan = showcase.find((x) => x.id === CLEAN)!.walls !== 'off';
        // the check of the test above (the next scan flies without walls) fails on the old rule
        expect([perScan, p.live()]).toEqual([true, false]);
    });

    it('a pilot who never chose gets the author\'s value per scan; on again, every scan has walls', () => {
        freshStorage();
        const p = page('', NOISY);
        expect(p.live()).toBe(false);
        expect(p.walls.adminOff).toBe(true);
        p.switchTo(CLEAN);
        expect(p.live()).toBe(true);
        p.walls.set(false);
        p.walls.set(true);
        p.switchTo(NOISY);
        expect([p.live(), p.walls.adminOff]).toEqual([true, false]);
    });

    it('Settings, a reset or an import changes the store: the flight follows at once, one new life each', () => {
        freshStorage();
        const p = page('', CLEAN);
        p.store.set('scene.walls', 'off'); // the Settings row
        expect([p.live(), p.session().lives]).toEqual([false, 1]);
        p.store.reset('scene.walls'); // back to the author's value (CLEAN: on)
        expect([p.live(), p.session().lives]).toEqual([true, 2]);
        const file = p.store.exportFile();
        file.settings.global['scene.walls'] = 'off';
        p.store.importFile(file);
        expect([p.live(), p.seen]).toEqual([false, [false, true, false]]);
        p.store.set('flight.mode', 'acro'); // another setting: nothing happens to the walls
        expect(p.session().lives).toBe(3);
    });

    it('?walls= holds for this load on every scan; the pilot\'s switch replaces it and is stored; the hook\'s is not', () => {
        freshStorage();
        const p = page('walls=off', CLEAN);
        expect(p.live()).toBe(false);
        p.switchTo(NOISY);
        expect(p.live()).toBe(false);
        p.walls.set(true);
        expect([p.live(), p.session().lives, p.store.isExplicit('scene.walls')]).toEqual([true, 1, true]);
        p.walls.set(false, false); // __gsfpv.wallsSwitch.set: this load only
        expect(p.live()).toBe(false);
        expect(FW.wallsWanted(openPage(showcase), NOISY)).toBe(true);
    });

    it('a change while the next scan loads reaches it when it starts (the session event)', () => {
        freshStorage();
        const p = page('', NOISY);
        const made = flight(FW.wallsWanted(p.store, CLEAN)); // the next scan starts loading with walls on
        expect(made.wallsOn).toBe(true);
        p.store.set('scene.walls', 'off'); // e.g. Settings in another tab, while it loads
        p.switchTo(CLEAN, made);
        expect(p.live()).toBe(false);
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
