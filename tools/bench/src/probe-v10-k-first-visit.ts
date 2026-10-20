// v0.10 lane K (docs/wip/v10-k.md section 1): what a NEW visitor sees, in order, on the built release served locally.
//   SITE=http://localhost:<port> npx tsx src/probe-v10-k-first-visit.ts
// A fresh browser context per run (no saved profile, nothing in localStorage), no ?nowarn. At each step it lists
// what is on screen (dialogs, cards, hints; visible = laid out and not hidden) and takes a screenshot. It answers one
// question: where on the way from "open the page" to "fly" does a visitor see that Space is up and Shift is down?
// Paths: desktop-keyboard (picks Keyboard), desktop-close (closes Controls with x), desktop-radio-user (a radio
// profile saved from an earlier visit is not simulated here), phone (touch emulation, WebHID hidden like Android).
// Visible system Chrome with the scan drawn: hold C:/dev/.gpu-lock around the run.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { launchChrome } from './browser';
import { REPO, today, writeEvidence } from './evidence';

const SITE_RAW = process.env.SITE;
if (!SITE_RAW) throw new Error('probe-v10-k-first-visit needs SITE=http://localhost:<port>; it has no default');
const SITE = SITE_RAW.replace(/\/$/, '');
const TAG = process.env.PROBE_TAG ?? 'base';
const SHOTS = join(REPO, 'evidence', today(), 'v10-k', `first-visit-${TAG}`);
mkdirSync(SHOTS, { recursive: true });
console.log(`probe-v10-k-first-visit target: ${SITE} (${TAG})`);
const SCENE = '887f27aa';
// PROBE_ONLY=desktop-keyboard,phone limits the paths; PROBE_SIZE=900x480 changes the desktop window (a short window is a finding of its own)
const ONLY = (process.env.PROBE_ONLY ?? 'desktop-keyboard,desktop-close,phone').split(',');
const [DW, DH] = (process.env.PROBE_SIZE ?? '1280x800').split('x').map(Number);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

/** Every guidance surface of the flight page, with whether it is on screen and its text. */
const UP = `(() => {
  const defs = [
    ['warning (Before you fly)', '.panel:not(.pause):not(.how-to-fly)'],
    ['controls dialog (How will you fly)', '.screen.radio'],
    ['key card', '[data-testid="key-card"]'],
    ['how-to-fly card (v0.10)', '[data-testid="how-to-fly"]'],
    ['first-flight reminder (v0.10)', '[data-testid="game-reminder"]'],
    ['click-to-fly pill', '[data-testid="game-hint"]'],
    ['gate line', '.gate-msg'],
    ['touch hint', '.touch-hint'],
    ['loading card', '.loading'],
    ['picker', '.picker, .scenes'],
    ['pause menu', '.pause'],
    ['crosshair', '.crosshair']
  ];
  const out = [];
  for (const [name, sel] of defs) {
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const vis = !el.hidden && !el.classList.contains('hidden') && r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
      if (!vis) continue;
      out.push({ name, sel, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), text: (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 160) });
    }
  }
  const h = window.__gsfpv;
  return { status: h && h.status, source: h && h.controls && h.controls.source, walls: out.length, up: out, space: /space/i.test(document.body.innerText) && /shift/i.test(document.body.innerText) };
})()`;

const steps: { path: string; step: string; up: Any }[] = [];
async function snap(p: Page, path: string, step: string): Promise<void> {
    const up = (await p.evaluate(UP)) as Any;
    steps.push({ path, step, up });
    await p.screenshot({ path: join(SHOTS, `${path}-${step}.jpg`), type: 'jpeg', quality: 70 });
    console.log(`[${path}] ${step}: ${up.up.map((u: Any) => u.name).join(' + ') || '(nothing)'}; Space and Shift both in the page text: ${up.space}`);
}
async function untilReady(p: Page, ms = 240000): Promise<void> {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
        const s = (await p.evaluate(`window.__gsfpv && window.__gsfpv.status`)) as string;
        if (s === 'ready' || s === 'error') return;
        await sleep(300);
    }
    throw new Error('not ready');
}

async function run(path: string, o: { mobile: boolean; width: number; height: number; act: (p: Page) => Promise<void> }): Promise<void> {
    const { browser } = await launchChrome({ headless: false, args: ['--window-position=40,40', `--window-size=${o.width + 16},${o.height + 120}`] });
    const context = await browser.newContext({ viewport: { width: o.width, height: o.height }, deviceScaleFactor: 1, isMobile: o.mobile, hasTouch: o.mobile });
    // a phone's Chrome has no WebHID; the desktop emulation of one still has it
    if (o.mobile) await context.addInitScript(`try { delete Navigator.prototype.hid; } catch (e) {}`);
    const p = await context.newPage();
    await p.goto(`${SITE}/en/fly/?scene=${SCENE}&cb=${Math.random().toString(36).slice(2)}`);
    await sleep(1500);
    await snap(p, path, '1-open');
    const ok = p.locator('[data-action="warning-ok"]');
    if (await ok.count()) { await ok.click(); await sleep(500); await snap(p, path, '2-after-warning'); }
    await untilReady(p);
    await sleep(2500);
    await snap(p, path, '3-scan-ready');
    await o.act(p);
    await browser.close();
}

if (ONLY.includes('desktop-keyboard')) await run('desktop-keyboard', {
    mobile: false, width: DW, height: DH,
    act: async (p) => {
        await p.locator('[data-action="radio-keyboard"]').click({ timeout: 15000 });
        await sleep(1500);
        await snap(p, 'desktop-keyboard', '4-keyboard-chosen');
        await p.bringToFront();
        const box = (await p.locator('canvas').first().boundingBox())!;
        await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await sleep(800);
        await snap(p, 'desktop-keyboard', '5-after-click');
        await p.keyboard.down('Space');
        await sleep(2500);
        await snap(p, 'desktop-keyboard', '6-flying-space-held');
        await p.keyboard.up('Space');
    }
});
if (ONLY.includes('desktop-close')) await run('desktop-close', {
    mobile: false, width: DW, height: DH,
    act: async (p) => {
        await p.locator('[data-action="radio-close"]').click({ timeout: 15000 });
        await sleep(1500);
        await snap(p, 'desktop-close', '4-closed-controls');
    }
});
if (ONLY.includes('phone')) await run('phone', {
    mobile: true, width: 390, height: 844,
    act: async (p) => {
        await sleep(1500);
        await snap(p, 'phone', '4-later');
    }
});
const file = writeEvidence(`v10-k-first-visit-${TAG}`, { site: SITE, scene: SCENE, steps });
console.log(`evidence: ${file}`);
process.exit(0);
