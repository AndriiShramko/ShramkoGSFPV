// The settings screen's logic without the DOM (docs/architecture-v03.md A.9): which settings it
// shows, in which groups, what a search finds, where a deep link's ?focus= lands, how a value and
// its unit read, and what an import preview says. Generated from the prefs schema: a setting
// another agent ships appears here by its status alone, with no code of its own (W2-1's rule).
// Node tests: tools/bench/test/app-settings.test.ts.
import type { GroupId, ImportReport, Schema, SettingDef, Unit } from '@gsfpv/prefs';

/** The rail's entries: the schema's groups that have a shipped setting, then Data. */
export type RailId = GroupId | 'data';

/** Every setting the screen shows: the shipped ones (planned ones are stored, never shown; A.2). */
export function shownDefs(schema: Schema): SettingDef[] {
    return schema.defs.filter((d) => d.status === 'shipped');
}

/** The groups with something to show, in the schema's order (the rail, the accordion). */
export function shownGroups(schema: Schema): GroupId[] {
    const has = new Set(shownDefs(schema).map((d) => d.group));
    return schema.groups.filter((g) => has.has(g));
}

/** The texts a setting is found by (the screen passes them in its language). */
export interface DefTexts {
    label(def: SettingDef): string;
    help(def: SettingDef): string;
    option(def: SettingDef, o: string): string;
}

/** Lower case, accents gone (é -> e), one space between words: "Kąt" finds "kat", "FOV" finds "fov". */
export function fold(s: string): string {
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** What a search reads of a setting: its id, label, help and option names. */
export function searchText(def: SettingDef, tx: DefTexts): string {
    const opts = def.type === 'enum' ? def.options.map((o) => tx.option(def, o)).join(' ') : '';
    return fold(`${def.id} ${tx.label(def)} ${tx.help(def)} ${opts}`);
}

/** Every word of the query is somewhere in the setting's texts (an empty query finds everything). */
export function matches(def: SettingDef, query: string, tx: DefTexts): boolean {
    const words = fold(query).split(' ').filter(Boolean);
    if (!words.length) return true;
    const text = searchText(def, tx);
    return words.every((w) => text.includes(w));
}

export type FocusTarget =
    | { kind: 'row'; id: string; group: GroupId }
    | { kind: 'planned'; id: string }
    | { kind: 'unknown'; id: string };

/**
 * Where ?focus=<id> lands: the row of a shown setting and its group; a setting this version has
 * but does not show yet; or no such setting. The screen opens in every case and says which.
 */
export function focusTarget(schema: Schema, id: string): FocusTarget {
    const d = schema.byId.get(id);
    if (!d) return { kind: 'unknown', id };
    if (d.status !== 'shipped') return { kind: 'planned', id };
    return { kind: 'row', id, group: d.group };
}

/** Unit symbols, as the catalogue writes them (packages/prefs catalog.ts): language-neutral. */
const UNIT: Readonly<Record<Unit, string>> = {
    deg: '°', ms: 'ms', s: 's', m: 'm', mps: 'm/s', mps2: 'm/s²', x: '×', pct: '%', per_s: '1/s', blocks: '', min: 'min'
};

export function unitSymbol(u: Unit | undefined): string {
    return u === undefined ? '' : UNIT[u];
}

/** Decimals a step needs: 1 -> 0, 0.5 -> 1, 0.05 -> 2, 0.01 -> 2. */
export function decimalsOf(step: number): number {
    if (!(step > 0) || !Number.isFinite(step)) return 0;
    let d = 0;
    while (d < 6 && Math.abs(Math.round(step * 10 ** d) - step * 10 ** d) > 1e-9) d++;
    return d;
}

/** A number as its row shows it: the step's decimals, no trailing zeros ("9.81", "4", "0.55"). */
export function formatNumber(v: number, step: number): string {
    if (!Number.isFinite(v)) return '—';
    return String(Number(v.toFixed(decimalsOf(step))));
}

/** A number as a slider position and back: log sliders (def.curve 'log') move evenly in ratio. */
export function toSlider(v: number, min: number, max: number, log: boolean): number {
    if (!log || !(min > 0)) return v;
    return (Math.log(v / min) / Math.log(max / min)) * 1000;
}
export function fromSlider(p: number, min: number, max: number, log: boolean): number {
    if (!log || !(min > 0)) return p;
    return min * (max / min) ** (p / 1000);
}

/** Snaps a typed or dragged number onto the def's grid and range. */
export function snap(v: number, min: number, max: number, step: number): number {
    const c = v < min ? min : v > max ? max : v;
    const k = Math.round((c - min) / step);
    return Number((min + k * step).toFixed(decimalsOf(step)));
}

/** The lines an import preview shows (A.4: "12 settings, 1 radio, 3 favourites will change"). */
export interface ImportSummary {
    ok: boolean;
    error: ImportReport['error'] | null;
    settings: number;
    radios: { added: number; changed: number };
    scenes: { added: number; changed: number };
    other: number;
    clamped: readonly string[];
    dropped: readonly string[];
    unknown: readonly string[];
    /** nothing would change */
    empty: boolean;
}

export function importSummary(r: ImportReport): ImportSummary {
    const c = r.collections;
    const other = c.stats.added + c.stats.changed + c.ui.added + c.ui.changed;
    const s: ImportSummary = {
        ok: r.ok,
        error: r.error ?? null,
        settings: r.changes.length,
        radios: { ...c.radioProfiles },
        scenes: { ...c.sceneLibrary },
        other,
        clamped: [...r.clamped],
        dropped: r.dropped.map((d) => d.id),
        unknown: [...r.unknown],
        empty: false
    };
    s.empty = r.ok && s.settings === 0 && s.radios.added + s.radios.changed + s.scenes.added + s.scenes.changed + other === 0;
    return s;
}
