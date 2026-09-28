// The URL part of the session layer (A.6): `?set.<id>=<value>` for any setting, plus the legacy
// parameters a def names in `url` (v0.2's ?g=, ?gm=, ?drone=, ?governor=0; main's ?guard=0 and its
// this-load-only test switches ?walls=, ?voxels=, ?vstyle=, ?vradius=). Values found here are
// handed to PrefsStore.setSession; they are never persisted.

import type { Schema, SettingDef } from './schema';

const BOT = 'test: the bot pilot\'s plan (?simradio=scenario|open)';
const SIM_RADIO = 'test: the simulated EdgeTX radio (?simradio=raw)';

/**
 * Every other query parameter the fly app reads (apps/fly/src/main.ts), with why it is not a
 * setting: a test or harness switch, a capture mode, or navigation. The settings' own parameters
 * are their defs' `url` (?g= ?gm= ?drone= ?governor= ?guard= ?walls= ?voxels= ?vstyle= ?vradius=).
 * A test scans main.ts: a parameter that is neither fails it, so a new one is classified on purpose.
 */
export const APP_URL_PARAMS_NOT_SETTINGS: Readonly<Record<string, string>> = {
    scene: 'navigation: which scan to open; the scans flown live in the scene library, not in a setting',
    simradio: 'test: the bot pilot or a simulated radio flies instead of a person',
    lat: 'test: the stick-to-photon latency harness (tools/latency)',
    lagFrames: 'test: extra frames of delay, the latency harness control',
    nonce: 'test: the latency harness run id in the page title',
    nowarn: 'test: benches skip the first-visit warning (a pilot\'s own answer is the ui collection)',
    input: 'test: force the touch sticks on a desktop (?input=touch)',
    scale: 'test: a fixed render scale for benches and screenshots (the pilot\'s control is display.quality)',
    refine: 'test: finer walls by the plan, only on request, or never (bench modes of walls.ts)',
    bake: 'test: build walls at once for a scan without them (phase C bench)',
    vopacity: 'test: main applies it to the view given with ?voxels= (voxels.opacity or voxels.opacityOnly); one parameter per setting cannot say which',
    clean: 'capture: the flight view and the OSD only, for recording the landing video',
    render: 'test: ?render=off, the logic-only mode for machines without a GPU (the cloud): the scan is never downloaded or drawn, the walls, flight model, input, HUD and crash handling run; never a visual or latency check',
    tour: BOT, dash: BOT, quick: BOT, flip: BOT, loop: BOT,
    order: SIM_RADIO, inv: SIM_RADIO, offset: SIM_RADIO, noise: SIM_RADIO, armch: SIM_RADIO, rate: SIM_RADIO, broken: SIM_RADIO, react: SIM_RADIO, human: SIM_RADIO, nobuttons: SIM_RADIO
};

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
