import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DRONE_IDS, RATE_BOUNDS, SCHEMA, actionsOf, bindingOf, defineSettings, isCuratedRef, isPresetRef, validateFolder, validatePid, validateRates, validateThrottle, validateTransform } from '../src';
import type { EnumDef, NumDef, SettingDef } from '../src';
import { RATE_BOUNDS as SIM_RATE_BOUNDS } from '../../sim-core/src/rates';
import { MAIN_SETTINGS, PRESETS, REPO, V02_SETTINGS } from './helpers';

/**
 * docs/architecture-v03.md A.8, row by row, brought up to what main ships (the voxel grid and the
 * walls switch landed before prefs was wired, see defs/voxels.ts and defs/scene.ts): id, group,
 * scope, type, default, apply. 'preset:<field>' = the drone preset's field; 'curated:<field>|x' =
 * the admin's value per scan in showcase.json, else x; null = the preset's own tune.
 */
const A8: [string, string, string, string, unknown, string][] = [
    ['flight.mode', 'flight', 'global', 'enum', 'angle', 'live'],
    ['level.angleLimitDeg', 'flight', 'drone', 'number', 60, 'life'],
    ['level.strength', 'flight', 'drone', 'number', 50, 'life'],
    ['level.horizonStrength', 'flight', 'drone', 'number', 75, 'life'],
    ['crash.enabled', 'crash', 'global', 'bool', true, 'life'],
    ['physics.vCrash', 'crash', 'drone', 'number', 'preset:v_crash_ms', 'life'],
    ['respawn.auto', 'crash', 'global', 'bool', true, 'live'],
    ['respawn.delayS', 'crash', 'global', 'number', 2, 'live'],
    ['respawn.target', 'crash', 'global', 'enum', 'rewind', 'live'],
    ['respawn.rewindS', 'crash', 'global', 'number', 5, 'live'],
    ['respawn.platform', 'crash', 'global', 'bool', true, 'live'],
    ['respawn.keepArmed', 'crash', 'global', 'bool', true, 'live'],
    ['respawn.unstuck', 'crash', 'global', 'bool', true, 'live'],
    ['respawn.showPad', 'crash', 'global', 'bool', false, 'live'],
    ['battery.refill', 'crash', 'global', 'enum', 'start', 'live'],
    ['camera.fovDeg', 'camera', 'drone', 'number', 'preset:camera_fov_deg', 'live'],
    ['camera.uptiltDeg', 'camera', 'drone', 'number', 'preset:camera_uptilt_deg', 'live'],
    ['display.hud', 'display', 'global', 'bool', true, 'live'],
    ['display.units', 'display', 'global', 'enum', 'metric', 'live'],
    ['display.quality', 'display', 'global', 'number', 1, 'live'],
    ['display.governor', 'display', 'global', 'bool', true, 'live'],
    ['display.latencyGuard', 'display', 'global', 'bool', true, 'live'],
    ['display.reducedMotion', 'display', 'global', 'enum', 'system', 'live'],
    ['display.frameStats', 'display', 'global', 'bool', false, 'live'],
    ['stats.onDisarm', 'display', 'global', 'bool', true, 'live'],
    ['ui.language', 'display', 'global', 'enum', 'browser', 'reload'],
    ['input.stickMode', 'input', 'global', 'enum', '2', 'live'],
    ['drone.current', 'drone', 'global', 'enum', 'pavo20pro-3s', 'life'],
    ['physics.gravity', 'drone', 'global', 'number', 9.81, 'life'],
    ['physics.gravityMode', 'drone', 'global', 'enum', 'honest', 'life'],
    ['physics.twr', 'drone', 'drone', 'number', 'preset:twr', 'life'],
    ['physics.tauMs', 'drone', 'drone', 'number', 'preset:motor_tau_ms', 'life'],
    ['physics.dragScale', 'drone', 'drone', 'number', 1, 'life'],
    ['physics.ductDrag', 'drone', 'drone', 'number', 'preset:rotor_drag_per_s', 'life'],
    ['physics.propInertia', 'drone', 'drone', 'number', 1, 'life'],
    ['physics.idlePct', 'drone', 'drone', 'number', 'preset:motor_idle', 'life'],
    ['tune.pid', 'tune', 'drone', 'json', null, 'life'],
    ['tune.rates', 'tune', 'drone', 'json', null, 'life'],
    ['tune.throttle', 'tune', 'drone', 'json', null, 'life'],
    ['scenes.autoSwitch', 'scenes', 'global', 'bool', false, 'live'],
    ['scenes.rotation', 'scenes', 'global', 'enum', 'curated', 'live'],
    ['scenes.order', 'scenes', 'global', 'enum', 'random', 'live'],
    ['scenes.allowNoWalls', 'scenes', 'global', 'bool', false, 'live'],
    ['scene.transform', 'scenes', 'scene', 'json', null, 'live'],
    ['scene.dropFloaters', 'voxels', 'scene', 'number', 0, 'life'],
    ['scene.walls', 'voxels', 'scene', 'enum', 'curated:walls|on', 'life'],
    ['voxels.show', 'voxels', 'global', 'enum', 'off', 'live'],
    ['voxels.opacity', 'voxels', 'global', 'number', 0.55, 'live'],
    ['voxels.opacityOnly', 'voxels', 'global', 'number', 1, 'live'],
    ['voxels.style', 'voxels', 'global', 'enum', 'wire', 'live'],
    ['voxels.radiusM', 'voxels', 'global', 'number', 20, 'live'],
    ['recording.fps', 'recording', 'global', 'enum', '60', 'live'],
    ['recording.resolution', 'recording', 'global', 'enum', '1080p', 'live'],
    ['recording.auto', 'recording', 'global', 'bool', false, 'live'],
    ['recording.folder', 'recording', 'global', 'json', null, 'live'],
    ['recording.splitMin', 'recording', 'global', 'number', 10, 'live']
];

