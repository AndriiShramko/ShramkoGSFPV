// W2-1 acceptance in the real page (docs/architecture-v03.md A.11 browser; owner's items 20, 13, 12;
// defects D-b, D-h): fresh Playwright contexts or a throw-away user-data dir, never a pilot's profile.
// Every check has a negative control that must fire.
//   P1 item 20: Crash threshold 6.5 set in Settings survives a scene change, a reload and a new browser
//      on the same user-data dir ("days later"); the flight model uses it. Control: storage blocked ->
//      the banner shows and the value is lost on reload.
//   P2 resets: the row's reset gives the preset value (Pavo20 vCrash 4.0) and touches nothing else; a
//      group reset touches only its group (control); Reset all gives the defaults.
//   P3 item 13: Export in one browser, Import into a fresh one: __gsfpv.prefs.explicitList() and the
//      radio profiles are identical. Control: one value flipped in the file -> one line in the preview,
//      and the lists differ.
//   P4 D-b: opening and closing Settings 5 times (O, the gear, the pause menu; Esc, x, O) changes
//      neither the HUD nor the quality, nor the flight model. Control: a real change of both is seen.
//   P5 D-h: a FOV change while the bot flies leaves the craft where it was (0 mm, same flight model)
//      and the camera changed. Control: v0.2's Apply path (rebuild with fovDeg) jumps to the spawn.
//   P6 deep link /fly/?open=settings&focus=<id>: at the picker (also after the first-visit warning)
//      and in flight, Settings opens with that row focused. Control: an unknown id opens Settings,
//      says so, and nothing throws.
//   P7 phone 375x812: no horizontal overflow, rows and top buttons do not overlap. Control: a planted
//      600 px control is caught.
//   P8 keys: O opens and closes; the menu item and the gear carry the O key-cap.
// Logic-only mode (?render=off): none of these is a picture check; screenshots of the screen over
// the drawn scan are taken separately (SHOTS=1, needs the GPU: take the lock first).
//   LOCAL_FLY=1 SITE=http://127.0.0.1:5321 npx tsx src/accept-v03-prefs.ts [P1 P2 ...] [SHOTS=1]
// Evidence: evidence/<date>/v03-prefs.json.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import type { Browser, BrowserContext, Page } from 'playwright';
import { launchChrome, waitReady } from './browser';
import { pickBrowser } from './chrome.mjs';
import { REPO, today, writeEvidence } from './evidence';

const SITE = (process.env.SITE ?? 'http://127.0.0.1:5321').replace(/\/$/, '');
const fly = (qs: string) => (process.env.LOCAL_FLY ? `${SITE}/fly/?${qs}` : `${SITE}/en/fly/?${qs}`);
const SCENE = '39e63ce9', SCENE2 = '7a475d38';
const PAVO = 'pavo20pro-3s', METEOR = 'meteor65pro-1s';
const FLIGHT = `scene=${SCENE}&nowarn=1&input=touch&render=off`;
const WORK = join(REPO, '.cache', 'v03-prefs');
const SHOTS_DIR = join(REPO, 'evidence', today(), 'v03-prefs');
const args = process.argv.slice(2);
const want = (k: string) => !args.some((a) => /^P\d$/.test(a)) || args.includes(k);
const shots = process.env.SHOTS === '1';
mkdirSync(WORK, { recursive: true });
mkdirSync(SHOTS_DIR, { recursive: true });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const hook = <T = Any>(p: Page, body: string): Promise<T> => p.evaluate(`(() => { const h = window.__gsfpv; const s = h.session; ${body} })()`) as Promise<T>;
const canon = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));

const { browser, which } = await launchChrome({ headless: false, args: ['--window-position=40,40', '--window-size=1296,920'] });
const out: Record<string, unknown> = { site: SITE, browser: which, mode: 'render=off (logic only): every check here reads state, none is a picture check' };
const errors: string[] = [];

async function page(b: Browser, o: { w?: number; h?: number; mobile?: boolean } = {}): Promise<Page> {
    const ctx = await b.newContext({ viewport: { width: o.w ?? 1280, height: o.h ?? 800 }, deviceScaleFactor: 1, isMobile: !!o.mobile, hasTouch: !!o.mobile, acceptDownloads: true });
    const p = await ctx.newPage();
    watch(p);
    return p;
}

