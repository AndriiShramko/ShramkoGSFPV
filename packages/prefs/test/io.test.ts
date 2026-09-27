import { describe, expect, it } from 'vitest';
import { MemoryBackend, canonicalJson, exportFileName } from '../src';
import type { PrefsFile, PrefsStore } from '../src';
import { T0, mkStore } from './helpers';

const PRO = 'pavo20pro-3s';
const PICO = 'pavopico-2s';

/** A v0.2 radio profile, as controls.ts saves it (shape of @gsfpv/input Profile v1). */
const radio = (key: string, name = 'RadioMaster Pocket') => ({
    version: 1, deviceKey: key, deviceName: name, deadband: 0.02, created: '2026-09-25T10:00:00.000Z', wizard: 2,
    axes: { roll: { axis: 0, min: -1, max: 1, center: 0, invert: false }, pitch: { axis: 1, min: -1, max: 1, center: 0, invert: false }, throttle: { axis: 2, min: -1, max: 1, center: 0, invert: false }, yaw: { axis: 3, min: -1, max: 1, center: 0, invert: false } },
    arm: { kind: 'axis', axis: 4, threshold: 0.5, invert: false }, angleMode: null
});

function filled(): PrefsStore {
    const s = mkStore();
    s.set('flight.mode', 'horizon');
    s.set('respawn.rewindS', 5);
    s.set('physics.vCrash', 6, { drone: PRO });
    s.set('camera.fovDeg', 120, { drone: PRO });
    s.set('tune.pid', { roll: [54, 111, 44, 0], pitch: [68, 139, 60, 0], yaw: [54, 111, 0, 0] }, { drone: PRO });
    s.set('scene.transform', { s: 1.5, t: [0.3, 0, -1.2], v: 2 }, { scene: '9d09ab82' });
    s.updateCollection('radioProfiles', (d) => { d.items['1209:4f54:pocket'] = radio('1209:4f54:pocket') as never; d.last = { kind: 'hid', key: '1209:4f54:pocket' }; });
    s.updateCollection('sceneLibrary', (d) => {
        d.favourites = ['39e63ce9'];
        d.history = [{ id: '9d09ab82', version: 2, title: 'Room', lastFlown: 1759400000000, flights: 4, airtimeS: 312, hasCollision: true }];
        d.versions = { '9d09ab82': 2 };
    });
    s.updateCollection('stats', (d) => { d.byDrone[PRO] = { flights: 41, airtimeS: 3802, distanceM: 21450, crashes: 77 }; });
    s.updateCollection('ui', (d) => { d.warned = true; });
    return s;
}

