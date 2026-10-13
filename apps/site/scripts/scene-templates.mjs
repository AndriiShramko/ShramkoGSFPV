// Postbuild: the scene page templates for the API (docs/wip/v07-a.md section 4).
//
// `next build` renders /scene-template/<lang>/{scene,index}/ with the landing's own components and words,
// and slots in the text (apps/api/templating.py). This script turns those pages into the API's templates:
//   - every executable <script> and script preload goes (the pages run no JavaScript; CSP script-src 'none'),
//     the JSON-LD block stays; React's comment markers go;
//   - <meta name="gsfpv-head" content="slot"> becomes the raw head slot, <html lang="en"> takes the lang slot;
//   - the slots are checked against apps/api/scene-slots.json (unknown, missing required, raw where not
//     allowed, unbalanced blocks: the build fails), and nothing inline the page's CSP would block is left;
//   - out/scene-templates/ gets <kind>.<lang>.html, phrases.<lang>.json (packages/i18n/locales/scenepage),
//     share.json, drones.json (names from src/generated/features.json) and manifest.json;
//   - the route itself (out/scene-template/) is removed, so no raw template is ever served as a page.
// `node scripts/scene-templates.mjs --check <dir>` only checks an existing scene-templates directory.
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SITE = join(here, "..");
const REPO = join(SITE, "..", "..");
const OUT = join(SITE, "out");
const LOCALES = ["en", "es", "pl", "ru"];
const KINDS = ["scene", "index"];
const SLOTS = JSON.parse(readFileSync(join(REPO, "apps", "api", "scene-slots.json"), "utf8"));
const TOKEN = /\{\{\{([A-Za-z][A-Za-z0-9_]*)\}\}\}|\{\{([A-Za-z][A-Za-z0-9_]*)\}\}|\[\[([#?^/])([A-Za-z][A-Za-z0-9_]*)\]\]/g;
const EXEC_TYPE = /^(|module|importmap|speculationrules|(text|application)\/(x-)?(java|ecma)script)$/i;

/** The page without what a script-free page must not carry. */
export function stripPage(html) {
  let s = html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi, (all, attrs) => {
    const type = (attrs.match(/\stype\s*=\s*["']?([^"'\s>]*)/i)?.[1] ?? "").trim();
    return EXEC_TYPE.test(type) || /\ssrc\s*=/i.test(attrs) ? "" : all;
  });
  s = s.replace(/<link\b[^>]*\brel\s*=\s*["']?(modulepreload|preload)["']?[^>]*\bas\s*=\s*["']?script["']?[^>]*>/gi, "");
  s = s.replace(/<link\b[^>]*\bas\s*=\s*["']?script["']?[^>]*\brel\s*=\s*["']?(modulepreload|preload)["']?[^>]*>/gi, "");
  s = s.replace(/<link\b[^>]*\brel\s*=\s*["']?modulepreload["']?[^>]*>/gi, "");
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(/<meta name="gsfpv-head" content="slot"\s*\/?>/, "{{{head}}}");
  s = s.replace(/<html lang="[a-z-]+"/i, '<html lang="{{lang}}"');
  return s;
}

/** Problems of one template: slots against the contract, scripts and inline code the CSP would block. */
export function checkTemplate(html, kind) {
  const spec = SLOTS.kinds[kind];
  const allowed = new Set(spec.names);
  const raw = new Set(SLOTS.raw);
  const used = new Set();
  const open = [];
  const problems = [];
  for (const m of html.matchAll(TOKEN)) {
    const [, rawName, name, op, block] = m;
    if (rawName) {
      if (!raw.has(rawName)) problems.push(`raw slot not allowed: ${rawName}`);
      used.add(rawName);
    } else if (name) used.add(name);
    else if (op === "/") {
      if (open.pop() !== block) problems.push(`unbalanced [[/${block}]]`);
    } else {
      open.push(block);
      used.add(block);
    }
  }
  if (open.length) problems.push(`never closed: ${open.join(", ")}`);
  for (const n of used) if (!allowed.has(n)) problems.push(`unknown slot: ${n}`);
  for (const n of spec.required) if (!used.has(n)) problems.push(`missing slot: ${n}`);
  if (!html.includes("{{{head}}}")) problems.push("no head slot (the gsfpv-head meta was not found)");
  const scripts = [...html.matchAll(/<script\b([^>]*)>/gi)].filter((m) => !/application\/ld\+json/i.test(m[1]));
  if (scripts.length) problems.push(`executable script left: ${scripts.length}`);
  const markup = html.replace(/<script[\s\S]*?<\/script\s*>/gi, " ");
  if (/<[a-z][^>]*\son[a-z]+\s*=/i.test(markup)) problems.push("inline event handler");
  if (/<[a-z][^>]*\sstyle\s*=/i.test(markup)) problems.push("inline style attribute (CSP style-src 'self')");
  if (/<style\b/i.test(markup)) problems.push("inline <style> element (CSP style-src 'self')");
  if (/\shref\s*=\s*["']?\s*javascript:/i.test(markup)) problems.push("javascript: link");
  return problems;
}

function build() {
  const dest = join(OUT, "scene-templates");
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  const problems = [];
  for (const lang of LOCALES) {
    for (const kind of KINDS) {
      const src = join(OUT, "scene-template", lang, kind, "index.html");
      if (!existsSync(src)) {
        problems.push(`missing ${src}`);
        continue;
      }
      const html = stripPage(readFileSync(src, "utf8"));
      for (const p of checkTemplate(html, kind)) problems.push(`${kind}.${lang}: ${p}`);
      writeFileSync(join(dest, `${kind}.${lang}.html`), html, "utf8");
    }
    copyFileSync(join(REPO, "packages", "i18n", "locales", "scenepage", `${lang}.json`), join(dest, `phrases.${lang}.json`));
  }
  copyFileSync(join(REPO, "packages", "i18n", "locales", "share.json"), join(dest, "share.json"));
  const features = JSON.parse(readFileSync(join(SITE, "src", "generated", "features.json"), "utf8"));
  const names = Object.fromEntries(LOCALES.map((l) => [l, Object.fromEntries((features.locales?.[l]?.drones ?? []).map((d) => [d.id, d.name]))]));
  writeFileSync(join(dest, "drones.json"), JSON.stringify({ default: features.defaultDrone, names }) + "\n", "utf8");
  writeFileSync(join(dest, "manifest.json"), JSON.stringify({ v: SLOTS.v, built: new Date().toISOString(), kinds: KINDS, locales: LOCALES }) + "\n", "utf8");
  rmSync(join(OUT, "scene-template"), { recursive: true, force: true });
  if (problems.length) {
    console.error(["scene-templates: FAIL", ...problems].join("\n"));
    process.exit(1);
  }
  console.log(`scene-templates: OK (${KINDS.length * LOCALES.length} templates in out/scene-templates/)`);
}

function check(dir) {
  const problems = [];
  for (const lang of LOCALES) for (const kind of KINDS) {
    const f = join(dir, `${kind}.${lang}.html`);
    if (!existsSync(f)) problems.push(`missing ${f}`);
    else for (const p of checkTemplate(readFileSync(f, "utf8"), kind)) problems.push(`${kind}.${lang}: ${p}`);
  }
  console.log(problems.length ? ["scene-templates --check: FAIL", ...problems].join("\n") : "scene-templates --check: OK");
  process.exit(problems.length ? 1 : 0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const at = process.argv.indexOf("--check");
  if (at >= 0) check(process.argv[at + 1] ?? join(OUT, "scene-templates"));
  else build();
}
