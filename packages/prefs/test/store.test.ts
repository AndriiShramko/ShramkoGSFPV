import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryBackend, PREFS_KEY, PrefsStore, SCHEMA, canonicalJson, defineSettings, settingsFromQuery } from '../src';
import type { Backend, NumDef, PrefChange, SettingDef, ValueBackend } from '../src';
import { DroppingBackend, mkStore, resolver } from './helpers';

const PRO = 'pavo20pro-3s';
const PRO2 = 'pavo20pro2-3s';
const PICO = 'pavopico-2s';

describe('layering (A.6)', () => {
    it('session over the drone entry over the default', () => {
        const s = mkStore();
        expect(s.get('physics.vCrash', { drone: PRO })).toBe(4);
        s.set('physics.vCrash', 6.5, { drone: PRO });
        expect(s.get('physics.vCrash', { drone: PRO })).toBe(6.5);
        s.setSession('physics.vCrash', 8);
        expect(s.get('physics.vCrash', { drone: PRO })).toBe(8);
        s.clearSession('physics.vCrash');
        expect(s.get('physics.vCrash', { drone: PRO })).toBe(6.5);
    });

    it('a preset default resolves per drone: Pavo20 Pro vCrash 4.0, FOV and idle from each preset', () => {
        const s = mkStore();
        expect(s.defaultOf('physics.vCrash', { drone: PRO })).toBe(4);
        expect(s.get('camera.fovDeg', { drone: PRO })).toBe(115);
        // presets hold idle as a fraction; the setting is in percent (the value itself is W1-3's)
        expect(s.get('physics.idlePct', { drone: PRO })).toBeCloseTo(resolver().field(PRO, 'motor_idle')! * 100, 9);
        expect(s.get('camera.fovDeg', { drone: PICO })).toBe(resolver().field(PICO, 'camera_fov_deg'));
        // a drone the resolver does not know gets the def's fallback, never undefined
        expect(s.get('physics.vCrash', { drone: 'no-such-drone' })).toBe(4);
        expect(s.get('physics.ductDrag', { drone: 'no-such-drone' })).toBe(0.6);
    });

    it('D-c regression: each drone keeps its own values', () => {
        const s = mkStore();
        s.set('physics.vCrash', 6.5, { drone: PRO });
        s.set('tune.pid', { roll: [54, 111, 44, 0], pitch: [68, 139, 60, 0], yaw: [54, 111, 0, 0] }, { drone: PRO });
        expect(s.get('physics.vCrash', { drone: PICO })).toBe(s.defaultOf('physics.vCrash', { drone: PICO }));
        expect(s.get('tune.pid', { drone: PICO })).toBeNull();
        expect(s.get('physics.vCrash', { drone: PRO })).toBe(6.5);
        expect(s.isExplicit('physics.vCrash', { drone: PICO })).toBe(false);
    });

    it('control: the same def made global leaks between drones, so the test above can tell', () => {
        const leaky = defineSettings(SCHEMA.defs.map((d): SettingDef => (d.id === 'physics.vCrash' ? { ...(d as NumDef), scope: 'global', default: 4 } : d)));
        const s = mkStore(new MemoryBackend(), {}, leaky);
        s.set('physics.vCrash', 6.5, { drone: PRO });
        expect(s.get('physics.vCrash', { drone: PICO })).toBe(6.5);
    });

    it('without ctx.drone a per-drone setting is the drone flown now (drone.current)', () => {
        const s = mkStore();
        s.set('drone.current', PRO2);
        s.set('physics.vCrash', 7);
        expect(s.get('physics.vCrash', { drone: PRO2 })).toBe(7);
        expect(s.get('physics.vCrash', { drone: PRO })).toBe(4);
        s.setSession('drone.current', PRO); // ?drone= in the URL
        expect(s.get('physics.vCrash')).toBe(4);
    });

    it('a scene setting needs a scene; its default is the curated scale', () => {
        const s = mkStore(new MemoryBackend(), {}, SCHEMA, { '39e63ce9': 1.5 });
        expect(s.set('scene.transform', { s: 2, t: [0, 0, 0], v: 1 })).toEqual({ ok: false, reason: 'no-context' });
        expect(s.get('scene.transform', { scene: '39e63ce9' })).toEqual({ s: 1.5, t: [0, 0, 0], v: 0 });
        expect(s.get('scene.transform', { scene: '9d09ab82' })).toEqual({ s: 1, t: [0, 0, 0], v: 0 });
        s.set('scene.transform', { s: 2, t: [0.3, 0, -1.2], v: 2 }, { scene: '9d09ab82' });
        expect(s.get('scene.transform', { scene: '9d09ab82' })).toEqual({ s: 2, t: [0.3, 0, -1.2], v: 2 });
        expect(s.get('scene.transform', { scene: '39e63ce9' })).toEqual({ s: 1.5, t: [0, 0, 0], v: 0 });
    });
});