/**
 * New settings (not in v0.2) that are shipped but lack set.<id> / set.<id>.help in a language of
 * the `set` namespace: the wave that ships a setting adds its text first (I.1 fails without it).
 * At wave 1 no new setting is shipped, so this is empty by construction.
 */
function untranslatedNewShipped(defs: readonly SettingDef[]): string[] {
    const dicts = ['en', 'es', 'pl', 'ru'].map((l) => JSON.parse(readFileSync(join(REPO, 'packages', 'i18n', 'locales', 'fly', 'set', `${l}.json`), 'utf8')) as Record<string, string>);
    return defs.filter((d) => d.status === 'shipped' && !V02_SETTINGS.includes(d.id) && dicts.some((t) => !t[`set.${d.id}`] || !t[`set.${d.id}.help`])).map((d) => d.id);
}

describe('SCHEMA is the A.8 table', () => {
    it('has the 56 settings (A.8\'s 53, main\'s voxel opacity with the scan hidden, the walls switch, the latency guard), each with its group, scope, type, default and apply', () => {
        expect(SCHEMA.defs).toHaveLength(56);
        const got = SCHEMA.defs.map((d) => [d.id, d.group, d.scope, d.type, isPresetRef(d.default) ? `preset:${d.default.preset}` : isCuratedRef(d.default) ? `curated:${d.default.curated}|${String(d.default.fallback)}` : d.default, d.apply]);
        // order inside a group follows the def files, not the table's rows
        const byId = (a: unknown[], b: unknown[]) => String(a[0]).localeCompare(String(b[0]));
        expect([...got].sort(byId)).toEqual([...A8].sort(byId));
        expect([...new Set(got.map((r) => r[1]))]).toEqual([...new Set(A8.map((r) => r[1]))]);
    });

    it('existing (v0.2) settings are shipped; a new one ships only with its text in all four languages', () => {
        const shipped = SCHEMA.defs.filter((d) => d.status === 'shipped').map((d) => d.id);
        for (const id of V02_SETTINGS) expect(shipped, id).toContain(id);
        expect(untranslatedNewShipped(SCHEMA.defs)).toEqual([]);
        expect(SCHEMA.defs.every((d) => d.status === 'shipped' || d.status === 'planned')).toBe(true);
    });

    it('what a pilot can change on the live site today is shipped, and nothing else (v0.2 plus main\'s walls switch and voxel grid)', () => {
        const shipped = SCHEMA.defs.filter((d) => d.status === 'shipped').map((d) => d.id);
        expect([...shipped].sort()).toEqual([...V02_SETTINGS, ...MAIN_SETTINGS].sort());
    });

    it('control: flipping a new setting to shipped before its translations exist is caught', () => {
        const flipped = SCHEMA.defs.map((d) => (d.id === 'respawn.auto' ? { ...d, status: 'shipped' as const } : d));
        expect(untranslatedNewShipped(flipped)).toContain('respawn.auto');
    });

    it('the ranges of A.8', () => {
        const range = (id: string) => {
            const d = SCHEMA.byId.get(id) as NumDef;
            return [d.min, d.max];
        };
        expect(range('physics.vCrash')).toEqual([2, 10]);
        expect(range('camera.fovDeg')).toEqual([70, 150]);
        expect(range('respawn.rewindS')).toEqual([1, 30]);
        expect(range('respawn.delayS')).toEqual([0.5, 10]);
        expect(range('level.angleLimitDeg')).toEqual([10, 85]);
        expect(range('physics.idlePct')).toEqual([0, 15]);
        expect(range('scene.dropFloaters')).toEqual([0, 64]);
        // main's: the test hook clamps the radius to 2-60 m, the opacity slider runs 5-100 %
        expect(range('voxels.radiusM')).toEqual([2, 60]);
        expect(range('voxels.opacity')).toEqual([0.05, 1]);
        expect(range('voxels.opacityOnly')).toEqual([0.05, 1]);
        expect(range('recording.splitMin')).toEqual([1, 30]);
    });

    it('only the voxel view lasts one page load; nothing else opts out of storage', () => {
        expect(SCHEMA.defs.filter((d) => d.persist === false).map((d) => d.id)).toEqual(['voxels.show']);
    });

    it('drone.current lists exactly the preset files in sim-core', () => {
        const files = readdirSync(join(REPO, 'packages', 'sim-core', 'presets')).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
        expect([...DRONE_IDS].sort()).toEqual(files.sort());
        expect(PRESETS.map((p) => p.id).sort()).toEqual(files.sort());
    });

    it('every preset default resolves inside its range on every drone (only fields W1-3 adds may be missing)', () => {
        const missing = new Set<string>();
        for (const d of SCHEMA.defs) {
            if (d.type !== 'number' || !isPresetRef(d.default)) continue;
            for (const p of PRESETS) {
                const f = p.fields[d.default.preset];
                if (typeof f?.value !== 'number') {
                    missing.add(d.default.preset);
                    continue;
                }
                const v = f.value * (d.default.scale ?? 1);
                expect(v, `${d.id} on ${p.id}`).toBeGreaterThanOrEqual(d.min as number);
                expect(v, `${d.id} on ${p.id}`).toBeLessThanOrEqual(d.max as number);
            }
        }
        expect([...missing].filter((f) => f !== 'rotor_drag_per_s')).toEqual([]);
    });

    it('key actions exist in the keymap: M, H, F3, V and [ ]', () => {
        const withKeys = SCHEMA.defs.filter((d) => actionsOf(d).length).map((d) => [d.id, actionsOf(d)]);
        expect(withKeys).toEqual([
            ['flight.mode', ['mode.cycle']],
            ['display.hud', ['hud.toggle']],
            ['display.frameStats', ['frameStats.toggle']],
            ['scene.transform', ['scale.down', 'scale.up']],
            ['voxels.show', ['voxels.cycle']]
        ]);
        for (const [, acts] of withKeys) for (const a of acts as string[]) expect(bindingOf(a)).toBeDefined();
    });

    it('legacy URL parameters: v0.2\'s ?g= ?gm= ?drone= ?governor=, main\'s ?guard= and its this-load switches ?walls= ?voxels= ?vstyle= ?vradius=', () => {
        expect(Object.fromEntries(SCHEMA.defs.filter((d) => d.url).map((d) => [d.url, d.id]))).toEqual({
            governor: 'display.governor', guard: 'display.latencyGuard', drone: 'drone.current', g: 'physics.gravity', gm: 'physics.gravityMode',
            walls: 'scene.walls', voxels: 'voxels.show', vstyle: 'voxels.style', vradius: 'voxels.radiusM'
        });
    });
});

