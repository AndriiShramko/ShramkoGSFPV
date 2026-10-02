// The schema of every value a pilot can change (docs/architecture-v03.md A.2). One definition per
// setting drives the store's validation, the settings UI, the site catalogue, docs/settings.md and
// the README block, so a setting cannot exist in one of them and be missing from another.

import { KEYMAP } from './keymap';
import type { ActionId } from './keymap';

export type Scope = 'global' | 'drone' | 'scene';
export type Apply = 'live' | 'life' | 'reload';
export type Surface = 'settings' | 'hud' | 'pause' | 'crash' | 'picker' | 'controls' | 'cinema' | 'key' | 'url';
export type GroupId = 'flight' | 'crash' | 'camera' | 'display' | 'input' | 'drone' | 'tune' | 'scenes' | 'voxels' | 'recording';
export type Status = 'shipped' | 'planned' | 'test'; // planned: stored and validated, hidden from the UI and the catalogue
export type Unit = 'deg' | 'ms' | 's' | 'm' | 'mps' | 'mps2' | 'x' | 'pct' | 'per_s' | 'blocks' | 'min';

/**
 * A default (or bound) read from the drone preset: `field(presetId, preset) * scale`.
 * `fallback` is the value when the preset lacks the field (an unknown drone, or a field a later
 * preset adds); defineSettings requires it on defaults, so a default is never undefined.
 */
export interface PresetRef { preset: string; scale?: number; fallback?: number }

/**
 * A per-scene default the admin sets for each scan in the curated list (apps/fly/public/showcase.json,
 * E.2): `PresetResolver.curated(sceneId, curated)`, used when it is a valid value, else `fallback`.
 * The store reads it for the scene in the context (`get(id, { scene })`). A scene setting keeps
 * one value per scan; a global one keeps one value for every scan, and the admin's value per scan
 * applies only while the pilot has not chosen. The walls switch is the first (global since schema
 * 2, the owner's message 16): the admin's "walls": "off" for a noisy scan is the default of a pilot
 * who never switched the walls, and a later change of the admin's value reaches such a pilot, like
 * any changed default (A.6); once the pilot switches, that choice holds on every scan.
 */
export interface CuratedRef<T = unknown> { curated: string; fallback: T }

interface Base<T> {
    id: string; // '<group>.<name>', stable forever; a rename is a migration
    group: GroupId;
    scope: Scope;
    default: T | PresetRef | CuratedRef<T>;
    apply: Apply;
    shown: readonly Surface[];
    status: Status;
    since: number; // schema version that introduced it
    label?: string; // i18n key, default `set.<id>`
    help?: string; // i18n key, default `set.<id>.help`
    /** key that changes it, shown beside the row; two for a pair such as [ and ] (see actionsOf) */
    action?: ActionId | readonly ActionId[];
    url?: string; // legacy / diagnostic URL parameter (session layer only)
    advanced?: boolean;
    items?: readonly number[]; // brief items it answers (catalogue, tests)
    /**
     * false: the value lasts for this page load only. set() puts it in the session layer; it is
     * never stored, exported or imported, and a reload shows the default. Global settings only.
     * For a state the app deliberately forgets, such as the voxel view (V): main shows the scan
     * again after a reload.
     */
    persist?: false;
}
export interface BoolDef extends Base<boolean> { type: 'bool' }
export interface NumDef extends Base<number> { type: 'number'; min: number | PresetRef; max: number | PresetRef; step: number; unit?: Unit; curve?: 'linear' | 'log' }
export interface EnumDef extends Base<string> { type: 'enum'; options: readonly string[] }
export interface JsonDef<T = unknown> extends Base<T | null> { type: 'json'; kind: 'pid' | 'rates' | 'throttle' | 'transform' | 'folder'; validate(v: unknown): T | null }
export type SettingDef = BoolDef | NumDef | EnumDef | JsonDef;

/** 2: scene.walls became one choice for every scan (migrate.ts, 1 -> 2). */
export const SCHEMA_VERSION = 2;

