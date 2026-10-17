// v0.9 lane N acceptance (docs/wip/v09-n.md; the owner's items 9 and 11 of message 22). In the real page, on a
// local release (SITE=http://localhost:<port>, served by tools/bench/scripts/serve-csp.mjs), with the two API
// answers the tour reads MOCKED in every browser context (page.route): /api/catalog = 12 of the owner's real
// scenes in a chosen order (8 of them published without walls, like the live catalogue) and
// /api/superspl/explore = a short SuperSplat list (one of our own scenes, a legacy compressed-PLY scene and
// real scenes that open). Fresh browser contexts only; ?render=off (the scan is never drawn: flight logic).
//   N1  N from the first scene visits all 12 in the owner's order, then SuperSplat's first openable scene,
//       then the next; SuperSplat is not asked for before the 12th press; no scene twice; our own scene and the
//       legacy one in SuperSplat's list are passed over; the request is the SuperSplat tab's defaults.
//   N2  a returning visitor continues: after four N presses, a new page load of the first scene and N goes to
//       the fifth-after, not the second. Control: the stored position removed, N goes to the second.
//   N3  Shift+N (random) reaches every one of the 12 scenes, the wall-less ones included.
//   H1  the crash hint: none after the 1st and 2nd crash, there after the 3rd ("Press N for the next scene"),
//       taken away by its close button, none after the 4th and 5th, there again after the 6th; it is a status
//       line that takes no click and overlaps no other button, the crash toast or the crash panel; an N
//       press sets "N used". (touch variant at the 6th: a Next scene button in it that goes to the next scene.)
//   H2  never once N was used: N pressed, three crashes, no hint; and with the flag stored by an earlier visit.
//       Control: H1 (the same three crashes without N show it).
//   H3  a radio whose profile maps the next-scene function: the hint names the switch.
//   H4  a narrow phone: the hint overlaps neither the crash toast (at the top there) nor the top buttons.
// The 12 + 13 scene loads and the sim-radio wizard make it a long run (about 5 minutes).
//   SITE=http://localhost:5517 npx tsx src/accept-v09-next.ts [N1 N2 ...]
// Evidence: evidence/<date>/v09-next.json (+ v09-next/*.png). The same run against the base build (631fd5f) is the
// negative control: N1 stops at the 4 scenes with walls, N2 and every H check fail (EVIDENCE_SUFFIX=-base).
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Browser, BrowserContext, Page } from 'playwright';
import { launchChrome, waitReady } from './browser';
import { writeEvidence, REPO, today } from './evidence';

const SITE = (process.env.SITE ?? '').replace(/\/$/, '');
if (!SITE) throw new Error('SITE=http://localhost:<port> is required (a local release served by tools/bench/scripts/serve-csp.mjs)');
// the first line says what is being tested (accept-fly's rule: a run against the wrong target is no evidence)
console.log(`accept-v09-next target: ${SITE}`);
const fly = (qs: string) => `${SITE}/en/fly/?${qs}`;
const ONLY = process.argv.slice(2).map((x) => x.toUpperCase());
const want = (id: string) => ONLY.length === 0 || ONLY.includes(id);
const SHOTS = join(REPO, 'evidence', today(), 'v09-next' + (process.env.EVIDENCE_SUFFIX ?? ''));
mkdirSync(SHOTS, { recursive: true });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
/** Run `body` in the page with h = window.__gsfpv, s = its session (a string: tsx would wrap a function). */
const hook = <T = Any>(p: Page, body: string): Promise<T> => p.evaluate(`(() => { const h = window.__gsfpv; const s = h.session; ${body} })()`) as Promise<T>;
const wait = (p: Page, ms: number) => p.waitForTimeout(ms);

