// Probe: on a 375x812 phone the crash toast (automatic respawn on) must not cover the recording bar or the scene credit.
//   SITE=http://localhost:5320 npx tsx src/probe-phone-toast.ts      (a release build; LOCAL_FLY=1 for the dev server)
import { launchChrome, waitReady } from './browser';
import { writeEvidence } from './evidence';

const SITE = (process.env.SITE ?? 'http://localhost:5320').replace(/\/$/, '');
const fly = (qs: string) => (process.env.LOCAL_FLY ? `${SITE}/fly/?${qs}` : `${SITE}/en/fly/?${qs}`);
const { browser } = await launchChrome({ headless: false });
const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
await ctx.addInitScript({ content: "try { localStorage.setItem('gsfpv.warned', '1'); } catch (e) {}" });
const p = await ctx.newPage();
await p.goto(fly('scene=39e63ce9&simradio=scenario&quick=1&nowarn=1'));
await waitReady(p, 180000);
await p.waitForSelector('.crash-toast', { timeout: 60000 });
await p.waitForTimeout(300);
const boxes = await p.evaluate(`(() => { const r = (s) => [...document.querySelectorAll(s)].filter((e) => e.offsetParent !== null).map((e) => { const b = e.getBoundingClientRect(); return { s, l: b.left, t: b.top, r: b.right, b: b.bottom }; }); return [...r('.crash-toast'), ...r('.rec-bar'), ...r('.attribution'), ...r('.top-actions'), ...r('.osd')]; })()`) as { s: string; l: number; t: number; r: number; b: number }[];
const toast = boxes.find((x) => x.s === '.crash-toast')!;
const hits = boxes.filter((x) => x.s !== '.crash-toast' && Math.min(toast.r, x.r) - Math.max(toast.l, x.l) > 0.5 && Math.min(toast.b, x.b) - Math.max(toast.t, x.t) > 0.5).map((x) => x.s);
await p.screenshot({ path: 'C:/dev/gsfpv-v03/evidence/2026-10-02/v03-release/phone-toast-after-fix-375.png' });
await browser.close();
writeEvidence('v03-phone-toast', { pass: !!toast && hits.length === 0, site: SITE, toast, overlaps: hits, boxes });
console.log(JSON.stringify({ pass: !!toast && hits.length === 0, toast, overlaps: hits }));