/** Group order: the settings rail, the catalogue and SCHEMA follow it. */
export const GROUPS: readonly GroupId[] = ['flight', 'crash', 'camera', 'display', 'input', 'drone', 'tune', 'scenes', 'voxels', 'recording'];

export interface Schema { version: number; defs: readonly SettingDef[]; byId: ReadonlyMap<string, SettingDef>; groups: readonly GroupId[] }

const SCOPES: readonly Scope[] = ['global', 'drone', 'scene'];
const APPLIES: readonly Apply[] = ['live', 'life', 'reload'];
const SURFACES: readonly Surface[] = ['settings', 'hud', 'pause', 'crash', 'picker', 'controls', 'cinema', 'key', 'url'];
const STATUSES: readonly Status[] = ['shipped', 'planned', 'test'];
const UNITS: readonly Unit[] = ['deg', 'ms', 's', 'm', 'mps', 'mps2', 'x', 'pct', 'per_s', 'blocks', 'min'];
const KINDS: readonly JsonDef['kind'][] = ['pid', 'rates', 'throttle', 'transform', 'folder'];

export function isPresetRef(v: unknown): v is PresetRef {
    return typeof v === 'object' && v !== null && !Array.isArray(v) && typeof (v as PresetRef).preset === 'string';
}

export function isCuratedRef(v: unknown): v is CuratedRef {
    return typeof v === 'object' && v !== null && !Array.isArray(v) && typeof (v as CuratedRef).curated === 'string' && 'fallback' in v;
}

/** A def's default as a plain value: a literal, a curated default's fallback, a preset default's fallback. */
export function literalDefault(def: SettingDef): unknown {
    const d = def.default;
    if (isCuratedRef(d)) return d.fallback;
    if (isPresetRef(d)) return d.fallback;
    return d;
}

/** The actions whose keys change a setting, as a list (the def may name one or two). */
export function actionsOf(def: SettingDef): ActionId[] {
    if (def.action === undefined) return [];
    return typeof def.action === 'string' ? [def.action] : [...def.action];
}

/** i18n keys of a setting's name and help text. */
export function labelKey(def: SettingDef): string {
    return def.label ?? `set.${def.id}`;
}
export function helpKey(def: SettingDef): string {
    return def.help ?? `set.${def.id}.help`;
}

/** Canonical JSON: object keys sorted at every level, so equal values give equal text. */
export function canonicalJson(v: unknown): string {
    return JSON.stringify(sortKeys(v));
}

function sortKeys(v: unknown): unknown {
    if (Array.isArray(v)) return v.map(sortKeys);
    if (v && typeof v === 'object') {
        // no prototype: an own '__proto__' key of the input (JSON.parse makes one) stays a key of
        // the text instead of turning into this object's prototype and vanishing from the text
        const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
        for (const k of Object.keys(v).sort()) {
            const x = (v as Record<string, unknown>)[k];
            if (x !== undefined) out[k] = sortKeys(x);
        }
        return out;
    }
    return v;
}

/**
 * Reads drone preset fields and the admin's per-scene values for defaults; the store never imports
 * presets or the curated list. curated(sceneId, field): the scene's entry in showcase.json, field
 * by name as written there ("walls": "on" | "off"); undefined when the scene or field is absent.
 */
export interface PresetResolver {
    field(presetId: string, key: string): number | undefined;
    curatedScale?(sceneId: string): number | undefined;
    curated?(sceneId: string, field: string): unknown;
}

/** A number or a preset field for this drone; undefined when the preset lacks the field. */
export function presetValue(v: number | PresetRef, presets: PresetResolver, drone: string | undefined): number | undefined {
    if (typeof v === 'number') return v;
    const f = drone === undefined ? undefined : presets.field(drone, v.preset);
    return typeof f === 'number' && Number.isFinite(f) ? f * (v.scale ?? 1) : undefined;
}

/** [min, max] of a number setting for a drone; a preset bound the preset lacks is left open. */
export function boundsOf(def: NumDef, presets: PresetResolver, drone: string | undefined): { min: number; max: number } {
    return { min: presetValue(def.min, presets, drone) ?? -Infinity, max: presetValue(def.max, presets, drone) ?? Infinity };
}