describe('defineSettings: a per-scan default and a setting that is never stored', () => {
    const walls = SCHEMA.byId.get('scene.walls') as EnumDef;
    const show = SCHEMA.byId.get('voxels.show') as EnumDef;
    const withDef = (d: SettingDef) => SCHEMA.defs.map((x) => (x.id === d.id ? d : x));

    it('control: the real schema with both passes', () => {
        expect(() => defineSettings(SCHEMA.defs)).not.toThrow();
    });

    it('a curated default only on a scene setting, with a valid fallback and a plain field name', () => {
        expect(() => defineSettings(withDef({ ...walls, scope: 'global' }))).toThrow(/scene\.walls: a curated default needs scope 'scene'/);
        expect(() => defineSettings(withDef({ ...walls, default: { curated: 'walls', fallback: 'maybe' } }))).toThrow(/scene\.walls: default 'maybe' is not an option/);
        expect(() => defineSettings(withDef({ ...walls, default: { curated: 'walls.admin', fallback: 'on' } }))).toThrow(/curated field 'walls\.admin' is not a plain name/);
    });

    it('a setting that is never stored must be global, and persist is only ever false', () => {
        expect(() => defineSettings(withDef({ ...show, scope: 'scene' }))).toThrow(/voxels\.show: a setting that is not stored needs scope 'global'/);
        expect(() => defineSettings(withDef({ ...show, persist: true as unknown as false }))).toThrow(/voxels\.show: persist is false or absent/);
    });
});