// ------------------------------------------------------------------ the mocked API answers
/** The owner's scenes (real ids, so the CDN answers) in the order the mocked catalogue lists them: [id, walls file published]. */
const ORDER: [string, boolean][] = [
    ['b11e45d1', true], ['70b50d42', false], ['887f27aa', true], ['ab5efa0e', false], ['d10c5638', false], ['39e63ce9', true],
    ['2f1ddf5f', false], ['ba7aa29d', false], ['7a475d38', true], ['9baef54b', false], ['0230d903', false], ['eb5f51dc', false]
];
const IDS = ORDER.map(([id]) => id);
/** SuperSplat's list as the mock serves it: an own scene (passed over), a legacy compressed PLY (passed over), then scenes that open. */
const SS_LIST: { id: string; format: string }[] = [
    { id: '39e63ce9', format: 'sog' }, { id: 'c67edb74', format: 'compressed.ply' }, { id: '58a989fb', format: 'sog' },
    { id: '3d37bda9', format: 'ssog' }, { id: '2f359069', format: 'sog' }, { id: '95d6b197', format: 'sog' }, { id: 'a6df26f1', format: 'ssog' }
];
const SS_EXPECT = ['58a989fb', '3d37bda9', '2f359069'];

interface Rec { explore: string[]; catalogue: number }
async function mocks(ctx: BrowserContext): Promise<Rec> {
    const rec: Rec = { explore: [], catalogue: 0 };
    await ctx.route(/\/api\/catalog(\?|$)/, (r) => {
        rec.catalogue++;
        const scenes = ORDER.map(([id, collision]) => ({ id, title: `Mock scene ${id}`, author: 'Andrii Shramko', license: 'CC BY 4.0', kind: 'other', collision, walls: 'on' }));
        return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ v: 1, published: '2026-10-17T00:00:00Z', collections: [], scenes }) });
    });
    await ctx.route(/\/api\/superspl\/explore/, (r) => {
        const u = new URL(r.request().url());
        rec.explore.push(u.search);
        const skip = Number(u.searchParams.get('skip') ?? 0);
        const limit = Number(u.searchParams.get('limit') ?? 24);
        const items = SS_LIST.slice(skip, skip + limit).map((x) => ({ id: x.id, version: 1, title: `SuperSplat ${x.id}`, author: 'someone', license: 'by', downloadable: true, likes: 5, views: 50, sizeBytes: 1000000, thumbs: {}, createdAt: '2026-10-01T00:00:00Z', description: '', format: x.format }));
        return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'x-cache': 'miss' }, body: JSON.stringify({ ok: true, total: SS_LIST.length, fetchedAt: 1760000000, items }) });
    });
    return rec;
}

