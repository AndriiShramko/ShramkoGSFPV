// The settings catalogue (docs/architecture-v03.md I.1-I.6, owner's item 12): every shipped setting,
// every shipped keyboard shortcut, keyboard flying and every drone preset, built by the prefs
// package's buildCatalogue from the one settings schema and keymap, and written to
//   apps/site/src/generated/features.json   the landing's "tune" section, in en/es/pl/ru
//   docs/settings.md                         the full list on GitHub, in English
//   README.md                                the block between <!-- settings:start --> and <!-- settings:end -->
//   llms.txt, apps/site/public/llms.txt      one line under "## Links"
//
//   node --import tsx scripts/gen-catalog.ts           write whatever is stale
//   node --import tsx scripts/gen-catalog.ts --check   exit 1 when any output is stale (CI); then a
//                                                      negative control: a planted stale label must be caught
//
// Texts, in this order (the first that has the key wins):
//   1. the simulator's dictionaries, packages/i18n/locales/fly/<lang>.json plus every namespace
//      folder, merged as apps/fly/src/i18n.ts merges them: the site says what the simulator says;
//   2. names that are the same in every language: drone preset names, the language endonyms;
//   3. the catalogue's own texts in the site dictionaries, `tune.text` (packages/i18n/locales/site),
//      keyed like the simulator's (`set.<id>` is `tune.text.set.<group>.<name>.label`), so a setting
//      that ships before its owner has written `set.<id>` in the fly dictionaries still has a row.
// A shipped setting or key that has no text in some language in any of them stops the generator
// (buildCatalogue throws, naming each missing key). Planned settings and keys never appear.
//
// The date in features.json and docs/settings.md changes only when the catalogue's content does,
// so --check stays green from one day to the next.

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DRONE_IDS, FLYING_CODES, KEYMAP, RATE_TYPES, SCALE_MAX, SCALE_MIN, SCHEMA, SHARED_WITH_FLYING, buildCatalogue, helpKey, isPresetRef, labelKey } from '../packages/prefs/src/index';
import type { CatalogueKey, CataloguePreset, CatalogueSetting, Dict, GroupId, SettingDef } from '../packages/prefs/src/index';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LANGS = ['en', 'es', 'pl', 'ru'] as const;
type Lang = (typeof LANGS)[number];

const FLY_DIR = join(ROOT, 'packages', 'i18n', 'locales', 'fly');
const SITE_DIR = join(ROOT, 'packages', 'i18n', 'locales', 'site');
const PRESET_DIR = join(ROOT, 'packages', 'sim-core', 'presets');
const OUT_JSON = 'apps/site/src/generated/features.json';
const OUT_MD = 'docs/settings.md';
const README = 'README.md';
const LLMS = ['llms.txt', 'apps/site/public/llms.txt'];
const MARK_START = '<!-- settings:start -->';
const MARK_END = '<!-- settings:end -->';

const SITE = 'https://gsfpv.flyreelstudio.eu';
const REPO_BLOB = 'https://github.com/AndriiShramko/ShramkoGSFPV/blob/main';
const LLMS_LINK = '- [Settings catalogue]';

const read = (rel: string): string | null => {
    const p = join(ROOT, rel);
    return existsSync(p) ? readFileSync(p, 'utf8') : null;
};
const json = (p: string): unknown => JSON.parse(readFileSync(p, 'utf8'));

// ---------------------------------------------------------------- inputs

/** The simulator's table for one language: the flat file, then every namespace folder (1.3). */
function flyDict(lang: Lang): Record<string, string> {
    const out: Record<string, string> = { ...(json(join(FLY_DIR, `${lang}.json`)) as Record<string, string>) };
    for (const ns of readdirSync(FLY_DIR).sort()) {
        const p = join(FLY_DIR, ns, `${lang}.json`);
        if (statSync(join(FLY_DIR, ns)).isDirectory() && existsSync(p)) Object.assign(out, json(p) as Record<string, string>);
    }
    return out;
}

type Tree = { [k: string]: string | Tree };

