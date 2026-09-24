// Phase B acceptance of the simulator against a running site (the live https://gsfpv.flyreelstudio.eu
// by default). System Chrome, visible window, stock flags. Every item writes its facts and its
// negative control into evidence/<date>/b-fly-<item>.json; PNGs next to it.
//   SITE=https://gsfpv.flyreelstudio.eu npx tsx src/accept-fly.ts [B6 B7 ...]
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { firefox } from 'playwright';
import type { BrowserContext, Page } from 'playwright';
import { launch, waitReady } from './browser';
import { writeEvidence, REPO, today } from './evidence';

const SITE = (process.env.SITE ?? 'https://gsfpv.flyreelstudio.eu').replace(/\/$/, '');
const HOST = new URL(SITE).host;
const LOCALES = ['en', 'es', 'pl', 'ru'] as const;
const ONLY = process.argv.slice(2).map((x) => x.toUpperCase());
const want = (id: string) => ONLY.length === 0 || ONLY.includes(id);
const SHOTS = join(REPO, 'evidence', today(), 'b-fly');
mkdirSync(SHOTS, { recursive: true });
const cb = () => `cb=${Math.random().toString(36).slice(2)}`;
// LOCAL_FLY=1: the Vite dev server serves /fly/ only (locale from the NEXT_LOCALE cookie there)
const fly = (l: string, qs: string) => (process.env.LOCAL_FLY ? `${SITE}/fly/?${qs}&${cb()}` : `${SITE}/${l}/fly/?${qs}&${cb()}`);

function dict(l: string): Record<string, string> {
    for (const p of [join(REPO, 'packages', 'i18n', 'locales', 'fly', `${l}.json`), join(REPO, 'packages', 'i18n', 'fly', `${l}.json`)]) {
        if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf8'));
    }
    throw new Error(`no fly dictionary for ${l}`);
}

/** Mean and spread of luminance of a PNG/JPEG, decoded in a helper page (no image deps). */
async function pixelStats(ctx: BrowserContext, img: Buffer, mime = 'image/png'): Promise<{ mean: number; std: number; grid: number[] }> {
    const p = await ctx.newPage();
    const r = await p.evaluate(async ({ b64, mime }) => {
        const bin = atob(b64);
        const u = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
        const bmp = await createImageBitmap(new Blob([u], { type: mime }));
        const c = new OffscreenCanvas(bmp.width, bmp.height);
        const g = c.getContext('2d')!;
        g.drawImage(bmp, 0, 0);
        const d = g.getImageData(0, 0, bmp.width, bmp.height).data;
        let s = 0, s2 = 0, n = 0;
        const grid = [0, 0, 0, 0], gn = [0, 0, 0, 0];
        for (let y = 0; y < bmp.height; y += 2) for (let x = 0; x < bmp.width; x += 2) {
            const i = (y * bmp.width + x) * 4;
            const L = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
            s += L; s2 += L * L; n++;
            const k = (y < bmp.height / 2 ? 0 : 2) + (x < bmp.width / 2 ? 0 : 1);
            grid[k] += L; gn[k]++;
        }
        const mean = s / n;
        return { mean, std: Math.sqrt(Math.max(0, s2 / n - mean * mean)), grid: grid.map((v, k) => v / gn[k]) };
    }, { b64: img.toString('base64'), mime });
    await p.close();
    return r;
}

