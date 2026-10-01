// Where the 1080p60 recording loses its pictures (item 19, F.1): measured in the real page with the
// scan drawn, system Chrome, the same viewport as accept-v03-rec.ts R1.
//   A  a bare VideoEncoder fed from the page's canvas at the page's own rate, per encoder config:
//      frames fed and encoded, encode -> output latency, encodeQueueSize, the time of one frame's
//      drawImage + VideoFrame + encode() on the main thread.
//   B  the recorder itself (h.rec.start, 10 s): the same per-call numbers from inside VideoEncoder
//      (an init script wraps it), the recorder's own pictures in flight, and the folder writes.
//   LOCAL_FLY=1 SITE=http://127.0.0.1:5335 npx tsx src/probe-rec-encoder.ts [A] [B]
import { launchChrome, waitReady } from './browser';
import { writeEvidence } from './evidence';

const SITE = (process.env.SITE ?? 'http://127.0.0.1:5335').replace(/\/$/, '');
const fly = (qs: string) => (process.env.LOCAL_FLY ? `${SITE}/fly/?${qs}` : `${SITE}/en/fly/?${qs}`);
const ONLY = process.argv.slice(2);
const want = (k: string) => ONLY.length === 0 || ONLY.includes(k);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

/** Wraps VideoEncoder (encode and output times, queue size) and the folder writes. */
const INSTRUMENT = `(() => {
    const E = window.VideoEncoder; if (!E) return;
    window.__enc = [];
    window.VideoEncoder = class extends E {
        constructor(init) {
            const st = { cfg: null, enc: [], out: [] };
            super({ output: (c, m) => { st.out.push([performance.now(), c.timestamp, c.byteLength]); init.output(c, m); }, error: init.error });
            this.__st = st; window.__enc.push(st);
        }
        configure(c) { this.__st.cfg = { ...c }; return super.configure(c); }
        encode(f, o) { const t = performance.now(); super.encode(f, o); this.__st.enc.push([t, f.timestamp, this.encodeQueueSize, performance.now() - t]); }
    };
    const W = window.FileSystemWritableFileStream;
    window.__writes = [];
    if (W) { const w = W.prototype.write; W.prototype.write = async function (d) { const t = performance.now(); try { return await w.call(this, d); } finally { window.__writes.push([t, performance.now() - t, (d && d.data && d.data.byteLength) || 0]); } }; }
})();`;

/** Percentiles and the summary of one encoder's wrapped log. */
const SUMMARY = `
    const pct = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))] * 10) / 10; };
    const summ = (st) => {
        const sent = new Map(); for (const e of st.enc) sent.set(e[1], e[0]);
        const lat = st.out.map((o) => o[0] - (sent.get(o[1]) ?? o[0]));
        const outT = st.out.map((o) => o[0]);
        const span = outT.length > 1 ? (outT[outT.length - 1] - outT[0]) / 1000 : 0;
        const encT = st.enc.map((e) => e[0]);
        const encSpan = encT.length > 1 ? (encT[encT.length - 1] - encT[0]) / 1000 : 0;
        // steady output rate: outputs in the middle half of the run
        const a = encT[0] + (encT[encT.length - 1] - encT[0]) * 0.25, b = encT[0] + (encT[encT.length - 1] - encT[0]) * 0.75;
        const mid = outT.filter((t) => t >= a && t < b).length / Math.max(0.001, (b - a) / 1000);
        return { cfg: st.cfg && { codec: st.cfg.codec, w: st.cfg.width, h: st.cfg.height, bitrate: st.cfg.bitrate, latencyMode: st.cfg.latencyMode, hw: st.cfg.hardwareAcceleration ?? 'no-preference', framerate: st.cfg.framerate ?? null },
            encoded: st.enc.length, outputs: st.out.length, encodeCallsPerS: Math.round(st.enc.length / Math.max(0.001, encSpan) * 10) / 10, outputsPerS: Math.round(st.out.length / Math.max(0.001, span) * 10) / 10, steadyOutputsPerS: Math.round(mid * 10) / 10,
            latencyMs: { p50: pct(lat, 0.5), p95: pct(lat, 0.95), max: pct(lat, 1) }, queueAtEncode: { p50: pct(st.enc.map((e) => e[2]), 0.5), p95: pct(st.enc.map((e) => e[2]), 0.95), max: pct(st.enc.map((e) => e[2]), 1) },
            encodeCallMs: { p50: pct(st.enc.map((e) => e[3]), 0.5), p95: pct(st.enc.map((e) => e[3]), 0.95), max: pct(st.enc.map((e) => e[3]), 1) },
            bytes: st.out.reduce((n, o) => n + o[2], 0) };
    };`;

