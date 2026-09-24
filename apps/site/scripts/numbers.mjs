// Prebuild: copy the published measurements from the repo's evidence/latest.json into
// src/generated/numbers.json. The "Live numbers" block renders ONLY from that file.
// Any missing key or field fails the build, so CI can never ship a landing whose numbers
// are not backed by evidence.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SITE = join(here, "..");
const SRC = join(SITE, "..", "..", "evidence", "latest.json");
const OUT = join(SITE, "src", "generated", "numbers.json");

// Fields every item must carry, plus extra fields per key.
const REQUIRED = {
  ratesVectors: ["value", "method", "date"],
  tunnelling: ["value", "method", "date"],
  clearance: ["value", "method", "date"],
  latency: ["status", "value", "method", "date", "outputHz", "medianMs", "p95Ms", "blankPageFloorMs", "conditions", "cameraMeasured"],
};

function fail(msg) {
  console.error(`numbers: FAIL — ${msg}`);
  process.exit(1);
}

let raw;
try {
  raw = JSON.parse(readFileSync(SRC, "utf8"));
} catch (e) {
  fail(`cannot read ${SRC}: ${e instanceof Error ? e.message : String(e)}`);
}

const items = raw?.items;
if (!items || typeof items !== "object") fail("evidence/latest.json has no 'items' object");

const out = { updated: String(raw.updated ?? ""), items: {} };
for (const [key, fields] of Object.entries(REQUIRED)) {
  const item = items[key];
  if (!item || typeof item !== "object") fail(`missing key '${key}'`);
  for (const f of fields) {
    const v = item[f];
    if (v === undefined || v === null || (typeof v === "string" && v.trim() === "")) fail(`key '${key}' has no '${f}'`);
  }
  out.items[key] = { ...item };
}

// Display refresh rate quoted in the latency value ("... runs at 30 Hz"), if present.
const hz = /(\d+(?:\.\d+)?)\s*Hz/i.exec(String(items.latency.value));
out.items.latency.displayHz = hz ? Number(hz[1]) : null;

if (!out.updated) fail("evidence/latest.json has no 'updated' timestamp");

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n", "utf8");
console.log(`numbers: ${Object.keys(out.items).length} items from evidence/latest.json (updated ${out.updated})`);
