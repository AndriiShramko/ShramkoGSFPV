// Menu levels (docs/wip/menu-plan.md 1.5 and 3; the owner's three kinds of new pilot): which settings each kind of new
// pilot sees. Pinned counts and lists: a level moved by mistake fails here, and a shipped setting without a
// level fails defineSettings.
import { describe, expect, it } from 'vitest';
import { LEVEL_TABLE, MENU_LEVELS, SCHEMA, defineSettings, levelShows, withLevels } from '../src';
import type { MenuLevel, SettingDef } from '../src';

const shippedAt = (level: MenuLevel): string[] =>
    SCHEMA.defs.filter((d) => d.status === 'shipped' && d.level !== undefined && levelShows(level, d.level)).map((d) => d.id).sort();

/** the plan's table 1.5, level first: what a pilot who never flew sees */
const FIRST = ['ui.menuLevel', 'crash.enabled', 'display.reducedMotion', 'drone.current', 'input.altitudeHelp', 'input.gameSpeed', 'input.howToFly', 'input.mouseSensitivity', 'input.play', 'sound.volume', 'ui.language'];
/** the plan's table 1.5, level sim on top of first */
const SIM = ['course.lapSplash', 'battery.refill', 'camera.fovDeg', 'camera.uptiltDeg', 'crosshair.shape', 'display.hud', 'flight.mode', 'input.haptics', 'input.mouseInvertY', 'input.stickMode', 'input.throttleStyle', 'recording.auto', 'recording.resolution', 'respawn.auto', 'respawn.keepArmed', 'respawn.target', 'scene.ceiling', 'scene.walls', 'scenes.autoSwitch', 'sound.motors', 'tune.rates', 'tune.throttle', 'wind.mode', 'wind.speed'];

describe('menu levels of the settings', () => {
    it('every def has a level; the shipped settings split 11 / 35 / 79 by level', () => {
        expect(SCHEMA.defs.filter((d) => d.level === undefined).map((d) => d.id)).toEqual([]);
        expect(shippedAt('first')).toEqual([...FIRST].sort());
        expect(shippedAt('sim')).toEqual([...FIRST, ...SIM].sort());
        expect(shippedAt('first')).toHaveLength(11);
        expect(shippedAt('sim')).toHaveLength(35);
        expect(shippedAt('expert')).toHaveLength(79);
        expect(shippedAt('expert')).toEqual(SCHEMA.defs.filter((d) => d.status === 'shipped').map((d) => d.id).sort());
    });

    it('the menu level setting itself is at level first, so every pilot can change it; its default is the full menu of today', () => {
        expect(SCHEMA.byId.get('ui.menuLevel')?.level).toBe('first');
        expect(SCHEMA.byId.get('ui.menuLevel')).toMatchObject({ type: 'enum', options: [...MENU_LEVELS], default: 'expert', scope: 'global', status: 'shipped' });
    });

    it('a level shows its own items and those of the levels before it', () => {
        expect(levelShows('first', 'first')).toBe(true);
        expect(levelShows('first', 'sim')).toBe(false);
        expect(levelShows('sim', 'first')).toBe(true);
        expect(levelShows('sim', 'expert')).toBe(false);
        expect(levelShows('expert', 'sim')).toBe(true);
    });

    it('every advanced setting is at level expert', () => {
        expect(SCHEMA.defs.filter((d) => d.advanced && d.level !== 'expert').map((d) => d.id)).toEqual([]);
    });

    const plain = (over: Partial<SettingDef>): SettingDef => ({ id: 'menu.probe', group: 'display', scope: 'global', type: 'bool', default: false, apply: 'live', shown: ['settings'], status: 'shipped', since: 2, ...over }) as SettingDef;

    it('control: a shipped setting without a level is refused', () => {
        expect(() => defineSettings([plain({})])).toThrow(/needs a menu level/);
        expect(() => defineSettings([plain({ level: 'first' })])).not.toThrow();
        expect(() => defineSettings([plain({ status: 'planned' })])).not.toThrow();
    });

    it('control: an advanced setting below expert and an unknown level are refused', () => {
        expect(() => defineSettings([plain({ advanced: true, level: 'sim' })])).toThrow(/advanced/);
        expect(() => defineSettings([plain({ level: 'pro' as MenuLevel })])).toThrow(/unknown menu level/);
    });

    it('control: a level table row naming no setting is refused, a moved level changes the counts', () => {
        expect(() => withLevels([plain({})], { 'menu.typo': 'first' })).toThrow(/menu.typo/);
        const moved = withLevels(SCHEMA.defs, { ...LEVEL_TABLE, 'camera.uptiltDeg': 'first' });
        expect(moved.filter((d) => d.status === 'shipped' && d.level === 'first')).toHaveLength(12);
    });
});
