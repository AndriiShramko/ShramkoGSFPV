// W2-3 "input and modes" in the real page (docs/architecture-v03.md B.5 browser, C.3 page side; the
// owner's items 15, 23, 1/5/6/17, 30). Fresh Playwright contexts only, never a pilot's profile.
// Every check has a negative control that must fire.
//   M1  chip -> Horizon: the chip says HORIZON, prefs holds flight.mode, ch[5] is horizon's, still
//       after a reload; M cycles acro / angle / horizon. Control: a fresh browser flies ANGLE.
//   M2  a radio's mode switch, found on the wizard's check screen with no press (the simulated
//       EdgeTX flips CH6 there), decides ch[5]: a chip click and M leave it at the radio's value.
//       Control: the same radio set up without a mode switch: the chip click changes ch[5].
//   M3  keepArmed: the radio's switch kept ON through a crash and the respawn (R): the arm gate is
//       armed again with no new flip. Control: respawn.keepArmed off (changed live) wants a flip.
//   M4  v0.2 radio profiles survive the move into the prefs document. Control: a planted broken
//       one is reported (migration note and console), not dropped in silence; its old copy stays.
//   M5  the chip on the drawn scan, desktop 1280x800 and phone 375x812: beside the OSD line,
//       overlapping nothing; hidden under the Controls screen. Control: the chip moved onto the
//       right-hand OSD line is caught by the same overlap test. (Draws the scan: GPU lock.)
// M1-M4 are flight logic and run in the logic-only mode ?render=off (tools/bench/README.md).
//   LOCAL_FLY=1 SITE=http://127.0.0.1:5323 npx tsx src/accept-v03-modes.ts [M1 M2 ...]
// Evidence: evidence/<date>/v03-modes.json.
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Browser, BrowserContext, Page } from 'playwright';
import { launchChrome, waitReady } from './browser';
import { writeEvidence, REPO, today } from './evidence';

const SITE = (process.env.SITE ?? 'http://127.0.0.1:5323').replace(/\/$/, '');
const fly = (qs: string) => (process.env.LOCAL_FLY ? `${SITE}/fly/?${qs}` : `${SITE}/en/fly/?${qs}`);
const SCENE = '39e63ce9';
const ONLY = process.argv.slice(2).map((x) => x.toUpperCase());
const want = (id: string) => ONLY.length === 0 || ONLY.includes(id);
const SHOTS = join(REPO, 'evidence', today(), process.env.MODES_EVIDENCE ?? 'v03-modes');
mkdirSync(SHOTS, { recursive: true });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
/** Run `body` in the page with h = window.__gsfpv, s = its session (a string: tsx would wrap a function). */
const hook = <T = Any>(p: Page, body: string): Promise<T> => p.evaluate(`(() => { const h = window.__gsfpv; const s = h.session; ${body} })()`) as Promise<T>;
const wait = (p: Page, ms: number) => p.waitForTimeout(ms);

async function context(browser: Browser, o: { width?: number; height?: number; mobile?: boolean } = {}): Promise<{ ctx: BrowserContext; page: Page; log: string[] }> {
    const ctx = await browser.newContext({ viewport: { width: o.width ?? 1280, height: o.height ?? 800 }, deviceScaleFactor: 1, isMobile: !!o.mobile, hasTouch: !!o.mobile });
    const page = await ctx.newPage();
    const log: string[] = [];
    page.on('console', (m) => log.push(`${m.type()}: ${m.text()}`.slice(0, 300)));
    page.on('pageerror', (e) => log.push(`pageerror: ${e.message}`.slice(0, 300)));
    return { ctx, page, log };
}

/** What the page flies now: the chip, the store, ch[5] the flight model applied, the mode Controls flies. */
const STATE = `return {
    chip: document.querySelector('[data-testid="mode-chip"] .mc-mode')?.textContent ?? null,
    chipSrc: document.querySelector('[data-testid="mode-chip"] .mc-src')?.textContent ?? null,
    pref: h.prefs.get('flight.mode'), explicit: h.prefs.isExplicit('flight.mode'),
    ch5: s.sim.ch[5], flying: h.controls.flyingMode(), radioDecides: h.controls.radioDecides(),
    note: document.querySelector('.hud-note:not([hidden])')?.textContent ?? null };`;

