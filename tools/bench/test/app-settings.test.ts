// W2-1 settings and persistence (docs/architecture-v03.md A.7-A.11; owner's items 12, 13, 20; review
// findings C1/C10/C11/C16; defects D-c, D-h), the parts that run without a page:
//  - per-drone values: the flight model of a drone is built from that drone's own values only;
//  - every setting the screen shows for the flight model really changes sim-core's model, and the
//    camera never does (D-h);
//  - 'life' settings go on the flight once (applyModel), not again when nothing changed;
//  - a pilot's change wins over the link's value, now and in the address bar (item 20 after a reload);
//  - the walls follow the store without turning a reset into an explicit value;
//  - Erase everything also clears the keys the app still reads before their owners move them;
//  - the screen's model: search, deep-link targets, numbers, the import preview's counts.
// Every claim has a negative control: the v0.2 path (one shared overrides object, a plain set, a
// mirror that is not held back...) gives the wrong answer on the same input.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileParams } from '@gsfpv/sim-core';
import type { ParamOverrides, PresetJson } from '@gsfpv/sim-core';
import { FakeStorage, REPO } from '../../../packages/prefs/test/helpers';
import { MemoryBackend, PrefsStore, SCHEMA, emptyDoc } from '../../../packages/prefs/src';
import type { ImportReport, SettingDef } from '../../../packages/prefs/src';
import type { ShowcaseScene } from '../../../apps/fly/src/ui/scenes';

type AppPrefs = typeof import('../../../apps/fly/src/app/prefs');
type Model = typeof import('../../../apps/fly/src/ui/settings/model');
type Presets = typeof import('../../../apps/fly/src/presets');

let P: AppPrefs, M: Model, PR: Presets;
let storage = new FakeStorage();
/** the address bar as history.replaceState leaves it */
let href = 'http://127.0.0.1/fly/';

beforeAll(async () => {
    vi.stubGlobal('location', { get href() { return href; }, search: '', pathname: '/fly/', origin: 'http://127.0.0.1' });
    vi.stubGlobal('history', { state: null, replaceState: (_s: unknown, _t: string, u: URL | string) => { href = String(u); } });
    vi.stubGlobal('document', { cookie: '', documentElement: { lang: '' } });
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    vi.stubGlobal('localStorage', storage);
    P = await import('../../../apps/fly/src/app/prefs');
    M = await import('../../../apps/fly/src/ui/settings/model');
    PR = await import('../../../apps/fly/src/presets');
});

afterEach(() => P.closePagePrefs());

const SHOWCASE = (JSON.parse(readFileSync(join(REPO, 'apps', 'fly', 'public', 'showcase.json'), 'utf8')) as { scenes: ShowcaseScene[] }).scenes;

function freshStorage(init: Record<string, string> = {}): FakeStorage {
    storage = new FakeStorage(init);
    vi.stubGlobal('localStorage', storage);
    return storage;
}

/** One page load, as boot.ts opens the store, with this URL. */
function openPage(query = ''): PrefsStore {
    P.closePagePrefs();
    href = `http://127.0.0.1/fly/${query ? `?${query}` : ''}`;
    return P.openPagePrefs(SHOWCASE, query, { storage: storage as unknown as Storage, win: null, doc: null, cookieDoc: null, debounceMs: 0, openKv: async () => ({ get: async () => undefined, put: async () => undefined, close: () => undefined }) });
}

/** A store on memory, the app's presets and showcase, no page. */
function memStore(): PrefsStore {
    return new PrefsStore(SCHEMA, new MemoryBackend(), P.presetResolver(PR.PRESETS, SHOWCASE), { debounceMs: 0 });
}

const model = (store: PrefsStore, drone: string) => compileParams(PR.PRESETS[drone], P.overridesFor(store, drone));
const PAVO = 'pavo20pro-3s', METEOR = 'meteor65pro-1s', AIR = 'air65-1s';