const hook = <T = Any>(p: Any, body: string): Promise<T> => p.evaluate(`(async () => { const h = window.__gsfpv; const s = h.session; ${SUMMARY} ${body} })()`) as Promise<T>;

const { browser, which } = await launchChrome({ headless: false, args: ['--window-position=40,40', '--window-size=1296,920'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
await ctx.addInitScript(INSTRUMENT);
// a 30 Hz display: the page's frame loop from a 60 Hz timer, as accept-v03-rec.ts R1 does (FORCE60=0: the display's own rate)
if (process.env.FORCE60 !== '0') await ctx.addInitScript(`(() => {
    const P = 1000 / 60, t0 = performance.now();
    let n = 0, next = 1, queue = new Map();
    const loop = () => {
        const now = performance.now();
        n = Math.max(n + 1, Math.ceil((now - t0) / P));
        setTimeout(() => { const cbs = queue; queue = new Map(); const ts = performance.now(); for (const cb of cbs.values()) { try { cb(ts); } catch (e) { console.error(e); } } loop(); }, Math.max(0, t0 + n * P - now));
    };
    loop();
    window.requestAnimationFrame = (cb) => { const id = next++; queue.set(id, cb); return id; };
    window.cancelAnimationFrame = (id) => { queue.delete(id); };
})();`);
const page = await ctx.newPage();
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`.slice(0, 300)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
await page.goto(fly('scene=39e63ce9&simradio=scenario&tour=1&nowarn=1'));
const ready = await waitReady(page, 240000).catch(async (e) => {
    console.log('not ready', JSON.stringify(await page.evaluate('({ s: window.__gsfpv && window.__gsfpv.status, msg: document.body.innerText.slice(0, 400) })')), errors);
    throw e;
});
await page.waitForTimeout(5000);
const out: Record<string, Any> = { site: SITE, browser: which, force60: process.env.FORCE60 !== '0', renderer: (ready.info as Any)?.currentRenderer };
out.page = await hook(page, `const f0 = s.frames, t0 = performance.now(); await new Promise((r) => setTimeout(r, 2000)); const c = h.rec.rec.d.canvas; return { engineFps: Math.round((s.frames - f0) / (performance.now() - t0) * 10000) / 10, canvas: [c.width, c.height] };`);
console.log('page', JSON.stringify(out.page));

if (want('A')) {
    const W = 1728, H = 1080, bitrate = Math.round(W * H * 60 * 0.1);
    const base = { codec: 'avc1.640033', width: W, height: H, bitrate, framerate: 60 };
    const configs: Record<string, Any> = {
        current: { ...base, latencyMode: 'quality' },
        realtime: { ...base, latencyMode: 'realtime' },
        hwQuality: { ...base, latencyMode: 'quality', hardwareAcceleration: 'prefer-hardware' },
        hwRealtime: { ...base, latencyMode: 'realtime', hardwareAcceleration: 'prefer-hardware' },
        hwRealtimeCbr: { ...base, latencyMode: 'realtime', hardwareAcceleration: 'prefer-hardware', bitrateMode: 'constant' },
        swQuality: { ...base, latencyMode: 'quality', hardwareAcceleration: 'prefer-software' }
    };
    out.A = {};
    for (const [k, cfg] of Object.entries(configs)) {
        const r = await hook(page, `
            const cfg = ${JSON.stringify(cfg)};
            let sup; try { sup = await VideoEncoder.isConfigSupported(cfg); } catch (e) { return { supported: false, error: String(e) }; }
            if (!sup.supported) return { supported: false };
            const oc = new OffscreenCanvas(cfg.width, cfg.height); const cx = oc.getContext('2d', { willReadFrequently: false });
            const src = h.rec.rec.d.canvas;
            let err = null;
            const enc = new VideoEncoder({ output: () => {}, error: (e) => { err = String(e); } });
            enc.configure(cfg);
            const st = window.__enc[window.__enc.length - 1];
            const frameMs = []; let n = 0; const t0 = performance.now(), f0 = s.frames;
            await new Promise((res) => {
                const tick = () => {
                    if (performance.now() - t0 >= 5000 || err) return res();
                    const a = performance.now();
                    cx.drawImage(src, 0, 0, cfg.width, cfg.height);
                    const vf = new VideoFrame(oc, { timestamp: Math.round(n * 1e6 / 60), duration: 16667 });
                    enc.encode(vf, { keyFrame: n % 120 === 0 }); vf.close();
                    frameMs.push(performance.now() - a); n++;
                    requestAnimationFrame(tick);
                };
                requestAnimationFrame(tick);
            });
            const engineFps = Math.round((s.frames - f0) / (performance.now() - t0) * 10000) / 10;
            const tf = performance.now(); try { await enc.flush(); } catch (e) { err ??= String(e); } const flushMs = Math.round(performance.now() - tf);
            enc.close();
            // capacity: as fast as the encoder takes them (its queue kept at 20), 3 s, the page still rendering
            const capOut = []; let m = 0;
            const enc2 = new VideoEncoder({ output: () => capOut.push(performance.now()), error: (e) => { err ??= String(e); } });
            enc2.configure(cfg);
            const tc = performance.now();
            while (performance.now() - tc < 3000 && !err) {
                if (enc2.encodeQueueSize >= 20) { await new Promise((r) => setTimeout(r, 1)); continue; }
                cx.drawImage(src, 0, 0, cfg.width, cfg.height);
                const vf = new VideoFrame(oc, { timestamp: Math.round(m * 1e6 / 60), duration: 16667 });
                enc2.encode(vf, { keyFrame: m % 120 === 0 }); vf.close(); m++;
                if (m % 4 === 0) await new Promise((r) => setTimeout(r, 0));
            }
            try { await enc2.flush(); } catch (e) { err ??= String(e); }
            enc2.close();
            const capacityFps = capOut.length > 1 ? Math.round((capOut.length - 1) / ((capOut[capOut.length - 1] - capOut[0]) / 1000) * 10) / 10 : 0;
            return { supported: true, err, engineFps, flushMs, capacityFps, capacityFrames: m, frameMainThreadMs: { p50: pct(frameMs, 0.5), p95: pct(frameMs, 0.95), max: pct(frameMs, 1) }, ...summ(st) };`);
        out.A[k] = r;
        console.log('A', k, JSON.stringify(r));
        await page.waitForTimeout(800);
    }
}

// C: the bare encoder fed the way the recorder feeds it, one feature at a time (hardware, quality, 60 Hz):
// hold = the composed frame kept until the next one and a re-stamped copy encoded; strip = a read back
// of the credit strip every 60 frames; engine = called from the engine's frame (Recording.frame) instead of rAF.
if (want('C')) {
    const variants = (process.env.PROBE_C ?? 'raf,raf+hold,raf+strip,engine,engine+hold+strip,raf').split(',');
    out.C = {};
    for (const [i, v] of variants.entries()) {
        const r = await hook(page, `
            const v = ${JSON.stringify(v)}.split('+');
            const cfg = { codec: 'avc1.640033', width: 1728, height: 1080, bitrate: 11197440, framerate: 60, latencyMode: 'quality', hardwareAcceleration: 'prefer-hardware' };
            const oc = new OffscreenCanvas(cfg.width, cfg.height); const cx = oc.getContext('2d', { willReadFrequently: false });
            const src = h.rec.rec.d.canvas;
            let err = null;
            const enc = new VideoEncoder({ output: () => {}, error: (e) => { err = String(e); } });
            enc.configure(cfg);
            const st = window.__enc[window.__enc.length - 1];
            let n = 0, prev = null; const t0 = performance.now();
            const one = () => {
                cx.drawImage(src, 0, 0, cfg.width, cfg.height);
                if (v.includes('strip') && n % 60 === 0) cx.getImageData(10, cfg.height - 80, 500, 60);
                const ts = Math.round(n * 1e6 / 60);
                if (v.includes('hold')) { const cur = new VideoFrame(oc, { timestamp: 0 }); const f = new VideoFrame(cur, { timestamp: ts, duration: 16667 }); enc.encode(f, { keyFrame: n % 120 === 0 }); f.close(); if (prev) prev.close(); prev = cur; }
                else { const f = new VideoFrame(oc, { timestamp: ts, duration: 16667 }); enc.encode(f, { keyFrame: n % 120 === 0 }); f.close(); }
                n++;
            };
            await new Promise((res) => {
                if (v[0] === 'engine') {
                    const R = h.rec.rec; const orig = R.frame;
                    R.frame = (now) => { orig.call(R, now); if (performance.now() - t0 >= 4000 || err) { R.frame = orig; res(); return; } one(); };
                } else {
                    const tick = () => { if (performance.now() - t0 >= 4000 || err) return res(); one(); requestAnimationFrame(tick); };
                    requestAnimationFrame(tick);
                }
            });
            const tf = performance.now(); try { await enc.flush(); } catch (e) { err ??= String(e); } const flushMs = Math.round(performance.now() - tf);
            enc.close(); if (prev) prev.close();
            const firstOut = st.out.slice(0, 6).map((o) => Math.round(o[0] - st.enc[0][0]));
            return { err, flushMs, firstOut, ...summ(st) };`);
        out.C[`${i}-${v}`] = r;
        console.log('C', v, new Date().toISOString().slice(11, 23), JSON.stringify({ err: r.err, encoded: r.encoded, steady: r.steadyOutputsPerS, lat: r.latencyMs, q: r.queueAtEncode, flushMs: r.flushMs, firstOut: r.firstOut }));
        await page.waitForTimeout(800);
    }
}

// D: which frames the encoder is slow on: frames in CPU memory (I420, no canvas) against frames from
// the 2D canvas, alternated, several encoder instances each (hardware, quality, 60 Hz, 3 s each).
if (want('D')) {
    const variants = (process.env.PROBE_D ?? 'cpu,canvas,cpu,canvas,cpu,canvas').split(',');
    out.D = {};
    for (const [i, v] of variants.entries()) {
        const r = await hook(page, `
            const v = ${JSON.stringify(v)};
            const cfg = { codec: 'avc1.640033', width: 1728, height: 1080, bitrate: 11197440, framerate: 60, latencyMode: 'quality', hardwareAcceleration: 'prefer-hardware' };
            const W = cfg.width, H = cfg.height;
            const oc = new OffscreenCanvas(W, H); const cx = oc.getContext('2d', { willReadFrequently: v === 'cpucanvas' });
            const src = h.rec.rec.d.canvas;
            const frameMs = []; let chain = Promise.resolve();
            const tinyC = new OffscreenCanvas(1, 1); const tiny = tinyC.getContext('2d');
            const yuv = new Uint8Array(W * H * 3 / 2); for (let k = 0; k < W * H; k++) yuv[k] = (k * 7) & 255; yuv.fill(128, W * H);
            let err = null;
            if (v === 'gpumap') {
                // the engine's own WebGPU device: copy the drawn canvas texture into a buffer, map it, encode it as a CPU frame
                const gc = src.getContext('webgpu'); const conf = gc.getConfiguration ? gc.getConfiguration() : null; const dev = conf ? conf.device : s.renderer.app.graphicsDevice.wgpu;
                const cw = src.width, ch = src.height, bpr = Math.ceil(cw * 4 / 256) * 256;
                const fmt = (conf && conf.format) || 'bgra8unorm';
                const pool = [0, 1, 2, 3].map(() => dev.createBuffer({ size: bpr * ch, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }));
                const free = [...pool];
                const enc2 = new VideoEncoder({ output: () => {}, error: (e) => { err = String(e); } });
                enc2.configure({ ...cfg, width: cw, height: ch, bitrate: Math.round(cw * ch * 6) });
                const st2 = window.__enc[window.__enc.length - 1];
                const frameMs = []; let n = 0, skipped = 0, maps = 0; const t0 = performance.now(); let chain = Promise.resolve();
                await new Promise((res) => {
                    const R = h.rec.rec; const orig = R.frame;
                    R.frame = (now) => {
                        orig.call(R, now);
                        if (performance.now() - t0 >= 3000 || err) { R.frame = orig; res(); return; }
                        const a0 = performance.now();
                        const buf = free.pop(); if (!buf) { skipped++; return; }
                        const ce = dev.createCommandEncoder(); ce.copyTextureToBuffer({ texture: gc.getCurrentTexture() }, { buffer: buf, bytesPerRow: bpr }, [cw, ch]); dev.queue.submit([ce.finish()]);
                        const ts = Math.round(n * 1e6 / 60), key = n % 120 === 0; n++;
                        const p = buf.mapAsync(GPUMapMode.READ).then(() => { maps++; const f = new VideoFrame(new Uint8Array(buf.getMappedRange()), { format: fmt.startsWith('bgra') ? 'BGRX' : 'RGBX', codedWidth: cw, codedHeight: ch, layout: [{ offset: 0, stride: bpr }], timestamp: ts, duration: 16667 }); buf.unmap(); free.push(buf); return f; });
                        chain = chain.then(() => p).then((f) => { enc2.encode(f, { keyFrame: key }); f.close(); });
                        frameMs.push(performance.now() - a0);
                    };
                });
                await chain; await enc2.flush(); enc2.close(); pool.forEach((b) => b.destroy());
                const sm = summ(st2);
                return { err, encoded: n, skipped, maps, fmt, size: [cw, ch], frameMainThreadMs: { p50: pct(frameMs, 0.5), p95: pct(frameMs, 0.95) }, steadyOutputsPerS: sm.steadyOutputsPerS, outGapMsP50: null, latencyMs: sm.latencyMs, queueAtEncode: sm.queueAtEncode, flushMs: 0 };
            }
            if (v === 'worker') {
                const code = 'let enc, out = [], encT = new Map(), lat = []; onmessage = async (e) => { const m = e.data; if (m.cfg) { enc = new VideoEncoder({ output: (c) => { const t = performance.now(); out.push(t); const a = encT.get(c.timestamp); if (a !== undefined) lat.push(t - a); }, error: (x) => postMessage({ err: String(x) }) }); enc.configure(m.cfg); return; } if (m.frame) { encT.set(m.frame.timestamp, performance.now()); enc.encode(m.frame, { keyFrame: m.key }); m.frame.close(); return; } if (m.done) { await enc.flush(); enc.close(); postMessage({ out, lat }); } };';
                const wk = new Worker(URL.createObjectURL(new Blob([code], { type: 'text/javascript' })));
                wk.postMessage({ cfg });
                const frameMs = []; let n = 0; const t0 = performance.now();
                await new Promise((res) => { const tick = () => { if (performance.now() - t0 >= 3000) return res(); const a = performance.now(); cx.drawImage(src, 0, 0, W, H); const f = new VideoFrame(oc, { timestamp: Math.round(n * 1e6 / 60), duration: 16667 }); wk.postMessage({ frame: f, key: n % 120 === 0 }, [f]); frameMs.push(performance.now() - a); n++; requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
                const tf = performance.now();
                const r = await new Promise((res) => { wk.onmessage = (e) => { if (e.data.out) res(e.data); }; wk.postMessage({ done: true }); });
                wk.terminate();
                const o = r.out; const gaps = []; for (let k = 1; k < o.length; k++) gaps.push(o[k] - o[k - 1]);
                const a = o[0] + (o[o.length - 1] - o[0]) * 0.25, b = o[0] + (o[o.length - 1] - o[0]) * 0.75;
                return { err, encoded: n, outputs: o.length, flushMs: Math.round(performance.now() - tf), outGapMsP50: pct(gaps, 0.5), frameMainThreadMs: { p50: pct(frameMs, 0.5), p95: pct(frameMs, 0.95) }, steadyOutputsPerS: Math.round(o.filter((t) => t >= a && t < b).length / ((b - a) / 1000) * 10) / 10, latencyMs: { p50: pct(r.lat, 0.5), p95: pct(r.lat, 0.95) }, queueAtEncode: { max: null } };
            }
            const enc = new VideoEncoder({ output: () => {}, error: (e) => { err = String(e); } });
            enc.configure(cfg);
            const st = window.__enc[window.__enc.length - 1];
            let n = 0; const t0 = performance.now();
            await new Promise((res) => {
                const tick = () => {
                    if (performance.now() - t0 >= 3000 || err) return res();
                    const ts = Math.round(n * 1e6 / 60);
                    let f; const a0 = performance.now(); const key = n % 120 === 0;
                    if (v === 'cpu') { yuv[(n * 9973) % (W * H)] ^= 255; f = new VideoFrame(yuv, { format: 'I420', codedWidth: W, codedHeight: H, timestamp: ts, duration: 16667 }); }
                    else if (v === 'bitmap') { cx.drawImage(src, 0, 0, W, H); const bm = oc.transferToImageBitmap(); f = new VideoFrame(bm, { timestamp: ts, duration: 16667 }); bm.close(); }
                    else { cx.drawImage(src, 0, 0, W, H); f = new VideoFrame(oc, { timestamp: ts, duration: 16667 }); }
                    if (v === 'copyto') {
                        const g = f; const buf = new Uint8Array(g.allocationSize());
                        const p = g.copyTo(buf).then((layout) => { const c = new VideoFrame(buf, { format: g.format, codedWidth: g.codedWidth, codedHeight: g.codedHeight, layout, timestamp: g.timestamp, duration: 16667 }); g.close(); return c; });
                        chain = chain.then(() => p).then((c) => { enc.encode(c, { keyFrame: key }); c.close(); });
                    } else { enc.encode(f, { keyFrame: key }); f.close(); }
                    // a 1-pixel read back flushes the canvas's GPU work and waits for it (the conversion's turn?)
                    if (v === 'canvas+flush') cx.getImageData(0, 0, 1, 1);
                    // a non-blocking flush: a 1 x 1 canvas on the same GPU context hands over its picture
                    if (v === 'canvas+tib') { tiny.fillRect(0, 0, 1, 1); tinyC.transferToImageBitmap().close(); }
                    frameMs.push(performance.now() - a0); n++;
                    requestAnimationFrame(tick);
                };
                requestAnimationFrame(tick);
            });
            await chain;
            const tf = performance.now(); try { await enc.flush(); } catch (e) { err ??= String(e); } const flushMs = Math.round(performance.now() - tf);
            enc.close();
            const o = st.out.map((x) => x[0]); const gaps = []; for (let k = 1; k < o.length; k++) gaps.push(o[k] - o[k - 1]);
            return { err, flushMs, outGapMsP50: pct(gaps, 0.5), frameMainThreadMs: { p50: pct(frameMs, 0.5), p95: pct(frameMs, 0.95) }, ...summ(st) };`);
        out.D[`${i}-${v}`] = r;
        console.log('D', v, new Date().toISOString().slice(11, 23), JSON.stringify({ err: r.err, encoded: r.encoded, steady: r.steadyOutputsPerS, outGapP50: r.outGapMsP50, main: r.frameMainThreadMs, latP50: r.latencyMs.p50, qMax: r.queueAtEncode.max, flushMs: r.flushMs }));
        await page.waitForTimeout(500);
    }
}

// E: one canvas-fed encoder (hardware, quality, 60 Hz) for 50 s after the page is ready, per second:
// packets out, and the engine's splat streaming (gsplat frame:ready loading count, bytes received).
if (want('E')) for (let pass = 0; pass < Number(process.env.E_PASSES ?? 1); pass++) {
    if (pass > 0) { await page.reload(); await waitReady(page, 240000); await page.waitForTimeout(5000); }
    const r = await hook(page, `
        const cfg = { codec: 'avc1.640033', width: 1728, height: 1080, bitrate: 11197440, framerate: 60, latencyMode: 'quality', hardwareAcceleration: 'prefer-hardware' };
        const oc = new OffscreenCanvas(cfg.width, cfg.height); const cx = oc.getContext('2d', { willReadFrequently: false });
        const src = h.rec.rec.d.canvas;
        let loading = -1; const sys = s.renderer.app.systems.gsplat; const on = (_c, _l, ready, n) => { loading = n; }; sys.on('frame:ready', on);
        let outs = 0, err = null;
        const enc = new VideoEncoder({ output: () => { outs++; }, error: (e) => { err = String(e); } });
        enc.configure(cfg);
        const rows = []; let n = 0; const t0 = performance.now(); let lastSec = 0, lastOuts = 0, lastN = 0, f0 = s.frames;
        await new Promise((res) => {
            const tick = () => {
                const now = performance.now();
                if (now - t0 >= ${Number(process.env.E_S ?? 50) * 1000} || err) return res();
                const sec = Math.floor((now - t0) / 1000);
                if (sec > lastSec) { const b = s.renderer.splatBytes(); rows.push([sec, outs - lastOuts, n - lastN, enc.encodeQueueSize, loading, Math.round((b.received ?? b.bytes ?? 0) / 1e6), s.frames - f0]); lastSec = sec; lastOuts = outs; lastN = n; f0 = s.frames; }
                // keep the backlog bounded, so a slow second shows as a slow second
                if (enc.encodeQueueSize < 20) { cx.drawImage(src, 0, 0, cfg.width, cfg.height); const f = new VideoFrame(oc, { timestamp: Math.round(n * 1e6 / 60), duration: 16667 }); enc.encode(f, { keyFrame: n % 120 === 0 }); f.close(); n++; }
                requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
        });
        sys.off('frame:ready', on);
        await enc.flush(); enc.close();
        return { err, cols: ['s', 'packetsOut', 'fed', 'queue', 'gsplatLoading', 'splatMB', 'engineFrames'], rows, splatBytesKeys: Object.keys(s.renderer.splatBytes()) };`);
    out[`E${pass}`] = r;
    console.log('E pass', pass, r.err);
    console.log('E', r.rows.map((row: number[]) => `${row[0]}:${row[1]}`).join(' '));
}

if (want('B')) {
    // variants of the live recorder, one after another on the same page (PROBE_B, comma separated):
    // as-is; nostrip (no credit-strip read back); norepeat (missed slots not repeated)
    const PATCH: Record<string, string> = { 'as-is': '', nostrip: 'rec.stripStd = () => 0.5;', norepeat: 'rec.pacer.maxRepeat = 0;' };
    const variants = (process.env.PROBE_B ?? 'as-is').split(',');
    out.B = {};
    for (const [i, v] of variants.entries()) {
    await hook(page, `const root = await navigator.storage.getDirectory(); const d = await root.getDirectoryHandle('gsfpv-probe-' + Date.now().toString(36), { create: true }); await h.rec.useFolder(d); return 0;`);
    const r = await hook(page, `
        const n0 = window.__enc.length; window.__writes.length = 0;
        const codec = await h.rec.start();
        const rec = h.rec.rec.recorder; const orig = rec.addFrame.bind(rec);
        ${PATCH[v] ?? ''}
        const calls = [];
        rec.addFrame = (src, now) => { const p = rec.part; const pend = p ? p.pendingPictures : -1, q = p ? p.queue : -1; const a = performance.now(); orig(src, now); calls.push([a, performance.now() - a, pend, q]); };
        const t0 = performance.now(), f0 = s.frames;
        await new Promise((r) => setTimeout(r, ${Number(process.env.PROBE_S ?? 10) * 1000}));
        const engineFps = Math.round((s.frames - f0) / (performance.now() - t0) * 10000) / 10;
        const tStop = performance.now();
        const info = await h.rec.stop();
        const stopMs = Math.round(performance.now() - tStop);
        const st = window.__enc[n0];
        const w = window.__writes;
        const gaps = []; for (let i = 1; i < calls.length; i++) gaps.push(calls[i][0] - calls[i - 1][0]);
        // pictures in flight and the encoder's queue, sampled every 0.1 s for 2 s, then every 0.5 s
        const series = []; let next = calls.length ? calls[0][0] : 0; for (const c of calls) if (c[0] >= next) { series.push([Math.round(c[0] - calls[0][0]), c[2], c[3]]); next += c[0] - calls[0][0] < 2000 ? 100 : 500; }
        // when the encoder gave its first packets back (ms after the first encode call)
        const firstOut = st ? st.out.slice(0, 5).map((o) => Math.round(o[0] - st.enc[0][0])) : null;
        return { codec, engineFps, stopMs, info: { frames: info.frames, duplicated: info.duplicated, heldForEncoder: info.heldForEncoder, dropped: info.dropped, bytes: info.bytes },
            addFrameMs: { n: calls.length, p50: pct(calls.map((c) => c[1]), 0.5), p95: pct(calls.map((c) => c[1]), 0.95), max: pct(calls.map((c) => c[1]), 1), sumS: Math.round(calls.reduce((n, c) => n + c[1], 0)) / 1000 },
            frameGapMs: { p50: pct(gaps, 0.5), p95: pct(gaps, 0.95), max: pct(gaps, 1) },
            pendingPictures: { p50: pct(calls.map((c) => c[2]), 0.5), max: pct(calls.map((c) => c[2]), 1) }, series,
            writes: { n: w.length, sumMs: Math.round(w.reduce((n, x) => n + x[1], 0)), p95: pct(w.map((x) => x[1]), 0.95), max: pct(w.map((x) => x[1]), 1), mb: Math.round(w.reduce((n, x) => n + x[2], 0) / 1e5) / 10 },
            firstOut, encoder: st ? summ(st) : null };`);
    out.B[`${i}-${v}`] = r;
    console.log('B', v, JSON.stringify({ engineFps: r.engineFps, info: r.info, steadyOut: r.encoder?.steadyOutputsPerS, latP50: r.encoder?.latencyMs?.p50, hw: r.encoder?.cfg?.hw, lm: r.encoder?.cfg?.latencyMode, firstOut: r.firstOut, series: r.series.filter((_: Any, j: number) => j % 4 === 0) }));
    await page.waitForTimeout(1500);
    }
}

await browser.close();
out.consoleErrors = errors;
console.log('evidence', writeEvidence(`v03-rec-probe${ONLY.length ? `-${ONLY.join('-')}` : ''}`, out));
