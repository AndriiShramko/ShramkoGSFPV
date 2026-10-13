/**
 * The landing's roadmap ("What you can set up": Done / In progress / Planned), as data.
 *
 * Source of truth: the owner's ideas store (lane B, apps/api), edited from the admin's Ideas kanban. The
 * page is built from a snapshot of `GET /api/roadmap` (scripts/roadmap.mjs, falling back to the seed
 * apps/api/locales/roadmap-seed.json) and the Roadmap component refreshes it from the same endpoint in the
 * visitor's browser. Both paths go through `parseRoadmap`, so a status or kind this page does not know is
 * dropped the same way at build time and at run time. Both also refuse an answer that misses most of the
 * snapshot's items (`coversSnapshot` here, its twin `coversSeed` in the prebuild): the roadmap only grows,
 * so such an answer comes from a store that was never seeded, not from the owner.
 *
 * Pure module: no DOM, no React, no path aliases (unit-tested in Node: tools/bench/test/site-roadmap.test.ts).
 */

export const ROADMAP_LOCALES = ["en", "es", "pl", "ru"] as const;
export type RoadmapLocale = (typeof ROADMAP_LOCALES)[number];
export type LocalText = Partial<Record<RoadmapLocale, string>>;

/** Public statuses (the store's `accepted` is published as `planned`; `new` and `rejected` never are). */
export const ROADMAP_STATUSES = ["done", "in_progress", "planned"] as const;
export type RoadmapStatus = (typeof ROADMAP_STATUSES)[number];
export const ROADMAP_KINDS = ["feature", "idea", "bug"] as const;
export type RoadmapKind = (typeof ROADMAP_KINDS)[number];

/** One item of `GET /api/roadmap` (docs/wip/v07-plan.md contract; `group` and `order` optional, docs/wip/v07-c.md). */
export interface RoadmapItem {
  id: string;
  kind: RoadmapKind;
  status: RoadmapStatus;
  title: LocalText & { en: string };
  text?: LocalText;
  /** suggested by a pilot (the landing marks it; it never names anyone) */
  fromPilot: boolean;
  /** when it was done (ISO date or time) */
  done?: string;
  /** the release it shipped in (commit sha) */
  release?: string;
  /** the landing group of a done item (keys of the site dictionary's features.groups) */
  group?: string;
  /** position within its column, smaller first */
  order?: number;
}

/** The roadmap document as the API serves it and as the snapshot stores it. */
export interface RoadmapDoc {
  v: 1;
  items: RoadmapItem[];
}

/** An item as one language shows it. */
export interface ViewItem {
  id: string;
  status: RoadmapStatus;
  title: string;
  /** the owner's short public text under the title, when there is one */
  text?: string;
  fromPilot: boolean;
  /** null: not in a known group (shown under "More" when done) */
  group: string | null;
}

/** Counts and the three columns of the board. */
export interface Board {
  counts: Record<RoadmapStatus, number>;
  /** done items by group in the page's group order; a trailing entry with group null holds the rest */
  done: { group: string | null; items: ViewItem[] }[];
  inProgress: ViewItem[];
  planned: ViewItem[];
}

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const GROUP_RE = /^[a-z][a-z0-9-]{0,31}$/;
const RELEASE_RE = /^[0-9a-f]{7,40}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}(T[0-9:.]+Z?)?$/;
/**
 * The longest title and public text the page takes, in characters: lane B's store limits (ideas.TITLE_MAX
 * once raised to the admin's PUBLIC_TITLE_MAX, ideas.PUBLIC_TEXT_MAX). A longer one is not shown (a title
 * without English drops the item), so the store must never send one: docs/wip/v07-c.md.
 */
export const TITLE_MAX = 240;
export const TEXT_MAX = 600;
const ITEMS_MAX = 500;
/** An answer must hold at least this share of the snapshot's ids (coversSnapshot). */
export const KEEP_SHARE = 0.5;

function text(v: unknown, max: number): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  return s && s.length <= max ? s : undefined;
}

function localText(v: unknown, max: number): LocalText | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const out: LocalText = {};
  for (const l of ROADMAP_LOCALES) {
    const s = text((v as Record<string, unknown>)[l], max);
    if (s) out[l] = s;
  }
  return Object.keys(out).length ? out : undefined;
}

const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === "string" && (list as readonly string[]).includes(v);

/** One item, or null when it cannot be shown: unknown status or kind, no id, no English title. */
export function parseItem(raw: unknown): RoadmapItem | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== "string" || !ID_RE.test(o.id)) return null;
  if (!isOneOf(ROADMAP_STATUSES, o.status) || !isOneOf(ROADMAP_KINDS, o.kind)) return null;
  const title = localText(o.title, TITLE_MAX);
  if (!title?.en) return null;
  const item: RoadmapItem = { id: o.id, kind: o.kind, status: o.status, title: { ...title, en: title.en }, fromPilot: o.fromPilot === true };
  const body = localText(o.text, TEXT_MAX);
  if (body) item.text = body;
  if (typeof o.done === "string" && DATE_RE.test(o.done)) item.done = o.done;
  if (typeof o.release === "string" && RELEASE_RE.test(o.release)) item.release = o.release;
  if (typeof o.group === "string" && GROUP_RE.test(o.group)) item.group = o.group;
  if (typeof o.order === "number" && Number.isFinite(o.order)) item.order = o.order;
  return item;
}