function flatten(t: Tree | undefined, prefix: string, out: Record<string, string>): void {
    if (!t) return;
    for (const [k, v] of Object.entries(t)) {
        const key = `${prefix}.${k}`;
        if (typeof v === 'string') out[key] = v;
        else flatten(v, key, out);
    }
}

/** The site dictionary's `tune` block: the section's own words and its fallback texts. */
function siteTune(lang: Lang): Tree {
    const d = json(join(SITE_DIR, `${lang}.json`)) as { tune?: Tree };
    if (!d.tune || typeof d.tune.text !== 'object') throw new Error(`gen-catalog: packages/i18n/locales/site/${lang}.json has no tune.text block`);
    return d.tune;
}

/** tune.text turned into the simulator's key space (see the header). */
function fallbackDict(lang: Lang): Record<string, string> {
    const text = siteTune(lang).text as Tree;
    const out: Record<string, string> = {};
    const prefs: Record<string, string> = {};
    flatten(text.prefs as Tree, 'prefs', prefs);
    // unit symbols are stored bare ("m/s"); catalog.ts writes them right after the number
    for (const [k, v] of Object.entries(prefs)) out[k] = k.startsWith('prefs.unit.') ? ` ${v}` : v;
    flatten(text.group as Tree, 'group', out);
    flatten(text.keys as Tree, 'keys', out);
    for (const [g, names] of Object.entries((text.set ?? {}) as Tree)) {
        for (const [name, e] of Object.entries(names as Tree)) {
            const entry = e as Tree;
            const id = `set.${g}.${name}`;
            if (typeof entry.label === 'string') out[id] = entry.label;
            if (typeof entry.help === 'string') out[`${id}.help`] = entry.help;
            flatten(entry.opt as Tree, `${id}.opt`, out);
        }
    }
    return out;
}

/** Drone presets in the picker's order (DRONE_IDS), any other preset file after them. */
function loadPresets(): CataloguePreset[] {
    const all = readdirSync(PRESET_DIR).filter((f) => f.endsWith('.json')).map((f) => json(join(PRESET_DIR, f)) as CataloguePreset);
    const rank = (id: string) => (DRONE_IDS.includes(id) ? DRONE_IDS.indexOf(id) : DRONE_IDS.length);
    return all.sort((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id));
}

/** A language's name in another language, as the platform's CLDR data has it ("Russian", "ruso"...). */
function languageName(code: string, inLang: string): string | undefined {
    try {
        const n = new Intl.DisplayNames([inLang], { type: 'language' }).of(code);
        return n && n !== code ? n.charAt(0).toLocaleUpperCase(inLang) + n.slice(1) : undefined;
    } catch {
        return undefined;
    }
}

/** Names nobody has to translate: drone preset names, and language names from CLDR. */
function derivedDict(lang: Lang, presets: readonly CataloguePreset[]): Record<string, string> {
    const out: Record<string, string> = {};
    const drone = SCHEMA.byId.get('drone.current');
    if (drone?.type === 'enum') for (const p of presets) if (drone.options.includes(p.id)) out[`set.drone.current.opt.${p.id}`] = p.name;
    const ui = SCHEMA.byId.get('ui.language');
    if (ui?.type === 'enum') {
        for (const o of ui.options) {
            const n = languageName(o, lang);
            if (n) out[`set.ui.language.opt.${o}`] = n;
        }
    }
    return out;
}

/**
 * Letters the repository keeps inside locales/ only (tools/bench accept-repo B18): Cyrillic and
 * the Polish letters. docs/settings.md, the README block and llms.txt are English.
 */
const NOT_IN_ENGLISH = /[\u0400-\u04ff\u0104-\u0107\u0118\u0119\u0141-\u0144\u015a\u015b\u0179-\u017c]/;

/**
 * Keyboard flying (apps/fly devices/keyboard.ts): not menu actions, so not in KEYMAP, but keys a
 * pilot uses. The texts are the simulator's own key card (arm.keys.*). Every flying code of the
 * keymap module must be listed here, or the generator stops: the site must not miss a key.
 */