const { browser, which } = await launchChrome({ headless: false, args: ['--window-position=40,40', '--window-size=1296,920'] });
const out: Record<string, Any> = { site: SITE, browser: which, render: { M1: 'off', M2: 'off', M3: 'off', M4: 'off', M5: 'on' } };

// ------------------------------------------------------------------ M1 chip, persistence, M
if (want('M1')) {
    const { ctx, page: p, log } = await context(browser);
    await p.goto(fly(`scene=${SCENE}&nowarn=1&input=touch&render=off`));
    await waitReady(p, 180000);
    await wait(p, 400);
    const start = await hook(p, STATE);
    // the pilot clicks the chip, then Horizon in its popover
    await p.click('[data-testid="mode-chip"]');
    const popOpen = await p.locator('#mode-pop').isVisible();
    const popItems = await p.locator('#mode-pop [role="menuitemradio"]').allTextContents();
    const mKey = await p.locator('#mode-pop .mc-foot kbd').allTextContents();
    await p.click('[data-action="mode-horizon"]');
    await wait(p, 300);
    const afterClick = await hook(p, STATE);
    const popClosed = !(await p.locator('#mode-pop').isVisible());
    await hook(p, 'h.prefs.flush(); return 0;');
    await p.reload();
    await waitReady(p, 180000);
    await wait(p, 400);
    const afterReload = await hook(p, STATE);
    // M cycles: horizon -> acro -> angle -> horizon
    const cycle: Any[] = [];
    for (let i = 0; i < 3; i++) {
        await p.keyboard.press('KeyM');
        await wait(p, 250);
        cycle.push(await hook(p, STATE));
    }
    await p.screenshot({ path: join(SHOTS, 'm1-after-cycle-render-off.png') });
    await ctx.close();
    // control: a fresh browser (nothing stored) flies the default, angle: HORIZON above came from the store
    const c = await context(browser);
    await c.page.goto(fly(`scene=${SCENE}&nowarn=1&input=touch&render=off`));
    await waitReady(c.page, 180000);
    await wait(c.page, 400);
    const fresh = await hook(c.page, STATE);
    await c.ctx.close();
    const is = (r: Any, m: string, ch: number) => r.chip === m.toUpperCase() && r.pref === m && r.ch5 === ch && r.flying === m;
    const pass = is(start, 'angle', 1) && popOpen && popItems.length === 3 && mKey.join() === 'M' && is(afterClick, 'horizon', 0) && afterClick.explicit && popClosed
        && is(afterReload, 'horizon', 0) && is(cycle[0], 'acro', -1) && is(cycle[1], 'angle', 1) && is(cycle[2], 'horizon', 0) && /HORIZON/.test(cycle[2].note ?? '');
    const control = { fresh, fired: is(fresh, 'angle', 1) && !fresh.explicit };
    out.M1 = { pass: pass && control.fired, what: 'chip -> Horizon: chip HORIZON, prefs flight.mode, ch[5] = 0, still after a reload; M cycles acro / angle / horizon with a note', start, popOpen, popItems, mKey, afterClick, popClosed, afterReload, cycle, control, errors: log.filter((l) => l.startsWith('pageerror')) };
    console.log('M1', out.M1.pass ? 'PASS' : 'FAIL');
}

// ------------------------------------------------------------------ the simulated EdgeTX with a CH6 switch
/**
 * ?simradio=raw&nobuttons=1: the simulated radio moves its sticks through the wizard and never
 * presses a button. Its CH6 is driven here (window.__ch6, the raw frame's axis 5): the wizard's
 * check screen and the flight both read it. Returns once the check screen is up.
 */