interface Ctx { ctx: BrowserContext; page: Page; log: string[]; rec: Rec }
async function context(browser: Browser, o: { phone?: boolean; init?: string } = {}): Promise<Ctx> {
    const ctx = await browser.newContext(o.phone
        ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
        : { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    if (o.init) await ctx.addInitScript(o.init);
    const rec = await mocks(ctx);
    const page = await ctx.newPage();
    const log: string[] = [];
    page.on('console', (m) => log.push(`${m.type()}: ${m.text()}`.slice(0, 300)));
    page.on('pageerror', (e) => log.push(`pageerror: ${e.message}`.slice(0, 300)));
    return { ctx, page, log, rec };
}
const errors = (log: string[]) => log.filter((l) => l.startsWith('pageerror'));

/** Wait for the scene switch under way to end; its record. */
async function switched(p: Page, timeoutMs = 120000): Promise<Any> {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
        const st = await hook<Any>(p, 'return h.sceneSwitch ? { ...h.sceneSwitch } : null;');
        if (st && (st.state === 'done' || st.state === 'failed')) return st;
        await wait(p, 150);
    }
    return { state: 'timeout' };
}

/** Press a key that asks for a scene and wait for the switch; the scene flown afterwards. */
async function press(p: Page, key: string): Promise<{ sw: Any; scene: string }> {
    await hook(p, 'h.sceneSwitch = null; return 0;');
    await p.keyboard.press(key);
    const sw = await switched(p);
    await wait(p, 150);
    return { sw, scene: await hook<string>(p, 'return s.scene.id;') };
}

/** The page flying a scene with the keyboard as input (touch sticks are ready, N works the same). */
async function open(p: Page, scene: string): Promise<void> {
    await p.goto(fly(`scene=${scene}&nowarn=1&render=off&input=touch`));
    await waitReady(p, 180000);
    await wait(p, 400);
}

/** The simulated EdgeTX radio through the wizard (no button pressed but Fly), then flying: a real crash needs an armed craft. */
async function radioFlying(p: Page, scene: string): Promise<void> {
    await p.goto(fly(`scene=${scene}&simradio=raw&nobuttons=1&react=300&nowarn=1&render=off`));
    await waitReady(p, 180000);
    const t0 = Date.now();
    while (Date.now() - t0 < 90000) {
        if ((await hook<string | null>(p, 'const w = h.radio && h.radio.wizard; return w ? w.state.id : null;')) === 'check') break;
        await wait(p, 250);
    }
    await p.click('[data-action="wizard-done"]');
    await wait(p, 400);
}

/** A crash: a fresh flight model at the spawn without the platform, the threshold at the settings' lowest, armed: the drop crashes. */
async function crash(p: Page): Promise<boolean> {
    await hook(p, "h.fake.set('T', -1); h.fake.arm = false; h.prefs.set('respawn.platform', false); s.rebuildSim(s.presetId, { ...s.overrides, vCrash: 2 }); h.prefs.set('respawn.platform', true); return 0;");
    await wait(p, 400);
    await hook(p, 'h.fake.arm = true; return 0;');
    const t0 = Date.now();
    while (Date.now() - t0 < 8000) {
        if (await hook<boolean>(p, 'return !!s.sim.crashed;')) return true;
        await wait(p, 100);
    }
    return false;
}

/** `exists`: the element is in the page; `present`: it is on screen (not display: none, not hidden) */
interface HintView { exists: boolean; present: boolean; text: string; buttons: string[]; pointerEvents: string; rect: Rect | null; overlaps: string[] }
interface Rect { x: number; y: number; w: number; h: number }
/** The hint as the page shows it, and everything it overlaps (any visible button, the crash toast, the crash panel). */
async function hintView(p: Page): Promise<HintView> {
    return p.evaluate(`(() => {
        const el = document.querySelector('[data-testid="next-hint"]');
        if (!el) return { exists: false, present: false, text: '', buttons: [], pointerEvents: '', rect: null, overlaps: [] };
        const r = el.getBoundingClientRect();
        const shown = r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
        if (!shown) return { exists: true, present: false, text: el.querySelector('.nh-text').textContent, buttons: [], pointerEvents: '', rect: null, overlaps: [] };
        const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
        const overlaps = [];
        const others = [...document.querySelectorAll('#ui button, #ui [role="dialog"], [data-testid="crash-toast"], [data-testid="crash-panel"]')]
            .filter((o) => !el.contains(o) && o !== el);
        for (const o of others) {
            const b = o.getBoundingClientRect();
            const cs = getComputedStyle(o);
            if (b.width === 0 || b.height === 0 || cs.visibility === 'hidden' || cs.display === 'none') continue;
            if (hit(r, b)) overlaps.push((o.getAttribute('data-testid') || o.getAttribute('data-action') || o.className || o.tagName).toString().slice(0, 40));
        }
        return { exists: true, present: true, text: el.querySelector('.nh-text').textContent, buttons: [...el.querySelectorAll('button')].map((b) => b.getAttribute('data-action')),
            pointerEvents: getComputedStyle(el).pointerEvents, rect: { x: r.x, y: r.y, w: r.width, h: r.height }, overlaps };
    })()`) as Promise<HintView>;
}

const { browser, which } = await launchChrome({ headless: false, args: ['--window-position=40,40', '--window-size=1296,920'] });
const out: Record<string, Any> = { site: SITE, browser: which, render: 'off', mockedCatalogue: IDS, mockedSuperSplat: SS_LIST };
const FIRST = IDS[0];

try {
    // ------------------------------------------------------------------ N1 N goes through all 12, then SuperSplat
    if (want('N1')) {
        const c = await context(browser);
        await open(c.page, FIRST);
        const startScene = await hook<string>(c.page, 'return s.scene.id;');
        const visited: { scene: string; state: string; reason: string }[] = [];
        let askedBefore12 = -1;
        for (let i = 1; i <= 13; i++) {
            if (i === 12) askedBefore12 = c.rec.explore.length;
            const r = await press(c.page, 'KeyN');
            visited.push({ scene: r.scene, state: r.sw.state, reason: r.sw.reason });
        }
        const ids = [startScene, ...visited.map((v) => v.scene)];
        const expected = [...IDS, ...SS_EXPECT.slice(0, 2)];
        const noRepeat = new Set(ids).size === ids.length;
        const request = c.rec.explore[0] ?? '';
        const defaults = request.includes('sort=trending') && request.includes('order=-1') && request.includes('time=all') && request.includes('features=walkable') && request.includes('skip=0') && request.includes('limit=24');
        const pass = JSON.stringify(ids) === JSON.stringify(expected) && visited.every((v) => v.state === 'done' && v.reason === 'next') && askedBefore12 === 0 && defaults && noRepeat;
        await c.page.screenshot({ path: join(SHOTS, 'n1-after-13-presses.png') });
        out.N1 = { pass, what: 'N from the first of 12 mocked scenes (8 without walls) visits all 12 in the owner\'s order, then the first two openable SuperSplat scenes; SuperSplat is asked only for the 12th press, with the tab\'s defaults', startScene, visited, expected, askedBeforeThe12th: askedBefore12, superSplatRequests: c.rec.explore, defaults, noRepeat, errors: errors(c.log) };
        console.log('N1', pass ? 'PASS' : 'FAIL', JSON.stringify({ ids, expected, askedBefore12, request }));
        await c.ctx.close();
    }

    // ------------------------------------------------------------------ N2 a returning visitor continues
    if (want('N2')) {
        const c = await context(browser);
        await open(c.page, FIRST);
        for (let i = 0; i < 4; i++) await press(c.page, 'KeyN');
        const reached = await hook<string>(c.page, 'return s.scene.id;');
        const stored = await c.page.evaluate("localStorage.getItem('gsfpv.tour.v1')");
        // a new visit: the page opened on the first scene again
        await open(c.page, FIRST);
        const second = await press(c.page, 'KeyN');
        // control: the same visit with the remembered position removed
        await c.page.evaluate("localStorage.removeItem('gsfpv.tour.v1')");
        await open(c.page, FIRST);
        const fresh = await press(c.page, 'KeyN');
        const pass = reached === IDS[4] && second.scene === IDS[5] && second.sw.state === 'done' && stored !== null;
        const control = { scene: fresh.scene, fired: fresh.scene === IDS[1] };
        out.N2 = { pass: pass && control.fired, what: 'after four N presses a new page load of the first scene and N goes on to the sixth scene (the position is remembered); with the stored position removed it goes to the second', reached, nextVisit: second.scene, stored: stored ? JSON.parse(stored as string) : null, control, errors: errors(c.log) };
        console.log('N2', out.N2.pass ? 'PASS' : 'FAIL', JSON.stringify({ reached, second: second.scene, control }));
        await c.ctx.close();
    }

    // ------------------------------------------------------------------ N3 Shift+N reaches every scene
    if (want('N3')) {
        const c = await context(browser);
        await open(c.page, FIRST);
        const seen = new Set<string>([FIRST]);
        const draws: string[] = [];
        for (let i = 0; i < 11; i++) {
            const r = await press(c.page, 'Shift+KeyN');
            draws.push(r.scene);
            seen.add(r.scene);
        }
        const walls = new Map(ORDER);
        const withoutWalls = [...seen].filter((id) => walls.get(id) === false).length;
        const pass = seen.size === 12 && withoutWalls === 8;
        out.N3 = { pass, what: 'eleven Shift+N from a 12-scene catalogue reach all 12 scenes, the 8 without walls included (v0.8 drew from the 4 with walls)', draws, distinct: seen.size, withoutWalls, errors: errors(c.log) };
        console.log('N3', pass ? 'PASS' : 'FAIL', JSON.stringify({ distinct: seen.size, withoutWalls }));
        await c.ctx.close();
    }

    // ------------------------------------------------------------------ H1 the hint after the 3rd and the 6th crash
    let h1: Any = null;
    if (want('H1')) {
        const c = await context(browser);
        await radioFlying(c.page, FIRST);
        const shown: Record<string, HintView> = {};
        const crashed: boolean[] = [];
        for (let n = 1; n <= 3; n++) {
            crashed.push(await crash(c.page));
            await wait(c.page, 500);
            shown[`after${n}`] = await hintView(c.page);
        }
        const toast = await c.page.locator('[data-testid="crash-toast"]').count();
        await c.page.screenshot({ path: join(SHOTS, 'h1-hint-after-3rd-crash.png') });
        // it takes no click of its own: a click through its box lands on what is under it
        const r = shown.after3.rect;
        const through = r ? await c.page.evaluate(`(() => { const e = document.elementFromPoint(${r.x + 6}, ${r.y + r.h / 2}); return e ? !e.closest('[data-testid="next-hint"]') : null; })()`) : null;
        // Enter keeps the wreck: the crash panel (Replay, Rewind, Start...) opens; the hint steps aside, it does not cover it
        await c.page.keyboard.press('Enter');
        await c.page.waitForSelector('[data-testid="crash-panel"]', { timeout: 5000 }).catch(() => null);
        const withPanel = await hintView(c.page);
        const panelButtons = await c.page.locator('[data-testid="crash-panel"] button').count();
        const panelBox = await c.page.locator('[data-testid="crash-panel"]').boundingBox();
        await c.page.screenshot({ path: join(SHOTS, 'h1-hint-steps-aside-for-crash-panel.png') });
        // back to the start (R): the panel goes, the hint is there again for the rest of its time; its close button takes it away
        await c.page.keyboard.press('KeyR');
        await c.page.waitForSelector('[data-testid="next-hint"]', { state: 'visible', timeout: 5000 }).catch(() => null);
        const afterPanel = await hintView(c.page);
        await c.page.click('[data-action="hint-close"]', { timeout: 5000 }).catch(() => null);
        const closed = await hintView(c.page);
        for (let n = 4; n <= 5; n++) {
            crashed.push(await crash(c.page));
            await wait(c.page, 500);
            shown[`after${n}`] = await hintView(c.page);
        }
        crashed.push(await crash(c.page));
        await wait(c.page, 500);
        shown.after6 = await hintView(c.page);
        // N pressed (with the hint up): the scene changes, "N used" is stored, the hint is gone
        const used0 = await c.page.evaluate("localStorage.getItem('gsfpv.nextUsed.v1')");
        const before = await hook<string>(c.page, 'return s.scene.id;');
        await hook(c.page, 'h.sceneSwitch = null; return 0;');
        await c.page.keyboard.press('KeyN');
        const sw = await switched(c.page);
        const used1 = await c.page.evaluate("localStorage.getItem('gsfpv.nextUsed.v1')");
        const afterN = await hintView(c.page);
        const scene = await hook<string>(c.page, 'return s.scene.id;');
        const textOk = (v: HintView) => /Want another place\? Press N for the next scene/.test(v.text);
        const clean = (v: HintView) => v.present && v.overlaps.length === 0 && v.pointerEvents === 'none';
        const pass = crashed.every(Boolean) && !shown.after1.present && !shown.after2.present && shown.after3.present && textOk(shown.after3) && clean(shown.after3) && toast === 1
            && withPanel.exists && !withPanel.present && panelButtons >= 5 && panelBox !== null && through === true && shown.after3.buttons.join() === 'hint-close'
            && afterPanel.present && clean(afterPanel) && !closed.exists && !shown.after4.present && !shown.after5.present && shown.after6.present && textOk(shown.after6)
            && used0 === null && sw.state === 'done' && scene !== before && used1 === '1' && !afterN.present;
        out.H1 = { pass, what: 'no hint after crash 1 and 2; after the 3rd "Want another place? Press N for the next scene" (a status line taking no click, overlapping no button or the crash toast), hidden while the crash panel is open (its Replay, Rewind, Start buttons are all there) and back after R, closed by its x; none after 4 and 5; again after the 6th; N changes the scene, stores "N used" and takes the hint away', crashed, shown, toastShown: toast, withPanel, panelButtons, panelBox, afterPanel, clickThrough: through, closed, used: { before: used0, after: used1 }, afterN, errors: errors(c.log) };
        console.log('H1', pass ? 'PASS' : 'FAIL', JSON.stringify({ after: Object.fromEntries(Object.entries(shown).map(([k, v]) => [k, v.present ? v.text : null])), overlaps: shown.after3.overlaps, withPanelVisible: withPanel.present, afterPanel: afterPanel.overlaps, used: [used0, used1] }));
        h1 = out.H1;
        await c.ctx.close();
    }

    // ------------------------------------------------------------------ H2 never once N was used
    if (want('H2')) {
        const c = await context(browser);
        await radioFlying(c.page, FIRST);
        const r = await press(c.page, 'KeyN');
        const crashed: boolean[] = [];
        const afterCrash: boolean[] = [];
        for (let n = 1; n <= 3; n++) {
            crashed.push(await crash(c.page));
            await wait(c.page, 500);
            afterCrash.push((await hintView(c.page)).present);
        }
        await c.ctx.close();
        // a later visit: the flag stored by an earlier one (an init script writes it before the page's own code runs)
        const d = await context(browser, { init: "try { localStorage.setItem('gsfpv.nextUsed.v1', '1'); } catch (e) {}" });
        await radioFlying(d.page, FIRST);
        const crashed2: boolean[] = [];
        const afterCrash2: boolean[] = [];
        for (let n = 1; n <= 3; n++) {
            crashed2.push(await crash(d.page));
            await wait(d.page, 500);
            afterCrash2.push((await hintView(d.page)).present);
        }
        await d.ctx.close();
        const pass = r.sw.state === 'done' && crashed.every(Boolean) && afterCrash.every((x) => !x) && crashed2.every(Boolean) && afterCrash2.every((x) => !x);
        const control = { h1Shows: h1 ? h1.shown.after3.present === true : null, fired: h1 ? h1.shown.after3.present === true : false };
        out.H2 = { pass: pass && (!h1 || control.fired), what: 'N used (this visit, or stored by an earlier one): three crashes show no hint; control: H1\'s three crashes without N show it', pressedN: r.sw, crashed, hintAfterEachCrash: afterCrash, laterVisit: { crashed: crashed2, hintAfterEachCrash: afterCrash2 }, control, errors: errors(c.log).concat(errors(d.log)) };
        console.log('H2', out.H2.pass ? 'PASS' : 'FAIL', JSON.stringify({ afterCrash, afterCrash2, control }));
    }

    // ------------------------------------------------------------------ H3 touch button, radio switch
    if (want('H3')) {
        // touch: the input source says touch (a real touch screen cannot be driven here): a Next scene button, no key line
        const t = await context(browser);
        await radioFlying(t.page, FIRST);
        await hook(t.page, "h.controls.source = 'touch'; return 0;");
        for (let n = 1; n <= 3; n++) { await crash(t.page); await wait(t.page, 400); }
        const touchHint = await hintView(t.page);
        await t.page.screenshot({ path: join(SHOTS, 'h3-touch-hint.png') });
        const before = await hook<string>(t.page, 'return s.scene.id;');
        await hook(t.page, 'h.sceneSwitch = null; return 0;');
        await t.page.click('[data-action="hint-next-scene"]').catch(() => null);
        const sw = await switched(t.page);
        const after = await hook<string>(t.page, 'return s.scene.id;');
        const gone = await hintView(t.page);
        await t.ctx.close();
        // a radio with the next-scene function on a switch (Profile.switches, the Switches screen)
        const r = await context(browser);
        await radioFlying(r.page, FIRST);
        await hook(r.page, "h.controls.profile.switches = { v: 1, ranges: [{ fn: 'scene.next', input: { kind: 'button', bit: 15 }, lo: 1500, hi: 2100 }] }; return 0;");
        for (let n = 1; n <= 3; n++) { await crash(r.page); await wait(r.page, 400); }
        const radioHint = await hintView(r.page);
        await r.ctx.close();
        const pass = touchHint.present && touchHint.text === 'Want another place?' && touchHint.buttons.join() === 'hint-next-scene,hint-close' && touchHint.overlaps.length === 0
            && sw.state === 'done' && sw.reason === 'next' && after !== before && !gone.present
            && radioHint.present && /next-scene switch/.test(radioHint.text) && radioHint.overlaps.length === 0;
        out.H3 = { pass, what: 'touch: the hint is "Want another place?" with a Next scene button that goes to the next scene; a radio that maps the next-scene function: the hint names the switch. (The touch input is the source flag on a simulated radio flight: NOT a real touch screen.)', touchHint, switchedTo: { sw, before, after }, hintGone: !gone.present, radioHint, errors: errors(t.log).concat(errors(r.log)) };
        console.log('H3', pass ? 'PASS' : 'FAIL', JSON.stringify({ touch: touchHint.text, buttons: touchHint.buttons, radio: radioHint.text }));
    }

    // ------------------------------------------------------------------ H4 a narrow phone
    if (want('H4')) {
        const c = await context(browser, { phone: true });
        await radioFlying(c.page, FIRST);
        for (let n = 1; n <= 3; n++) { await crash(c.page); await wait(c.page, 400); }
        const view = await hintView(c.page);
        const toast = await c.page.evaluate(`(() => { const e = document.querySelector('[data-testid="crash-toast"]'); if (!e) return null; const r = e.getBoundingClientRect(); return { y: r.y, h: r.height }; })()`);
        await c.page.screenshot({ path: join(SHOTS, 'h4-phone-hint-and-toast.png') });
        const inView = view.rect ? view.rect.x >= 0 && view.rect.x + view.rect.w <= 390 && view.rect.y + view.rect.h <= 844 : false;
        const pass = view.present && view.overlaps.length === 0 && inView && toast !== null;
        out.H4 = { pass, what: 'on a 390 px phone the hint sits inside the screen and overlaps neither the crash toast (at the top there) nor any button', view, toast, errors: errors(c.log) };
        console.log('H4', pass ? 'PASS' : 'FAIL', JSON.stringify({ rect: view.rect, overlaps: view.overlaps, toast }));
        await c.ctx.close();
    }
} finally {
    await browser.close();
    out.summary = Object.fromEntries(Object.entries(out).filter(([k]) => /^[NH]\d$/.test(k)).map(([k, v]) => [k, (v as Any).pass]));
    const file = writeEvidence('v09-next', out);
    console.log('evidence', file, JSON.stringify(out.summary));
    if (Object.values(out.summary as Record<string, boolean>).some((x) => x !== true)) process.exitCode = 1;
}
