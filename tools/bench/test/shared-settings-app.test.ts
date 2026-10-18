// v0.9 lane C, item 15: a share carries the sharer's scene settings and the receiver flies with them for
// that visit. The sender (share/shared.ts, share/links.ts), the text (packages/scenes shared-settings.ts),
// the receiver's store work (app/shared-visit.ts over the prefs visit layer) and the readers a flight
// starts with (storedTransform, wallsWanted, storedDropFloaters, storedCeiling, windFor) are run against
// one store, in Node: the claims are about the round trip. Controls: the base build (nothing applied) and a
// link without the settings give the pilot's own; a pilot's own value is never overwritten before Keep.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { FakeStorage } from '../../../packages/prefs/test/helpers';
import { MemoryBackend, PrefsStore, SCHEMA } from '../../../packages/prefs/src';
import { appendShared, flyDeepLink, parseSharedSettings, readCatalog } from '../../../packages/scenes/src';
import type { CatalogScene, SceneCatalog, SharedSettings } from '../../../packages/scenes/src';

type AppPrefs = typeof import('../../../apps/fly/src/app/prefs');
type Presets = typeof import('../../../apps/fly/src/presets');
type Scale = typeof import('../../../apps/fly/src/app/builtin/scale');
type Floaters = typeof import('../../../apps/fly/src/app/builtin/floaters');
type Visit = typeof import('../../../apps/fly/src/app/shared-visit');
type Shared = typeof import('../../../apps/fly/src/share/shared');
type Links = typeof import('../../../apps/fly/src/share/links');
type FlightWalls = typeof import('../../../apps/fly/src/flightwalls');
type Ceil = typeof import('../../../apps/fly/src/session/ceiling-source');
type WindSrc = typeof import('../../../apps/fly/src/session/wind-source');

let P: AppPrefs, PR: Presets, SC: Scale, FL: Floaters, V: Visit, S: Shared, L: Links, FW: FlightWalls, CE: Ceil, WS: WindSrc;

beforeAll(async () => {
    vi.stubGlobal('location', { href: 'http://127.0.0.1/fly/', search: '', pathname: '/fly/', origin: 'http://127.0.0.1' });
    vi.stubGlobal('history', { state: null, replaceState: () => undefined });
    vi.stubGlobal('document', { cookie: '', documentElement: { lang: '' } });
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    vi.stubGlobal('localStorage', new FakeStorage());
    P = await import('../../../apps/fly/src/app/prefs');
    PR = await import('../../../apps/fly/src/presets');
    SC = await import('../../../apps/fly/src/app/builtin/scale');
    FL = await import('../../../apps/fly/src/app/builtin/floaters');
    V = await import('../../../apps/fly/src/app/shared-visit');
    S = await import('../../../apps/fly/src/share/shared');
    L = await import('../../../apps/fly/src/share/links');
    FW = await import('../../../apps/fly/src/flightwalls');
    CE = await import('../../../apps/fly/src/session/ceiling-source');
    WS = await import('../../../apps/fly/src/session/wind-source');
});

afterEach(() => {
    P.closePagePrefs();
    V.endSharedVisit();
});

const A = 'aaaaaa01'; // plain scene
const B = 'bbbbbb02'; // the owner's: size x4, walls off by default, floater cleanup 6, a ceiling at 30 m, its own wind
const WIND = { fromDeg: 200, speed: 3, gust: 1, source: 'manual' as const };
const CAT = readCatalog({ scenes: [{ id: A, title: 'Plain' }, { id: B, title: 'Owner', scale: 4, walls: 'off', dropFloaters: 6, ceilingM: 30, wind: WIND, collision: true }] }) as SceneCatalog;
const meta = (id: string): CatalogScene | undefined => CAT.scenes.find((s) => s.id === id);

function store(): PrefsStore {
    return new PrefsStore(SCHEMA, new MemoryBackend(), P.presetResolver(PR.PRESETS, CAT.scenes, CAT.defaults), { debounceMs: 0 });
}
const tr = (s: number) => ({ s, t: [0, 0, 0] as [number, number, number], v: 0 });
const NOLINK: ReadonlyMap<string, string> = new Map();
const sharedOf = (prefs: PrefsStore, id: string, hasWalls: boolean | null = true) => S.sharedOf(prefs, id, { meta: meta(id), hasWalls });

