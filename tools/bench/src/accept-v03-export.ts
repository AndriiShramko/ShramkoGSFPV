// v0.3 export from the flight log (docs/architecture-v03.md F.3, F.5; item 19; D34), in the real page
// with the scan drawn. Fresh browser contexts only, never a pilot's profile.
//   E1  a 5 s stretch of the life the bot is flying, saved as video at 1080p: ffprobe says
//       r_frame_rate 60/1, 300 frames, all decoded, 0 duplicate pts; no frame was encoded with the
//       scan incomplete; the first and last frames show the poses a fresh replay of the log gives at
//       0 and 299/60 s (and the camera was there); the flight held the pause reason 'export' with the
//       bar up meanwhile; the credit is burned in. Control C1: the same stretch with a deliberately
//       wrong frame step (1/30 s) gives 150 frames and a last pose that is not the replay's at 299/60 s.
//   E2  4K: 1 s gives 3840 x 2160, 60 frames, 60/1.
//   E3  Cancel: the export stops, no file is left in the folder, the flight is still paused under
//       the bar until Close, and Close goes back to the summary panel.
//   E4  the pilot's way: the summary panel's row (P), 1440p chosen, "Save video" clicked: the whole
//       current life is saved at 2560 x 1440, 60/1, and the bar says so; Esc closes it.
//   LOCAL_FLY=1 SITE=http://127.0.0.1:5341 npx tsx src/accept-v03-export.ts   (GPU lock: tools/bench/README.md)
// Evidence: evidence/<date>/v03-export.json; the videos stay local in evidence/<date>/export/ (gitignored, sha256 in the JSON).
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { launchChrome, waitReady } from './browser';
import { REPO, today, writeEvidence } from './evidence';

const SITE = (process.env.SITE ?? 'http://127.0.0.1:5341').replace(/\/$/, '');
const fly = (qs: string) => (process.env.LOCAL_FLY ? `${SITE}/fly/?${qs}` : `${SITE}/en/fly/?${qs}`);
const SHOWCASE = '39e63ce9';
const FFPROBE = process.env.FFPROBE ?? 'C:/Program Files/Shutter Encoder/Library/ffprobe.exe';
const FFMPEG = FFPROBE.replace(/ffprobe(\.exe)?$/i, 'ffmpeg$1');
const OUT = join(REPO, 'evidence', today(), 'export');
mkdirSync(OUT, { recursive: true });
const RUN = Date.now().toString(36);
const ONLY = process.argv.slice(2);
const want = (k: string) => ONLY.length === 0 || ONLY.includes(k);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const hook = <T = Any>(p: Page, body: string): Promise<T> => p.evaluate(`(async () => { const h = window.__gsfpv; const s = h.session; ${body} })()`) as Promise<T>;

interface Probe { r_frame_rate: string; codec: string; width: number; height: number; packets: number; decoded: number; dupPts: number; durationS: number }

function probe(file: string): Probe {
    const j = JSON.parse(execFileSync(FFPROBE, ['-v', 'error', '-select_streams', 'v:0', '-count_frames', '-show_entries', 'stream=codec_name,width,height,r_frame_rate,nb_read_frames,duration', '-show_entries', 'packet=pts', '-of', 'json', file], { maxBuffer: 64 << 20 }).toString());
    const st = j.streams[0];
    const pts: number[] = j.packets.map((x: Any) => Number(x.pts));
    const dupPts = pts.length - new Set(pts).size;
    return { r_frame_rate: st.r_frame_rate, codec: st.codec_name, width: st.width, height: st.height, packets: pts.length, decoded: Number(st.nb_read_frames), dupPts, durationS: Number(st.duration) };
}

/** The first and last frame as pictures beside the video (looked at by eye: the scan, the credit). */
function stills(file: string, tag: string, frames: number): string[] {
    const out: string[] = [];
    if (!existsSync(FFMPEG)) return out;
    for (const [name, n] of [['first', 0], ['last', frames - 1]] as const) {
        const jpg = join(OUT, `${tag}-${name}.jpg`);
        try {
            execFileSync(FFMPEG, ['-v', 'error', '-y', '-i', file, '-vf', `select=eq(n\\,${n}),scale=960:-2`, '-frames:v', '1', jpg]);
            out.push(jpg.slice(REPO.length + 1).replace(/\\/g, '/'));
        } catch { /* no still */ }
    }
    return out;
}