async function radioToCheck(p: Page): Promise<Any> {
    await p.goto(fly(`scene=${SCENE}&simradio=raw&nobuttons=1&react=300&nowarn=1&render=off`));
    await waitReady(p, 180000);
    await hook(p, `window.__ch6 = -1; const f = h.fake; const wrap = () => { const cb = f.onFrame; if (!cb || cb.__ch6) return; const w = (fr) => { fr.axes[5] = window.__ch6; cb(fr); }; w.__ch6 = true; f.onFrame = w; };
        window.__wrapCh6 = wrap; wrap(); setInterval(wrap, 50); return 0;`);
    const t0 = Date.now();
    let st: Any = null;
    while (Date.now() - t0 < 90000) {
        st = await hook(p, 'const w = h.radio && h.radio.wizard; return w ? { id: w.state.id, step: w.state.step, cmds: w.state.cmds } : null;');
        if (st?.id === 'check') break;
        await wait(p, 250);
    }
    return { ...st, seconds: Math.round((Date.now() - t0) / 1000), presses: await hook(p, 'return { presses: h.fake.presses, dropped: h.fake.dropped };') };
}

/** Flip CH6 low -> high on the check screen (held 0.6 s each), then read the row and the profile. */
async function flipOnCheck(p: Page): Promise<Any> {
    const cmds0 = await hook<number>(p, 'return h.radio.wizard.state.cmds;');
    await hook(p, 'window.__ch6 = -1; return 0;');
    await wait(p, 700);
    await hook(p, 'window.__ch6 = 1; return 0;');
    await wait(p, 900);
    return hook(p, `const w = h.radio.wizard; const r = document.querySelector('[data-testid="mode-switch-row"]');
        return { cmdsBefore: ${cmds0}, cmdsAfter: w.state.cmds, modeSwitch: w.state.modeSwitch, profileSwitch: w.state.profile && w.state.profile.modeSwitch || null,
            row: r ? r.textContent : null, presses: h.fake.presses };`);
}

/** Fly (the one click of the wizard), then CH6 keeps feeding the flight. */
async function flyAway(p: Page): Promise<void> {
    await p.click('[data-action="wizard-done"]');
    await wait(p, 300);
    await hook(p, 'window.__wrapCh6(); return 0;');
    await wait(p, 300);
}

// ------------------------------------------------------------------ M2 the radio's switch decides
if (want('M2')) {
    const { ctx, page: p, log } = await context(browser);
    const check = await radioToCheck(p);
    const found = await flipOnCheck(p);
    await p.screenshot({ path: join(SHOTS, 'm2-check-row-render-off.png') });
    await flyAway(p);
    const stored = await hook(p, "const d = JSON.parse(localStorage.getItem('gsfpv.prefs.v1') || '{}'); h.prefs.flush(); const d2 = JSON.parse(localStorage.getItem('gsfpv.prefs.v1') || '{}'); const it = d2.collections && d2.collections.radioProfiles.items[h.fake.key]; return it ? { version: it.version, modeSwitch: it.modeSwitch || null } : null;");
    await hook(p, 'window.__ch6 = -1; return 0;');
    await wait(p, 300);
    const low = await hook(p, STATE);
    // the pilot clicks the chip and Horizon: the radio's switch decides, nothing changes
    await p.click('[data-testid="mode-chip"]');
    const disabled = await p.locator('[data-action="mode-horizon"]').getAttribute('aria-disabled');
    const popNote = await p.locator('#mode-pop .mc-note').textContent();
    await p.locator('[data-action="mode-horizon"]').dispatchEvent('click');
    await wait(p, 300);
    const afterChip = await hook(p, STATE);
    await p.keyboard.press('Escape');
    await p.keyboard.press('KeyM');
    await wait(p, 250);
    const afterM = await hook(p, STATE);
    await hook(p, 'window.__ch6 = 1; return 0;');
    await wait(p, 300);
    const high = await hook(p, STATE);
    await hook(p, 'window.__ch6 = 0; return 0;');
    await wait(p, 300);
    const mid = await hook(p, STATE);
    await p.screenshot({ path: join(SHOTS, 'm2-radio-decides-render-off.png') });
    await ctx.close();

    // control: the same radio, set up without a mode switch (CH6 never flipped on the check)
    const c = await context(browser);
    const cCheck = await radioToCheck(c.page);
    await flyAway(c.page);
    const cBefore = await hook(c.page, STATE);
    await c.page.click('[data-testid="mode-chip"]');
    await c.page.click('[data-action="mode-horizon"]');
    await wait(c.page, 300);
    const cAfter = await hook(c.page, STATE);
    await c.ctx.close();

    const noClick = check.id === 'check' && check.presses.presses === 0 && found.cmdsAfter === found.cmdsBefore && found.presses === 0;
    const pass = noClick && found.modeSwitch?.sw?.input?.kind === 'axis' && found.modeSwitch.sw.input.index === 5 && found.profileSwitch?.input?.index === 5 && /CH\s?6/.test(found.row ?? '')
        && stored?.version === 1 && stored?.modeSwitch?.input?.index === 5
        && low.radioDecides && low.ch5 === -1 && low.chip === 'ACRO' && /CH\s?6/.test(low.chipSrc ?? '')
        && disabled === 'true' && /CH\s?6/.test(popNote ?? '')
        && afterChip.ch5 === -1 && afterChip.pref === low.pref && afterM.ch5 === -1 && afterM.pref === low.pref && /CH\s?6/.test(afterM.note ?? '')
        && high.ch5 === 1 && high.chip === 'ANGLE' && mid.ch5 === 0 && mid.chip === 'HORIZON';
    const control = { check: cCheck, before: cBefore, after: cAfter, fired: !cBefore.radioDecides && cBefore.ch5 === 1 && cAfter.ch5 === 0 && cAfter.pref === 'horizon' };
    out.M2 = { pass: pass && control.fired, what: "the radio's mode switch, found on the check screen with no press, decides ch[5]; a chip click and M leave ch[5] at the radio's value and say why", radio: 'SimRadio EdgeTX Classic (simulated raw HID reports, NOT a real radio), CH6 driven by the harness', check, found, stored, low, popup: { disabled, note: popNote }, afterChip, afterM, high, mid, control, errors: log.filter((l) => l.startsWith('pageerror')) };
    console.log('M2', out.M2.pass ? 'PASS' : 'FAIL');
}

