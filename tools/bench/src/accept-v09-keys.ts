// v0.9 lane B acceptance (docs/wip/v09-b.md): keyboard and mouse like a game, and the full screen key, in the built
// release served locally:
//   SITE=http://localhost:<port> npx tsx src/accept-v09-keys.ts
// SITE is required (no default: this bench never runs against the live site by accident). Visible system Chrome, the
// scan drawn (screenshots in evidence/<date>/v09-b/); hold the GPU lock around the run (mkdir C:/dev/.gpu-lock).
// V09_CONTROL=1 is the negative control: the same bench against the base build (631fd5f), where every check that
// belongs to the new scheme must FAIL (a check that passes there does not tell the two builds apart and is listed
// in `notDiscriminating`); the control passes when none of the discriminating checks passes.
// What this does not prove: the mouse movement is a `mousemove` with movementX/Y made by the page (Chrome's input
// protocol delivers the wrong amount and sign under a real lock: see moveMouse), so the handler and the flight are
// proven, not the feel of a hand on a mouse; Esc as the BROWSER's own release gesture cannot be pressed from a test,
// so the lock is released with exitPointerLock() (what the browser does for Esc) and the Escape KEY is tested
// separately; a real hand and a real mouse on the owner's Chrome are not here.
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
const SHOTS = join(REPO, 'evidence', today(), CONTROL ? 'v09-b-control' : 'v09-b'); // the control must not overwrite the lane's screenshots
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

let strayMouse: unknown = null;
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
    // While the mouse is captured, a real mouse (a hand on this machine, another tool) moves the aim like the test's own
    // events do and spoils a measurement: real (trusted) mousemove events are dropped in the capture phase while the lock
    // is held, and counted (evidence: strayMouse). The test's events are untrusted and pass; clicks and moves with the
    // lock off pass as well.
    await p.addInitScript(`(() => {
        window.__stray = { n: 0, px: 0 };
        window.addEventListener('mousemove', (e) => {
            if (e.isTrusted && document.pointerLockElement) { window.__stray.n++; window.__stray.px += Math.abs(e.movementX) + Math.abs(e.movementY); e.stopImmediatePropagation(); }
        }, true);
    })();`);
    await p.goto(fly(qs));
    const r = await waitReady(p, 240000);
    if (r.status !== 'ready') throw new Error(`flight did not start: ${String(r.status)}`);
    await p.locator('[data-action="radio-close"]').click({ timeout: 15000 });
    for (let i = 0; i < 50 && (await ev(p, 'return h.controls.source;')) !== 'keyboard'; i++) await sleep(100);
    if (wallsOff) await ev(p, 'h.wallsSwitch.set(false); return 0;'); // the palms over the spawn stop a climb
    await sleep(2500); // detail streams in around the spawn
    // Chrome grants pointer lock only to a window the OS has focused (WrongDocumentError otherwise), and a mouse click
    // sent through Chrome's input protocol does not move the OS focus: a person's click does. This is the test's
    // stand-in for the window being in front, as it is when someone is playing.
    await p.bringToFront();
    await sleep(400);
}

/** A point on the view where a click lands on no button, link or panel: the "view around the menu". */
async function freePoint(p: Page): Promise<{ x: number; y: number }> {
    return p.evaluate(`(() => {
        const keeps = 'button, a, input, select, textarea, label, summary, .panel, .screen, .attribution, .top-actions, .mode-chip, .school-chip, .school-pop, .school-offer, .crash-overlay, [role="dialog"]';
        for (const y of [400, 300, 500, 200, 600, 150, 650]) for (const x of [20, 60, 1260, 1220, 100, 1180, 640]) {
            const el = document.elementFromPoint(x, y);
            if (el && !el.closest(keeps)) return { x, y };
        }
        return { x: 5, y: 400 };
    })()`) as Promise<{ x: number; y: number }>;
}