async function saveLast(p: Page, tag: string): Promise<{ file: string; name: string; where: string; bytes: number; sha256: string } | null> {
    const last = await hook<{ name: string; where: string; b64: string } | null>(p, 'return await h.rec.readLast();');
    if (!last) return null;
    const buf = Buffer.from(last.b64, 'base64');
    const file = join(OUT, `${tag}-${last.name}`);
    writeFileSync(file, buf);
    return { file, name: last.name, where: last.where, bytes: buf.length, sha256: createHash('sha256').update(buf).digest('hex') };
}

const useOpfsFolder = (name: string) => `const root = await navigator.storage.getDirectory(); const d = await root.getDirectoryHandle('${name}', { create: true }); await h.rec.useFolder(d); return d.name;`;
const listFolder = (name: string) => `const root = await navigator.storage.getDirectory(); const d = await root.getDirectoryHandle('${name}', { create: true }); const out = []; for await (const [n, f] of d.entries()) if (f.kind === 'file') out.push({ name: n, bytes: (await f.getFile()).size }); return out;`;

/** Runs an export without waiting, then samples the page while it runs (the pause, the bar), then waits for it. */
async function exportWatched(p: Page, opts: string, sampleAfterMs = 600): Promise<{ result: Any; during: Any }> {
    await hook(p, `window.__vx = h.videoExport.run(${opts}); return true;`);
    await p.waitForTimeout(sampleAfterMs);
    const during = await hook(p, 'return { ...h.videoExport.state(), paused: s.paused, menuOpen: !!document.querySelector(".pause-menu"), barText: document.querySelector("[data-testid=video-export-bar]")?.textContent ?? null };');
    const result = await hook(p, 'return await window.__vx;');
    return { result, during };
}

const dist = (a: number[], b: number[]) => Math.hypot(...a.map((v, i) => v - b[i]));

