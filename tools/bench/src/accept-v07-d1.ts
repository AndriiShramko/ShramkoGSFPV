// v0.7 lane D1 acceptance (docs/wip/v07-d1.md), in the real page, logic-only (?render=off: the scan is
// not drawn; nothing here is a visual or latency check). Fresh browser contexts only.
//   S1  the top bar's Share: icon and word on a computer, the icon alone at phone width (390 px);
//       L opens the share panel (entry key); without the API (the dev server) the link is the scene
//       page /{lang}/scenes/<id>/ of a catalogue scan and the panel says the picture link failed;
//       Esc closes it and the flight runs again. Control: before L no share panel is on the page.
//   S2  a picker card's Share (no flight): the scene page, never a picture.
//   S3  a scan outside the catalogue records (F9), the author notice shows, the video's share panel
//       has the file (entry video). Control: the notice is gone after "Don't show again" and a reload.
//   S4  the crosshair: off by default, 'cross' shows it, cinema mode hides it. Control: off = no mark.
//   S5  the motor sound: a click makes the AudioContext run; the bot flying armed is heard, the pause
//       menu is silence. Control: sound.motors off is silence while flying.
//   S6  an auto-recorded flight (Auto on, ARM, DISARM, saved 3 s later), split into parts, after a
//       manual recording: the bar offers "Share your flight" with the new note, and the share panel
//       has every part of the new recording. Control: the review's run against e344977 (the auto stop
//       dropped its result: the manual note came back, its button shared the last part only),
//       evidence/2026-10-13/v07-d1-S6-control-e344977.json.
//   S1 also: Instagram with the clipboard API refused and the old execCommand copy working leaves the
//       link in the link field. Control: e344977 left the caption there, its line breaks stripped by
//       the input, evidence/2026-10-13/v07-d1-S1-control-e344977.json.
//   S7  the burned-in credit is whole in an upright recording (a phone, 390 x 844 -> about 500 x
//       1080 at 1080p) of the catalogue's longest credit: a frame of the file (ffmpeg) has the text on
//       two lines or more and no letter at the right edge (the page is not drawn: the text is the only
//       light thing in the frame). Picture: evidence/<date>/d1-ui/credit-portrait.png. Control:
//       e344977's recorder (one clipped line), evidence/2026-10-13/v07-d1-S7-control-e344977.json.
// Run (one port per agent; GPU lock as tools/bench/README.md, even though nothing is drawn):
//   cd apps/fly && npx vite --port 5341 --strictPort --host 127.0.0.1
//   cd tools/bench && LOCAL_FLY=1 SITE=http://127.0.0.1:5341 npx tsx src/accept-v07-d1.ts [S1 S6 ...]
// Evidence: evidence/<date>/v07-d1.json (v07-d1-<parts>.json when only some parts run;
// EVIDENCE_SUFFIX names a second run, e.g. -control-e344977 against an older commit).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Browser, Page } from 'playwright';
import { launchChrome, waitReady } from './browser';
import { REPO, noteBrowser, today, writeEvidence } from './evidence';

const SITE = (process.env.SITE ?? 'http://127.0.0.1:5341').replace(/\/$/, '');
const fly = (qs: string) => (process.env.LOCAL_FLY ? `${SITE}/fly/?${qs}` : `${SITE}/en/fly/?${qs}`);
const SHOWCASE = '39e63ce9'; // in apps/fly/public/showcase.json
const PASTED = '723068d7'; // not in it
const BOT = '887f27aa'; // the tour bot's scene (accept-d.ts)
const PARTS = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7'];
const FFMPEG = process.env.FFMPEG ?? 'C:/Program Files/Shutter Encoder/Library/ffmpeg.exe';
/** `npx tsx src/accept-v07-d1.ts S1 S6`: only these parts */
const only = process.argv.slice(2).filter((a) => PARTS.includes(a));
const want = (part: string): boolean => only.length === 0 || only.includes(part);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const hook = <T = Any>(p: Page, body: string): Promise<T> => p.evaluate(`(async () => { const h = window.__gsfpv; const s = h.session; ${body} })()`) as Promise<T>;
const until = async (p: Page, expr: string, ms = 15000): Promise<boolean> => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
        if (await p.evaluate(expr)) return true;
        await p.waitForTimeout(150);
    }
    return false;
};

