import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LEGACY_KEYS, MIGRATIONS, MemoryBackend, PrefsStore, SCHEMA, canonicalJson, localStorageLegacy, migrateLegacy, parseLegacyLastLog, readLegacy, runMigrations } from '../src';
import { FakeStorage, REPO, T0, mkStore, resolver } from './helpers';

// ------------------------------------------------------------------ v0.2 shapes, as v0.2 wrote them

/** controls.ts saveProfile: Record<deviceKey, Profile> (@gsfpv/input calib.ts Profile v1). */
const POCKET = {
    version: 1, deviceKey: '1209:4f54:RadioMaster Pocket Joystick', deviceName: 'RadioMaster Pocket Joystick', deadband: 0.03, created: '2026-09-25T18:02:11.412Z', mode: 2, wizard: 2,
    axes: { roll: { index: 0, invert: false, center: 0.004, min: -0.992, max: 0.996 }, pitch: { index: 1, invert: true, center: -0.012, min: -0.988, max: 0.992 }, throttle: { index: 2, invert: false, center: 0, min: -1, max: 1 }, yaw: { index: 3, invert: false, center: 0.008, min: -0.996, max: 0.992 } },
    arm: { kind: 'axis', index: 4, threshold: 0, onAbove: true, off: -1, on: 1 }, angleMode: null
};
/** made by the first wizard (no `wizard` field), arming on a gamepad button */
const PAD = { version: 1, deviceKey: 'gamepad:Xbox Wireless Controller', deviceName: 'Xbox Wireless Controller', deadband: 0.05, created: '2026-09-22T09:00:00.000Z', axes: { roll: { index: 2, invert: false, center: 0, min: -1, max: 1 }, pitch: { index: 3, invert: true, center: 0, min: -1, max: 1 }, throttle: { index: 1, invert: true, center: 0, min: -1, max: 1 }, yaw: { index: 0, invert: false, center: 0, min: -1, max: 1 } }, arm: { kind: 'button', bit: 0, toggle: true }, angleMode: null };
/** an arm input this version cannot read: v0.2 parseProfile refused it, so must the migration */
const ALIEN = { ...PAD, deviceKey: 'hid:alien', arm: { kind: 'switch3', index: 5 } };

const LAST_LOG = { label: 'crash 12:04', header: { format: 'gsfpv-input-log/1', simCore: 'sim-core/0.1.0', preset: 'pavo20pro-3s', configHash: 'ab12', collisionSha256: null, spawn: [0, 1.2, 0, 90], seed: 0 }, endTick: 30211, hash: '9f0c', b64: 'AAAAAAAAgD8=' };

/** Every key v0.2 writes, with a value in its real shape. */
const V02: Record<string, string> = {
    'gsfpv.profiles.v1': JSON.stringify({ [POCKET.deviceKey]: POCKET, [PAD.deviceKey]: PAD, [ALIEN.deviceKey]: ALIEN }),
    'gsfpv.stickMode': '1',
    'gsfpv.lastInput': JSON.stringify({ kind: 'hid', key: POCKET.deviceKey }),
    'gsfpv.history.v1': JSON.stringify([
        { id: '9d09ab82', title: 'Old house', lastFlown: 1758900000000, flights: 4, hasCollision: true },
        { id: '39e63ce9', title: 'Modlinek Villa', lastFlown: 1759000000000, flights: 11, hasCollision: true },
        { id: '723068d7', lastFlown: 1758000000000, flights: 0, hasCollision: null }
    ]),
    'gsfpv.favourites.v1': JSON.stringify(['39e63ce9', '9d09ab82']),
    'gsfpv.filter.v1': JSON.stringify({ collisionOnly: false, kind: 'interior', flown: 'all', maxMb: 200 }),
    'gsfpv.versions.v1': JSON.stringify([['9d09ab82', 2], ['junk'], ['723068d7', 3]]),
    'gsfpv.warned': '1',
    'gsfpv.lastLog': JSON.stringify(LAST_LOG)
};

