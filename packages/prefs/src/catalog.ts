// The settings catalogue (I.1, I.2): every shipped setting, every shipped key and every drone, in
// each language, as plain data. scripts/gen-catalog.ts turns it into the site's features.json,
// docs/settings.md and the README block. Planned settings and keys never appear: the site must
// not promise what the simulator does not do yet. A shipped entry without its text in any
// language throws, so an untranslated row cannot reach the site.

import { actionsOf, helpKey, isCuratedRef, isPresetRef, labelKey, literalDefault, presetValue } from './schema';
import type { Apply, GroupId, Schema, Scope, SettingDef, Unit } from './schema';
import type { ActionId, KeyBinding } from './keymap';
import { RATE_TYPES } from './defs/tune';

export type Dict = Readonly<Record<string, string>>;

export interface CatalogueSetting { id: string; label: string; help: string; type: SettingDef['type']; default: string; range: string; scope: Scope; apply: Apply; keys: string[]; advanced: boolean }
export interface CatalogueGroup { id: GroupId; title: string; settings: CatalogueSetting[] }
export interface CatalogueKey { action: ActionId; label: string; keys: string[] }
export interface CatalogueDrone { id: string; name: string; fields: { label: string; value: string; source: string }[] }
export interface CatalogueLocale { groups: CatalogueGroup[]; keys: CatalogueKey[]; drones: CatalogueDrone[] }
export interface Catalogue {
    generated: string;
    schemaVersion: number;
    counts: { settings: number; groups: number; drones: number; modes: number; keys: number; rateTypes: number };
    locales: Record<string, CatalogueLocale>;
}

/** The part of a sim-core PresetJson the catalogue reads (prefs does not depend on sim-core). */
export interface CataloguePreset { id: string; name: string; fields: Readonly<Record<string, { value: unknown; source: string }>> }

/** Drone card rows, as the drone picker shows them (apps/fly ui/drone.ts). */
export interface DroneFieldSpec { key: string; label: string; suffix?: string; prefix?: string }
export const DEFAULT_DRONE_FIELDS: readonly DroneFieldSpec[] = [
    { key: 'twr', label: 'drone.twr', suffix: ':1' },
    { key: 'auw_g', label: 'drone.weight', suffix: ' g' },
    { key: 'wheelbase_mm', label: 'drone.wheelbase', suffix: ' mm' },
    { key: 'motor', label: 'drone.motor' },
    { key: 'battery', label: 'drone.battery' }
];

/** Language-neutral unit symbols; a dictionary may override one with `prefs.unit.<unit>`. */
const UNIT_SYMBOL: Readonly<Record<Unit, string>> = {
    deg: '°', ms: ' ms', s: ' s', m: ' m', mps: ' m/s', mps2: ' m/s²', x: '×', pct: ' %', per_s: ' 1/s', blocks: ' blocks', min: ' min'
};

export interface CatalogueOptions {
    /** date stamp; the generator passes today's date, tests a fixed one */
    generated?: string;
    /** the drone whose preset values stand for a per-drone default (default: drone.current's default) */
    defaultDrone?: string;
    droneFields?: readonly DroneFieldSpec[];
    modes?: number;
    rateTypes?: number;
}

/**
 * Key-caps that are words, and the simulator's dictionary key for the word: its own key card writes
 * Space in the pilot's language (t('arm.keys.space'), apps/fly ui/hud.ts), so the catalogue does
 * too, in the shortcut list and in every row (review C14). Letters, symbols, F-keys, Esc, Enter and
 * Shift are printed on the keys themselves and stay as they are.
 */
export const CAP_WORDS: Readonly<Record<string, string>> = { Space: 'arm.keys.space' };

/** A key-cap as a language writes it; the cap itself when the dictionary has no word for it. */
export function capText(cap: string, dict: Dict): string {
    const k = CAP_WORDS[cap];
    const s = k === undefined ? undefined : dict[k];
    return typeof s === 'string' && s.trim() ? s : cap;
}

function num(v: number): string {
    return String(Math.round(v * 1000) / 1000);
}

/**
 * Builds the catalogue. dicts: one flat dictionary per locale (the fly dictionary merged with its
 * namespaces). Throws listing every missing text: a shipped setting's label, help, group title,
 * option labels, on/off, a preset-default or per-scan-default note, and each shipped key's label.
 */