/**
 * The items of a roadmap document; null when the document itself is not a v1 roadmap. Items this page
 * cannot show are dropped, a repeated id keeps its first item, at most 500 items are read.
 */
export function parseRoadmap(raw: unknown): RoadmapItem[] | null {
  if (!raw || typeof raw !== "object" || (raw as { v?: unknown }).v !== 1) return null;
  const list = (raw as { items?: unknown }).items;
  if (!Array.isArray(list)) return null;
  const seen = new Set<string>();
  const out: RoadmapItem[] = [];
  for (const r of list.slice(0, ITEMS_MAX)) {
    const it = parseItem(r);
    if (!it || seen.has(it.id)) continue;
    seen.add(it.id);
    out.push(it);
  }
  return out;
}

/**
 * The items in one language, in display order (`order`, then the document's order). An item without a
 * group keeps the group `known` gives its id (the build-time snapshot), so an API that does not echo the
 * optional group does not regroup the seeded items.
 */
export function viewItems(items: readonly RoadmapItem[], locale: string, known: ReadonlyMap<string, string> = new Map()): ViewItem[] {
  const l = (ROADMAP_LOCALES as readonly string[]).includes(locale) ? (locale as RoadmapLocale) : "en";
  return items
    .map((it, i) => ({ it, i }))
    .sort((a, b) => (a.it.order ?? Infinity) - (b.it.order ?? Infinity) || a.i - b.i)
    .map(({ it }) => {
      const text = it.text?.[l] ?? it.text?.en;
      return { id: it.id, status: it.status, title: it.title[l] ?? it.title.en, ...(text ? { text } : {}), fromPilot: it.fromPilot, group: it.group ?? known.get(it.id) ?? null };
    });
}

/** id -> group of the items that have one (what `viewItems` keeps when a later answer lacks it). */
export function groupsOf(items: readonly ViewItem[]): Map<string, string> {
  return new Map(items.filter((v) => v.group !== null).map((v) => [v.id, v.group as string]));
}

/** Where the browser asks for the live roadmap (nginx: location = /api/roadmap, lane B's server). */
export const ROADMAP_ENDPOINT = "/api/roadmap";

/**
 * Whether a live answer is the same roadmap as the snapshot, grown or edited: it holds at least KEEP_SHARE
 * of the snapshot's ids. The roadmap only grows (done items stay done; the owner may hide a few), so an
 * answer without most of them comes from a store that lost or never got the seed, and showing it would
 * wipe the board for every visitor. An empty snapshot accepts anything. Twin: coversSeed in scripts/roadmap.mjs.
 */
export function coversSnapshot(live: readonly { id: string }[], snapshot: readonly { id: string }[]): boolean {
  if (!snapshot.length) return true;
  const have = new Set(live.map((x) => x.id));
  return snapshot.filter((x) => have.has(x.id)).length >= KEEP_SHARE * snapshot.length;
}

/**
 * The live roadmap in one language, or null when the page must keep its snapshot: the request failed or
 * timed out, the answer was not 200, not JSON, not a v1 roadmap, had no item this page can show, or does
 * not cover the snapshot (coversSnapshot). Live items without a group keep the group the snapshot gave
 * their id. `fetchImpl` is injected for tests.
 */
export async function loadLive(fetchImpl: typeof fetch, locale: string, snapshot: readonly ViewItem[], timeoutMs = 8000): Promise<ViewItem[] | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetchImpl(ROADMAP_ENDPOINT, { headers: { accept: "application/json" }, cache: "no-cache", signal: ctl.signal });
    if (r.status !== 200) return null;
    const items = parseRoadmap(await r.json());
    return items && items.length && coversSnapshot(items, snapshot) ? viewItems(items, locale, groupsOf(snapshot)) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** The board: counts, done items by the page's groups (unknown or missing group last), the other two columns. */
export function buildBoard(items: readonly ViewItem[], groupOrder: readonly string[]): Board {
  const counts: Record<RoadmapStatus, number> = { done: 0, in_progress: 0, planned: 0 };
  for (const v of items) counts[v.status]++;
  const known = new Set(groupOrder);
  const done: Board["done"] = groupOrder.map((g) => ({ group: g, items: items.filter((v) => v.status === "done" && v.group === g) }));
  const rest = items.filter((v) => v.status === "done" && !(v.group !== null && known.has(v.group)));
  if (rest.length) done.push({ group: null, items: rest });
  return {
    counts,
    done: done.filter((g) => g.items.length),
    inProgress: items.filter((v) => v.status === "in_progress"),
    planned: items.filter((v) => v.status === "planned"),
  };
}
