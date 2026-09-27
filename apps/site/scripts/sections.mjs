// Screenshot each landing section separately (easier to review than one 10 000 px image).
// node scripts/sections.mjs <locale> <width>x<height> <prefix>   (SHOTS_DIR=... to write elsewhere)
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE ?? "http://127.0.0.1:8137";
const [locale = "en", size = "1440x900", prefix = "sec"] = process.argv.slice(2);
const [width, height] = size.split("x").map(Number);
const shots = process.env.SHOTS_DIR ?? join(here, "..", ".shots");
mkdirSync(shots, { recursive: true });
const browser = await chromium.launch({ channel: "chrome" });
const mobile = width < 600;
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
await page.goto(`${BASE}/${locale}/`, { waitUntil: "networkidle" });
await page.screenshot({ path: join(shots, `${prefix}-viewport.png`) });
// the band of screenshots right under the hero
const band = page.locator(".shot-band");
if (await band.count()) {
  await band.scrollIntoViewIfNeeded();
  await page.evaluate(() => Promise.all([...document.querySelectorAll(".shot-band img")].map((i) => { i.loading = "eager"; return i.complete ? null : new Promise((r) => (i.onload = i.onerror = r)); })));
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(shots, `${prefix}-band.png`) });
}
const ids = (process.env.IDS ?? "top,tour,features,gallery,how,real,numbers,scenes,radios,compare,agents,risks,faq,opensource,contact").split(",");
for (const id of ids) {
  const el = page.locator(`#${id}`);
  await el.scrollIntoViewIfNeeded();
  // lazy pictures in the section have arrived before the picture is taken
  await page.waitForTimeout(250);
  await page.evaluate((sel) => Promise.all([...document.querySelectorAll(`${sel} img`)].map((i) => { i.loading = "eager"; return i.complete ? null : new Promise((r) => (i.onload = i.onerror = r)); })), `#${id}`);
  await el.screenshot({ path: join(shots, `${prefix}-${id}.png`) });
}
await page.locator("footer").screenshot({ path: join(shots, `${prefix}-footer.png`) });
console.log(`sections saved with prefix ${prefix}`);
await browser.close();
