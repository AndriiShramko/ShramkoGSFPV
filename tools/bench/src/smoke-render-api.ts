// Lead contract step before wave 3 (docs/architecture-v03.md J, E.4, E.7): the render-pc API the
// scene host and the scene scale build on, in the real page with the scan drawn.
//   unloadSplat()        the scan's entity and every asset loaded for it go; loadSplat() works again
//   setSceneTransform()  the scan's entity gets position t and uniform scale s; kept for the next scan
//   renderOnce()         asks the engine for the next frame (renderNextFrame)
// Every check has a control: the same assertion on the state before the call must fail.
//   LOCAL_FLY=1 SITE=http://127.0.0.1:5301 npx tsx src/smoke-render-api.ts
// Evidence: evidence/<date>/v03-render-api-smoke.json.
import type { Page } from 'playwright';
import { launchChrome, waitReady } from './browser';
import { writeEvidence, noteBrowser } from './evidence';

const SITE = (process.env.SITE ?? 'http://127.0.0.1:5301').replace(/\/$/, '');
const fly = (qs: string) => (process.env.LOCAL_FLY ? `${SITE}/fly/?${qs}` : `${SITE}/en/fly/?${qs}`);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const R = <T = Any>(p: Page, body: string): Promise<T> => p.evaluate(`(async () => { const r = window.__gsfpv.session.renderer; ${body} })()`) as Promise<T>;

const STATE = `
    const e = r.splat;
    return { splat: !!e, scale: e ? e.getLocalScale().x : null, pos: e ? [e.getLocalPosition().x, e.getLocalPosition().y, e.getLocalPosition().z] : null,
        rot: e ? [e.getLocalEulerAngles().x, e.getLocalEulerAngles().y, e.getLocalEulerAngles().z] : null,
        assets: r.app.assets.list().length, transform: r.sceneTransform, frames: window.__gsfpv.session.frames };`;

const { browser, which } = await launchChrome({ headless: false, args: ['--window-position=40,40', '--window-size=1296,920'] });
noteBrowser(which);
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
await ctx.addInitScript({ content: "try { localStorage.setItem('gsfpv.warned', '1'); } catch (e) {}" });
const page = await ctx.newPage();
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)));
await page.goto(fly('scene=39e63ce9&nowarn=1&input=touch'));
await waitReady(page, 180000);
await page.waitForTimeout(2000);

const loaded = await R(page, STATE);
const url = await R<string>(page, 'return r.splat && r.splat.gsplat.asset ? r.app.assets.get(r.splat.gsplat.asset).file.url : null;');

// setSceneTransform: control first (the loaded scan is at s = 1, t = 0)
const control1 = { scale: loaded.scale, pos: loaded.pos, wouldPass: loaded.scale === 2 };
await R(page, 'r.setSceneTransform(2, [1, 0.5, -2]); r.renderOnce(); return null;');
await page.waitForTimeout(500);
const scaled = await R(page, STATE);
const transformOk = scaled.scale === 2 && JSON.stringify(scaled.pos) === JSON.stringify([1, 0.5, -2]) && Math.abs(Math.abs(scaled.rot[2]) - 180) < 1e-6 && JSON.stringify(scaled.transform) === JSON.stringify([2, 1, 0.5, -2]);
let refused = false;
try { await R(page, 'r.setSceneTransform(0, [0, 0, 0]); return null;'); } catch { refused = true; }

// unloadSplat: control = the state before it (a scan and its assets are there)
const control2 = { splat: scaled.splat, assets: scaled.assets, wouldPass: !scaled.splat };
await R(page, 'r.unloadSplat(); return null;');
await page.waitForTimeout(800);
const unloaded = await R(page, STATE);
const framesAfterUnload = unloaded.frames;
await page.waitForTimeout(1000);
const stillRunning = (await R(page, STATE)).frames > framesAfterUnload;
const unloadOk = !unloaded.splat && unloaded.assets < scaled.assets;

// load again: a first load, with the transform kept
let reloadOk = false;
let reloaded: Any = null;
if (url) {
    await R(page, `await r.loadSplat(${JSON.stringify(url)}); r.revealFullDetail(); return null;`);
    await page.waitForTimeout(3000);
    reloaded = await R(page, STATE);
    reloadOk = reloaded.splat && reloaded.scale === 2 && JSON.stringify(reloaded.pos) === JSON.stringify([1, 0.5, -2]);
}
const shot = await page.screenshot();
await browser.close();

const pass = transformOk && refused && unloadOk && stillRunning && reloadOk && !control1.wouldPass && !control2.wouldPass && errors.length === 0;
writeEvidence('v03-render-api-smoke', {
    pass, site: SITE, scene: '39e63ce9', loaded, scaled, transformOk, zeroScaleRefused: refused,
    unloaded, unloadOk, frameLoopRunsWithoutAScan: stillRunning, reloaded, reloadOk, screenshotBytes: shot.length,
    controls: { transformOnUntouchedScan: control1, unloadOnLoadedScan: control2, fired: !control1.wouldPass && !control2.wouldPass },
    pageerrors: errors,
});
console.log(JSON.stringify({ pass, transformOk, refused, unloadOk, stillRunning, reloadOk, assets: [loaded.assets, scaled.assets, unloaded.assets, reloaded && reloaded.assets], errors }, null, 1));
process.exit(pass ? 0 : 1);
