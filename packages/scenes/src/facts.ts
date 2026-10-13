// SuperSplat's facts of one scene as the admin receives them (GET /api/admin/superspl/<id>,
// apps/api/superspl_facts.py) and how they go into a catalogue entry: "Add a scene" takes them all,
// "Refresh from SuperSplat" lists what differs and applies the fields the owner ticks. Pure, no DOM:
// the admin page (apps/fly/src/admin/) draws it, the tests run it in Node.
import { readScene } from './catalog';
import type { CatalogScene } from './catalog';

/** The catalogue fields SuperSplat's facts can fill, in the order the admin lists them. */
export const FACT_FIELDS = ['title', 'author', 'license', 'thumb', 'version', 'format', 'sizeMb', 'collision', 'voxelCm', 'extentM', 'origin'] as const;
export type FactField = (typeof FACT_FIELDS)[number];

/**
 * The server's answer, validated: only fields readScene keeps, so nothing malformed reaches the draft.
 * (Not the library's SceneFacts: that is the title, author and licence a picker listing showed a pilot.)
 */
export interface SuperSplatFacts {
    id: string;
    facts: Partial<Pick<CatalogScene, FactField>>;
    /** the collision file: true / false, or null when the CDN did not answer (walls left as they are) */
    walkable: boolean | null;
    fetchedAt: string;
}

/** One field that differs between the entry and SuperSplat's facts. */
export interface FactChange {
    field: FactField;
    from: unknown;
    to: unknown;
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** The answer of /api/admin/superspl/<id>, or null when it is not one (the shapes as readScene's). */
export function readFacts(doc: unknown): SuperSplatFacts | null {
    if (!doc || typeof doc !== 'object') return null;
    const d = doc as Record<string, unknown>;
    if (d.ok !== true || !d.facts || typeof d.facts !== 'object') return null;
    const raw = d.facts as Record<string, unknown>;
    const s = readScene({ ...raw, id: d.id });
    if (!s) return null;
    const facts: Partial<Pick<CatalogScene, FactField>> = {};
    for (const f of FACT_FIELDS) {
        if (f === 'collision') {
            if (typeof raw.collision === 'boolean') facts.collision = raw.collision;
        } else if (s[f] !== undefined) (facts as Record<string, unknown>)[f] = s[f];
    }
    return { id: s.id, facts, walkable: typeof d.walkable === 'boolean' ? d.walkable : null, fetchedAt: typeof d.fetchedAt === 'string' ? d.fetchedAt : '' };
}

/** What a refresh would change: the fields SuperSplat states and the entry holds differently. */
export function factChanges(entry: CatalogScene, f: SuperSplatFacts): FactChange[] {
    const out: FactChange[] = [];
    for (const field of FACT_FIELDS) {
        if (!(field in f.facts)) continue;
        const to = f.facts[field];
        const from = entry[field];
        if (!same(from, to)) out.push({ field, from, to });
    }
    return out;
}

/** The entry with the chosen fields taken from SuperSplat's facts (a copy; the rest of the entry kept). */
export function applyFacts(entry: CatalogScene, f: SuperSplatFacts, fields: readonly FactField[]): CatalogScene {
    const out = { ...entry } as Record<string, unknown>;
    for (const field of fields) if (field in f.facts) out[field] = structuredClone(f.facts[field]);
    return out as unknown as CatalogScene;
}

/** A new catalogue entry from the facts ("Add a scene"): SuperSplat's words, kind left to the owner. */
export function entryFromFacts(f: SuperSplatFacts): CatalogScene {
    return applyFacts({ id: f.id, title: f.facts.title ?? f.id, author: '', license: '', kind: 'other', collision: f.walkable !== false }, f, FACT_FIELDS);
}