async function hookEval<T>(page: Page, fn: string): Promise<T> {
    return page.evaluate(`(() => { const h = window.__gsfpv; const s = h.session; ${fn} })()`) as Promise<T>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
async function waitFor(page: Page, fn: string, ok: (v: Any) => boolean, timeoutMs: number): Promise<Any> {
    const t0 = Date.now();
    let v: Any = await hookEval<Any>(page, fn);
    while (!ok(v) && Date.now() - t0 < timeoutMs) {
        await page.waitForTimeout(300);
        v = await hookEval<Any>(page, fn);
    }
    return v;
}

const summary: Record<string, unknown> = {};
function record(id: string, data: Record<string, unknown> & { pass: boolean }): void {
    summary[id] = data.pass;
    writeEvidence(`b-fly-${id.toLowerCase()}`, { site: SITE, ...data });
    console.log(`${id} ${data.pass ? 'PASS' : 'FAIL'}`);
}

const L0 = await launch();
const { browser, context } = L0;
let page = L0.page;
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
const requests: string[] = [];
context.on('request', (r) => requests.push(r.url()));

// the whitelist of the CSP connect-src/img-src (GA only after consent, never on /fly)
const ALLOWED = new Set([HOST, 'd28zzqy0iyovbz.cloudfront.net', 's3-eu-west-1.amazonaws.com']);

// ------------------------------------------------------------------ B6 scene by link
if (want('B6')) {
    const scenes = ['39e63ce9', '7a475d38', '887f27aa'];
    const forms = (id: string) => [id, `https://superspl.at/scene/${id}`, `https://superspl.at/s?id=${id}`];
    const runs: Record<string, unknown>[] = [];
    for (const id of scenes) {
        for (const form of forms(id)) {
            requests.length = 0;
            errors.length = 0;
            await page.goto(fly('en', `scene=${encodeURIComponent(form)}&nowarn=1&input=touch`));
            const h = await waitReady(page, 180000);
            await page.waitForTimeout(1500);
            const vis = await page.evaluate(() => document.visibilityState);
            const png = await page.screenshot();
            const px = await pixelStats(context, png);
            const info = (h.info ?? {}) as Record<string, unknown>;
            const hosts = [...new Set(requests.map((u) => new URL(u).host))];
            const outside = hosts.filter((x) => !ALLOWED.has(x));
            const run = { id, form, status: h.status, hasCollision: info.hasCollision, renderer: info.currentRenderer, visibility: vis, loadMs: (info.timings as Record<string, number>)?.visibleMs, pixelStd: px.std, pixelMean: px.mean, hosts, outside, pageerrors: [...errors] };
            runs.push(run);
            if (form === id) await page.screenshot({ path: join(SHOTS, `b6-${id}.png`) });
            console.log('B6', JSON.stringify(run));
        }
    }
    // errors: unknown id and a foreign domain, in Russian (message must be in the page language)
    const ru = dict('ru');
    const errs: Record<string, unknown>[] = [];
    for (const [input, code] of [['00000000', 'not-found'], ['https://example.com/scene/39e63ce9', 'invalid-link']] as const) {
        errors.length = 0;
        await page.goto(fly('ru', `scene=${encodeURIComponent(input)}&nowarn=1`));
        const h = await waitReady(page, 60000);
        const text = await page.locator('.scene-error').textContent();
        errs.push({ input, status: h.status, errorCode: (await hookEval<string>(page, 'return h.errorCode;')), text, expected: ru[`error.${code}`], ok: (h.status === 'picker' || h.status === 'error') && text === ru[`error.${code}`], pageerrors: [...errors] });
    }
    // negative control of "frame not empty": a blank page must fail the same check
    await page.goto('about:blank');
    const blank = await pixelStats(context, await page.screenshot());
    const STD_MIN = 0.04;
    const pass = runs.every((r) => r.status === 'ready' && r.hasCollision === true && r.renderer === 2 && r.visibility === 'visible' && (r.pixelStd as number) > STD_MIN && (r.outside as string[]).length === 0 && (r.pageerrors as string[]).length === 0)
        && errs.every((e) => e.ok && (e.pageerrors as string[]).length === 0) && blank.std <= STD_MIN;
    record('B6', { pass, frameNotEmptyRule: `luminance std > ${STD_MIN}`, runs, errors: errs, control: { blankPageStd: blank.std, fired: blank.std <= STD_MIN } });
}

// ------------------------------------------------------------------ B7 scenes without collision
if (want('B7')) {
    const rows: Record<string, unknown>[] = [];
    for (const id of ['723068d7', 'bd04e182']) {
        for (const l of LOCALES) {
            await page.goto(fly(l, `scene=${id}&nowarn=1&input=touch`));
            const h = await waitReady(page, 180000);
            const badge = await page.locator('[data-testid="no-collision"]').textContent().catch(() => null);
            const info = (h.info ?? {}) as Record<string, unknown>;
            rows.push({ id, l, status: h.status, hasCollision: info.hasCollision, badge, expected: dict(l)['scenes.noCollisionBadge'] });
        }
        await page.screenshot({ path: join(SHOTS, `b7-${id}.png`) });
    }
    await page.goto(fly('en', 'scene=39e63ce9&nowarn=1&input=touch'));
    await waitReady(page, 180000);
    const ctlBadge = await page.locator('[data-testid="no-collision"]').count();
    const pass = rows.every((r) => r.status === 'ready' && r.hasCollision === false && r.badge === r.expected) && ctlBadge === 0;
    record('B7', { pass, rows, control: { scene: '39e63ce9', badges: ctlBadge, fired: ctlBadge === 0 } });
}

// ------------------------------------------------------------------ B8 history/filter, no WebGPU, Firefox
if (want('B8')) {
    // history: open two scenes, then the picker must list them after a reload
    await page.goto(fly('en', 'scene=39e63ce9&nowarn=1&input=touch'));
    await waitReady(page, 180000);
    await page.goto(fly('en', 'scene=887f27aa&nowarn=1&input=touch'));
    await waitReady(page, 180000);
    await page.goto(fly('en', 'nowarn=1'));
    await waitReady(page, 60000);
    await page.click('[data-tab="recent"]');
    const before = await page.locator('.scene-card').count();
    await page.check('#f-col');
    await page.reload();
    await waitReady(page, 60000);
    await page.click('[data-tab="recent"]');
    const after = await page.locator('.scene-card').count();
    const filterKept = await page.isChecked('#f-col');
    await page.uncheck('#f-col');
    // control: clearing storage empties the history
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await waitReady(page, 60000);
    await page.click('[data-tab="recent"]');
    const cleared = await page.locator('.scene-card').count();

    // no WebGPU (shim): honest message, the scan is still shown
    const shim = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    // a STRING, not a function: tsx/esbuild wraps functions with a __name() helper that does not
    // exist in the page, which silently broke the first version of this shim
    await shim.addInitScript({ content: "Object.defineProperty(Navigator.prototype, 'gpu', { get() { return undefined; }, configurable: true });" });
    const sp = await shim.newPage();
    await sp.goto(fly('en', 'scene=39e63ce9&nowarn=1&input=touch'));
    const sh = await waitReady(sp, 180000);
    await sp.waitForTimeout(1500);
    const shimOn = await sp.evaluate(() => !(navigator as Navigator & { gpu?: unknown }).gpu);
    const shimBanner = await sp.locator('[data-testid="banner"]').first().textContent().catch(() => null);
    const shimPx = await pixelStats(shim, await sp.screenshot({ path: join(SHOTS, 'b8-no-webgpu.png') }));
    await shim.close();

    // Firefox (Playwright build): the scan is visible, the banner says radios need Chrome/Edge
    let ff: Record<string, unknown> = { ran: false };
    try {
        const fb = await firefox.launch({ headless: false });
        const fp = await fb.newPage({ viewport: { width: 1280, height: 800 } });
        await fp.goto(fly('en', 'scene=39e63ce9&nowarn=1&input=touch'));
        const fh = await waitReady(fp, 240000);
        await fp.waitForTimeout(2500);
        const fpng = await fp.screenshot({ path: join(SHOTS, 'b8-firefox.png') });
        const fBanner = await fp.locator('[data-testid="banner"]').first().textContent().catch(() => null);
        const hasGpu = await fp.evaluate(() => 'gpu' in navigator && !!(navigator as Navigator & { gpu?: unknown }).gpu);
        await fb.close();
        const fStats = await pixelStats(context, fpng);
        ff = { ran: true, status: fh.status, error: fh.error ?? null, banner: fBanner, webgpu: hasGpu, pixelStd: fStats.std };
    } catch (e) {
        ff = { ran: false, error: String(e).slice(0, 300) };
    }
    const en = dict('en');
    const pass = before >= 2 && after === before && filterKept && cleared === 0
        && shimOn && sh.status === 'ready' && shimBanner === en['banner.noWebgpu'] && shimPx.std > 0.04
        && ff.ran === true && ff.status === 'ready' && (ff.pixelStd as number) > 0.04 && (ff.banner === en['banner.noHid'] || ff.banner === en['banner.noWebgpu']);
    record('B8', { pass, history: { before, afterReload: after, filterKept }, control: { afterClearingStorage: cleared, fired: cleared === 0 }, noWebgpuShim: { shimTookEffect: shimOn, status: sh.status, banner: shimBanner, pixelStd: shimPx.std }, firefox: ff });
}

// ------------------------------------------------------------------ B9 presets, measured TWR
if (want('B9')) {
    const rows: Record<string, unknown>[] = [];
    for (const drone of [null, 'pavo20pro2-3s', 'pavopico-2s']) {
        await page.goto(fly('en', `scene=39e63ce9&nowarn=1&input=touch${drone ? `&drone=${drone}` : ''}`));
        await waitReady(page, 180000);
        rows.push(await hookEval<Record<string, unknown>>(page, 'return { preset: s.presetId, twrPreset: s.params.twr, twrMeasured: s.measureTwr() };'));
    }
    // source labels in the drone picker
    await page.keyboard.press('KeyP');
    await page.click('[data-action="pause.drone"]');
    const srcLabels = await page.locator('.drone-card .src').count();
    const cards = await page.locator('.drone-card').count();
    await page.screenshot({ path: join(SHOTS, 'b9-drones.png') });
    const within = (r: Record<string, unknown>) => Math.abs((r.twrMeasured as number) / (r.twrPreset as number) - 1) <= 0.05;
    const def = rows[0], pico = rows[2];
    const picoDiffers = Math.abs((pico.twrMeasured as number) - (def.twrMeasured as number)) / (def.twrMeasured as number) > 0.05;
    const pass = def.preset === 'pavo20pro-3s' && rows.every(within) && rows[1].preset === 'pavo20pro2-3s' && pico.preset === 'pavopico-2s' && srcLabels >= cards * 3 && picoDiffers;
    record('B9', { pass, method: 'thrust stand in the model: motors spun up while held, released 20 ms, (a+g)/g', rows, sourceLabels: srcLabels, cards, control: { picoMeasured: pico.twrMeasured, defaultMeasured: def.twrMeasured, fired: picoDiffers } });
}

// ------------------------------------------------------------------ B10 wizard on SimRadio-raw
async function wizard(qs: string, timeoutMs: number): Promise<{ step: number; msg: string; err: string | null; prof: Record<string, unknown> | null }> {
    await page.goto(fly('en', `scene=39e63ce9&simradio=raw&${qs}`));
    await waitReady(page, 180000);
    return waitFor(page, 'const r = h.radio; return r && r.wizard ? { step: r.wizard.state.step, msg: r.wizard.state.message, err: r.wizard.state.error, prof: r.wizard.state.profile } : { step: -1 };', (v: { step: number }) => v.step === 6, timeoutMs);
}
if (want('B10') || want('B11')) {
    const good = await wizard('order=TAER&inv=E&offset=0.03&noise=0.01', 60000);
    const p = good.prof as { axes: Record<string, { index: number; invert: boolean }>; arm: { index?: number } } | null;
    const mapOk = !!p && p.axes.throttle.index === 0 && p.axes.roll.index === 1 && p.axes.pitch.index === 2 && p.axes.yaw.index === 3 && p.axes.pitch.invert === true && p.axes.roll.invert === false && p.arm?.index === 4;
    // finish the wizard (the "done" button), then throttle up must climb
    await page.click('[data-action="wizard-done"], [data-action="done"]').catch(() => undefined);
    await page.waitForTimeout(500);
    const climb = await (async () => {
        await hookEval(page, "const f = h.fake; f.set('T', -1); f.arm = false; return 0;");
        await page.waitForTimeout(300);
        await hookEval(page, 'h.fake.arm = true; return 0;');
        await page.waitForTimeout(300);
        const y0 = await hookEval<number>(page, 'return s.sim.s[1];');
        const armed = await hookEval<boolean>(page, 'return s.sim.armed;');
        await hookEval(page, "h.fake.set('T', 0.6); return 0;");
        await page.waitForTimeout(700);
        const y1 = await hookEval<number>(page, 'return s.sim.s[1];');
        await hookEval(page, "h.fake.set('T', -1); h.fake.arm = false; return 0;");
        return { armed, y0, y1, climbed: y1 - y0 };
    })();
    const saved = await page.evaluate(() => localStorage.getItem('gsfpv.profiles.v1'));
    await page.reload();
    await waitReady(page, 180000);
    const savedAfter = await page.evaluate(() => localStorage.getItem('gsfpv.profiles.v1'));
    const key = await hookEval<string>(page, 'return h.fake.key;');
    const persisted = !!savedAfter && savedAfter === saved && JSON.parse(savedAfter)[key]?.axes?.throttle?.index === 0;

    if (want('B10')) {
        const other = await wizard('order=AETR&inv=&offset=0.03&noise=0.01', 60000);
        const op = other.prof as { axes: Record<string, { index: number }> } | null;
        const otherDiffers = !!op && op.axes.roll.index === 0 && op.axes.throttle.index === 2;
        const broken = await wizard('order=TAER&inv=E&broken=E', 25000);
        const pass = good.step === 6 && mapOk && climb.armed && climb.climbed > 0.05 && persisted && otherDiffers && broken.step !== 6;
        record('B10', { pass, radio: 'SimRadio EdgeTX Classic (simulated raw HID reports, NOT a real radio)', good: { step: good.step, profile: good.prof, mappingCorrect: mapOk }, throttleUpClimbs: climb, survivesReload: persisted, controls: { otherOrder: { profile: other.prof, fired: otherDiffers }, brokenStick: { step: broken.step, message: broken.msg, fired: broken.step !== 6 } } });
    }
}

// ------------------------------------------------------------------ B11 arm gate
if (want('B11')) {
    // after B10's wizard the page runs the saved-mapping SimRadio; use a fresh wizard to be sure
    await wizard('order=TAER&inv=E&offset=0.03&noise=0.01', 60000);
    await page.click('[data-action="wizard-done"], [data-action="done"]').catch(() => undefined);
    await page.waitForTimeout(400);
    const step = async (js: string, ms = 300) => { await hookEval(page, `${js}; return 0;`); await page.waitForTimeout(ms); return hookEval<{ armed: boolean; block: string | null }>(page, 'return { armed: s.sim.armed, block: h.controls.block };'); };
    await step("h.fake.set('T', -1); h.fake.arm = false");
    const midThrottle = await step("h.fake.set('T', 0); h.fake.arm = true");
    await step("h.fake.arm = false; h.fake.set('T', -1)");
    const lowThrottle = await step('h.fake.arm = true');
    await step("h.fake.arm = false");
    // switch already ON when the page loads, and the gamepad trap (axes read 0.0 before the first
    // movement): both through a fresh ArmGate / the live Controls with a gamepad profile
    const fresh = await hookEval<Record<string, unknown>>(page, `
        const G = h.controls.gate.constructor; const g = new G(); const P = {};
        const ch = new Float32Array([0, 0, -1, 0, 1, -1, 0, 0]);
        let a = 0; for (let i = 0; i < 20; i++) a = Math.max(a, g.update(P, ch, 0, true, false));
        const onAtLoad = a > 0;
        ch[4] = -1; g.update(P, ch, 0, true, false); ch[4] = 1; const afterCycle = g.update(P, ch, 0, true, false) > 0;
        return { onAtLoadArmed: onAtLoad, afterOffOnArmed: afterCycle };`);
    const trap = await hookEval<Record<string, unknown>>(page, `
        const c = h.controls; const keep = c.profile; const src = c.source;
        c.profile = { version: 1, deviceKey: 'gamepad:test', deviceName: 'trap', deadband: 0.02, created: '',
            axes: { roll: { index: 0, invert: false, center: 0, min: -1, max: 1 }, pitch: { index: 1, invert: false, center: 0, min: -1, max: 1 },
                    throttle: { index: 2, invert: false, center: 0, min: -1, max: 1 }, yaw: { index: 3, invert: false, center: 0, min: -1, max: 1 } },
            arm: { kind: 'button', bit: 0 }, angleMode: null };
        c.source = 'gamepad';
        const f = { t: performance.now(), axes: new Float32Array(8), buttons: 0 };
        c.raw(f); f.buttons = 1; f.t += 5; c.raw(f);
        const res = { armed: s.sim.armed || c.gate.armed, block: c.block };
        f.buttons = 0; f.t += 5; c.raw(f);
        c.profile = keep; c.source = src;
        return res;`);
    const pass = !midThrottle.armed && midThrottle.block === 'throttle' && lowThrottle.armed && fresh.onAtLoadArmed === false && fresh.afterOffOnArmed === true && trap.armed === false && trap.block === 'throttle';
    record('B11', { pass, positive: { lowThrottleAndSwitchEdge: lowThrottle }, controls: { throttleNotLow: midThrottle, switchOnAtLoad: fresh, gamepadZeroAxesTrap: trap } });
}

// ------------------------------------------------------------------ B12 crash, respawn
if (want('B12')) {
    await page.goto(fly('en', 'scene=39e63ce9&simradio=scenario&nowarn=1'));
    await waitReady(page, 180000);
    const vCrash = await hookEval<number>(page, 'return s.params.vCrash;');
    const done = await waitFor(page, 'return { phase: h.scenario.phase, log: h.scenario.log, crash: h.lastCrash };', (v: { phase: string; crash: { pending?: boolean } | null }) => (v.phase === 'rest' || v.phase === 'done') && !!v.crash && !v.crash.pending, 120000);
    await page.waitForTimeout(1800);
    await page.screenshot({ path: join(SHOTS, 'b12-crash.png') });
    const overlay = await page.locator('.crash-overlay').count();
    await page.click('[data-action="respawn"]');
    await page.waitForTimeout(400);
    const after = await hookEval<Record<string, unknown>>(page, 'return { crashed: s.sim.crashed, free: s.spawnIsFree([s.sim.s[0], s.sim.s[1], s.sim.s[2], 0]) };');
    // control: a touch at 0.5 * v_bounce must not crash
    const vBounce = await hookEval<number>(page, 'return s.params.vBounce;');
    await page.goto(fly('en', `scene=39e63ce9&simradio=scenario&nowarn=1&dash=${0.5 * vBounce}`));
    await waitReady(page, 180000);
    const soft = await waitFor(page, 'return { phase: h.scenario.phase, crash: h.scenario.log.crash, contacts: h.events.filter((e) => e.type === "contact").length, crashes: h.events.filter((e) => e.type === "crash").length };', (v: { phase: string }) => v.phase === 'done' || v.phase === 'rest', 120000);
    const c = done.log as { crash: { speed: number } | null; tumbleMaxW: number };
    const lc = done.crash as { debris: number; engine: string; maxAngularSpeed: number; speed: number };
    const pass = !!c.crash && c.crash.speed >= 1.9 * vCrash && c.tumbleMaxW > 0 && lc.debris > 0 && lc.engine === 'rapier' && overlay === 1 && after.crashed === false && after.free === true
        && soft.crashes === 0 && (soft.contacts as number) > 0;
    record('B12', { pass, vCrash, dashTarget: 2 * vCrash, crash: c.crash, tumbleMaxW: c.tumbleMaxW, wreck: lc, overlay, respawn: after, control: { dash: 0.5 * vBounce, contacts: soft.contacts, crashes: soft.crashes, fired: soft.crashes === 0 && (soft.contacts as number) > 0 } });
}

// ------------------------------------------------------------------ B13 tunnelling on the live site
if (want('B13')) {
    const rows: Record<string, unknown>[] = [];
    for (const id of ['39e63ce9', '887f27aa', '7a475d38']) {
        await page.goto(fly('en', `scene=${id}&nowarn=1&input=touch`));
        await waitReady(page, 180000);
        rows.push({ id, ...(await hookEval<Record<string, unknown>>(page, 'return s.tunnelSelfTest(20, 25, 7);')) });
    }
    const pass = rows.every((r) => r.passes === 20 && r.penetrations === 0 && (r.contacts as number) > 0);
    record('B13', { pass, oracle: 'every tick: each body sphere resampled every voxel/4 with the upstream querySphere', rows });
}

// ------------------------------------------------------------------ B14 touch sticks
if (want('B14')) {
    const rows: Record<string, unknown>[] = [];
    for (const [w, hgt] of [[375, 812], [1024, 768]] as const) {
        const T = await launch({ width: w, height: hgt, mobile: true });
        const tp = T.page;
        await tp.goto(fly('en', 'scene=887f27aa&nowarn=1&input=touch'));
        await waitReady(tp, 180000);
        const cdp = await T.context.newCDPSession(tp);
        const box = async (sel: string) => (await tp.locator(sel).boundingBox())!;
        const L = await box('.touch-pad.left'), R = await box('.touch-pad.right'), A = await box('.touch-arm');
        const c = (b: { x: number; y: number; width: number; height: number }) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
        const touch = (type: string, pts: { x: number; y: number; id: number }[]) => cdp.send('Input.dispatchTouchEvent', { type: type as 'touchStart', touchPoints: pts.map((p) => ({ x: p.x, y: p.y, id: p.id })) });
        const chNow = () => tp.evaluate(() => new Promise<number[]>((res) => requestAnimationFrame(() => res(Array.from((window as any).__gsfpv.touch.channels)))));
        // control first: a touch outside both pads (middle of the view, no UI there) changes nothing
        const ch0 = await chNow();
        await touch('touchStart', [{ x: w / 2, y: hgt * 0.42, id: 9 }]);
        await touch('touchEnd', []);
        const chOut = await chNow();
        const outsideZero = ch0.slice(0, 4).every((v, i) => Math.abs(v - chOut[i]) < 1e-6);
        // two touches at once, still disarmed: both pairs of axes in one frame
        const lc = c(L), rc = c(R), rl = L.width / 2 - 24, rr = R.width / 2 - 24;
        await touch('touchStart', [{ x: lc.x + 0.3 * rl, y: lc.y + 0.9 * rl, id: 2 }, { x: rc.x - 0.4 * rr, y: rc.y - 0.3 * rr, id: 3 }]);
        const both = await chNow();
        const bothChanged = Math.abs(both[0]) > 0.2 && Math.abs(both[1]) > 0.2 && Math.abs(both[3]) > 0.2 && both[2] < -0.5;
        await touch('touchEnd', []);
        await tp.waitForTimeout(200);
        // arm with the button (throttle stayed low: the left stick is sticky at the bottom)
        await touch('touchStart', [{ ...c(A), id: 1 }]);
        await touch('touchEnd', []);
        await tp.waitForTimeout(300);
        const armed = await hookEval<boolean>(tp, 'return s.sim.armed;');
        // hover 10 s: a small altitude hold through the left pad only (angle mode keeps it level)
        const y0 = await hookEval<number>(tp, 'return s.sim.s[1];');
        const target = y0 + 0.8;
        let thr = -0.15, lastY = y0, minY = 1e9, maxY = -1e9;
        await touch('touchStart', [{ x: lc.x, y: lc.y - thr * rl, id: 4 }]);
        const t0 = Date.now();
        let crashed = false, armedAll = true;
        while (Date.now() - t0 < 12000) {
            await tp.waitForTimeout(100);
            const st = await hookEval<{ y: number; crashed: boolean; armed: boolean }>(tp, 'return { y: s.sim.s[1], crashed: s.sim.crashed, armed: s.sim.armed };');
            const vy = (st.y - lastY) / 0.1;
            lastY = st.y;
            thr = Math.max(-0.9, Math.min(0.6, -0.15 + 0.35 * (target - st.y) - 0.25 * vy));
            await touch('touchMove', [{ x: lc.x, y: lc.y - thr * rl, id: 4 }]);
            if (Date.now() - t0 > 2000) { minY = Math.min(minY, st.y); maxY = Math.max(maxY, st.y); crashed ||= st.crashed; armedAll &&= st.armed; }
        }
        await touch('touchEnd', []);
        const view = await tp.evaluate(() => ({ scrollX, scrollY, scale: visualViewport?.scale ?? 1 }));
        await tp.screenshot({ path: join(SHOTS, `b14-${w}x${hgt}.png`) });
        await T.browser.close();
        rows.push({ viewport: `${w}x${hgt}`, armedByButton: armed, bothPairsOneFrame: { ch: both.slice(0, 4), ok: bothChanged }, hover: { seconds: 10, crashed, armedAll, minY, maxY, target }, view, control: { outsideTouch: { before: ch0.slice(0, 4), after: chOut.slice(0, 4), fired: outsideZero } } });
        console.log('B14', JSON.stringify(rows[rows.length - 1]));
    }
    const pass = rows.every((r) => {
        const x = r as { armedByButton: boolean; bothPairsOneFrame: { ok: boolean }; hover: { crashed: boolean; armedAll: boolean; minY: number }; view: { scrollX: number; scrollY: number; scale: number }; control: { outsideTouch: { fired: boolean } } };
        return x.armedByButton && x.bothPairsOneFrame.ok && !x.hover.crashed && x.hover.armedAll && x.view.scrollX === 0 && x.view.scrollY === 0 && x.view.scale === 1 && x.control.outsideTouch.fired;
    });
    record('B14', { pass, note: 'touch through CDP Input.dispatchTouchEvent in system Chrome with hasTouch; input=touch because desktop Chrome has WebHID', rows });
}

// ------------------------------------------------------------------ B15 replay from inputs only
if (want('B15')) {
    await page.goto(fly('en', 'scene=887f27aa&simradio=scenario&flip=1&nowarn=1'));
    await waitReady(page, 180000);
    const fl = await waitFor(page, 'return { phase: h.scenario.phase, flip: h.scenario.log.flip, crash: h.scenario.log.crash, tick: s.sim.tick };', (v: { phase: string; tick: number }) => (v.phase === 'rest' || v.phase === 'done') && v.tick >= 30000, 150000);
    const saved = await hookEval<Record<string, unknown>>(page, "const e = h.saveLog('b15'); return { hash: e.hash, endTick: e.endTick, records: e.bytes.length / 36 };");
    // CPU throttling x4: steps per simulated second stay 1000
    const cdp = await context.newCDPSession(page);
    const rate = async () => {
        const a = await hookEval<{ tick: number; now: number }>(page, 'return { tick: s.sim.tick, now: performance.now() };');
        await page.waitForTimeout(4000);
        const b = await hookEval<{ tick: number; now: number; hitches: number }>(page, 'return { tick: s.sim.tick, now: performance.now(), hitches: s.runner.hitches };');
        return { stepsPerWallSecond: ((b.tick - a.tick) / (b.now - a.now)) * 1000, hitches: b.hitches };
    };
    const normal = await rate();
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const slow = await rate();
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    // a NEW tab replays the saved log (only the inputs travel)
    const p2 = await context.newPage();
    await p2.goto(fly('en', 'scene=887f27aa&nowarn=1&input=touch'));
    await waitReady(p2, 180000);
    const again = await hookEval<Record<string, unknown>>(p2, 'const r = h.verifyLastLog(); return { saved: r.saved, hash: r.hash, endTick: r.endTick };');
    const rec = Math.floor((saved.records as number) / 2);
    const ctl = await hookEval<Record<string, unknown>>(p2, `const a = h.verifyLastLog(); const b = h.verifyLastLog({ record: ${rec}, channel: 2 });
        let d = 0; for (let i = 0; i + 2 < Math.min(a.track.length, b.track.length); i += 3) d = Math.max(d, Math.hypot(a.track[i] - b.track[i], a.track[i + 1] - b.track[i + 1], a.track[i + 2] - b.track[i + 2]));
        return { hash: b.hash, differs: b.hash !== a.hash, maxDivergenceM: d, tamperedValue: b.tampered, record: ${rec} };`);
    await p2.close();
    const f = fl.flip as { minUpY: number } | null;
    const pass = !!f && f.minUpY < -0.5 && !!fl.crash && (saved.endTick as number) >= 30000 && again.hash === saved.hash && again.saved === saved.hash
        && Math.abs(slow.stepsPerWallSecond - 1000) < 60 && ctl.differs === true && (ctl.maxDivergenceM as number) > 0.01;
    record('B15', { pass, flight: fl, saved, newTab: again, cpuThrottle: { x1: normal, x4: slow }, control: ctl });
}

// ------------------------------------------------------------------ B16 gravity
if (want('B16')) {
    const rows: Record<string, unknown>[] = [];
    for (const g of [9.81, 1.62]) {
        await page.goto(fly('en', `scene=887f27aa&g=${g}&nowarn=1&input=touch`));
        await waitReady(page, 180000);
        const d = await hookEval<{ g: number; measured: number; fallM: number }>(page, 'return s.dropTest();');
        const warning = await page.locator('[data-testid="gravity-warning"]').textContent().catch(() => null);
        rows.push({ ...d, relErr: d.measured / g - 1, warning });
    }
    const [earth, moon] = rows as { measured: number; relErr: number; warning: string | null }[];
    const differs = Math.abs(earth.measured - moon.measured) > 1;
    const pass = rows.every((r) => Math.abs(r.relErr as number) <= 0.03) && differs && !earth.warning && !!moon.warning && /6\.1/.test(moon.warning ?? '');
    record('B16', { pass, method: 'disarmed drop from the spawn until contact or 0.5 s, a = 2(Δy + v0 t)/t²', rows, control: { sameAccelerationWouldFail: true, earthVsMoon: [earth.measured, moon.measured], fired: differs } });
}

// ------------------------------------------------------------------ B17 photosensitivity
if (want('B17')) {
    const N = Number(process.env.B17_CRASHES ?? 50);
    // detector: WCAG 2.2 general flash — opposing changes of relative luminance >= 0.1 with the
    // darker state < 0.8, counted per 1-second window, on the whole frame and on each quarter
    type Sample = { t: number; L: number[] };
    const detect = (s: Sample[]) => {
        let worst = 0;
        for (let k = 0; k < 5; k++) {
            const ev: number[] = [];
            let ref = s[0]?.L[k] ?? 0, dir = 0;
            for (const x of s) {
                const d = x.L[k] - ref;
                if (Math.abs(d) >= 0.1 && Math.min(x.L[k], ref) < 0.8) {
                    const nd = Math.sign(d);
                    if (nd !== dir) { ev.push(x.t); dir = nd; }
                    ref = x.L[k];
                } else if (Math.sign(d) === dir) ref = dir > 0 ? Math.max(ref, x.L[k]) : Math.min(ref, x.L[k]);
            }
            for (let i = 0; i < ev.length; i++) {
                let j = i;
                while (j < ev.length && ev[j] - ev[i] < 1) j++;
                worst = Math.max(worst, Math.floor((j - i) / 2));
            }
        }
        return worst;
    };
    const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    async function record5(p: Page, stopWhen: () => Promise<boolean>, maxMs: number): Promise<Sample[]> {
        const s = await context.newCDPSession(p);
        const out: Sample[] = [];
        const helper = await context.newPage();
        await helper.goto('about:blank');
        await p.bringToFront();
        const pending: Promise<void>[] = [];
        let stopped = false;
        s.on('Page.screencastFrame', (f) => {
            if (stopped) return; // a late frame after stop: the helper tab may be gone already
            void s.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => undefined);
            pending.push(helper.evaluate(async ({ b64 }) => {
                const bin = atob(b64); const u = new Uint8Array(bin.length);
                for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
                const bmp = await createImageBitmap(new Blob([u], { type: 'image/jpeg' }));
                const c = new OffscreenCanvas(bmp.width, bmp.height); const g = c.getContext('2d')!; g.drawImage(bmp, 0, 0);
                const d = g.getImageData(0, 0, bmp.width, bmp.height).data;
                const q = [0, 0, 0, 0, 0], n = [0, 0, 0, 0, 0];
                for (let y = 0; y < bmp.height; y += 2) for (let x = 0; x < bmp.width; x += 2) {
                    const i = (y * bmp.width + x) * 4;
                    const L = [d[i], d[i + 1], d[i + 2]].map((v) => v / 255);
                    const k = (y < bmp.height / 2 ? 0 : 2) + (x < bmp.width / 2 ? 0 : 1);
                    const Y = 0.2126 * L[0] + 0.7152 * L[1] + 0.0722 * L[2];
                    q[k] += Y; n[k]++; q[4] += Y; n[4]++;
                }
                return q.map((v, k) => v / n[k]);
            }, { b64: f.data }).then((L) => { out.push({ t: f.metadata.timestamp ?? Date.now() / 1000, L: L.map(lin) }); }).catch(() => undefined));
        });
        await s.send('Page.startScreencast', { format: 'jpeg', quality: 60, maxWidth: 320, maxHeight: 200, everyNthFrame: 1 });
        const t0 = Date.now();
        while (Date.now() - t0 < maxMs && !(await stopWhen())) await p.waitForTimeout(1000);
        stopped = true;
        await s.send('Page.stopScreencast').catch(() => undefined);
        await Promise.all(pending);
        await helper.close();
        return out.sort((a, b) => a.t - b.t);
    }
    // control: a 5 Hz black/white strobe must be caught (> 3 flashes/s)
    const sp = await context.newPage();
    await sp.setContent('<body style="margin:0;background:#000"><script>let on=0;setInterval(()=>{on^=1;document.body.style.background=on?"#fff":"#000"},100)</script></body>');
    const strobe = await record5(sp, async () => false, 6000);
    await sp.close();
    const strobeFlashes = detect(strobe);
    // 50 crashes in a loop (the same bot plan, respawned after every crash)
    const loopUrl = fly('en', `scene=39e63ce9&simradio=scenario&quick=1&loop=${N}&nowarn=1`);
    const navs: { t: number; url: string }[] = [];
    const consoleTail: string[] = [];
    const t0 = Date.now();
    page.on('framenavigated', (f) => { if (f === page.mainFrame()) navs.push({ t: (Date.now() - t0) / 1000, url: f.url().replace(/[?].*$/, '') }); });
    page.on('console', (m) => { consoleTail.push(`${((Date.now() - t0) / 1000).toFixed(1)}s ${m.type()}: ${m.text()}`.slice(0, 300)); if (consoleTail.length > 40) consoleTail.shift(); });
    await page.goto(loopUrl);
    await waitReady(page, 180000);
    let total = 0;
    let lost: string | null = null;
    const s = await record5(page, async () => {
        try {
            total = await hookEval<number>(page, 'return (h.loops ?? 0) + (h.scenario.log.crash ? 1 : 0);');
        } catch (e) {
            lost = String(e).slice(0, 200); // the page went away: stop and report instead of dying
            return true;
        }
        return total >= N;
    }, N * 40000);
    const flashes = detect(s);
    const pass = !lost && total >= N && flashes <= 3 && strobeFlashes > 3;
    record('B17', { pass, pageLost: lost, navigations: navs, consoleTail: lost ? consoleTail : [], rule: 'WCAG 2.2 general flash: pairs of opposing relative-luminance changes >= 0.1 (darker < 0.8), max per 1 s window, whole frame and quarters; frames via CDP screencast', crashes: total, frames: s.length, maxFlashesPerSecond: flashes, control: { strobeHz: 5, frames: strobe.length, maxFlashesPerSecond: strobeFlashes, fired: strobeFlashes > 3 } });
}

await browser.close();
writeEvidence('b-fly-summary', { site: SITE, items: summary });
console.log(JSON.stringify(summary));
