// Lane sr-quiet: what a screen reader is handed while flying (a blind tester's JAWS report of 2026-11-20: "12.6v 8 1 sekunda" read
// every second). Counts the text changes inside the page's live region #ui that are not aria-hidden and not aria-live "off", during
// FLY_S seconds of a flight (keys held), in the plain flight and in Fly by Sound in place (Backslash, narrator on); and reads the
// start screen of Fly by Sound (?sonic=start) for the list of flying keys. Render off, headless.
// Usage: node tools/bench/scripts/sr-quiet-probe.mjs <base with /pl> <out.json>
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { pickBrowser } from '../src/chrome.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [base, outFile] = process.argv.slice(2);
if (!base || !outFile) { console.error('usage: sr-quiet-probe.mjs <base with /pl> <out.json>'); process.exit(2); }
const FLY_S = Number(process.env.FLY_S ?? 8);
const pick = pickBrowser({ expected: chromium.executablePath() });
const browser = await chromium.launch({ ...pick.launch, headless: true });
const out = { base, runs: {}, errors: [] };

const HOOK = () => {
    const q = { live: [] };
    window.__srq = q;
    const spoken = (n) => {
        const el = n.nodeType === 1 ? n : n.parentElement;
        if (!el || !el.closest('#ui')) return false;
        if (el.closest('[aria-hidden="true"]')) return false;
        const live = el.closest('[aria-live], [role="status"], [role="alert"], [role="log"]');
        if (!live) return false;
        return live.getAttribute('aria-live') !== 'off';
    };
    const start = () => new MutationObserver((ms) => {
        for (const m of ms) {
            const nodes = m.type === 'characterData' ? [m.target] : [...m.addedNodes];
            for (const n of nodes) if (spoken(n) && (n.textContent || '').trim()) {
                const el = n.nodeType === 1 ? n : n.parentElement;
                const path = [];
                for (let e = el; e && e.id !== 'ui' && path.length < 6; e = e.parentElement) path.push(e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.split(' ')[0] : '') + (e.dataset && e.dataset.testid ? `[${e.dataset.testid}]` : ''));
                q.live.push({ t: Math.round(performance.now()), text: n.textContent.trim().slice(0, 80), path: path.join('<') });
            }
        }
    }).observe(document.documentElement, { subtree: true, childList: true, characterData: true });
    if (document.documentElement) start(); else addEventListener('DOMContentLoaded', start);
};

async function flight(name, url, sound) {
    const page = await browser.newPage({ viewport: { width: 1536, height: 730 } });
    page.on('pageerror', (e) => out.errors.push(`${name}: ${String(e).slice(0, 200)}`));
    await page.addInitScript(HOOK);
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction(() => ['ready', 'error'].includes(window.__gsfpv && window.__gsfpv.status), null, { timeout: 300000 });
    await page.waitForTimeout(3000);
    // the pointer captured by a click in the scene, as a pilot does; a panel left open (paused) is closed with Escape first
    const why = await page.evaluate(() => ({ paused: !!(window.__gsfpv.session && window.__gsfpv.session.paused), open: [...document.querySelectorAll('#ui [data-testid$="-panel"], #ui .panel:not(.hidden)')].map((e) => e.getAttribute('data-testid') || e.className).slice(0, 5) }));
    out.runs[`${name}-before`] = why;
    await page.waitForFunction(() => { const w = window.__gsfpv && window.__gsfpv.walls; return w && w.state !== 'checking'; }, null, { timeout: 60000 }).catch(() => 0);
    for (let i = 0; i < 4; i++) {
        if (!(await page.evaluate(() => !!(window.__gsfpv.session && window.__gsfpv.session.paused)))) break;
        await page.keyboard.press('Escape');
        await page.waitForTimeout(700);
    }
    await page.mouse.click(760, 400);
    await page.waitForTimeout(500);
    out.runs[`${name}-before`].after = await page.evaluate(() => ({ paused: !!(window.__gsfpv.session && window.__gsfpv.session.paused), reasons: window.__gsfpv.session && window.__gsfpv.session.pauseReasons ? [...window.__gsfpv.session.pauseReasons] : null }));
    if (sound) {
        await page.keyboard.press('Backslash');
        await page.waitForTimeout(4000);
    }
    const t0 = await page.evaluate(() => performance.now());
    await page.keyboard.down('Space');
    await page.waitForTimeout(1500);
    await page.keyboard.up('Space');
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(FLY_S * 1000);
    await page.keyboard.up('KeyW');
    const r = await page.evaluate((t) => {
        const q = window.__srq;
        const tr = document.querySelector('.hud .osd.tr');
        return { during: q.live.filter((e) => e.t >= t), trText: tr ? tr.textContent : null, paused: !!(window.__gsfpv && window.__gsfpv.session && window.__gsfpv.session.paused), trHidden: tr ? tr.getAttribute('aria-hidden') : null, uiLive: document.getElementById('ui')?.getAttribute('aria-live') ?? null };
    }, t0);
    out.runs[name] = { url, flyS: FLY_S, liveChanges: r.during.length, perSecond: +(r.during.length / (FLY_S + 1.5)).toFixed(2), sample: r.during.slice(0, 12), trText: r.trText, paused: r.paused, trHidden: r.trHidden, uiLive: r.uiLive };
    await page.close();
}

async function startScreen() {
    const page = await browser.newPage({ viewport: { width: 1536, height: 730 } });
    await page.goto(`${base}/fly/?sonic=start&render=off`, { waitUntil: 'load' });
    await page.waitForSelector('[data-testid="sonic-keys-list"]', { timeout: 60000 }).catch(() => null);
    const list = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="sonic-keys-list"]');
        if (!el) return { missing: true, body: document.body.innerText.slice(0, 600), h2: [...document.querySelectorAll('h2,h3')].map((x) => x.textContent) };
        return el ? { text: el.innerText, hidden: !!el.closest('[aria-hidden="true"]'), visible: el.getBoundingClientRect().height > 0 } : null;
    });
    out.runs.startScreen = { keysList: list };
    await page.close();
}

try {
    await flight('plain', `${base}/fly/?scene=${process.env.SCENE ?? "887f27aa"}&nowarn=1&set.input.howToFly=false&render=off`, false);
    await flight('sound', `${base}/fly/?scene=${process.env.SCENE ?? "887f27aa"}&nowarn=1&set.input.howToFly=false&render=off`, true);
    await startScreen();
} catch (e) {
    out.errors.push(String(e).slice(0, 300));
} finally {
    await browser.close();
    // ASCII JSON (B18: evidence holds no non-English letters; the Polish texts of a /pl run are escaped, the values unchanged)
    const ascii = (s) => s.replace(/[^\x00-\x7f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
    writeFileSync(outFile, ascii(JSON.stringify(out, null, 1)));
    console.log(JSON.stringify({ plain: out.runs.plain?.liveChanges, sound: out.runs.sound?.liveChanges, keysList: !!out.runs.startScreen?.keysList, errors: out.errors.length }));
}
