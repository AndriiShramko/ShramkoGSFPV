// Lead contract step before wave 3 (docs/architecture-v03.md E.6, E.8): the scene picker's tab
// registry (apps/fly/src/ui/picker-tabs.ts), in the real page on the Vite dev server (the page's own
// modules, imported by URL, so i18n and the picker are the app's). A registered tab appears after
// the built-ins, gets the list area, picks through the picker (ids and links; a foreign link shows
// the invalid-link message), is unmounted when another tab opens, and can hide the filter row.
// Controls: a picker opened before the registration has no such tab; a second tab with the same id
// is refused.
//   LOCAL_FLY=1 SITE=http://127.0.0.1:5301 npx tsx src/smoke-picker-tabs.ts   (the dev server only)
// Evidence: evidence/<date>/v03-picker-tabs-smoke.json.
import { launchChrome } from './browser';
import { writeEvidence, noteBrowser } from './evidence';

const SITE = (process.env.SITE ?? 'http://127.0.0.1:5301').replace(/\/$/, '');
const { browser, which } = await launchChrome({ headless: false, args: ['--window-position=40,40', '--window-size=1296,920'] });
noteBrowser(which);
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.addInitScript({ content: "try { localStorage.setItem('gsfpv.warned', '1'); } catch (e) {}" });
const page = await ctx.newPage();
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)));
await page.goto(`${SITE}/fly/?nowarn=1`);
await page.waitForFunction(() => (window as unknown as { __gsfpv?: { status?: string } }).__gsfpv?.status === 'picker', null, { timeout: 60000 });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const res: any = await page.evaluate(`(async () => {
    const base = '${SITE}/fly/src/ui/';
    const tabs = await import(base + 'picker-tabs.ts');
    const scenes = await import(base + 'scenes.ts');
    const out = {};
    const before = document.createElement('div'); document.body.append(before);
    const early = new scenes.ScenePicker(before, []);
    let unmounted = 0;
    const off = tabs.registerPickerTab({ id: 'smoke', labelKey: 'scenes.tab.favourites', order: 40, ownFilters: true,
        mount(host, c) {
            const ok = document.createElement('button'); ok.textContent = 'ok'; ok.dataset.t = 'ok'; ok.onclick = () => c.pick('https://superspl.at/scene/39e63ce9', 'superspl');
            const bad = document.createElement('button'); bad.textContent = 'bad'; bad.dataset.t = 'bad'; bad.onclick = () => c.pick('https://example.com/scene/39e63ce9', 'superspl');
            host.append(ok, bad);
            return () => { unmounted++; };
        } });
    let dup = false; try { tabs.registerPickerTab({ id: 'smoke', labelKey: 'x', order: 50, mount() {} }); } catch { dup = true; }
    const box = document.createElement('div'); document.body.append(box);
    const p = new scenes.ScenePicker(box, []);
    const picked = [];
    p.onPick = (id, src) => picked.push([id, src]);
    const q = (s) => p.root.querySelector(s);
    out.tabOrder = [...p.root.querySelectorAll('[role=tab]')].map((b) => b.dataset.tab);
    out.earlyHasTab = !!early.root.querySelector('[data-tab=smoke]');
    q('[data-tab=smoke]').click();
    out.selected = q('[data-tab=smoke]').getAttribute('aria-selected');
    out.filtersHidden = q('.filters').hidden;
    q('[data-t=ok]').click();
    q('[data-t=bad]').click();
    out.err = q('.scene-error').textContent;
    out.picked = picked.slice();
    q('[data-tab=showcase]').click();
    out.unmountedAfterSwitch = unmounted;
    out.filtersBack = !q('.filters').hidden;
    out.gone = !q('[data-t=ok]');
    q('[data-tab=smoke]').click();
    p.remove();
    out.unmountedAfterRemove = unmounted;
    out.dupRefused = dup;
    off();
    out.afterOff = tabs.pickerTabs().length;
    early.remove(); before.remove(); box.remove();
    return out;
})()`);
await browser.close();

const pass = JSON.stringify(res.tabOrder) === JSON.stringify(['showcase', 'recent', 'favourites', 'smoke']) && res.selected === 'true' && res.filtersHidden === true
    && JSON.stringify(res.picked) === JSON.stringify([['39e63ce9', 'superspl']]) && typeof res.err === 'string' && res.err.length > 0
    && res.unmountedAfterSwitch === 1 && res.filtersBack && res.gone && res.unmountedAfterRemove === 2 && res.afterOff === 0
    && res.earlyHasTab === false && res.dupRefused === true && errors.length === 0;
writeEvidence('v03-picker-tabs-smoke', { pass, site: SITE, result: res, controls: { pickerOpenedBeforeRegistrationHasNoTab: res.earlyHasTab === false, duplicateIdRefused: res.dupRefused }, pageerrors: errors });
console.log(JSON.stringify({ pass, ...res, errors }, null, 1));
process.exit(pass ? 0 : 1);