describe('per drone: a drone flies its own values (D-c, review C1/C10)', () => {
    it('tau, FOV and PID set on the Pavo20 stay the Pavo\'s; the Meteor flies its preset; a reload keeps both', () => {
        freshStorage();
        const s = openPage();
        P.pilotSet(s, 'physics.tauMs', 25, { drone: PAVO });
        P.pilotSet(s, 'camera.fovDeg', 130, { drone: PAVO });
        P.pilotSet(s, 'tune.pid', { roll: [60, 100, 40, 0], pitch: [60, 100, 40, 0], yaw: [50, 90, 0, 0] }, { drone: PAVO });
        P.pilotSet(s, 'drone.current', METEOR);
        expect(P.droneOf(s)).toBe(METEOR);
        expect(P.overridesFor(s, METEOR)).toEqual({});
        expect(model(s, METEOR).tau).toBeCloseTo(PR.PRESETS[METEOR].fields.motor_tau_ms.value as number / 1000, 9);
        expect(P.cameraFor(s, METEOR).fovDeg).toBe(115);
        expect(model(s, PAVO).tau).toBeCloseTo(0.025, 9);
        expect(P.cameraFor(s, PAVO).fovDeg).toBe(130);
        // a reload (a new page on the same storage): the same values, the same drone
        const r = openPage();
        expect(P.droneOf(r)).toBe(METEOR);
        expect(model(r, PAVO).tau).toBeCloseTo(0.025, 9);
        expect(model(r, PAVO).pid.roll).toEqual([60, 100, 40, 0]);
        expect(model(r, METEOR).tau).toBeCloseTo(0.010, 9);
    });

    it('control: v0.2\'s one overrides object handed to the next drone gives the Meteor the Pavo\'s tau and FOV', () => {
        const shared: ParamOverrides = { tauMs: 25, fovDeg: 130 };
        const meteor = compileParams(PR.PRESETS[METEOR], shared);
        expect(meteor.tau).toBeCloseTo(0.025, 9);
        expect(meteor.cameraFovDeg).toBe(130);
        expect(meteor.tau).not.toBeCloseTo(model(memStore(), METEOR).tau, 6);
    });
});

/** A value other than the default, in range, for each setting the screen shows for the flight model. */
const CHANGES: Record<string, { v: unknown; field: (p: ReturnType<typeof compileParams>) => unknown }> = {
    'physics.vCrash': { v: 6.5, field: (p) => p.vCrash },
    // shipped by W2-2 (crashes off, item 3): the model's crashOn flag
    'crash.enabled': { v: false, field: (p) => p.crashOn },
    'physics.gravity': { v: 1.62, field: (p) => p.gravity },
    'physics.gravityMode': { v: 'same-twr', field: (p) => p.gravityMode },
    'physics.twr': { v: 3, field: (p) => p.twr },
    'physics.tauMs': { v: 25, field: (p) => p.tau },
    'physics.dragScale': { v: 1.5, field: (p) => JSON.stringify(p) },
    'physics.ductDrag': { v: 1.2, field: (p) => p.ductDrag },
    'physics.propInertia': { v: 2, field: (p) => p.rotorInertia },
    'physics.idlePct': { v: 3, field: (p) => p.idle },
    'tune.pid': { v: { roll: [60, 100, 40, 0], pitch: [60, 100, 40, 0], yaw: [50, 90, 0, 0] }, field: (p) => p.pid },
    'tune.rates': { v: { type: 'BETAFLIGHT', roll: { rcRate: 100, rate: 70, expo: 0 }, pitch: { rcRate: 100, rate: 70, expo: 0 }, yaw: { rcRate: 100, rate: 70, expo: 0 }, rateLimit: 1998 }, field: (p) => p.rates },
    'tune.throttle': { v: { mid: 40, expo: 30 }, field: (p) => p.throttle }
};

