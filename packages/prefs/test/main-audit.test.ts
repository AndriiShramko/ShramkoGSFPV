// prefs against what main ships today (the voxel grid, the walls switch, the latency guard, the
// walls cache), read from main's own sources: prefs imports neither render-pc nor the app, so a
// change there must fail here instead of drifting. Every reader throws when it cannot find what
// it looks for, so a refactor of the app fails loudly rather than comparing nothing.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { APP_URL_PARAMS_NOT_SETTINGS, IDB_NAME, IDB_STORES, MAIN_VOXEL_DEFAULTS, MemoryBackend, SCHEMA, VOXEL_STYLES, VOXEL_VIEWS, WALLS_OPTIONS, settingsFromQuery } from '../src';
import type { EnumDef, NumDef, PrefsStore } from '../src';
import { initialWallsOn } from '../../../apps/fly/src/flightwalls';
import { REPO, mkStore } from './helpers';

const read = (...p: string[]) => readFileSync(join(REPO, ...p), 'utf8');
const VOXEL_COLORS = read('packages', 'render-pc', 'src', 'voxel-colors.ts');
const APP_VOXELS = read('apps', 'fly', 'src', 'voxels.ts');
const APP_MAIN = read('apps', 'fly', 'src', 'main.ts');
const APP_WALLCACHE = read('apps', 'fly', 'src', 'wallcache.ts');

/** One regex group from a source, or a throw naming what was looked for. */
function grab(src: string, re: RegExp, what: string): string {
    const m = src.match(re);
    if (!m) throw new Error(`not found in the source: ${what}`);
    return m[1];
}
/** The quoted strings of a list such as `['a', 'b']` or a union `'a' | 'b'`. */
const quoted = (s: string): string[] => [...s.matchAll(/'([^']*)'/g)].map((m) => m[1]);

const stylesOf = (src: string) => quoted(grab(src, /export const VOXEL_STYLES\b[^=]*=\s*\[([^\]]*)\]/, 'VOXEL_STYLES'));
const styleTypeOf = (src: string) => quoted(grab(src, /export type VoxelStyle\s*=\s*([^;]*);/, 'type VoxelStyle'));

