// v0.9 lane B acceptance (docs/wip/v09-b.md): keyboard and mouse like a game, and the full screen key, in the built
// release served locally:
//   SITE=http://localhost:<port> npx tsx src/accept-v09-keys.ts
// SITE is required (no default: this bench never runs against the live site by accident). Visible system Chrome, the
// scan drawn (screenshots in evidence/<date>/v09-b/); hold the GPU lock around the run (mkdir C:/dev/.gpu-lock).
// V09_CONTROL=1 is the negative control: the same bench against the base build (631fd5f), where every check that
// belongs to the new scheme must FAIL (a check that passes there does not tell the two builds apart and is listed
// in `notDiscriminating`); the control passes when none of the discriminating checks passes.
// What this does not prove: the mouse here is moved by Chrome's input protocol, which Chrome turns into movementX/Y
// under pointer lock the way a real mouse does (the evidence says which delivery was used); Esc as the BROWSER's own
// release gesture cannot be pressed from a test, so the lock is released with exitPointerLock() (what the browser does
// for Esc) and the Escape KEY is tested separately; a real hand and a real mouse on the owner's Chrome are not here.
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { launch, waitReady } from './browser';
import { REPO, today, writeEvidence } from './evidence';

const SITE_RAW = process.env.SITE;
if (!SITE_RAW) throw new Error('accept-v09-keys needs SITE=http://localhost:<port> (a local release); it has no default');
const SITE = SITE_RAW.replace(/\/$/, '');
const CONTROL = process.env.V09_CONTROL === '1';
console.log(`accept-v09-keys target: ${SITE}${CONTROL ? ' (CONTROL: the base build)' : ''}`);
const SHOTS = join(REPO, 'evidence', today(), 'v09-b');
mkdirSync(SHOTS, { recursive: true });
const SCENE = '887f27aa';
const fly = (qs: string): string => `${SITE}/en/fly/?scene=${SCENE}&nowarn=1&${qs}&cb=${Math.random().toString(36).slice(2)}`;