describe('each flight-model row the screen shows changes sim-core\'s model (and nothing else does)', () => {
    const shownModelRows = (): SettingDef[] => SCHEMA.defs.filter((d) => d.status === 'shipped' && P.FLIGHT_MODEL_SETTINGS.includes(d.id));

    it('every shipped flight-model setting has a test value here, so a newly shipped one cannot pass untested', () => {
        expect(shownModelRows().map((d) => d.id).sort()).toEqual(Object.keys(CHANGES).filter((id) => SCHEMA.byId.get(id)?.status === 'shipped').sort());
    });

    for (const [id, c] of Object.entries(CHANGES)) {
        it(`${id}: set for the drone flown -> the model differs; reset -> the preset's model again`, () => {
            const s = memStore();
            const before = c.field(model(s, PAVO));
            P.pilotSet(s, id, c.v, { drone: PAVO });
            expect(c.field(model(s, PAVO))).not.toEqual(before);
            // a per-drone value stays that drone's: the Air65 keeps its own model (gravity is one world for all)
            const air = JSON.stringify(model(s, AIR)) === JSON.stringify(compileParams(PR.PRESETS[AIR]));
            expect(air).toBe(SCHEMA.byId.get(id)!.scope === 'drone');
            P.pilotReset(s, id, { drone: PAVO });
            expect(c.field(model(s, PAVO))).toEqual(before);
        });
    }

    it('D-h: FOV and uptilt are render-only: the flight model is byte for byte the preset\'s', () => {
        const s = memStore();
        P.pilotSet(s, 'camera.fovDeg', 140, { drone: PAVO });
        P.pilotSet(s, 'camera.uptiltDeg', 40, { drone: PAVO });
        expect(P.overridesFor(s, PAVO)).toEqual({});
        expect(JSON.stringify(model(s, PAVO))).toBe(JSON.stringify(compileParams(PR.PRESETS[PAVO])));
        expect(P.cameraFor(s, PAVO)).toEqual({ fovDeg: 140, uptiltDeg: 40 });
    });

    it('control: v0.2 put FOV into the overrides, which changes the compiled model (a rebuild, back to the spawn)', () => {
        const v02 = compileParams(PR.PRESETS[PAVO], { fovDeg: 140 });
        expect(JSON.stringify(v02)).not.toBe(JSON.stringify(compileParams(PR.PRESETS[PAVO])));
    });
});

describe('life settings go on the flight once (A.7)', () => {
    function fakeSession() {
        const calls: { drone: string; o: ParamOverrides }[] = [];
        const session = {
            presetId: PAVO,
            overrides: {} as ParamOverrides,
            applyLifeSettings(drone: string, o: ParamOverrides) { calls.push({ drone, o }); this.presetId = drone; this.overrides = o; }
        };
        return { session, calls };
    }

    it('several changes while the screen is open -> one new model at close; a second close changes nothing', () => {
        const s = memStore();
        const { session, calls } = fakeSession();
        expect(P.applyModel(session, s)).toBe(false);
        P.pilotSet(s, 'physics.vCrash', 6.5, { drone: PAVO });
        P.pilotSet(s, 'physics.tauMs', 20, { drone: PAVO });
        P.pilotSet(s, 'camera.fovDeg', 100, { drone: PAVO });
        expect(P.applyModel(session, s)).toBe(true);
        expect(calls).toEqual([{ drone: PAVO, o: { vCrash: 6.5, tauMs: 20 } }]);
        expect(P.applyModel(session, s)).toBe(false);
        expect(calls).toHaveLength(1);
    });

    it('control: a session with v0.2 leftovers in its overrides (FOV inside) is seen as another model', () => {
        const s = memStore();
        const { session } = fakeSession();
        session.overrides = { fovDeg: 115 };
        expect(P.modelDiffers(session, s)).toBe(true);
    });
});

describe('a pilot\'s change wins over the link (item 20: "they came back to defaults")', () => {
    it('?drone= and ?g= set this load; picking a drone stores it and takes ?drone= out of the address bar; ?g= stays', () => {
        freshStorage();
        const s = openPage(`scene=39e63ce9&drone=${AIR}&g=1.62`);
        expect(P.droneOf(s)).toBe(AIR);
        expect(s.get('physics.gravity')).toBe(1.62);
        P.pilotSet(s, 'drone.current', 'pavopico-2s');
        expect(P.droneOf(s)).toBe('pavopico-2s');
        const u = new URL(href);
        expect(u.searchParams.has('drone')).toBe(false);
        expect(u.searchParams.get('g')).toBe('1.62');
        expect(u.searchParams.get('scene')).toBe('39e63ce9');
        // the next load opens that address: the pilot's drone
        const r = openPage(u.search.slice(1));
        expect(P.droneOf(r)).toBe('pavopico-2s');
    });

    it('control: a plain store.set leaves the link\'s value in charge (the change seems lost)', () => {
        freshStorage();
        const s = openPage(`drone=${AIR}`);
        s.set('drone.current', 'pavopico-2s');
        expect(P.droneOf(s)).toBe(AIR);
        expect(new URL(href).searchParams.get('drone')).toBe(AIR);
    });

    it('a link value out of range is clamped (review C11: v0.2 passed ?g= unchecked)', () => {
        freshStorage();
        const s = openPage('g=50');
        expect(s.get('physics.gravity')).toBe(30);
        expect(P.overridesFor(s, PAVO).gravity).toBe(30);
    });
});