export type Check = { ok: true; value: unknown; clamped: boolean } | { ok: false; reason: 'type' | 'range' | 'option' };

/**
 * Validates one value against its def. Numbers are clamped into [min, max] (the caller resolves
 * preset bounds for the drone); a JSON kind's validator may repair a value, and a repaired value
 * counts as clamped. Returned JSON values are fresh copies, never the caller's object.
 */
export function checkValue(def: SettingDef, v: unknown, bounds?: { min: number; max: number }): Check {
    switch (def.type) {
        case 'bool':
            return typeof v === 'boolean' ? { ok: true, value: v, clamped: false } : { ok: false, reason: 'type' };
        case 'enum':
            if (typeof v !== 'string') return { ok: false, reason: 'type' };
            return def.options.includes(v) ? { ok: true, value: v, clamped: false } : { ok: false, reason: 'option' };
        case 'number': {
            if (typeof v !== 'number') return { ok: false, reason: 'type' };
            if (!Number.isFinite(v)) return { ok: false, reason: 'range' };
            const lo = bounds?.min ?? (typeof def.min === 'number' ? def.min : -Infinity);
            const hi = bounds?.max ?? (typeof def.max === 'number' ? def.max : Infinity);
            const c = v < lo ? lo : v > hi ? hi : v;
            return { ok: true, value: c, clamped: c !== v };
        }
        case 'json': {
            if (v === null) return { ok: true, value: null, clamped: false };
            let out: unknown;
            try {
                out = def.validate(JSON.parse(JSON.stringify(v)));
            } catch {
                return { ok: false, reason: 'type' };
            }
            if (out === null || out === undefined) return { ok: false, reason: 'type' };
            return { ok: true, value: out, clamped: canonicalJson(out) !== canonicalJson(v) };
        }
    }
}

const ID_RE = /^[a-z][A-Za-z0-9]*\.[a-z][A-Za-z0-9]*$/;
const OPTION_RE = /^[A-Za-z0-9_-]+$/;
const URL_RE = /^[a-z][A-Za-z0-9]*$/;