const FLYING: readonly { codes: readonly string[]; caps: readonly string[]; label: string }[] = [
    { codes: ['Space'], caps: ['Space'], label: 'arm.keys.arm' },
    { codes: ['KeyW', 'KeyS'], caps: ['W', 'S'], label: 'arm.keys.throttle' },
    { codes: ['KeyA', 'KeyD'], caps: ['A', 'D'], label: 'arm.keys.yaw' },
    { codes: ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'], caps: ['↑', '↓', '←', '→'], label: 'arm.keys.sticks' },
    { codes: ['KeyM'], caps: ['M'], label: 'arm.keys.mode' }
];

function checkFlying(): void {
    const listed = new Set(FLYING.flatMap((f) => f.codes));
    const want = [...FLYING_CODES, ...Object.keys(SHARED_WITH_FLYING)];
    const missing = want.filter((c) => !listed.has(c));
    const extra = [...listed].filter((c) => !want.includes(c));
    if (missing.length || extra.length) throw new Error(`gen-catalog: keyboard flying changed (missing ${missing.join(', ') || 'none'}, extra ${extra.join(', ') || 'none'}): update FLYING in scripts/gen-catalog.ts`);
}

// ---------------------------------------------------------------- the catalogue

export interface FeatureSetting extends CatalogueSetting {
    /** the default is the drone preset's own value (for the default drone when `default` is set) */
    preset: boolean;
    /** enum option labels; rate-curve names for the rates */
    options: string[];
    /** where the simulator shows it (schema `shown`): 'settings' rows get a deep link */
    shown: string[];
}
export interface FeatureGroup { id: GroupId; title: string; settings: FeatureSetting[] }
export interface FeatureField { label: string; value: string; source: string; kind: 'manufacturer' | 'measured' | 'estimate' | 'bf-default' | 'other'; sourceLabel: string }
export interface FeatureLocale {
    groups: FeatureGroup[];
    keys: CatalogueKey[];
    flying: { label: string; keys: string[] }[];
    drones: { id: string; name: string; fields: FeatureField[] }[];
}
export interface Features {
    generated: string;
    schemaVersion: number;
    defaultDrone: string;
    counts: { settings: number; groups: number; drones: number; modes: number; keys: number; rateTypes: number; flyingKeys: number; allKeys: number };
    locales: Record<Lang, FeatureLocale>;
}

const RATE_NAMES: Readonly<Record<string, string>> = { BETAFLIGHT: 'Betaflight', ACTUAL: 'Actual', KISS: 'KISS', RACEFLIGHT: 'Raceflight' };

export interface Provenance { fly: number; derived: number; fallback: number; fallbackIds: string[] }

/** The keys a shipped row reads, to report where each text came from. */
function neededKeys(): { key: string; id: string }[] {
    const out: { key: string; id: string }[] = [];
    const shipped = SCHEMA.defs.filter((d) => d.status === 'shipped');
    for (const d of shipped) {
        out.push({ key: labelKey(d), id: d.id }, { key: helpKey(d), id: d.id });
        if (d.type === 'enum') for (const o of d.options) out.push({ key: `set.${d.id}.opt.${o}`, id: d.id });
    }
    for (const g of new Set(shipped.map((d) => d.group))) out.push({ key: `group.${g}`, id: `group.${g}` });
    for (const b of KEYMAP.filter((k) => k.status === 'shipped')) out.push({ key: b.labelKey, id: b.action });
    return out;
}

export function buildFeatures(date: string): { features: Features; provenance: Provenance } {
    checkFlying();
    const presets = loadPresets();
    const dicts = {} as Record<Lang, Record<string, string>>;
    const prov: Provenance = { fly: 0, derived: 0, fallback: 0, fallbackIds: [] };
    const need = neededKeys();
    const flys = {} as Record<Lang, Record<string, string>>;
    for (const lang of LANGS) {
        const fly = flyDict(lang);
        const derived = derivedDict(lang, presets);
        const fallback = fallbackDict(lang);
        flys[lang] = fly;
        dicts[lang] = { ...fallback, ...derived, ...fly };
        for (const n of need) {
            if (fly[n.key] !== undefined && fly[n.key].trim()) prov.fly++;
            else if (derived[n.key] !== undefined) prov.derived++;
            else if (fallback[n.key] !== undefined) {
                prov.fallback++;
                if (!prov.fallbackIds.includes(n.id)) prov.fallbackIds.push(n.id);
            }
        }
    }
    const cat = buildCatalogue(SCHEMA, KEYMAP, dicts, presets, { generated: date });

    const locales = {} as Record<Lang, FeatureLocale>;
    for (const lang of LANGS) {
        const dict = dicts[lang];
        const fly = flys[lang];
        const src = cat.locales[lang];
        const fromPreset = ` (${dict['prefs.fromPreset']})`;
        const groups: FeatureGroup[] = src.groups.map((g) => ({
            id: g.id,
            title: g.title,
            settings: g.settings.map((s): FeatureSetting => {
                const def = SCHEMA.byId.get(s.id) as SettingDef;
                const row: FeatureSetting = { ...s, preset: false, options: [], shown: [...def.shown] };
                if (def.type === 'number' && isPresetRef(def.default) && row.default.endsWith(fromPreset)) {
                    row.default = row.default.slice(0, -fromPreset.length);
                    row.preset = true;
                }
                if (def.type === 'enum') row.options = def.options.map((o) => dict[`set.${def.id}.opt.${o}`]);
                if (def.type === 'json') {
                    // catalog.ts says "from the preset" for every null default; only a tune is one
                    row.default = '';
                    if (def.kind === 'pid' || def.kind === 'rates' || def.kind === 'throttle') row.preset = true;
                    if (def.kind === 'pid') row.range = '0–250';
                    if (def.kind === 'throttle') row.range = '0–100';
                    if (def.kind === 'rates') row.options = RATE_TYPES.map((r) => RATE_NAMES[r] ?? r);
                    if (def.kind === 'transform') {
                        row.default = '1×';
                        row.range = `${SCALE_MIN}×–${SCALE_MAX}×`;
                    }
                }
                return row;
            })
        }));
        const flying = FLYING.map((f) => {
            const label = fly[f.label];
            if (!label) throw new Error(`gen-catalog: ${lang}: missing ${f.label} (keyboard flying)`);
            const caps = f.caps.map((c) => (c === 'Space' ? (fly['arm.keys.space'] ?? c) : c));
            return { label, keys: caps };
        });
        const sourceOf = (source: string): Pick<FeatureField, 'kind' | 'sourceLabel'> => {
            const [kind, who] = source.split(':');
            const word = (k: string) => fly[k] ?? kind;
            if (kind === 'manufacturer') return { kind, sourceLabel: word('common.manufacturer') };
            if (kind === 'measured') return { kind, sourceLabel: who ? `${word('common.measured')}: ${who}` : word('common.measured') };
            if (kind === 'estimate') return { kind, sourceLabel: word('common.estimate') };
            if (kind === 'bf-default') return { kind, sourceLabel: word('common.bfDefault') };
            return { kind: 'other', sourceLabel: source };
        };
        locales[lang] = {
            groups,
            keys: src.keys,
            flying,
            drones: src.drones.map((d) => ({ id: d.id, name: d.name, fields: d.fields.map((f) => ({ ...f, ...sourceOf(f.source) })) }))
        };
    }
    const flyingCaps = FLYING.flatMap((f) => f.caps);
    const shortcutCaps = locales.en.keys.flatMap((k) => k.keys);
    const droneDef = SCHEMA.byId.get('drone.current');
    return {
        features: {
            generated: cat.generated,
            schemaVersion: cat.schemaVersion,
            defaultDrone: droneDef && typeof droneDef.default === 'string' ? droneDef.default : presets[0].id,
            counts: { ...cat.counts, flyingKeys: flyingCaps.length, allKeys: new Set([...shortcutCaps, ...flyingCaps]).size },
            locales
        },
        provenance: prov
    };
}

// ---------------------------------------------------------------- rendering

/** ASCII-only JSON: the ES/PL/RU texts stay out of the repo's prose as letters (only locales/ may hold them). */
export function featuresJson(f: Features): string {
    return JSON.stringify(f, null, 1).replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`) + '\n';
}

const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
const caps = (ks: readonly string[]) => ks.map((k) => `\`${k}\``).join(' ');
/** GitHub's heading anchor. */
const slug = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s/g, '-');
const allSettings = (l: FeatureLocale) => l.groups.flatMap((g) => g.settings);

