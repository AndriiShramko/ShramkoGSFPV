// End-to-end check of the built site. Needs a server on BASE serving a copy of out/
// (node scripts/serve.mjs 8138). Uses system Chrome through Playwright.
//   BASE=http://127.0.0.1:8138 node scripts/verify.mjs
// Static checks (files, lang, canonical, hreflang, JSON-LD, forbidden words) + browser checks
// (screenshots, overflow at 375 px, every language switcher, copy button, lead form against a
// mocked /api/lead, scene paste, whitelisted beacons, no Google requests without GA id) + the
// screenshots (files and byte caps, captions in 4 languages, parallax moves and stands still for
// reduced motion, no layout shift while scrolling, the gallery works from the keyboard).
import { chromium } from "playwright";
// system Chrome, or the bundled Chromium where there is none (the cloud); tools/bench/README.md
import { describeBrowser, pickBrowser } from "../../../tools/bench/src/chrome.mjs";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SITE_DIR = join(here, "..");
const OUT = join(SITE_DIR, "out");
const SHOTS = join(SITE_DIR, ".shots");
const BASE = process.env.BASE ?? "http://127.0.0.1:8138";
const ORIGIN = "https://gsfpv.flyreelstudio.eu";
const LOCALES = ["en", "es", "pl", "ru"];
const PAGES = ["", "privacy/", "licenses/"];
const DICT = Object.fromEntries(LOCALES.map((l) => [l, JSON.parse(readFileSync(join(SITE_DIR, "..", "..", "packages", "i18n", "locales", "site", `${l}.json`), "utf8"))]));
const PROMPT = "Set up ShramkoGSFPV for me by following https://github.com/AndriiShramko/ShramkoGSFPV/blob/main/AGENT_SETUP.md exactly. Install, run the checks, start the simulator locally and open it in Chrome. Do not change any system settings; ask me only if a step needs my password or a physical action.";

const results = [];
const ok = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};

// ---------- static ----------
for (const f of ["sitemap.xml", "robots.txt", "llms.txt", "og.png", "index.html", "404.html", "icon.svg"]) ok(`out/${f} exists`, existsSync(join(OUT, f)));
const htmlFiles = [];
for (const l of LOCALES) for (const p of PAGES) {
  const f = join(OUT, l, p, "index.html");
  ok(`out/${l}/${p}index.html exists`, existsSync(f));
  if (!existsSync(f)) continue;
  htmlFiles.push(f);
  const html = readFileSync(f, "utf8");
  ok(`${l}/${p} <html lang="${l}">`, html.includes(`<html lang="${l}"`));
  const canon = `${ORIGIN}/${l}/${p}`;
  ok(`${l}/${p} canonical`, html.includes(`<link rel="canonical" href="${canon}"/>`), canon);
  const alts = [...html.matchAll(/<link rel="alternate" hrefLang="([^"]+)" href="([^"]+)"\/>/g)].map((m) => `${m[1]}=${m[2]}`);
  const want = [...LOCALES.map((x) => `${x}=${ORIGIN}/${x}/${p}`), `x-default=${ORIGIN}/en/${p}`];
  ok(`${l}/${p} hreflang 4+1`, want.every((w) => alts.includes(w)) && alts.length === 5, alts.join(" "));
  const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  let parsed = 0;
  let types = [];
  for (const j of ld) {
    try {
      const o = JSON.parse(j);
      parsed++;
      types = types.concat((o["@graph"] ?? [o]).map((n) => n["@type"]));
    } catch {
      /* counted below */
    }
  }
  const wantTypes = p === "" ? ["SoftwareApplication", "FAQPage"] : ["SoftwareApplication"];
  ok(`${l}/${p} JSON-LD parses`, ld.length > 0 && parsed === ld.length && wantTypes.every((t) => types.includes(t)), types.join(","));
  ok(`${l}/${p} og:image`, html.includes(`property="og:image" content="${ORIGIN}/og.png"`));
}
const forbidden = /undefined|TODO|PLACEHOLDER|lorem|Liftoff-level|like Liftoff/;
const walk = (d, acc = []) => {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (n.endsWith(".html") || n.endsWith(".txt") || n.endsWith(".xml")) acc.push(p);
  }
  return acc;
};
const hits = walk(OUT).flatMap((f) => {
  const m = readFileSync(f, "utf8").match(new RegExp(forbidden.source, "g"));
  return m ? [`${f.slice(OUT.length)}: ${[...new Set(m)].join(",")}`] : [];
});
ok("built HTML/TXT/XML free of undefined|TODO|PLACEHOLDER|lorem|Liftoff-level|like Liftoff", hits.length === 0, hits.join("; "));
const sitemap = readFileSync(join(OUT, "sitemap.xml"), "utf8");
ok("sitemap lists 12 pages", (sitemap.match(/<loc>/g) ?? []).length === 12);
const robots = readFileSync(join(OUT, "robots.txt"), "utf8");
ok("robots allows AI crawlers + sitemap", ["GPTBot", "ClaudeBot", "PerplexityBot", "Google-Extended"].every((b) => robots.includes(`User-agent: ${b}`)) && robots.includes("Sitemap: https://gsfpv.flyreelstudio.eu/sitemap.xml"));

