import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LEGACY_KEYS, LEGACY_PREFIXES, MACHINE_LOCAL_KEYS, MAIN_VOXEL_DEFAULTS, MIGRATIONS, MemoryBackend, PrefsStore, SCHEMA, canonicalJson, localStorageKeys, localStorageLegacy, migrateLegacy, parseLegacyLastLog, readLegacy, runMigrations } from '../src';
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

/**
 * Every key written before v0.3 (v0.2, and main after it: gsfpv.voxels, gsfpv.walls.<scene>), with
 * a value in its real shape; plus the machine-local bake speed, which must never move.
 */
const V02: Record<string, string> = {
    // voxels.ts saves all three fields at every change: 0.55 is main's default, so only style and opacityOnly are choices
    'gsfpv.voxels': JSON.stringify({ style: 'solid', opacityOverlay: 0.55, opacityOnly: 0.8 }),
    'gsfpv.walls.39e63ce9': 'off',
    'gsfpv.walls.9d09ab82': 'on',
    'gsfpv.bakeSecondsPerMillion': '41.3',
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

/**
 * Storage keys in the simulator sources: string literals, and template literals whose key goes on
 * with the scene id (`gsfpv.walls.${sceneId}`, reported as 'gsfpv.walls.*').
 */
const SOURCES = [join(REPO, 'apps', 'fly', 'src'), join(REPO, 'packages', 'scenes', 'src'), join(REPO, 'packages', 'input', 'src')];
function keysInSource(dirs: string[] = SOURCES): Set<string> {
    const out = new Set<string>();
    const walk = (dir: string) => {
        for (const n of readdirSync(dir)) {
            const p = join(dir, n);
            if (statSync(p).isDirectory()) walk(p);
            else if (/\.tsx?$/.test(n)) for (const m of readFileSync(p, 'utf8').matchAll(/['"`](gsfpv\.[A-Za-z]+(?:\.v\d+)?)(\.\$\{|['"`])/g)) out.add(m[2] === '.${' ? `${m[1]}.*` : m[1]);
        }
    };
    for (const d of dirs) walk(d);
    out.delete('gsfpv.prefs.v1'); // the v0.3 document itself, once the page uses it
    return out;
}
/** What the sources may write: the legacy keys, one pattern per legacy prefix, and the machine-local keys. */
const classified = (local: Readonly<Record<string, string>> = MACHINE_LOCAL_KEYS) => [...Object.values(LEGACY_KEYS), ...Object.values(LEGACY_PREFIXES).map((p) => `${p}*`), ...Object.keys(local)].sort();
const V02_KEYS = () => Object.keys(V02);

describe('legacy migration v0 -> v1 (A.5)', () => {
    it('every storage key the sources write is a legacy key, a legacy prefix or machine-local, and the fixture has each', () => {
        // a subset: a legacy key its owner no longer writes (moved into the store, wave 2 on) stays
        // legacy, since the first-boot migration still reads it
        const known = classified();
        for (const k of keysInSource()) expect(known, k).toContain(k);
        const fixture = new Set(Object.keys(V02).map((k) => {
            const p = Object.values(LEGACY_PREFIXES).find((x) => k.startsWith(x));
            return p ? `${p}*` : k;
        }));
        expect([...fixture].sort()).toEqual(classified());
    });

    it('control: a new key planted in a source file, as a literal or per scene, is found, so the check above would fail', () => {
        const dir = mkdtempSync(join(tmpdir(), 'prefs-scan-'));
        try {
            writeFileSync(join(dir, 'planted.ts'), "localStorage.setItem('gsfpv.newThing.v1', '1');\nconst k = (id: string) => `gsfpv.perScene.${id}`;");
            const found = keysInSource([...SOURCES, dir]);
            expect(found.has('gsfpv.newThing.v1')).toBe(true);
            expect(found.has('gsfpv.perScene.*')).toBe(true);
            expect([...found].sort()).not.toEqual(classified());
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('machine-local keys are listed with the reason they are not preferences, and are never read into the document', () => {
        for (const [k, why] of Object.entries(MACHINE_LOCAL_KEYS)) {
            expect(why.length, k).toBeGreaterThan(20);
            expect(Object.values(LEGACY_KEYS).includes(k as never) || Object.values(LEGACY_PREFIXES).some((p) => k.startsWith(p)), k).toBe(false);
        }
        expect(Object.keys(MACHINE_LOCAL_KEYS)).toContain('gsfpv.bakeSecondsPerMillion');
        const asked: string[] = [];
        const m = migrateLegacy((k) => { asked.push(k); return V02[k] ?? null; }, {}, V02_KEYS);
        expect(asked).not.toContain('gsfpv.bakeSecondsPerMillion');
        expect(m.found).not.toContain('gsfpv.bakeSecondsPerMillion');
        expect(canonicalJson(m.doc)).not.toContain('41.3');
    });

    it('control: without its exemption the bake speed would be an unclassified key', () => {
        const { 'gsfpv.bakeSecondsPerMillion': _, ...rest } = MACHINE_LOCAL_KEYS;
        expect([...keysInSource()].sort()).not.toEqual(classified(rest));
    });

    it('moves every key into the document, in its v0.3 shape', () => {
        const m = migrateLegacy((k) => V02[k] ?? null, { savedAt: new Date(T0).toISOString() }, V02_KEYS);
        const d = m.doc;
        expect(d.version).toBe(SCHEMA.version);
        // the walls: one choice for every scan, the one of the scan flown last (39e63ce9: off)
        expect(d.settings.global).toEqual({ 'input.stickMode': '1', 'voxels.style': 'solid', 'voxels.opacityOnly': 0.8, 'scene.walls': 'off' });
        expect(d.settings.scene).toEqual({});
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
        expect(m.note.moved.sort()).toEqual([...Object.values(LEGACY_KEYS).filter((k) => k !== LEGACY_KEYS.lastLog), 'gsfpv.walls.39e63ce9', 'gsfpv.walls.9d09ab82', 'scene.walls@39e63ce9', 'scene.walls@9d09ab82'].sort());
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

    it('the store boots from the legacy keys: radios, stick mode, favourites, the warning, the voxel look and the walls are there', () => {
        const s = mkStore(new MemoryBackend(), { legacy: (k) => V02[k] ?? null, legacyKeys: V02_KEYS }, SCHEMA, {}, { '39e63ce9': { walls: 'on' }, '9d09ab82': { walls: 'off' } });
        expect(s.get('input.stickMode')).toBe('1');
        expect(s.isExplicit('input.stickMode')).toBe(true);
        expect(Object.keys(s.collection('radioProfiles').items)).toHaveLength(2);
        expect(s.collection('ui').warned).toBe(true);
        expect([s.get('voxels.style'), s.get('voxels.opacity'), s.get('voxels.opacityOnly')]).toEqual(['solid', 0.55, 0.8]);
        expect(s.isExplicit('voxels.opacity')).toBe(false);
        // the pilot's last switch (off, on the scan flown last) wins over the admin's value on every scan
        expect([s.get('scene.walls', { scene: '39e63ce9' }), s.get('scene.walls', { scene: '9d09ab82' })]).toEqual(['off', 'off']);
        expect(s.migrated?.found.sort()).toEqual(Object.keys(V02).filter((k) => !Object.hasOwn(MACHINE_LOCAL_KEYS, k)).sort());
    });

    it('legacy keys are left untouched, through boot, changes and a reset', () => {
        const ls = new FakeStorage(V02);
        const read = localStorageLegacy(ls as unknown as Storage);
        const s = new PrefsStore(SCHEMA, new MemoryBackend(), resolver(), { legacy: read, legacyKeys: localStorageKeys(ls as unknown as Storage), debounceMs: 0 });
        expect(s.get('scene.walls', { scene: '39e63ce9' })).toBe('off');
        s.set('flight.mode', 'acro');
        s.set('scene.walls', 'on', { scene: '39e63ce9' });
        s.updateCollection('sceneLibrary', (d) => { d.favourites = []; });
        s.resetAll({ collections: ['radioProfiles'] });
        expect(ls.writes).toEqual([]);
        expect(Object.fromEntries(ls.m)).toEqual(V02);
    });

    it('gsfpv.voxels: main\'s own reading rules; a field equal to main\'s default is no choice', () => {
        const run = (v: string) => migrateLegacy((k) => (k === 'gsfpv.voxels' ? v : null));
        expect(run(JSON.stringify(MAIN_VOXEL_DEFAULTS)).doc.settings.global).toEqual({});
        expect(run(JSON.stringify(MAIN_VOXEL_DEFAULTS)).note).toEqual({ moved: [], ignored: [] });
        expect(run('{"style":"height","opacityOverlay":0.3}').doc.settings.global).toEqual({ 'voxels.style': 'height', 'voxels.opacity': 0.3 });
        const bad = run('{"style":"grid","opacityOverlay":0,"opacityOnly":1.5}');
        expect(bad.doc.settings.global).toEqual({});
        expect(bad.note.ignored).toEqual([{ key: 'gsfpv.voxels', why: "style 'grid' is not one of solid, wire, height, floaters; opacityOverlay 0 is not within 0.05-1; opacityOnly 1.5 is not within 0.05-1" }]);
        expect(run('[1]').note.ignored).toEqual([{ key: 'gsfpv.voxels', why: 'not an object' }]);
        expect(run('{').note.ignored).toEqual([{ key: 'gsfpv.voxels', why: 'not JSON' }]);
    });

    it('gsfpv.walls.<scene>: on or off for a real scene id; anything else is skipped with its reason', () => {
        const keys: Record<string, string> = { 'gsfpv.walls.abc123': 'off', 'gsfpv.walls.__proto__': 'off', 'gsfpv.walls.ABC123': 'on', 'gsfpv.walls.def456': 'maybe', 'gsfpv.walls.': 'off' };
        const m = migrateLegacy((k) => keys[k] ?? null, {}, () => Object.keys(keys));
        expect(m.doc.settings.scene).toEqual({});
        expect(m.doc.settings.global['scene.walls']).toBe('off');
        expect(m.note.ignored.sort((a, b) => a.key.localeCompare(b.key))).toEqual([
            { key: 'gsfpv.walls.__proto__', why: "'__proto__' is not a scene id" },
            { key: 'gsfpv.walls.ABC123', why: "'ABC123' is not a scene id" },
            { key: 'gsfpv.walls.def456', why: "value 'maybe' is not on or off" }
        ]);
        expect(Object.prototype).not.toHaveProperty('scene.walls');
    });

    it('control: without the storage\'s key names the per-scan keys are not found (openBrowserPrefs passes them)', () => {
        expect(migrateLegacy((k) => V02[k] ?? null).doc.settings.scene).toEqual({});
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
        expect(MIGRATIONS.map((m) => [m.from, m.to])).toEqual([[0, 1], [1, 2]]);
        expect(runMigrations(readLegacy((k) => V02[k] ?? null), 0).version).toBe(SCHEMA.version);
    });

    it('control: a version with no migration throws instead of guessing', () => {
        expect(() => runMigrations({}, -1)).toThrow(/no migration from version -1/);
        expect(() => runMigrations({ not: 'a bag' }, 0)).toThrow(/needs a legacy bag/);
    });
});

describe('schema 1 -> 2: the walls switch becomes one choice for every scan', () => {
    const V1 = (scene: Record<string, Record<string, unknown>>, history: { id: string; lastFlown: number }[] = [], global: Record<string, unknown> = {}) => ({
        format: 'gsfpv-prefs', version: 1, app: '0.3.0', savedAt: '2026-10-01T00:00:00.000Z',
        settings: { global, drone: {}, scene },
        collections: { sceneLibrary: { v: 1, history: history.map((h) => ({ ...h, version: 1, flights: 1, airtimeS: 0, hasCollision: true })), favourites: [], filter: { collisionOnly: true, kind: 'all', flown: 'all', maxMb: null }, versions: {} } }
    });
    const walls = (doc: ReturnType<typeof V1>) => runMigrations(doc, 1).settings;

    it('the choice on the scan flown last wins; the per-scan entries go, other scene settings stay', () => {
        const out = walls(V1({ aaaaaa: { 'scene.walls': 'on' }, bbbbbb: { 'scene.walls': 'off', 'scene.dropFloaters': 4 } }, [{ id: 'aaaaaa', lastFlown: 2 }, { id: 'bbbbbb', lastFlown: 1 }]));
        expect(out.global['scene.walls']).toBe('on');
        expect(out.scene).toEqual({ bbbbbb: { 'scene.dropFloaters': 4 } });
    });

    it('nothing flown (or a tie): off wins, the owner rule; no choice at all stores nothing', () => {
        expect(walls(V1({ aaaaaa: { 'scene.walls': 'on' }, bbbbbb: { 'scene.walls': 'off' } })).global['scene.walls']).toBe('off');
        expect(walls(V1({ aaaaaa: { 'scene.dropFloaters': 2 } })).global).toEqual({});
    });

    it('a stored v1 document and an imported v1 file both arrive migrated', () => {
        const doc = V1({ aaaaaa: { 'scene.walls': 'off' } });
        const b = new MemoryBackend(JSON.stringify(doc));
        const s = mkStore(b, {}, SCHEMA, {}, { cccccc: { walls: 'on' } });
        expect(s.get('scene.walls', { scene: 'cccccc' })).toBe('off'); // another scan, admin on: the pilot's off holds
        expect(s.migrated?.from).toBe(1);
        expect(JSON.parse(b.read()!).version).toBe(SCHEMA.version);
        const t = mkStore(new MemoryBackend(), {}, SCHEMA, {}, { cccccc: { walls: 'on' } });
        expect(t.importFile(JSON.stringify(doc)).ok).toBe(true);
        expect(t.get('scene.walls', { scene: 'cccccc' })).toBe('off');
    });

    it('control: read as schema 2 without the migration, the old per-scan entry is not a choice and the admin rules', () => {
        const doc = { ...V1({ aaaaaa: { 'scene.walls': 'off' } }), version: SCHEMA.version };
        const s = mkStore(new MemoryBackend(JSON.stringify(doc)), {}, SCHEMA, {}, { cccccc: { walls: 'on' } });
        expect(s.get('scene.walls', { scene: 'cccccc' })).toBe('on');
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
