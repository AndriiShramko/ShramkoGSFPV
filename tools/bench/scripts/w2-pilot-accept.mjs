// Lane w2-pilot (train 5), S4: the acceptance by the MOUSE of a pilot's three asks (vault brief lines 668-669): the drone
// breaks too fast when it touches the ground; no way to choose a scene again (only next or random); the camera angle setting
// was hard to find. Headless Chrome through tools/bench/src/chrome.mjs, 1536 x 730 at device scale 1.25, fresh profiles,
// ?render=off (no picture judged). The keyboard's pilot keys (set.input.play=pilot: W/S throttle stays where left, Space arms)
// fly straight up and cut the throttle: a free fall onto the scan's floor at a measured speed.
//
// Steps, each PASS or FAIL in one JSON:
//   capture  Controls: the keyboard (a click), then a click into the scene takes the pointer
//   gentle   (scene 7a475d38) a touch of the ground, the model's own contact event (normal up), at 4.6..6.9 m/s (above the
//            old 4 m/s crash speed, below the new 7 m/s):
//            the craft stays whole (not crashed, still armed, no crash counted); one drop from the spawn disc, at most 3 fresh profiles
//   hard     (scene 887f27aa) a fall from about 4.6 m: the craft crashes on the ground above 7 m/s (the normal points up)
//   cardPick after the crash the toast's key Enter keeps the wreck (default: respawn.auto counts down); the crash card's first scene button is "Choose a scan" (data-action scene-pick); a click opens the catalogue
//            (the start page's ScenePicker over the flight), a click on another scene loads it and the craft climbs there
//   pausePick Escape opens the pause menu; its item (data-action pause.scene) reads the catalogue title "Choose a scan";
//            a click opens the catalogue, a click on another scene loads it and the craft climbs there
//   cameraEn, cameraPl  a first visit's "Before you fly" shows the camera angle line (data-testid camera-line) inside
//            the view, naming key O and the Settings path, in en and in pl
// It never presses a send, save or create button; the cookie question is declined; every non-GET request and the usage
// counter /api/e are aborted in the browser (nothing is sent to the site); nothing is stored outside the profiles.
// Usage: node tools/bench/scripts/w2-pilot-accept.mjs <base without the locale, e.g. http://localhost:7401> <out.json>
// Prints PASS/FAIL lines on stderr and one JSON verdict as the last stdout line; exit 1 on a failure.
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { pickBrowser } from '../src/chrome.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '');
const require = createRequire(ROOT + '/tools/bench/package.json');
const { chromium } = require('playwright');
const [base0 = 'http://localhost:7401', outFile = 'U:/Temp/gsfpv-train4/w2-pilot/accept.json'] = process.argv.slice(2);
const base = base0.replace(/\/$/, '');
const VIEW = { width: 1536, height: 730 };
const SCENE = '39e63ce9';
const T0 = Date.now();
const log = (...a) => console.error(`[${((Date.now() - T0) / 1000).toFixed(0).padStart(4)}s]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const steps = {};
const step = (id, pass, facts) => {
    steps[id] = { pass: !!pass, ...facts };
    log(id, pass ? 'PASS' : 'FAIL', JSON.stringify(facts).slice(0, 500));
};

const pick = pickBrowser({ expected: chromium.executablePath() });
const browser = await chromium.launch({ ...pick.launch });
const errors = [];
/** non-GET requests the pages asked for, with whether the route stopped them */
const sent = [];
function page0Sent(ctx) {
    ctx.on('request', (r) => { if (r.method() !== 'GET') sent.push({ method: r.method(), url: r.url().slice(0, 120), api: new URL(r.url()).pathname.startsWith('/api/') }); });
}
async function fresh(url) {
    const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 1.25 });
    // nothing leaves the browser for the site's API: the usage counter (/api/e, a sendBeacon POST the page sends even with
    // the cookie question declined) and any other non-GET request to /api/ are aborted, here and on the live site alike
    // (routing every request instead stalls the scan downloads); any non-GET elsewhere is listed in the verdict
    await ctx.route((u) => u.pathname.startsWith('/api/'), (r) => (r.request().method() !== 'GET' || /\/api\/e$/.test(new URL(r.request().url()).pathname) ? r.abort() : r.continue()));
    page0Sent(ctx);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)));
    await page.goto(url, { waitUntil: 'load', timeout: 120000 });
    return { ctx, page };
}
async function declineConsent(page) {
    const c = await page.waitForSelector('[data-action=consent-decline]', { timeout: 4000, state: 'visible' }).then(() => true, () => false);
    if (c) await page.locator('[data-action=consent-decline]').click();
    return c;
}
const locked = (page) => page.evaluate(() => document.pointerLockElement !== null);
async function capture(page) {
    for (let i = 0; i < 6; i++) {
        if (await locked(page)) return true;
        await page.mouse.click(VIEW.width / 2, VIEW.height / 2 + 40);
        await sleep(400);
        if (await locked(page)) return true;
        await sleep(900);
    }
    return false;
}
const hud = (page) => page.evaluate(() => window.__gsfpv?.session?.hud?.() ?? null).catch(() => null);
/** an in-page sampler of the HUD (every 4 ms): the impact speed is the fastest sample of a fall */
const startSampler = (page) => page.evaluate(() => {
    const w = window;
    w.__w2 = { s: [] };
    setInterval(() => {
        let h = null;
        try {
            h = w.__gsfpv?.session?.hud?.(); // none while a scene switch builds the next session
        } catch {
            return;
        }
        if (!h) return;
        w.__w2.s.push([performance.now(), h.altitude, h.speed, h.crashed ? 1 : 0, h.armed ? 1 : 0]);
        if (w.__w2.s.length > 20000) w.__w2.s.splice(0, 10000);
    }, 4);
});
const samplesSince = (page, t) => page.evaluate((k) => window.__w2.s.filter((x) => x[0] >= k), t);
const pageNow = (page) => page.evaluate(() => performance.now());
/** the craft's horizontal place (m) */
const xz = (page) => page.evaluate(() => { const s = window.__gsfpv?.session?.shownSim?.s; return s ? [s[0], s[2]] : null; }).catch(() => null);

/** climb to `h` m above the floor `g`, cut the throttle, let it fall and settle; the fall's numbers */
async function drop(page, g, h) {
    const before = await hud(page);
    const xz0 = await xz(page);
    if (!before?.armed) {
        await page.keyboard.press('Space');
        await sleep(400);
    }
    // a slow climb (about 1 m/s): the throttle near the hover, then short taps of W and S (the craft is strong: a firm
    // throttle climbs at 9 m/s and overshoots into whatever stands above)
    const tap = async (k, ms) => { await page.keyboard.down(k); await sleep(ms); await page.keyboard.up(k); };
    if ((before?.throttlePct ?? 0) < 40) await tap('KeyW', 250);
    let s = await hud(page);
    let prev = s;
    let tPrev = Date.now();
    const tUp = Date.now();
    while (Date.now() - tUp < 12000 && s && !s.crashed && s.altitude - g < h) {
        await sleep(60);
        s = await hud(page);
        const now = Date.now();
        const vy = s && prev ? (s.altitude - prev.altitude) / ((now - tPrev) / 1000) : 0;
        prev = s;
        tPrev = now;
        if (vy > 1.5) await tap('KeyS', 15);
        else if (vy < 0.5) await tap('KeyW', 15);
    }
    const climbed = s ? s.altitude - g : null;
    const xzCut = await xz(page);
    const tCut = await pageNow(page);
    const tickCut = await page.evaluate(() => window.__gsfpv?.session?.shownSim?.tick ?? 0).catch(() => 0);
    await page.keyboard.down('KeyS');
    await sleep(450); // throttle to 0
    await page.keyboard.up('KeyS');
    const tFall = Date.now();
    for (;;) {
        await sleep(100);
        s = await hud(page);
        if (!s || s.crashed || Date.now() - tFall > 6000) break;
        if (s.speed < 0.2 && s.altitude - g < 0.3) break;
    }
    await sleep(300);
    const after = await hud(page);
    const xzEnd = await xz(page);
    const away = (a, b) => (a && b ? Number(Math.hypot(a[0] - b[0], a[1] - b[1]).toFixed(2)) : null);
    const xs = await samplesSince(page, tCut);
    const impact = xs.reduce((m, x) => Math.max(m, x[2]), 0);
    const peak = xs.reduce((m, x) => Math.max(m, x[1]), -Infinity) - g;
    // the model's own numbers: its two crash speeds and the last crash event (speed, the surface's normal)
    // and the hardest touch of the ground after the cut (contact events, normal up: ny >= 0.7, as sim-core's GROUND_NY)
    const model = await page.evaluate((t0) => {
        const ss = window.__gsfpv?.session;
        const ev = ss?.runner?.events ?? [];
        const c = [...ev].reverse().find((e) => e.type === 'crash');
        const r = (x) => (typeof x === 'number' ? Math.round(x * 100) / 100 : null);
        const g = ev.filter((e) => e.tick >= t0 && (e.type === 'contact' || e.type === 'crash') && e.ny >= 0.7).reduce((m, e) => (m && m.speed >= e.speed ? m : e), null);
        return { vCrash: r(ss?.params?.vCrash), vCrashGround: r(ss?.params?.vCrashGround), lastCrash: c ? { speed: r(c.speed), ny: r(c.ny) } : null, groundTouch: g ? { type: g.type, speed: r(g.speed), ny: r(g.ny) } : null };
    }, tickCut).catch(() => null);
    return { model, h, peak: Number(peak.toFixed(2)), driftCut: away(xz0, xzCut), driftEnd: away(xz0, xzEnd), climbed: climbed === null ? null : Number(climbed.toFixed(2)), impact: Number(impact.toFixed(2)), crashed: !!after?.crashed, armed: !!after?.armed, crashes: after?.crashes ?? null, crashesBefore: before?.crashes ?? null, alt: after ? Number((after.altitude - g).toFixed(2)) : null };
}

const picker = '[data-testid=scenes-in-flight]';
/** the catalogue over the flight is up; a click on a scene card other than `not`; its load and a climb there */
async function pickAndFly(page, not, keys) {
    const shown = await page.waitForSelector(picker, { timeout: 8000, state: 'visible' }).then(() => true, () => false);
    if (!shown) return { shown };
    await sleep(800);
    const cards = await page.$$eval(`${picker} .scene-card[data-scene]`, (bs) => bs.filter((b) => b.getBoundingClientRect().height > 0).map((b) => b.getAttribute('data-scene')));
    const id = cards.find((x) => x && x !== not);
    if (!id) return { shown, cards: cards.length };
    const n0 = await page.evaluate(() => (window.__gsfpv?.scenes?.log ?? []).length).catch(() => 0);
    await page.locator(`${picker} .scene-card[data-scene="${id}"]`).first().click();
    const loaded = await page.waitForFunction(([want, n]) => { const r = window.__gsfpv?.scenes?.log ?? []; return r.length > n && r.at(-1).to === want && r.at(-1).ok && window.__gsfpv?.status === 'ready'; }, [id, n0], { timeout: 180000 }).then(() => true, () => false);
    const rec = await page.evaluate(() => (window.__gsfpv?.scenes?.log ?? []).at(-1) ?? null).catch(() => null);
    await sleep(1500);
    const gone = !(await page.locator(picker).isVisible().catch(() => false));
    const captured = await capture(page);
    const s0 = await hud(page);
    let top = -Infinity;
    const watch = async (n) => {
        for (let i = 0; i < n; i++) {
            await sleep(100);
            const s = await hud(page);
            top = Math.max(top, (s?.altitude ?? -Infinity) - (s0?.altitude ?? 0));
        }
    };
    if (keys === 'pilot') {
        // Space arms (only when not armed: it is the arm switch), W sets the throttle, S cuts it
        if (!s0?.armed) await page.keyboard.press('Space');
        await sleep(300);
        await page.keyboard.down('KeyW');
        await sleep(380);
        await page.keyboard.up('KeyW');
        await watch(15);
        await page.keyboard.down('KeyS');
        await sleep(450);
        await page.keyboard.up('KeyS');
    } else {
        // the default keys: Space held climbs (and starts the motors)
        await page.keyboard.down('Space');
        await watch(15);
        await page.keyboard.up('Space');
    }
    return { shown, cards: cards.length, id, loaded, rec, pickerGone: gone, captured, climbed: Number(top.toFixed(2)), flies: top >= 0.5 };
}

/** a fresh profile on the flight page: the cookie question declined, the keyboard chosen on Controls */
async function flightPage(scene, extra) {
    const v = await fresh(`${base}/en/fly/?scene=${scene}&nowarn=1&render=off&set.input.howToFly=false${extra}`);
    await v.page.waitForFunction(() => window.__gsfpv?.status === 'ready', null, { timeout: 180000 });
    await declineConsent(v.page);
    v.controls = await v.page.waitForSelector('.screen.radio [data-action=radio-keyboard]', { timeout: 15000 }).then(() => true, () => false);
    if (v.controls) await v.page.locator('.screen.radio [data-action=radio-keyboard]').click();
    await v.page.waitForFunction(() => !document.querySelector('.screen.radio'), null, { timeout: 15000 }).catch(() => {});
    await sleep(1000);
    return v;
}

try {
    // ---------------------------------------------------------------- the default keys: the pointer, Escape, the catalogue
    {
        const { ctx, page } = await flightPage(SCENE, '');
        const cap = await capture(page);
        step('capture', ctx && cap, { controls: true, pointerLock: cap });
        await page.keyboard.press('Escape');
        let menu = await page.waitForSelector('.pause-menu', { timeout: 3000, state: 'visible' }).then(() => true, () => false);
        let key = 'Escape';
        if (!menu) {
            // the first Escape went to the browser (it releases the pointer); the page's own Escape opens the menu
            await page.keyboard.press('Escape');
            menu = await page.waitForSelector('.pause-menu', { timeout: 3000, state: 'visible' }).then(() => true, () => false);
            key = 'Escape x2';
        }
        const item = page.locator('.pause-menu [data-action="pause.scene"]').first();
        const label = menu ? ((await item.textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ').trim() : null;
        let viaPause = null;
        if (menu && (await item.isVisible().catch(() => false))) {
            await item.click();
            viaPause = await pickAndFly(page, SCENE, 'easy');
        }
        step('pausePick', menu && /Choose a scan/.test(label ?? '') && !!viaPause?.loaded && viaPause.pickerGone && viaPause.captured && viaPause.flies, { menu, key, label, viaPause });
        await ctx.close();
    }

    // ---------------------------------------------------------------- the pilot keys: the ground, the crash card
    // A craft spawns on the invisible one-way respawn disc (sim-core platform.ts, C.2); the disc goes once the craft climbs
    // off it, so a drop lands on the scan's own floor below the spawn. Heights here are above the spawn (measured locally:
    // 7a475d38 floor 1.2 m below, ceiling about 1.3 m above; 887f27aa floor 2.07 m below, ceiling about 3.4 m above).
    // The pilot keys take no pointer (the mouse turns the camera only with the default keys): the click is still the pilot's.
    const armOn = async (scene) => {
        const v = await flightPage(scene, '&set.input.play=pilot');
        await v.page.mouse.click(VIEW.width / 2, VIEW.height / 2 + 40);
        await startSampler(v.page);
        await v.page.keyboard.press('Space');
        await sleep(1500);
        v.rest = await hud(v.page);
        return v;
    };
    {
        // a gentle fall in a room: up off the spawn disc (it goes 1 m above it; the climb tops out about 1.35 m up), a free
        // fall of about 2.5 m onto the floor 1.2 m below the spawn. The keyboard's climb in a headless page varies, and so
        // does the touch (measured: 5.0 to 6.6 m/s, now and then above 7 when the craft spins): the step judges the RULE.
        // It passes when no drop crashed ON THE GROUND (ny >= 0.7) below 7 m/s and one drop touched the ground at
        // 4.6..6.9 m/s (the old default crashed from 4) and left the craft whole. A bounce into a steep spot (ny < 0.7)
        // stays as strict as a wall (the lead's decision A) and is reported; up to 3 fresh profiles.
        const scene = process.env.GENTLE_SCENE ?? '7a475d38';
        const tries = [];
        let ok = null;
        for (let run = 0; run < 3 && !ok; run++) {
            const v = await armOn(scene);
            const d = await drop(v.page, v.rest?.altitude ?? 0, 0.5);
            tries.push({ run, rest: !!v.rest?.armed, ...d });
            const touch = d.model?.groundTouch?.speed ?? 0;
            if (!d.crashed && touch >= 4.6 && touch <= 6.9) ok = d;
            await v.ctx.close();
            if (tries.some((d) => d.crashed && (d.model?.lastCrash?.ny ?? 0) >= 0.7 && (d.model?.lastCrash?.speed ?? 99) < 7)) break; // the ground broke it below 7 m/s: no retry
        }
        const groundCrash = tries.filter((d) => d.crashed && (d.model?.lastCrash?.ny ?? 0) >= 0.7 && (d.model?.lastCrash?.speed ?? 99) < 7);
        const slope = tries.filter((d) => d.crashed && (d.model?.lastCrash?.ny ?? 1) < 0.7).map((d) => ({ touch: d.model?.groundTouch, crash: d.model?.lastCrash }));
        step('gentle', !!ok && !ok.crashed && ok.armed && ok.crashes === ok.crashesBefore && groundCrash.length === 0, { scene, touch: ok?.model?.groundTouch ?? tries.at(-1)?.model?.groundTouch ?? null, groundCrash: groundCrash.map((d) => d.model?.lastCrash), slope, tries });
    }
    // a hard fall: 2.5 m above the spawn, about 4.6 m above the floor
    const DROP = process.env.HARD_SCENE ?? '887f27aa';
    const hv = await armOn(DROP);
    const { ctx, page } = hv;
    const hard = await drop(page, hv.rest?.altitude ?? 0, 2.5);
    step('hard', hard.crashed && (hard.model?.lastCrash?.speed ?? 0) > 7 && (hard.model?.lastCrash?.ny ?? 0) >= 0.7, { scene: DROP, hard });

    // the crash card: Choose a scan
    const crashed = !!(await hud(page))?.crashed;
    // respawn.auto (the default) shows a countdown toast first; its key Enter (crash.keep) keeps the wreck and the card comes
    const toast = await page.waitForSelector('[data-testid=crash-toast]', { timeout: 4000, state: 'visible' }).then((e) => e.textContent(), () => null);
    await page.keyboard.press('Enter');
    // the card's scene row (Next is in it on every version) visible
    const card = await page.waitForSelector('[data-action=scene-next]', { timeout: 10000, state: 'visible' }).then(() => true, () => false);
    const row = await page.evaluate(() => [...document.querySelectorAll('[data-action^="scene-"]')].filter((b) => b.getBoundingClientRect().height > 0 && !b.closest('[data-testid=scenes-in-flight]')).map((b) => ({ action: b.getAttribute('data-action'), text: (b.textContent ?? '').replace(/\s+/g, ' ').trim() })));
    const btn = page.locator('[data-action=scene-pick]').first();
    const hasPick = await btn.isVisible().catch(() => false);
    let viaCard = null;
    if (hasPick) {
        const box = await btn.boundingBox();
        if (await locked(page)) await page.evaluate(() => document.exitPointerLock());
        await sleep(300);
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        viaCard = await pickAndFly(page, DROP, 'pilot');
    }
    step('cardPick', crashed && card && hasPick && row[0]?.action === 'scene-pick' && /Choose a scan/.test(row[0]?.text ?? '') && row.some((r) => r.action === 'scene-next') && row.some((r) => r.action === 'scene-random') && !!viaCard?.loaded && viaCard.pickerGone && viaCard.flies, { crashed, toast: toast?.replace(/\s+/g, ' ').trim() ?? null, card, row, viaCard });
    await ctx.close();

    // ---------------------------------------------------------------- the camera line on a first visit, en and pl
    for (const [loc, id, want] of [['en', 'cameraEn', /Camera angle: key O .*Settings.*Camera.*uptilt/i], ['pl', 'cameraPl', /K.t kamery: klawisz O /]]) {
        const v = await fresh(`${base}/${loc}/fly/?scene=${SCENE}&render=off`);
        await v.page.waitForSelector('[data-action^="warning-"]', { timeout: 60000 }).catch(() => {});
        const line = await v.page.evaluate(() => {
            const e = document.querySelector('[data-testid=camera-line]');
            if (!e) return null;
            const r = e.getBoundingClientRect();
            return { text: (e.textContent ?? '').trim(), top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height), font: getComputedStyle(e).fontSize };
        });
        step(id, !!line && want.test(line.text) && line.h > 0 && line.top >= 0 && line.bottom <= VIEW.height, { line });
        await v.ctx.close();
    }
} catch (e) {
    errors.push(`probe: ${String(e).slice(0, 300)}`);
} finally {
    await browser.close().catch(() => undefined);
}
const ORDER = ['capture', 'pausePick', 'gentle', 'hard', 'cardPick', 'cameraEn', 'cameraPl'];
const pass = ORDER.every((id) => steps[id]?.pass);
const verdict = { probe: 'w2-pilot-accept', base, browser: pick.kind ?? null, view: '1536x730@1.25', at: new Date().toISOString(), pass, steps, errors, sent: { count: sent.length, outsideApi: sent.filter((x) => !x.api), first: sent.slice(0, 5) } };
mkdirSync(dirname(outFile), { recursive: true });
// ASCII only (the pl camera line as \u escapes): evidence lives outside locales/, where gate B18 forbids those letters
writeFileSync(outFile, JSON.stringify(verdict, null, 1).replace(/[^\x00-\x7f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`));
console.log(JSON.stringify({ probe: verdict.probe, base, pass, steps: Object.fromEntries(ORDER.map((id) => [id, steps[id] ? (steps[id].pass ? 'PASS' : 'FAIL') : 'NOT RUN'])), errors: errors.slice(0, 5) }));
process.exit(pass ? 0 : 1);