// screenshots (src/config/shots.json, written by tools/bench/src/screens.ts)
const SHOT_MANIFEST = JSON.parse(readFileSync(join(SITE_DIR, "src", "config", "shots.json"), "utf8"));
const DOCS = join(SITE_DIR, "..", "..", "docs", "screenshots");
{
  const bad = [];
  let panels = 0;
  for (const it of SHOT_MANIFEST.items) {
    // the whole screen, and the menu crop ("panel") when the shot has one
    const sets = [["", it, `${it.id}.webp`], ...(it.panel ? [["panel ", it.panel, `${it.id}-panel.webp`]] : [])];
    if (it.panel) panels++;
    for (const [label, set, docName] of sets) {
      for (const [v, cap] of [["large", 250 * 1024], ["small", 100 * 1024]]) {
        const f = join(OUT, set[v].src);
        if (!existsSync(f)) bad.push(`${label}${set[v].src} missing`);
        else if (statSync(f).size > cap) bad.push(`${label}${set[v].src} ${statSync(f).size} B > ${cap}`);
        else if (statSync(f).size !== set[v].bytes) bad.push(`${label}${set[v].src} size differs from the manifest`);
        if (set[v].w > (v === "large" ? 1600 : 800)) bad.push(`${label}${set[v].src} ${set[v].w} px wide`);
      }
      const doc = join(DOCS, docName);
      if (!existsSync(doc) || !readFileSync(doc).equals(readFileSync(join(OUT, set.large.src)))) bad.push(`docs/screenshots/${docName} missing or not the large file`);
    }
    for (const l of LOCALES) if (!DICT[l].shots?.items?.[it.id]?.t || !DICT[l].shots?.items?.[it.id]?.d) bad.push(`${l}: no caption for ${it.id}`);
  }
  ok(`screenshots: ${SHOT_MANIFEST.items.length} shots (${panels} with a menu crop), files present, <= 250 KB / 100 KB, docs copies, captions in 4 languages`, SHOT_MANIFEST.items.length >= 20 && panels >= 10 && bad.length === 0, bad.slice(0, 8).join("; "));
  const missing = [];
  for (const l of LOCALES) {
    const html = readFileSync(join(OUT, l, "index.html"), "utf8");
    // the gallery: its tile (the crop of a menu, or the whole screen) and the whole screen it opens
    for (const it of SHOT_MANIFEST.items) if (!html.includes((it.panel ?? it).small.src) || !html.includes(it.large.src)) missing.push(`${l}:${it.id}`);
    const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
    const app = ld.flatMap((o) => o["@graph"] ?? [o]).find((n) => n["@type"] === "SoftwareApplication");
    const shotsLd = app?.screenshot ?? [];
    if (shotsLd.length < 6 || shotsLd.some((x) => !existsSync(join(OUT, new URL(x.url).pathname)) || !x.caption)) missing.push(`${l}: JSON-LD screenshot`);
  }
  ok("every screenshot is on each landing (gallery) and JSON-LD lists screenshots that exist", missing.length === 0, missing.slice(0, 8).join(" "));
}

// ---------- browser ----------
mkdirSync(SHOTS, { recursive: true });
const pick = pickBrowser({ expected: chromium.executablePath() });
const browser = await chromium.launch({ ...pick.launch });
console.log(`browser: ${JSON.stringify(describeBrowser(pick, browser.version()))}`);

const GA_ID = process.env.NEXT_PUBLIC_GA_ID ?? "";
console.log(GA_ID ? `GA mode: expecting the consent banner for ${GA_ID}` : "no-GA mode: expecting no banner and no Google requests");

// consent: "no" pre-answers the banner (so it never covers what a test clicks), "ask" leaves it.
async function newCtx(viewport, opts = {}, consent = "no") {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, ...opts });
  if (consent === "no") await ctx.addInitScript(() => {
    try {
      localStorage.setItem("gsfpv_consent", "no");
    } catch {
      /* ignore */
    }
  });
  const beacons = [];
  const google = [];
  ctx.on("request", (r) => {
    if (/googletagmanager|google-analytics|doubleclick/.test(r.url())) google.push(r.url());
  });
  // Never send test hits into the real GA property; the attempt itself is the evidence.
  await ctx.route(/google-analytics\.com\/g\/collect|analytics\.google\.com\/g\/collect/, (route) => route.fulfill({ status: 204 }));
  await ctx.route("**/api/e", async (route) => {
    beacons.push(route.request().postData() ?? "");
    await route.fulfill({ status: 204 });
  });
  return { ctx, beacons, google };
}

