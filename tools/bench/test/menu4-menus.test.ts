// Lane menu4 stage S2: the pause menu and Settings show the pilot's menu level (docs/wip/menu-plan.md 2.2, 2.3).
// - pause menu: the items above the level go under "More" (still passed to the page, never dropped); the key of
//   a hidden item runs it while the menu is up; "Always show everything" sets the level to expert and redraws;
//   every row of PAUSE_LEVELS names an item that exists (a renamed item would fall to expert unseen);
// - Settings: rowShow keeps a level's rows, finds every row by search ("In the full menu"), keeps a changed value
//   above the level in sight ("Changed"), and "Show all settings" shows every row.
// Negative control: on origin/main there is no level anywhere (menu-levels.ts, rowShow absent): the file fails.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KEYMAP } from '../../../packages/prefs/src/keymap';
import { SCHEMA } from '../../../packages/prefs/src';
import type { MenuLevel, SettingDef } from '../../../packages/prefs/src';
import { KeyRouter } from '../../../apps/fly/src/app/keys';
import { PAUSE_LEVELS, inMore, pauseLevel } from '../../../apps/fly/src/app/menu-levels';
import { rowShow, shownDefs } from '../../../apps/fly/src/ui/settings/model';

const SRC = join(__dirname, '../../../apps/fly/src');
function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((f) => {
        const p = join(dir, f);
        return statSync(p).isDirectory() ? sources(p) : p.endsWith('.ts') ? [p] : [];
    });
}
/** Every pause-menu item id the app adds today (`id: 'pause.x'` in its source). */
const ITEM_IDS = [...new Set(sources(SRC).flatMap((p) => [...readFileSync(p, 'utf8').matchAll(/id: '(pause\.[A-Za-z.]+)'/g)].map((m) => m[1])))].sort();

describe('pause menu levels', () => {
    it('every row of PAUSE_LEVELS names an item of the app; an item without a row is expert', () => {
        expect(ITEM_IDS.length).toBeGreaterThanOrEqual(27);
        expect(Object.keys(PAUSE_LEVELS).filter((id) => !ITEM_IDS.includes(id))).toEqual([]);
        expect(pauseLevel('pause.record')).toBe('expert');
        expect(pauseLevel('pause.added.later')).toBe('expert');
        // the way in for blind pilots and the first steps stay at every level
        for (const id of ['pause.continue', 'pause.restart', 'pause.settings', 'pause.howtofly', 'pause.radio', 'pause.flyBySound']) expect(inMore(id, 'first')).toBe(false);
        const shown = (l: MenuLevel): number => ITEM_IDS.filter((id) => !inMore(id, l)).length;
        expect([shown('first'), shown('sim'), shown('expert')]).toEqual([9, 19, ITEM_IDS.length]);
    });

    const doc = { cookie: '', documentElement: { lang: '' }, visibilityState: 'visible', querySelector: () => null };
    afterEach(() => {
        vi.doUnmock('../../../apps/fly/src/ui/pause');
        vi.unstubAllGlobals();
    });

    it('at level first the menu gets every item, the hidden ones marked "more"; F9 records with the menu up; "Always show everything" redraws at expert', async () => {
        vi.resetModules();
        const draws: { ids: string[]; more: string[]; showAll?: () => void; focus?: string | null }[] = [];
        vi.doMock('../../../apps/fly/src/ui/pause', () => ({
            pauseMenu: (_ui: unknown, entries: { id: string; more?: boolean }[], _pick: unknown, _close: unknown, _s: unknown, _r: unknown, opts: { showAll?: () => void; focus?: string | null } = {}) => {
                draws.push({ ids: entries.map((e) => e.id), more: entries.filter((e) => e.more).map((e) => e.id), showAll: opts.showAll, focus: opts.focus });
                return () => undefined;
            }
        }));
        vi.stubGlobal('location', { search: '', pathname: '/fly/', href: 'http://127.0.0.1/fly/', origin: 'http://127.0.0.1' });
        vi.stubGlobal('document', doc);
        const { PauseMenu } = await import('../../../apps/fly/src/app/menu');
        let level: MenuLevel = 'first';
        const keys = new KeyRouter({ map: KEYMAP, isText: () => false });
        const menu = new PauseMenu({} as HTMLElement, keys, { pause: () => undefined, resume: () => undefined }, { level: () => level, showAll: () => { level = 'expert'; } });
        const runs: string[] = [];
        let order = 0;
        for (const id of ['pause.continue', 'pause.settings', 'pause.share', 'pause.record']) {
            menu.add({ id, action: id === 'pause.record' ? 'record.toggle' : null, labelKey: id, order: ++order, section: 'tools', run: () => runs.push(id) });
        }
        menu.open();
        expect(draws[0].ids).toEqual(['pause.continue', 'pause.settings', 'pause.share', 'pause.record']);
        expect(draws[0].more).toEqual(['pause.share', 'pause.record']);
        // the key of a hidden item still runs it
        const F9 = { type: 'keydown', code: 'F9', key: 'F9', shiftKey: false, repeat: false, ctrlKey: false, altKey: false, metaKey: false, target: null, preventDefault: () => undefined } as unknown as KeyboardEvent;
        keys.route(F9);
        expect(runs).toEqual(['pause.record']);
        expect(menu.isOpen).toBe(false);
        // "Always show everything": the level becomes expert, the menu is drawn again, the first item that was hidden takes the focus
        menu.open();
        draws[1].showAll?.();
        expect(level).toBe('expert');
        expect(menu.isOpen).toBe(true);
        expect(draws[2].more).toEqual([]);
        expect(draws[2].focus).toBe('pause.share');
    });
});

describe('Settings rows by level', () => {
    const defs = shownDefs(SCHEMA);
    const show = (d: SettingDef, level: MenuLevel, o: Partial<{ all: boolean; searching: boolean; hit: boolean; explicit: boolean }> = {}) =>
        rowShow(d, level, { all: false, searching: false, hit: true, explicit: false, ...o });
    const count = (level: MenuLevel, o: Parameters<typeof show>[2] = {}): number => defs.filter((d) => show(d, level, o).shown).length;
    const uptilt = SCHEMA.byId.get('camera.uptiltDeg') as SettingDef;

    it('three different lists, every row at expert; "Show all settings" shows every row', () => {
        const [first, sim, expert] = [count('first'), count('sim'), count('expert')];
        expect(first).toBeGreaterThan(5);
        expect(first).toBeLessThan(sim);
        expect(sim).toBeLessThan(expert);
        expect(expert).toBe(defs.length);
        expect(count('first', { all: true })).toBe(defs.length);
    });

    it('a search finds a row above the level and marks it "In the full menu"; a miss stays hidden', () => {
        expect(show(uptilt, 'first')).toEqual({ shown: false, mark: null });
        expect(show(uptilt, 'first', { searching: true, hit: true })).toEqual({ shown: true, mark: 'inFull' });
        expect(show(uptilt, 'sim', { searching: true, hit: true })).toEqual({ shown: true, mark: null });
        expect(show(uptilt, 'first', { searching: true, hit: false }).shown).toBe(false);
    });

    it('a changed value above the level stays in sight, marked "Changed"', () => {
        expect(show(uptilt, 'first', { explicit: true })).toEqual({ shown: true, mark: 'changed' });
        expect(show(uptilt, 'first', { explicit: true, all: true })).toEqual({ shown: true, mark: null });
    });
});