function counts(f: Features): string {
    const c = f.counts;
    return `${c.settings} settings in ${c.groups} groups, ${c.allKeys} keyboard keys, ${c.drones} drone presets and ${c.rateTypes} rate-curve types`;
}

function valueOf(s: FeatureSetting, dictPreset: string): string {
    if (s.default && s.preset) return `${s.default} (${dictPreset})`;
    if (s.default) return s.default;
    return s.preset ? dictPreset : '';
}

/** Natural-language questions (vault rule for public repositories), each only once its settings ship. */
interface Lookup { row(id: string): FeatureSetting }
/** "a, b or c" */
const anyOf = (xs: readonly string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}`);
const QA: readonly { needs: readonly string[]; q: string; a: (c: Lookup) => string }[] = [
    { needs: ['crash.enabled'], q: 'Can I turn off crashes in a browser FPV simulator?', a: (c) => `Yes. Switch **${c.row('crash.enabled').label}** off in Settings and a wall hit never ends the flight, so a beginner can keep flying.` },
    { needs: ['flight.mode'], q: 'Does it have angle / self-level mode?', a: (c) => `Yes: ${anyOf(c.row('flight.mode').options)}. The default is ${c.row('flight.mode').default}; the HUD chip and the M key switch it.` },
    { needs: ['respawn.auto', 'respawn.delayS', 'respawn.rewindS'], q: 'Does the drone respawn by itself after a crash?', a: (c) => `Yes: ${c.row('respawn.delayS').default} after a crash it is back in the air, ${c.row('respawn.rewindS').default} before the crash, on an invisible platform. Both times are settings (${c.row('respawn.delayS').range} and ${c.row('respawn.rewindS').range}).` },
    { needs: ['camera.fovDeg', 'camera.uptiltDeg'], q: 'Can I change the FPV camera angle and field of view?', a: (c) => `Yes, for each drone separately: camera uptilt ${c.row('camera.uptiltDeg').range} and field of view ${c.row('camera.fovDeg').range} (${c.row('camera.uptiltDeg').default} and ${c.row('camera.fovDeg').default} on the default drone).` },
    { needs: ['physics.gravity', 'physics.gravityMode'], q: 'Can I fly an FPV drone on the Moon or Mars?', a: (c) => `Yes: gravity is a setting (${c.row('physics.gravity').range}): Earth 9.81, Moon 1.62, Mars 3.72, zero-g or anything in between. **${c.row('physics.gravityMode').label}** picks how the motors cope: ${anyOf(c.row('physics.gravityMode').options)}.` },
    { needs: ['tune.pid', 'tune.rates', 'tune.throttle'], q: 'Can I use my own Betaflight rates and PID in the simulator?', a: (c) => `Yes: paste \`diff\` or \`diff all\` from the Betaflight CLI. The rates (${anyOf(c.row('tune.rates').options)} curves), the PID and the throttle curve are set for the drone you fly; every drone keeps its own.` },
    { needs: ['physics.vCrash'], q: 'How hard can I hit a wall before it counts as a crash?', a: (c) => `That is the **${c.row('physics.vCrash').label}**: ${c.row('physics.vCrash').range} for each drone, ${c.row('physics.vCrash').default} by default. Slower touches slide along the wall.` },
    { needs: ['scene.transform'], q: 'Can I fix a scan that has the wrong size?', a: (c) => `Yes: **${c.row('scene.transform').label}** scales the scan around the drone (${c.row('scene.transform').range}) and is remembered for each scan.` },
    { needs: ['voxels.show'], q: 'Can I see the collision walls of a Gaussian Splatting scan?', a: (c) => `Yes: the **${c.row('voxels.show').label}** shows the voxels you crash into, ${c.row('voxels.show').options.slice(1).join(' or ').toLowerCase()}.` },
    { needs: ['recording.fps'], q: 'Can I record 60 fps video of my flight?', a: (c) => `Yes: **${c.row('recording.fps').label}** is ${anyOf(c.row('recording.fps').options)}, ${c.row('recording.fps').default} by default.` }
];