describe('set: validation and results', () => {
    it('clamps out of range and reports it; refuses wrong type, option, unknown id', () => {
        const s = mkStore();
        expect(s.set('respawn.rewindS', 99)).toEqual({ ok: true, value: 30, clamped: true });
        expect(s.set('respawn.rewindS', '5')).toEqual({ ok: false, reason: 'type' });
        expect(s.set('flight.mode', 'sport')).toEqual({ ok: false, reason: 'option' });
        expect(s.set('no.such', 1)).toEqual({ ok: false, reason: 'unknown-id' });
        expect(s.get('respawn.rewindS')).toBe(30);
    });

    it('get of an unknown id throws: a typo must not read as a default', () => {
        expect(() => mkStore().get('flight.mdoe')).toThrow(/unknown setting flight\.mdoe/);
    });

    it('returns copies: mutating a JSON value does not change the store', () => {
        const s = mkStore();
        s.set('tune.throttle', { mid: 65, expo: 20 }, { drone: PRO });
        const v = s.get<{ mid: number }>('tune.throttle', { drone: PRO });
        v.mid = 1;
        expect(s.get('tune.throttle', { drone: PRO })).toEqual({ mid: 65, expo: 20 });
    });
});

describe('persistence (A.5)', () => {
    it('set, then a new store on the same backend, gives the value back', () => {
        const b = new MemoryBackend();
        mkStore(b).set('physics.vCrash', 6.5, { drone: PRO });
        expect(mkStore(b).get('physics.vCrash', { drone: PRO })).toBe(6.5);
        expect(JSON.parse(b.read()!).settings.drone[PRO]['physics.vCrash']).toBe(6.5);
    });

    it('reset gives the default (the preset value) and clears the changed dot', () => {
        const b = new MemoryBackend();
        const s = mkStore(b);
        s.set('physics.vCrash', 6.5, { drone: PRO });
        s.reset('physics.vCrash', { drone: PRO });
        expect(s.get('physics.vCrash', { drone: PRO })).toBe(4);
        expect(s.isExplicit('physics.vCrash', { drone: PRO })).toBe(false);
        expect(mkStore(b).isExplicit('physics.vCrash', { drone: PRO })).toBe(false);
    });

    it('resetGroup touches only its group', () => {
        const s = mkStore();
        s.set('respawn.rewindS', 10);
        s.set('crash.enabled', false);
        s.set('voxels.opacity', 0.8);
        s.resetGroup('crash');
        expect(s.isExplicit('respawn.rewindS')).toBe(false);
        expect(s.isExplicit('crash.enabled')).toBe(false);
        expect(s.get('voxels.opacity')).toBe(0.8);
    });

    it('control: resetAll clears the other group too', () => {
        const s = mkStore();
        s.set('respawn.rewindS', 10);
        s.set('voxels.opacity', 0.8);
        s.set('physics.vCrash', 6, { drone: PRO });
        s.resetAll();
        expect(s.explicitList()).toEqual([]);
        expect(s.get('voxels.opacity')).toBe(0.35);
    });

    it('resetAll keeps collections unless named', () => {
        const s = mkStore();
        s.updateCollection('sceneLibrary', (d) => { d.favourites.push('39e63ce9'); });
        s.resetAll();
        expect(s.collection('sceneLibrary').favourites).toEqual(['39e63ce9']);
        s.resetAll({ settings: false, collections: ['sceneLibrary'] });
        expect(s.collection('sceneLibrary').favourites).toEqual([]);
    });

    it('a backend that silently drops writes is detected (writable === false); the store still works in memory', () => {
        const drop = new DroppingBackend();
        const s = mkStore(drop);
        expect(drop.writes).toBe(1); // the boot write is the probe
        expect(s.writable).toBe(false);
        s.set('flight.mode', 'horizon');
        expect(s.get('flight.mode')).toBe('horizon');
        expect(s.exportFile().settings.global['flight.mode']).toBe('horizon');
    });

    it('a backend that throws is detected too; a working one reports writable', () => {
        const throwing: Backend = { read: () => null, write: () => { throw new Error('QuotaExceededError'); } };
        expect(mkStore(throwing).writable).toBe(false);
        expect(mkStore(new MemoryBackend()).writable).toBe(true);
    });

    it('writes are debounced 250 ms, not restarted by later changes, and flush writes at once', () => {
        vi.useFakeTimers();
        try {
            const b = new MemoryBackend();
            const s = mkStore(b, { debounceMs: 250 });
            const boot = b.read();
            s.set('display.quality', 0.5);
            vi.advanceTimersByTime(200);
            s.set('display.quality', 0.6);
            expect(b.read()).toBe(boot);
            vi.advanceTimersByTime(60);
            expect(JSON.parse(b.read()!).settings.global['display.quality']).toBe(0.6);
            s.set('display.hud', false);
            s.flush();
            expect(JSON.parse(b.read()!).settings.global['display.hud']).toBe(false);
        } finally {
            vi.useRealTimers();
        }
    });

    it('an unknown id in storage (a newer version wrote it) survives this version\'s writes', () => {
        const b = new MemoryBackend();
        mkStore(b);
        const doc = JSON.parse(b.read()!);
        doc.settings.global['future.thing'] = 42;
        b.write(JSON.stringify(doc));
        const s = mkStore(b);
        s.set('flight.mode', 'acro');
        expect(JSON.parse(b.read()!).settings.global['future.thing']).toBe(42);
    });

    it('a document from a newer version is read but never overwritten', () => {
        const newer = JSON.stringify({ format: 'gsfpv-prefs', version: 2, app: '0.4.0', savedAt: '', settings: { global: { 'flight.mode': 'acro' } }, collections: {} });
        const b = new MemoryBackend(newer);
        const s = mkStore(b);
        expect(s.get('flight.mode')).toBe('acro');
        expect(s.writable).toBe(false);
        s.set('flight.mode', 'horizon');
        s.flush();
        expect(b.read()).toBe(newer);
    });

    it('an unreadable document is replaced at the first change, not at boot', () => {
        const b = new MemoryBackend('{broken');
        const s = mkStore(b);
        expect(b.read()).toBe('{broken');
        s.set('flight.mode', 'acro');
        expect(JSON.parse(b.read()!).settings.global['flight.mode']).toBe('acro');
    });

    it('writes canonical JSON under one key', () => {
        const b = new MemoryBackend();
        const s = mkStore(b);
        s.set('respawn.rewindS', 7);
        expect(b.read()).toBe(canonicalJson(JSON.parse(b.read()!)));
        expect(PREFS_KEY).toBe('gsfpv.prefs.v1');
    });
});