describe('export and import (A.4)', () => {
    it('a round trip is identical (canonical JSON)', () => {
        const a = filled();
        const file = a.exportFile();
        const b = mkStore();
        const r = b.importFile(JSON.stringify(file));
        expect(r.ok).toBe(true);
        expect(canonicalJson(b.exportFile())).toBe(canonicalJson(file));
        expect(b.explicitList()).toEqual(a.explicitList());
        expect(b.collection('radioProfiles')).toEqual(a.collection('radioProfiles'));
    });

    it('the file is the document plus exportedAt and origin, under the dated name', () => {
        const f = mkStore(new MemoryBackend(), { origin: 'https://gsfpv.flyreelstudio.eu' }).exportFile();
        expect(f.format).toBe('gsfpv-prefs');
        expect(f.version).toBe(1);
        expect(f.origin).toBe('https://gsfpv.flyreelstudio.eu');
        expect(f.exportedAt).toBe(new Date(T0).toISOString());
        expect(exportFileName(T0)).toBe('gsfpv-settings-2026-10-02.json');
    });

    it('control: flipping one value in the file gives exactly one line in the preview', () => {
        const s = filled();
        const file = s.exportFile();
        expect(s.previewImport(file).changes).toEqual([]);
        const flipped = JSON.parse(JSON.stringify(file)) as PrefsFile;
        flipped.settings.drone[PRO]['physics.vCrash'] = 7.5;
        expect(s.previewImport(flipped).changes).toEqual([{ id: 'physics.vCrash', key: PRO, from: 6, to: 7.5 }]);
    });

    it('a preview changes nothing', () => {
        const s = filled();
        const before = canonicalJson(s.exportFile());
        s.previewImport(mkStore().exportFile());
        expect(canonicalJson(s.exportFile())).toBe(before);
    });

    it('a file from a newer version is refused', () => {
        const s = filled();
        const file = { ...s.exportFile(), version: 2 };
        const r = mkStore().importFile(file);
        expect(r).toMatchObject({ ok: false, error: 'newer-version', fromVersion: 2 });
    });

    it('corrupt JSON is refused with a report; so is a file that is not a settings file', () => {
        const s = filled();
        const before = canonicalJson(s.exportFile());
        expect(s.importFile('{"format":"gsfpv-prefs", "version": 1,')).toMatchObject({ ok: false, error: 'corrupt' });
        expect(s.importFile(JSON.stringify(radio('x')))).toMatchObject({ ok: false, error: 'not-a-settings-file' });
        expect(s.importFile({ format: 'gsfpv-prefs', version: 1, settings: [] })).toMatchObject({ ok: false, error: 'corrupt' });
        expect(canonicalJson(s.exportFile())).toBe(before);
    });

    it('out-of-range values are clamped and reported; wrong types and scopes dropped and reported', () => {
        const f = mkStore().exportFile();
        f.settings.global['respawn.rewindS'] = 400;
        f.settings.global['flight.mode'] = 'sport';
        f.settings.global['physics.vCrash'] = 6; // a per-drone setting stored as global
        f.settings.drone[PRO] = { 'physics.vCrash': 1, 'camera.fovDeg': '120' };
        const s = mkStore();
        const r = s.importFile(f);
        expect(r.clamped.sort()).toEqual(['physics.vCrash@pavo20pro-3s', 'respawn.rewindS']);
        expect(r.dropped.map((d) => d.id).sort()).toEqual(['camera.fovDeg', 'flight.mode', 'physics.vCrash']);
        expect(s.get('respawn.rewindS')).toBe(30);
        expect(s.get('physics.vCrash', { drone: PRO })).toBe(2);
        expect(s.isExplicit('flight.mode')).toBe(false);
    });

    it('unknown ids are kept in the document and reported', () => {
        const f = mkStore().exportFile();
        f.settings.global['future.setting'] = { any: 1 };
        f.settings.drone[PICO] = { 'future.perDrone': 3 };
        const b = new MemoryBackend();
        const s = mkStore(b);
        const r = s.importFile(f);
        expect(r.unknown).toEqual(['future.perDrone', 'future.setting']);
        expect(r.changes).toEqual([]);
        const stored = JSON.parse(b.read()!);
        expect(stored.settings.global['future.setting']).toEqual({ any: 1 });
        expect(s.exportFile().settings.drone[PICO]['future.perDrone']).toBe(3);
    });

    it('replace drops local settings the file does not have; merge keeps them and the file wins', () => {
        const file = mkStore().exportFile();
        file.settings.global['flight.mode'] = 'acro';
        const rep = filled();
        rep.importFile(file, 'replace');
        expect(rep.explicitList().map((e) => e.id)).toEqual(['flight.mode']);
        expect(rep.get('flight.mode')).toBe('acro');
        const mer = filled();
        mer.importFile(file, 'merge');
        expect(mer.get('flight.mode')).toBe('acro');
        expect(mer.get('physics.vCrash', { drone: PRO })).toBe(6);
    });

    it('merge: radios by device key, favourites as a union, history by id with the latest lastFlown', () => {
        const here = filled();
        const there = mkStore();
        there.updateCollection('radioProfiles', (d) => {
            d.items['1209:4f54:pocket'] = radio('1209:4f54:pocket', 'Pocket (recalibrated)') as never;
            d.items['0483:5750:tx16s'] = radio('0483:5750:tx16s', 'TX16S') as never;
        });
        there.updateCollection('sceneLibrary', (d) => {
            d.favourites = ['887f27aa', '39e63ce9'];
            d.history = [
                { id: '9d09ab82', version: 2, title: 'Room (older)', lastFlown: 1759000000000, flights: 1, airtimeS: 10, hasCollision: true },
                { id: '887f27aa', version: 1, lastFlown: 1759500000000, flights: 2, airtimeS: 60, hasCollision: true }
            ];
        });
        const r = here.importFile(there.exportFile(), 'merge');
        const radios = here.collection('radioProfiles');
        expect(Object.keys(radios.items).sort()).toEqual(['0483:5750:tx16s', '1209:4f54:pocket']);
        expect(radios.items['1209:4f54:pocket'].deviceName).toBe('Pocket (recalibrated)');
        expect(radios.last).toEqual({ kind: 'hid', key: '1209:4f54:pocket' });
        const lib = here.collection('sceneLibrary');
        expect(lib.favourites).toEqual(['39e63ce9', '887f27aa']);
        expect(lib.history.map((e) => [e.id, e.title ?? null])).toEqual([['887f27aa', null], ['9d09ab82', 'Room']]);
        expect(r.collections.radioProfiles).toEqual({ added: 1, changed: 1 });
        expect(r.collections.sceneLibrary.added).toBe(2); // one history entry, one favourite
    });

    it('merging the same file twice equals merging it once', () => {
        const other = filled();
        other.updateCollection('stats', (d) => { d.byDrone[PICO] = { flights: 3, airtimeS: 90, distanceM: 400, crashes: 2 }; });
        const s = mkStore();
        s.importFile(other.exportFile(), 'merge');
        const once = canonicalJson(s.exportFile());
        s.importFile(other.exportFile(), 'merge');
        expect(canonicalJson(s.exportFile())).toBe(once);
    });

    it('an export can leave collections out; replace then keeps ours for those', () => {
        const s = filled();
        const f = mkStore().exportFile({ include: ['ui'] });
        expect(Object.keys(f.collections)).toEqual(['ui']);
        s.importFile(f);
        expect(s.collection('sceneLibrary').favourites).toEqual(['39e63ce9']);
        expect(s.collection('ui').warned).toBe(false);
    });

    it('import emits one change per changed setting, with source import, and writes at once', () => {
        const b = new MemoryBackend();
        const s = mkStore(b, { debounceMs: 60000 });
        const seen: string[] = [];
        s.onChange((c) => seen.push(`${c.source}:${c.id}`));
        const f = mkStore().exportFile();
        f.settings.global['flight.mode'] = 'acro';
        s.importFile(f);
        expect(seen).toEqual(['import:flight.mode']);
        expect(JSON.parse(b.read()!).settings.global['flight.mode']).toBe('acro');
    });

    it('A.12: 100 history entries and 5 radio profiles stay under 100 KB', () => {
        const s = filled();
        s.updateCollection('sceneLibrary', (d) => {
            d.history = Array.from({ length: 120 }, (_, i) => ({ id: `scene${i.toString(16).padStart(4, '0')}`, version: 1 + (i % 3), title: 'A curated scan with a long enough title to be realistic', author: 'Andrii Shramko', license: 'CC BY 4.0', lastFlown: 1759400000000 + i, flights: i, airtimeS: i * 7.5, hasCollision: true }));
        });
        s.updateCollection('radioProfiles', (d) => { for (let i = 0; i < 5; i++) d.items[`radio${i}`] = radio(`radio${i}`) as never; });
        const text = canonicalJson(s.exportFile());
        expect(s.collection('sceneLibrary').history).toHaveLength(100);
        expect(text.length).toBeLessThan(100 * 1024);
    });
});

