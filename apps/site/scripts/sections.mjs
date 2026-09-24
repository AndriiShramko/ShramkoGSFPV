// Screenshot each landing section separately (easier to review than one 10 000 px image).
// node scripts/sections.mjs <locale> <width>x<height> <prefix>
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE ?? "http://127.0.0.1:8137";
const [locale = "en", size = "1440x900", prefix = "sec"] = process.argv.slice(2);
const [width, height] = size.split("x").map(Number);
const shots = join(here, "..", ".shots");
mkdirSync(shots, { recursive: true });
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
await page.goto(`${BASE}/${locale}/`, { waitUntil: "networkidle" });
await page.screenshot({ path: join(shots, `${prefix}-viewport.png`) });
const ids = (process.env.IDS ?? "top,how,real,numbers,scenes,radios,compare,agents,risks,faq,opensource,contact").split(",");
for (const id of ids) {
  const el = page.locator(`#${id}`);
  await el.scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  await el.screenshot({ path: join(shots, `${prefix}-${id}.png`) });
}
await page.locator("footer").screenshot({ path: join(shots, `${prefix}-footer.png`) });
console.log(`sections saved with prefix ${prefix}`);
await browser.close();
