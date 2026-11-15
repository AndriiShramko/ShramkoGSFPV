// Lane uiaudit, stage A1 (docs/wip/uiaudit.md): an inventory of every panel, window, menu and overlay a pilot
// meets on the fly page and the Fly by Sound start screen, measured at one window size per run.
// For each panel: how it opens; which ways close it (Esc, the same key or chip again, a click outside, a
// visible close control); the close controls' rectangles, their size and whether something covers them;
// whether the whole panel is inside the view and whether it scrolls inside itself; the smallest text; the
// controls with no accessible name and the ones whose only visible text is a symbol.
// The panel is found by a diff: the visible elements after the opening action that were not visible
// before; the largest new element without a new ancestor is the panel (spec.sel overrides it).
// Headless through visual-browser.mjs pickHarnessBrowser. The flight page runs ?render=off (the scan is
// not drawn, so no GPU lock) unless --render is given (then the caller holds C:/dev/.gpu-lock).
// It never presses a send, save or create control: the report form, share and rooms are only opened.
// Usage: node ui-audit-probe.mjs <base with /en> <WxH> <out.json> [--scene id] [--render] [--only a,b] [--shots dir]
// Prints one line per panel and, as the LAST line, a short JSON {size, panels, faults}.
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { pickHarnessBrowser } from './visual-browser.mjs';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '');
const require = createRequire(ROOT + '/tools/bench/package.json');
const { chromium } = require('playwright');
const args = process.argv.slice(2);
const flag = (name, takes = true) => { const i = args.indexOf(name); if (i < 0) return null; const v = takes ? args[i + 1] : true; args.splice(i, takes ? 2 : 1); return v; };
const scene = flag('--scene') ?? '39e63ce9';
const render = flag('--render', false) === true;
const only = flag('--only')?.split(',') ?? null;
const shots = flag('--shots');
const base = (args[0] ?? 'http://localhost:5840/en').replace(/\/$/, '');
const [vw, vh] = (args[1] ?? '1366x768').split('x').map(Number);
const outFile = args[2] ?? `${ROOT}/.cache/ui-audit-${vw}x${vh}.json`;
mkdirSync(dirname(outFile), { recursive: true });
if (shots) mkdirSync(shots, { recursive: true });
const phone = Math.min(vw, vh) < 500;
const size = `${vw}x${vh}`;

const pick = pickHarnessBrowser({ expected: chromium.executablePath() }, render);
const browser = await chromium.launch({ ...pick.launch, headless: pick.launch.headless });
const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, isMobile: phone, hasTouch: phone, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 160)));
const settle = (ms = 700) => page.waitForTimeout(ms);
const out = { what: 'panel inventory (ui-audit-probe.mjs)', base, size, scene, render, phone, panels: {}, errors };