describe('the walls follow the store (applyWalls)', () => {
    /** app/walls.ts's switch: a new model, the scan's key, and the mirror into the store */
    function fakeWalls(s: PrefsStore, scene: string, on = true) {
        const w = {
            on: on,
            sets: 0,
            has: () => true,
            isOn: () => w.on,
            set(v: boolean, remember = true) {
                w.on = v;
                w.sets++;
                if (remember) storage.setItem(`gsfpv.walls.${scene}`, v ? 'on' : 'off');
                P.mirrorWallsChoice(scene, v, remember, s);
            }
        };
        return { has: w.has, on: () => w.isOn(), set: (v: boolean, r?: boolean) => w.set(v, r), w };
    }
    const SCENE = '39e63ce9';

    it('a value from Settings goes on the switch; a reset goes back to the default without becoming explicit', () => {
        freshStorage();
        const s = openPage();
        const walls = fakeWalls(s, SCENE);
        P.pilotSet(s, 'scene.walls', 'off', { scene: SCENE });
        expect(P.applyWalls(walls, s, SCENE, storage)).toBe(true);
        expect(walls.on()).toBe(false);
        expect(storage.getItem(`gsfpv.walls.${SCENE}`)).toBe('off');
        P.pilotReset(s, 'scene.walls', { scene: SCENE });
        expect(P.applyWalls(walls, s, SCENE, storage)).toBe(true);
        expect(walls.on()).toBe(true);
        expect(s.isExplicit('scene.walls', { scene: SCENE })).toBe(false);
        expect(storage.getItem(`gsfpv.walls.${SCENE}`)).toBeNull();
        // nothing changed since: no new flight model
        expect(P.applyWalls(walls, s, SCENE, storage)).toBe(false);
        expect(walls.w.sets).toBe(2);
    });

    it('control: the switch\'s own mirror, not held back, turns the reset into an explicit value', () => {
        freshStorage();
        const s = openPage();
        const walls = fakeWalls(s, SCENE, false);
        walls.set(true, true);
        expect(s.isExplicit('scene.walls', { scene: SCENE })).toBe(true);
    });
});

describe('Erase everything', () => {
    it('settings, collections, the link, the v0.2 keys and the saved logs go; the walls cache and other machine data stay', async () => {
        freshStorage({ 'gsfpv.profiles.v1': '{"k":{}}', 'gsfpv.stickMode': '1', 'gsfpv.walls.39e63ce9': 'off', 'gsfpv.warned': '1', 'gsfpv.bake.speed': '3', 'other.app': 'x' });
        const s = openPage(`drone=${AIR}`);
        P.pilotSet(s, 'physics.vCrash', 7, { drone: PAVO });
        const deleted: string[] = [];
        const kv = { keys: async (st: 'logs' | 'handles') => (st === 'logs' ? ['legacy-lastLog', 'flight-1'] : ['folder']), delete: async (st: string, k: string) => { deleted.push(`${st}/${k}`); }, close: () => undefined };
        await P.eraseEverything(s, { storage, idb: async () => kv });
        expect(s.explicitList()).toEqual([]);
        expect(s.collection('radioProfiles').items).toEqual({});
        expect(s.collection('ui').warned).toBe(false);
        expect(P.droneOf(s)).toBe(PAVO);
        for (const k of ['gsfpv.profiles.v1', 'gsfpv.stickMode', 'gsfpv.walls.39e63ce9', 'gsfpv.warned']) expect(storage.getItem(k), k).toBeNull();
        expect(storage.getItem('gsfpv.bake.speed')).toBe('3');
        expect(storage.getItem('other.app')).toBe('x');
        expect(deleted.sort()).toEqual(['handles/folder', 'logs/flight-1', 'logs/legacy-lastLog']);
        // the next load does not migrate the v0.2 keys back: they are gone, and the document exists
        const r = openPage();
        expect(r.migrated).toBeNull();
        expect(r.collection('radioProfiles').items).toEqual({});
    });

    it('control: Reset all alone leaves the v0.2 radio key, which the Controls screen still reads', () => {
        freshStorage({ 'gsfpv.profiles.v1': '{"k":{}}' });
        const s = openPage();
        s.resetAll({ settings: true, collections: ['radioProfiles'] });
        expect(storage.getItem('gsfpv.profiles.v1')).not.toBeNull();
    });
});