describe('explicit semantics (A.6)', () => {
    it('set stores even a value equal to the default', () => {
        const s = mkStore();
        s.set('flight.mode', 'angle');
        expect(s.isExplicit('flight.mode')).toBe(true);
    });

    it('a changed default reaches a pilot with no entry, but not one with an entry', () => {
        const v1 = SCHEMA;
        const v2 = defineSettings(SCHEMA.defs.map((d): SettingDef => (d.id === 'respawn.rewindS' ? { ...(d as NumDef), default: 8 } : d)));
        const untouched = new MemoryBackend();
        const chose = new MemoryBackend();
        mkStore(untouched, {}, v1).set('flight.mode', 'acro');
        mkStore(chose, {}, v1).set('respawn.rewindS', 5);
        expect(mkStore(untouched, {}, v2).get('respawn.rewindS')).toBe(8);
        expect(mkStore(chose, {}, v2).get('respawn.rewindS')).toBe(5);
    });
});

describe('two tabs (A.5)', () => {
    it('two stores on one storage: A sets x, B sets y, both survive (B writes before the storage event reaches it)', () => {
        const a = new MemoryBackend();
        const shared = a.tab();
        // the browser delivers the storage event in a later task: B may write first, so the
        // re-read at write time is what keeps x, not the event
        const b: Backend = { read: () => shared.read(), write: (t) => shared.write(t) };
        const sa = mkStore(a, { debounceMs: 1000 });
        const sb = mkStore(b, { debounceMs: 1000 });
        sa.set('flight.mode', 'horizon');
        sb.set('respawn.rewindS', 12);
        sa.flush();
        sb.flush();
        const stored = JSON.parse(a.read()!).settings.global;
        expect(stored['flight.mode']).toBe('horizon');
        expect(stored['respawn.rewindS']).toBe(12);
        expect(mkStore(new MemoryBackend(a.read())).get('flight.mode')).toBe('horizon');
    });

    it('control: a whole-document overwrite (v0.2 style) loses x', () => {
        const a = new MemoryBackend();
        const b = a.tab();
        const sa = mkStore(a, { debounceMs: 1000 });
        const sb = mkStore(b, { debounceMs: 1000 });
        const bView = sb.exportFile(); // B's picture of the document before A wrote
        sa.set('flight.mode', 'horizon');
        sa.flush();
        bView.settings.global['respawn.rewindS'] = 12;
        b.write(JSON.stringify(bView));
        const stored = JSON.parse(a.read()!).settings.global;
        expect(stored['respawn.rewindS']).toBe(12);
        expect(stored['flight.mode']).toBeUndefined();
    });

    it('the other tab hears the change as source external, with the value', () => {
        const a = new MemoryBackend();
        const sa = mkStore(a);
        const sb = mkStore(a.tab());
        const heard: PrefChange[] = [];
        sb.onChange((c) => heard.push(c));
        sa.set('voxels.opacity', 0.6);
        expect(sb.get('voxels.opacity')).toBe(0.6);
        expect(heard).toEqual([{ id: 'voxels.opacity', scope: 'global', key: null, value: 0.6, previous: 0.35, source: 'external' }]);
    });

    it('an unwritten local change stays on top when the other tab writes', () => {
        const a = new MemoryBackend();
        const sa = mkStore(a);
        const sb = mkStore(a.tab(), { debounceMs: 1000 });
        sb.set('flight.mode', 'acro'); // pending in B
        sa.set('flight.mode', 'horizon');
        expect(sb.get('flight.mode')).toBe('acro');
        sb.flush();
        expect(JSON.parse(a.read()!).settings.global['flight.mode']).toBe('acro');
    });
});