describe('JSON validators', () => {
    it('rate bounds equal sim-core RATE_BOUNDS', () => {
        expect(RATE_BOUNDS).toEqual(SIM_RATE_BOUNDS);
    });

    it('pid: clamps into 0-250, refuses a missing F term or a string', () => {
        expect(validatePid({ roll: [260, -1, 40, 120], pitch: [1, 2, 3, 4], yaw: [1, 2, 0, 4] })).toEqual({ roll: [250, 0, 40, 120], pitch: [1, 2, 3, 4], yaw: [1, 2, 0, 4] });
        expect(validatePid({ roll: [1, 2, 3], pitch: [1, 2, 3, 4], yaw: [1, 2, 3, 4] })).toBeNull();
        expect(validatePid({ roll: ['1', 2, 3, 4], pitch: [1, 2, 3, 4], yaw: [1, 2, 3, 4] })).toBeNull();
    });

    it('rates: bounds per curve type; an unknown type is refused', () => {
        const r = validateRates({ type: 'KISS', roll: { rcRate: 300, rate: 150, expo: 50 }, pitch: { rcRate: 1, rate: 1, expo: 1 }, yaw: { rcRate: 1, rate: 1, expo: 1 }, rateLimit: 5000 });
        expect(r?.roll).toEqual({ rcRate: 255, rate: 99, expo: 50 });
        expect(r?.rateLimit).toBe(1998);
        expect(validateRates({ type: 'FOO', roll: {}, pitch: {}, yaw: {}, rateLimit: 1998 })).toBeNull();
    });

    it('throttle, transform and folder', () => {
        expect(validateThrottle({ mid: 65, expo: 120 })).toEqual({ mid: 65, expo: 100 });
        expect(validateTransform({ s: 9, t: [0.3, 0, -1.2], v: 2 })).toEqual({ s: 4, t: [0.3, 0, -1.2], v: 2 });
        expect(validateTransform({ s: 1.5, t: [0, 0] })).toBeNull();
        expect(validateTransform({ s: 1.5, t: [0, 0, 0] })).toEqual({ s: 1.5, t: [0, 0, 0], v: 0 });
        expect(validateFolder({ name: 'GSFPV' })).toEqual({ name: 'GSFPV' });
        expect(validateFolder({ name: '' })).toBeNull();
    });
});
