// v0.3 recording acceptance (docs/architecture-v03.md F.5; items 19 and 14; D34), in the real page
// with the scan drawn. Fresh browser contexts only, never a pilot's profile.
//   R1  a 10 s recording at a 60 Hz render: ffprobe says r_frame_rate 60/1, 0 duplicate pts,
//       600 +- 2 frames, every frame decodes. Control C1: v0.2's path (every rendered frame into a
//       30 fps track) on the same page gives about 29 duplicate pts a second.
//   R3  the display's own rate (this PC: 30 Hz over HDMI): still 60/1 and 0 duplicate pts, the
//       repeated frames counted and shown on the bar after stop.
//   R4  the settings that ship with it: recording.fps 30, recording.resolution 2160p, a file split.
//   R2  auto-record into "the folder" (an OPFS folder handed over the way the picker hands one;
//       Playwright cannot drive the OS picker): Auto clicked, ARM, a throttle blip, DISARM; the file
//       appears 3 s after the disarm, not before; Auto and the folder survive a reload. Control C2:
//       on a scene outside the showcase nothing is written and the Auto toggle says why.
// A display slower than 60 Hz cannot render the 60 Hz case: R1 then drives the page's frame loop
// from a 60 Hz timer (an init script replaces requestAnimationFrame; the scan is still drawn every
// frame, only the screen shows fewer of them). The evidence says which it was.
//   LOCAL_FLY=1 SITE=http://127.0.0.1:5335 npx tsx src/accept-v03-rec.ts   (GPU lock: tools/bench/README.md)
// Evidence: evidence/<date>/v03-rec.json; the videos stay local in evidence/<date>/rec/ (gitignored, sha256 in the JSON).
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Browser, BrowserContext, Page } from 'playwright';
import { launchChrome, waitReady } from './browser';
import { REPO, today, writeEvidence } from './evidence';

const SITE = (process.env.SITE ?? 'http://127.0.0.1:5335').replace(/\/$/, '');
const fly = (qs: string) => (process.env.LOCAL_FLY ? `${SITE}/fly/?${qs}` : `${SITE}/en/fly/?${qs}`);
const SHOWCASE = '39e63ce9';
const PASTED = '723068d7'; // not in apps/fly/public/showcase.json
const FFPROBE = process.env.FFPROBE ?? 'C:/Program Files/Shutter Encoder/Library/ffprobe.exe';
const OUT = join(REPO, 'evidence', today(), 'rec');
mkdirSync(OUT, { recursive: true });
const RUN = Date.now().toString(36);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const hook = <T = Any>(p: Page, body: string): Promise<T> => p.evaluate(`(async () => { const h = window.__gsfpv; const s = h.session; ${body} })()`) as Promise<T>;

/** The page's frame loop from a 60 Hz timer instead of the display (a 30 Hz screen cannot show 60). */
const FORCE_60 = `(() => {
    const P = 1000 / 60, t0 = performance.now();
    let n = 0, next = 1, queue = new Map();
    window.__raf60 = { ticks: 0 };
    const loop = () => {
        const now = performance.now();
        n = Math.max(n + 1, Math.ceil((now - t0) / P));
        setTimeout(() => {
            const cbs = queue; queue = new Map();
            window.__raf60.ticks++;
            const ts = performance.now();
            for (const cb of cbs.values()) { try { cb(ts); } catch (e) { console.error(e); } }
            loop();
        }, Math.max(0, t0 + n * P - now));
    };
    loop();
    window.requestAnimationFrame = (cb) => { const id = next++; queue.set(id, cb); return id; };
    window.cancelAnimationFrame = (id) => { queue.delete(id); };
})();`;

/** Engine frames a second over `ms`, and the frame times (the session's own counters). */
async function frameRate(p: Page, ms = 2000): Promise<{ engineFps: number; frameMs: unknown }> {
    const a = await hook(p, 'return { f: s.frames, t: performance.now() };');
    await p.waitForTimeout(ms);
    const b = await hook(p, 'return { f: s.frames, t: performance.now(), st: s.frameStats() };');
    return { engineFps: Math.round(((b.f - a.f) / (b.t - a.t)) * 1000 * 10) / 10, frameMs: b.st };
}

