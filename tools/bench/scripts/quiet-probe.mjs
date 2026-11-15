// Lane quiet (train 3, the owner's message 54): does a flight in Fly by Sound wait for spoken lines? On a local release, render off
// (no GPU lock): open a scan, set the sound mode's settings in the prefs document (READER=1: "my screen reader speaks", selfVoice off;
// NARRATOR=off: the narrator setting off, when the build has it), press Backslash (Fly by Sound in place) and hold KeyW at once.
// Per 100 ms: the runner's phase, the host's speech queue, the last line, the craft's speed and height. Then Shift+G: the course's
// ready time and the first hum of its gate 1. Then FLY_S seconds of the flight; at the end every speech event of the mode is counted.
// Usage: node tools/bench/scripts/quiet-probe.mjs <base with /en> <out.json> <scene>
// Nothing is saved or sent: only keys of the flight page are pressed.
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { pickBrowser } from '../src/chrome.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [base, outFile, scene] = process.argv.slice(2);
if (!base || !outFile || !scene) { console.error('usage: quiet-probe.mjs <base with /en> <out.json> <scene>'); process.exit(2); }
const READER = process.env.READER === '1';
const NARRATOR = process.env.NARRATOR ?? 'on';
const FLY_S = Number(process.env.FLY_S ?? 180);
const pick = pickBrowser({ expected: chromium.executablePath() });
const browser = await chromium.launch({ ...pick.launch, headless: true });
const out = { base, scene, reader: READER, narrator: NARRATOR, samples: [], errors: [] };
const save = () => writeFileSync(outFile, JSON.stringify(out, null, 1));

const READ = () => {
    const g = window.__gsfpv || {};
    let so = null;
    try { so = g.sonic ? g.sonic(false) : null; } catch { so = null; }
    const s = g.session && g.session.sim ? g.session.sim.s : null;
    const c = g.course;
    return {
        phase: so ? so.phase ?? null : null,
        lesson: so ? so.lesson ?? null : null,
        q: so ? so.speechQueue ?? null : null,
        line: so ? so.lastLine ?? null : null,
        hum: so && so.hum ? true : false,
        target: so && so.target ? so.target.id ?? 'x' : null,
        speed: s ? Math.hypot(s[3], s[4], s[5]) : null,
        vy: s ? s[4] : null,
        pos: s ? [s[0], s[1], s[2]] : null,
        gates: c ? c.gates : 0,
        next: c ? c.next : null,
        cues: so && so.cues ? so.cues : null
    };
};
// Stage fixes pass 2: what the page hands to the voice (speechSynthesis.speak) and to a screen reader (text added inside a live
// region that is not aria-hidden), each with its time on the page clock
const HOOKS = () => {
    const q = { speak: [], live: [] };
    window.__qp = q;
    try {
        const sp = SpeechSynthesis.prototype.speak;
        SpeechSynthesis.prototype.speak = function (u) { q.speak.push({ t: performance.now(), text: String(u && u.text || '').slice(0, 90) }); return sp.call(this, u); };
    } catch { q.speak = null; }
    const liveOf = (n) => {
        const el = n.nodeType === 1 ? n : n.parentElement;
        if (!el) return null;
        if (el.closest('[aria-hidden="true"]')) return null;
        const r = el.closest('[aria-live]');
        return r && r.getAttribute('aria-live') !== 'off' ? r : null;
    };
    const watch = () => new MutationObserver((ms) => {
        for (const m of ms) {
            const nodes = m.type === 'characterData' ? [m.target] : [...m.addedNodes];
            for (const n of nodes) {
                const r = liveOf(n);
                const text = (n.textContent || '').trim();
                if (r && text) q.live.push({ t: performance.now(), where: (r.id || r.className || r.tagName).toString().slice(0, 40), text: text.slice(0, 90) });
            }
        }
    }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    if (document.documentElement) watch(); else document.addEventListener('DOMContentLoaded', watch);
};
const QUOTE = process.env.QUOTE === '1';
const KI = process.env.KI === '1';
const SET_PREFS = ([reader, narrator]) => {
    for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        let d;
        try { d = JSON.parse(localStorage.getItem(k)); } catch { continue; }
        if (!d || !d.collections || !d.collections.sonic) continue;
        const p = { ...(d.collections.sonic.prefs || {}) };
        if (reader) p.selfVoice = false;
        if (narrator === 'off') p.narrator = false;
        d.collections.sonic.prefs = p;
        localStorage.setItem(k, JSON.stringify(d));
        return k;
    }
    return null;
};

async function openPage() {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    await ctx.addInitScript(HOOKS);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => out.errors.push(String(e.message).slice(0, 160)));
    const url = `${base}/fly/?scene=${scene}&nowarn=1&set.input.howToFly=false&render=off`;
    await page.goto(url, { waitUntil: 'load', timeout: 120000 });
    await page.waitForFunction(() => ['ready', 'error'].includes(window.__gsfpv && window.__gsfpv.status), null, { timeout: 300000 });
    out.prefsKey = await page.evaluate(SET_PREFS, [READER, NARRATOR]);
    await page.goto(url, { waitUntil: 'load', timeout: 120000 });
    await page.waitForFunction(() => ['ready', 'error'].includes(window.__gsfpv && window.__gsfpv.status), null, { timeout: 300000 });
    await page.waitForFunction(() => { const w = window.__gsfpv && window.__gsfpv.walls; return w && w.state !== 'checking'; }, null, { timeout: 60000 }).catch(() => 0);
    await page.waitForTimeout(1500);
    const x = page.locator('.screen.radio [data-action=radio-close]');
    if (await x.count()) { await x.first().click(); await page.waitForTimeout(800); }
    return { ctx, page };
}