function qa(l: FeatureLocale): { q: string; a: string }[] {
    const rows = new Map(allSettings(l).map((s) => [s.id, s]));
    const c: Lookup = { row: (id) => rows.get(id) as FeatureSetting };
    return QA.filter((x) => x.needs.every((id) => rows.has(id))).map((x) => ({ q: x.q, a: x.a(c) }));
}

const CONTACT = [
    '## Author and collaboration',
    '',
    'ShramkoGSFPV is built by **Andrii Shramko**, FPV pilot and 3D/4D Gaussian Splatting specialist. I am open to partnership, integration, licensing, sponsorship and funding, and ready to assemble and lead a team around this simulator: FPV pilots, scanning studios, drone makers, simulator developers, 3DGS platforms and investors, get in touch.',
    '',
    '- **LinkedIn:** https://www.linkedin.com/in/andrii-shramko/',
    '- **Book a call:** https://calendar.app.google/Ff729HqGk4RpzPNDA',
    '- **Email:** zmei116@gmail.com',
    '- **GitHub:** https://github.com/AndriiShramko',
    `- **Contact form:** ${SITE}/en/#contact`
];

export function settingsMd(f: Features): string {
    const en = f.locales.en;
    const fromPreset = 'drone preset';
    const def = en.drones.find((d) => d.id === f.defaultDrone);
    const out: string[] = [
        '# Settings catalogue: every setting, key and drone of ShramkoGSFPV',
        '',
        '<!-- Generated by scripts/gen-catalog.ts from packages/prefs (the settings schema and the keymap), the drone presets and the simulator\'s dictionaries. Do not edit by hand: run `node --import tsx scripts/gen-catalog.ts`. -->',
        '',
        `Everything you can change in [ShramkoGSFPV](${SITE}), the open-source browser FPV drone simulator for 3D Gaussian Splatting scans: **${counts(f)}**. Generated on ${f.generated} from the simulator's own settings schema, so it lists only what ships today; a setting that is still being built appears here the day it ships. The same catalogue, in English, Spanish, Polish and Russian, is on the [landing page](${SITE}/en/#tune).`,
        '',
        '- **Per drone:** each drone keeps its own value (camera, motor model, PID, rates…), so tuning one drone never changes another.',
        '- **Per scene:** kept for each scan.',
        `- **Drone preset:** the default is the drone's own number; shown here for the default drone, ${def?.name ?? f.defaultDrone}.`,
        '',
        '## Contents',
        '',
        ...en.groups.map((g) => `- [${g.title}](#${slug(g.title)}) (${g.settings.length})`),
        '- [Keyboard shortcuts](#keyboard-shortcuts)',
        '- [Drone presets](#drone-presets)',
        '- [Questions people ask](#questions-people-ask)',
        ''
    ];
    for (const g of en.groups) {
        out.push(`## ${g.title}`, '', '| Setting | What it does | Default | Range or options | Scope | Key |', '|---|---|---|---|---|---|');
        for (const s of g.settings) {
            // a language list may carry endonyms ("Polski"); the English page names them in English
            const def = SCHEMA.byId.get(s.id);
            const options = s.id === 'ui.language' && def?.type === 'enum' ? def.options.map((o, i) => languageName(o, 'en') ?? s.options[i]) : s.options;
            const range = options.length ? options.join(' · ') : s.range;
            const scope = s.scope === 'global' ? 'global' : `per ${s.scope}`;
            const name = `**${cell(s.label)}**${s.advanced ? ' (advanced)' : ''}<br>\`${s.id}\``;
            out.push(`| ${name} | ${cell(s.help)} | ${cell(valueOf(s, fromPreset))} | ${cell(range)} | ${scope} | ${caps(s.keys)} |`);
        }
        out.push('');
    }
    out.push('## Keyboard shortcuts', '', 'The simulator shows each key next to its menu item.', '', '| Key | Action |', '|---|---|');
    for (const k of en.keys) out.push(`| ${caps(k.keys)} | ${cell(k.label)} |`);
    out.push('', '### Keyboard flying', '', 'No radio? These keys are the sticks.', '', '| Key | Action |', '|---|---|');
    for (const k of en.flying) out.push(`| ${caps(k.keys)} | ${cell(k.label)} |`);
    out.push('', '## Drone presets', '', 'Every number says where it comes from: manufacturer, independent measurement or estimate.', '');
    const labels = [...new Set(en.drones.flatMap((d) => d.fields.map((x) => x.label)))];
    out.push(`| Drone | ${labels.join(' | ')} |`, `|---|${labels.map(() => '---|').join('')}`);
    for (const d of en.drones) {
        const cells = labels.map((lab) => {
            const x = d.fields.find((y) => y.label === lab);
            return x ? `${cell(x.value)} *(${cell(x.sourceLabel)})*` : '';
        });
        out.push(`| **${cell(d.name)}**${d.id === f.defaultDrone ? ' (default)' : ''}<br>\`${d.id}\` | ${cells.join(' | ')} |`);
    }
    out.push('', '## Questions people ask', '');
    for (const x of qa(en)) out.push(`**${x.q}**`, x.a, '');
    out.push(...CONTACT, '');
    return out.join('\n');
}