/** The display's own rAF rate in a blank page of this browser. */
async function displayRate(browser: Browser): Promise<number> {
    const c = await browser.newContext({ viewport: { width: 640, height: 400 } });
    const p = await c.newPage();
    await p.goto('about:blank');
    const hz = await p.evaluate('new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else res(n / ((performance.now() - t0) / 1000)); }; requestAnimationFrame(f); })') as number;
    await c.close();
    return Math.round(hz * 10) / 10;
}

interface Probe { r_frame_rate: string; avg_frame_rate: string; time_base: string; codec: string; width: number; height: number; packets: number; decoded: number; dupPts: number; dupPerS: number; steps: Record<string, number>; durationS: number }

/** ffprobe: the stream's rates, every packet's pts (duplicates, steps), and a full decode count. */
function probe(file: string): Probe {
    const j = JSON.parse(execFileSync(FFPROBE, ['-v', 'error', '-select_streams', 'v:0', '-count_frames', '-show_entries', 'stream=codec_name,width,height,r_frame_rate,avg_frame_rate,time_base,nb_read_frames,duration', '-show_entries', 'packet=pts', '-of', 'json', file], { maxBuffer: 64 << 20 }).toString());
    const st = j.streams[0];
    const pts: number[] = j.packets.map((x: Any) => Number(x.pts)).sort((a: number, b: number) => a - b);
    const [num, den] = String(st.time_base).split('/').map(Number);
    const seen = new Set<number>();
    let dup = 0;
    const steps: Record<string, number> = {};
    pts.forEach((v, i) => {
        if (seen.has(v)) dup++;
        seen.add(v);
        if (i > 0) {
            const ms = (Math.round(((v - pts[i - 1]) * num * 1000 * 10) / den) / 10).toFixed(1);
            steps[ms] = (steps[ms] ?? 0) + 1;
        }
    });
    const durationS = Number(st.duration);
    return { r_frame_rate: st.r_frame_rate, avg_frame_rate: st.avg_frame_rate, time_base: st.time_base, codec: st.codec_name, width: st.width, height: st.height, packets: pts.length, decoded: Number(st.nb_read_frames), dupPts: dup, dupPerS: Math.round((dup / Math.max(0.001, durationS)) * 10) / 10, steps, durationS };
}

/** The newest recording of the page, saved under evidence/<date>/rec/ (gitignored). */
async function saveLast(p: Page, tag: string): Promise<{ file: string; name: string; where: string; bytes: number; sha256: string } | null> {
    const last = await hook<{ name: string; where: string; b64: string } | null>(p, 'return await h.rec.readLast();');
    if (!last) return null;
    const buf = Buffer.from(last.b64, 'base64');
    const file = join(OUT, `${tag}-${last.name}`);
    writeFileSync(file, buf);
    return { file, name: last.name, where: last.where, bytes: buf.length, sha256: createHash('sha256').update(buf).digest('hex') };
}

/** An OPFS folder handed to the page as "the folder" (the picker's result goes the same way). */
const useOpfsFolder = (name: string) => `const root = await navigator.storage.getDirectory(); const d = await root.getDirectoryHandle('${name}', { create: true }); await h.rec.useFolder(d); return d.name;`;
const listFolder = (name: string) => `const root = await navigator.storage.getDirectory(); const d = await root.getDirectoryHandle('${name}', { create: true }); const out = []; for await (const [n, f] of d.entries()) if (f.kind === 'file' && n.endsWith('.mp4')) out.push({ name: n, bytes: (await f.getFile()).size }); return out;`;

async function newContext(browser: Browser, force60: boolean): Promise<{ ctx: BrowserContext; page: Page; console: string[] }> {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    if (force60) await ctx.addInitScript(FORCE_60);
    const page = await ctx.newPage();
    const lines: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('Failed to load resource')) lines.push(m.text().slice(0, 300)); });
    page.on('pageerror', (e) => lines.push(`pageerror: ${e.message}`.slice(0, 300)));
    return { ctx, page, console: lines };
}

if (!existsSync(FFPROBE)) throw new Error(`ffprobe not found: ${FFPROBE}`);
const { browser, which } = await launchChrome({ headless: false, args: ['--window-position=40,40', '--window-size=1296,920'] });
const out: Record<string, unknown> = { site: SITE, browser: which, ffprobe: FFPROBE };
const display = await displayRate(browser);
const force60 = process.env.FORCE60 === '1' || (process.env.FORCE60 !== '0' && display < 55);
out.display = { rafHz: display, force60, why: force60 ? 'the display runs below 60 Hz (the owner\'s 4K monitor: 30 Hz over HDMI): the 60 Hz render comes from a 60 Hz timer driving the page\'s frame loop, the scan drawn every frame' : 'the display itself runs at 60 Hz or more' };
console.log('display', JSON.stringify(out.display));

