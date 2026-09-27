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
