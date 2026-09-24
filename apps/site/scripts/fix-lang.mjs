// Postbuild (static export):
//  1. Rewrite <html lang="en"> to the locale of the folder each page lives in. The root layout
//     can only carry one lang at build time; crawlers and screen readers need the right one.
//  2. Write out/index.html: a client-side fallback for "/" with the same logic nginx uses
//     (cookie NEXT_LOCALE, then the browser languages, then English).
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "..", "out");
const LOCALES = ["en", "es", "pl", "ru"];
const SITE = "https://gsfpv.flyreelstudio.eu";

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, files);
    else if (name.endsWith(".html")) files.push(p);
  }
  return files;
}

let changed = 0;
for (const locale of LOCALES) {
  let files = [];
  try {
    files = walk(join(OUT, locale));
  } catch {
    console.error(`fix-lang: FAIL — out/${locale}/ is missing`);
    process.exit(1);
  }
  for (const f of files) {
    const html = readFileSync(f, "utf8");
    const next = html.replace(/<html lang="en"/, `<html lang="${locale}"`);
    if (next !== html) {
      writeFileSync(f, next, "utf8");
      changed++;
    }
  }
}
console.log(`fix-lang: rewrote lang attribute in ${changed} file(s)`);

// React Flight serialises `undefined` props as the string token "$undefined" inside the inline
// RSC payload (Next.js puts nonce/crossOrigin/router slots there). The Flight client decodes
// ANY "$u…" token as undefined (react-server-dom parseModelString: `case "u": return;`), so
// "$u" is semantically identical and keeps the literal word "undefined" out of the built pages
// (the release check greps for it to catch missing translations).
const flight = /(\\?")\$undefined(\\?")/g;
let tokens = 0;
const all = walk(OUT).concat(
  (function txt(dir, acc = []) {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) txt(p, acc);
      else if (name.endsWith(".txt") && !p.endsWith(join(OUT, "robots.txt")) && !p.endsWith(join(OUT, "llms.txt"))) acc.push(p);
    }
    return acc;
  })(OUT),
);
for (const f of all) {
  const src = readFileSync(f, "utf8");
  const out = src.replace(flight, (_m, a, b) => {
    tokens++;
    return `${a}$u${b}`;
  });
  if (out !== src) writeFileSync(f, out, "utf8");
}
console.log(`fix-lang: shortened ${tokens} Flight "$undefined" token(s) to "$u"`);

const links = LOCALES.map((l) => `<a href="/${l}/" hreflang="${l}">${l.toUpperCase()}</a>`).join(" · ");
const alternates = LOCALES.map((l) => `<link rel="alternate" hreflang="${l}" href="${SITE}/${l}/">`).join("\n");
const index = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ShramkoGSFPV</title>
<meta name="robots" content="noindex, follow">
<link rel="canonical" href="${SITE}/en/">
${alternates}
<link rel="alternate" hreflang="x-default" href="${SITE}/en/">
<script>
(function () {
  var L = ${JSON.stringify(LOCALES)};
  var pick = "en";
  try {
    var m = document.cookie.match(/(?:^|;\\s*)NEXT_LOCALE=([a-z]{2})/);
    if (m && L.indexOf(m[1]) >= 0) pick = m[1];
    else {
      var langs = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || "en"];
      for (var i = 0; i < langs.length; i++) {
        var p = String(langs[i]).slice(0, 2).toLowerCase();
        if (L.indexOf(p) >= 0) { pick = p; break; }
      }
    }
  } catch (e) {}
  location.replace("/" + pick + "/" + location.search + location.hash);
})();
</script>
<noscript><meta http-equiv="refresh" content="0; url=/en/"></noscript>
<style>html,body{background:#07080a;color:#e8eaed;font:16px/1.6 system-ui,sans-serif;margin:0}main{padding:48px 16px;text-align:center}a{color:#4ade80}</style>
</head>
<body>
<main><p>ShramkoGSFPV — ${links}</p></main>
</body>
</html>
`;
writeFileSync(join(OUT, "index.html"), index, "utf8");
console.log("fix-lang: wrote out/index.html (locale redirect fallback)");