// ------------------------------------------------------------------ R1 + C1: 60 Hz render, 10 s
{
    const { ctx, page, console: errors } = await newContext(browser, force60);
    await page.goto(fly(`scene=${SHOWCASE}&simradio=scenario&tour=1&nowarn=1`));
    const ready = await waitReady(page, 240000);
    await page.waitForTimeout(5000); // the scan streams its detail; the bot is up and flying its tour
    const rate = await frameRate(page);
    const folder = await hook<string>(page, useOpfsFolder(`gsfpv-r1-${RUN}`));
    const run = async (control: boolean) => hook(page, `
        const codec = await h.rec.start(${control ? "{ control: 'v02' }" : ''});
        const t0 = performance.now(), f0 = s.frames;
        await new Promise((r) => setTimeout(r, 10000));
        const f1 = s.frames, t1 = performance.now();
        const info = await h.rec.stop();
        return { codec, wallS: (t1 - t0) / 1000, engineFpsWhileRecording: Math.round(((f1 - f0) / (t1 - t0)) * 10000) / 10, info, strip: h.cinema.creditStripStd(), note: document.querySelector('[data-testid=cinema-note]').textContent };`);
    const r1 = await run(false);
    const r1File = await saveLast(page, 'r1-60hz');
    const r1Probe = r1File ? probe(r1File.file) : null;
    await page.waitForTimeout(1000);
    const c1 = await run(true);
    const c1File = await saveLast(page, 'c1-v02');
    const c1Probe = c1File ? probe(c1File.file) : null;
    await ctx.close();
    const p = r1Probe;
    const pass = !!p && p.r_frame_rate === '60/1' && p.dupPts === 0 && Math.abs(p.packets - 600) <= 2 && p.decoded === p.packets
        && r1.info.files.length === 1 && r1.info.where === 'folder' && r1.info.fps === 60 && r1.strip > 0.1 && (rate.engineFps as number) >= 55;
    // control: the same file checks fail on v0.2's path: duplicate pts (research-b 3.1 measured 29 a
    // second with every frame reaching the encoder; v0.2 also skips a frame while 8 wait in the encoder)
    const fired = !!c1Probe && c1Probe.dupPts > 0 && c1Probe.r_frame_rate !== '60/1';
    out.R1 = { pass: pass && fired, what: 'a 10 s recording at a 60 Hz render: r_frame_rate 60/1, 0 duplicate pts, 600 +- 2 frames, all decoded; into the folder; the credit burned in (strip luminance spread > 0.1)', scene: SHOWCASE, renderer: (ready.info as Any)?.currentRenderer, frameRateBefore: rate, engineFpsWhileRecording: r1.engineFpsWhileRecording, folder, recorder: r1.info, wallS: r1.wallS, codec: r1.codec, creditStripStd: r1.strip, file: r1File && { ...r1File, file: undefined }, ffprobe: r1Probe, note: r1.note,
        control: { what: 'C1: v0.2 path (every rendered frame, 30 fps track, a frame skipped while 8 wait in the encoder) on the same page and render', fired, engineFpsWhileRecording: c1.engineFpsWhileRecording, framesSkippedByEncoderBound: c1.info.dropped, recorder: c1.info, file: c1File && { ...c1File, file: undefined }, ffprobe: c1Probe }, consoleErrors: errors };
    console.log('R1', pass ? 'PASS' : 'FAIL', 'C1', fired ? 'FIRED' : 'DID NOT FIRE', JSON.stringify({ rate, r1Probe, c1Probe: c1Probe && { dupPts: c1Probe.dupPts, dupPerS: c1Probe.dupPerS, r: c1Probe.r_frame_rate } }));
}