// ------------------------------------------------------------------ M3 keepArmed through a crash and the respawn
/**
 * Arm with the fake radio at idle throttle at the spawn: the craft drops 1.7 m to the floor of
 * 39e63ce9 (about 5.8 m/s at the floor, the crash threshold is 4) and crashes. The switch stays ON.
 * (A climb and a cut first was not reliable: the throttle caught the fall below 4 m/s now and then.)
 */
async function crashWithSwitchOn(p: Page): Promise<Any> {
    // since W2-2 the craft starts on an invisible platform (item 16) that holds it at idle: the crash
    // needs the 1.7 m drop, so the platform is off for this start (R) and back on for the respawn
    await hook(p, "h.prefs.set('respawn.platform', false); h.fake.set('T', -1); h.fake.arm = false; return 0;");
    await p.keyboard.press('KeyR');
    await wait(p, 300);
    await wait(p, 400);
    await hook(p, 'h.fake.arm = true; return 0;');
    await wait(p, 60);
    const armed = await hook(p, 'return { gate: h.controls.gate.armed, sim: s.sim.armed, y: s.sim.s[1] };');
    const t0 = Date.now();
    let crashed = false;
    while (Date.now() - t0 < 8000) {
        crashed = await hook<boolean>(p, 'return !!s.sim.crashed;');
        if (crashed) break;
        await wait(p, 100);
    }
    await wait(p, 600); // crashed for a while: the gate's frames say so
    const during = await hook(p, 'return { crashed: !!s.sim.crashed, block: h.controls.block, gateArmed: h.controls.gate.armed, switchOn: h.fake.arm };');
    return { armedBefore: armed, crashed, during };
}

async function respawnWithSwitchOn(p: Page): Promise<Any> {
    await hook(p, "h.prefs.set('respawn.platform', true); return 0;");
    await p.keyboard.press('KeyR');
    await wait(p, 500);
    return hook(p, 'return { crashed: !!s.sim.crashed, gateArmed: h.controls.gate.armed, block: h.controls.block, switchOn: h.fake.arm, simArmed: !!s.sim.armed, keepArmed: h.controls.keepArmedAfterCrash };');
}

