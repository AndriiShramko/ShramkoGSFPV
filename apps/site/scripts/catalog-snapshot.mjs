// Prebuild: a snapshot of the published scene catalogue for the landing (docs/wip/v07-a.md section 2).
// GET <CATALOG_URL, default the live site's /api/catalog> with a 4 s timeout; a well-formed answer replaces
// src/generated/catalog.json, anything else (offline, an error, a wrong shape) keeps the committed file, so
// a build never fails for the network. The landing renders the snapshot (crawlers and visitors without
// JavaScript see every card) and refreshes it from /api/catalog in the browser (components/CatalogGrid.tsx,
// which validates both with @gsfpv/scenes readCatalog). Written with \u escapes: the repository keeps
// non-English letters inside locales/ only (check B18), and scene titles come in every language.
//   node scripts/catalog-snapshot.mjs            fetch, then write or keep
//   node scripts/catalog-snapshot.mjs --offline  keep the committed file (prints what it holds)
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const FILE = join(here, "..", "src", "generated", "catalog.json");
const URL_ = process.env.CATALOG_URL || "https://gsfpv.flyreelstudio.eu/api/catalog";
const ID = /^[0-9a-f]{6,32}$/;

/** The parts of a catalogue answer the landing keeps, or null when it is not one. */
export function snapshotOf(doc) {
  if (!doc || typeof doc !== "object" || !Array.isArray(doc.scenes) || doc.scenes.length === 0) return null;
  if (!doc.scenes.every((s) => s && typeof s === "object" && typeof s.id === "string" && ID.test(s.id) && typeof s.title === "string")) return null;
  return {
    source: URL_,
    published: typeof doc.published === "string" ? doc.published : null,
    collections: Array.isArray(doc.collections) ? doc.collections : [],
    scenes: doc.scenes.filter((s) => s.hidden !== true),
  };
}

/** JSON with every character outside printable ASCII written as a \u escape (the same data). */
export function asciiJson(v) {
  return JSON.stringify(v, null, 1).replace(/[^\x20-\x7e\n]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0")) + "\n";
}

async function main() {
  const old = (() => {
    try {
      return JSON.parse(readFileSync(FILE, "utf8"));
    } catch {
      return null;
    }
  })();
  if (process.argv.includes("--offline")) {
    console.log(`catalog-snapshot: kept (${old?.scenes?.length ?? 0} scenes, published ${old?.published ?? "?"})`);
    return;
  }
  let snap = null;
  try {
    const r = await fetch(URL_, { signal: AbortSignal.timeout(4000), headers: { Accept: "application/json" } });
    snap = r.ok ? snapshotOf(await r.json()) : null;
  } catch {
    snap = null;
  }
  if (!snap) {
    console.log(`catalog-snapshot: ${URL_} gave no catalogue; kept the committed one (${old?.scenes?.length ?? 0} scenes)`);
    return;
  }
  writeFileSync(FILE, asciiJson(snap), "utf8");
  console.log(`catalog-snapshot: ${snap.scenes.length} scenes, published ${snap.published}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
