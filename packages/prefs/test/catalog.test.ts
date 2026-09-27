import { describe, expect, it } from 'vitest';
import { DEFAULT_DRONE_FIELDS, KEYMAP, SCHEMA, buildCatalogue, helpKey, keysFor, labelKey } from '../src';
import type { Dict, KeyBinding } from '../src';
import { PRESETS } from './helpers';

const LANGS = ['en', 'es', 'pl', 'ru'];

/** A complete dictionary for every setting (shipped or not) and key, tagged per language. */
function dicts(): Record<string, Record<string, string>> {
    const out: Record<string, Record<string, string>> = {};
    for (const l of LANGS) {
        const d: Record<string, string> = { 'prefs.on': `on-${l}`, 'prefs.off': `off-${l}`, 'prefs.fromPreset': `preset-${l}` };
        for (const def of SCHEMA.defs) {
            d[labelKey(def)] = `${def.id}-${l}`;
            d[helpKey(def)] = `help ${def.id}-${l}`;
            if (def.type === 'enum') for (const o of def.options) d[`set.${def.id}.opt.${o}`] = `${o}-${l}`;
        }
        for (const g of SCHEMA.groups) d[`group.${g}`] = `${g}-${l}`;
        for (const b of KEYMAP) d[b.labelKey] = `${b.action}-${l}`;
        for (const f of DEFAULT_DRONE_FIELDS) d[f.label] = `${f.label}-${l}`;
        out[l] = d;
    }
    return out;
}

const build = (d: Record<string, Dict> = dicts(), keymap: readonly KeyBinding[] = KEYMAP) => buildCatalogue(SCHEMA, keymap, d, PRESETS, { generated: '2026-10-05' });

describe('buildCatalogue (I.6)', () => {
    it('every shipped def appears exactly once, and planned defs never do', () => {
        const c = build();
        const ids = c.locales.en.groups.flatMap((g) => g.settings.map((s) => s.id));
        const shipped = SCHEMA.defs.filter((d) => d.status === 'shipped').map((d) => d.id);
        expect([...ids].sort()).toEqual([...shipped].sort());
        expect(new Set(ids).size).toBe(ids.length);
        for (const d of SCHEMA.defs.filter((x) => x.status === 'planned')) expect(ids).not.toContain(d.id);
        expect(c.counts.settings).toBe(shipped.length);
    });

    it('control: a shipped def without a translation throws, naming the language and the key', () => {
        const d = dicts();
        delete d.pl['set.physics.vCrash.help'];
        expect(() => build(d)).toThrow(/pl: set\.physics\.vCrash\.help/);
        const e = dicts();
        delete e.ru['set.display.reducedMotion.opt.system'];
        expect(() => build(e)).toThrow(/ru: set\.display\.reducedMotion\.opt\.system/);
    });

    it('a planned def needs no translation yet', () => {
        const d = dicts();
        for (const l of LANGS) for (const k of Object.keys(d[l])) if (k.startsWith('set.voxels.')) delete d[l][k];
        expect(() => build(d)).not.toThrow();
    });

    it('rows carry label, help, default and range in each language, and keys only when shipped', () => {
        const c = build();
        const row = (l: string, id: string) => c.locales[l].groups.flatMap((g) => g.settings).find((s) => s.id === id)!;
        expect(row('en', 'physics.vCrash')).toMatchObject({ label: 'physics.vCrash-en', help: 'help physics.vCrash-en', type: 'number', default: '4 m/s (preset-en)', range: '2–10 m/s', scope: 'drone', apply: 'life', keys: [] });
        expect(row('pl', 'display.reducedMotion')).toMatchObject({ default: 'system-pl', range: 'system-pl / on-pl / off-pl' });
        // a setting shows its key only once that binding ships (H is planned until its feature lands)
        expect(row('en', 'display.hud')).toMatchObject({ default: 'on-en', keys: keysFor('hud.toggle').map((k) => k.cap) });
        expect(row('en', 'display.frameStats')).toMatchObject({ default: 'off-en', keys: ['F3'] });
        expect(row('en', 'tune.pid')).toMatchObject({ type: 'json', default: 'preset-en' });
    });

    it('lists shipped keys only; a key shows up once its binding ships', () => {
        const c = build();
        const shipped = KEYMAP.filter((b) => b.status === 'shipped');
        expect(c.locales.en.keys.map((k) => k.action)).toEqual(shipped.map((b) => b.action));
        expect(c.locales.en.keys.find((k) => k.action === 'pause.toggle')!.keys).toEqual(['Esc', 'P']);
        expect(c.counts.keys).toBe(shipped.reduce((n, b) => n + b.keys.length, 0));
        const hShips = KEYMAP.map((b) => (b.action === 'hud.toggle' ? { ...b, status: 'shipped' as const } : b));
        const c2 = build(dicts(), hShips);
        expect(c2.locales.en.groups.flatMap((g) => g.settings).find((s) => s.id === 'display.hud')!.keys).toEqual(['H']);
    });

    it('groups in rail order with only shipped settings; drones with each field\'s source; counts', () => {
        const c = build();
        // derived, so a wave-2 status flip does not need this file: groups with a shipped setting, in rail order
        const withShipped = SCHEMA.groups.filter((g) => SCHEMA.defs.some((d) => d.group === g && d.status === 'shipped'));
        expect(c.locales.ru.groups.map((g) => g.id)).toEqual(withShipped);
        expect(c.locales.ru.groups[0].title).toBe(`${withShipped[0]}-ru`);
        const pro = c.locales.en.drones.find((d) => d.id === 'pavo20pro-3s')!;
        expect(pro.fields.map((f) => f.label)).toEqual(['drone.twr-en', 'drone.weight-en', 'drone.wheelbase-en', 'drone.motor-en', 'drone.battery-en']);
        expect(pro.fields[1].source).toBe(PRESETS.find((p) => p.id === 'pavo20pro-3s')!.fields.auw_g.source);
        expect(c.counts).toMatchObject({ groups: withShipped.length, drones: 6, rateTypes: 4 });
        expect(c.counts.modes).toBe(SCHEMA.byId.get('flight.mode')!.status === 'shipped' ? 3 : 2);
        expect(c.generated).toBe('2026-10-05');
        expect(c.schemaVersion).toBe(1);
    });
});