async function page(browser: Browser, width = 1280, height = 800): Promise<{ p: Page; errors: string[]; close: () => Promise<void> }> {
    const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
    const p = await ctx.newPage();
    const errors: string[] = [];
    p.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('Failed to load resource')) errors.push(m.text().slice(0, 300)); });
    p.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`.slice(0, 300)));
    return { p, errors, close: () => ctx.close() };
}

const { browser, which } = await launchChrome({ headless: false, args: ['--window-position=40,40', '--window-size=1296,920', '--autoplay-policy=user-gesture-required'] });
noteBrowser(which);
const out: Record<string, Any> = { site: SITE, render: 'off' };

// ------------------------------------------------------------------ S1
if (want('S1')) {
    const { p, errors, close } = await page(browser);
    // the keyboard path (lat=1): touch sticks (input=touch) show the icon alone, as on a phone
    await p.goto(fly(`scene=${SHOWCASE}&nowarn=1&lat=1&render=off`));
    await waitReady(p, 240000);
    await p.waitForTimeout(800);
    const top = await p.evaluate(`(() => { const b = document.querySelector('[data-action=share-top]'); const l = b && b.querySelector('.share-top-label'); return b ? { shown: b.getClientRects().length > 0, label: l ? getComputedStyle(l).display !== 'none' : null, aria: b.getAttribute('aria-label') } : null; })()`) as Any;
    const before = await p.evaluate(`!!document.querySelector('.panel.share')`);
    await p.keyboard.press('KeyL');
    const opened = await until(p, `!!document.querySelector('.panel.share')`);
    await until(p, `(() => { const st = window.__gsfpv.share.state(); return !!(st && st.url); })()`, 20000);
    const st = await hook(p, 'return { ...h.share.state(), paused: s.paused, status: document.querySelector("[data-testid=share-status]").textContent, targets: document.querySelectorAll(".panel.share [data-share]").length, instagram: !!document.querySelector("[data-action=share-instagram]") };');
    // Instagram where the clipboard API is refused but the old execCommand copy works (an http page,
    // an older browser): the caption is copied, the link field still shows the link
    const insta = await hook(p, `navigator.clipboard.writeText = () => Promise.reject(new Error('denied')); document.execCommand = () => true;
        document.querySelector('[data-action=share-instagram]').click(); await new Promise((r) => setTimeout(r, 500));
        return { field: document.querySelector('[data-testid=share-url]').value, url: h.share.state().url, status: document.querySelector('[data-testid=share-status]').textContent };`);
    await p.keyboard.press('Escape');
    await p.waitForTimeout(400);
    const after = await hook(p, 'return { panel: !!document.querySelector(".panel.share"), paused: s.paused };');
    await close();
    const phone = await page(browser, 390, 780);
    await phone.p.goto(fly(`scene=${SHOWCASE}&nowarn=1&input=touch&render=off`));
    await waitReady(phone.p, 240000);
    await phone.p.waitForTimeout(800);
    const topPhone = await phone.p.evaluate(`(() => { const b = document.querySelector('[data-action=share-top]'); const l = b && b.querySelector('.share-top-label'); return b ? { shown: b.getClientRects().length > 0, label: getComputedStyle(l).display !== 'none' } : null; })()`) as Any;
    await phone.close();
    const pass = !!top && top.shown && top.label === true && /\(L\)/.test(top.aria) && !!topPhone && topPhone.shown && topPhone.label === false
        && opened && st.entry === 'key' && new RegExp(`/scenes/${SHOWCASE}/$`).test(st.url) && st.paused === true && st.targets === 6 && st.instagram
        && after.panel === false && after.paused === false && before === false && insta.field === insta.url;
    out.S1 = { pass, top, topPhone, panel: st, instagramFallback: insta, after, control: { what: 'before L: no share panel on the page', fired: before === false }, consoleErrors: errors };
    console.log('S1', pass ? 'PASS' : 'FAIL', JSON.stringify({ top, topPhone, url: st.url, entry: st.entry, paused: st.paused, after, insta }));
}

// ------------------------------------------------------------------ S2
if (want('S2')) {
    const { p, errors, close } = await page(browser);
    await p.goto(fly('nowarn=1&render=off'));
    await waitReady(p, 120000);
    await p.waitForTimeout(800);
    const card = await p.evaluate(`(() => { const b = document.querySelector('.scene-grid .scene-share, .sf-row .scene-share'); return b ? b.getAttribute('data-scene') : null; })()`) as string | null;
    if (card) await p.click(`.scene-share[data-scene="${card}"]`);
    await until(p, `!!document.querySelector('.panel.share [data-testid=share-url]:not([hidden])')`);
    const st = await p.evaluate(`(() => ({ url: document.querySelector('[data-testid=share-url]').value, entry: document.querySelector('.panel.share').dataset.entry, picture: !!document.querySelector('[data-testid=share-picture]') }))()`) as Any;
    await close();
    const pass = !!card && st.entry === 'picker' && new RegExp(`/scenes/${card}/$`).test(st.url) && st.picture === false;
    out.S2 = { pass, card, panel: st, consoleErrors: errors };
    console.log('S2', pass ? 'PASS' : 'FAIL', JSON.stringify({ card, ...st }));
}

// ------------------------------------------------------------------ S3
if (want('S3')) {
    const { p, errors, close } = await page(browser);
    await p.goto(fly(`scene=${PASTED}&nowarn=1&lat=1&render=off`));
    await waitReady(p, 240000);
    await p.waitForTimeout(1000);
    await p.keyboard.press('F9');
    await p.waitForTimeout(1500);
    const rec = await hook(p, 'return h.rec.state();');
    await p.keyboard.press('F9');
    await until(p, `(() => { const st = window.__gsfpv.rec.state(); return !st.recording && !st.busy && !!st.last; })()`, 10000);
    await p.click('[data-action=rec-share]');
    await until(p, `(() => { const st = window.__gsfpv.share.state(); return !!(st && st.url && st.video !== 'loading'); })()`, 20000);
    const share = await hook(p, 'return { ...h.share.state(), save: !!document.querySelector("[data-action=share-video-save]") };');
    await p.keyboard.press('Escape');
    // "Don't show again", then a reload and another recording: no notice
    await p.keyboard.press('F9');
    await p.waitForTimeout(800);
    const again = await hook(p, 'return h.rec.state();');
    await p.keyboard.press('F9');
    await until(p, `(() => { const st = window.__gsfpv.rec.state(); return !st.recording && !st.busy; })()`, 10000);
    await p.goto(fly(`scene=${PASTED}&nowarn=1&lat=1&render=off&r=2`));
    await waitReady(p, 240000);
    await p.waitForTimeout(800);
    await p.keyboard.press('F9');
    await p.waitForTimeout(1200);
    const firstAfterReload = await hook(p, 'return h.rec.state();');
    if (firstAfterReload.notice) await p.click('[data-action=rec-notice-hide]');
    await p.keyboard.press('F9');
    await until(p, `(() => { const st = window.__gsfpv.rec.state(); return !st.recording && !st.busy; })()`, 10000);
    await p.reload();
    await waitReady(p, 240000);
    await p.waitForTimeout(800);
    await p.keyboard.press('F9');
    await p.waitForTimeout(1200);
    const hidden = await hook(p, 'return h.rec.state();');
    await p.keyboard.press('F9');
    await p.waitForTimeout(1500);
    await close();
    const pass = rec.allowed === true && rec.recording === true && !!rec.notice && rec.showcase === false && String(rec.credit).includes('ShramkoGSFPV')
        && share.entry === 'video' && share.video === 'ready' && share.save === true && again.notice === null && !!firstAfterReload.notice;
    const fired = hidden.recording === true && hidden.notice === null;
    out.S3 = { pass: pass && fired, rec, share, again, firstAfterReload, control: { what: '"Don\'t show again", a reload, a new recording: no notice', fired, state: hidden }, consoleErrors: errors };
    console.log('S3', pass ? 'PASS' : 'FAIL', 'control', fired ? 'FIRED' : 'DID NOT FIRE', JSON.stringify({ notice: rec.notice, credit: rec.credit, share: { entry: share.entry, video: share.video, files: share.canShareFiles }, again: again.notice, reloaded: firstAfterReload.notice, hidden: hidden.notice }));
}

// ------------------------------------------------------------------ S4 and S5
if (want('S4') || want('S5')) {
    const { p, errors, close } = await page(browser);
    await p.goto(fly(`scene=${BOT}&simradio=scenario&tour=1&nowarn=1&render=off`));
    await waitReady(p, 240000);
    await p.waitForTimeout(1500);
    const off = await hook(p, 'return h.crosshair();');
    await hook(p, 'h.prefs.set("crosshair.shape", "cross"); h.prefs.set("crosshair.size", 6); return 0;');
    await p.waitForTimeout(200);
    const cross = await hook(p, 'return h.crosshair();');
    await hook(p, 'h.cinema.toggle(); return 0;');
    await p.waitForTimeout(200);
    const inCinema = await hook(p, 'return h.crosshair();');
    await hook(p, 'h.cinema.toggle(); h.prefs.set("crosshair.shape", "off"); return 0;');
    const crossPass = off.shape === null && cross.shape === 'cross' && cross.shown === true && cross.sizeVmin === 6 && inCinema.shown === false;
    out.S4 = { pass: crossPass, off, cross, inCinema, control: { what: 'shape off: no mark', fired: off.shape === null && off.shown === false }, consoleErrors: errors };
    console.log('S4', crossPass ? 'PASS' : 'FAIL', JSON.stringify({ off, cross, inCinema }));

    // a real click (a user activation) lets the page make sound
    await p.mouse.click(640, 400);
    await until(p, `(() => { const x = window.__gsfpv.sound(); return x.context === 'running' && !!x.mix; })()`, 8000);
    await until(p, `window.__gsfpv.session.sim.armed`, 15000);
    await p.waitForTimeout(600);
    const flying = await hook(p, 'const x = h.sound(); return { context: x.context, master: x.mix && x.mix.master, voices: x.mix && x.mix.voices.map((v) => Math.round(v.freq)), armed: s.sim.armed, crashed: s.sim.crashed };');
    await p.keyboard.press('KeyP');
    await p.waitForTimeout(300);
    const paused = await hook(p, `const x = h.sound(); return { master: x.mix && x.mix.master, menu: !!document.querySelector('.pause-menu'), item: !!document.querySelector('[data-action="pause.sound"]') };`);
    await p.keyboard.press('KeyP');
    await p.waitForTimeout(300);
    await hook(p, 'h.prefs.set("sound.motors", false); return 0;');
    await p.waitForTimeout(500);
    const switchedOff = await hook(p, 'const x = h.sound(); return { context: x.context, master: x.mix && x.mix.master, armed: s.sim.armed };');
    await hook(p, 'h.prefs.reset("sound.motors"); return 0;');
    await close();
    const soundPass = flying.context === 'running' && flying.armed === true && flying.crashed === false && flying.master > 0 && paused.menu && paused.master === 0 && paused.item;
    const fired = switchedOff.armed === true && switchedOff.master === 0;
    out.S5 = { pass: soundPass && fired, flying, paused, control: { what: 'sound.motors off while the bot flies armed: master 0', fired, state: switchedOff }, consoleErrors: errors };
    console.log('S5', soundPass ? 'PASS' : 'FAIL', 'control', fired ? 'FIRED' : 'DID NOT FIRE', JSON.stringify({ flying, paused, switchedOff }));
}

// ------------------------------------------------------------------ S6
if (want('S6')) {
    const { p, errors, close } = await page(browser);
    await p.goto(fly(`scene=${PASTED}&nowarn=1&input=touch&render=off`));
    await waitReady(p, 240000);
    await p.waitForTimeout(1000);
    const idle = `(() => { const st = window.__gsfpv.rec.state(); return !st.recording && !st.busy && !!st.last; })()`;
    // a manual recording first (the bar's REC path, through the hook: this page flies by touch): its
    // note is on the bar when the auto run starts
    await hook(p, 'await h.rec.start(); await new Promise((r) => setTimeout(r, 1200)); await h.rec.stop(); return 0;');
    await until(p, idle, 10000);
    const manual = await hook(p, 'const st = h.rec.state(); return { note: st.note, files: st.last ? st.last.files.map((f) => f.name) : [], share: !!document.querySelector("[data-action=rec-share]") };');
    // Auto on (set through the hook: the bar's button would open the OS folder picker), parts of 1.2 s
    await hook(p, 'h.rec.setAuto(true); h.rec.setSplitMin(0.02); return 0;');
    await p.click('.touch-arm');
    await p.waitForTimeout(1000);
    const armed = await hook(p, 'const st = h.rec.state(); return { armed: s.sim.armed, recording: st.recording, autoRun: st.autoRun, note: st.note, share: !!document.querySelector("[data-action=rec-share]") };');
    await p.waitForTimeout(2800);
    await p.click('.touch-arm');
    // the stop is due 3 s after the disarm, then the parts are closed
    const newFile = `(() => { const st = window.__gsfpv.rec.state(); return !st.recording && !st.busy && !!st.last && !${JSON.stringify(manual.files)}.includes(st.last.files[0].name); })()`;
    const saved = await until(p, newFile, 12000);
    const after = await hook(p, 'const st = h.rec.state(); return { note: st.note, files: st.last ? st.last.files.map((f) => f.name) : [], share: !!document.querySelector("[data-action=rec-share]") };');
    let panel: Any = null;
    if (after.share) {
        await p.click('[data-action=rec-share]');
        await until(p, `(() => { const st = window.__gsfpv.share.state(); return !!(st && st.url && st.video !== 'loading'); })()`, 20000);
        panel = await hook(p, 'return { ...h.share.state(), saves: [...document.querySelectorAll("[data-action=share-video-save]")].map((a) => a.getAttribute("download")) };');
        await p.keyboard.press('Escape');
    }
    await hook(p, 'h.rec.setAuto(false); h.rec.setSplitMin(null); return 0;');
    await close();
    const sameList = (a: string[] | undefined, b: string[]) => !!a && a.length === b.length && a.every((x, i) => x === b[i]);
    const pass = manual.share === true && armed.armed === true && armed.recording === true && armed.autoRun === true && armed.share === false
        && saved && after.share === true && after.files.length >= 2 && after.note !== manual.note
        && !!panel && panel.entry === 'video' && panel.video === 'ready' && sameList(panel.files, after.files) && sameList(panel.saves, after.files);
    out.S6 = { pass, manual, armed, saved, after, panel, consoleErrors: errors };
    console.log('S6', pass ? 'PASS' : 'FAIL', JSON.stringify({ manual, armed, saved, after, panel: panel && { entry: panel.entry, video: panel.video, files: panel.files, saves: panel.saves } }));
}

// ------------------------------------------------------------------ S7
if (want('S7')) {
    const { p, errors, close } = await page(browser, 390, 844);
    await p.goto(fly(`scene=${SHOWCASE}&nowarn=1&input=touch&render=off`));
    await waitReady(p, 240000);
    await p.waitForTimeout(800);
    await hook(p, 'await h.rec.start(); await new Promise((r) => setTimeout(r, 1500)); await h.rec.stop(); return 0;');
    await until(p, `(() => { const st = window.__gsfpv.rec.state(); return !st.recording && !st.busy && !!st.last; })()`, 10000);
    const rec = await hook(p, 'const st = h.rec.state(); const f = await h.rec.readLast(); return { credit: st.credit, width: st.last && st.last.width, height: st.last && st.last.height, b64: f ? f.b64 : null };');
    await close();
    const dir = join(REPO, 'evidence', today(), 'd1-ui');
    mkdirSync(dir, { recursive: true });
    const tag = process.env.EVIDENCE_SUFFIX ?? '';
    const mp4 = join(dir, `credit-portrait${tag}.mp4`); // gitignored
    let shape: Any = { why: 'no file or no ffmpeg' };
    if (rec.b64 && existsSync(FFMPEG)) {
        writeFileSync(mp4, Buffer.from(rec.b64, 'base64'));
        const w = rec.width as number, hgt = rec.height as number;
        // one frame as 8-bit luma; the credit sits in the bottom quarter
        const y = execFileSync(FFMPEG, ['-v', 'error', '-ss', '0.8', '-i', mp4, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 64 << 20 });
        execFileSync(FFMPEG, ['-v', 'error', '-y', '-ss', '0.8', '-i', mp4, '-frames:v', '1', '-vf', `crop=${w}:${Math.round(hgt / 4)}:0:${hgt - Math.round(hgt / 4)}`, join(dir, `credit-portrait${tag}.png`)]);
        let maxX = -1;
        const rows: number[] = [];
        for (let r = Math.round(hgt * 0.75); r < hgt; r++) {
            let lit = false;
            for (let x = 0; x < w; x++) if (y[r * w + x] > 128) { lit = true; if (x > maxX) maxX = x; }
            if (lit) rows.push(r);
        }
        // the text's lines: runs of lit rows more than 3 rows apart
        let lines = 0;
        rows.forEach((r, i) => { if (i === 0 || r - rows[i - 1] > 3) lines++; });
        shape = { width: w, height: hgt, maxLitX: maxX, litRows: rows.length, lines };
    }
    const pass = rec.height === 1080 && rec.width <= 540 && shape.lines >= 2 && shape.maxLitX > 0 && shape.maxLitX < rec.width - 8 && String(rec.credit).includes('ShramkoGSFPV');
    out.S7 = { pass, credit: rec.credit, frame: shape, picture: `evidence/${today()}/d1-ui/credit-portrait${tag}.png`, consoleErrors: errors };
    console.log('S7', pass ? 'PASS' : 'FAIL', JSON.stringify({ credit: rec.credit, shape }));
}

await browser.close();
const ran = PARTS.filter((k) => k in out);
const all = ran.length > 0 && ran.every((k) => out[k]?.pass);
const file = writeEvidence(only.length ? `v07-d1-${only.join('-')}` : 'v07-d1', { pass: all, parts: ran, ...out });
console.log('v07-d1', all ? 'PASS' : 'FAIL', file);
process.exit(all ? 0 : 1);