/**
 * The mouse moved by (dx, dy) px, delivered as the event a mouse makes under pointer lock: a `mousemove` with
 * movementX/Y, made by the page in `steps` pieces (the handler under test is the one that runs; the base build gets the
 * same events). Chrome's own input protocol is NOT used for the amounts: with the lock really engaged it was measured to
 * deliver the wrong amount and even the wrong sign (+400 px came out as -23.6 deg, +200 px up as the +30 clamp, in the
 * run of 2026-10-18; Chrome warps the locked cursor to the window centre and the synthetic absolute positions are read
 * against that), so it is no stand-in for a hand on a mouse. What is proven here is the handler's arithmetic and the
 * flight that follows; the feel of a real mouse on the owner's Chrome is not.
 */
const delivery = 'page-event';
async function moveMouse(p: Page, dx: number, dy: number, steps = 10): Promise<void> {
    for (let i = 0; i < steps; i++) {
        await p.evaluate(`(() => { document.dispatchEvent(new MouseEvent('mousemove', { movementX: ${dx / steps}, movementY: ${dy / steps}, bubbles: true })); })()`);
        await sleep(8);
    }
    await sleep(60);
}

const L = await launch({ width: 1280, height: 800 });
const p = L.page;
await keyboardFlight(p, 'x=1', true);
const ready = await ev<Any>(p, 'return { play: h.play(), mode: h.controls.flyingMode(), source: h.controls.source };');

// ------------------------------------------------------------------ the first run: the game card
// v0.10 lane K (docs/wip/v10-k.md): the game scheme's card moved from the ground (a translucent key card) to the How to fly card,
// which opens by itself on a real first visit (accept-v10-keys.ts) and with K here (this page has ?nowarn=1, a test page).
await p.keyboard.press('KeyK');
await sleep(500);
const card = await p.evaluate(`(() => { const c = document.querySelector('[data-testid="how-to-fly"]'); return c ? { kind: c.getAttribute('data-kind'), title: c.querySelector('h2')?.textContent, text: c.textContent.replace(/\\s+/g, ' ') } : null; })()`) as Any;
check('V1 the first-run card (K opens it here): "How to fly", the mouse, W A S D, Space, Shift, F, Esc', !!card && card.kind === 'game' && card.title === EN['play.card.title'] && /Mouse/.test(card.text) && /W.?A.?S.?D/.test(card.text) && /Space/.test(card.text) && /Shift/.test(card.text) && /F.*full screen/.test(card.text) && /Esc.*pause/.test(card.text), card ?? {});
await p.screenshot({ path: join(SHOTS, 'v1-first-run-card.jpg'), quality: 80 });
// Esc closes the card and the flight goes on. Not K, and not at once: the release of the card's pause asks for the mouse like every
// resume of a game-scheme flight, and the K press that opened the card is a user activation for 5 s, so the mouse would be captured
// before V2 measures the click that captures it. Waited out, Esc (no activation) closes the card and the mouse stays free
await sleep(5500);
await p.keyboard.press('Escape');
await sleep(400);

// ------------------------------------------------------------------ click to fly: pointer lock
const box = (await p.locator('canvas').first().boundingBox())!;
const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
const lockBefore = await ev<Any>(p, 'return { locked: document.pointerLockElement !== null, game: h.play().game };');
await p.mouse.click(centre.x, centre.y);
await sleep(600);
const lockAfter = await ev<Any>(p, 'const c = document.querySelector("canvas"); return { locked: document.pointerLockElement === c, game: h.play().game, hint: document.querySelector("[data-testid=game-hint]") ? !document.querySelector("[data-testid=game-hint]").hidden : null };');
check('V2 a click on the view captures the mouse (pointer lock on the canvas); before the click there is none', !lockBefore.locked && lockAfter.locked && lockAfter.game?.locked === true, { before: lockBefore.locked, after: lockAfter.locked, game: lockAfter.game?.locked ?? null });
// V2b (the ground card's title stops asking for a click once the mouse is captured) is retired with the ground card: the pill
// "Click to fly with the mouse" goes when the mouse is captured, which is V2's own check below (game.hintShown)
const pillGone = await ev<Any>(p, 'return h.play().game.hintShown;');
check('V2b with the mouse captured the "click to fly" pill is gone', pillGone === false, { hintShown: pillGone });
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
check('V7b Shift descends', yD0 - down.y > 2 && down.vy < -2, { lostM: r3(yD0 - down.y), vy: r3(down.vy) }, false); // not discriminating: the base build also loses height here (its motors were stopped by Space in V7)
await sleep(1500);

