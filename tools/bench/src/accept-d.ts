// Phase D acceptance: cinema mode + recorder, quality governor, Betaflight diff import, trajectory
// export. Each with a negative control.
//   SITE=https://gsfpv.flyreelstudio.eu npx tsx src/accept-d.ts [cinema governor diff trajectory]
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, waitReady } from './browser';
import { writeEvidence, REPO, today } from './evidence';

const SITE = (process.env.SITE ?? 'https://gsfpv.flyreelstudio.eu').replace(/\/$/, '');
const fly = (l: string, qs: string) => (process.env.LOCAL_FLY ? `${SITE}/fly/?${qs}` : `${SITE}/${l}/fly/?${qs}`) + `&cb=${Math.random().toString(36).slice(2)}`;
const ONLY = process.argv.slice(2);
const want = (k: string) => ONLY.length === 0 || ONLY.includes(k);
const OUT = join(REPO, 'evidence', today(), 'd');
mkdirSync(OUT, { recursive: true });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const { browser, page } = await launch();
const hook = <T>(js: string): Promise<T> => page.evaluate(`(async () => { const h = window.__gsfpv; const s = h.session; ${js} })()`) as Promise<T>;
const summary: Record<string, boolean> = {};

/** Minimal MP4 reader: sample count (stsz), track size (tkhd), codec box name (stsd). */
function mp4Info(b: Buffer): { boxes: string[]; samples: number | null; width: number | null; height: number | null; codec: string | null } {
    const boxes: string[] = [];
    let samples: number | null = null, width: number | null = null, height: number | null = null, codec: string | null = null;
    const walk = (start: number, end: number, depth: number) => {
        let p = start;
        while (p + 8 <= end) {
            let size = b.readUInt32BE(p);
            const type = b.toString('latin1', p + 4, p + 8);
            let head = 8;
            if (size === 1) { size = Number(b.readBigUInt64BE(p + 8)); head = 16; }
            if (size === 0) size = end - p;
            if (size < 8) break;
            if (depth === 0) boxes.push(type);
            if (['moov', 'trak', 'mdia', 'minf', 'stbl'].includes(type)) walk(p + head, p + size, depth + 1);
            if (type === 'stsz') samples = b.readUInt32BE(p + head + 8);
            if (type === 'tkhd') { const v = b[p + head]; const off = p + head + (v === 1 ? 88 : 76); width = b.readUInt32BE(off) / 65536; height = b.readUInt32BE(off + 4) / 65536; }
            if (type === 'stsd') codec = b.toString('latin1', p + head + 12, p + head + 16);
            p += size;
        }
    };
    walk(0, b.length, 0);
    return { boxes, samples, width, height, codec };
}

// ------------------------------------------------------------------ cinema mode + recorder
if (want('cinema')) {
    await page.goto(fly('en', 'scene=887f27aa&simradio=scenario&tour=1&nowarn=1'));
    await waitReady(page, 180000);
    await page.waitForTimeout(4000); // the bot is up and flying its tour
    await hook('h.cinema.toggle(); return 0;');
    const state = await hook<Any>('return { on: h.cinema.on(), governorEnabled: h.governor.enabled, lodRangeMax: s.renderer.splat.gsplat.lodRangeMax, canRecord: h.cinema.canRecord };');
    const codec = await hook<string>('return await h.cinema.start();');
    await page.waitForTimeout(6000);
    const info = await hook<Any>('return await h.cinema.stop();');
    const strip = await hook<number>('return h.cinema.creditStripStd();');
    const b64 = await hook<string>('const b = h.cinema.lastBytes; let s2 = ""; for (let i = 0; i < b.length; i += 0x8000) s2 += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s2);');
    const mp4 = Buffer.from(b64, 'base64');
    writeFileSync(join(OUT, 'cinema-887f27aa.mp4'), mp4);
    const parsed = mp4Info(mp4);
    await page.screenshot({ path: join(OUT, 'cinema-on.jpg') });
    // control: a pasted (non-showcase) scene offers no recording, and a direct call is refused
    await page.goto(fly('en', 'scene=723068d7&nowarn=1&input=touch'));
    await waitReady(page, 180000);
    await hook('h.cinema.toggle(); return 0;');
    const ctl = await hook<Any>('let refused = false; try { await h.cinema.start(); } catch (e) { refused = true; } return { canRecord: h.cinema.canRecord, refused, recButtonVisible: !document.querySelector("[data-action=cinema-rec]").hidden, note: document.querySelector("[data-testid=cinema-note]").textContent };');
    const pass = state.on && state.governorEnabled === false && state.lodRangeMax === 0 && state.canRecord && !!codec && info && info.frames > 60 && parsed.samples === info.frames && parsed.boxes.includes('moov') && parsed.boxes.includes('mdat') && strip > 0.1
        && ctl.canRecord === false && ctl.refused && !ctl.recButtonVisible;
    summary.cinema = pass;
    writeEvidence('d-cinema', { site: SITE, pass, state, codec, recorder: info, mp4: { ...parsed, bytes: mp4.length, file: 'evidence/…/d/cinema-887f27aa.mp4' }, creditStripLuminanceStd: strip, control: ctl });
    console.log('cinema', pass ? 'PASS' : 'FAIL', JSON.stringify({ info, parsed, strip, ctl }));
}