// ------------------------------------------------------------------ R3: the display's own rate
{
    const { ctx, page, console: errors } = await newContext(browser, false);
    await page.goto(fly(`scene=${SHOWCASE}&simradio=scenario&tour=1&nowarn=1`));
    await waitReady(page, 240000);
    await page.waitForTimeout(4000);
    const rate = await frameRate(page);
    await hook(page, useOpfsFolder(`gsfpv-r3-${RUN}`));
    const r = await hook(page, `
        await h.rec.start();
        await new Promise((r) => setTimeout(r, 5000));
        const info = await h.rec.stop();
        return { info, note: document.querySelector('[data-testid=cinema-note]').textContent };`);
    const f = await saveLast(page, 'r3-display');
    const pr = f ? probe(f.file) : null;
    await page.screenshot({ path: join(OUT, 'r3-bar-after-stop.jpg'), quality: 70 });
    await ctx.close();
    const expectRepeats = Math.max(0, 300 - (rate.engineFps as number) * 5);
    const pass = !!pr && pr.r_frame_rate === '60/1' && pr.dupPts === 0 && Math.abs(pr.packets - 300) <= 2 && pr.decoded === pr.packets
        && r.note.includes(`: ${r.info.duplicated}`) && r.info.duplicated > 0 === expectRepeats > 10;
    out.R3 = { pass, what: 'at the display\'s own rate: still 60/1 with 0 duplicate pts and 300 +- 2 frames in 5 s; the repeated frames counted and shown on the bar after stop', frameRateDuring: rate, recorder: r.info, note: r.note, file: f && { ...f, file: undefined }, ffprobe: pr, consoleErrors: errors };
    console.log('R3', pass ? 'PASS' : 'FAIL', JSON.stringify({ rate, dup: r.info.duplicated, note: r.note, pr }));
}

