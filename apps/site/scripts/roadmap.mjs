// Prebuild: the roadmap snapshot the landing is built from (src/generated/roadmap.json, not committed).
//   ROADMAP_URL=https://gsfpv.flyreelstudio.eu/api/roadmap   the owner's store as it is now (CI sets it);
//   unset, or that answer is not a usable v1 roadmap:          the seed, apps/api/locales/roadmap-seed.json
//                                                              (store statuses mapped: accepted -> planned)
// The static page shows this snapshot (what search engines read); the Roadmap component then refreshes it
// from /api/roadmap in the visitor's browser. The page parses it with src/lib/roadmap.ts and fails the
// build when nothing is left to show. No network at all unless ROADMAP_URL is set.
// The landing groups done items (features.groups in the site dictionaries); the store does not keep that
// group (lane B's /api/roadmap has none), so a live item without one takes its seed item's group by id.
// ROADMAP_OUT=<file> writes elsewhere (tools/bench/test/site-roadmap.test.ts).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SITE = join(here, "..");
const SEED = join(SITE, "..", "api", "locales", "roadmap-seed.json");
const OUT = process.env.ROADMAP_OUT || join(SITE, "src", "generated", "roadmap.json");
const STORE_TO_PUBLIC = { done: "done", in_progress: "in_progress", accepted: "planned" };
const TIMEOUT_MS = 10000;

/** The seed in the public shape of GET /api/roadmap. */
function fromSeed() {
  const seed = JSON.parse(readFileSync(SEED, "utf8"));
  if (seed?.v !== 1 || !Array.isArray(seed.items)) throw new Error(`roadmap: ${SEED} is not a v1 seed`);
  const items = seed.items
    .filter((it) => it && it.status in STORE_TO_PUBLIC)
    .map((it) => ({ id: it.id, kind: it.kind, status: STORE_TO_PUBLIC[it.status], title: it.title, fromPilot: false, ...(it.group ? { group: it.group } : {}), ...(Number.isFinite(it.order) ? { order: it.order } : {}) }));
  return { v: 1, items };
}

/** Live items without a group take the group of the seed item with the same id (the seeded features). */
function withSeedGroups(doc) {
  const groups = new Map(fromSeed().items.filter((it) => it.group).map((it) => [it.id, it.group]));
  return { ...doc, items: doc.items.map((it) => (it && !it.group && groups.has(it.id) ? { ...it, group: groups.get(it.id) } : it)) };
}

/** A usable answer: a v1 document with at least one item that has a known status and an English title. */
function usable(doc) {
  return doc?.v === 1 && Array.isArray(doc.items) && doc.items.some((it) => it && ["done", "in_progress", "planned"].includes(it.status) && typeof it.title?.en === "string" && it.title.en.trim());
}

async function fromUrl(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { headers: { accept: "application/json" }, signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const doc = await r.json();
    if (!usable(doc)) throw new Error("not a usable v1 roadmap");
    return doc;
  } finally {
    clearTimeout(timer);
  }
}

let snapshot;
const url = process.env.ROADMAP_URL;
if (url) {
  try {
    snapshot = { source: "live", url, at: new Date().toISOString(), roadmap: withSeedGroups(await fromUrl(url)) };
  } catch (e) {
    console.warn(`roadmap: WARNING ${url} gave no usable roadmap (${e instanceof Error ? e.message : String(e)}); building from the seed`);
  }
}
snapshot ??= { source: "seed", at: new Date().toISOString(), roadmap: fromSeed() };
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(snapshot) + "\n");
console.log(`roadmap: ${snapshot.roadmap.items.length} items from the ${snapshot.source === "live" ? snapshot.url : "seed"}`);