// ------------------------------------------------------------------ quality governor
async function governorRun(enabled: boolean): Promise<Any> {
    await page.goto(fly('en', `scene=887f27aa&nowarn=1&input=touch${enabled ? '' : '&governor=0'}`));
    await waitReady(page, 180000);
    await page.waitForTimeout(6000); // learn the display period on normal frames
    const t = async () => hook<Any>('return { step: h.governor.step, changes: h.governor.changes, periodMs: h.governor.displayPeriodMs, scale: s.renderer.renderScale };');
    const calm = await t();
    await hook('h.setFrameDelay(Math.round(h.governor.displayPeriodMs * 1.4)); return 0;'); // every frame now misses its vsync
    await page.waitForTimeout(4000);
    const loaded = await t();
    await hook('h.setFrameDelay(0); return 0;');
    await page.waitForTimeout(Math.max(6000, loaded.step * 5500 + 1500));
    const recovered = await t();
    return { calm, loaded, recovered };
}
if (want('governor')) {
    const on = await governorRun(true);
    const off = await governorRun(false);
    const pass = on.calm.step === 0 && on.loaded.step > 0 && on.loaded.scale < on.calm.scale && on.recovered.step === 0 && off.loaded.step === 0 && off.loaded.changes === 0;
    summary.governor = pass;
    writeEvidence('d-governor', { site: SITE, pass, method: 'normal frames 6 s (display period learned), then a busy-wait of 1.4 display periods in every frame for 4 s, then normal again', enabled: on, control: { governorOff: off, fired: off.loaded.step === 0 } });
    console.log('governor', pass ? 'PASS' : 'FAIL', JSON.stringify({ on, off }));
}

// ------------------------------------------------------------------ Betaflight diff import
if (want('diff')) {
    const f45 = readFileSync(join(REPO, 'packages', 'sim-core', 'test', 'fixtures', 'bf-diff-4.5.1.txt'), 'utf8');
    const f44 = readFileSync(join(REPO, 'packages', 'sim-core', 'test', 'fixtures', 'bf-diff-4.4.3.txt'), 'utf8');
    await page.goto(fly('en', 'scene=39e63ce9&nowarn=1&input=touch'));
    await waitReady(page, 180000);
    const imp = (txt: string) => hook<Any>(`return h.importDiff(${JSON.stringify(txt)});`);
    const r45 = await imp(f45);
    const p45 = await hook<Any>('return { rates: s.params.rates, pid: s.params.pid };');
    const r44 = await imp(f44);
    const p44 = await hook<Any>('return { rates: s.params.rates, pid: s.params.pid };');
    const noVersion = await imp(f45.split(/\r?\n/).filter((l) => !/^#\s*version/i.test(l) && !/^#\s*Betaflight/i.test(l)).join('\n'));
    const garbage = await imp('hello world\nset nothing = 1');
    const pAfterRefusal = await hook<Any>('return { rates: s.params.rates, pid: s.params.pid };');
    const pass = r45.ok && r44.ok && JSON.stringify(p45) !== JSON.stringify(p44) && !noVersion.ok && !garbage.ok && JSON.stringify(pAfterRefusal) === JSON.stringify(p44);
    summary.diff = pass;
    writeEvidence('d-bf-diff-import', { site: SITE, pass, imported45: { result: r45, params: p45 }, imported44: { result: r44, params: p44 }, control: { noVersionRefused: !noVersion.ok, noVersion, garbageRefused: !garbage.ok, paramsUnchangedAfterRefusal: JSON.stringify(pAfterRefusal) === JSON.stringify(p44) } });
    console.log('diff', pass ? 'PASS' : 'FAIL');
}

// ------------------------------------------------------------------ trajectory export
if (want('trajectory')) {
    await page.goto(fly('en', 'scene=39e63ce9&simradio=scenario&nowarn=1'));
    await waitReady(page, 180000);
    await page.waitForTimeout(12000);
    const r = await hook<Any>(`
        const csv = h.trajectoryText('csv').trim().split('\\n');
        const head = csv[0].split(',');
        const rows = csv.slice(1).map((l) => l.split(',').map(Number));
        const endTick = s.sim.tick;
        const saved = h.saveLog('traj');
        const bin = saved.bytes; let b2 = ''; for (let i = 0; i < bin.length; i++) b2 += String.fromCharCode(bin[i]);
        localStorage.setItem('gsfpv.lastLog', JSON.stringify({ label: 'traj', header: saved.header, endTick: saved.endTick, hash: saved.hash, b64: btoa(b2) }));
        const rep = h.verifyLastLog();
        // replayTrack samples every 100 ticks; rows are every 10 ticks: compare at the shared ticks
        const cmp = (shift) => { let d = 0, n = 0; for (let k = 0; k * 3 + 2 < rep.track.length; k++) { const tick = (k + 1) * 100; const i = tick / 10 - 1 + shift; if (i < 0 || i >= rows.length) continue; const row = rows[i]; if (Math.round(row[0] * 1000) !== tick + shift * 10) { } d = Math.max(d, Math.hypot(row[1] - rep.track[k * 3], row[2] - rep.track[k * 3 + 1], row[3] - rep.track[k * 3 + 2])); n++; } return { maxDeltaM: d, compared: n }; };
        return { columns: head, rows: rows.length, endTick, firstT: rows[0]?.[0], lastT: rows[rows.length - 1]?.[0], exact: cmp(0), shifted: cmp(1), replayHashMatches: rep.hash === saved.hash };`);
    const pass = r.rows >= Math.floor(r.endTick / 10) - 2 && r.exact.compared > 50 && r.exact.maxDeltaM === 0 && r.shifted.maxDeltaM > 0 && r.replayHashMatches;
    summary.trajectory = pass;
    writeEvidence('d-trajectory-export', { site: SITE, pass, check: 'every exported position equals the state recomputed from the input log alone at the same tick', result: r, control: { oneRowShift: r.shifted, fired: r.shifted.maxDeltaM > 0 } });
    console.log('trajectory', pass ? 'PASS' : 'FAIL', JSON.stringify(r));
}

await browser.close();
console.log(JSON.stringify(summary));