/**
 * The prefs review (prefsReview.mustFix[2]): the settings maps are plain objects, so a hand-made
 * file could set a map's prototype through a '__proto__' key (values that no preview or change
 * event showed, yet get() returned) or write onto a built-in through 'constructor'. Files are
 * JSON text here: an object literal with a '__proto__' key would set the prototype in the test.
 */
describe('hostile import files (review must-fix 3)', () => {
    const file = (settings: string, collections = '{}') => `{"format":"gsfpv-prefs","version":1,"app":"0.3.0","savedAt":"","settings":${settings},"collections":${collections}}`;
    const BUILTINS = [Object, Object.prototype, Object.prototype.toString] as unknown as Record<string, unknown>[];
    /** setting-like names on Object, its prototype or a built-in method: what a polluted write leaves */
    const pollution = (): string[] => BUILTINS.flatMap((o) => Object.getOwnPropertyNames(o)).filter((k) => k.includes('.'));
    const clean = () => {
        for (const o of BUILTINS) for (const k of Object.getOwnPropertyNames(o)) if (k.includes('.')) delete o[k];
    };

    it("'__proto__' in the global map: dropped and reported, never a hidden value", () => {
        const s = mkStore();
        const seen: string[] = [];
        s.onChange((c) => seen.push(c.id));
        const f = file('{"global":{"__proto__":{"physics.gravity":0,"flight.mode":"acro"}}}');
        const preview = s.previewImport(f);
        expect(preview.changes).toEqual([]);
        expect(preview.dropped).toContainEqual({ id: 'settings.global.__proto__', why: 'reserved key' });
        const r = s.importFile(f);
        expect(r.dropped).toContainEqual({ id: 'settings.global.__proto__', why: 'reserved key' });
        expect([s.get('physics.gravity'), s.get('flight.mode')]).toEqual([9.81, 'angle']);
        expect(s.explicitList()).toEqual([]);
        expect(seen).toEqual([]);
    });

    it("'constructor' as a drone id (merge): dropped and reported, Object untouched", () => {
        const before = Object.getOwnPropertyNames(Object).length;
        try {
            const s = mkStore();
            const r = s.importFile(file('{"drone":{"constructor":{"physics.vCrash":9}}}'), 'merge');
            expect((Object as unknown as Record<string, unknown>)['physics.vCrash']).toBeUndefined();
            expect(Object.getOwnPropertyNames(Object).length).toBe(before);
            expect(r.dropped).toContainEqual({ id: 'settings.drone.constructor', why: 'reserved key' });
            expect(s.explicitList()).toEqual([]);
        } finally {
            clean();
        }
    });

    it('control: the same values under real keys are previewed and applied', () => {
        const s = mkStore();
        const f = file(`{"global":{"physics.gravity":0,"flight.mode":"acro"},"drone":{"${PRO}":{"physics.vCrash":9}}}`);
        expect(s.previewImport(f).changes).toHaveLength(3);
        s.importFile(f, 'merge');
        expect([s.get('physics.gravity'), s.get('flight.mode'), s.get('physics.vCrash', { drone: PRO })]).toEqual([0, 'acro', 9]);
        expect(pollution()).toEqual([]);
    });

    it('reserved keys inside collections are dropped and reported; a key such as toString is data, never a built-in', () => {
        const profile = (key: string) => JSON.stringify(radio(key));
        const cols = `{"radioProfiles":{"v":1,"items":{"__proto__":${profile('__proto__')},"x":${profile('constructor')},"hid:pocket":${profile('hid:pocket')}}},`
            + '"stats":{"v":1,"byDrone":{"__proto__":{"flights":5},"toString":{"flights":3,"airtimeS":1,"distanceM":1,"crashes":1}}},'
            + '"sceneLibrary":{"v":1,"history":[{"id":"__proto__","lastFlown":1},{"id":"abc123","lastFlown":2}],"favourites":["constructor","abc123"],"versions":{"__proto__":2,"prototype":3,"abc123":2}}}';
        try {
            const s = mkStore();
            s.updateCollection('stats', (d) => { d.byDrone[PRO] = { flights: 1, airtimeS: 1, distanceM: 1, crashes: 1 }; });
            const r = s.importFile(file('{}', cols), 'merge');
            expect(r.dropped.filter((d) => d.why === 'reserved key').map((d) => d.id).sort()).toEqual([
                'collections.radioProfiles.items.__proto__',
                'collections.radioProfiles.items.constructor',
                'collections.sceneLibrary.favourites.constructor',
                'collections.sceneLibrary.history.__proto__',
                'collections.sceneLibrary.versions.__proto__',
                'collections.sceneLibrary.versions.prototype',
                'collections.stats.byDrone.__proto__'
            ]);
            expect(Object.keys(s.collection('radioProfiles').items)).toEqual(['hid:pocket']);
            expect(s.collection('stats').byDrone.toString).toEqual({ flights: 3, airtimeS: 1, distanceM: 1, crashes: 1 });
            expect(s.collection('sceneLibrary').history.map((e) => e.id)).toEqual(['abc123']);
            expect(s.collection('sceneLibrary').favourites).toEqual(['abc123']);
            expect(s.collection('sceneLibrary').versions).toEqual({ abc123: 2 });
            expect(pollution()).toEqual([]);
        } finally {
            clean();
        }
    });

    it('a reserved drone or scene id from the page is no context: nothing is written onto Object or its prototype', () => {
        try {
            const s = mkStore();
            expect(s.set('scene.dropFloaters', 8, { scene: '__proto__' })).toEqual({ ok: false, reason: 'no-context' });
            expect(s.set('physics.vCrash', 6, { drone: 'constructor' })).toEqual({ ok: false, reason: 'no-context' });
            expect(s.set('physics.vCrash', 6, { drone: 'toString' })).toEqual({ ok: true, value: 6, clamped: false });
            expect(({} as Record<string, unknown>)['scene.dropFloaters']).toBeUndefined();
            expect(pollution()).toEqual([]);
            expect(s.get('physics.vCrash', { drone: 'toString' })).toBe(6);
            expect(s.get('physics.vCrash', { drone: 'valueOf' })).toBe(4);
        } finally {
            clean();
        }
    });
});
