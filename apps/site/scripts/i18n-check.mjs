// Dictionary check (site/ and scenepage/): same keys and ICU placeholders in every locale, and no ES/PL/RU string left
// identical to English except brand names, technical terms, units and URLs (ALLOW below).
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
// the landing (site/) and the scene pages (scenepage/: the template words and the API's sentences)
const DIRS = ["site", "scenepage"].map((d) => join(here, "..", "..", "..", "packages", "i18n", "locales", d));
const LOCALES = ["en", "es", "pl", "ru"];
const ALLOW = new Set([
  "ShramkoGSFPV", "PlayCanvas", "PlayCanvas Engine", "Rapier", "Betaflight", "SplatFPV", "MIT", "Apache-2.0", "GPL-3.0",
  "LAVA 1104 7200KV", ">5:1", "Gamepad API", "Safari, iPad, Android", "Firefox", "fdlibm / musl", "ms", "Hz",
  // settings catalogue (tune.text): SI unit symbols and video resolutions
  "s", "m", "m/s", "m/s²", "min", "1/s", "1080p", "1440p", "2160p (4K)",
  "https://superspl.at/scene/…", "Betaflight, Actual, KISS, Raceflight", "≈ 45 g",
  // scene scale factors (scale.stops)
  "×1", "×10", "×100",
  // scene pages: a date pattern, not words (scenepage gen.date)
  "{d} {month} {y}",
]);

const flat = (o, p = "", out = {}) => {
  if (typeof o === "string") out[p] = o;
  else if (Array.isArray(o)) o.forEach((v, i) => flat(v, `${p}[${i}]`, out));
  else if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) flat(v, p ? `${p}.${k}` : k, out);
  return out;
};
const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

let problems = 0;
let strings = 0;
for (const DIR of DIRS) {
const dict = Object.fromEntries(LOCALES.map((l) => [l, flat(JSON.parse(readFileSync(join(DIR, `${l}.json`), "utf8")))]));
const en = dict.en;
strings += Object.keys(en).length;
for (const l of LOCALES.slice(1)) {
  const d = dict[l];
  for (const k of Object.keys(en)) {
    if (!(k in d)) {
      console.log(`${l}: missing ${k}`);
      problems++;
      continue;
    }
    if (placeholders(en[k]) !== placeholders(d[k])) {
      console.log(`${l}: placeholder mismatch at ${k}`);
      problems++;
    }
    const technical = /(^|\.)(href|src|level)$/.test(k) || /\.license$/.test(k);
    if (!technical && d[k] === en[k] && !ALLOW.has(en[k])) {
      console.log(`${l}: identical to EN at ${k}: ${JSON.stringify(en[k])}`);
      problems++;
    }
  }
  for (const k of Object.keys(d)) if (!(k in en)) {
    console.log(`${l}: extra key ${k}`);
    problems++;
  }
}
// TODO/PLACEHOLDER are matched case-sensitively: Spanish "todo" / "Método" are ordinary words.
const bad = /\b(lorem|undefined)\b|Liftoff-level|like Liftoff|SuperSplat FPV|\bofficial\b/i;
const badCase = /TODO|PLACEHOLDER/;
for (const l of LOCALES) for (const [k, v] of Object.entries(dict[l])) if (bad.test(v) || badCase.test(v)) {
  console.log(`${l}: forbidden phrase at ${k}: ${v}`);
  problems++;
}
}
// supporters (docs/wip/supporters.md): every person has the four languages with the same fields and the
// same number of offer lines, a unique slug, a known status and language, and a photo file that exists
{
  const PEOPLE = join(here, "..", "..", "..", "packages", "i18n", "locales", "supporters", "people.json");
  const people = JSON.parse(readFileSync(PEOPLE, "utf8")).people;
  const bad = /\b(lorem|undefined)\b|Liftoff-level|like Liftoff|SuperSplat FPV|\bofficial\b/i;
  const badCase = /TODO|PLACEHOLDER/;
  const seen = new Set();
  for (const p of people) {
    const who = `supporters/${p.slug}`;
    const fail = (m) => {
      console.log(`${who}: ${m}`);
      problems++;
    };
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(p.slug ?? "")) fail("slug is not kebab-case ASCII");
    if (seen.has(p.slug)) fail("slug repeats");
    seen.add(p.slug);
    if (!["invited", "joined"].includes(p.status)) fail(`status ${p.status}`);
    if (!LOCALES.includes(p.lang)) fail(`lang ${p.lang}`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.since ?? "")) fail("since is not YYYY-MM-DD");
    if (!p.name?.trim()) fail("no name");
    if (!/^\/media\/supporters\/[a-z0-9-]+\.(webp|jpg|png)$/.test(p.photo ?? "") || !existsSync(join(here, "..", "public", p.photo))) fail(`photo ${p.photo} missing`);
    if (!p.links?.length || p.links.some((l) => !/^https:\/\//.test(l.href) || !l.label)) fail("links need a label and an https address");
    for (const w of p.works ?? []) if (!/^https:\/\//.test(w.href) || !w.title || !/^\d{4}-\d{2}-\d{2}$/.test(w.date)) fail(`work ${w.title}: href, title, date YYYY-MM-DD`);
    if (p.scene !== undefined && !/^[0-9a-f]{6,32}$/.test(p.scene)) fail(`scene ${p.scene}`);
    if (p.scene !== undefined && !p.sceneCredit?.trim()) fail("a scene needs its credit (title, author, licence)");
    if (p.review && (!/^https:\/\//.test(p.review.href) || !["video", "post"].includes(p.review.kind) || !p.review.title || !p.review.platform)) fail("review needs kind, https href, title, platform");
    if (p.status === "joined" && !p.review) fail("joined without a review");
    for (const l of LOCALES) {
      const x = p.text?.[l];
      if (!x) {
        fail(`no text in ${l}`);
        continue;
      }
      for (const f of ["role", "about", "why"]) if (!x[f]?.trim()) fail(`${l}: empty ${f}`);
      if (!Array.isArray(x.offer) || x.offer.length !== p.text.en.offer.length) fail(`${l}: offer lines differ from en`);
      if (l !== "en" && x.about === p.text.en.about) fail(`${l}: about identical to en`);
      for (const v of [x.role, x.about, x.why, ...(x.offer ?? [])]) if (bad.test(v ?? "") || badCase.test(v ?? "")) fail(`${l}: forbidden phrase: ${v}`);
    }
  }
  strings += people.length;
}
console.log(problems ? `i18n-check: ${problems} problem(s)` : `i18n-check: OK (${strings} strings x ${LOCALES.length} locales, ${DIRS.length} dictionaries)`);
process.exit(problems ? 1 : 0);