// Screenshots + overflow + video
{
  const { ctx, google } = await newCtx({ width: 1440, height: 900 });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
  page.on("pageerror", (e) => consoleErrors.push(String(e)));
  await page.goto(`${BASE}/en/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  ok("no console errors / hydration errors on /en/", consoleErrors.length === 0, consoleErrors.join(" | ").slice(0, 400));
  // the screenshot band under the hero waits for the load event (components/DeferImages)
  const swapped = await page.waitForFunction(() => !document.querySelector("img[data-srcset]"), undefined, { timeout: 10000 }).then(() => true, () => false);
  // a resource timing entry appears only when its response has finished, so give the swapped pictures
  // time to arrive before counting them (on a slow CI runner the count right after the swap was 0)
  await page
    .waitForFunction(() => {
      const files = new Set([...document.querySelectorAll("img[data-deferred]")].map((i) => new URL(i.currentSrc || i.src).pathname));
      return performance.getEntriesByType("resource").some((r) => files.has(new URL(r.name).pathname));
    }, undefined, { timeout: 10000 })
    .catch(() => {});
  const early = await page.evaluate(() => {
    const load = performance.getEntriesByType("navigation")[0].loadEventStart;
    const deferred = [...document.querySelectorAll("img[data-deferred]")];
    const files = new Set(deferred.map((i) => new URL(i.currentSrc || i.src).pathname));
    const rs = performance.getEntriesByType("resource").filter((r) => files.has(new URL(r.name).pathname));
    return { load: Math.round(load), deferredImgs: deferred.length, inBand: deferred.filter((i) => i.closest(".shot-band")).length, inTour: deferred.filter((i) => i.closest("#tour")).length, requests: rs.length, beforeLoad: rs.filter((r) => r.startTime < load).map((r) => new URL(r.name).pathname) };
  });
  ok("band and tour screenshots: requested only after the load event, then all swapped in", swapped && early.inBand === 20 && early.inTour === 12 && early.requests > 0 && early.beforeLoad.length === 0, JSON.stringify(early));
  await page.evaluate(async () => {
    for (const img of document.querySelectorAll("img")) img.loading = "eager";
    await Promise.all([...document.images].map((i) => (i.complete ? null : new Promise((r) => (i.onload = i.onerror = r)))));
  });
  await page.screenshot({ path: join(SHOTS, "en-1440x900-full.png"), fullPage: true });
  ok("EN 1440x900 screenshot", true, ".shots/en-1440x900-full.png");
  if (!GA_ID) ok("no consent banner without NEXT_PUBLIC_GA_ID", (await page.locator("[aria-label='Analytics cookies']").count()) === 0);
  ok("no Google request (no GA id, or visitor declined)", google.length === 0, google.join(" "));
  const brokenImgs = await page.evaluate(() => [...document.images].filter((i) => !i.naturalWidth).map((i) => i.src));
  ok("all images loaded (desktop)", brokenImgs.length === 0, brokenImgs.join(" "));
  await ctx.close();
}
for (const [loc, file] of [["en", "en-375x812-full.png"], ["ru", "ru-375x812-full.png"]]) {
  const { ctx } = await newCtx({ width: 375, height: 812 }, { isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/${loc}/`, { waitUntil: "networkidle" });
  const video = await page.evaluate(async () => {
    const v = document.querySelector("video.hero-video");
    if (!v) return { present: false };
    await new Promise((r) => setTimeout(r, 1500));
    return { present: true, muted: v.muted, autoplay: v.hasAttribute("autoplay"), playsinline: v.hasAttribute("playsinline"), time: v.currentTime, paused: v.paused, w: v.videoWidth };
  });
  ok(`${loc} 375 hero video plays (muted, inline)`, !video.present || (video.muted && video.playsinline && !video.paused && video.time > 0 && video.w > 0), JSON.stringify(video));
  await page.screenshot({ path: join(SHOTS, `${loc}-375-hero.png`) });
  await page.evaluate(async () => {
    for (const img of document.querySelectorAll("img")) img.loading = "eager";
    await Promise.all([...document.images].map((i) => (i.complete ? null : new Promise((r) => (i.onload = i.onerror = r)))));
  });
  // Chrome cannot capture more than ~16 000 px in one go (the tail wraps to the top), so tall
  // mobile pages are captured in clips; scripts/stitch.py joins them into one PNG.
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  const parts = [];
  for (let y = 0, i = 0; y < height; y += 8000, i++) {
    const part = file.replace(".png", `.part${i}.png`);
    await page.screenshot({ path: join(SHOTS, part), fullPage: true, clip: { x: 0, y, width: 375, height: Math.min(8000, height - y) } });
    parts.push(part);
  }
  ok(`${loc.toUpperCase()} 375x812 screenshot`, true, `.shots/${parts.join(", ")} (${height}px)`);
  await ctx.close();
}
{
  const { ctx } = await newCtx({ width: 375, height: 812 }, { isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  for (const l of LOCALES) for (const p of PAGES) {
    await page.goto(`${BASE}/${l}/${p}`, { waitUntil: "load" });
    const o = await page.evaluate(() => {
      const w = document.documentElement.clientWidth;
      const wide = [...document.querySelectorAll("body *")].filter((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.right <= w + 1) return false;
        // content inside an intentional horizontal scroller is fine; so is a decorative (aria-hidden)
        // layer clipped by a box that itself fits the viewport (the sliding screenshot band)
        const decorative = !!el.closest('[aria-hidden="true"]');
        for (let a = el.parentElement; a; a = a.parentElement) {
          const ox = getComputedStyle(a).overflowX;
          if (ox === "auto") return false;
          if (decorative && (ox === "hidden" || ox === "clip") && a.getBoundingClientRect().right <= w + 1) return false;
        }
        return true;
      });
      return { scroll: document.documentElement.scrollWidth - w, wide: wide.slice(0, 5).map((e) => e.tagName + "." + String(e.className).slice(0, 40)) };
    });
    ok(`no horizontal overflow at 375: /${l}/${p}`, o.scroll <= 0 && o.wide.length === 0, o.wide.join(" "));
  }
  // tap targets and fake affordances on the landing
  await page.goto(`${BASE}/en/`, { waitUntil: "load" });
  const ui = await page.evaluate(() => {
    const small = [];
    for (const el of document.querySelectorAll("a, button, summary, input, textarea, label.relative")) {
      const r = el.getBoundingClientRect();
      if (!r.width || getComputedStyle(el).visibility === "hidden") continue;
      // inline links inside running text are exempt (WCAG 2.5.8); so is a checkbox inside a >= 44 px label
      const inText = el.tagName === "A" && el.closest("p, label") && getComputedStyle(el).display === "inline";
      const inBigLabel = el.tagName === "INPUT" && el.closest("label") && el.closest("label").getBoundingClientRect().height >= 44;
      if (r.height < 44 && !inText && !inBigLabel && !el.classList.contains("sr-only") && !(el.tagName === "INPUT" && (el.type === "radio" || el.name === "website"))) small.push(`${el.tagName}:${(el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 30)}(${Math.round(r.height)})`);
    }
    const fake = [];
    for (const el of document.querySelectorAll("body *")) {
      if (getComputedStyle(el).cursor !== "pointer") continue;
      if (el.closest("a, button, summary, label, input, textarea, select")) continue;
      fake.push(el.tagName + "." + String(el.className).slice(0, 40));
    }
    return { small, fake };
  });
  ok("tap targets >= 44 px (landing, 375)", ui.small.length === 0, ui.small.join(" | "));
  ok("no pointer cursor on non-controls", ui.fake.length === 0, ui.fake.join(" | "));
  await ctx.close();
}

// Screenshots in the browser: the overflow rule still catches real overflow (control), parallax
// moves and stands still for reduced motion, no layout shift while scrolling, the gallery by keyboard.
{
  const { ctx } = await newCtx({ width: 375, height: 812 }, { isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/en/`, { waitUntil: "load" });
  // the same rule as above, run on two planted elements: one must be caught, one must not
  const ctl = await page.evaluate(() => {
    const w = document.documentElement.clientWidth;
    const wide = (el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.right <= w + 1) return false;
      const decorative = !!el.closest('[aria-hidden="true"]');
      for (let a = el.parentElement; a; a = a.parentElement) {
        const ox = getComputedStyle(a).overflowX;
        if (ox === "auto") return false;
        if (decorative && (ox === "hidden" || ox === "clip") && a.getBoundingClientRect().right <= w + 1) return false;
      }
      return true;
    };
    const plain = document.createElement("div");
    plain.style.cssText = "width:600px;height:10px";
    document.querySelector("#tour").append(plain);
    const hiddenText = document.createElement("div"); // content (not aria-hidden) cut off by a clipping box
    hiddenText.style.cssText = "overflow:hidden;width:100%";
    hiddenText.innerHTML = '<p style="width:600px">cut-off text</p>';
    document.querySelector("#tour").append(hiddenText);
    const r = { plainCaught: wide(plain), clippedContentCaught: wide(hiddenText.firstChild), bandTileExempt: !wide(document.querySelector(".shot-band img")) };
    plain.remove();
    hiddenText.remove();
    return r;
  });
  ok("overflow rule: planted 600 px element and clipped content caught, band tiles exempt (control)", ctl.plainCaught && ctl.clippedContentCaught && ctl.bandTileExempt, JSON.stringify(ctl));
  // layout shift over a full scroll of the page, lazy pictures loading on the way
  await page.evaluate(() => {
    window.__cls = 0;
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value;
    }).observe({ type: "layout-shift", buffered: true });
  });
  const total = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < total; y += 600) {
    await page.evaluate((yy) => window.scrollTo({ top: yy, behavior: "instant" }), y);
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(800);
  const cls = await page.evaluate(() => window.__cls);
  ok("no layout shift while scrolling the whole landing at 375 (lazy screenshots)", cls < 0.005, `sum of layout-shift values = ${cls.toFixed(4)} over ${total} px`);
  await ctx.close();
}
{
  // phone data: after the load event the screenshots are swapped in but load lazily, so a phone
  // that stays at the top fetches only the band tiles in view and nothing from the tour further
  // down; the tour picture it scrolls to is fetched then (control: the same measurement).
  const { ctx } = await newCtx({ width: 375, height: 812 }, { isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/en/`, { waitUntil: "load" });
  await page.waitForFunction(() => !document.querySelector("img[data-srcset]"), undefined, { timeout: 10000 }).catch(() => undefined);
  await page.waitForTimeout(2500);
  const probe = () => page.evaluate(() => {
    const band = new Set([...document.querySelectorAll(".shot-band img")].flatMap((i) => (i.srcset || "").split(",").map((x) => new URL(x.trim().split(" ")[0], location.href).pathname)));
    const shots = performance.getEntriesByType("resource").filter((r) => new URL(r.name).pathname.startsWith("/shots/"));
    const tour = [...document.querySelectorAll("#tour img[data-deferred]")].filter((i) => !(i.srcset || "").split(",").some((x) => band.has(new URL(x.trim().split(" ")[0], location.href).pathname)));
    const last = tour[tour.length - 1];
    const files = (i) => (i.srcset || "").split(",").map((x) => new URL(x.trim().split(" ")[0], location.href).pathname);
    return { shotFiles: shots.length, shotKB: Math.round(shots.reduce((a, r) => a + (r.transferSize || r.encodedBodySize || 0), 0) / 1024), bandImgs: document.querySelectorAll(".shot-band img").length, tourOnly: tour.length, lastTop: last ? Math.round(last.getBoundingClientRect().top + scrollY) : null, lastFetched: last ? shots.some((r) => files(last).includes(new URL(r.name).pathname)) : null, allLazy: [...document.querySelectorAll("img[data-deferred]")].every((i) => i.loading === "lazy") };
  });
  const atTop = await probe();
  await page.evaluate(() => {
    const band = new Set([...document.querySelectorAll(".shot-band img")].flatMap((i) => (i.srcset || "").split(",").map((x) => new URL(x.trim().split(" ")[0], location.href).pathname)));
    const tour = [...document.querySelectorAll("#tour img[data-deferred]")].filter((i) => !(i.srcset || "").split(",").some((x) => band.has(new URL(x.trim().split(" ")[0], location.href).pathname)));
    tour[tour.length - 1].scrollIntoView({ block: "center", behavior: "instant" });
  });
  await page.waitForTimeout(2500);
  const there = await probe();
  ok(`phone data: at the top a phone fetches ${atTop.shotFiles} screenshot files (${atTop.shotKB} KB); the tour picture ${atTop.lastTop} px down waits until scrolled to (control)`, atTop.allLazy && atTop.lastTop > 2500 && atTop.lastFetched === false && there.lastFetched === true && atTop.shotFiles <= 14 && atTop.shotKB < 800, JSON.stringify({ atTop, there }));
  await ctx.close();
}
for (const reduce of [false, true]) {
  const { ctx } = await newCtx({ width: 1440, height: 900 }, { reducedMotion: reduce ? "reduce" : "no-preference" });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/en/`, { waitUntil: "networkidle" });
  const read = () => page.evaluate(() => [...document.querySelectorAll(".shot-band-row, #how .shot-backdrop-img")].map((e) => e.style.transform || "none"));
  const top = await page.evaluate(() => document.querySelector(".shot-band").getBoundingClientRect().top + scrollY);
  await page.evaluate((y) => window.scrollTo({ top: y - 700, behavior: "instant" }), top);
  await page.waitForTimeout(300);
  const a = await read();
  await page.evaluate((y) => window.scrollTo({ top: y - 100, behavior: "instant" }), top);
  await page.waitForTimeout(300);
  const b = await read();
  const moved = a[0] !== b[0] && a[1] !== b[1] && a[0] !== "none";
  const still = [...a, ...b].every((x) => x === "none");
  if (!reduce) ok("parallax: the band rows move with the scroll", moved, `${a.slice(0, 2).join(" | ")}  ->  ${b.slice(0, 2).join(" | ")}`);
  else ok("parallax: reduced motion keeps every layer still (control of the same measurement)", still, [...a, ...b].join(" | "));
  await ctx.close();
}
{
  // from 1024 px the gallery is a grid of every picture (4 to a row), and a tile opens the whole screen
  const { ctx } = await newCtx({ width: 1440, height: 900 });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/en/#gallery`, { waitUntil: "networkidle" });
  const grid = await page.evaluate(() => {
    const track = document.querySelector("[data-testid=gallery-track]");
    const cards = [...track.children];
    const lefts = new Set(cards.map((c) => Math.round(c.getBoundingClientRect().left)));
    const tops = new Set(cards.map((c) => Math.round(c.getBoundingClientRect().top)));
    return { cards: cards.length, columns: lefts.size, rows: tops.size, scrolls: track.scrollWidth > track.clientWidth + 1, buttonsShown: getComputedStyle(document.querySelector("#gallery .gallery-btn").parentElement.parentElement).display !== "none" };
  });
  const firstId = SHOT_MANIFEST.items[0].id;
  await page.locator("[data-testid=gallery-track] li").first().locator("button").click();
  await page.waitForFunction(() => { const i = document.querySelector("[data-testid=lightbox] img"); return i && i.complete && i.naturalWidth > 0; }, undefined, { timeout: 8000 });
  const opened = await page.evaluate(() => { const i = document.querySelector("[data-testid=lightbox] img"); return { src: new URL(i.currentSrc || i.src).pathname, w: i.naturalWidth }; });
  await page.screenshot({ path: join(SHOTS, "gallery-grid-lightbox.png") });
  const wantFull = SHOT_MANIFEST.items[0].large;
  ok("gallery at 1440: a grid of every picture, 4 to a row, no strip or buttons; a tile opens the whole screen", grid.cards === SHOT_MANIFEST.items.length && grid.columns === 4 && !grid.scrolls && !grid.buttonsShown && opened.src === wantFull.src && opened.w === wantFull.w, JSON.stringify({ grid, opened, firstId }));
  await ctx.close();
}
{
  // below 1024 px it is one strip, worked from the keyboard
  const { ctx } = await newCtx({ width: 820, height: 1000 });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/en/#gallery`, { waitUntil: "networkidle" });
  const caps = SHOT_MANIFEST.items.map((it) => DICT.en.shots.items[it.id].t);
  const track = page.locator("[data-testid=gallery-track]");
  await track.focus();
  const x0 = await track.evaluate((e) => e.scrollLeft);
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(700);
  const x1 = await track.evaluate((e) => e.scrollLeft);
  const counter = (await page.locator("#gallery p.font-mono").textContent())?.trim();
  const first = page.locator("[data-testid=gallery-track] li").first().locator("button");
  await first.click();
  const dlg = page.locator("[data-testid=lightbox]");
  await page.waitForFunction(() => { const i = document.querySelector("[data-testid=lightbox] img"); return i && i.complete && i.naturalWidth > 0; }, undefined, { timeout: 8000 });
  const t1 = (await page.locator("#lightbox-title").textContent())?.trim();
  const openNow = await dlg.evaluate((d) => d.open);
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(200);
  const t2 = (await page.locator("#lightbox-title").textContent())?.trim();
  await page.screenshot({ path: join(SHOTS, "lightbox.png") });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  const closed = !(await dlg.evaluate((d) => d.open));
  const focusBack = await page.evaluate(() => document.activeElement?.closest("li")?.getAttribute("data-shot"));
  const pass = x1 > x0 && counter === `2 of ${caps.length}` && openNow && t1 === caps[0] && t2 === caps[1] && closed && focusBack === SHOT_MANIFEST.items[0].id;
  ok("gallery strip at 820: ArrowRight scrolls one card, a picture opens large, arrows step, Esc closes, focus returns", pass, JSON.stringify({ x0, x1, counter, t1, t2, closed, focusBack }));
  await ctx.close();
}

// Language switchers: nav + footer, every target, landing and privacy
for (const where of ["nav", "footer"]) {
  for (const p of ["", "privacy/"]) {
    for (const target of LOCALES) {
      const from = target === "en" ? "ru" : "en";
      const { ctx, beacons } = await newCtx({ width: 1440, height: 900 });
      const page = await ctx.newPage();
      await page.goto(`${BASE}/${from}/${p}`, { waitUntil: "networkidle" });
      const h1Before = (await page.locator("h1").first().textContent())?.trim();
      const link = page.locator(`[data-testid="lang-${where}"] a[data-lang="${target}"]`);
      await link.scrollIntoViewIfNeeded();
      await Promise.all([page.waitForURL(`${BASE}/${target}/${p}`), link.click()]);
      await page.waitForLoadState("networkidle");
      const lang = await page.evaluate(() => document.documentElement.lang);
      const h1 = (await page.locator("h1").first().textContent())?.trim();
      const cookie = (await ctx.cookies()).find((c) => c.name === "NEXT_LOCALE")?.value;
      const wantH1 = p === "" ? DICT[target].hero.h1 : DICT[target].privacy.h1;
      const beaconOk = beacons.some((b) => b === JSON.stringify({ e: "lang_switch", p: target }));
      ok(`lang switch ${where} /${from}/${p} -> ${target}`, lang === target && h1 === wantH1 && h1 !== h1Before && cookie === target && beaconOk, `lang=${lang} cookie=${cookie} beacon=${beaconOk}`);
      await ctx.close();
    }
  }
}

// Root fallback redirect honours the cookie, then the browser language
{
  const { ctx } = await newCtx({ width: 800, height: 600 }, { locale: "pl-PL" });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`, { waitUntil: "load" });
  await page.waitForURL(/\/(en|es|pl|ru)\/$/);
  const byLang = new URL(page.url()).pathname;
  await ctx.addCookies([{ name: "NEXT_LOCALE", value: "es", url: BASE }]);
  await page.goto(`${BASE}/`, { waitUntil: "load" });
  await page.waitForURL(/\/(en|es|pl|ru)\/$/);
  const byCookie = new URL(page.url()).pathname;
  ok("out/index.html redirects by Accept-Language then cookie", byLang === "/pl/" && byCookie === "/es/", `${byLang} ${byCookie}`);
  await ctx.close();
}

// Copy button → clipboard
{
  const { ctx } = await newCtx({ width: 1440, height: 900 });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/en/#agents`, { waitUntil: "networkidle" });
  const btn = page.locator("#agents button");
  await btn.click();
  await page.waitForTimeout(200);
  const label = (await btn.textContent())?.trim();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  ok("copy button copies the agent prompt and shows Copied", clip === PROMPT && label === "Copied", `label=${label}`);
  await ctx.close();
}