describe('the sender: what differs from the scene\'s defaults', () => {
    it('a pilot on the defaults shares nothing; each setting he changes is carried and only that', () => {
        const prefs = store();
        expect(sharedOf(prefs, A)).toEqual({});
        expect(sharedOf(prefs, B)).toEqual({});
        prefs.set('scene.transform', tr(3), { scene: A });
        expect(sharedOf(prefs, A)).toEqual({ size: 3 });
        prefs.set('scene.walls', 'off');
        prefs.set('scene.dropFloaters', 4, { scene: A });
        prefs.set('scene.ceiling', 'custom', { scene: A });
        prefs.set('scene.ceilingM', 12.5, { scene: A });
        prefs.set('wind.mode', 'custom');
        for (const [k, v] of [['wind.fromDeg', 270], ['wind.speed', 4], ['wind.gust', 2]] as const) prefs.set(k, v, { scene: A });
        prefs.set('drone.current', 'nazgulf5v3-6s');
        expect(sharedOf(prefs, A)).toEqual({ size: 3, walls: 'off', floaters: 4, ceiling: 12.5, wind: { fromDeg: 270, speed: 4, gust: 2 }, drone: 'nazgulf5v3-6s' });
        // the other scene has its own defaults: the walls choice is global (off) and B's own default is off already, its size,
        // cleanup and ceiling were never touched; its own wind (200/3/1) is not the pilot's custom numbers for B (the defaults 270/4/2)
        expect(sharedOf(prefs, B)).toEqual({ wind: { fromDeg: 270, speed: 4, gust: 2 }, drone: 'nazgulf5v3-6s' });
    });

    it('a value equal to the scene\'s own default is not carried, even when the pilot saved it himself', () => {
        const prefs = store();
        prefs.set('scene.transform', tr(4), { scene: B }); // the owner's x4, saved by the pilot too
        prefs.set('scene.dropFloaters', 6, { scene: B });
        prefs.set('scene.walls', 'off'); // B's curated default
        prefs.set('scene.ceiling', 'custom', { scene: B });
        prefs.set('scene.ceilingM', 30, { scene: B }); // B's own ceiling
        prefs.set('wind.mode', 'custom');
        for (const [k, v] of [['wind.fromDeg', 200], ['wind.speed', 3], ['wind.gust', 1]] as const) prefs.set(k, v, { scene: B }); // B's own wind
        expect(sharedOf(prefs, B)).toEqual({});
        // control: one step off any of them is carried
        prefs.set('scene.transform', tr(4.5), { scene: B });
        prefs.set('wind.speed', 3.5, { scene: B });
        expect(sharedOf(prefs, B)).toEqual({ size: 4.5, wind: { fromDeg: 200, speed: 3.5, gust: 1 } });
    });

    it('wind: off against a scene with wind is carried, against a scene without it is not; the live wind is weather and never is', () => {
        const prefs = store();
        prefs.set('wind.mode', 'off');
        expect(sharedOf(prefs, B)).toEqual({ wind: 'off' });
        expect(sharedOf(prefs, A)).toEqual({}); // still air either way
        prefs.set('wind.mode', 'now');
        expect(sharedOf(prefs, B)).toEqual({});
        // a custom wind of 0 m/s without gusts is still air: it goes as off
        prefs.set('wind.mode', 'custom');
        for (const [k, v] of [['wind.speed', 0], ['wind.gust', 0]] as const) prefs.set(k, v, { scene: B });
        expect(sharedOf(prefs, B)).toEqual({ wind: 'off' });
    });

    it('collision ceiling: none against a scene with one is "off", another height is the height, the scene\'s own is nothing', () => {
        const prefs = store();
        prefs.set('scene.ceiling', 'off', { scene: B });
        expect(sharedOf(prefs, B)).toEqual({ ceiling: 'off' });
        prefs.set('scene.ceiling', 'custom', { scene: B });
        prefs.set('scene.ceilingM', 18.25, { scene: B });
        expect(sharedOf(prefs, B)).toEqual({ ceiling: 18.25 });
        prefs.set('scene.ceilingM', 30, { scene: B });
        expect(sharedOf(prefs, B)).toEqual({});
        // a scene with no ceiling and the pilot's "none" is no difference
        prefs.set('scene.ceiling', 'off', { scene: A });
        expect(sharedOf(prefs, A)).toEqual({});
    });

    it('a scan without walls says nothing of walls', () => {
        const prefs = store();
        prefs.set('scene.walls', 'off');
        expect(sharedOf(prefs, A, true)).toEqual({ walls: 'off' });
        expect(sharedOf(prefs, A, false)).toEqual({});
    });

    it('what a shared link brought is shared on (the visit layer is read), without being saved', () => {
        const prefs = store();
        prefs.setVisit(A, 'scene.transform', tr(7));
        expect(sharedOf(prefs, A)).toEqual({ size: 7 });
        expect(prefs.isExplicit('scene.transform', { scene: A })).toBe(false);
    });

    it('the pilot\'s own Display drawing choice is his device\'s, not the scene\'s: no setting of a share, and a card of a catalogue scene stays the static page (lane R draws; decision D69)', () => {
        const prefs = store();
        prefs.set('display.drawing', 'sorted');
        expect(sharedOf(prefs, A)).toEqual({});
        const at = { origin: 'https://gsfpv.flyreelstudio.eu', locale: 'en' };
        expect(L.shareLink({ entry: 'picker', sceneId: A, inCatalogue: true, at, pictureUrl: null, drawing: L.cardDrawing({}), shared: sharedOf(prefs, A) })).toBe(`${at.origin}/en/scenes/${A}/`);
        const scene = { render: { budgetM: 8 }, meta: { render: { stochastic: true } } };
        // lane R's contract (D50, D52): `render` is what the scene's own LINK asked for, the owner's entry is kept apart in
        // `catalogue` and never written into a link; nothing of the pilot's own drawing choice either way
        expect(L.flightDrawing(scene)).toEqual({ render: { budgetM: 8 }, catalogue: { stochastic: true } });
        expect(L.cardDrawing({ render: { stochastic: true } })).toEqual({ render: undefined, catalogue: { stochastic: true } });
    });
});