export function readmeBlock(f: Features): string {
    const en = f.locales.en;
    const short = (s: FeatureSetting) => {
        const extra = s.options.length && s.type !== 'enum' ? '' : s.range && s.type === 'number' ? ` ${s.range}` : '';
        return `${s.label}${extra}${s.keys.length ? ` (${caps(s.keys)})` : ''}`;
    };
    const lines = [
        MARK_START,
        '<!-- Generated by scripts/gen-catalog.ts from the settings schema; edit the schema or the dictionaries, not this block. -->',
        `**${counts(f)}**, generated from the simulator's own settings schema, so this list shows only what ships today. Every setting with its default, range, scope and key: [\`docs/settings.md\`](docs/settings.md); in English, Spanish, Polish and Russian on the [landing page](${SITE}/en/#tune).`,
        '',
        '| Group | Settings |',
        '|---|---|',
        ...en.groups.map((g) => `| ${cell(g.title)} (${g.settings.length}) | ${g.settings.map((s) => cell(short(s))).join(' · ')} |`),
        '',
        `**Keyboard:** ${en.keys.map((k) => `${caps(k.keys)} ${k.label.toLowerCase()}`).join(' · ')}. **Keyboard flying:** ${en.flying.map((k) => `${caps(k.keys)} ${k.label}`).join(' · ')}.`,
        '',
        ...qa(en).flatMap((x) => [`**${x.q}**`, x.a, '']),
        MARK_END
    ];
    return lines.join('\n');
}