/** The English fly dictionary as the page merges it. */
function en(): Record<string, string> {
    const dir = join(REPO, 'packages', 'i18n', 'locales', 'fly');
    const d = JSON.parse(readFileSync(join(dir, 'en.json'), 'utf8')) as Record<string, string>;
    for (const ns of readdirSync(dir)) if (!ns.endsWith('.json')) Object.assign(d, JSON.parse(readFileSync(join(dir, ns, 'en.json'), 'utf8')));
    return d;
}
const EN = en();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
/** Evaluate code with h = window.__gsfpv and s = its session (a string: tsx wraps functions with __name). */
function ev<T = Any>(p: Page, code: string): Promise<T> {
    return p.evaluate(`(() => { const h = window.__gsfpv; const s = h.session; ${code} })()`) as Promise<T>;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const r3 = (v: number): number => Math.round(v * 1000) / 1000;

const checks: { id: string; ok: boolean; discriminating: boolean; detail: Record<string, unknown> }[] = [];
/** `discriminating` false: a check the base build is expected to pass too (nothing of the new scheme in it). */
function check(id: string, ok: boolean, detail: Record<string, unknown> = {}, discriminating = true): void {
    checks.push({ id, ok, discriminating, detail });
    console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${JSON.stringify(detail)}`);
}

const POS = 'return { x: s.sim.s[0], y: s.sim.s[1], z: s.sim.s[2], vx: s.sim.s[3], vy: s.sim.s[4], vz: s.sim.s[5] };';
interface Pos { x: number; y: number; z: number; vx: number; vy: number; vz: number }
const speedOf = (a: Pos): number => Math.hypot(a.vx, a.vz);
/** The camera's forward vector and the heading and pitch it implies, degrees (heading 0 = -z, right positive; pitch up positive). */
const CAMERA = `const f = s.renderer.camera.forward; return { heading: Math.atan2(f.x, -f.z) * 180 / Math.PI, pitch: Math.asin(Math.max(-1, Math.min(1, f.y))) * 180 / Math.PI };`;
const wrap = (d: number): number => { let x = d % 360; if (x > 180) x -= 360; else if (x <= -180) x += 360; return x; };

/** The flight with the keyboard as the input (the first visit's Controls screen closed: the keyboard stands in). */
async function keyboardFlight(p: Page, qs: string, wallsOff: boolean): Promise<void> {
    await p.goto(fly(qs));
    const r = await waitReady(p, 240000);
    if (r.status !== 'ready') throw new Error(`flight did not start: ${String(r.status)}`);
    await p.locator('[data-action="radio-close"]').click({ timeout: 15000 });
    for (let i = 0; i < 50 && (await ev(p, 'return h.controls.source;')) !== 'keyboard'; i++) await sleep(100);
    if (wallsOff) await ev(p, 'h.wallsSwitch.set(false); return 0;'); // the palms over the spawn stop a climb
    await sleep(2500); // detail streams in around the spawn
}

/** The mouse moved by (dx, dy) px: Chrome's input protocol first; the page's own mousemove event if Chrome sent no movement. */
let delivery: 'chrome-input' | 'page-event' | 'unknown' = 'unknown';
async function moveMouse(p: Page, dx: number, dy: number, steps = 10): Promise<void> {
    const before = await ev<Any>(p, 'const g = h.play().game; return g ? { yaw: g.aimYawDeg, pitch: g.gimbalDeg } : null;');
    const box = (await p.locator('canvas').first().boundingBox())!;
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    await p.mouse.move(cx, cy);
    for (let i = 1; i <= steps; i++) { await p.mouse.move(cx + (dx * i) / steps, cy + (dy * i) / steps); await sleep(8); }
    await sleep(60);
    const after = await ev<Any>(p, 'const g = h.play().game; return g ? { yaw: g.aimYawDeg, pitch: g.gimbalDeg } : null;');
    const moved = !!before && !!after && (Math.abs(wrap((after.yaw ?? 0) - (before.yaw ?? 0))) > 0.5 || Math.abs(after.pitch - before.pitch) > 0.5);
    if (moved) { if (delivery === 'unknown') delivery = 'chrome-input'; return; }
    if (!CONTROL) {
        // Chrome gave the page no movement: the same event a mouse makes, made by the page (the handler is the one measured)
        delivery = 'page-event';
        await p.evaluate(`(() => { document.dispatchEvent(new MouseEvent('mousemove', { movementX: ${dx}, movementY: ${dy}, bubbles: true })); })()`);
        await sleep(60);
    }
}

const L = await launch({ width: 1280, height: 800 });
const p = L.page;
await keyboardFlight(p, 'x=1', true);
const ready = await ev<Any>(p, 'return { play: h.play(), mode: h.controls.flyingMode(), source: h.controls.source };');

// ------------------------------------------------------------------ the first run: the game card
const card = await p.evaluate(`(() => { const c = document.querySelector('[data-testid="key-card"]'); return c ? { shown: !c.classList.contains('hidden'), title: c.querySelector('h3')?.textContent, now: c.querySelector('p.now')?.textContent, rows: [...c.querySelectorAll('.kc-list li')].map((li) => li.textContent) } : null; })()`) as Any;
const rowText = (card?.rows ?? []).join(' | ');
check('V1 the first-run card is up on the ground: "Click to fly", the mouse, W A S D, Space, Shift, F, Esc', !!card && card.shown && card.title === EN['play.game.title'] && /Mouse/.test(rowText) && /W.?A.?S.?D/.test(rowText) && /Space/.test(rowText) && /Shift/.test(rowText) && /F.*full screen/.test(rowText) && /Esc.*pause/.test(rowText) && card.now === EN['play.gate.keys'], card ?? {});
await p.screenshot({ path: join(SHOTS, 'v1-first-run-card.jpg'), quality: 80 });

// ------------------------------------------------------------------ click to fly: pointer lock
const box = (await p.locator('canvas').first().boundingBox())!;
const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
const lockBefore = await ev<Any>(p, 'return { locked: document.pointerLockElement !== null, game: h.play().game };');
await p.mouse.click(centre.x, centre.y);
await sleep(600);
const lockAfter = await ev<Any>(p, 'const c = document.querySelector("canvas"); return { locked: document.pointerLockElement === c, game: h.play().game, hint: document.querySelector("[data-testid=game-hint]") ? !document.querySelector("[data-testid=game-hint]").hidden : null };');
check('V2 a click on the view captures the mouse (pointer lock on the canvas); before the click there is none', !lockBefore.locked && lockAfter.locked && lockAfter.game?.locked === true, { before: lockBefore.locked, after: lockAfter.locked, game: lockAfter.game?.locked ?? null });
const cardLive = await p.evaluate(`document.querySelector('[data-testid="key-card"] h3')?.textContent ?? null`);
check('V2b with the mouse captured the card stops asking for a click', cardLive === EN['play.game.titleLive'], { title: cardLive });
await p.screenshot({ path: join(SHOTS, 'v2-locked-ground.jpg'), quality: 80 });

// ------------------------------------------------------------------ W: forward, in the facing direction, no arming step
const armedBefore = await ev<boolean>(p, 'return s.sim.armed;');
const p0 = await ev<Pos>(p, POS);
const heading0 = await ev<number>(p, 'return h.play().game ? h.play().game.headingDeg : 0;');
await p.keyboard.down('KeyW');
await sleep(2000);
const pW = await ev<Pos>(p, POS);
const armedW = await ev<boolean>(p, 'return s.sim.armed;');
const hr = (heading0 * Math.PI) / 180;
const along = (pW.x - p0.x) * Math.sin(hr) - (pW.z - p0.z) * Math.cos(hr);
const across = (pW.x - p0.x) * Math.cos(hr) + (pW.z - p0.z) * Math.sin(hr);
await p.screenshot({ path: join(SHOTS, 'v3-flying-forward.jpg'), quality: 80 });
await p.keyboard.up('KeyW');
check('V3 no arming step: W alone starts the motors; held 2 s it moves several metres in the facing direction', !armedBefore && armedW && along > 5 && Math.abs(across) < 1.5, { armedBefore, armedAfterW: armedW, alongM: r3(along), acrossM: r3(across), speed: r3(speedOf(pW)) }, false);
const yAtRelease = (await ev<Pos>(p, POS)).y;
const samples: number[] = [];
let under = -1;
const t0 = Date.now();
while (Date.now() - t0 < 2600) { const a = await ev<Pos>(p, POS); samples.push(speedOf(a)); if (under < 0 && speedOf(a) < 0.5) under = Date.now() - t0; await sleep(100); }
const afterRelease = await ev<Pos>(p, POS);
check('V4 released: under 0.5 m/s within 2.5 s and the height held', under >= 0 && under <= 2500 && Math.abs(afterRelease.y - yAtRelease) < 0.6 && speedOf(afterRelease) < 0.5, { underMs: under, speedAfter: r3(speedOf(afterRelease)), heightChangeM: r3(afterRelease.y - yAtRelease), speedEvery100ms: samples.map(r3) });
await sleep(1500);

// ------------------------------------------------------------------ the mouse: yaw turns, pitch tilts the camera
const a0 = await ev<Any>(p, 'return h.play().game;');
const cam0 = await ev<Any>(p, CAMERA);
await moveMouse(p, 400, 0);
await sleep(700);
const a1 = await ev<Any>(p, 'return h.play().game;');
const cam1 = await ev<Any>(p, CAMERA);
const dAim = wrap((a1?.aimYawDeg ?? 0) - (a0?.aimYawDeg ?? 0));
const headChange = wrap((a1?.headingDeg ?? 0) - (a0?.headingDeg ?? 0));
check('V5 moving the mouse right 400 px turns the aim 40 degrees (0.1 deg per pixel) and the drone follows; the camera looks along the aim', !!a1 && Math.abs(dAim - 40) < 3 && Math.abs(headChange - 40) < 5 && Math.abs(wrap(cam1.heading - cam0.heading) - 40) < 5, { aimChangeDeg: r3(dAim), headingChangeDeg: r3(headChange), cameraHeadingChangeDeg: r3(wrap(cam1.heading - cam0.heading)), delivery });
await moveMouse(p, 0, -200);
await sleep(400);
const a2 = await ev<Any>(p, 'return h.play().game;');
const cam2 = await ev<Any>(p, CAMERA);
await p.screenshot({ path: join(SHOTS, 'v6-gimbal-up.jpg'), quality: 80 });
await moveMouse(p, 0, 2000, 20);
await sleep(400);
const a3 = await ev<Any>(p, 'return h.play().game;');
const cam3 = await ev<Any>(p, CAMERA);
await p.screenshot({ path: join(SHOTS, 'v6-gimbal-down.jpg'), quality: 80 });
check('V6 the mouse up and down tilts the camera gimbal (+20 deg for 200 px up), clamped at +30 and -60, the body stays as it is', !!a2 && Math.abs(a2.gimbalDeg - 20) < 2.5 && Math.abs(cam2.pitch - a2.gimbalDeg) < 2 && !!a3 && Math.abs(a3.gimbalDeg + 60) < 0.01 && Math.abs(cam3.pitch + 60) < 2, { gimbalAfterUp: a2?.gimbalDeg, cameraPitchUp: r3(cam2.pitch), gimbalAfterDown: a3?.gimbalDeg, cameraPitchDown: r3(cam3.pitch) });
await moveMouse(p, 0, -600, 12);
await moveMouse(p, 0, -300, 6); // beyond +30: the clamp
const a4 = await ev<Any>(p, 'return h.play().game;');
check('V6b the gimbal stops at +30 degrees going up', !!a4 && Math.abs(a4.gimbalDeg - 30) < 0.01, { gimbalDeg: a4?.gimbalDeg });
await moveMouse(p, 0, 300, 6); // back to the level view
await sleep(200);

// ------------------------------------------------------------------ Space climbs, released holds
const yS0 = (await ev<Pos>(p, POS)).y;
await p.keyboard.down('Space');
await sleep(1800);
const climb = await ev<Pos>(p, POS);
await p.keyboard.up('Space');
await sleep(2500);
const hold: number[] = [];
for (let i = 0; i < 20; i++) { hold.push((await ev<Pos>(p, POS)).y); await sleep(150); }
check('V7 Space climbs at about 5 m/s (normal) and, released, the height holds', climb.vy > 3.2 && climb.y - yS0 > 3 && Math.max(...hold) - Math.min(...hold) < 0.4, { climbMps: r3(climb.vy), gainedM: r3(climb.y - yS0), holdSpreadM: r3(Math.max(...hold) - Math.min(...hold)) });
// Shift descends in the air (walls off here; the landing is on a real floor below)
const yD0 = (await ev<Pos>(p, POS)).y;
await p.keyboard.down('ShiftLeft');
await sleep(1200);
const down = await ev<Pos>(p, POS);
await p.keyboard.up('ShiftLeft');
check('V7b Shift descends', yD0 - down.y > 2 && down.vy < -2, { lostM: r3(yD0 - down.y), vy: r3(down.vy) });
await sleep(1500);

// ------------------------------------------------------------------ the mode: the game keys fly angle
await p.keyboard.press('KeyM');
await sleep(300);
const note = await p.evaluate(`document.querySelector('.hud-note')?.textContent ?? null`);
const modeNow = await ev<string>(p, 'return h.controls.flyingMode();');
check('V8 M does not leave angle mode (the game keys command tilts); it says so', modeNow === 'angle' && note === EN['play.game.angleOnly'], { mode: modeNow, note });

// ------------------------------------------------------------------ settings: invert-Y, sensitivity, speed
await ev(p, 'h.prefs.set("input.mouseInvertY", true); h.prefs.set("input.mouseSensitivity", 2); return 0;');
const g0 = (await ev<Any>(p, 'return h.play().game;'));
await moveMouse(p, 100, -100);
const g1 = (await ev<Any>(p, 'return h.play().game;'));
check('V9 invert-Y flips the pitch of the same movement; sensitivity 2 doubles the turn (100 px = 20 degrees)', !!g1 && (g1.gimbalDeg - g0.gimbalDeg) < -15 && Math.abs(wrap(g1.aimYawDeg - g0.aimYawDeg) - 20) < 2.5, { gimbalChange: r3((g1?.gimbalDeg ?? 0) - g0.gimbalDeg), yawChange: r3(wrap((g1?.aimYawDeg ?? 0) - g0.aimYawDeg)) });
await ev(p, 'h.prefs.set("input.mouseInvertY", false); h.prefs.set("input.mouseSensitivity", 1); h.prefs.set("input.gameSpeed", "slow"); return 0;');
await moveMouse(p, 0, 400, 8);
await p.keyboard.down('KeyW');
await sleep(3500);
const slowV = speedOf(await ev<Pos>(p, POS));
await p.keyboard.up('KeyW');
await ev(p, 'h.prefs.set("input.gameSpeed", "normal"); return 0;');
check('V9b the speed setting: slow flies about 4 m/s', Math.abs(slowV - 4) < 1, { speed: r3(slowV) });
await sleep(2500);

// ------------------------------------------------------------------ F: full screen, with the mouse captured; Shift+F: next favourite
const fsBefore = await ev<Any>(p, 'return { full: document.fullscreenElement !== null, locked: document.pointerLockElement !== null };');
await p.keyboard.press('KeyF');
await sleep(900);
const fsOn = await ev<Any>(p, 'return { full: document.fullscreenElement !== null, locked: document.pointerLockElement !== null, flash: document.querySelector(".hud-note")?.hidden === false ? document.querySelector(".hud-note").textContent : null, pressed: document.querySelector("[data-action=fullscreen-toggle]")?.getAttribute("aria-pressed") ?? null };');
await p.screenshot({ path: join(SHOTS, 'v10-full-screen.jpg'), quality: 80 });
await p.keyboard.press('KeyF');
await sleep(900);
const fsOff = await ev<Any>(p, 'return { full: document.fullscreenElement !== null, locked: document.pointerLockElement !== null };');
check('V10 F puts the page full screen (document.fullscreenElement set) and F again leaves it', !fsBefore.full && fsOn.full === true && fsOff.full === false, { before: fsBefore.full, afterF: fsOn.full, afterSecondF: fsOff.full, pressedWhileOn: fsOn.pressed });
check('V10b the mouse stays captured through full screen on and off', fsBefore.locked && fsOn.locked && fsOff.locked, { locked: [fsBefore.locked, fsOn.locked, fsOff.locked] });
// the top-bar button does the same
await ev(p, 'document.pointerLockElement && document.exitPointerLock(); return 0;');
await sleep(300);
await p.keyboard.press('Escape'); // a resumed menu if the lock loss paused
await sleep(300);
const btn = p.locator('[data-action="fullscreen-toggle"]');
const btnShown = (await btn.count()) > 0 && (await btn.isVisible());
let btnWorks = false;
if (btnShown) {
    // a pause menu may be up: the button is on the top bar either way
    await btn.click();
    await sleep(800);
    const on = await ev<boolean>(p, 'return document.fullscreenElement !== null;');
    await btn.click();
    await sleep(800);
    const off = await ev<boolean>(p, 'return document.fullscreenElement !== null;');
    btnWorks = on && !off;
}
check('V10c a button on the top bar toggles full screen too', btnShown && btnWorks, { shown: btnShown, toggles: btnWorks });
// back to flying with the mouse captured: close any menu, click
await ev(p, 'const m = document.querySelector("[data-action=\\"pause.continue\\"]"); if (m) m.click(); return 0;');
await sleep(300);
await p.mouse.click(centre.x, centre.y);
await sleep(500);
// Shift+F: the next favourite (none saved: its own note); plain F must not show that note
await ev(p, 'document.querySelector(".hud-note") && (document.querySelector(".hud-note").hidden = true); return 0;');
await p.keyboard.down('Shift');
await p.keyboard.press('KeyF');
await sleep(500);
await p.keyboard.up('Shift');
const favNote = await p.evaluate(`(() => { const n = document.querySelector('.hud-note'); return n && !n.hidden ? n.textContent : null; })()`);
await sleep(3200);
await ev(p, 'document.querySelector(".hud-note") && (document.querySelector(".hud-note").hidden = true); return 0;');
await p.keyboard.press('KeyF');
await sleep(700);
const fNote = await p.evaluate(`(() => { const n = document.querySelector('.hud-note'); return n && !n.hidden ? n.textContent : null; })()`);
const fsAfterF = await ev<boolean>(p, 'return document.fullscreenElement !== null;');
if (fsAfterF) { await p.keyboard.press('KeyF'); await sleep(700); }
check('V11 Shift+F is the next favourite scene (its note when none is saved); plain F is not', favNote === EN['rotation.noFavourite'] && fNote !== EN['rotation.noFavourite'] && fsAfterF === true, { shiftF: favNote, plainF: fNote, plainFfullScreen: fsAfterF });

// ------------------------------------------------------------------ Esc: the mouse is released and the flight pauses; a click resumes
await p.mouse.click(centre.x, centre.y);
await sleep(500);
const beforeEsc = await ev<Any>(p, 'return { locked: document.pointerLockElement !== null, paused: s.paused };');
await ev(p, 'document.exitPointerLock(); return 0;'); // what the browser does for Esc
await sleep(700);
const afterEsc = await ev<Any>(p, 'return { locked: document.pointerLockElement !== null, paused: s.paused, menu: !!document.querySelector(".pause-menu") };');
await p.screenshot({ path: join(SHOTS, 'v12-paused.jpg'), quality: 80 });
await p.mouse.click(centre.x + 300, centre.y - 250); // the view around the menu
await sleep(900);
const afterClick = await ev<Any>(p, 'return { locked: document.pointerLockElement !== null, paused: s.paused, menu: !!document.querySelector(".pause-menu") };');
check('V12 the mouse released (what Esc does) pauses into the menu; a click on the view resumes and captures the mouse again', beforeEsc.locked && !beforeEsc.paused && !afterEsc.locked && afterEsc.paused && afterEsc.menu && afterClick.locked && !afterClick.paused && !afterClick.menu, { beforeEsc, afterEsc, afterClick });
// the Escape key itself (the page's key): pauses; Esc again resumes
await p.keyboard.press('Escape');
await sleep(500);
const keyPaused = await ev<boolean>(p, 'return s.paused;');
await p.keyboard.press('Escape');
await sleep(500);
const keyResumed = !(await ev<boolean>(p, 'return s.paused;'));
check('V12b the Escape key pauses and Escape resumes', keyPaused && keyResumed, { paused: keyPaused, resumed: keyResumed }, false);
// Shift held to land does not stop the shortcuts: Esc with Shift held still pauses
await p.mouse.click(centre.x, centre.y);
await sleep(400);
await p.keyboard.down('Shift');
await p.keyboard.press('Escape');
await sleep(500);
const shiftEsc = await ev<boolean>(p, 'return s.paused;');
await p.keyboard.up('Shift');
await p.keyboard.press('Escape');
await sleep(500);
check('V12c Esc pauses while Shift is held (the descent)', shiftEsc, { paused: shiftEsc });
await p.mouse.click(centre.x, centre.y);
await sleep(500);

// ------------------------------------------------------------------ the log replays without the assist
const rep = await ev<Any>(p, `const e = h.saveLog("v09-keys"); const v = h.verifyLastLog(); const at = Math.floor(s.sim.tick / 2);
    const lsb = h.verifyLastLog({ atTick: at, channel: 2 }); const tw = h.verifyLastLog({ atTick: at, channel: 0, delta: 0.05 });
    return { saved: e.hash, replayed: v.hash, endTick: v.endTick, refused: v.refused ?? null, lsb: { differs: lsb.hash !== v.hash }, twitch: { differs: tw.hash !== v.hash } };`);
check('V13 the game-scheme flight replays from its log to the same hash; controls: one LSB of the throttle and a 0.05 stick twitch change it', rep.saved === rep.replayed && !!rep.saved && !rep.refused && rep.lsb.differs && rep.twitch.differs, rep);
const errs = L.console.filter((l) => l.startsWith('pageerror'));
check('V14 no page errors', errs.length === 0, { errors: errs.slice(0, 5) }, false);
await L.browser.close();

// ------------------------------------------------------------------ the pilot profile stays selectable; Ctrl is not a flying key
{
    const C = await launch({ width: 1280, height: 800 });
    await keyboardFlight(C.page, 'set.input.play=pilot', true);
    const cbox = (await C.page.locator('canvas').first().boundingBox())!;
    await C.page.mouse.click(cbox.x + cbox.width / 2, cbox.y + cbox.height / 2);
    await sleep(500);
    const lockedPilot = await ev<boolean>(C.page, 'return document.pointerLockElement !== null;');
    await C.page.keyboard.down('KeyW');
    await sleep(1200);
    await C.page.keyboard.up('KeyW');
    const wArmed = await ev<boolean>(C.page, 'return s.sim.armed;');
    const title = await C.page.evaluate(`document.querySelector('[data-testid="key-card"] h3')?.textContent ?? null`);
    check('V15 the pilot profile (Mode 2) is still selectable: no mouse capture on a click, W is a throttle that does not arm, its card is the Mode 2 one', !lockedPilot && !wArmed && title === EN['arm.keys.title'], { lockedPilot, wArmed, title }, false);
    await C.browser.close();
}

// ------------------------------------------------------------------ landing on a real floor (walls on)
{
    const W = await launch({ width: 1280, height: 800 });
    await keyboardFlight(W.page, 'x=1', false);
    const wbox = (await W.page.locator('canvas').first().boundingBox())!;
    await W.page.mouse.click(wbox.x + wbox.width / 2, wbox.y + wbox.height / 2);
    await sleep(500);
    await ev(W.page, 'h.events.length = 0; return 0;');
    await W.page.keyboard.down('Space');
    await sleep(900);
    await W.page.keyboard.up('Space');
    await sleep(1500);
    const up = await ev<Pos>(W.page, POS);
    await W.page.screenshot({ path: join(SHOTS, 'v16-before-landing.jpg'), quality: 80 });
    await W.page.keyboard.down('ShiftLeft');
    let landed = false;
    const lt0 = Date.now();
    while (Date.now() - lt0 < 12000 && !landed) { await sleep(150); landed = !(await ev<boolean>(W.page, 'return s.sim.armed;')); }
    await W.page.keyboard.up('ShiftLeft');
    const post = await ev<Any>(W.page, 'return { armed: s.sim.armed, crashed: s.sim.crashed, y: s.sim.s[1], crashes: h.events.filter((e) => e.type === "crash").length, contacts: h.events.filter((e) => e.type === "contact").map((e) => e.speed) };');
    await W.page.screenshot({ path: join(SHOTS, 'v16-landed.jpg'), quality: 80 });
    check('V16 holding Shift lands without a crash (touch-down below the crash speed) and the motors stop by themselves', landed && !post.crashed && post.crashes === 0 && up.y - post.y > 0.3, { climbedToY: r3(up.y), endY: r3(post.y), crashes: post.crashes, contactSpeeds: (post.contacts as number[]).map(r3), armedAfter: post.armed, tookMs: Date.now() - lt0 });
    await W.page.keyboard.down('KeyW');
    await sleep(1500);
    await W.page.keyboard.up('KeyW');
    const again = await ev<Any>(W.page, 'return { armed: s.sim.armed, y: s.sim.s[1] };');
    check('V16b the next key starts the motors again and the drone lifts off', again.armed === true && again.y > post.y + 0.4, { armed: again.armed, y: r3(again.y), from: r3(post.y) });
    await W.browser.close();
}

// ------------------------------------------------------------------ the verdict
const failed = checks.filter((c) => !c.ok);
const notDiscriminating = checks.filter((c) => !c.discriminating).map((c) => c.id);
const discriminating = checks.filter((c) => c.discriminating);
const controlOk = discriminating.every((c) => !c.ok);
const passed = CONTROL ? controlOk : failed.length === 0;
const file = writeEvidence(CONTROL ? 'v09-keys-control' : 'v09-keys', { site: SITE, control: CONTROL, delivery, passed, controlAllDiscriminatingFail: CONTROL ? controlOk : null, notDiscriminating, checks });
console.log(`${CONTROL ? 'CONTROL' : 'ACCEPT'} ${passed ? 'PASS' : 'FAIL'}: ${checks.length - failed.length}/${checks.length} checks pass${CONTROL ? `; ${discriminating.filter((c) => c.ok).length} discriminating checks passed on the base build (must be 0)` : ''}. Evidence ${file}`);
process.exit(passed ? 0 : 1);