/** Storage-key string literals in the v0.2 simulator sources. */
const SOURCES = [join(REPO, 'apps', 'fly', 'src'), join(REPO, 'packages', 'scenes', 'src'), join(REPO, 'packages', 'input', 'src')];
function keysInSource(dirs: string[] = SOURCES): Set<string> {
    const out = new Set<string>();
    const walk = (dir: string) => {
        for (const n of readdirSync(dir)) {
            const p = join(dir, n);
            if (statSync(p).isDirectory()) walk(p);
            else if (/\.tsx?$/.test(n)) for (const m of readFileSync(p, 'utf8').matchAll(/['"`](gsfpv\.[A-Za-z]+(?:\.v\d+)?)['"`]/g)) out.add(m[1]);
        }
    };
    for (const d of dirs) walk(d);
    out.delete('gsfpv.prefs.v1'); // the v0.3 document itself, once the page uses it
    return out;
}

describe('legacy migration v0 -> v1 (A.5)', () => {
    it('the fixture covers every storage key the v0.2 sources write, and LEGACY_KEYS names each', () => {
        const inSource = keysInSource();
        expect([...inSource].sort()).toEqual(Object.values(LEGACY_KEYS).sort());
        expect(Object.keys(V02).sort()).toEqual(Object.values(LEGACY_KEYS).sort());
    });

    it('control: a new storage key planted in a source file is found, so the check above would fail', () => {
        const dir = mkdtempSync(join(tmpdir(), 'prefs-scan-'));
        try {
            writeFileSync(join(dir, 'planted.ts'), "localStorage.setItem('gsfpv.newThing.v1', '1');");
            const found = keysInSource([...SOURCES, dir]);
            expect(found.has('gsfpv.newThing.v1')).toBe(true);
            expect([...found].sort()).not.toEqual(Object.values(LEGACY_KEYS).sort());
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('moves every key into the document, in its v0.3 shape', () => {
        const m = migrateLegacy((k) => V02[k] ?? null, { savedAt: new Date(T0).toISOString() });
        const d = m.doc;
        expect(d.version).toBe(1);
        expect(d.settings.global).toEqual({ 'input.stickMode': '1' });
        // radios: the two readable ones, unchanged, keyed by device key; the last input kept
        expect(d.collections.radioProfiles.items).toEqual({ [POCKET.deviceKey]: POCKET, [PAD.deviceKey]: PAD });
        expect(d.collections.radioProfiles.last).toEqual({ kind: 'hid', key: POCKET.deviceKey });
        // history: newest first, each with its version (from versions.v1, else 1) and no airtime yet
        expect(d.collections.sceneLibrary.history).toEqual([
            { id: '39e63ce9', title: 'Modlinek Villa', version: 1, lastFlown: 1759000000000, flights: 11, airtimeS: 0, hasCollision: true },
            { id: '9d09ab82', title: 'Old house', version: 2, lastFlown: 1758900000000, flights: 4, airtimeS: 0, hasCollision: true },
            { id: '723068d7', version: 3, lastFlown: 1758000000000, flights: 0, airtimeS: 0, hasCollision: null }
        ]);
        expect(d.collections.sceneLibrary.favourites).toEqual(['39e63ce9', '9d09ab82']);
        expect(d.collections.sceneLibrary.filter).toEqual({ collisionOnly: false, kind: 'interior', flown: 'all', maxMb: 200 });
        expect(d.collections.sceneLibrary.versions).toEqual({ '9d09ab82': 2, '723068d7': 3 });
        expect(d.collections.ui.warned).toBe(true);
        expect(m.note.moved.sort()).toEqual(Object.values(LEGACY_KEYS).filter((k) => k !== LEGACY_KEYS.lastLog).sort());
        expect(m.note.ignored).toEqual([{ key: 'gsfpv.profiles.v1', why: '1 profile(s) this version cannot read' }]);
        // the flight log is not document material: it goes to IndexedDB
        expect(canonicalJson(d)).not.toContain('AAAAAAAAgD8=');
    });

    it('stick mode 2 and a partial v0.2 filter migrate too (v0.2 read the filter over its defaults)', () => {
        const d = migrateLegacy((k) => ({ 'gsfpv.stickMode': '2', 'gsfpv.filter.v1': '{"kind":"exterior"}', 'gsfpv.warned': '0' })[k] ?? null).doc;
        expect(d.settings.global['input.stickMode']).toBe('2');
        expect(d.collections.sceneLibrary.filter).toEqual({ collisionOnly: true, kind: 'exterior', flown: 'all', maxMb: null });
        expect(d.collections.ui.warned).toBe(false);
    });

    it('a broken key is skipped with its reason; the others still move', () => {
        const m = migrateLegacy((k) => ({ ...V02, 'gsfpv.history.v1': '[{"id":', 'gsfpv.stickMode': '3', 'gsfpv.lastInput': '{"kind":"mouse"}' })[k] ?? null);
        expect(m.note.ignored.map((i) => i.key).sort()).toEqual(['gsfpv.history.v1', 'gsfpv.lastInput', 'gsfpv.profiles.v1', 'gsfpv.stickMode']);
        expect(m.doc.collections.sceneLibrary.history).toEqual([]);
        expect(m.doc.collections.sceneLibrary.favourites).toEqual(['39e63ce9', '9d09ab82']);
        expect(m.doc.collections.radioProfiles.last).toBeNull();
    });

    it('running it twice is the same as once', () => {
        const once = migrateLegacy((k) => V02[k] ?? null, { savedAt: 'x' });
        const twice = migrateLegacy((k) => V02[k] ?? null, { savedAt: 'x' });
        expect(canonicalJson(twice.doc)).toBe(canonicalJson(once.doc));
        const b = new MemoryBackend();
        const legacy = (k: string) => V02[k] ?? null;
        const first = mkStore(b, { legacy });
        const text = b.read();
        const second = mkStore(b, { legacy });
        expect(first.migrated?.from).toBe(0);
        expect(second.migrated).toBeNull();
        expect(b.read()).toBe(text);
    });

    it('the store boots from the legacy keys: radios, stick mode, favourites and the warning are there', () => {
        const s = mkStore(new MemoryBackend(), { legacy: (k) => V02[k] ?? null });
        expect(s.get('input.stickMode')).toBe('1');
        expect(s.isExplicit('input.stickMode')).toBe(true);
        expect(Object.keys(s.collection('radioProfiles').items)).toHaveLength(2);
        expect(s.collection('ui').warned).toBe(true);
        expect(s.migrated?.found.sort()).toEqual(Object.values(LEGACY_KEYS).sort());
    });

    it('legacy keys are left untouched, through boot, changes and a reset', () => {
        const ls = new FakeStorage(V02);
        const read = localStorageLegacy(ls as unknown as Storage);
        const s = new PrefsStore(SCHEMA, new MemoryBackend(), resolver(), { legacy: read, debounceMs: 0 });
        s.set('flight.mode', 'acro');
        s.updateCollection('sceneLibrary', (d) => { d.favourites = []; });
        s.resetAll({ collections: ['radioProfiles'] });
        expect(ls.writes).toEqual([]);
        expect(Object.fromEntries(ls.m)).toEqual(V02);
    });

    it('no legacy keys: an empty document, nothing reported', () => {
        const s = mkStore(new MemoryBackend(), { legacy: () => null });
        expect(s.explicitList()).toEqual([]);
        expect(s.migrated).toEqual({ from: 0, found: [], moved: [], ignored: [] });
    });

    it('a throwing storage read counts as absent', () => {
        const bag = readLegacy(() => { throw new Error('SecurityError'); });
        expect(bag.keys).toEqual({});
    });
});

describe('migration chain', () => {
    it('MIGRATIONS starts at version 0 (the legacy bag) and reaches the schema version', () => {
        expect(MIGRATIONS.map((m) => [m.from, m.to])).toEqual([[0, 1]]);
        expect(runMigrations(readLegacy((k) => V02[k] ?? null), 0).version).toBe(SCHEMA.version);
    });

    it('control: a version with no migration throws instead of guessing', () => {
        expect(() => runMigrations({}, -1)).toThrow(/no migration from version -1/);
        expect(() => runMigrations({ not: 'a bag' }, 0)).toThrow(/needs a legacy bag/);
    });
});

describe('the v0.2 flight log key', () => {
    it('parses in its real shape', () => {
        expect(parseLegacyLastLog(V02['gsfpv.lastLog'])).toEqual(LAST_LOG);
    });

    it('control: a log without its bytes, or broken JSON, is not a log', () => {
        expect(parseLegacyLastLog(JSON.stringify({ ...LAST_LOG, b64: undefined }))).toBeNull();
        expect(parseLegacyLastLog('{"label":')).toBeNull();
        expect(parseLegacyLastLog(null)).toBeNull();
    });
});