// ------------------------------------------------------------------ R2 + C2: auto-record into the folder
{
    const { ctx, page, console: errors } = await newContext(browser, false);
    await page.goto(fly(`scene=${SHOWCASE}&nowarn=1&input=touch`));
    await waitReady(page, 240000);
    await page.waitForTimeout(3000);
    const dir = `gsfpv-auto-${RUN}`;
    await hook(page, useOpfsFolder(dir));
    const before = await hook<Any[]>(page, listFolder(dir));
    await page.click('[data-action=rec-auto]');
    await page.waitForTimeout(300);
    const afterAuto = await hook(page, 'return h.rec.state();');
    const tArm = Date.now();
    await page.click('.touch-arm');
    await page.waitForTimeout(1200);
    const armed = await hook(page, 'return { armed: s.sim.armed, ...h.rec.state() };');
    // a throttle blip: press the left pad a little below its middle (throttle about 0.3), then back down
    const pad = await page.locator('.touch-pad.left').boundingBox();
    if (pad) {
        const cx = pad.x + pad.width / 2, cy = pad.y + pad.height / 2, r = pad.width / 2 - 24;
        await page.mouse.move(cx, cy + 0.4 * r);
        await page.mouse.down();
        await page.waitForTimeout(600);
        await page.mouse.move(cx, cy + r, { steps: 4 });
        await page.mouse.up();
    }
    await page.waitForTimeout(1500);
    const flew = await hook(page, 'return { armed: s.sim.armed, crashed: s.sim.crashed, y: s.sim.s[1] };');
    await page.click('.touch-arm');
    const tDisarm = Date.now();
    await page.waitForTimeout(1500);
    const mid = await hook(page, 'return { armed: s.sim.armed, ...h.rec.state() };');
    const midFiles = await hook<Any[]>(page, listFolder(dir));
    // the stop is due 3 s after the disarm; then the file is closed (written out of the swap file)
    const tReady = await hook<number | null>(page, `const t0 = performance.now(); while (performance.now() - t0 < 12000) { if (h.rec.state().last) return performance.now(); await new Promise((r) => setTimeout(r, 100)); } return null;`);
    const savedS = tReady === null ? null : (Date.now() - tDisarm) / 1000;
    const after = await hook(page, 'return h.rec.state();');
    const files = await hook<Any[]>(page, listFolder(dir));
    const f = await saveLast(page, 'r2-auto');
    const pr = f ? probe(f.file) : null;
    await page.screenshot({ path: join(OUT, 'r2-bar-after-auto.jpg'), quality: 70 });
    // a reload keeps Auto and the folder (the pilot's choice is never lost)
    await page.reload();
    await waitReady(page, 240000);
    await page.waitForTimeout(1500);
    const reloaded = await hook(page, 'return h.rec.state();');
    const name = `gsfpv-${SHOWCASE}-`;
    const pass = before.length === 0 && afterAuto.auto === true && afterAuto.autoPressed === 'true' && armed.armed && armed.recording && armed.autoRun
        && mid.recording === true && mid.pendingStopAt !== null && midFiles.every((x) => x.bytes === 0)
        && savedS !== null && savedS >= 3 && savedS <= 10 && after.recording === false && files.length === 1 && String(files[0].name).startsWith(name) && /^gsfpv-[0-9a-f]{8}-\d{8}-\d{6}\.mp4$/.test(files[0].name) && files[0].bytes > 0
        && !!pr && pr.r_frame_rate === '60/1' && pr.dupPts === 0 && pr.decoded === pr.packets && (after.last?.where === 'folder')
        && reloaded.auto === true && reloaded.folder === dir && reloaded.autoPressed === 'true';

    // control C2: a scene outside the showcase, the same browser (Auto on, the folder set): nothing is written, Auto says why
    await page.goto(fly(`scene=${PASTED}&nowarn=1&input=touch&render=off`));
    await waitReady(page, 240000);
    await page.waitForTimeout(1500);
    const c2State = await hook(page, 'return h.rec.state();');
    await page.click('.touch-arm');
    await page.waitForTimeout(1200);
    const c2Armed = await hook(page, 'return { armed: s.sim.armed, ...h.rec.state() };');
    await page.click('.touch-arm');
    await page.waitForTimeout(3600);
    const c2After = await hook(page, 'return h.rec.state();');
    const c2Files = await hook<Any[]>(page, listFolder(dir));
    const autoTitle = await page.locator('[data-action=rec-auto]').getAttribute('title');
    const autoDisabled = await page.locator('[data-action=rec-auto]').isDisabled();
    await page.screenshot({ path: join(OUT, 'c2-not-showcase.jpg'), quality: 70 });
    await ctx.close();
    const fired = c2State.allowed === false && c2State.auto === true && c2State.barShown === true && autoDisabled && !!autoTitle && autoTitle === c2State.autoTitle && /showcase/i.test(autoTitle)
        && c2Armed.armed === true && c2Armed.recording === false && c2After.recording === false && c2Files.length === files.length && c2State.recHidden === true;
    out.R2 = { pass: pass && fired, what: 'auto-record into the chosen folder (an OPFS folder handed over like the picker\'s): Auto clicked, ARM starts it, a throttle blip, DISARM; still recording 1.5 s later (the file still empty: writes land on close), the file saved 3-10 s after the disarm; Auto and the folder survive a reload', scene: SHOWCASE, folder: dir, before, afterAuto, armed, flew, mid, midFiles, savedAfterDisarmS: savedS, after, files, armToDisarmS: (tDisarm - tArm) / 1000, file: f && { ...f, file: undefined }, ffprobe: pr, reloaded,
        control: { what: `C2: scene ${PASTED} (not in the showcase), Auto still on and the folder set: ARM and DISARM write nothing, Auto is disabled and says why (logic-only page, the gate does not depend on drawing)`, fired, state: c2State, armed: c2Armed, after: c2After, files: c2Files, autoTitle, autoDisabled }, consoleErrors: errors };
    console.log('R2', pass ? 'PASS' : 'FAIL', 'C2', fired ? 'FIRED' : 'DID NOT FIRE', JSON.stringify({ armed: { a: armed.armed, r: armed.recording }, mid: { r: mid.recording, files: midFiles.length }, after: { r: after.recording, files }, reloaded: { auto: reloaded.auto, folder: reloaded.folder }, c2: { allowed: c2State.allowed, autoDisabled, autoTitle, rec: c2Armed.recording, files: c2Files.length } }));
}