// Lead form against a mock /api/lead (204), then the network-error path
for (const mode of ["ok", "fail"]) {
  const { ctx } = await newCtx({ width: 1440, height: 900 });
  let body = null;
  await ctx.route("**/api/lead", async (route) => {
    body = route.request().postData();
    if (mode === "ok") await route.fulfill({ status: 204 });
    else await route.abort("failed");
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/en/#contact`, { waitUntil: "networkidle" });
  const submit = page.locator("#contact form button[type=submit]");
  const disabledBefore = await submit.isDisabled();
  await page.locator("#contact label", { hasText: "Studio" }).click();
  await page.fill("#lead-message", "We scan venues and want them flyable.");
  await page.fill("#lead-email", "pilot@example.com");
  const disabledNoConsent = await submit.isDisabled();
  await page.locator("#contact input[type=checkbox]").check();
  await submit.click();
  if (mode === "ok") {
    await page.locator("[data-testid=lead-success]").waitFor({ timeout: 8000 });
    const b = JSON.parse(body ?? "{}");
    const shape = b.role === "studio" && b.email === "pilot@example.com" && b.locale === "en" && b.consent === true && b.hp === "" && b.t >= 3000 && typeof b.message === "string";
    ok("lead form: disabled until valid, POST JSON shape, success panel", disabledBefore && disabledNoConsent && shape, body ?? "");
    await page.screenshot({ path: join(SHOTS, "lead-success.png") });
  } else {
    const alert = page.locator("#contact [role=alert]");
    await alert.waitFor({ timeout: 8000 });
    const text = (await alert.textContent()) ?? "";
    ok("lead form: network error shows a friendly retry message", /try again/i.test(text) && !/error|failed|TypeError/i.test(text), text);
  }
  await ctx.close();
}

// Hero paste + scene cards + fly CTA beacons
{
  const { ctx, beacons } = await newCtx({ width: 1440, height: 900 });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/en/`, { waitUntil: "networkidle" });
  const raw = "https://superspl.at/scene/39e63ce9";
  await page.fill("#scene-link", raw);
  await Promise.all([page.waitForURL(/\/en\/fly\/\?scene=/), page.click("#top form button[type=submit]")]);
  const url = new URL(page.url());
  ok("hero paste navigates to /en/fly/?scene=<encoded>", url.pathname === "/en/fly/" && url.search === `?scene=${encodeURIComponent(raw)}`, url.pathname + url.search);
  await page.goto(`${BASE}/en/`, { waitUntil: "networkidle" });
  const card = page.locator('#scenes a[href="/en/fly/?scene=7a475d38"]');
  await Promise.all([page.waitForURL(/scene=7a475d38/), card.click()]);
  await page.goto(`${BASE}/en/`, { waitUntil: "networkidle" });
  await Promise.all([page.waitForURL(/\/en\/fly\/$/), page.click("#top a[href='/en/fly/']")]);
  await page.waitForTimeout(300);
  const want = [{ e: "scene_open", p: "paste" }, { e: "scene_open", p: "showcase" }, { e: "fly_click", p: "" }].map((x) => JSON.stringify(x));
  const allWhitelisted = beacons.every((b) => {
    try {
      const o = JSON.parse(b);
      return Object.keys(o).join(",") === "e,p" && ["lang_switch", "cta_click", "scene_open", "fly_click"].includes(o.e);
    } catch {
      return false;
    }
  });
  ok("beacons: scene_open{paste|showcase}, fly_click, only {e,p}", want.every((w) => beacons.includes(w)) && allWhitelisted, beacons.join(" "));
  await ctx.close();
}

// "Report this scene" deep link from the simulator: /{locale}/?report=<8 hex>#contact
{
  const { ctx } = await newCtx({ width: 1440, height: 900 });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/en/?report=39e63ce9#contact`, { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  const st = await page.evaluate(() => ({
    role: document.querySelector("#contact input[name=role]:checked")?.value ?? "",
    msg: document.querySelector("#lead-message")?.value ?? "",
    top: Math.round(document.getElementById("contact").getBoundingClientRect().top),
    notice: !!document.querySelector("[data-testid=lead-report]"),
  }));
  ok("?report=39e63ce9 prefills role=takedown, message and scrolls to #contact", st.role === "takedown" && st.msg === "Scene 39e63ce9: " && st.notice && Math.abs(st.top) < 120, JSON.stringify(st));
  await page.goto(`${BASE}/en/?report=../../etc#contact`, { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.removeItem("gsfpv.lead.draft.v1"));
  await page.goto(`${BASE}/en/?report=39E63CE9x#contact`, { waitUntil: "networkidle" });
  const bad = await page.evaluate(() => ({ takedown: !!document.querySelector("#contact input[value=takedown]"), msg: document.querySelector("#lead-message")?.value ?? "" }));
  ok("?report with an invalid id is ignored", !bad.takedown && bad.msg === "", JSON.stringify(bad));
  await ctx.close();
}

// Consent banner and Google Analytics (only when the build has NEXT_PUBLIC_GA_ID)
if (GA_ID) {
  const cookiesGa = async (ctx) => (await ctx.cookies()).filter((c) => c.name.startsWith("_ga")).map((c) => c.name);
  {
    const { ctx, google } = await newCtx({ width: 1440, height: 900 }, {}, "ask");
    const page = await ctx.newPage();
    await page.goto(`${BASE}/en/`, { waitUntil: "networkidle" });
    const banner = page.locator("[aria-label='Analytics cookies']");
    const shown = await banner.isVisible();
    await page.waitForTimeout(1500);
    ok("GA: banner shown, no googletagmanager request and no _ga cookie before consent", shown && google.length === 0 && (await cookiesGa(ctx)).length === 0, google.join(" "));
    await page.screenshot({ path: join(SHOTS, "consent-banner.png") });
    await banner.getByRole("button", { name: "Decline" }).click();
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(1000);
    ok("GA: Decline is remembered, still nothing from Google", !(await banner.isVisible()) && google.length === 0 && (await cookiesGa(ctx)).length === 0, google.join(" "));
    await ctx.close();
  }
  {
    const { ctx, google } = await newCtx({ width: 1440, height: 900 }, {}, "ask");
    const page = await ctx.newPage();
    await page.goto(`${BASE}/en/`, { waitUntil: "networkidle" });
    const gtagResp = page.waitForResponse((r) => r.url().includes("googletagmanager.com/gtag/js"), { timeout: 15000 }).catch(() => null);
    await page.locator("[aria-label='Analytics cookies']").getByRole("button", { name: "Accept" }).click();
    const resp = await gtagResp;
    await page.waitForTimeout(2500);
    const dl = await page.evaluate(() => JSON.stringify((window.dataLayer ?? []).map((a) => Array.from(a))));
    const loadedWithId = !!resp && resp.url().includes(`id=${GA_ID}`) && resp.status() === 200;
    const consentOk = dl.includes('"consent","default"') && dl.includes('"analytics_storage":"denied"') && dl.includes('"consent","update",{"analytics_storage":"granted"}') && dl.includes(`"config","${GA_ID}"`);
    ok(`GA: after Accept gtag.js loads with ${GA_ID} (consent default denied → analytics_storage granted)`, loadedWithId && consentOk, `${resp ? resp.status() + " " + resp.url() : "no gtag response"}; collect attempts=${google.filter((u) => u.includes("/g/collect")).length}; _ga cookies=${(await cookiesGa(ctx)).join(",") || "none"}`);
    await ctx.close();
  }
}

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\nverify: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
