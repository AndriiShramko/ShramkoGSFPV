// The URL part of the session layer (A.6): `?set.<id>=<value>` for any setting, plus the legacy
// v0.2 parameters a def names in `url` (?g=, ?gm=, ?drone=, ?governor=0). Values found here are
// handed to PrefsStore.setSession; they are never persisted.

import type { Schema, SettingDef } from './schema';

/** A URL string as a typed value for its def, or undefined when it cannot be one. */
export function parseUrlValue(def: SettingDef, raw: string): unknown {
    switch (def.type) {
        case 'bool':
            if (raw === '1' || raw === 'true' || raw === 'on') return true;
            if (raw === '0' || raw === 'false' || raw === 'off') return false;
            return undefined;
        case 'number': {
            const n = raw.trim() === '' ? NaN : Number(raw);
            return Number.isFinite(n) ? n : undefined;
        }
        case 'enum':
            return raw;
        case 'json':
            try {
                return JSON.parse(raw);
            } catch {
                return undefined;
            }
    }
}

export interface UrlSettings { values: { id: string; value: unknown; param: string }[]; unknown: string[]; invalid: string[] }

/**
 * Reads the settings a query string carries (with or without the leading '?'). `set.<id>` wins
 * over a legacy parameter of the same setting. Validation against the def's range is the
 * store's (setSession); this only turns text into the def's type.
 */
export function settingsFromQuery(schema: Schema, query: string): UrlSettings {
    const q = new URLSearchParams(query.startsWith('?') ? query.slice(1) : query);
    const out: UrlSettings = { values: [], unknown: [], invalid: [] };
    const byParam = new Map<string, SettingDef>();
    for (const d of schema.defs) if (d.url !== undefined) byParam.set(d.url, d);
    const taken = new Set<string>();
    for (const [param, raw] of q) {
        if (!param.startsWith('set.')) continue;
        const id = param.slice(4);
        const def = schema.byId.get(id);
        if (!def) {
            out.unknown.push(param);
            continue;
        }
        const v = parseUrlValue(def, raw);
        if (v === undefined) out.invalid.push(param);
        else {
            out.values.push({ id, value: v, param });
            taken.add(id);
        }
    }
    for (const [param, raw] of q) {
        const def = byParam.get(param);
        if (!def || taken.has(def.id)) continue;
        const v = parseUrlValue(def, raw);
        if (v === undefined) out.invalid.push(param);
        else {
            out.values.push({ id: def.id, value: v, param });
            taken.add(def.id);
        }
    }
    return out;
}
