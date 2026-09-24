// End-to-end check of the built site. Needs a server on BASE serving a copy of out/
// (node scripts/serve.mjs 8138). Uses system Chrome through Playwright.
//   BASE=http://127.0.0.1:8138 node scripts/verify.mjs
// Static checks (files, lang, canonical, hreflang, JSON-LD, forbidden words) + browser checks
// (screenshots, overflow at 375 px, every language switcher, copy button, lead form against a
// mocked /api/lead, scene paste, whitelisted beacons, no Google requests without GA id).
import { chromium } from "playwright";
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

// ---------- browser ----------
mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch({ channel: "chrome" });

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
        // content inside an intentional horizontal scroller is fine
        for (let a = el.parentElement; a; a = a.parentElement) if (getComputedStyle(a).overflowX === "auto") return false;
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
