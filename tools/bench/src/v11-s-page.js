// Runs INSIDE the simulator page (tools/bench/src/v11-s-accum.ts reads this file as text and evaluates it with the options
// as its argument): v0.11 lane S, the accumulating stochastic drawing against sorted and the engine's own dither.
// Plain browser JS on purpose (no TypeScript wrapper helpers in the page). Returns one JSON-able object per scene.
// Arms, all on the SAME view, budget and poses:
//   S  sorted (the reference)        E  the engine's own dither (impl 'engine', v0.10)
//   A  the accumulating renderer with upstream's defaults        A0  A with taa:off (single frame, the vendored renderer's raw quality)
//   AN A with no clamp and a long moving history (taaClip:0, taaMoveMax:64, taaMotion:0): the negative control of the motion tests
// One frame per pose: the pose is set right after a frame's 'frameend' (so the next frame draws it) and the next 'frameend'
// reads the canvas, the only moment a WebGPU canvas holds its picture. Luma is stored as Uint8 (one byte a pixel).
async (O) => {
  const W = O.W, H = O.H;
  const h = window.__gsfpv; const s = h.session; const r = s.renderer; const app = r.app; const canvas = r.canvas;
  s.pause(true, 'bake'); s.cameraOverride = true;
  r.maxFramesInFlight = 0;                      // never hold a frame: one 'frameend' = one drawn frame
  r.setFixedResolution({ w: W, h: H });
  const c0 = r.camera.getPosition(); const p0 = [c0.x, c0.y, c0.z];
  const tm0 = r.camera.camera.toneMapping;
  const comp = new OffscreenCanvas(W, H); const cctx = comp.getContext('2d', { willReadFrequently: true });
  const N = W * H;
  const r2 = (x) => Math.round(x * 100) / 100, r3 = (x) => Math.round(x * 1000) / 1000;
  const mean = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
  // one 'frameend' (a drawn frame), or an error after 20 s: a hidden or occluded window, a lost device and the like must end the run with a reason, not hang it
  const waitEnd = (work) => new Promise((res, rej) => {
    const t = setTimeout(() => { app.off('frameend', f); rej(new Error('no frame for 20 s at "' + (window.__progress || '') + '": ' + document.visibilityState + ', lost ' + (window.__lost || 'no') + ', gpu errors ' + JSON.stringify((window.__gpuErrors || []).slice(0, 3)))); }, 20000);
    const f = () => { clearTimeout(t); try { res(work ? work() : undefined); } catch (e) { rej(e); } };
    app.once('frameend', f);
  });
  const nextEnd = () => waitEnd(null);
  const settle = async (n) => { for (let i = 0; i < n; i++) await nextEnd(); };
  const lumaOf = (d) => { const l = new Uint8Array(N); for (let i = 0; i < N; i++) l[i] = (0.299 * d[4 * i] + 0.587 * d[4 * i + 1] + 0.114 * d[4 * i + 2] + 0.5) | 0; return l; };
  // read the canvas inside the frameend handler: luma (Uint8), the mean colour, optionally the RGBA copy
  const snap = (keep) => waitEnd(() => {
    cctx.drawImage(canvas, 0, 0, W, H);
    const d = cctx.getImageData(0, 0, W, H).data; const l = new Uint8Array(N); let mr = 0, mg = 0, mb = 0;
    for (let i = 0; i < N; i++) { const R = d[4 * i], G = d[4 * i + 1], B = d[4 * i + 2]; l[i] = (0.299 * R + 0.587 * G + 0.114 * B + 0.5) | 0; mr += R; mg += G; mb += B; }
    return { l, m: [mr / N, mg / N, mb / N], rgba: keep ? new Uint8ClampedArray(d) : null };
  });
  // frames 1..max after the call; the frames in `want` are read, the rest only counted
  const seq = async (max, want, keepAt = []) => { const out = {}; for (let f = 1; f <= max; f++) { if (want.includes(f)) out[f] = await snap(keepAt.includes(f)); else await nextEnd(); } return out; };
  const psnr = (a, b) => { let e = 0; for (let i = 0; i < N; i++) { const d = a[i] - b[i]; e += d * d; } e /= N; return e === 0 ? 99 : 10 * Math.log10(255 * 255 / e); };
  const mad = (a, b) => { let e = 0; for (let i = 0; i < N; i++) e += Math.abs(a[i] - b[i]); return e / N; };
  const ghost = (a, b, th) => { let n = 0; for (let i = 0; i < N; i++) if (Math.abs(a[i] - b[i]) > th) n++; return n / N; };
  const ssim = (a, b) => {   // mean SSIM on luma: 8x8 uniform windows every 4 px, the standard constants (as v10-r)
    const C1 = 6.5025, C2 = 58.5225; let sum = 0, n = 0;
    for (let y = 0; y + 8 <= H; y += 4) for (let x = 0; x + 8 <= W; x += 4) {
      let ma = 0, mb = 0, aa = 0, bb = 0, ab = 0;
      for (let j = 0; j < 8; j++) { const o = (y + j) * W + x; for (let i = 0; i < 8; i++) { const u = a[o + i], v = b[o + i]; ma += u; mb += v; aa += u * u; bb += v * v; ab += u * v; } }
      ma /= 64; mb /= 64; const va = aa / 64 - ma * ma, vb = bb / 64 - mb * mb, cv = ab / 64 - ma * mb;
      sum += ((2 * ma * mb + C1) * (2 * cv + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2)); n++;
    }
    return sum / n;
  };
  const score = (ref, x) => ({ psnr: r2(psnr(ref, x)), ssim: r3(ssim(ref, x)) });
  const flick = (fr) => fr.length < 2 ? 0 : mean(fr.slice(1).map((f, i) => mad(fr[i], f)));
  const tstd = (fr) => { const n = fr.length; const sm = new Float64Array(N), sq = new Float64Array(N); for (const f of fr) for (let i = 0; i < N; i++) { sm[i] += f[i]; sq[i] += f[i] * f[i]; } let t = 0; for (let i = 0; i < N; i++) { const m = sm[i] / n; t += Math.sqrt(Math.max(0, sq[i] / n - m * m)); } return t / N; };
  const toB64 = async (cv, type, q) => { const b = await cv.convertToBlob({ type, quality: q }); const u = new Uint8Array(await b.arrayBuffer()); let bin = ''; for (let i = 0; i < u.length; i += 8192) bin += String.fromCharCode.apply(null, u.subarray(i, i + 8192)); return btoa(bin); };
  const jpg = (rgba) => { cctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), W, H), 0, 0); return toB64(comp, 'image/jpeg', 0.9); };
  const TW = 320, TH = 180;
  const worstTile = (ref, x) => { let best = -1, bx = 0, by = 0; for (let ty = 0; ty < H / TH; ty++) for (let tx = 0; tx < W / TW; tx++) { let e = 0; for (let y = 0; y < TH; y++) { const o = (ty * TH + y) * W + tx * TW; for (let i = 0; i < TW; i++) { const d = ref[o + i] - x[o + i]; e += d * d; } } if (e > best) { best = e; bx = tx * TW; by = ty * TH; } } return { x: bx, y: by }; };
  const crop = async (rgba, x0, y0) => { const out = new Uint8ClampedArray(TW * TH * 4); for (let y = 0; y < TH; y++) out.set(rgba.subarray(((y0 + y) * W + x0) * 4, ((y0 + y) * W + x0 + TW) * 4), y * TW * 4); const oc = new OffscreenCanvas(TW, TH); oc.getContext('2d').putImageData(new ImageData(out, TW, TH), 0, 0); return toB64(oc, 'image/png'); };

  // ---- arms
  const ACC = () => r.accumulating && r.accumulating.inner;
  const variantOf = { A: '', A0: 'taa:off', AN: 'taaClip:0,taaMoveMax:64,taaMotion:0' };
  const useArm = async (name) => {
    if (name === 'S') r.setStochastic(false);
    else if (name === 'E') { r.stochasticImpl = 'engine'; r.setStochastic(true); }
    else {
      r.stochasticImpl = 'accum'; r.setStochastic(true);
      if (!r.accumulating || !r.accumulating.active) throw new Error('accumulating renderer did not start: ' + JSON.stringify(r.plan));
      r.accumulating.setVariant(variantOf[name]);
    }
    await settle(6);
    const want = name === 'S' ? 'sorted' : name === 'E' ? 'engine' : 'accum';
    if (r.drawn !== want) throw new Error('arm ' + name + ' draws ' + r.drawn);
  };
  const resetHistory = () => { const a = ACC(); if (a) a.resetHistory(); };
  const stable = async () => { let ok = 0; for (let i = 0; i < 300 && ok < 8; i++) { await nextEnd(); ok = (r.splatFrame && r.splatFrame.loading === 0) ? ok + 1 : 0; } return ok >= 8; };

  // ---- poses
  const look = (yawDeg) => { const a = yawDeg * Math.PI / 180; r.setCameraLookAt(p0[0], p0[1], p0[2], p0[0] + Math.sin(a), p0[1] - 0.1, p0[2] - Math.cos(a)); };
  const cruise = (k) => { const a = k * 0.02; const px = p0[0] + 1.5 * Math.sin(0.5 * a * 3); const pz = p0[2] + 1.5 * (1 - Math.cos(0.5 * a * 3)); r.setCameraLookAt(px, p0[1], pz, px + Math.sin(a), p0[1] - 0.1, pz - Math.cos(a)); };
  // 360 deg/s yaw (6 deg per 60 Hz frame) with a +-60 deg roll swing and a 1.5 m forward/back swing (peak 6.3 m/s); sc = 2 doubles the step per frame (30 Hz)
  const agile = (sc) => (k) => { const t = k * sc; const yaw = 6 * t * Math.PI / 180; const fwd = 1.5 * Math.sin(2 * Math.PI * t / 90); const roll = 60 * Math.sin(2 * Math.PI * t / 45); const pz = p0[2] - fwd; r.setCameraLookAt(p0[0], p0[1], pz, p0[0] + Math.sin(yaw), p0[1] - 0.1, pz - Math.cos(yaw)); r.camera.rotateLocal(0, 0, roll); };
  const FLIP = 12;
  const flip = (k) => look(15 * Math.min(k, FLIP));                    // 180 deg in 12 frames, then still
  const hover = (k) => look(0.045 * Math.sin(2 * Math.PI * k / 40));   // 0.5 px at 1280 px across 115 deg

  // one arm on one path: settle at pose 0, then one frame per pose 1..frames; the luma frames, and the RGBA of the frames in `keepAt`
  const run = async (arm, pose, frames, keepAt = []) => {
    window.__progress = 'run ' + arm + ' ' + frames + ' frames ' + (window.__what || '');
    await useArm(arm); pose(0); await settle(arm === 'A' || arm === 'AN' || arm === 'V' ? 30 : 10); await stable();
    const fr = [], kept = {};
    for (let k = 1; k <= frames; k++) { pose(k); const sn = await snap(keepAt.includes(k)); fr.push(sn.l); if (sn.rgba) kept[k] = sn.rgba; }
    return { fr, kept };
  };
  const vs = (S, X) => { const p = X.map((f, i) => psnr(S[i], f)), q = X.map((f, i) => ssim(S[i], f)); return { psnrMean: r2(mean(p)), psnrMin: r2(Math.min(...p)), ssimMean: r3(mean(q)), ssimMin: r3(Math.min(...q)), below20: r3(p.filter((x) => x < 20).length / p.length) }; };

  const out = { size: [W, H], budgetM: r.splatBudgetMillions, impl0: r.stochasticImpl, timingsMs: {} };
  const t0 = performance.now(); const lap = (k) => { out.timingsMs[k] = Math.round(performance.now() - t0); };
  out.stable = await stable(); out.sceneComplete = r.sceneComplete;
  const lodDrawn = () => { const l = h.lod ? h.lod() : null; return l ? Math.round(l.drawn / 1e5) / 10 : null; };
  const pics = [];

  // ================= Q1 still convergence, four views
  if (O.modes.includes('q1')) {
    out.q1 = [];
    const COUNTS = [1, 2, 4, 8, 16, 32, 64, 128, 256];
    for (const yaw of [0, 90, 180, 270]) {
      look(yaw); await useArm('S'); await settle(10); await stable(); out.drawnM = lodDrawn();
      const S1 = await snap(true); const S2 = await snap(false);
      const row = { yaw, drawnM: lodDrawn(), SvS: score(S1.l, S2.l) };
      await useArm('E'); await settle(4); const E1 = await snap(true);
      row.E = { ...score(S1.l, E1.l), shift: E1.m.map((v, i) => r2(v - S1.m[i])) };
      await useArm('A0'); resetHistory(); const a0 = await seq(64, [1, 64], yaw === 0 ? [1] : []); row.A0 = { f1: score(S1.l, a0[1].l), f64: score(S1.l, a0[64].l) };
      await useArm('A'); resetHistory();
      const keepAt = yaw === 0 ? [1, 16, 256] : yaw === 180 ? [256] : [];
      const a = await seq(256, COUNTS, keepAt);
      row.A = {}; for (const f of COUNTS) row.A[f] = score(S1.l, a[f].l);
      row.shift256 = a[256].m.map((v, i) => r2(v - S1.m[i]));
      row.framesTo30dB = COUNTS.find((f) => row.A[f].psnr >= 30) ?? null;
      out.q1.push(row);
      if (O.pics && (yaw === 0 || yaw === 180)) {
        const w = worstTile(S1.l, E1.l);
        pics.push({ name: 'q1-yaw' + yaw + '-S', b64: await crop(S1.rgba, w.x, w.y) }, { name: 'q1-yaw' + yaw + '-E', b64: await crop(E1.rgba, w.x, w.y) });
        for (const f of keepAt) pics.push({ name: 'q1-yaw' + yaw + '-A' + f, b64: await crop(a[f].rgba, w.x, w.y) });
        if (yaw === 0) pics.push({ name: 'q1-yaw0-A0', b64: await crop(a0[1].rgba, w.x, w.y) });
        if (yaw === 0) pics.push({ name: 'q1-yaw0-S-full', b64: await jpg(S1.rgba), jpg: true }, { name: 'q1-yaw0-A256-full', b64: await jpg(a[256].rgba), jpg: true }, { name: 'q1-yaw0-E-full', b64: await jpg(E1.rgba), jpg: true });
      }
    }
    lap('q1');
  }

  // ================= Q2 cruise, Q3 FPV-agile (and at the 30 Hz step), Q5 hover: S then the other arms on the same poses
  const motion = async (pose, frames, arms, picAt, withTstd) => {
    const S = await run('S', pose, frames, picAt ? [picAt] : []);
    const res = { frames, S: { flicker: r2(flick(S.fr)) } };
    if (withTstd) res.S.tstd = r2(tstd(S.fr));
    const kept = { S: S.kept };
    for (const arm of arms) {
      const X = await run(arm, pose, frames, picAt ? [picAt] : []);
      const f = flick(X.fr);
      res[arm] = { ...vs(S.fr, X.fr), flicker: r2(f), flickerExcessPct: r2((f - flick(S.fr)) / flick(S.fr) * 100) };
      if (withTstd) res[arm].tstd = r2(tstd(X.fr));
      kept[arm] = X.kept;
    }
    const tiles = {};
    if (picAt && O.pics) {
      const w = worstTile(lumaOf(kept.S[picAt]), lumaOf(kept[arms.includes('A') ? 'A' : arms[0]][picAt]));
      for (const n of ['S', ...arms]) tiles[n] = await crop(kept[n][picAt], w.x, w.y);
    }
    return { res, tiles };
  };
  if (O.modes.includes('q2')) {
    const m = await motion(cruise, O.frames, ['E', 'A', 'A0'], O.pics ? 24 : 0, false);
    out.q2 = m.res; for (const [n, b] of Object.entries(m.tiles)) pics.push({ name: 'q2-k24-' + n, b64: b });
    lap('q2');
  }
  if (O.modes.includes('q3')) {
    out.q3 = {};
    for (const sc of [1, 2]) {
      const m = await motion(agile(sc), 90, ['E', 'A', 'AN'], O.pics && sc === 1 ? 40 : 0, false);
      out.q3['step' + sc] = m.res; for (const [n, b] of Object.entries(m.tiles)) pics.push({ name: 'q3-s' + sc + '-k40-' + n, b64: b });
    }
    lap('q3');
  }
  if (O.modes.includes('q5')) { out.q5 = (await motion(hover, 90, ['E', 'A'], 0, true)).res; lap('q5'); }

  // ================= Q4 flip and stop
  if (O.modes.includes('q4')) {
    const AFTER = 64, TOT = FLIP + AFTER, KEEP = [FLIP + 1, FLIP + 4, FLIP + 16];
    // frame t (1-based) has pose flip(t); frame FLIP is the arrival at the final pose, FLIP + j the j-th frame after it
    const S = await run('S', flip, TOT, KEEP);
    const S2 = await run('S', flip, TOT);
    const q4 = { flipFrames: FLIP, afterFrames: AFTER, floor: { j1Psnr: r2(psnr(S.fr[FLIP], S2.fr[FLIP])), ghost48: r3(mean([1, 2, 3, 4].map((j) => ghost(S.fr[FLIP + j - 1], S2.fr[FLIP + j - 1], 48)))) } };
    let w = null; const tiles = {};
    for (const arm of ['E', 'A', 'AN']) {
      const X = await run(arm, flip, TOT, KEEP);
      const psn = (t) => r2(psnr(X.fr[t - 1], S.fr[t - 1]));
      const after = {}; for (const j of [1, 2, 4, 8, 16, 32, 64]) after[j] = psn(FLIP + j);
      // lag index while the view turns: PSNR(X_t, S_t) - PSNR(X_t, S_t-k), negative when the frame is closer to an older view (smear)
      const lag = { k1: [], k2: [] };
      for (let t = 3; t <= FLIP; t++) for (const k of [1, 2]) lag['k' + k].push(r2(psnr(X.fr[t - 1], S.fr[t - 1]) - psnr(X.fr[t - 1], S.fr[t - 1 - k])));
      // after the stop: closer to the final view than to the view two frames before the stop? (negative: a smear of the old view)
      const lead = {}; for (const j of [1, 2, 3, 4, 8]) lead[j] = r2(psnr(X.fr[FLIP + j - 1], S.fr[FLIP + j - 1]) - psnr(X.fr[FLIP + j - 1], S.fr[FLIP - 3]));
      const ghostAt = (th) => r3(mean([1, 2, 3, 4].map((j) => ghost(X.fr[FLIP + j - 1], S.fr[FLIP + j - 1], th))));
      let to30 = null, to33 = null;
      for (let j = 1; j <= AFTER; j++) { const p = psn(FLIP + j); if (to30 === null && p >= 30) to30 = j; if (to33 === null && p >= 33) to33 = j; }
      q4[arm] = { after, lag: { k1min: Math.min(...lag.k1), k2min: Math.min(...lag.k2), k1: lag.k1, k2: lag.k2 }, lead, ghost48: ghostAt(48), ghost30: ghostAt(30), framesTo30dB: to30, framesTo33dB: to33 };
      if (O.pics) {
        const t = FLIP + 4;
        if (arm === 'E') w = worstTile(lumaOf(S.kept[t]), lumaOf(X.kept[t]));
        if (arm === 'A') w = worstTile(lumaOf(S.kept[t]), lumaOf(X.kept[t]));
        tiles[arm] = await crop(X.kept[t], w.x, w.y);
        if (arm === 'AN') { tiles.S = await crop(S.kept[t], w.x, w.y); }
      }
    }
    for (const [n, b] of Object.entries(tiles)) pics.push({ name: 'q4-j4-' + n, b64: b });
    out.q4 = q4; lap('q4');
  }

  // ================= tune: one knob set of the accumulation at a time (O.variants: upstream's `key:value,...` strings, '' = its defaults)
  // scored on the three moving paths of the FPV use (cruise, agile at the 60 Hz and the 30 Hz step, the flip and stop), never on the still picture
  if (O.modes.includes('tune')) {
    const AFTER = 64, TOT = FLIP + AFTER;
    const Scr = (await run('S', cruise, O.frames)).fr, Sa1 = (await run('S', agile(1), 90)).fr, Sa2 = (await run('S', agile(2), 90)).fr, Sfl = (await run('S', flip, TOT)).fr;
    out.tune = [];
    for (const v of O.variants) {
      variantOf.V = v; window.__what = 'tune ' + (v || 'default');
      const row = { variant: v };
      const c = await run('V', cruise, O.frames); row.cruise = vs(Scr, c.fr); row.cruise.flickerExcessPct = r2((flick(c.fr) - flick(Scr)) / flick(Scr) * 100);
      const a1 = await run('V', agile(1), 90); row.agile1 = vs(Sa1, a1.fr);
      const a2 = await run('V', agile(2), 90); row.agile2 = vs(Sa2, a2.fr);
      const f = await run('V', flip, TOT);
      const psn = (t) => r2(psnr(f.fr[t - 1], Sfl[t - 1]));
      row.flip = { j1: psn(FLIP + 1), j4: psn(FLIP + 4), j16: psn(FLIP + 16), j64: psn(FLIP + 64), ghost48: r3(mean([1, 2, 3, 4].map((j) => ghost(f.fr[FLIP + j - 1], Sfl[FLIP + j - 1], 48)))), lead2: r2(psnr(f.fr[FLIP + 1], Sfl[FLIP + 1]) - psnr(f.fr[FLIP + 1], Sfl[FLIP - 3])), lagMin: Math.min(...Array.from({ length: FLIP - 2 }, (_, i) => { const t = i + 3; return r2(psnr(f.fr[t - 1], Sfl[t - 1]) - psnr(f.fr[t - 1], Sfl[t - 2])); })) };
      out.tune.push(row);
    }
    lap('tune');
  }

  // ================= K1 colour: at 256 frames per tone map, and the control (a wrong output transform)
  if (O.modes.includes('k1')) {
    out.k1 = {}; look(0);
    for (const tm of ['linear', 'neutral', 'aces']) {
      r.setToneMapping(tm); await useArm('S'); await settle(10); await stable(); const S1 = await snap(false);
      await useArm('A'); resetHistory(); const a = await seq(256, [256]);
      out.k1[tm] = { shift: a[256].m.map((v, i) => r2(v - S1.m[i])), ...score(S1.l, a[256].l) };
    }
    // control: S under linear, A drawn under another tone map = the compose's output transform differs from the sorted picture's
    r.setToneMapping('linear'); await useArm('S'); await settle(10); await stable(); const SL = await snap(false);
    await useArm('A'); r.setToneMapping('aces'); resetHistory(); const wrong = await seq(256, [256]);
    out.k1.controlWrongTransform = { shift: wrong[256].m.map((v, i) => r2(v - SL.m[i])), ...score(SL.l, wrong[256].l) };
    r.camera.camera.toneMapping = tm0; lap('k1');
  }

  // ================= K2 composition: a mesh at several depths, the background, the scene scale
  if (O.modes.includes('k2')) {
    out.k2 = {}; look(0);
    const winPsnr = (S, X, half) => { const cx = W / 2, cy = H / 2; let e = 0, n = 0; for (let y = cy - half; y < cy + half; y++) for (let x = cx - half; x < cx + half; x++) { const d = S[y * W + x] - X[y * W + x]; e += d * d; n++; } e /= n; return r2(e === 0 ? 99 : 10 * Math.log10(255 * 255 / e)); };
    const compare = async (frames) => { await useArm('S'); await settle(6); const S1 = await snap(false); await useArm('A'); resetHistory(); const a = await seq(frames, [frames]); return { S: S1.l, A: a[frames].l }; };
    const none = await compare(128); out.k2.noBox = { window: winPsnr(none.S, none.A, 90), whole: r2(psnr(none.S, none.A)) };
    out.k2.boxes = [];
    for (const dist of [0.6, 1.2, 2.5, 5, 9]) {
      const e = r.addBox(0.4, 0.4, 0.4, [1, 0.1, 0.1]); e.setPosition(p0[0], p0[1] - 0.1 * dist, p0[2] - dist);
      const c = await compare(128);
      out.k2.boxes.push({ dist, window: winPsnr(c.S, c.A, 90), whole: r2(psnr(c.S, c.A)) });
      e.destroy();
    }
    r.setBackground([0.2, 0.45, 0.9]); const bg = await compare(128); out.k2.background = score(bg.S, bg.A); r.setBackground([0, 0, 0]);
    out.k2.scale = {};
    for (const sc of [0.25, 100]) {
      r.setSceneTransform(sc, [0, 0, 0]); look(0); await useArm('S'); await settle(12); await stable(); await settle(10);
      const c = await compare(128);
      out.k2.scale[sc] = { ...score(c.S, c.A), activeSplatsM: r2((ACC() ? ACC().activeSplats : 0) / 1e6) };
      r.setSceneTransform(1, [0, 0, 0]); await settle(6);
    }
    lap('k2');
  }

  out.pics = pics;
  out.accumStats = r.accumStats();
  out.gpuErrors = window.__gpuErrors || [];
  await useArm('S');
  return out;
}