// ------------------------------------------------------------------ R4: the settings that ship with it
// recording.fps 30, recording.resolution 2160p, a split (recording.splitMin, shortened through the
// hook to 3 s). Their controls are R1's file on the same page code without them: 60/1, 1080 high, one file.
{
    const { ctx, page, console: errors } = await newContext(browser, false);
    await page.goto(fly(`scene=${SHOWCASE}&simradio=scenario&tour=1&nowarn=1`));
    await waitReady(page, 240000);
    await page.waitForTimeout(4000);
    await hook(page, useOpfsFolder(`gsfpv-r4-${RUN}`));
    const rec = (ms: number) => `await h.rec.start(); await new Promise((r) => setTimeout(r, ${ms})); return await h.rec.stop();`;
    await hook(page, "h.prefs.set('recording.fps', '30'); return 0;");
    const i30 = await hook(page, rec(4000));
    const f30 = await saveLast(page, 'r4-30fps');
    const p30 = f30 ? probe(f30.file) : null;
    await hook(page, "h.prefs.reset('recording.fps'); h.prefs.set('recording.resolution', '2160p'); return 0;");
    const i4k = await hook(page, rec(3000));
    const f4k = await saveLast(page, 'r4-2160p');
    const p4k = f4k ? probe(f4k.file) : null;
    await hook(page, "h.prefs.reset('recording.resolution'); h.rec.setSplitMin(0.05); return 0;");
    const iSplit = await hook(page, rec(7000));
    const splitProbes: Probe[] = [];
    for (const f of iSplit.files as Any[]) {
        const b64 = await hook<string>(page, `const d = h.rec.rec.folder; const file = await (await d.getFileHandle('${f.name}')).getFile(); const b = new Uint8Array(await file.arrayBuffer()); let s2 = ''; for (let i = 0; i < b.length; i += 0x8000) s2 += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s2);`);
        const file = join(OUT, `r4-split-${f.name}`);
        writeFileSync(file, Buffer.from(b64, 'base64'));
        splitProbes.push(probe(file));
    }
    await hook(page, 'h.rec.setSplitMin(null); return 0;');
    await ctx.close();
    const fps30 = !!p30 && p30.r_frame_rate === '30/1' && p30.dupPts === 0 && Math.abs(p30.packets - 120) <= 2 && p30.decoded === p30.packets;
    const size4k = !!p4k && p4k.height === 2160 && p4k.r_frame_rate === '60/1' && p4k.dupPts === 0 && Math.abs(p4k.packets - 180) <= 2 && p4k.decoded === p4k.packets;
    const split = splitProbes.length === 3 && splitProbes.every((x) => x.r_frame_rate === '60/1' && x.dupPts === 0 && x.decoded === x.packets) && splitProbes[0].packets === 180 && splitProbes[1].packets === 180
        && Math.abs(splitProbes.reduce((n, x) => n + x.packets, 0) - 420) <= 2 && new Set((iSplit.files as Any[]).map((f) => f.name)).size === 3;
    const r1 = out.R1 as Any;
    const controls = { r1File: r1?.ffprobe ? { r_frame_rate: r1.ffprobe.r_frame_rate, height: r1.ffprobe.height } : null, r1Files: r1?.recorder?.files?.length ?? null,
        fired: !!r1?.ffprobe && r1.ffprobe.r_frame_rate === '60/1' && r1.ffprobe.height === 1080 && r1.recorder.files.length === 1 };
    out.R4 = { pass: fps30 && size4k && split && controls.fired, what: 'recording.fps 30 gives a 30/1 file of 120 +- 2 frames in 4 s; recording.resolution 2160p a 2160-high 60/1 file; a split every 3 s gives 3 files of 180, 180 and the rest, each 60/1 with 0 duplicate pts', fps30: { pass: fps30, recorder: i30, ffprobe: p30 }, size2160: { pass: size4k, recorder: i4k, ffprobe: p4k }, split: { pass: split, recorder: iSplit, ffprobe: splitProbes }, control: { what: 'R1 on the same page code without these settings: 60/1, 1080 high, one file', ...controls }, consoleErrors: errors };
    console.log('R4', (out.R4 as Any).pass ? 'PASS' : 'FAIL', JSON.stringify({ fps30, p30: p30 && { r: p30.r_frame_rate, n: p30.packets, d: p30.dupPts }, size4k, p4k: p4k && { w: p4k.width, h: p4k.height, r: p4k.r_frame_rate, n: p4k.packets, d: p4k.dupPts, held: i4k.heldForEncoder, drop: i4k.dropped }, split, parts: splitProbes.map((x) => x.packets) }));
}

await browser.close();
out.pass = (out.R1 as Any).pass && (out.R2 as Any).pass && (out.R3 as Any).pass && (out.R4 as Any).pass;
console.log('evidence', writeEvidence('v03-rec', out));