describe('change events', () => {
    it('user, reset and session changes carry scope, key, value and previous', () => {
        const s = mkStore();
        const seen: PrefChange[] = [];
        s.onChange((c) => seen.push(c));
        s.set('physics.vCrash', 6, { drone: PRO });
        s.reset('physics.vCrash', { drone: PRO });
        s.setSession('flight.mode', 'acro');
        expect(seen).toEqual([
            { id: 'physics.vCrash', scope: 'drone', key: PRO, value: 6, previous: 4, source: 'user' },
            { id: 'physics.vCrash', scope: 'drone', key: PRO, value: 4, previous: 6, source: 'reset' },
            { id: 'flight.mode', scope: 'global', key: null, value: 'acro', previous: 'angle', source: 'session' }
        ]);
    });

    it('a throwing listener does not stop the write or the other listeners', () => {
        const b = new MemoryBackend();
        const s = mkStore(b);
        let n = 0;
        s.onChange(() => { throw new Error('boom'); });
        s.onChange(() => { n++; });
        s.set('display.hud', false);
        expect(n).toBe(1);
        expect(JSON.parse(b.read()!).settings.global['display.hud']).toBe(false);
    });
});

describe('collections', () => {
    it('updateCollection validates, persists and hands out copies', () => {
        const b = new MemoryBackend();
        const s = mkStore(b);
        s.updateCollection('sceneLibrary', (d) => {
            d.favourites.unshift('39e63ce9', '39e63ce9', '');
        });
        expect(s.collection('sceneLibrary').favourites).toEqual(['39e63ce9']);
        const c = s.collection('sceneLibrary') as { favourites: string[] };
        c.favourites.push('x');
        expect(mkStore(b).collection('sceneLibrary').favourites).toEqual(['39e63ce9']);
    });

    it('two tabs editing different fields of one collection keep both', () => {
        const a = new MemoryBackend();
        const shared = a.tab();
        const sa = mkStore(a, { debounceMs: 1000 });
        const sb = mkStore({ read: () => shared.read(), write: (t) => shared.write(t) }, { debounceMs: 1000 });
        sa.updateCollection('sceneLibrary', (d) => { d.favourites.push('aaaa'); });
        sb.updateCollection('sceneLibrary', (d) => { d.filter.collisionOnly = false; });
        sa.flush();
        sb.flush();
        const lib = mkStore(new MemoryBackend(a.read())).collection('sceneLibrary');
        expect(lib.favourites).toEqual(['aaaa']);
        expect(lib.filter.collisionOnly).toBe(false);
    });
});