// ------------------------------------------------------------------ the mode: the game keys fly angle
await p.keyboard.press('KeyM');
await sleep(300);
const note = await p.evaluate(`document.querySelector('.hud-note')?.textContent ?? null`);
const modeNow = await ev<string>(p, 'return h.controls.flyingMode();');
check('V8 M does not leave angle mode (the game keys command tilts); it says so', modeNow === 'angle' && note === EN['play.game.angleOnly'], { mode: modeNow, note });

// ------------------------------------------------------------------ settings: invert-Y, sensitivity, speed
await ev(p, 'try { h.prefs.set("input.mouseInvertY", true); h.prefs.set("input.mouseSensitivity", 2); } catch (e) { /* the base build has no such settings */ } return 0;');
const g0 = (await ev<Any>(p, 'return h.play().game;'));
await moveMouse(p, 100, -100);
const g1 = (await ev<Any>(p, 'return h.play().game;'));
check('V9 invert-Y flips the pitch of the same movement; sensitivity 2 doubles the turn (100 px = 20 degrees)', !!g0 && !!g1 && (g1.gimbalDeg - g0.gimbalDeg) < -15 && Math.abs(wrap(g1.aimYawDeg - g0.aimYawDeg) - 20) < 2.5, { gimbalChange: r3((g1?.gimbalDeg ?? 0) - (g0?.gimbalDeg ?? 0)), yawChange: r3(wrap((g1?.aimYawDeg ?? 0) - (g0?.aimYawDeg ?? 0))) });
await ev(p, 'try { h.prefs.set("input.mouseInvertY", false); h.prefs.set("input.mouseSensitivity", 1); h.prefs.set("input.gameSpeed", "slow"); } catch (e) { /* the base build has no such settings */ } return 0;');
await moveMouse(p, 0, 400, 8);
await p.keyboard.down('KeyW');
await sleep(3500);
const slowV = speedOf(await ev<Pos>(p, POS));
await p.keyboard.up('KeyW');
await ev(p, 'try { h.prefs.set("input.gameSpeed", "normal"); } catch (e) { /* the base build has no such settings */ } return 0;');
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
// the pause menu is up and the mouse is free (as after Esc): the button is clicked there. With the mouse captured no
// button can be clicked at all (every mouse event goes to the locked canvas), which is why the lock is released first.
const btn = p.locator('[data-action="fullscreen-toggle"]');
const btnShown = (await btn.count()) > 0 && (await btn.isVisible());
let btnWorks = false;
let btnError: string | null = null;
if (btnShown) {
    // a pause menu may be up: the button is on the top bar either way. A click that cannot land (something covers the
    // button) is a failed check with the reason, not a crashed run.
    try {
        await btn.click({ timeout: 5000 });
        await sleep(800);
        const on = await ev<boolean>(p, 'return document.fullscreenElement !== null;');
        await btn.click({ timeout: 5000 });
        await sleep(800);
        const off = await ev<boolean>(p, 'return document.fullscreenElement !== null;');
        btnWorks = on && !off;
    } catch (e) {
        btnError = String((e as Error).message).split('\n').filter((l) => /intercepts|timeout/i.test(l)).slice(0, 2).join(' | ').slice(0, 300);
    }
}
check('V10c a button on the top bar toggles full screen too', btnShown && btnWorks, { shown: btnShown, toggles: btnWorks, error: btnError });
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
const around = await freePoint(p);
await p.mouse.click(around.x, around.y); // the view around the menu
await sleep(900);
const afterClick = await ev<Any>(p, 'return { locked: document.pointerLockElement !== null, paused: s.paused, menu: !!document.querySelector(".pause-menu") };');
check('V12 the mouse released (what Esc does) pauses into the menu; a click on the view resumes and captures the mouse again', beforeEsc.locked && !beforeEsc.paused && !afterEsc.locked && afterEsc.paused && afterEsc.menu && afterClick.locked && !afterClick.paused && !afterClick.menu, { beforeEsc, afterEsc, afterClick, clickedAt: around });
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
check('V13 the game-scheme flight replays from its log to the same hash; controls: one LSB of the throttle and a 0.05 stick twitch change it', rep.saved === rep.replayed && !!rep.saved && !rep.refused && rep.lsb.differs && rep.twitch.differs, rep, false);
const errs = L.console.filter((l) => l.startsWith('pageerror'));
strayMouse = await ev<Any>(p, 'return window.__stray || null;');
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
    const post = await ev<Any>(W.page, 'return { armed: s.sim.armed, crashed: s.sim.crashed, y: s.sim.s[1], vBounce: s.sim.p.vBounce, crashes: h.events.filter((e) => e.type === "crash").length, contacts: h.events.filter((e) => e.type === "contact").map((e) => e.speed) };');
    await W.page.screenshot({ path: join(SHOTS, 'v16-landed.jpg'), quality: 80 });
    const touchMax = Math.max(0, ...(post.contacts as number[]));
    check('V16 holding Shift lands without a crash, no body sphere touches faster than half the bounce speed (the earlier landing touched at 0.72 x on this scan, this one at 0.41 x), and the motors stop by themselves', landed && !post.crashed && post.crashes === 0 && up.y - post.y > 0.3 && touchMax < 0.5 * post.vBounce, { climbedToY: r3(up.y), endY: r3(post.y), crashes: post.crashes, touchMaxMps: r3(touchMax), limitMps: r3(0.5 * post.vBounce), contactSpeeds: (post.contacts as number[]).map(r3), armedAfter: post.armed, tookMs: Date.now() - lt0 });
    await W.page.keyboard.down('KeyW');
    await sleep(1500);
    await W.page.keyboard.up('KeyW');
    const again = await ev<Any>(W.page, 'return { armed: s.sim.armed, y: s.sim.s[1] };');
    check('V16b the next key starts the motors again and the drone lifts off', landed && again.armed === true && again.y > post.y + 0.4, { armed: again.armed, y: r3(again.y), from: r3(post.y) });
    await W.browser.close();
}

// ------------------------------------------------------------------ the verdict
const failed = checks.filter((c) => !c.ok);
const notDiscriminating = checks.filter((c) => !c.discriminating).map((c) => c.id);
const discriminating = checks.filter((c) => c.discriminating);
const controlOk = discriminating.every((c) => !c.ok);
const passed = CONTROL ? controlOk : failed.length === 0;
const file = writeEvidence(CONTROL ? 'v09-keys-control' : 'v09-keys', { site: SITE, control: CONTROL, delivery, strayMouse, passed, controlAllDiscriminatingFail: CONTROL ? controlOk : null, notDiscriminating, checks });
console.log(`${CONTROL ? 'CONTROL' : 'ACCEPT'} ${passed ? 'PASS' : 'FAIL'}: ${checks.length - failed.length}/${checks.length} checks pass${CONTROL ? `; ${discriminating.filter((c) => c.ok).length} discriminating checks passed on the base build (must be 0)` : ''}. Evidence ${file}`);
process.exit(passed ? 0 : 1);