describe('the voxel grid: prefs equals main', () => {
    it('styles: render-pc VOXEL_STYLES and its VoxelStyle type, in order; the default is main\'s', () => {
        expect([...VOXEL_STYLES]).toEqual(stylesOf(VOXEL_COLORS));
        expect([...VOXEL_STYLES].sort()).toEqual(styleTypeOf(VOXEL_COLORS).sort());
        expect((SCHEMA.byId.get('voxels.style') as EnumDef).options).toEqual(VOXEL_STYLES);
        expect(SCHEMA.byId.get('voxels.style')!.default).toBe(grab(APP_VOXELS, /DEFAULT_PREFS[^=]*=\s*\{[^}]*style:\s*'([^']+)'/, 'DEFAULT_PREFS.style'));
    });

    it('control: a style added to render-pc, or the list gone, is caught', () => {
        expect(stylesOf(VOXEL_COLORS.replace("'floaters']", "'floaters', 'grid']"))).not.toEqual([...VOXEL_STYLES]);
        expect(() => stylesOf(VOXEL_COLORS.replace('VOXEL_STYLES', 'STYLES'))).toThrow(/not found in the source: VOXEL_STYLES/);
    });

    it('views: main\'s VOXEL_MODES, in the order V cycles them', () => {
        const modes = quoted(grab(APP_VOXELS, /export const VOXEL_MODES\b[^=]*=\s*\[([^\]]*)\]/, 'VOXEL_MODES'));
        expect([...VOXEL_VIEWS]).toEqual(modes);
        expect((SCHEMA.byId.get('voxels.show') as EnumDef).options).toEqual(modes);
        expect(SCHEMA.byId.get('voxels.show')!.default).toBe(grab(APP_VOXELS, /mode: VoxelMode = '([^']+)'/, 'VoxelController.mode'));
    });

    it('opacities: main\'s defaults and its 0.05-1 clamp; the migration\'s "untouched" values are main\'s defaults', () => {
        const dp = grab(APP_VOXELS, /DEFAULT_PREFS[^=]*=\s*(\{[^}]*\})/, 'DEFAULT_PREFS');
        const num = (field: string) => Number(grab(dp, new RegExp(`${field}:\\s*([0-9.]+)`), `DEFAULT_PREFS.${field}`));
        expect(SCHEMA.byId.get('voxels.opacity')!.default).toBe(num('opacityOverlay'));
        expect(SCHEMA.byId.get('voxels.opacityOnly')!.default).toBe(num('opacityOnly'));
        expect(MAIN_VOXEL_DEFAULTS).toEqual({ style: grab(dp, /style:\s*'([^']+)'/, 'style'), opacityOverlay: num('opacityOverlay'), opacityOnly: num('opacityOnly') });
        const [lo, hi] = grab(APP_VOXELS, /setOpacity\(a: number\): void \{\s*const v = (Math\.max\([^;]*\));/, 'setOpacity clamp').match(/\d+(?:\.\d+)?/g)!.map(Number);
        for (const id of ['voxels.opacity', 'voxels.opacityOnly']) expect([(SCHEMA.byId.get(id) as NumDef).min, (SCHEMA.byId.get(id) as NumDef).max]).toEqual([lo, hi]);
    });

    it('radius: main\'s 20 m, and the 2-60 m of its test hook', () => {
        const d = SCHEMA.byId.get('voxels.radiusM') as NumDef;
        expect(d.default).toBe(Number(grab(APP_VOXELS, /\n\s*radiusM = ([0-9.]+);/, 'VoxelController.radiusM')));
        const clamp = grab(APP_MAIN, /setRadius: \(m\) => \{ voxels\.radiusM = (Math\.max\([^;]*\));/, 'hook setRadius').match(/\d+(?:\.\d+)?/g)!.map(Number);
        expect([d.min, d.max]).toEqual(clamp);
        expect(d.status).toBe('planned'); // no control on the live site: the test hook and ?vradius only
    });
});

describe('the walls switch: prefs equals main (flightwalls.ts initialWallsOn)', () => {
    const SCENE = '39e63ce9';
    type Admin = 'on' | 'off' | undefined;
    type Stored = 'on' | 'off' | null;
    /** prefs' answer: the admin's value as the resolver's curated field, the pilot's entry, ?walls= as the session layer */
    function prefsWalls(admin: Admin, stored: Stored, forced: string | null): string {
        const s: PrefsStore = mkStore(new MemoryBackend(), {}, SCHEMA, {}, admin === undefined ? {} : { [SCENE]: { walls: admin } });
        if (stored !== null) s.set('scene.walls', stored, { scene: SCENE });
        if (forced !== null) for (const v of settingsFromQuery(SCHEMA, `?walls=${forced}`).values) s.setSession(v.id, v.value);
        return s.get<string>('scene.walls', { scene: SCENE });
    }
    const CASES: [Admin, Stored, string | null][] = [];
    for (const a of ['on', 'off', undefined] as Admin[]) for (const st of ['on', 'off', null] as Stored[]) for (const f of [null, 'on', 'off', 'junk']) CASES.push([a, st, f]);
    const mismatches = (app: (a: Admin, s: Stored, f: string | null) => boolean) => CASES.filter(([a, st, f]) => prefsWalls(a, st, f) !== (app(a, st, f) ? 'on' : 'off'));

    it('the same answer in all 36 cases of admin default, pilot\'s choice and ?walls=', () => {
        expect(mismatches(initialWallsOn)).toEqual([]);
    });

    it('control: an app that let the admin override the pilot would differ, so the comparison can fail', () => {
        expect(mismatches((a, st, f) => initialWallsOn(st ?? undefined, a ?? null, f)).length).toBeGreaterThan(0);
    });

    it('showcase.json: every admin value is an option, and the field is documented there', () => {
        const sc = JSON.parse(read('apps', 'fly', 'public', 'showcase.json')) as { fields: Record<string, string>; scenes: { id: string; walls?: string }[] };
        expect(sc.fields.walls).toMatch(/"on" or "off"/);
        for (const s of sc.scenes) if (s.walls !== undefined) expect(WALLS_OPTIONS, s.id).toContain(s.walls);
    });
});

describe('every URL parameter main reads is a setting\'s or listed with its reason', () => {
    const paramsIn = (src: string) => new Set([...src.matchAll(/\bq\.get\(\s*'([^']+)'\s*\)/g)].map((m) => m[1]));
    const settingParams = new Set(SCHEMA.defs.flatMap((d) => (d.url ? [d.url] : [])));

    it('main.ts: each ?param= is a def\'s url or in APP_URL_PARAMS_NOT_SETTINGS, never both, and the list has nothing main does not read', () => {
        const inMain = paramsIn(APP_MAIN);
        expect(inMain.size).toBeGreaterThan(20);
        const unclassified = [...inMain].filter((p) => !settingParams.has(p) && !Object.hasOwn(APP_URL_PARAMS_NOT_SETTINGS, p));
        expect(unclassified).toEqual([]);
        expect([...settingParams].filter((p) => Object.hasOwn(APP_URL_PARAMS_NOT_SETTINGS, p))).toEqual([]);
        expect(Object.keys(APP_URL_PARAMS_NOT_SETTINGS).filter((p) => !inMain.has(p))).toEqual([]);
        // v0.2's drone and gravity parameters stay settings, not test switches
        for (const p of ['g', 'gm', 'drone', 'governor', 'guard', 'walls', 'voxels', 'vstyle', 'vradius']) expect(inMain.has(p), p).toBe(true);
    });

    it('control: a new parameter planted in main.ts is unclassified', () => {
        const planted = paramsIn(`${APP_MAIN}\nconst x = q.get('newswitch');`);
        expect([...planted].filter((p) => !settingParams.has(p) && !Object.hasOwn(APP_URL_PARAMS_NOT_SETTINGS, p))).toEqual(['newswitch']);
    });

    it('main.ts is the only fly source that reads the query string', () => {
        const readers: string[] = [];
        const walk = (dir: string) => {
            for (const n of readdirSync(dir)) {
                const p = join(dir, n);
                if (statSync(p).isDirectory()) walk(p);
                else if (/\.ts$/.test(n) && /location\.search\b|URLSearchParams\(\s*location/.test(readFileSync(p, 'utf8'))) readers.push(n);
            }
        };
        walk(join(REPO, 'apps', 'fly', 'src'));
        expect(readers).toEqual(['main.ts']);
    });

    it('the latency guard is on unless ?guard=0, as main starts it', () => {
        expect(APP_MAIN).toContain("startLatencyGuard(q.get('guard') !== '0')");
        expect(SCHEMA.byId.get('display.latencyGuard')!.default).toBe(true);
        expect(settingsFromQuery(SCHEMA, '?guard=0').values).toEqual([{ id: 'display.latencyGuard', value: false, param: 'guard' }]);
    });
});

describe('IndexedDB: prefs and main\'s walls cache share one database', () => {
    const storesOf = (src: string) => quoted(grab(src, /const IDB_STORES = \[([^\]]*)\]/, 'IDB_STORES'));

    it('same name, same three stores (whichever opens it first creates all of them)', () => {
        expect(grab(APP_WALLCACHE, /const IDB_NAME = '([^']+)'/, 'IDB_NAME')).toBe(IDB_NAME);
        expect(storesOf(APP_WALLCACHE)).toEqual([...IDB_STORES]);
    });

    it('control: a store renamed in the walls cache is caught', () => {
        expect(storesOf(APP_WALLCACHE.replace("'logs'", "'flightlogs'"))).not.toEqual([...IDB_STORES]);
    });
});