export function buildCatalogue(schema: Schema, keymap: readonly KeyBinding[], dicts: Readonly<Record<string, Dict>>, presets: readonly CataloguePreset[], o: CatalogueOptions = {}): Catalogue {
    const shipped = schema.defs.filter((d) => d.status === 'shipped');
    const keys = keymap.filter((b) => b.status === 'shipped');
    const droneDef = schema.byId.get('drone.current');
    const defaultDrone = o.defaultDrone ?? (droneDef && typeof droneDef.default === 'string' ? droneDef.default : presets[0]?.id);
    const resolver = { field: (id: string, key: string) => {
        const f = presets.find((p) => p.id === id)?.fields[key];
        return typeof f?.value === 'number' ? f.value : undefined;
    } };
    const fields = o.droneFields ?? DEFAULT_DRONE_FIELDS;
    const missing: string[] = [];
    const locales: Record<string, CatalogueLocale> = {};

    for (const [lang, dict] of Object.entries(dicts)) {
        const tr = (k: string): string => {
            const s = dict[k];
            if (typeof s !== 'string' || !s.trim()) {
                missing.push(`${lang}: ${k}`);
                return k;
            }
            return s;
        };
        const unit = (u: Unit | undefined) => (u === undefined ? '' : (dict[`prefs.unit.${u}`] ?? UNIT_SYMBOL[u]));
        const setting = (d: SettingDef): CatalogueSetting => {
            let def = '', range = '';
            const lit = literalDefault(d);
            switch (d.type) {
                case 'bool':
                    def = tr(lit ? 'prefs.on' : 'prefs.off');
                    break;
                case 'number': {
                    const u = unit(d.unit);
                    if (isPresetRef(d.default)) {
                        const v = presetValue(d.default, resolver, defaultDrone) ?? d.default.fallback ?? 0;
                        def = `${num(v)}${u} (${tr('prefs.fromPreset')})`;
                    } else def = `${num(lit as number)}${u}`;
                    const lo = presetValue(d.min, resolver, defaultDrone), hi = presetValue(d.max, resolver, defaultDrone);
                    range = lo !== undefined && hi !== undefined ? `${num(lo)}–${num(hi)}${u}` : '';
                    break;
                }
                case 'enum':
                    def = tr(`set.${d.id}.opt.${String(lit)}`);
                    range = d.options.map((x) => tr(`set.${d.id}.opt.${x}`)).join(' / ');
                    break;
                case 'json':
                    def = d.default === null ? tr('prefs.fromPreset') : '';
                    break;
            }
            // a per-scan default of the admin (showcase.json): the fallback, and a note that scans differ
            if (isCuratedRef(d.default)) def = `${def} (${tr('prefs.fromCurated')})`;
            const caps = actionsOf(d).flatMap((a) => keys.find((b) => b.action === a)?.keys.map((k) => capText(k.cap, dict)) ?? []);
            return { id: d.id, label: tr(labelKey(d)), help: tr(helpKey(d)), type: d.type, default: def, range, scope: d.scope, apply: d.apply, keys: caps, advanced: !!d.advanced };
        };
        const groups: CatalogueGroup[] = [];
        for (const g of schema.groups) {
            const inGroup = shipped.filter((d) => d.group === g);
            if (inGroup.length) groups.push({ id: g, title: tr(`group.${g}`), settings: inGroup.map(setting) });
        }
        locales[lang] = {
            groups,
            keys: keys.map((b) => ({ action: b.action, label: tr(b.labelKey), keys: b.keys.map((k) => capText(k.cap, dict)) })),
            drones: presets.map((p) => ({
                id: p.id,
                name: p.name,
                fields: fields.filter((f) => p.fields[f.key] !== undefined).map((f) => {
                    const pf = p.fields[f.key];
                    return { label: tr(f.label), value: `${f.prefix ?? ''}${String(pf.value)}${f.suffix ?? ''}`, source: pf.source };
                })
            }))
        };
    }
    if (missing.length) throw new Error(`catalogue: ${missing.length} missing translation(s): ${missing.join(', ')}`);

    const mode = schema.byId.get('flight.mode');
    return {
        generated: o.generated ?? new Date().toISOString().slice(0, 10),
        schemaVersion: schema.version,
        counts: {
            settings: shipped.length,
            groups: new Set(shipped.map((d) => d.group)).size,
            drones: presets.length,
            // until flight.mode ships, v0.2's two: acro, and angle on keyboard M
            modes: o.modes ?? (mode?.type === 'enum' && mode.status === 'shipped' ? mode.options.length : 2),
            keys: keys.reduce((n, b) => n + b.keys.length, 0),
            rateTypes: o.rateTypes ?? RATE_TYPES.length
        },
        locales
    };
}