if (!existsSync(FFPROBE)) throw new Error(`ffprobe not found: ${FFPROBE}`);
const { browser, which } = await launchChrome({ headless: false, args: ['--window-position=40,40', '--window-size=1296,920'] });
const out: Record<string, unknown> = { site: SITE, browser: which, ffprobe: FFPROBE };
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors: string[] = [];
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('Failed to load resource')) errors.push(m.text().slice(0, 300)); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`.slice(0, 300)));
await page.goto(fly(`scene=${SHOWCASE}&simradio=scenario&tour=1&nowarn=1`));
const ready = await waitReady(page, 240000);
const folder = await hook<string>(page, useOpfsFolder(`gsfpv-export-${RUN}`));
// the bot flies its tour: wait until the life has 6.5 s in it, the scan streamed meanwhile
const t0 = Date.now();
let lifeMs = 0;
while (Date.now() - t0 < 60000) {
    lifeMs = await hook<number>(page, 'return s.log.endTick - s.log.header.life.startTick;');
    if (lifeMs >= 6500) break;
    await page.waitForTimeout(500);
}
const range = await hook<{ from: number; to: number; start: number; end: number }>(page, 'const l = s.log; const end = l.endTick; const from = end - 6000; return { from, to: from + 5000, start: l.header.life.startTick, end };');
out.flight = { lifeMs, range, renderer: (ready.info as Any)?.currentRenderer };
console.log('flight', JSON.stringify(out.flight));

// ------------------------------------------------------------------ E1 + C1: 5 s at 1080p
if (want('E1')) {
    const { result: r, during } = await exportWatched(page, `{ size: '1080p', fromTick: ${range.from}, toTick: ${range.to} }`);
    const file = await saveLast(page, 'e1-1080p');
    const pr = file ? probe(file.file) : null;
    const pics = file && pr ? stills(file.file, 'e1', pr.packets) : [];
    const afterRun = await hook(page, 'return { paused: s.paused, bar: h.videoExport.state().bar };');
    await hook(page, 'h.videoExport.close(); return true;');
    await page.waitForTimeout(300);
    const afterClose = await hook(page, 'return { paused: s.paused, bar: h.videoExport.state().bar, menuOpen: !!document.querySelector(".pause-menu"), row: !!document.querySelector("[data-testid=video-export]") };');
    const expectTicks = [range.from, range.from + Math.round((299 * 1000) / 60)];
    const replay = await hook<Any[]>(page, `return h.videoExport.replayPoses(${JSON.stringify(expectTicks)});`);
    const poseOk = (got: Any, ref: Any) => !!got && got.tick === ref.tick && dist(got.p, ref.p) < 1e-9 && dist(got.q, ref.q) < 1e-9;
    const camOk = (got: Any) => !!got && (got.crash || dist(got.cam, got.p) < 1e-3);
    const pass = !!pr && pr.r_frame_rate === '60/1' && pr.packets === 300 && pr.decoded === 300 && pr.dupPts === 0 && pr.width === 1920 && pr.height === 1080
        && r.ended === 'done' && r.encoded === 300 && r.encodedIncomplete === 0 && poseOk(r.first, replay[0]) && poseOk(r.last, replay[1]) && camOk(r.first) && camOk(r.last)
        && during.running === true && during.bar === true && during.paused === true && during.menuOpen === false && afterRun.paused === true
        && afterClose.bar === false && afterClose.menuOpen === true && afterClose.row === true && r.creditStripStd > 0.1 && r.info?.where === 'folder';
    // control: the same stretch with a 1/30 s frame step
    await hook(page, 'h.menu?.close?.(); return true;');
    const c1 = await hook(page, `return await h.videoExport.run({ size: '1080p', fromTick: ${range.from}, toTick: ${range.to}, stepFps: 30 });`);
    const c1File = await saveLast(page, 'c1-step30');
    const c1Probe = c1File ? probe(c1File.file) : null;
    await hook(page, 'h.videoExport.close(); return true;');
    const fired = !!c1Probe && c1Probe.packets === 150 && c1.encoded === 150 && !poseOk(c1.last, replay[1]) && dist(c1.last.p, replay[1].p) > 1e-6;
    out.E1 = {
        pass: pass && fired, what: 'a 5 s stretch of the life saved as video at 1080p: 60/1, 300 frames, all decoded, 0 duplicate pts; no frame encoded with the scan incomplete; first and last frame poses = a fresh replay at 0 and 299/60 s; paused (reason export) with the bar up meanwhile; Close goes back to the summary panel; the credit burned in; into the folder',
        result: r, during, afterRun, afterClose, replay, file: file && { ...file, file: undefined }, ffprobe: pr, stills: pics, folder,
        control: { what: 'C1: the same stretch with a deliberately wrong frame step (1/30 s): 150 frames, the last pose not the replay\'s at 299/60 s', fired, result: { encoded: c1.encoded, frames: c1.frames, first: c1.first, last: c1.last }, ffprobe: c1Probe, lastPoseOffM: c1.last ? dist(c1.last.p, replay[1].p) : null }
    };
    console.log('E1', pass ? 'PASS' : 'FAIL', 'C1', fired ? 'FIRED' : 'DID NOT FIRE', JSON.stringify({ pr, encoded: r.encoded, incomplete: r.incomplete, waited: r.waited, encodedIncomplete: r.encodedIncomplete, first: r.first, last: r.last, replay, during, afterClose, strip: r.creditStripStd, c1Probe: c1Probe && { packets: c1Probe.packets }, c1Last: c1.last }));
}

// ------------------------------------------------------------------ E2: 4K
if (want('E2')) {
    const r = await hook(page, `return await h.videoExport.run({ size: '2160p', fromTick: ${range.from}, toTick: ${range.from + 1000} });`);
    const file = await saveLast(page, 'e2-2160p');
    const pr = file ? probe(file.file) : null;
    const pics = file && pr ? stills(file.file, 'e2', pr.packets) : [];
    await hook(page, 'h.videoExport.close(); return true;');
    const size = await hook(page, 'return { w: h.session.renderer.canvas.width, h: h.session.renderer.canvas.height };');
    const pass = !!pr && pr.r_frame_rate === '60/1' && pr.packets === 60 && pr.decoded === 60 && pr.dupPts === 0 && pr.width === 3840 && pr.height === 2160 && r.encodedIncomplete === 0 && size.w !== 3840;
    out.E2 = { pass, what: '4K: 1 s gives 3840 x 2160, 60 frames, 60/1; the canvas back at the window\'s size after', result: { encoded: r.encoded, waited: r.waited, incomplete: r.incomplete, info: r.info }, canvasAfter: size, ffprobe: pr, stills: pics, file: file && { ...file, file: undefined } };
    console.log('E2', pass ? 'PASS' : 'FAIL', JSON.stringify({ pr, size, waited: r.waited }));
}

// ------------------------------------------------------------------ E3: Cancel
if (want('E3')) {
    const before = await hook<Any[]>(page, listFolder(`gsfpv-export-${RUN}`));
    await hook(page, `window.__vx = h.videoExport.run({ size: '1440p', fromTick: ${range.from}, toTick: ${range.to} }); return true;`);
    await page.waitForTimeout(800);
    await hook(page, 'h.videoExport.cancel(); return true;');
    const r = await hook(page, 'return await window.__vx;');
    const underBar = await hook(page, 'return { paused: s.paused, bar: h.videoExport.state().bar, text: document.querySelector("[data-testid=video-export-status]")?.textContent };');
    const after = await hook<Any[]>(page, listFolder(`gsfpv-export-${RUN}`));
    await page.keyboard.press('Escape'); // the bar's Close
    await page.waitForTimeout(300);
    const closed = await hook(page, 'return { bar: h.videoExport.state().bar, menuOpen: !!document.querySelector(".pause-menu"), paused: s.paused };');
    const pass = r.ended === 'cancel' && r.encoded > 0 && r.encoded < r.frames && after.length === before.length && underBar.paused === true && underBar.bar === true && closed.bar === false && closed.menuOpen === true;
    out.E3 = { pass, what: 'Cancel stops the export, leaves no file, keeps the flight paused under the bar; Esc closes the bar back to the summary panel', result: { ended: r.ended, encoded: r.encoded, frames: r.frames }, filesBefore: before.length, filesAfter: after.length, underBar, closed };
    console.log('E3', pass ? 'PASS' : 'FAIL', JSON.stringify(out.E3));
}

// ------------------------------------------------------------------ E4: the summary panel's row, clicked
if (want('E4')) {
    if (!(await page.$('.pause-menu'))) { await page.keyboard.press('KeyP'); await page.waitForTimeout(400); }
    const row = await hook(page, 'const r = document.querySelector("[data-testid=video-export]"); return r ? { text: r.textContent, disabled: r.querySelector("[data-action=video-export]").disabled } : null;');
    const lifeFrames = await hook<number>(page, 'const l = s.log; return Math.floor((l.endTick - l.header.life.startTick) * 60 / 1000);');
    await page.selectOption('[data-testid=video-export-size]', '1440p');
    await page.click('[data-action=video-export]');
    const t1 = Date.now();
    let text = '';
    while (Date.now() - t1 < 240000) {
        text = await page.evaluate('document.querySelector("[data-testid=video-export-status]")?.textContent ?? ""') as string;
        if (/60 fps ·|cancelled|not saved/.test(text)) break;
        await page.waitForTimeout(500);
    }
    const file = await saveLast(page, 'e4-1440p');
    const pr = file ? probe(file.file) : null;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const after = await hook(page, 'return { bar: h.videoExport.state().bar, menuOpen: !!document.querySelector(".pause-menu") };');
    const pass = !!row && row.disabled === false && !!pr && pr.r_frame_rate === '60/1' && pr.width === 2560 && pr.height === 1440 && pr.dupPts === 0 && pr.packets === lifeFrames && pr.decoded === pr.packets
        && text.includes(`${lifeFrames} frames at 60 fps`) && after.bar === false && after.menuOpen === true;
    out.E4 = { pass, what: 'the summary panel row: 1440p chosen and Save video clicked saves the whole current life (2560 x 1440, 60/1, one frame per 1/60 s of it); the bar reports it; Esc closes it back to the panel', row, lifeFrames, barText: text, ffprobe: pr, file: file && { ...file, file: undefined }, after };
    console.log('E4', pass ? 'PASS' : 'FAIL', JSON.stringify({ row, lifeFrames, text, pr, after }));
}

out.consoleErrors = errors;
await browser.close();
const parts = ['E1', 'E2', 'E3', 'E4'].filter(want);
out.parts = parts;
out.pass = parts.every((k) => (out[k] as Any)?.pass === true);
console.log('evidence', writeEvidence(ONLY.length ? `v03-export-${parts.join('-')}` : 'v03-export', out));