describe('a setting kept outside the document (ui.language in the NEXT_LOCALE cookie)', () => {
    class Box implements ValueBackend {
        v: string | null = null;
        read() { return this.v; }
        write(v: string | null) { this.v = v; return true; }
    }

    it('lives in its own backend, never in the document; the default removes it', () => {
        const cookie = new Box();
        const b = new MemoryBackend();
        const s = mkStore(b, { external: { 'ui.language': cookie } });
        s.set('ui.language', 'pl');
        expect(cookie.v).toBe('pl');
        expect(JSON.parse(b.read()!).settings.global['ui.language']).toBeUndefined();
        expect(s.get('ui.language')).toBe('pl');
        expect(s.exportFile().settings.global['ui.language']).toBe('pl');
        s.set('ui.language', 'browser');
        expect(cookie.v).toBeNull();
        cookie.v = 'xx'; // a value the landing never writes
        expect(s.get('ui.language')).toBe('browser');
    });

    it('an import writes it back to the cookie', () => {
        const src = mkStore(new MemoryBackend(), { external: { 'ui.language': new Box() } });
        src.set('ui.language', 'ru');
        const cookie = new Box();
        const dst = mkStore(new MemoryBackend(), { external: { 'ui.language': cookie } });
        dst.importFile(src.exportFile());
        expect(cookie.v).toBe('ru');
    });
});

describe('URL session layer', () => {
    it('reads ?set.<id>= and the legacy ?g= ?gm= ?drone= ?governor=0, set.<id> winning', () => {
        const r = settingsFromQuery(SCHEMA, '?scene=39e63ce9&g=1.62&gm=same-twr&drone=pavopico-2s&governor=0&set.respawn.auto=0&set.physics.gravity=3.72&set.nope=1&set.respawn.rewindS=abc');
        expect(Object.fromEntries(r.values.map((v) => [v.id, v.value]))).toEqual({ 'respawn.auto': false, 'physics.gravity': 3.72, 'physics.gravityMode': 'same-twr', 'drone.current': PICO, 'display.governor': false });
        expect(r.unknown).toEqual(['set.nope']);
        expect(r.invalid).toEqual(['set.respawn.rewindS']);
    });

    it('session values win over stored ones and are never written', () => {
        const b = new MemoryBackend();
        const s = mkStore(b);
        s.set('respawn.auto', true);
        for (const v of settingsFromQuery(SCHEMA, 'set.respawn.auto=0').values) s.setSession(v.id, v.value);
        expect(s.get('respawn.auto')).toBe(false);
        s.set('flight.mode', 'acro');
        expect(JSON.parse(b.read()!).settings.global['respawn.auto']).toBe(true);
        expect(s.setSession('respawn.rewindS', 500)).toEqual({ ok: true, value: 30, clamped: true });
    });
});

describe('explicitList', () => {
    it('lists every stored entry across scopes, or those of one context', () => {
        const s = mkStore();
        s.set('flight.mode', 'acro');
        s.set('physics.vCrash', 6, { drone: PRO });
        s.set('physics.vCrash', 3, { drone: PICO });
        s.set('scene.dropFloaters', 8, { scene: 'abc' });
        expect(s.explicitList().map((e) => `${e.scope}:${e.key}:${e.id}=${String(e.value)}`)).toEqual([
            'global:null:flight.mode=acro',
            `drone:${PRO}:physics.vCrash=6`,
            `drone:${PICO}:physics.vCrash=3`,
            'scene:abc:scene.dropFloaters=8'
        ]);
        expect(s.explicitList({ drone: PICO }).map((e) => e.id + '@' + e.key)).toEqual(['flight.mode@null', `physics.vCrash@${PICO}`]);
    });
});

afterEach(() => {
    vi.useRealTimers();
});

// keeps the resolver helper honest: the real preset folder has the Pavo20 Pro at vCrash 4.0
it('fixture: the preset resolver reads the real presets', () => {
    expect(resolver().field(PRO, 'v_crash_ms')).toBe(4);
    expect(new PrefsStore(SCHEMA, new MemoryBackend(), resolver(), { debounceMs: 0 }).get('physics.vCrash')).toBe(4);
});
