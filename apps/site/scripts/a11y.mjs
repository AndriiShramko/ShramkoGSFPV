// Accessibility scan with axe-core (the engine behind Lighthouse's accessibility audits) at a
// 375x812 mobile viewport for every locale and page.
//   AXE=<path to axe.min.js> BASE=http://127.0.0.1:8141 node scripts/a11y.mjs
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const BASE = process.env.BASE ?? "http://127.0.0.1:8138";
const AXE = process.env.AXE;
if (!AXE) {
  console.error("a11y: set AXE to the path of axe.min.js");
  process.exit(2);
}
const axeSource = readFileSync(AXE, "utf8");
const browser = await chromium.launch({ channel: "chrome" });
const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
await ctx.addInitScript(() => {
  try {
    localStorage.setItem("gsfpv_consent", "no");
  } catch {
    /* ignore */
  }
});
const page = await ctx.newPage();
let total = 0;
for (const l of ["en", "es", "pl", "ru"]) {
  for (const p of ["", "privacy/", "licenses/"]) {
    await page.goto(`${BASE}/${l}/${p}`, { waitUntil: "networkidle" });
    await page.addScriptTag({ content: axeSource });
    const res = await page.evaluate(async () => {
      // @ts-expect-error injected
      const r = await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] } });
      return { violations: r.violations.map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length, sample: v.nodes[0]?.target?.join(" ") })), incomplete: r.incomplete.map((v) => v.id) };
    });
    total += res.violations.length;
    console.log(`/${l}/${p}: ${res.violations.length} violation(s)${res.violations.length ? " " + JSON.stringify(res.violations) : ""}; needs review: ${res.incomplete.join(",") || "none"}`);
  }
}
await browser.close();
console.log(total ? `a11y: ${total} violation(s)` : "a11y: 0 violations");
process.exit(total ? 1 : 0);