// ---- in the page ------------------------------------------------------------------------------------
/** Remember every element visible now (the diff's baseline). */
const snap = () => page.evaluate(() => {
    const seen = new WeakSet();
    for (const e of document.querySelectorAll('body *')) { const r = e.getBoundingClientRect(); if (r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden') seen.add(e); }
    window.__uiaSeen = seen;
    document.querySelectorAll('[data-uia-root]').forEach((e) => e.removeAttribute('data-uia-root'));
});
/** Mark the panel: spec selector, else the largest new visible element without a new ancestor. */
const markRoot = (sel) => page.evaluate((sel) => {
    const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
    let root = null;
    const fresh = [];
    if (sel) root = [...document.querySelectorAll(sel)].filter(vis).pop() ?? null;
    else {
        const seen = window.__uiaSeen ?? new WeakSet();
        for (const e of document.querySelectorAll('body *')) {
            if (seen.has(e) || !vis(e) || e.tagName === 'CANVAS' || e.tagName === 'SCRIPT') continue;
            let p = e.parentElement, inner = false;
            while (p && p !== document.body) { if (!seen.has(p) && vis(p)) { inner = true; break; } p = p.parentElement; }
            if (!inner) fresh.push(e);
        }
        const area = (e) => { const r = e.getBoundingClientRect(); return r.width * r.height; };
        fresh.sort((a, b) => area(b) - area(a));
        root = fresh[0] && area(fresh[0]) > 600 ? fresh[0] : null;
    }
    if (root) root.setAttribute('data-uia-root', '1');
    const name = (e) => `${e.tagName.toLowerCase()}${e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : ''}${e.getAttribute('data-testid') ? '#' + e.getAttribute('data-testid') : ''}`;
    return { root: root ? name(root) : null, fresh: fresh.slice(0, 4).map(name) };
}, sel ?? null);
const rootUp = () => page.evaluate(() => {
    const e = document.querySelector('[data-uia-root]');
    if (!e || !e.isConnected) return false;
    const r = e.getBoundingClientRect(); const s = getComputedStyle(e);
    if (r.width === 0 || r.height === 0 || s.visibility === 'hidden') return false;
    const d = e.closest('details'); if (d && !d.open && !e.matches('summary')) return false;
    return true;
});
/** The measurement of the marked panel. scope: where its close controls live (default the panel). */
const measure = (scope) => page.evaluate((scope) => {
    const root = document.querySelector('[data-uia-root]');
    if (!root) return null;
    const W = innerWidth, H = innerHeight;
    const R = (r) => ({ x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) });
    const inside = (r) => r.left >= -1 && r.top >= -1 && r.right <= W + 1 && r.bottom <= H + 1;
    const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
    const rr = root.getBoundingClientRect();
    // scrolling: the panel or a part of it scrolls; else what does not fit is clipped or off the view
    let scroller = null;
    for (const e of [root, ...root.querySelectorAll('*')]) {
        const s = getComputedStyle(e);
        if (/(auto|scroll)/.test(s.overflowY) && e.scrollHeight > e.clientHeight + 1) { scroller = e; break; }
    }
    const accName = (e) => {
        const lab = e.getAttribute('aria-labelledby');
        const byId = lab ? lab.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ') : '';
        const forLab = e.id ? [...document.querySelectorAll(`label[for="${CSS.escape(e.id)}"]`)].map((l) => l.textContent).join(' ') : '';
        const wrap = e.closest('label')?.textContent ?? '';
        return [e.getAttribute('aria-label'), byId, e.textContent, e.getAttribute('title'), forLab, wrap, e.getAttribute('placeholder')].map((x) => (x ?? '').trim()).filter(Boolean)[0] ?? '';
    };
    const shape = (e) => { const s = getComputedStyle(e); const bg = s.backgroundColor; const hasBg = bg && !/rgba\(0, 0, 0, 0\)|transparent/.test(bg); const hasBorder = parseFloat(s.borderTopWidth) > 0 && s.borderTopStyle !== 'none'; return hasBg || hasBorder; };
    const CLOSE = /(^|[^a-z])(close|dismiss|continue|done|hide|collapse|back|cancel)([^a-z]|$)|panel-x|-x\b/i;
    const SYMBOL_X = /^[\u00d7\u2715\u2716\u2a2fxX]$/;
    const scopeEl = scope ? (root.closest(scope) ?? document.querySelector(scope) ?? root) : root;
    const closers = [];
    for (const e of scopeEl.querySelectorAll('button, [role=button], summary, a')) {
        if (!vis(e)) continue;
        const text = (e.textContent ?? '').trim().replace(/\s+/g, ' ');
        const hay = `${text} ${e.getAttribute('aria-label') ?? ''} ${e.getAttribute('title') ?? ''} ${e.getAttribute('data-action') ?? ''} ${typeof e.className === 'string' ? e.className : ''}`;
        if (!(e.matches('summary') || CLOSE.test(hay) || SYMBOL_X.test(text))) continue;
        const r = e.getBoundingClientRect();
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const at = cx >= 0 && cy >= 0 && cx < W && cy < H ? document.elementFromPoint(cx, cy) : null;
        const fs = parseFloat(getComputedStyle(e).fontSize);
        closers.push({ text: text.slice(0, 40), name: accName(e).slice(0, 40), action: e.getAttribute('data-action'), tag: e.tagName.toLowerCase(), rect: R(r), inView: inside(r), big: r.width >= 44 && r.height >= 44, shape: shape(e), font: fs, covered: at ? !(e === at || e.contains(at)) : 'off-view', coveredBy: at && !(e === at || e.contains(at)) ? `${at.tagName.toLowerCase()}.${String(at.className).split(' ')[0]}` : null });
        if (closers.length >= 6) break;
    }
    // the smallest text inside the view
    let minFont = Infinity, small = 0, smallText = '';
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = tw.nextNode(); n; n = tw.nextNode()) {
        if (!n.textContent.trim() || !n.parentElement || !vis(n.parentElement)) continue;
        const pe = n.parentElement; if (pe.closest('.visually-hidden, [aria-hidden=true] kbd')) continue;
        const f = parseFloat(getComputedStyle(pe).fontSize);
        if (f < 12) { small++; if (!smallText) smallText = n.textContent.trim().slice(0, 40); }
        if (f < minFont) minFont = f;
    }
    // controls: no accessible name, or a symbol as the only visible word
    const noName = [], symbolOnly = [], tinyTargets = [];
    for (const e of root.querySelectorAll('button, [role=button], [role=switch], [role=radio], input:not([type=hidden]), select, textarea, a, summary')) {
        if (!vis(e)) continue;
        const nm = accName(e); const text = (e.textContent ?? '').trim();
        const id = `${e.tagName.toLowerCase()}${e.getAttribute('data-action') ? '[' + e.getAttribute('data-action') + ']' : ''}`;
        if (!nm) noName.push(id);
        else if (e.tagName !== 'INPUT' && e.tagName !== 'SELECT' && e.tagName !== 'TEXTAREA' && text && !/[\p{L}\p{N}]{2}/u.test(text)) symbolOnly.push(`${id}"${text.slice(0, 6)}"`);
        const r = e.getBoundingClientRect();
        if (r.height < 24 || r.width < 24) tinyTargets.push(`${id}${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    // the close controls of the other open panels: is one covered by this panel?
    const others = [];
    for (const e of document.querySelectorAll('.panel-x, [data-action$=close], [data-action*="close"], [aria-label=Close]')) {
        if (root.contains(e) || !vis(e)) continue;
        const r = e.getBoundingClientRect(); const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        if (at && root.contains(at)) others.push(e.getAttribute('data-action') ?? e.className);
    }
    return {
        rect: R(rr), inView: inside(rr), panelH: Math.round(rr.height), vh: H,
        scrolls: !!scroller, scrollEl: scroller ? `${scroller.tagName.toLowerCase()}.${String(scroller.className).split(' ')[0]}` : null,
        clipped: !scroller && (rr.bottom > H + 1 || rr.top < -1 || rr.right > W + 1 || rr.left < -1 || root.scrollHeight > root.clientHeight + 2),
        text: (root.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 140),
        title: (root.querySelector('h1, h2, h3, [role=heading], summary')?.textContent ?? '').trim().slice(0, 50),
        closers, minFont: minFont === Infinity ? null : minFont, smallTexts: small, smallText,
        noName: noName.slice(0, 8), symbolOnly: symbolOnly.slice(0, 8), tinyTargets: tinyTargets.slice(0, 8), coversOthersClose: others
    };
}, scope ?? null);

// ---- page steps ---------------------------------------------------------------------------------------
async function startFlight(first) {
    await page.goto(`${base}/fly/?scene=${scene}&nowarn=1${render ? '' : '&render=off'}&set.input.play=easy`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__gsfpv?.status === 'ready', null, { timeout: 180000 });
    const asks = await page.waitForSelector('.screen.radio [data-action=radio-keyboard]', { timeout: 6000 }).then(() => true, () => false);
    if (asks && first) await first();
    if (await page.locator('.screen.radio [data-action=radio-keyboard]').count()) await page.locator('[data-action=radio-keyboard]').click().catch(() => {});
    await page.waitForFunction(() => !document.querySelector('.screen.radio'), null, { timeout: 15000 }).catch(() => {});
    await settle(1200);
}
async function tidy() {
    for (let i = 0; i < 3; i++) {
        if (!await rootUp() && !await page.locator('[data-action="pause.continue"]').count()) return;
        await page.keyboard.press('Escape'); await settle(400);
        const c = page.locator('[data-action="pause.continue"]');
        if (await c.count()) await c.first().click({ timeout: 2000 }).catch(() => {});
        await settle(300);
    }
    if (await rootUp()) { await startFlight(); }
}
/** A point inside the view, outside the panel, where nothing but the view (canvas, #ui, body) is. */
const outsidePoint = () => page.evaluate(() => {
    const root = document.querySelector('[data-uia-root]'); if (!root) return null;
    const r = root.getBoundingClientRect();
    for (let gy = 0.15; gy < 0.95; gy += 0.1) for (let gx = 0.05; gx < 0.96; gx += 0.1) {
        const x = innerWidth * gx, y = innerHeight * gy;
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) continue;
        const at = document.elementFromPoint(x, y);
        if (at && (at.tagName === 'CANVAS' || at.id === 'ui' || at === document.body || at.id === 'app')) return { x, y };
    }
    return null;
});

async function panel(name, spec) {
    if (only && !only.includes(name)) return;
    const rec = { open: spec.how, ways: {} };
    out.panels[name] = rec;
    try {
        if (spec.page === 'sonic') { /* the start screen is already up */ }
        await snap();
        await spec.open(); await settle(spec.wait ?? 1200);
        const m = await markRoot(spec.sel);
        rec.found = m;
        if (!m.root) { rec.missing = true; console.log(`${name}: nothing opened ${JSON.stringify(m)}`); await tidy(); return; }
        rec.m = await measure(spec.scope);
        if (shots) await page.screenshot({ path: `${shots}/raw-${name}-${size}.png` });
        // every way to close, each from a fresh open
        const tryWay = async (way, act) => {
            if (!await rootUp()) { await snap(); await spec.open(); await settle(spec.wait ?? 1000); await markRoot(spec.sel); }
            if (!await rootUp()) { rec.ways[way] = 'reopen-failed'; return; }
            await act(); await settle(700);
            rec.ways[way] = !await rootUp();
        };
        await tryWay('esc', () => page.keyboard.press('Escape'));
        if (spec.again) await tryWay('again', spec.again);
        if (!spec.noOutside) await tryWay('outside', async () => { const p = await outsidePoint(); if (p) await page.mouse.click(p.x, p.y); else rec.noOutsidePoint = true; });
        const closer = rec.m.closers.find((c) => c.inView && c.covered === false);
        if (closer) await tryWay(`control:${closer.name || closer.text}`, async () => {
            const loc = page.locator(`[data-uia-root] ${closer.tag}, ${spec.scope ?? '[data-uia-root]'} ${closer.tag}`).filter({ hasText: closer.text || undefined });
            const c = closer.action ? page.locator(`[data-action="${closer.action}"]`).first() : loc.first();
            await c.click({ timeout: 2000 }).catch(() => {});
        });
        const w = rec.ways; const m2 = rec.m;
        console.log(`${name}: ${m.root} "${m2.text.slice(0, 60)}" rect ${JSON.stringify(m2.rect)} inView ${m2.inView} scrolls ${m2.scrolls} clipped ${m2.clipped} minFont ${m2.minFont} closers ${m2.closers.map((c) => `${c.name || c.text}@${c.rect.w}x${c.rect.h}${c.inView ? '' : '!out'}${c.covered ? '!covered' : ''}`).join('|')} ways ${JSON.stringify(w)}`);
    } catch (e) { rec.error = String(e.message ?? e).slice(0, 200); console.log(`${name}: error ${rec.error}`); }
    await tidy();
}
/** A click on the element's centre if it is on top there, else el.click() (and the cover is recorded). */
async function clickJs(sel) {
    const r = await page.evaluate((sel) => {
        const e = document.querySelector(sel); if (!e) return { missing: true };
        const b = e.getBoundingClientRect(); const at = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
        const top = !!at && (at === e || e.contains(at));
        if (!top) e.click();
        return { top, at: at ? `${at.tagName.toLowerCase()}.${String(at.className).split(' ')[0]}` : null, rect: [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)] };
    }, sel);
    (out.clicks ??= []).push({ sel, ...r });
    if (r.top) await page.locator(sel).click({ timeout: 3000 });
}
const key = (k) => async () => { await page.keyboard.press(k); };
const viaPause = (action) => async () => {
    await page.keyboard.press('KeyP');
    await page.waitForSelector('[data-action="pause.continue"]', { timeout: 5000 });
    await page.locator(`[data-action="${action}"]`).first().click({ timeout: 3000 });
};

// ---- the flight page -------------------------------------------------------------------------------------
if (!only || only.some((n) => !n.startsWith('sonic'))) {
    await startFlight(async () => {
        // the first visit: the Controls screen and the cookie card before anything is picked
        await snap().catch(() => {});
        await page.evaluate(() => document.querySelector('.screen.radio')?.setAttribute('data-uia-root', '1'));
        const m = await measure();
        out.panels['controls-first'] = { open: 'first visit', m, ways: {} };
        if (shots) await page.screenshot({ path: `${shots}/raw-controls-first-${size}.png` });
        console.log(`controls-first: rect ${JSON.stringify(m?.rect)} scrolls ${m?.scrolls} clipped ${m?.clipped} minFont ${m?.minFont} closers ${(m?.closers ?? []).map((c) => `${c.name || c.text}@${c.rect.w}x${c.rect.h}`).join('|')}`);
        const consent = await page.evaluate(() => { const c = document.querySelector('[data-testid=consent]'); if (!c) return null; c.setAttribute('data-uia-root', '1'); return true; });
        if (consent) { document; out.panels.consent = { open: 'first visit', m: await measure(), ways: {} }; await page.evaluate(() => document.querySelector('[data-testid=consent]')?.removeAttribute('data-uia-root')); }
        await page.evaluate(() => document.querySelector('.screen.radio')?.removeAttribute('data-uia-root'));
    });
    // always-on lines: measured as they are (no close expected)
    for (const [name, sel] of [['credit', '[data-testid=attribution]'], ['hud', '.hud'], ['mode-chip', '.mode-chip'], ['howto', '.how-to-fly, .controls-card'], ['walls-box', '[data-testid=walls-box]'], ['consent-now', '[data-testid=consent]']]) {
        if (only && !only.includes(name)) continue;
        const ok = await page.evaluate((sel) => { document.querySelectorAll('[data-uia-root]').forEach((e) => e.removeAttribute('data-uia-root')); const e = [...document.querySelectorAll(sel)].find((x) => x.getBoundingClientRect().height > 0); if (e) e.setAttribute('data-uia-root', '1'); return !!e; }, sel);
        out.panels[name] = ok ? { open: 'always', m: await measure() } : { open: 'always', missing: true };
        if (ok) console.log(`${name}: rect ${JSON.stringify(out.panels[name].m.rect)} minFont ${out.panels[name].m.minFont} closers ${out.panels[name].m.closers.map((c) => `${c.name || c.text}@${c.rect.w}x${c.rect.h}`).join('|')}`);
    }
    const summary = '[data-testid=walls-summary]';
    await panel('walls-menu', { how: 'click the walls line (bottom left credit)', open: () => clickJs(summary), again: () => clickJs(summary), sel: '[data-testid=walls-more][open] .walls-menu', scope: '[data-testid=walls-more]' });
    await panel('voxel-legend', { how: 'V', open: key('KeyV'), again: async () => { for (let i = 0; i < 3; i++) await page.keyboard.press('KeyV'); }, sel: '[data-testid=voxel-legend]', noOutside: false });
    await panel('pause', { how: 'P or Esc', open: key('KeyP'), again: key('KeyP') });
    await panel('keys', { how: 'K', open: key('KeyK'), again: key('KeyK') });
    await panel('settings', { how: 'O', open: key('KeyO'), again: key('KeyO') });
    await panel('feedback', { how: 'B', open: key('KeyB'), again: key('KeyB') });
    await panel('share', { how: 'L', open: key('KeyL'), again: key('KeyL') });
    await panel('rooms', { how: '9', open: key('Digit9'), again: key('Digit9') });
    await panel('frame-stats', { how: 'F3', open: key('F3'), again: key('F3') });
    await panel('recording', { how: 'F9', open: key('F9'), again: key('F9'), wait: 2000 });
    await panel('course', { how: 'Shift+G', open: key('Shift+KeyG'), again: key('Shift+KeyT'), wait: render ? 25000 : 4000 });
    await panel('course-editor', { how: 'Shift+B', open: key('Shift+KeyB'), again: key('Shift+KeyB'), wait: render ? 6000 : 2500 });
    // the pause menu's items that open a window
    let items = [];
    try {
        await page.keyboard.press('KeyP');
        await page.waitForSelector('[data-action="pause.continue"]', { timeout: 5000 });
        items = await page.evaluate(() => [...document.querySelectorAll('.sum-menu button[data-action]')].filter((b) => !b.disabled).map((b) => ({ action: b.getAttribute('data-action'), label: (b.querySelector('.pm-label')?.textContent ?? '').trim() })));
        out.pauseItems = items;
        await page.locator('[data-action="pause.continue"]').click();
        await settle();
    } catch (e) { out.pauseItemsError = String(e.message).slice(0, 120); }
    const skip = /continue|respawn|restart|rewind|next|random|exit|leave|home|fullscreen|arm|hud|mode|walls|voxel|course\.generate|course\.toggle|record|scale|favourite|throttle/;
    for (const it of items) {
        if (skip.test(it.action)) { (out.skipped ??= []).push(it.action); continue; }
        await panel(`menu:${it.action}`, { how: `P, ${it.label}`, open: viaPause(it.action), wait: 1500 });
    }
    await panel('helper', { how: 'P, Controls, My controller is not in the list', open: async () => { await viaPause('pause.radio')(); await settle(800); await page.locator('[data-action=usb-look], [data-action*=missing]').first().click({ timeout: 3000 }); }, wait: 1500 });
}

// ---- the Fly by Sound start screen -----------------------------------------------------------------------
if (!only || only.some((n) => n.startsWith('sonic'))) {
    await page.goto(`${base}/fly/?sonic=start&nowarn=1${render ? '' : '&render=off'}`, { waitUntil: 'load' });
    await page.waitForSelector('.sonic-start', { timeout: 60000 }).catch(() => {});
    await settle(1500);
    await page.evaluate(() => { document.querySelectorAll('[data-uia-root]').forEach((e) => e.removeAttribute('data-uia-root')); document.querySelector('.sonic-start')?.setAttribute('data-uia-root', '1'); });
    const m = await measure();
    out.panels['sonic-start'] = { open: '?sonic=start', m, ways: {} };
    if (shots) await page.screenshot({ path: `${shots}/raw-sonic-start-${size}.png` });
    if (m) { await page.keyboard.press('Escape'); await settle(700); out.panels['sonic-start'].ways.esc = !await rootUp(); }
    console.log(`sonic-start: ${JSON.stringify(m?.rect)} scrolls ${m?.scrolls} minFont ${m?.minFont} closers ${(m?.closers ?? []).map((c) => `${c.name || c.text}@${c.rect.w}x${c.rect.h}`).join('|')}`);
}

writeFileSync(outFile, JSON.stringify(out, null, 1));
await browser.close();
const faults = Object.entries(out.panels).filter(([, p]) => p.m && (!p.m.inView || p.m.clipped || (p.m.minFont ?? 99) < 12 || p.m.noName.length || p.m.closers.some((c) => !c.inView || c.covered || !c.big))).map(([n]) => n);
console.log(JSON.stringify({ size, panels: Object.keys(out.panels).length, faults, errors: errors.length }));