function watch(p: Page): void {
    p.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`.slice(0, 300)));
}

/** A browser on its own user-data dir (P1: "days later" is the same dir in a new browser). */
async function persistent(dir: string, init?: string): Promise<BrowserContext> {
    const pick = pickBrowser({ expected: chromium.executablePath() });
    const ctx = await chromium.launchPersistentContext(dir, { ...pick.launch, headless: false, viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, args: ['--window-position=60,60', '--window-size=1296,920'] });
    if (init) await ctx.addInitScript(init);
    return ctx;
}

async function flight(p: Page, qs = FLIGHT): Promise<void> {
    await p.goto(fly(qs));
    const r = await waitReady(p, 180000);
    if (r.status !== 'ready') throw new Error(`flight did not start: ${String(r.status)} ${String(r.error ?? '')}`);
}

async function openByKey(p: Page): Promise<void> {
    await p.keyboard.press('KeyO');
    await p.waitForSelector('[data-testid="settings"]', { timeout: 5000 });
}

async function closeByEsc(p: Page): Promise<void> {
    await p.keyboard.press('Escape');
    await p.waitForSelector('[data-testid="settings"]', { state: 'detached', timeout: 5000 });
}

/** As a pilot: the group in the rail, the number typed into the row's field, Tab to leave it. */
async function typeNumber(p: Page, group: string, id: string, v: number): Promise<void> {
    await p.click(`.set-rail-btn[data-group="${group}"]`);
    const f = p.locator(`[data-id="${id}"] input.num`);
    await f.fill(String(v));
    await f.press('Tab');
}

async function vcrash(p: Page): Promise<{ store: number; explicit: boolean; model: number | null }> {
    return hook(p, `return { store: h.prefs.get('physics.vCrash', { drone: '${PAVO}' }), explicit: h.prefs.isExplicit('physics.vCrash', { drone: '${PAVO}' }), model: s ? s.params.vCrash : null };`);
}

// ------------------------------------------------------------------ P1 item 20: kept for good
if (want('P1')) {
    const dir = join(WORK, `udd-${Date.now()}`);
    let c = await persistent(dir);
    let p = c.pages()[0] ?? await c.newPage();
    watch(p);
    await flight(p);
    const before = await vcrash(p);
    await openByKey(p);
    await typeNumber(p, 'crash', 'physics.vCrash', 6.5);
    const inPanel = await vcrash(p);
    await closeByEsc(p);
    const afterClose = await vcrash(p);
    // change the scene: the pause menu's "Change scan" (a page load to the picker until W3), then another scan
    await p.keyboard.press('KeyP');
    await Promise.all([p.waitForNavigation({ timeout: 30000 }), p.click('[data-action="pause.scene"]')]);
    // the picker's address has no ?nowarn: this profile never answered the first-visit warning, a pilot would now
    await p.waitForSelector('[data-action="warning-ok"], .screen.scenes', { timeout: 60000 });
    if (await p.locator('[data-action="warning-ok"]').count()) await p.click('[data-action="warning-ok"]');
    const picker = await waitReady(p, 60000);
    const atPicker = await vcrash(p);
    await flight(p, `scene=${SCENE2}&nowarn=1&input=touch&render=off`);
    const otherScene = await vcrash(p);
    await p.reload();
    await waitReady(p, 180000);
    const reloaded = await vcrash(p);
    await c.close();
    // days later: a new browser on the same profile
    c = await persistent(dir);
    p = c.pages()[0] ?? await c.newPage();
    watch(p);
    await flight(p);
    const later = await vcrash(p);
    const banner = await p.locator('.banner[data-kind="prefs-blocked"]').count();
    await c.close();
    const ok = (r: { store: number; model: number | null }) => r.store === 6.5 && (r.model === null || r.model === 6.5);
    // while Settings is open the flight model still has 4 ('life': applies when you continue), at close 6.5
    const pass = before.store === 4 && before.model === 4 && inPanel.store === 6.5 && inPanel.model === 4 && inPanel.explicit && ok(afterClose) && afterClose.model === 6.5
        && picker.status === 'picker' && ok(atPicker) && ok(otherScene) && otherScene.model === 6.5 && ok(reloaded) && reloaded.model === 6.5 && ok(later) && later.model === 6.5 && banner === 0;

    // control: the same, with the browser's storage blocked (Firefox "block cookies", a locked-down profile)
    const blockedDir = join(WORK, `udd-blocked-${Date.now()}`);
    const BLOCK = "Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('The operation is insecure.', 'SecurityError'); } });";
    const cb = await persistent(blockedDir, BLOCK);
    const pb = cb.pages()[0] ?? await cb.newPage();
    watch(pb);
    await flight(pb);
    const bannerShown = await pb.locator('.banner[data-kind="prefs-blocked"]').isVisible();
    const bannerText = await pb.locator('.banner[data-kind="prefs-blocked"]').textContent();
    await openByKey(pb);
    await typeNumber(pb, 'crash', 'physics.vCrash', 6.5);
    const blockedSet = await vcrash(pb);
    const dataSays = await (async () => { await pb.click('.set-rail-btn[data-group="data"]'); return pb.locator('[data-testid="storage-status"] [data-writable]').getAttribute('data-writable'); })();
    await closeByEsc(pb);
    await pb.reload();
    await waitReady(pb, 180000);
    const blockedAfter = await vcrash(pb);
    await cb.close();
    const fired = bannerShown && blockedSet.store === 6.5 && dataSays === 'false' && blockedAfter.store === 4 && blockedAfter.model === 4;
    out.P1 = { pass: pass && fired, what: 'item 20: Crash threshold 6.5 set in Settings is what the flight uses, and it survives a scene change, a reload and a new browser on the same profile', before, inPanel, afterClose, picker: picker.status, atPicker, otherScene: { scene: SCENE2, ...otherScene }, reloaded, daysLater: later, control: { what: 'storage blocked: the banner shows, Data says not saved, and the value is lost on reload', bannerShown, bannerText, setInPanel: blockedSet, dataWritable: dataSays, afterReload: blockedAfter, fired } };
    console.log('P1', (out.P1 as Any).pass ? 'PASS' : 'FAIL');
    rmSync(dir, { recursive: true, force: true });
    rmSync(blockedDir, { recursive: true, force: true });
}

// ------------------------------------------------------------------ P2 resets
if (want('P2')) {
    const p = await page(browser);
    await flight(p);
    await openByKey(p);
    await typeNumber(p, 'crash', 'physics.vCrash', 6.5);
    await typeNumber(p, 'camera', 'camera.fovDeg', 130);
    const set = await hook(p, `return { v: h.prefs.get('physics.vCrash', { drone: '${PAVO}' }), fov: h.prefs.get('camera.fovDeg', { drone: '${PAVO}' }), list: h.prefs.explicitList().length };`);
    // the row's reset: back to the preset value, and only that row
    await p.click('.set-rail-btn[data-group="crash"]');
    const dot = await p.locator('[data-id="physics.vCrash"] .sr-dot').isVisible();
    await p.click('[data-id="physics.vCrash"] [data-action="reset-setting"]');
    const rowReset = await hook(p, `return { v: h.prefs.get('physics.vCrash', { drone: '${PAVO}' }), preset: h.prefs.defaultOf('physics.vCrash', { drone: '${PAVO}' }), explicit: h.prefs.isExplicit('physics.vCrash', { drone: '${PAVO}' }), fov: h.prefs.get('camera.fovDeg', { drone: '${PAVO}' }), dot: !!document.querySelector('[data-id="physics.vCrash"] .sr-dot:not([hidden])') };`);
    // a group reset (two presses): Camera only; the crash threshold set again stays
    await typeNumber(p, 'crash', 'physics.vCrash', 7);
    await p.click('.set-rail-btn[data-group="camera"]');
    await p.click('.set-group[data-group="camera"] [data-action="reset-group"]');
    const askedOnly = await hook(p, `return h.prefs.get('camera.fovDeg', { drone: '${PAVO}' });`);
    await p.click('.set-group[data-group="camera"] [data-action="reset-group-yes"]');
    const groupReset = await hook(p, `return { fov: h.prefs.get('camera.fovDeg', { drone: '${PAVO}' }), v: h.prefs.get('physics.vCrash', { drone: '${PAVO}' }) };`);
    // Reset all (two presses)
    await p.click('.set-rail-btn[data-group="data"]');
    await p.click('[data-action="settings-reset-all"]');
    await p.click('[data-action="settings-reset-all-yes"]');
    const all = await hook(p, `return { list: h.prefs.explicitList(), v: h.prefs.get('physics.vCrash', { drone: '${PAVO}' }), fov: h.prefs.get('camera.fovDeg', { drone: '${PAVO}' }) };`);
    await closeByEsc(p);
    const model = await hook(p, 'return { vCrash: s.params.vCrash, fov: s.cameraFovDeg };');
    await p.context().close();
    const pass = set.v === 6.5 && set.fov === 130 && dot && rowReset.v === 4 && rowReset.preset === 4 && !rowReset.explicit && !rowReset.dot
        && askedOnly === 130 && all.list.length === 0 && all.v === 4 && all.fov === 115 && model.vCrash === 4 && model.fov === 115;
    // control: the row reset left FOV alone and the group reset left the crash threshold alone, so a reset that cleared everything would fail here
    const control = { rowResetKeptFov: rowReset.fov, groupResetKeptVCrash: groupReset.v, groupResetFov: groupReset.fov, fired: rowReset.fov === 130 && groupReset.v === 7 && groupReset.fov === 115 };
    out.P2 = { pass: pass && control.fired, what: 'row reset gives the preset value (Pavo20 vCrash 4.0); a group reset only its group (second press confirms); Reset all gives the defaults and the flight uses them', set, changedDot: dot, rowReset, beforeConfirm: askedOnly, groupReset, resetAll: all, flightAfterClose: model, control };
    console.log('P2', (out.P2 as Any).pass ? 'PASS' : 'FAIL');
}

// ------------------------------------------------------------------ P3 item 13: export, import
if (want('P3')) {
    // a v0.2 radio profile in the browser before the first v0.3 boot: the store migrates it into the radios
    const PAD = { version: 1, deviceKey: 'gamepad:Xbox Wireless Controller', deviceName: 'Xbox Wireless Controller', deadband: 0.05, created: '2026-09-22T09:00:00.000Z', axes: { roll: { index: 2, invert: false, center: 0, min: -1, max: 1 }, pitch: { index: 3, invert: true, center: 0, min: -1, max: 1 }, throttle: { index: 1, invert: true, center: 0, min: -1, max: 1 }, yaw: { index: 0, invert: false, center: 0, min: -1, max: 1 } }, arm: { kind: 'button', bit: 0, toggle: true }, angleMode: null };
    const a = await page(browser);
    await a.goto(`${SITE}/fly/showcase.json`);
    await a.evaluate((v) => localStorage.setItem('gsfpv.profiles.v1', v), JSON.stringify({ [PAD.deviceKey]: PAD }));
    await flight(a);
    await openByKey(a);
    await typeNumber(a, 'crash', 'physics.vCrash', 6.5);
    await typeNumber(a, 'drone', 'physics.gravity', 1.62);
    // another drone's camera, through the drone switcher
    await a.click('.set-rail-btn[data-group="camera"]');
    await a.selectOption('.set-group[data-group="camera"] select.set-drone', METEOR);
    await typeNumber(a, 'camera', 'camera.fovDeg', 125);
    await a.click('.set-rail-btn[data-group="tune"]');
    await a.selectOption('.set-group[data-group="tune"] select.set-drone', PAVO);
    const pidCell = a.locator('[data-id="tune.pid"] input.pid').first();
    await pidCell.fill('60');
    await pidCell.press('Tab');
    await a.click('.set-rail-btn[data-group="data"]');
    const file = join(WORK, `export-${Date.now()}.json`);
    const [dl] = await Promise.all([a.waitForEvent('download'), a.click('[data-action="settings-export"]')]);
    await dl.saveAs(file);
    const fileName = dl.suggestedFilename();
    const A = await hook(a, "return { list: h.prefs.explicitList(), radios: h.prefs.collection('radioProfiles') };");
    await a.context().close();

    const b = await page(browser);
    await flight(b);
    const B0 = await hook(b, "return h.prefs.explicitList().length;");
    await openByKey(b);
    await b.click('.set-rail-btn[data-group="data"]');
    await b.setInputFiles('[data-testid="settings-import-file"]', file);
    await b.waitForSelector('[data-action="settings-import-apply"]');
    const preview = { settingsLine: await b.locator('[data-testid="import-settings"]').textContent(), changeLines: await b.locator('[data-testid="import-changes"] li').count() };
    await b.click('[data-action="settings-import-apply"]');
    await closeByEsc(b);
    const B = await hook(b, `return { list: h.prefs.explicitList(), radios: h.prefs.collection('radioProfiles'), model: { vCrash: s.params.vCrash, gravity: s.params.gravity, pidRoll: s.params.pid.roll }, meteorFov: h.prefs.get('camera.fovDeg', { drone: '${METEOR}' }) };`);

    // control: one value flipped in the file -> one line in the preview, and the lists then differ
    const j = JSON.parse(readFileSync(file, 'utf8'));
    j.settings.drone[PAVO]['physics.vCrash'] = 7;
    const flipped = join(WORK, `export-flipped-${Date.now()}.json`);
    writeFileSync(flipped, JSON.stringify(j));
    await openByKey(b);
    await b.click('.set-rail-btn[data-group="data"]');
    await b.setInputFiles('[data-testid="settings-import-file"]', flipped);
    await b.waitForSelector('[data-action="settings-import-apply"]');
    const flippedLines = await b.locator('[data-testid="import-changes"] li').count();
    const flippedText = await b.locator('[data-testid="import-changes"] li').first().textContent();
    await b.click('[data-action="settings-import-apply"]');
    await closeByEsc(b);
    const C = await hook(b, 'return h.prefs.explicitList();');
    await b.context().close();
    const pass = /^gsfpv-settings-\d{4}-\d{2}-\d{2}\.json$/.test(fileName) && A.list.length === 4 && Object.keys(A.radios.items).length === 1 && B0 === 0
        && preview.changeLines === A.list.length && canon(B.list) === canon(A.list) && canon(B.radios) === canon(A.radios)
        && B.model.vCrash === 6.5 && B.model.gravity === 1.62 && B.model.pidRoll[0] === 60 && B.meteorFov === 125;
    const control = { flippedPreviewLines: flippedLines, flippedLine: flippedText, listsDiffer: canon(C) !== canon(A.list), fired: flippedLines === 1 && canon(C) !== canon(A.list) };
    out.P3 = { pass: pass && control.fired, what: 'item 13: Export in one browser, Import (preview, then Replace) into a fresh one: explicitList() and the radio profiles are identical, and the flight uses the imported values', exportFile: fileName, A: { explicit: A.list, radios: Object.keys(A.radios.items) }, preview, B: { explicitEqual: canon(B.list) === canon(A.list), radiosEqual: canon(B.radios) === canon(A.radios), model: B.model, meteorFov: B.meteorFov }, control };
    console.log('P3', (out.P3 as Any).pass ? 'PASS' : 'FAIL');
}

// ------------------------------------------------------------------ P4 D-b: open and close change nothing
if (want('P4')) {
    const p = await page(browser);
    // ?governor=0: the frame governor steps the render scale down and up by itself when frames drop
    // (render-pc FrameGovernor); off, the render scale is exactly the quality ceiling Settings sets
    await flight(p, `${FLIGHT}&governor=0`);
    await hook(p, 's.log.__probe = 1; return 0;');
    const STATE = `const hud = document.querySelector('.hud'); const ui = document.getElementById('ui');
        return { hudShown: hud ? getComputedStyle(hud).display !== 'none' : null, textOff: ui.classList.contains('hud-off'), frameStats: !document.querySelector('.hud .osd.frame').classList.contains('hidden'),
            renderScale: s.renderer.renderScale, budget: s.renderer.app.scene.gsplat.splatBudget, sameModel: s.log.__probe === 1, preset: s.presetId, paused: s.paused };`;
    await p.waitForTimeout(300);
    const s0 = await hook(p, STATE);
    const rounds: Any[] = [];
    const opens = ['O', 'gear', 'menu', 'O', 'gear'] as const;
    const closes = ['Esc', 'x', 'Esc', 'O', 'x'] as const;
    for (let i = 0; i < 5; i++) {
        if (opens[i] === 'O') await openByKey(p);
        else if (opens[i] === 'gear') { await p.click('[data-action="open-settings"]'); await p.waitForSelector('[data-testid="settings"]'); }
        else { await p.keyboard.press('KeyP'); await p.click('[data-action="pause.settings"]'); await p.waitForSelector('[data-testid="settings"]'); }
        const open = await hook(p, 'return s.paused;');
        if (closes[i] === 'Esc') await closeByEsc(p);
        else if (closes[i] === 'x') { await p.click('[data-action="settings-close"]'); await p.waitForSelector('[data-testid="settings"]', { state: 'detached' }); }
        else { await p.locator('.set-rail-btn').first().focus(); await p.keyboard.press('KeyO'); await p.waitForSelector('[data-testid="settings"]', { state: 'detached' }); }
        await p.waitForTimeout(250);
        rounds.push({ open: opens[i], close: closes[i], pausedWhileOpen: open, state: await hook(p, STATE) });
    }
    const same = rounds.every((r) => canon(r.state) === canon(s0) && r.pausedWhileOpen === true);
    // control: a real change through the same screen is seen by the same probe
    await openByKey(p);
    await p.click('.set-rail-btn[data-group="display"]');
    await p.click('[data-id="display.hud"] .sw');
    const q = p.locator('[data-id="display.quality"] input.num');
    await q.fill('0');
    await q.press('Tab');
    await closeByEsc(p);
    await p.waitForTimeout(300);
    const changed = await hook(p, STATE);
    await p.context().close();
    const control = { state: changed, fired: changed.hudShown === false && changed.renderScale < s0.renderScale && changed.sameModel === true };
    out.P4 = { pass: same && s0.paused === false && control.fired, what: 'D-b: Settings opened and closed 5 times (O, gear, pause menu; Esc, x, O): the HUD, the frame line, the render scale and splat budget and the flight model stay as they were; the flight is paused while it is open', governor: 'off (?governor=0), so the render scale is the quality ceiling alone; with it on, a first run saw it step 0.85 -> 0.7 by itself between two rounds', start: s0, rounds, control };
    console.log('P4', (out.P4 as Any).pass ? 'PASS' : 'FAIL');
}

// ------------------------------------------------------------------ P5 D-h: FOV never moves the craft
async function botAirborne(p: Page): Promise<Any> {
    await flight(p, `scene=${SCENE}&nowarn=1&simradio=scenario&tour=1&render=off`);
    const t0 = Date.now();
    while (Date.now() - t0 < 60000) {
        const st = await hook(p, 'const x = s.sim.s; const d = Math.hypot(x[0] - s.spawn[0], x[1] - s.spawn[1], x[2] - s.spawn[2]); const hd = s.hud(); return { d, speed: hd.speed, armed: hd.armed, crashed: hd.crashed, tick: s.sim.tick };');
        if (st.armed && !st.crashed && st.d > 0.5 && st.speed > 0.3) return st;
        await p.waitForTimeout(200);
    }
    throw new Error('the bot never got airborne');
}
if (want('P5')) {
    const p = await page(browser);
    const air = await botAirborne(p);
    // all in one task: no physics step can run between the readings, so any difference is the change's own
    const r = await hook(p, `
        const pos = () => [s.sim.s[0], s.sim.s[1], s.sim.s[2]];
        const a = { tick: s.sim.tick, p: pos(), fov: s.cameraFovDeg, log: s.log };
        document.querySelector('[data-action="open-settings"]').click();
        const f = document.querySelector('[data-id="camera.fovDeg"] input.num');
        f.value = '100';
        f.dispatchEvent(new Event('change'));
        const inPanelFov = s.cameraFovDeg;
        document.querySelector('[data-action="settings-close"]').click();
        const b = { tick: s.sim.tick, p: pos(), fov: s.cameraFovDeg, sameLog: s.log === a.log };
        return { a: { tick: a.tick, p: a.p, fov: a.fov }, b, inPanelFov, stored: h.prefs.get('camera.fovDeg', { drone: s.presetId }), moveMm: Math.hypot(b.p[0] - a.p[0], b.p[1] - a.p[1], b.p[2] - a.p[2]) * 1000, spawn: s.spawn };`);
    await p.waitForTimeout(600);
    const later = await hook(p, 'const x = s.sim.s; return { tick: s.sim.tick, dFromSpawn: Math.hypot(x[0] - s.spawn[0], x[1] - s.spawn[1], x[2] - s.spawn[2]), fov: s.cameraFovDeg };');
    await p.context().close();
    const pass = r.moveMm <= 1 && r.b.tick === r.a.tick && r.b.sameLog && r.a.fov === 115 && r.inPanelFov === 100 && r.b.fov === 100 && r.stored === 100 && later.tick > r.b.tick + 200 && later.fov === 100;

    // control: v0.2's Apply put fovDeg into the overrides and rebuilt the flight model
    const c = await page(browser);
    await botAirborne(c);
    const v02 = await hook(c, `
        const pos = () => [s.sim.s[0], s.sim.s[1], s.sim.s[2]];
        const a = { tick: s.sim.tick, p: pos() };
        s.rebuildSim(s.presetId, { ...s.overrides, fovDeg: 100 });
        const b = { tick: s.sim.tick, p: pos() };
        return { a, b, moveMm: Math.hypot(b.p[0] - a.p[0], b.p[1] - a.p[1], b.p[2] - a.p[2]) * 1000, atSpawnMm: Math.hypot(b.p[0] - s.spawn[0], b.p[1] - s.spawn[1], b.p[2] - s.spawn[2]) * 1000 };`);
    await c.context().close();
    const control = { v02, fired: v02.moveMm > 1 && v02.atSpawnMm < 1 && v02.b.tick === 0 };
    out.P5 = { pass: pass && control.fired, what: 'D-h: FOV changed in Settings while the bot flies: the craft is where it was (same tick, same flight model, 0 mm), the camera has the new FOV, the flight goes on', airborne: air, change: r, after600ms: later, thresholdMm: 1, control };
    console.log('P5', (out.P5 as Any).pass ? 'PASS' : 'FAIL');
}

// ------------------------------------------------------------------ P6 the catalogue's deep link
if (want('P6')) {
    const where = (p: Page) => p.evaluate(() => ({
        open: !!document.querySelector('[data-testid="settings"]'),
        focusedRow: document.activeElement?.closest('[data-id]')?.getAttribute('data-id') ?? null,
        highlighted: document.querySelector('.sr.focused')?.getAttribute('data-id') ?? null,
        group: document.querySelector('.set-group.sel')?.getAttribute('data-group') ?? null,
        note: (document.querySelector('[data-testid="settings-note"]') as HTMLElement | null)?.hidden === false ? document.querySelector('[data-testid="settings-note"]')!.textContent : null,
        picker: !!document.querySelector('.screen.scenes'),
        url: location.search
    }));
    // at the picker, as the landing links it (first visit: the warning comes first)
    const p = await page(browser);
    await p.goto(fly('open=settings&focus=physics.vCrash'));
    await p.waitForSelector('[data-action="warning-ok"]', { timeout: 30000 });
    const behindWarning = await where(p);
    await p.click('[data-action="warning-ok"]');
    await p.waitForSelector('[data-testid="settings"]', { timeout: 30000 });
    const atPicker = await where(p);
    await p.click('[data-action="settings-close"]');
    const afterClose = await where(p);
    // in flight
    await flight(p, `${FLIGHT}&open=settings&focus=camera.fovDeg`);
    await p.waitForSelector('[data-testid="settings"]');
    const inFlight = { ...(await where(p)), paused: await hook(p, 'return s.paused;') };
    await p.context().close();
    const pass = !behindWarning.open && atPicker.open && atPicker.picker && atPicker.focusedRow === 'physics.vCrash' && atPicker.highlighted === 'physics.vCrash' && atPicker.group === 'crash' && atPicker.note === null
        && !afterClose.open && !/open=|focus=/.test(afterClose.url)
        && inFlight.open && inFlight.focusedRow === 'camera.fovDeg' && inFlight.group === 'camera' && inFlight.paused === true;
    // control: an id this version does not have, and one it has but does not ship yet
    const c = await page(browser);
    const before = errors.length;
    await c.goto(fly('open=settings&focus=no.such&nowarn=1'));
    await c.waitForSelector('[data-testid="settings"]', { timeout: 30000 });
    const unknown = await where(c);
    await c.goto(fly('open=settings&focus=respawn.auto&nowarn=1'));
    await c.waitForSelector('[data-testid="settings"]', { timeout: 30000 });
    const planned = await where(c);
    await c.context().close();
    // the planned id is informational: its owner (W2-2) may ship it, and then it simply has a row
    const control = { unknown, planned, pageErrors: errors.slice(before), fired: unknown.open && unknown.focusedRow === null && unknown.highlighted === null && !!unknown.note?.includes('no.such') && planned.open && errors.length === before };
    out.P6 = { pass: pass && control.fired, what: 'deep link /fly/?open=settings&focus=<id>: at the picker (after the first-visit warning) and in flight, Settings opens with that row focused and its group shown; closing takes the link out of the address bar', behindWarning, atPicker, afterClose, inFlight, control };
    console.log('P6', (out.P6 as Any).pass ? 'PASS' : 'FAIL');
}

// ------------------------------------------------------------------ P7 phone 375 x 812
if (want('P7')) {
    const p = await page(browser, { w: 375, h: 812, mobile: true });
    await flight(p);
    await p.waitForTimeout(500);
    const boxes = (sel: string) => p.evaluate((s) => [...document.querySelectorAll(s)].filter((e) => (e as HTMLElement).offsetParent !== null).map((e) => { const r = e.getBoundingClientRect(); return { id: (e as HTMLElement).dataset.id ?? (e as HTMLElement).dataset.action ?? e.className, l: r.left, t: r.top, r: r.right, b: r.bottom }; }), sel);
    const overlap = (a: Any, b: Any) => a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5;
    const pairs = (list: Any[]) => { const o: string[] = []; for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) if (overlap(list[i], list[j])) o.push(`${list[i].id} x ${list[j].id}`); return o; };
    const top = await boxes('.top-actions .btn, .osd.tl, .osd.tr');
    const topOverlaps = pairs(top);
    // the walls box at the top middle (walls.ts) is not ours: recorded, see the report
    const wallsBox = await boxes('.bake-box');
    await p.tap('[data-action="open-settings"]');
    await p.waitForSelector('[data-testid="settings"]');
    const measure = async () => {
        const rows = await boxes('[data-testid="settings"] .sr');
        const geo = await p.evaluate(() => { const pane = document.querySelector('.set-pane') as HTMLElement; const panel = document.querySelector('[data-testid="settings"]')!.getBoundingClientRect(); return { paneScroll: pane.scrollWidth, paneClient: pane.clientWidth, docScroll: document.documentElement.scrollWidth, panel: { l: panel.left, r: panel.right, t: panel.top, b: panel.bottom } }; });
        const outside = rows.filter((r) => r.l < -0.5 || r.r > 375.5).map((r) => r.id);
        return { rows: rows.length, overlaps: pairs(rows), outside, ...geo };
    };
    const first = await measure();
    await p.tap('.set-group[data-group="drone"] .sg-toggle');
    await p.waitForTimeout(300);
    const drone = await measure();
    await p.tap('.set-group[data-group="tune"] .sg-toggle');
    await p.waitForTimeout(300);
    const tune = await measure();
    if (shots) await p.screenshot({ path: join(SHOTS_DIR, 'phone-tune-render-off.png') });
    const ok = (m: Any) => m.rows > 0 && m.overlaps.length === 0 && m.outside.length === 0 && m.paneScroll <= m.paneClient && m.docScroll <= 375 && m.panel.l >= 0 && m.panel.r <= 375.5;
    const pass = topOverlaps.length === 0 && ok(first) && ok(drone) && ok(tune);
    // control: a planted 600 px control must be caught by the same measurement
    await p.addStyleTag({ content: '[data-id="tune.throttle"] .sr-control { width: 600px; }' });
    await p.waitForTimeout(200);
    const planted = await measure();
    await p.context().close();
    const control = { planted, fired: !ok(planted) };
    // the walls box (walls.ts, fly.css; not this agent's) sits at the top middle where the top buttons are on a phone;
    // it already covered Controls before the gear existed, so it is recorded for its owner, not counted here
    const btn = (id: string) => top.find((b) => b.id === id);
    const wallsVsTop = wallsBox.length ? { box: wallsBox[0], overlapsGear: !!btn('open-settings') && overlap(wallsBox[0], btn('open-settings')), overlapsControls: !!btn('open-controls') && overlap(wallsBox[0], btn('open-controls')) } : null;
    out.P7 = { pass: pass && control.fired, what: 'phone 375x812: the gear, Controls and Pause do not overlap each other or the OSD lines; Settings fills the screen, no horizontal overflow, its rows do not overlap (first group, Drone & physics, Tune)', topButtons: top, topOverlaps, wallsBoxAtTop: wallsVsTop, settings: { first, drone, tune }, control };
    console.log('P7', (out.P7 as Any).pass ? 'PASS' : 'FAIL');
}

// ------------------------------------------------------------------ P8 keys and key-caps
if (want('P8')) {
    const p = await page(browser);
    await flight(p);
    await openByKey(p);
    const searchFocusTyped = await (async () => { await p.focus('[data-testid="settings-search"]'); await p.keyboard.type('gravo'); return p.locator('[data-testid="settings"]').count(); })();
    const searchHits = await p.evaluate(() => [...document.querySelectorAll('.sr')].filter((e) => !(e as HTMLElement).hidden).map((e) => e.getAttribute('data-id')));
    await p.fill('[data-testid="settings-search"]', 'grav');
    const gravHits = await p.evaluate(() => [...document.querySelectorAll('.sr')].filter((e) => !(e as HTMLElement).hidden).map((e) => e.getAttribute('data-id')));
    await p.locator('.set-rail-btn').first().focus();
    await p.keyboard.press('KeyO');
    const closedByO = await p.locator('[data-testid="settings"]').count();
    await p.keyboard.press('KeyP');
    const menuItem = await p.evaluate(() => { const b = document.querySelector('[data-action="pause.settings"]'); return b ? { aria: b.getAttribute('aria-keyshortcuts'), cap: b.querySelector('kbd')?.textContent ?? null } : null; });
    await p.keyboard.press('KeyO');
    const openedFromMenu = await p.locator('[data-testid="settings"]').count();
    const menuGone = await p.locator('.pause-menu').count();
    await closeByEsc(p);
    const gear = await p.evaluate(() => { const b = document.querySelector('[data-action="open-settings"]'); return b ? { aria: b.getAttribute('aria-keyshortcuts'), label: b.getAttribute('aria-label') } : null; });
    const paused = await hook(p, 'return s.paused;');
    // control: a menu item without a key (Drone) shows no cap and no aria-keyshortcuts, so the probe can say "none"
    await p.keyboard.press('KeyP');
    const noKeyItem = await p.evaluate(() => { const b = document.querySelector('[data-action="pause.drone"]'); return b ? { aria: b.getAttribute('aria-keyshortcuts'), cap: b.querySelector('kbd')?.textContent ?? null } : null; });
    await p.keyboard.press('Escape');
    await p.context().close();
    const pass = searchFocusTyped === 1 && searchHits.length === 0 && gravHits.includes('physics.gravity') && closedByO === 0 && menuItem?.aria === 'O' && menuItem.cap === 'O' && openedFromMenu === 1 && menuGone === 0 && gear?.aria === 'O' && paused === false;
    const control = { noKeyItem, fired: noKeyItem !== null && noKeyItem.aria === null && noKeyItem.cap === null };
    out.P8 = { pass: pass && control.fired, what: 'O opens and closes Settings; in the pause menu its item shows the O cap and O runs it; the gear says O; an O typed into the search stays a letter (the screen stays open)', search: { gravoHits: searchHits, gravHits, typedOKeptOpen: searchFocusTyped === 1 }, closedByO: closedByO === 0, menuItem, openedFromMenu: openedFromMenu === 1, gear, resumedAfter: paused === false, control };
    console.log('P8', (out.P8 as Any).pass ? 'PASS' : 'FAIL');
}

await browser.close();
out.pageErrors = errors;
// a run of some checks keeps the others' last results (each with its own time)
for (const k of Object.keys(out)) if (/^P\d$/.test(k)) (out[k] as Any).at = new Date().toISOString();
try {
    const prev = JSON.parse(readFileSync(join(REPO, 'evidence', today(), 'v03-prefs.json'), 'utf8')) as Record<string, Any>;
    for (const [k, v] of Object.entries(prev)) if (/^P\d$/.test(k) && !(k in out)) out[k] = v;
} catch {
    /* the first run of the day */
}
out.summary = Object.fromEntries(Object.keys(out).filter((k) => /^P\d$/.test(k)).sort().map((k) => [k, (out[k] as Any).pass ? 'pass' : 'FAIL']));
const file = writeEvidence('v03-prefs', out);
console.log(file);