describe('the screen\'s model (ui/settings/model.ts)', () => {
    const tx = { label: (d: SettingDef) => ({ 'physics.gravity': 'Grawitacja', 'camera.fovDeg': 'K\u0105t widzenia kamery' } as Record<string, string>)[d.id] ?? d.id, help: () => '', option: (_d: SettingDef, o: string) => o };

    it('search: every word, any case, accents folded, ids too', () => {
        const fov = SCHEMA.byId.get('camera.fovDeg')!, grav = SCHEMA.byId.get('physics.gravity')!;
        expect(M.matches(fov, 'kat', tx)).toBe(true);
        expect(M.matches(fov, 'K\u0104T kamery', tx)).toBe(true);
        expect(M.matches(fov, 'camera.fov', tx)).toBe(true);
        expect(M.matches(grav, '', tx)).toBe(true);
        // control: a word it does not have
        expect(M.matches(fov, 'kat grawitacja', tx)).toBe(false);
        expect(M.matches(grav, 'kamery', tx)).toBe(false);
    });

    it('shows every shipped setting and only those; groups in schema order, none empty', () => {
        const shown = M.shownDefs(SCHEMA);
        expect(shown.every((d) => d.status === 'shipped')).toBe(true);
        expect(shown.length).toBe(SCHEMA.defs.filter((d) => d.status === 'shipped').length);
        const groups = M.shownGroups(SCHEMA);
        expect(groups).toEqual(SCHEMA.groups.filter((g) => shown.some((d) => d.group === g)));
        expect(shown.find((d) => d.id === 'respawn.showPad')).toBeUndefined(); // planned (the pad ring stays invisible, Andrii's wish)
    });

    it('?focus=: a shown row and its group; a planned one; an unknown one (the screen opens and says so)', () => {
        expect(M.focusTarget(SCHEMA, 'physics.vCrash')).toEqual({ kind: 'row', id: 'physics.vCrash', group: 'crash' });
        expect(M.focusTarget(SCHEMA, 'respawn.showPad').kind).toBe('planned');
        expect(M.focusTarget(SCHEMA, 'no.such')).toEqual({ kind: 'unknown', id: 'no.such' });
    });

    it('numbers: decimals of the step, snapping into range, log sliders round-trip', () => {
        expect(M.decimalsOf(1)).toBe(0);
        expect(M.decimalsOf(0.5)).toBe(1);
        expect(M.decimalsOf(0.05)).toBe(2);
        expect(M.formatNumber(9.81, 0.01)).toBe('9.81');
        expect(M.formatNumber(4, 0.5)).toBe('4');
        expect(M.snap(6.4, 2, 10, 0.5)).toBe(6.5);
        expect(M.snap(42, 2, 10, 0.5)).toBe(10);
        expect(M.snap(0.123, 0, 30, 0.01)).toBe(0.12);
        expect(M.fromSlider(M.toSlider(3, 0.25, 4, true), 0.25, 4, true)).toBeCloseTo(3, 9);
    });

    it('the import preview counts what a file changes; flipping one value in the file gives exactly one line', () => {
        const a = memStore();
        P.pilotSet(a, 'physics.vCrash', 6.5, { drone: PAVO });
        P.pilotSet(a, 'camera.fovDeg', 120, { drone: METEOR });
        const file = a.exportFile();
        const b = memStore();
        const r = M.importSummary(b.previewImport(file));
        expect(r.ok).toBe(true);
        expect(r.settings).toBe(2);
        b.importFile(file, 'replace');
        expect(b.explicitList()).toEqual(a.explicitList());
        // control: one value flipped in the file -> exactly one change in the preview
        const flipped = JSON.parse(JSON.stringify(file)) as typeof file;
        (flipped.settings.drone[PAVO] as Record<string, unknown>)['physics.vCrash'] = 7;
        const one: ImportReport = b.previewImport(flipped);
        expect(one.changes).toHaveLength(1);
        expect(one.changes[0]).toMatchObject({ id: 'physics.vCrash', key: PAVO, from: 6.5, to: 7 });
        // a file that is not ours
        expect(M.importSummary(b.previewImport({ hello: 1 })).error).toBe('not-a-settings-file');
        expect(M.importSummary(b.previewImport({ ...emptyDoc('9', 'x'), version: 99 })).error).toBe('newer-version');
    });

    it('A.12: the stored document with 100 scans, 5 radios and every drone tuned stays under 100 KB', () => {
        const s = memStore();
        const pad = (i: number) => ({ version: 1, deviceKey: `gamepad:pad ${i}`, deviceName: `Pad ${i}`, deadband: 0.05, created: '2026-09-22T09:00:00.000Z', axes: { roll: { index: 2, invert: false, center: 0, min: -1, max: 1 }, pitch: { index: 3, invert: true, center: 0, min: -1, max: 1 }, throttle: { index: 1, invert: true, center: 0, min: -1, max: 1 }, yaw: { index: 0, invert: false, center: 0, min: -1, max: 1 } }, arm: { kind: 'button', bit: 0, toggle: true }, angleMode: null });
        const fill = (n: number) => s.updateCollection('sceneLibrary', (d) => {
            d.history = Array.from({ length: n }, (_, i) => ({ id: (0x10000000 + i).toString(16), version: 1, title: `A scan with a long enough title number ${i}`, lastFlown: 1759400000000 - i * 1000, flights: 4, airtimeS: 312, hasCollision: true }));
            d.favourites = d.history.slice(0, 50).map((e) => e.id);
        });
        fill(100);
        s.updateCollection('radioProfiles', (d) => { for (let i = 0; i < 5; i++) d.items[`gamepad:pad ${i}`] = pad(i) as never; });
        for (const drone of Object.keys(PR.PRESETS)) for (const [id, c] of Object.entries(CHANGES)) if (SCHEMA.byId.get(id)!.scope === 'drone') P.pilotSet(s, id, c.v, { drone });
        const bytes = JSON.stringify(s.exportFile()).length;
        expect(s.collection('sceneLibrary').history).toHaveLength(100);
        expect(Object.keys(s.collection('radioProfiles').items)).toHaveLength(5);
        expect(bytes).toBeLessThan(100 * 1024);
        // control: the measure can fail: 250 radios of the same shape go past the bound (radios are not capped)
        s.updateCollection('radioProfiles', (d) => { for (let i = 0; i < 250; i++) d.items[`gamepad:pad ${i}`] = pad(i) as never; });
        expect(JSON.stringify(s.exportFile()).length).toBeGreaterThan(100 * 1024);
    });
});