if (want('M3')) {
    const { ctx, page: p, log } = await context(browser);
    await radioToCheck(p);
    await flyAway(p);
    // the crash threshold at the settings slider's lowest, 2 m/s (Settings' Apply path): the 1.7 m
    // idle drop at the spawn of 39e63ce9 then always ends in a crash (at 4 m/s it did not, every time)
    await hook(p, "h.fake.set('T', -1); s.rebuildSim(s.presetId, { ...s.overrides, vCrash: 2 }); return 0;");
    const pref = await hook(p, "return { keepArmed: h.prefs.get('respawn.keepArmed'), controls: h.controls.keepArmedAfterCrash };");
    const crash = await crashWithSwitchOn(p);
    const after = await respawnWithSwitchOn(p);
    // control: respawn.keepArmed switched off live (the pilot's setting), the same sequence wants a new flip
    await hook(p, "h.prefs.set('respawn.keepArmed', false); return 0;");
    await wait(p, 100);
    const offLive = await hook<boolean>(p, 'return h.controls.keepArmedAfterCrash;');
    const crash2 = await crashWithSwitchOn(p);
    const after2 = await respawnWithSwitchOn(p);
    // and the flip it wants arms it (the gate is not stuck)
    await hook(p, "h.fake.set('T', -1); h.fake.arm = false; return 0;");
    await wait(p, 400);
    await hook(p, 'h.fake.arm = true; return 0;');
    await wait(p, 400);
    const afterFlip = await hook(p, 'return { gateArmed: h.controls.gate.armed, block: h.controls.block };');
    await hook(p, "h.prefs.reset('respawn.keepArmed'); h.prefs.reset('respawn.platform'); return 0;");
    await ctx.close();
    const pass = pref.keepArmed === true && pref.controls === true && crash.armedBefore.gate && crash.crashed && crash.during.block === 'crashed' && crash.during.switchOn
        && !after.crashed && after.gateArmed === true && after.block === null && after.switchOn;
    const control = { offLive, crash: crash2, after: after2, afterFlip, fired: offLive === false && crash2.crashed && !after2.crashed && after2.gateArmed === false && after2.block !== null && after2.switchOn && afterFlip.gateArmed === true };
    out.M3 = {
        pass: pass && control.fired,
        what: "respawn.keepArmed (on by default): the radio's arm switch kept ON through a crash and the respawn (R) arms the gate again with no new flip; off (changed live) wants the flip",
        radio: 'SimRadio EdgeTX Classic (simulated raw HID reports, NOT a real radio)', pref, crash, after, control,
        simSide: { simArmedAfterRespawn: after.simArmed, note: "page side only: the flight model respawns armed once the session's respawn passes RespawnOpts.keepArmed (W2-2, session.ts); until then the craft is parked even though the gate passes ON" },
        errors: log.filter((l) => l.startsWith('pageerror'))
    };
    console.log('M3', out.M3.pass ? 'PASS' : 'FAIL', JSON.stringify({ after, after2 }));
}

// ------------------------------------------------------------------ M4 v0.2 radios survive the move
const TX16S = {
    version: 1, deviceKey: 'hid:1209:4f54:Radiomaster TX16S Joystick:19', deviceName: 'Radiomaster TX16S Joystick', deadband: 0, created: '2026-09-26T19:44:02.118Z', mode: 2, wizard: 2,
    axes: { roll: { index: 0, invert: false, center: 0.004, min: -0.999, max: 0.999 }, pitch: { index: 1, invert: false, center: -0.002, min: -0.999, max: 0.999 }, throttle: { index: 2, invert: false, center: -0.999, min: -0.999, max: 0.999 }, yaw: { index: 3, invert: false, center: 0.001, min: -0.999, max: 0.999 } },
    arm: { kind: 'axis', index: 4, threshold: 0.4985, onAbove: true, off: -0.999, on: 0.999 }, angleMode: null
};
const PAD = { version: 1, deviceKey: 'gp:Xbox Wireless Controller', deviceName: 'Xbox Wireless Controller', deadband: 0.05, created: '2026-09-22T09:00:00.000Z', axes: { roll: { index: 2, invert: false, center: 0, min: -1, max: 1 }, pitch: { index: 3, invert: true, center: 0, min: -1, max: 1 }, throttle: { index: 1, invert: true, center: 0, min: -1, max: 1 }, yaw: { index: 0, invert: false, center: 0, min: -1, max: 1 } }, arm: { kind: 'button', bit: 0, toggle: true }, angleMode: null };
const BROKEN = { ...PAD, deviceKey: 'hid:broken', deviceName: 'Broken', arm: { kind: 'switch3', index: 5 } };