async function sample(page, t0, ms, tag) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        const r = await page.evaluate(READ);
        out.samples.push({ t: +((Date.now() - t0) / 1000).toFixed(2), tag, ...r });
        await page.waitForTimeout(100);
    }
}

try {
    const { page } = await openPage();
    const t0 = Date.now();
    const p0 = await page.evaluate(() => performance.now());
    // the mode on and the stick at once: KeyW held for 2 s from the press
    await page.keyboard.press('Backslash');
    await page.keyboard.down('KeyW');
    await sample(page, t0, 2000, 'w');
    await page.keyboard.up('KeyW');
    await sample(page, t0, 14000, 'on');
    // KeyW again 16 s after the press: does the craft answer then?
    await page.keyboard.down('KeyW');
    await sample(page, t0, 1500, 'w2');
    await page.keyboard.up('KeyW');
    await sample(page, t0, 2500, 'on');
    const tg = Date.now();
    out.shiftG = +((tg - t0) / 1000).toFixed(2);
    await page.keyboard.press('Shift+KeyG');
    const endG = Date.now() + 240000;
    while (Date.now() < endG) {
        const r = await page.evaluate(READ);
        out.samples.push({ t: +((Date.now() - t0) / 1000).toFixed(2), tag: 'g', ...r });
        if (r.gates > 0 && out.courseReady === undefined) out.courseReady = +((Date.now() - tg) / 1000).toFixed(2);
        if (r.gates > 0 && r.hum && r.target && out.firstHum === undefined) { out.firstHum = +((Date.now() - tg) / 1000).toFixed(2); out.humTarget = r.target; }
        if (out.firstHum !== undefined && Date.now() - tg > out.firstHum * 1000 + 3000) break;
        await page.waitForTimeout(100);
    }
    console.log('course', out.courseReady, 'hum', out.firstHum, out.humTarget);
    save();
    if (KI) {
        // lane quiet2 N1: K (the key help) and I (the status) asked by the pilot are spoken in every setting
        out.ki = [];
        for (const k of ['KeyK', 'KeyI']) {
            out.ki.push({ key: k, t: +((Date.now() - t0) / 1000).toFixed(2) });
            await page.keyboard.press(k);
            await sample(page, t0, 2000, k);
            // W2 finding (a): K's help holds the flight while it speaks and any key cuts it (mode-keys.ts KeyHelp), so I is pressed
            // after the hold ends (at most 90 s), else I only cuts the help ("Back to the flight.")
            const endK = Date.now() + 90000;
            while (Date.now() < endK && (await page.evaluate(() => !!(window.__gsfpv?.session?.paused)))) await sample(page, t0, 500, k);
            out.ki[out.ki.length - 1].heldUntil = +((Date.now() - t0) / 1000).toFixed(2);
            await sample(page, t0, 2000, k);
        }
    }
    if (QUOTE) {
        // Q4, lane quiet2 N2: the narrator key (Shift+V) twice in the flight (off then on when it starts on; on then off when it starts off)
        out.quote = [];
        for (let i = 0; i < 2; i++) {
            out.quote.push(+((Date.now() - t0) / 1000).toFixed(2));
            await page.keyboard.press('Shift+KeyV');
            await sample(page, t0, 4000, 'quote' + (i + 1));
        }
    }
    // the rest of the flight: hovering with the course, FLY_S s from the press, sampled each second
    const endF = t0 + FLY_S * 1000;
    while (Date.now() < endF) {
        out.samples.push({ t: +((Date.now() - t0) / 1000).toFixed(2), tag: 'fly', ...(await page.evaluate(READ)) });
        await page.waitForTimeout(1000);
    }
    const ev = await page.evaluate(() => { const so = window.__gsfpv.sonic(true); return (so.events || []).filter((e) => e.kind === 'speech' || e.kind === 'lesson').map((e) => ({ t: e.t, kind: e.kind, key: e.key ?? e.what, text: (e.text || '').slice(0, 90) })); });
    out.events = ev;
    out.spoken = ev.filter((e) => e.kind === 'speech' && e.key !== 'speech.end').length;
    const qp = await page.evaluate(() => window.__qp || null);
    const rel = (a) => (a || []).map((x) => ({ ...x, t: +((x.t - p0) / 1000).toFixed(2) }));
    out.voiced = qp && qp.speak ? rel(qp.speak) : null;
    out.live = qp ? rel(qp.live) : null;
    out.prefsNow = await page.evaluate(() => { for (let i = 0; i < localStorage.length; i++) { try { const d = JSON.parse(localStorage.getItem(localStorage.key(i))); if (d && d.collections && d.collections.sonic) return d.collections.sonic.prefs || null; } catch { /* not ours */ } } return null; });
    console.log('spoken', out.spoken, 'voiced', out.voiced ? out.voiced.filter((v) => v.t >= 0).length : 'n/a', 'live', out.live ? out.live.filter((v) => v.t >= 0).length : 'n/a', 'errors', out.errors.length);
} catch (e) { out.fail = String(e).slice(0, 300); console.log('FAIL', out.fail); }
save();
await browser.close();
