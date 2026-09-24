// Dictionary check: same keys and ICU placeholders in every locale, and no ES/PL/RU string left
// identical to English except brand names, technical terms, units and URLs (ALLOW below).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const DIR = join(here, "..", "..", "..", "packages", "i18n", "locales", "site");
const LOCALES = ["en", "es", "pl", "ru"];
const ALLOW = new Set([
  "ShramkoGSFPV", "PlayCanvas", "PlayCanvas Engine", "Rapier", "Betaflight", "SplatFPV", "MIT", "Apache-2.0", "GPL-3.0",
  "LAVA 1104 7200KV", ">5:1", "Gamepad API", "Safari, iPad, Android", "Firefox", "fdlibm / musl", "ms", "Hz",
  "https://superspl.at/scene/…", "Betaflight, Actual, KISS, Raceflight", "≈ 45 g",
]);

const flat = (o, p = "", out = {}) => {
  if (typeof o === "string") out[p] = o;
  else if (Array.isArray(o)) o.forEach((v, i) => flat(v, `${p}[${i}]`, out));
  else if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) flat(v, p ? `${p}.${k}` : k, out);
  return out;
};
const dict = Object.fromEntries(LOCALES.map((l) => [l, flat(JSON.parse(readFileSync(join(DIR, `${l}.json`), "utf8")))]));
const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

let problems = 0;
const en = dict.en;
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
console.log(problems ? `i18n-check: ${problems} problem(s)` : `i18n-check: OK (${Object.keys(en).length} strings x ${LOCALES.length} locales)`);
process.exit(problems ? 1 : 0);