if (want('M4')) {
    const { ctx, page: p, log } = await context(browser);
    // v0.2's keys go in on the origin before v0.3 ever ran there (a static file, not the app)
    const legacy = { 'gsfpv.profiles.v1': JSON.stringify({ [TX16S.deviceKey]: TX16S, [PAD.deviceKey]: PAD, [BROKEN.deviceKey]: BROKEN }), 'gsfpv.lastInput': JSON.stringify({ kind: 'hid', key: TX16S.deviceKey }), 'gsfpv.stickMode': '1' };
    await p.goto(`${SITE}/fly/showcase.json`);
    await p.evaluate((k) => { for (const [a, b] of Object.entries(k)) localStorage.setItem(a, b); }, legacy);
    // a flight: the Controls screen reads the profiles (input from last time: the TX16S, not connected here)
    await p.goto(fly(`scene=${SCENE}&nowarn=1&render=off`));
    await waitReady(p, 180000);
    await wait(p, 600);
    const r = await hook(p, `h.prefs.flush(); const d = JSON.parse(localStorage.getItem('gsfpv.prefs.v1') || '{}'); const rp = d.collections ? d.collections.radioProfiles : null;
        return { migrated: h.prefs.migrated(), items: rp ? rp.items : null, last: rp ? rp.last : null, stick: h.prefs.get('input.stickMode'), legacyKept: localStorage.getItem('gsfpv.profiles.v1'),
            controlsScreen: !!document.querySelector('.screen.radio') };`);
    await p.reload();
    await waitReady(p, 180000);
    const again = await hook(p, "const d = JSON.parse(localStorage.getItem('gsfpv.prefs.v1') || '{}'); return { migrated: h.prefs.migrated(), keys: Object.keys(d.collections.radioProfiles.items).sort() };");
    await ctx.close();
    const items = r.items ?? {};
    // the same profile, field for field (the document stores its keys sorted)
    const canon = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));
    const pass = r.migrated?.from === 0 && canon(items[TX16S.deviceKey]) === canon(TX16S) && canon(items[PAD.deviceKey]) === canon(PAD)
        && r.last?.key === TX16S.deviceKey && r.stick === '1' && again.migrated === null && again.keys.join() === [PAD.deviceKey, TX16S.deviceKey].sort().join();
    const warned = log.filter((l) => l.startsWith('warning') && /gsfpv\.profiles\.v1 was not moved/.test(l));
    const control = { brokenInDoc: !!items[BROKEN.deviceKey], ignored: r.migrated?.ignored, consoleWarning: warned, legacyStillHasBroken: !!JSON.parse(r.legacyKept ?? '{}')[BROKEN.deviceKey],
        fired: !items[BROKEN.deviceKey] && (r.migrated?.ignored ?? []).some((i: Any) => i.key === 'gsfpv.profiles.v1' && /1 profile/.test(i.why)) && warned.length >= 1 && !!JSON.parse(r.legacyKept ?? '{}')[BROKEN.deviceKey] };
    out.M4 = { pass: pass && control.fired, what: 'v0.2 radio profiles (an EdgeTX radio, a gamepad), the last input and the stick mode move into the prefs document on the first v0.3 boot and stay there', migrated: r.migrated, docItems: Object.keys(items), last: r.last, stick: r.stick, again, control, errors: log.filter((l) => l.startsWith('pageerror')) };
    console.log('M4', out.M4.pass ? 'PASS' : 'FAIL');
}