function problemsOf(d: SettingDef, known: ReadonlySet<string>): string[] {
    const p: string[] = [];
    const id = d.id;
    if (!ID_RE.test(id)) p.push(`${id}: id is not '<group>.<name>'`);
    if (!GROUPS.includes(d.group)) p.push(`${id}: unknown group ${d.group}`);
    if (!SCOPES.includes(d.scope)) p.push(`${id}: unknown scope ${d.scope}`);
    if (!APPLIES.includes(d.apply)) p.push(`${id}: unknown apply ${d.apply}`);
    if (!STATUSES.includes(d.status)) p.push(`${id}: unknown status ${d.status}`);
    for (const s of d.shown) if (!SURFACES.includes(s)) p.push(`${id}: unknown surface ${s}`);
    if (!Number.isInteger(d.since) || d.since < 1 || d.since > SCHEMA_VERSION) p.push(`${id}: since ${d.since} outside 1..${SCHEMA_VERSION}`);
    for (const a of actionsOf(d)) if (!known.has(a)) p.push(`${id}: action ${a} is not in the keymap`);
    if (d.url !== undefined && !URL_RE.test(d.url)) p.push(`${id}: url parameter '${d.url}' is not a plain name`);
    if (isPresetRef(d.default)) {
        // a preset default only means something per drone, and needs a value for unknown drones
        if (d.type !== 'number') p.push(`${id}: a preset default needs a number setting`);
        if (d.scope !== 'drone') p.push(`${id}: a preset default needs scope 'drone'`);
        if (typeof d.default.fallback !== 'number') p.push(`${id}: preset default without a fallback`);
    }
    const curated = isCuratedRef(d.default) ? d.default : null;
    if (curated) {
        // the admin's value is per scan; its fallback is checked below like a literal default
        if (d.scope === 'drone') p.push(`${id}: a curated default needs scope 'scene' or 'global'`);
        if (d.type === 'json') p.push(`${id}: a curated default needs a bool, number or enum setting`);
        if (!URL_RE.test(curated.curated)) p.push(`${id}: curated field '${curated.curated}' is not a plain name`);
    }
    if (d.persist !== undefined && d.persist !== false) p.push(`${id}: persist is false or absent`);
    // the session layer holds one value per id, so a setting that is never stored cannot be per drone or scene
    if (d.persist === false && d.scope !== 'global') p.push(`${id}: a setting that is not stored needs scope 'global'`);
    switch (d.type) {
        case 'bool':
            if (typeof literalDefault(d) !== 'boolean') p.push(`${id}: bool default is not a boolean`);
            break;
        case 'number': {
            if (!(d.step > 0) || !Number.isFinite(d.step)) p.push(`${id}: step must be a positive number`);
            if (d.unit !== undefined && !UNITS.includes(d.unit)) p.push(`${id}: unknown unit ${d.unit}`);
            if (d.curve !== undefined && d.curve !== 'linear' && d.curve !== 'log') p.push(`${id}: unknown curve ${d.curve}`);
            const lo = typeof d.min === 'number' ? d.min : undefined;
            const hi = typeof d.max === 'number' ? d.max : undefined;
            if (lo !== undefined && hi !== undefined && !(lo < hi)) p.push(`${id}: min ${lo} is not below max ${hi}`);
            if (d.curve === 'log' && lo !== undefined && !(lo > 0)) p.push(`${id}: a log slider needs min > 0`);
            const dv = literalDefault(d);
            if (typeof dv !== 'number' || !Number.isFinite(dv)) p.push(`${id}: number default is not a finite number`);
            else if ((lo !== undefined && dv < lo) || (hi !== undefined && dv > hi)) p.push(`${id}: default ${dv} outside ${lo}..${hi}`);
            break;
        }
        case 'enum':
            if (!d.options.length) p.push(`${id}: no options`);
            if (new Set(d.options).size !== d.options.length) p.push(`${id}: an option is listed twice`);
            for (const o of d.options) if (!OPTION_RE.test(o)) p.push(`${id}: option '${o}' cannot be an i18n key part`);
            {
                const dv = literalDefault(d);
                if (typeof dv !== 'string' || !d.options.includes(dv)) p.push(`${id}: default '${String(dv)}' is not an option`);
            }
            break;
        case 'json': {
            if (!KINDS.includes(d.kind)) p.push(`${id}: unknown json kind ${d.kind}`);
            if (typeof d.validate !== 'function') p.push(`${id}: json setting without a validator`);
            else if (d.default !== null && !curated) {
                const c = checkValue(d, d.default);
                if (!c.ok || c.clamped) p.push(`${id}: default does not pass its own validator unchanged`);
            }
            break;
        }
    }
    return p;
}

/**
 * Builds the schema, in group order (stable inside a group). Throws with every problem at once:
 * a duplicate id or URL parameter, a default outside its range or options, a bad def field.
 */
export function defineSettings(defs: readonly SettingDef[]): Schema {
    const known = new Set(KEYMAP.map((b) => b.action));
    const problems: string[] = [];
    const byId = new Map<string, SettingDef>();
    const urls = new Map<string, string>();
    for (const d of defs) {
        if (byId.has(d.id)) problems.push(`${d.id}: defined twice`);
        byId.set(d.id, d);
        if (d.url !== undefined) {
            const other = urls.get(d.url);
            if (other !== undefined) problems.push(`${d.id}: url parameter '${d.url}' already used by ${other}`);
            urls.set(d.url, d.id);
        }
        problems.push(...problemsOf(d, known));
    }
    if (problems.length) throw new Error(`defineSettings: ${problems.join('; ')}`);
    const order = (g: GroupId) => GROUPS.indexOf(g);
    const sorted = defs.map((d, i) => ({ d, i })).sort((a, b) => order(a.d.group) - order(b.d.group) || a.i - b.i).map((x) => x.d);
    return { version: SCHEMA_VERSION, defs: sorted, byId, groups: GROUPS };
}