export function withReadmeBlock(readme: string, block: string): string {
    const a = readme.indexOf(MARK_START);
    const b = readme.indexOf(MARK_END);
    if (a < 0 || b < a) throw new Error(`gen-catalog: README.md has no ${MARK_START} … ${MARK_END} block`);
    return readme.slice(0, a) + block + readme.slice(b + MARK_END.length);
}

export function llmsLine(f: Features): string {
    return `${LLMS_LINK}(${REPO_BLOB}/docs/settings.md): every setting of the simulator with its default, range, scope and keyboard key: ${counts(f)} (generated from the settings schema at each release; in four languages at ${SITE}/en/#tune)`;
}

export function withLlmsLine(text: string, line: string): string {
    const lines = text.split('\n');
    const at = lines.findIndex((l) => l.startsWith(LLMS_LINK));
    if (at >= 0) {
        lines[at] = line;
        return lines.join('\n');
    }
    const links = lines.findIndex((l) => l.trim() === '## Links');
    if (links < 0) throw new Error('gen-catalog: llms.txt has no "## Links" list');
    let end = links + 1;
    while (end < lines.length && lines[end].startsWith('- ')) end++;
    lines.splice(end, 0, line);
    return lines.join('\n');
}

// ---------------------------------------------------------------- outputs, check, control

type Outputs = Map<string, string>;