// ------------------------------------------------------------------ M5 the chip on the drawn scan, desktop and phone
const OVERLAP = `const box = (el, name) => { if (!el || el.offsetParent === null) return null; const r = el.getBoundingClientRect(); return r.width && r.height ? { x: r.left, y: r.top, w: r.width, h: r.height, name } : null; };
    const chip = box(document.querySelector('[data-testid="mode-chip"]'), 'chip');
    const others = [box(document.querySelector('.hud .osd.tl'), 'osd-tl'), box(document.querySelector('.hud .osd.tr'), 'osd-tr'), box(document.querySelector('.hud .osd.bl'), 'osd-bl'),
        box(document.querySelector('.top-actions'), 'top-actions'), box(document.querySelector('.touch-hint'), 'touch-hint'), box(document.querySelector('.touch-arm'), 'touch-arm'),
        ...[...document.querySelectorAll('.touch-pad')].map((e, i) => box(e, 'touch-pad-' + i)), box(document.querySelector('.attribution'), 'attribution'), box(document.querySelector('.input-note'), 'input-note'),
        box(document.querySelector('#ui > .bake-box'), 'bake-box'), box(document.querySelector('#ui > .voxel-legend'), 'voxel-legend'), box(document.querySelector('.gate-msg'), 'gate-msg'),
        ...[...document.querySelectorAll('#ui > .banner')].map((e, i) => box(e, 'banner-' + i))].filter(Boolean);
    const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    const tl = document.querySelector('.hud .osd.tl'), st = tl && tl.firstElementChild, tr = document.querySelector('.hud .osd.tr');
    // the OSD line still prints the mode word today (ui/hud.ts); without it (requested), would the chip fit beside the status?
    const besideStatusFits = !!(chip && st && tr) && st.getBoundingClientRect().right + 8 + chip.w <= tr.getBoundingClientRect().left - 8;
    return { chip, overlaps: chip ? others.filter((o) => hit(chip, o)).map((o) => o.name) : null, others, vw: innerWidth, vh: innerHeight, osdLine: tl ? tl.textContent : null, besideStatusFits,
        inView: chip ? chip.x >= 0 && chip.y >= 0 && chip.x + chip.w <= innerWidth && chip.y + chip.h <= innerHeight : false };`;

async function layout(size: { width: number; height: number; mobile: boolean }, tag: string): Promise<Any> {
    const { ctx, page: p, log } = await context(browser, size);
    await p.goto(fly(`scene=${SCENE}&nowarn=1&input=touch`));
    const ready = await waitReady(p, 240000);
    await wait(p, 2500);
    const closed = await hook(p, OVERLAP);
    await p.screenshot({ path: join(SHOTS, `m5-${tag}-chip.png`) });
    await p.click('[data-testid="mode-chip"]');
    await wait(p, 200);
    // every choice of the open popover is the topmost thing where a finger lands on it (nothing paints over it)
    const POP = "const r = document.querySelector('#mode-pop').getBoundingClientRect(); const bs = [...document.querySelectorAll('#mode-pop [role=menuitemradio]')]; const items = bs.map((b) => Math.round(b.getBoundingClientRect().height)); const topmost = bs.every((b) => { const q = b.getBoundingClientRect(); return b.contains(document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2)); }); return { x: r.left, y: r.top, w: r.width, h: r.height, inView: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, itemHeights: items, topmost };";
    const pop = await hook(p, POP);
    // control: the same popover without its stacking (z-index auto, as first built) is painted over on a phone
    // control: a copy of the walls box (the page's own layer for boxes) laid exactly over the popover; with the
    // chip's z-index removed the box paints over the choices (topmost false), with it the popover stays on top
    const COVER = "const src = document.querySelector('#ui > .bake-box') || document.querySelector('.touch-hint'); const r = document.querySelector('#mode-pop').getBoundingClientRect(); const c = src.cloneNode(true); c.removeAttribute('data-testid'); c.setAttribute('data-planted', '1'); Object.assign(c.style, { position: 'fixed', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px', margin: '0', transform: 'none' }); src.parentElement.append(c);";
    const popFlat = await hook(p, `${COVER} document.querySelector('.mode-chip').style.zIndex = 'auto'; const res = (() => { ${POP} })(); document.querySelector('.mode-chip').style.zIndex = ''; const kept = (() => { ${POP} })(); document.querySelector('[data-planted]').remove(); res.keptWithZ = kept.topmost; return res;`);
    await p.screenshot({ path: join(SHOTS, `m5-${tag}-popover.png`) });
    await p.keyboard.press('Escape');
    // under the Controls screen the chip goes with the rest of the flight view
    await p.click('[data-action="open-controls"]');
    await wait(p, 400);
    const underControls = await hook(p, "const c = document.querySelector('[data-testid=\"mode-chip\"]'); return c ? getComputedStyle(c.parentElement).visibility : 'none';");
    await p.keyboard.press('Escape');
    await wait(p, 300);
    // control: the same overlap test with the chip planted on the right-hand OSD line must see it
    const planted = await hook(p, `const el = document.querySelector('[data-testid="mode-chip"]').parentElement; const trR = document.querySelector('.hud .osd.tr').getBoundingClientRect();
        el.style.transition = 'none'; el.style.left = trR.left + 'px'; el.style.top = trR.top + 'px'; ${OVERLAP}`);
    await ctx.close();
    return { ready: { status: ready.status, render: (ready.info as Any)?.render, renderer: (ready.info as Any)?.currentRenderer }, closed, pop, underControls, control: { overlaps: planted.overlaps, fired: Array.isArray(planted.overlaps) && planted.overlaps.includes('osd-tr'), popoverFlat: { topmost: popFlat.topmost, keptWithZ: popFlat.keptWithZ, fired: popFlat.topmost === false && popFlat.keptWithZ === true } }, errors: log.filter((l) => l.startsWith('pageerror')) };
}