describe('the link', () => {
    const at = { origin: 'https://gsfpv.flyreelstudio.eu', locale: 'en' };

    it('a scene shared with settings goes out as its deep link, not as its static page; without them as before', () => {
        const shared: SharedSettings = { size: 3, walls: 'off' };
        expect(L.shareLink({ entry: 'picker', sceneId: B, inCatalogue: true, at, pictureUrl: null, shared })).toBe(`${at.origin}/en/fly/?scene=${B}&sz=3&wl=0`);
        expect(L.shareLink({ entry: 'picker', sceneId: B, inCatalogue: true, at, pictureUrl: null, shared: {} })).toBe(`${at.origin}/en/scenes/${B}/`);
        expect(L.shareLink({ entry: 'picker', sceneId: B, inCatalogue: true, at, pictureUrl: null })).toBe(`${at.origin}/en/scenes/${B}/`);
        // a flight with its picture links the picture's page: the server writes the settings into that page's link
        expect(L.shareLink({ entry: 'top', sceneId: B, inCatalogue: true, at, pictureUrl: `${at.origin}/s/abc`, shared })).toBe(`${at.origin}/s/abc`);
        // with the render of lane R first, the settings after it
        expect(L.shareLink({ entry: 'picker', sceneId: A, inCatalogue: false, at, pictureUrl: null, drawing: { render: { budgetM: 8, stochastic: true } }, shared })).toBe(`${at.origin}/en/fly/?scene=${A}&budget=8&stochastic&sz=3&wl=0`);
    });

    it('the POST body carries the settings, and null when there are none', () => {
        const base = { image: 'data:', sceneId: A, title: null, credit: '', locale: 'en', drawing: {} };
        expect(L.shareApiBody({ ...base, shared: { size: 3 } }).shared).toEqual({ size: 3 });
        expect(L.shareApiBody({ ...base, shared: {} }).shared).toBeNull();
        expect(L.shareApiBody(base).shared).toBeNull();
    });
});