function render(f: Features, disk: (rel: string) => string | null): Outputs {
    const out: Outputs = new Map();
    out.set(OUT_JSON, featuresJson(f));
    out.set(OUT_MD, settingsMd(f));
    const readme = disk(README);
    if (readme === null) throw new Error('gen-catalog: README.md is missing');
    out.set(README, withReadmeBlock(readme, readmeBlock(f)));
    for (const p of LLMS) {
        const t = disk(p);
        if (t === null) throw new Error(`gen-catalog: ${p} is missing`);
        out.set(p, withLlmsLine(t, llmsLine(f)));
    }
    for (const [p, text] of [[OUT_MD, out.get(OUT_MD) as string], [README, readmeBlock(f)], ['llms.txt line', llmsLine(f)]] as const) {
        const m = NOT_IN_ENGLISH.exec(text);
        if (m) throw new Error(`gen-catalog: ${p} would contain "${m[0]}" (${text.slice(Math.max(0, m.index - 40), m.index + 20).replace(/\n/g, ' ')}): an English text in the simulator's en dictionary? Only locales/ may hold such letters`);
    }
    return out;
}

const stale = (o: Outputs, disk: (rel: string) => string | null) => [...o].filter(([p, s]) => disk(p) !== s).map(([p]) => p);

function previousDate(): string | null {
    const t = read(OUT_JSON);
    if (!t) return null;
    try {
        const g = (JSON.parse(t) as { generated?: unknown }).generated;
        return typeof g === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(g) ? g : null;
    } catch {
        return null;
    }
}

/**
 * The negative control of --check: the same comparison, run on outputs rendered from a catalogue
 * with one English label changed, must call the site data, the docs page and the README stale.
 */
function control(f: Features): string[] {
    const planted = JSON.parse(JSON.stringify(f)) as Features;
    const row = planted.locales.en.groups[0]?.settings[0];
    if (!row) return ['no setting to plant a stale label on'];
    row.label = `${row.label} (stale)`;
    const s = stale(render(planted, read), read);
    return [OUT_JSON, OUT_MD, README].filter((p) => !s.includes(p)).map((p) => `${p} not caught`);
}

function main(): void {
    const check = process.argv.includes('--check');
    const today = new Date().toISOString().slice(0, 10);
    const prev = previousDate() ?? today;
    let { features, provenance } = buildFeatures(prev);
    let out = render(features, read);
    const dataChanged = read(OUT_JSON) !== out.get(OUT_JSON);
    const c = features.counts;
    const summary = `${c.settings} settings in ${c.groups} groups, ${c.keys} shortcut keys + ${c.flyingKeys} flying keys, ${c.drones} drones`;
    const texts = `texts for shipped rows: ${provenance.fly} from the simulator's dictionaries, ${provenance.derived} names, ${provenance.fallback} from the catalogue's own (site tune.text)${provenance.fallbackIds.length ? `: ${provenance.fallbackIds.join(', ')}` : ''}`;

    if (check) {
        const s = stale(out, read);
        if (s.length) {
            console.error(`gen-catalog --check: STALE ${s.join(', ')}\n  run: node --import tsx scripts/gen-catalog.ts`);
            process.exit(1);
        }
        const missed = control(features);
        if (missed.length) {
            console.error(`gen-catalog --check: the negative control did not fire (${missed.join('; ')})`);
            process.exit(1);
        }
        console.log(`gen-catalog --check: up to date (${summary}); control: a planted stale label is caught in ${OUT_JSON}, ${OUT_MD}, ${README}`);
        console.log(`  ${texts}`);
        return;
    }
    if (dataChanged && prev !== today) {
        ({ features, provenance } = buildFeatures(today));
        out = render(features, read);
    }
    const s = stale(out, read);
    for (const p of s) {
        const abs = join(ROOT, p);
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, out.get(p) as string, 'utf8');
    }
    console.log(`gen-catalog: ${summary}; ${s.length ? `wrote ${s.map((p) => relative(ROOT, join(ROOT, p))).join(', ')}` : 'everything up to date'} (generated ${features.generated})`);
    console.log(`  ${texts}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        main();
    } catch (e) {
        // a missing text or a broken input: one readable line for CI, not a stack trace
        console.error(e instanceof Error ? e.message : String(e));
        process.exit(1);
    }
}