if (want('M5')) {
    // the scan is drawn here: GPU lock and free memory are the caller's (see the task's GPU rule)
    const desktop = await layout({ width: 1280, height: 800, mobile: false }, 'desktop');
    const phone = await layout({ width: 375, height: 812, mobile: true }, 'phone');
    const ok = (r: Any) => r.ready.status === 'ready' && r.ready.render === 'on' && r.closed.chip && r.closed.inView && r.closed.overlaps.length === 0 && r.pop.inView && r.pop.topmost && r.pop.itemHeights.every((x: number) => x >= 44) && r.underControls === 'hidden' && r.control.fired;
    // the flat-popover control can fire only where something sits over the popover: the phone
    out.M5 = { pass: ok(desktop) && ok(phone) && phone.control.popoverFlat.fired, what: 'the chip beside the OSD line overlaps no OSD line, button, pad or note; its popover fits the screen with 44 px rows; hidden under the Controls screen (desktop 1280x800, phone 375x812, scan drawn)', desktop, phone };
    console.log('M5', out.M5.pass ? 'PASS' : 'FAIL', JSON.stringify({ d: desktop.closed.overlaps, p: phone.closed.overlaps }));
}

await browser.close();
const ALL = ['M1', 'M2', 'M3', 'M4', 'M5'];
const ran = ALL.filter((k) => out[k]);
out.ran = ran;
// a run of some items keeps today's results of the others, each with the run it came from
const NAME = process.env.MODES_EVIDENCE ?? 'v03-modes'; // another name for a what-if run (a local patch measured, never the item's own result)
const file = join(REPO, 'evidence', today(), `${NAME}.json`);
if (existsSync(file)) {
    const old = JSON.parse(readFileSync(file, 'utf8')) as Any;
    for (const k of ALL) {
        if (out[k] || !old[k]) continue;
        out[k] = { ...old[k], fromRun: old[k].fromRun ?? { date: old.context?.date, gitHead: old.context?.gitHead, gitDirty: old.context?.gitDirty } };
        out.render[k] = old.render?.[k] ?? out.render[k];
    }
}
const have = ALL.filter((k) => out[k]);
out.pass = have.length === ALL.length && have.every((k) => out[k].pass);
console.log('evidence', writeEvidence(NAME, out), 'all items pass:', out.pass);