describe('the receiver: the link\'s settings, for that visit and that scene', () => {
    const SHARED: SharedSettings = { size: 3, walls: 'off', floaters: 4, wind: { fromDeg: 270, speed: 4, gust: 2 }, ceiling: 12.5 };

    it('the readers a flight starts with give the shared settings for that scene and the pilot\'s own for any other', () => {
        const prefs = store();
        const applied = V.applyShared(prefs, A, SHARED, NOLINK);
        expect(applied).toEqual(SHARED);
        // the pilot's own, before (B has the owner's values; A is plain)
        expect(SC.storedTransform(prefs, A)?.s).toBe(3);
        expect(FW.wallsWanted(prefs, A)).toBe(false);
        expect(FL.storedDropFloaters(prefs, A)).toBe(4);
        expect(CE.storedCeiling(prefs, A)).toBe(12.5);
        // another scene is not touched, nor is the pilot's saved state
        expect(SC.storedTransform(prefs, B)?.s).toBe(4);
        expect(FW.wallsWanted(prefs, A) && true).toBe(false);
        expect(FL.storedDropFloaters(prefs, B)).toBe(6);
        expect(CE.storedCeiling(prefs, B)).toBe(30);
        expect(prefs.explicitList()).toEqual([]);
        // control: the base build (nothing applied) flies A as the pilot's own
        const own = store();
        expect([SC.storedTransform(own, A)?.s, FW.wallsWanted(own, A), FL.storedDropFloaters(own, A), CE.storedCeiling(own, A)]).toEqual([1, true, 0, null]);
    });

    it('the wind a flight starts in is the shared one: windFor reads it with the scene', async () => {
        const prefs = store();
        V.applyShared(prefs, A, { wind: { fromDeg: 270, speed: 4, gust: 2 } }, NOLINK);
        const spec = await WS.windFor(prefs, A, meta(A), null);
        expect(spec).toMatchObject({ fromDeg: 270, speed: 4, gust: 2, source: 'custom' });
        expect(await WS.windFor(prefs, B, meta(B), null)).toMatchObject({ source: 'scene', speed: 3 }); // another scene: its own
        V.applyShared(prefs, B, { wind: 'off' }, NOLINK);
        expect(await WS.windFor(prefs, B, meta(B), null)).toBeNull();
        // control: without the visit layer the same call gives the scene's own wind
        prefs.clearVisit(B);
        expect(await WS.windFor(prefs, B, meta(B), null)).toMatchObject({ source: 'scene' });
    });

    it('sender and receiver agree: what a link carries is what the receiver\'s own share carries again', () => {
        const link = appendShared(flyDeepLink('/en/fly/', A), SHARED);
        const parsed = parseSharedSettings(new URL(link, 'https://x.test').searchParams);
        expect(parsed).toEqual(SHARED);
        const receiver = store();
        V.applyShared(receiver, A, parsed, NOLINK);
        expect(sharedOf(receiver, A)).toEqual(SHARED);
        // control: a receiver on a link without them re-shares nothing
        expect(sharedOf(store(), A)).toEqual({});
    });

    it('Reset gives the pilot\'s own back, announced to the flight, and nothing is stored', () => {
        const prefs = store();
        prefs.set('scene.transform', tr(2), { scene: A }); // the pilot's own size for A
        const seen: string[] = [];
        prefs.onChange((c) => seen.push(`${c.id}:${c.source}`));
        const visit = { scene: A, applied: V.applyShared(prefs, A, SHARED, NOLINK) };
        expect(SC.storedTransform(prefs, A)?.s).toBe(3);
        seen.length = 0;
        V.resetShared(prefs, visit);
        expect(SC.storedTransform(prefs, A)?.s).toBe(2);
        expect([FW.wallsWanted(prefs, A), FL.storedDropFloaters(prefs, A), CE.storedCeiling(prefs, A)]).toEqual([true, 0, null]);
        expect(seen).toContain('scene.transform:session');
        expect(seen.every((x) => x.endsWith(':session'))).toBe(true); // nothing the pilot wrote
        expect(prefs.explicitList().map((e) => e.id)).toEqual(['scene.transform']); // only his own size, as before
        expect(prefs.get('scene.transform', { scene: A })).toEqual(tr(2));
    });

    it('Keep stores each as the pilot\'s own, and the visit layer is empty', () => {
        const prefs = store();
        const visit = { scene: A, applied: V.applyShared(prefs, A, SHARED, NOLINK) };
        expect(V.keepShared(prefs, visit)).toEqual(expect.arrayContaining(['scene.transform', 'scene.walls', 'scene.dropFloaters', 'scene.ceiling', 'scene.ceilingM', 'wind.mode', 'wind.speed']));
        expect(prefs.visitOf(A)).toEqual({});
        expect(prefs.isExplicit('scene.transform', { scene: A })).toBe(true);
        expect([SC.storedTransform(prefs, A)?.s, FL.storedDropFloaters(prefs, A), CE.storedCeiling(prefs, A)]).toEqual([3, 4, 12.5]);
    });

    it('a setting the pilot changes himself leaves the share: the chip names what still stands', () => {
        const prefs = store();
        const applied = V.applyShared(prefs, A, SHARED, NOLINK);
        expect(Object.keys(V.stillShared(prefs, A, applied, NOLINK))).toEqual(['size', 'walls', 'floaters', 'wind', 'ceiling']);
        prefs.set('scene.transform', tr(5), { scene: A }); // pressed ]
        prefs.set('scene.walls', 'on'); // pressed C
        expect(V.stillShared(prefs, A, applied, NOLINK)).toEqual({ floaters: 4, wind: SHARED.wind, ceiling: 12.5 });
        for (const id of ['scene.dropFloaters']) prefs.reset(id, { scene: A });
        prefs.set('wind.mode', 'scene');
        prefs.set('scene.ceiling', 'off', { scene: A });
        expect(V.stillShared(prefs, A, applied, NOLINK)).toEqual({});
        // the pilot's values read, not the link's
        expect(SC.storedTransform(prefs, A)?.s).toBe(5);
        expect(FW.wallsWanted(prefs, A)).toBe(true);
    });

    it('a wind (a mode and three numbers) or a ceiling (a mode and a height) stands only while all of it is the link\'s', () => {
        const prefs = store();
        const applied = V.applyShared(prefs, A, { wind: { fromDeg: 270, speed: 4, gust: 2 }, ceiling: 12.5 }, NOLINK);
        expect(Object.keys(V.stillShared(prefs, A, applied, NOLINK))).toEqual(['wind', 'ceiling']);
        prefs.set('wind.speed', 9, { scene: A }); // the pilot dials his own wind speed
        prefs.set('scene.ceilingM', 20, { scene: A });
        expect(V.stillShared(prefs, A, applied, NOLINK)).toEqual({});
        // control: an untouched share stands whole
        const other = store();
        expect(Object.keys(V.stillShared(other, B, V.applyShared(other, B, { wind: 'off' }, NOLINK), NOLINK))).toEqual(['wind']);
    });

    it('an item the store refuses is not applied, whole; the rest stands', () => {
        const prefs = store();
        const applied = V.applyShared(prefs, A, { size: 3, floaters: 4 }, NOLINK);
        expect(applied).toEqual({ size: 3, floaters: 4 });
        // control: a refused setting (an unknown scene key) applies nothing
        expect(V.applyShared(prefs, '__proto__', { size: 3 }, NOLINK)).toEqual({});
        expect(prefs.visitOf('__proto__')).toEqual({});
    });

    it('the drone is the URL layer\'s: the chip names it only while the link holds it; Reset lets go, Keep stores it', () => {
        const query = 'scene=aaaaaa01&drone=taurusx8-komodo-6s';
        const open = (): PrefsStore => P.openPagePrefs(CAT.scenes, query, { storage: new FakeStorage() as unknown as Storage, win: null, doc: null, cookieDoc: null, debounceMs: 0, openKv: async () => ({ get: async () => undefined, put: async () => undefined, close: () => undefined }) });
        let prefs = open();
        expect(prefs.get('drone.current')).toBe('taurusx8-komodo-6s');
        let visit = { scene: A, applied: V.applyShared(prefs, A, { drone: 'taurusx8-komodo-6s' }, P.linkSettings()) };
        expect(visit.applied).toEqual({ drone: 'taurusx8-komodo-6s' });
        V.resetShared(prefs, visit);
        expect(prefs.get('drone.current')).toBe('pavo20pro-3s');
        expect(prefs.isExplicit('drone.current')).toBe(false);
        P.closePagePrefs();
        prefs = open();
        visit = { scene: A, applied: V.applyShared(prefs, A, { drone: 'taurusx8-komodo-6s' }, P.linkSettings()) };
        expect(V.keepShared(prefs, visit)).toEqual(['drone.current']);
        expect(prefs.isExplicit('drone.current')).toBe(true);
        // control: a drone the store does not know is not "applied", so the chip never names it
        P.closePagePrefs();
        prefs = P.openPagePrefs(CAT.scenes, 'scene=aaaaaa01&drone=nosuchdrone', { storage: new FakeStorage() as unknown as Storage, win: null, doc: null, cookieDoc: null, debounceMs: 0, openKv: async () => ({ get: async () => undefined, put: async () => undefined, close: () => undefined }) });
        expect(V.applyShared(prefs, A, { drone: 'nosuchdrone' }, P.linkSettings())).toEqual({});
    });

    it('a scene switch ends the drone of the link too: the pilot\'s own comes back and the address loses it (control: clearing the layer alone keeps it)', () => {
        const query = 'scene=aaaaaa01&drone=taurusx8-komodo-6s';
        const open = (): PrefsStore => P.openPagePrefs(CAT.scenes, query, { storage: new FakeStorage() as unknown as Storage, win: null, doc: null, cookieDoc: null, debounceMs: 0, openKv: async () => ({ get: async () => undefined, put: async () => undefined, close: () => undefined }) });
        const visitOf = (prefs: PrefsStore) => ({ scene: A, applied: V.applyShared(prefs, A, { size: 5, drone: 'taurusx8-komodo-6s' }, P.linkSettings()) });
        // control: what the scene switch did before (the layer alone) leaves the drone flown and held by the link, with no chip left to end it
        let prefs = open();
        let visit = visitOf(prefs);
        expect(visit.applied).toEqual({ size: 5, drone: 'taurusx8-komodo-6s' });
        prefs.clearVisit(A);
        expect(prefs.get('drone.current')).toBe('taurusx8-komodo-6s');
        expect(P.linkSettings().has('drone.current')).toBe(true);
        P.closePagePrefs();
        // the fix: the visit ends as after Reset, nothing stored
        prefs = open();
        visit = visitOf(prefs);
        expect(V.leaveShared(prefs, visit)).toBe(true);
        expect(prefs.get('drone.current')).toBe('pavo20pro-3s');
        expect(P.linkSettings().has('drone.current')).toBe(false);
        expect(prefs.isExplicit('drone.current')).toBe(false);
        expect(prefs.visitOf(A)).toEqual({});
        expect(V.stillShared(prefs, A, visit.applied, P.linkSettings())).toEqual({});
        P.closePagePrefs();
        // a drone the pilot chose himself during the visit is his: it stays, and the flight model is not rebuilt
        prefs = open();
        visit = visitOf(prefs);
        expect(P.pilotSet(prefs, 'drone.current', 'nazgulf5v3-6s').ok).toBe(true);
        expect(V.leaveShared(prefs, visit)).toBe(false);
        expect(prefs.get('drone.current')).toBe('nazgulf5v3-6s');
        expect(prefs.isExplicit('drone.current')).toBe(true);
        P.closePagePrefs();
        // a link without a drone: nothing to let go of
        prefs = P.openPagePrefs(CAT.scenes, 'scene=aaaaaa01', { storage: new FakeStorage() as unknown as Storage, win: null, doc: null, cookieDoc: null, debounceMs: 0, openKv: async () => ({ get: async () => undefined, put: async () => undefined, close: () => undefined }) });
        expect(V.leaveShared(prefs, { scene: A, applied: V.applyShared(prefs, A, { size: 5 }, P.linkSettings()) })).toBe(false);
    });

    it('the chip words: one entry per item, in the link\'s order, numbers as the pilot reads them', () => {
        const items = V.chipItems({ ...SHARED, drone: 'nazgulf5v3-6s' }, { droneName: (id) => `<${id}>`, ceilingHeight: (c) => c - 1 });
        expect(items.map((i) => i.key)).toEqual(['shared.item.size', 'shared.item.wallsOff', 'shared.item.floaters', 'shared.item.wind', 'shared.item.ceiling', 'shared.item.drone']);
        expect(items[0].args).toEqual({ x: '3' });
        expect(items[3].args).toEqual({ speed: '4', from: 270 });
        expect(items[4].args).toEqual({ h: '11.5' });
        expect(items[5].args).toEqual({ name: '<nazgulf5v3-6s>' });
        expect(V.chipItems({ walls: 'on', floaters: 0, wind: 'off', ceiling: 'off' }).map((i) => i.key)).toEqual(['shared.item.wallsOn', 'shared.item.floatersOff', 'shared.item.windOff', 'shared.item.ceilingOff']);
    });
});