describe('presets used by the screen are the app\'s', () => {
    it('drone.current options are exactly the app\'s presets (the drone switcher and picker list the same drones)', () => {
        const def = SCHEMA.byId.get('drone.current')!;
        expect(def.type === 'enum' ? [...def.options].sort() : []).toEqual(Object.keys(PR.PRESETS).sort());
        for (const p of Object.values(PR.PRESETS) as PresetJson[]) expect(typeof p.name).toBe('string');
    });
});

describe('the floater filter per scan (G.3): the admin\'s showcase value, the pilot\'s wins', () => {
    const SCENE = SHOWCASE[0].id;
    const store = (extra: Record<string, unknown>) => new PrefsStore(SCHEMA, new MemoryBackend(), P.presetResolver(PR.PRESETS, [{ ...SHOWCASE[0], ...extra } as ShowcaseScene, ...SHOWCASE.slice(1)]), { debounceMs: 0 });

    it('a missing field is 0; the admin\'s "dropFloaters": 12 is the scan\'s default; another scan stays 0', () => {
        expect(memStore().get('scene.dropFloaters', { scene: SCENE })).toBe(0);
        const s = store({ dropFloaters: 12 });
        expect(s.get('scene.dropFloaters', { scene: SCENE })).toBe(12);
        expect(s.get('scene.dropFloaters', { scene: SHOWCASE[1].id })).toBe(0);
    });

    it('the pilot\'s value for the scan wins over the admin\'s, and a reset follows the admin again', () => {
        const s = store({ dropFloaters: 12 });
        expect(s.set('scene.dropFloaters', 5, { scene: SCENE }).ok).toBe(true);
        expect(s.get('scene.dropFloaters', { scene: SCENE })).toBe(5);
        s.reset('scene.dropFloaters', { scene: SCENE });
        expect(s.get('scene.dropFloaters', { scene: SCENE })).toBe(12);
    });

    it('control: an admin value that is not a number is ignored (the scan keeps every piece); out of range is clamped like every number setting', () => {
        for (const bad of ['12', null, true, 'off']) expect(store({ dropFloaters: bad }).get('scene.dropFloaters', { scene: SCENE }), String(bad)).toBe(0);
        expect(store({ dropFloaters: 100 }).get('scene.dropFloaters', { scene: SCENE })).toBe(64);
        expect(store({ dropFloaters: -1 }).get('scene.dropFloaters', { scene: SCENE })).toBe(0);
    });
});
