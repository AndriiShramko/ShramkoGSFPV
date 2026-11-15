# Lane fix3a (train 3): two findings of integration A

Worktree C:/dev/gsfpv-rooms, branch fix3a from origin/main ca5760fd. Submodule packages/sonic-fpv at 598a98f9.
Logs and JSON of the runs: U:/Temp/gsfpv-train3/fix3a/. Evidence for git: evidence/2026-11-15/fix3a/.

## Status

Stage X1-walls-store
- [x] release build of ca5760fd (dist without any dist/walls folder), server 5780 (5c1ef83e)
- [x] probe tools/bench/scripts/walls-store-probe.mjs: build by the page's own action (default: the walls box
      button; --start shiftg, --start url), reload, fresh tab; --reload-at in-use reloads at the first look that sees
      the walls in use (the integrator's way) (5c1ef83e)
- [x] measure: Tunis (has shipped walls, nothing to store), Wroclaw button, Wroclaw Shift+G with reload at in-use
- [x] cause (below, measured in part)
- [x] fix: apps/fly/src/wallcache.ts keepBuilt (key made again when missing, result ok/key/ms/bytes/error);
      apps/fly/src/walls.ts startKeep before queue() in runBase and runRefine, showKeep after endProgress (line
      adds bake.keeping when the write runs past 2 s, the owner's rule, and bake.notKept when it fails; mode 'off'
      keeps nothing and says nothing, as before); hook w.storing, w.lastStore; keys bake.keeping and bake.notKept in
      en, es, pl, ru. Unit test tools/bench/test/walls.test.ts (4 new, 23 passed); negative control with
      origin/main wallcache.ts: 3 failed by AssertionError; tsc apps/fly exit 0.
- [x] probe records w.storing and w.lastStore; exit 0 also needs the build's write ok and either at most 2 s
      (KEEP_NOTE_S, the owner's rule, not a measurement) or the line said "Keeping them in this browser" (0f27d294)
- [x] proof on Wroclaw 70b50d42, release build of 07cc5d41, server 5780, no dist/walls, both exit 0:
      button (evidence/2026-11-15/fix3a/walls-store-70b50d42-button-fixed.json): built 63 s, in use 74.3 s, store
      write 645 ms, 58294590 bytes, row there 74.8 s; reload: cache, bakes 0, in use 4.3 s after open; fresh tab:
      cache, bakes 0, 4.6 s. Shift+G with reload at in-use (...-shiftg-fixed.json): built 69 s, in use 81.4 s, write
      343 ms; reload cache 4.3 s, fresh tab cache 4.8 s, bakes 0. Both writes under 2 s, so the keeping note did not
      show (correct). gates.py --only vitest,architecture,i18n,b18: all PASS (vitest 162 s).
- Negative control of the probe on the old build: not run (budget). The old-build runs of the first pass passed
  too on a quiet PC; the probe's new 'kept' check fails on origin/main only because w.lastStore does not exist there.
- Seen, not fixed: at the in-use look the write was still running in both runs (storing true, rows 0): queue()
  swaps at once when the craft is parked, so the window is the write time itself (0.3 to 0.65 s measured). A reload
  inside that window may still lose the walls; the reload of the shiftg run came in that window and still found
  them (IndexedDB finished the transaction). A guess, not reproduced.
- Bake time was 63 to 69 s here against 156 s in the first pass (a lighter way, line "rough"; the machine's saved
  bake speed changes the plan). Not examined.

Stage X2-gate-one (gate 1 not in sight on Tunis seed 1)
- [x] release build of 8fe8bba2 (1930 files); 'before' run of the check 'A look (link seed 1)' alone (new LOOK_ONLY=1 of
      tools/bench/src/tracks-page.ts): FAIL, paint on next 0 later 10 arrow 208, off: later 8 arrow 208 (24 gates, drawn
      78) (evidence/2026-11-15/fix3a/tracks-look-before.json)
- [x] Node measurement tools/bench/src/gate-one-audit.ts (spawn as session findSpawn, course as the worker asks it,
      seeds 1-5, nine published walls + Tunis): table under '## Gate 1 from the spawn' (40 courses on 8 scans; 2 scans
      not measured, reasons there)
- [x] guide to the next gate: apps/fly/src/course/guide.ts (aimOf, placeGuide; GUIDE_NEAR_M 12, GUIDE_FRAME_SHARE 0.85,
      GUIDE_MARGIN_PX 10 are design choices, not measurements), course/hud.ts guide() and hud.css .course-guide,
      app/builtin/course.ts frame() feeds it the drawn camera, hook course.guide(); key course.hud.guide in en, es, pl, ru.
      Unit test tools/bench/test/course-guide.test.ts 8 passed; negative control (guide.ts absent on origin/main): NEG OK,
      it fails by the missing module, not by an assertion. tsc apps/fly: no errors.
- [x] browser proof, release of a58510dd, server 5781, dist/walls = U:/Temp/gsfpv-train3/walls/release (Wroclaw on its
      published walls), probe tools/bench/scripts/gate-guide-probe.mjs under the GPU lock (one hold per run):
      Tunis link seed 1 (ev U:/Temp/gsfpv-train3/fix3a/ev/gate-guide-tunis.json): 18 of 19 passed. Start: guide "Gate 1 -
      17 m" on the right with the turn mark, probe bearing 91.7 deg from the camera pose (behind right), metres within 1 m,
      clear of note and lap block, aria-hidden true; behind (turned to 150 deg): passed; Escape: clear of the pause menu;
      844x390: inside the screen and clear. Failed: 'near' check, the guide DID hide (shown false, in frame, 6 m) but the
      probe's turn reached only 32 deg, over the check's 20 deg.
      Wroclaw 70b50d42 Shift+G (ev .../gate-guide-wroclaw.json, run 3): 18 of 19; course in 10 s; start guide "Gate 1 -
      10 m" left with the turn mark, matches the bearing; the same 'near' failure: here writing the sim's yaw did not turn
      the drawn camera at all (24 yaws, one bearing), so 'behind' passed only because the start was behind already.
      Pictures looked at: fix3a-gate1-tunis.png (Tunis start), fix3a-gate1-wroclaw.png (Wroclaw start), 844 (Tunis run).
      fix3a-gate1-behind.png and fix3a-gate1-844.png in U:/Temp/gsfpv-train3/shots are now the Wroclaw run's (overwritten).
- [x] tracks-page 'A look (link seed 1)': passes on paint OR the guide naming gate 1 on the side of the bearing computed
      from the camera pose and gate 1's place. Before (8fe8bba2): FAIL; after (a58510dd): PASS, painted false, guide shown,
      gate 0, side right, bearing 91.7 (evidence/2026-11-15/fix3a/tracks-look-after.json). The guide's lime arrow counts
      as 'next' paint (100 px here, under MIN_PX 200, so it cannot pass the paint branch alone). 'E camera after Tab' left
      as it is (old editor, lane editor3 replaces it).
- [x] a6-reference 1 passed; gates.py --only vitest,architecture,i18n,b18: all PASS (vitest 121 s); tsc apps/fly and
      tools/bench: 0 errors.
Pass 2 of X2:
- [x] cause of the turn that did not turn, measured (r.camMode in both runs): cameraOverride false, editor closed,
      session.cameraAim returns an aim (play.ts, the stabilised gimbal along the pilot's aim: Wroclaw yawDeg 93.2, Tunis
      90.0, pitch 0), so the drawn yaw comes from that aim, not from s[6..9]. The probe now turns the aim's yaw when an aim
      draws the camera (sim.s otherwise) and checks every turn itself (within 10 deg of the wanted bearing).
- [x] re-run, release of a58510dd (no product change since), server 5781, one GPU hold per run, Wroclaw first, Tunis last:
      Wroclaw 70b50d42 Shift+G: 22 of 22 passed, 49 s, course in 14 s; start "Gate 1 - 17 m", bearing 19.4 deg (in the
      frame, shown because farther than 12 m); turns reached 150.0 and 0.0 deg; behind 150 deg passed with the turn mark;
      near 6.0 m, 0.0 deg: guide hidden. Tunis 887f27aa link seed 1: 22 of 22, 43 s; start bearing 91.7, "Gate 1 - 17 m";
      turns reached 149.8, 149.8, 0.1 deg; near 6.0 m: hidden; Escape clear of the pause menu; 844x390 inside and clear.
      Ev U:/Temp/gsfpv-train3/fix3a/ev/gate-guide-wroclaw.json and gate-guide-tunis.json. Pictures looked at:
      fix3a-gate1-wroclaw.png (gate 1 ahead with the label over it), fix3a-gate1-behind.png and fix3a-gate1-844.png (Tunis,
      arrow on the right edge with the turn mark), fix3a-gate1-tunis-near.png (gate ahead, no guide).
- [x] gate-one-audit reads the newest walls version and its settings (sceneSettings(id, version), tools/bench/src/scenes.ts);
      ab5efa0e (v2) and eb5f51dc measured (the earlier eb5f51dc failure was the network: the same URL answers 200 now).
      Commit cd1b49a6.
- [x] tsc tools/bench 0 errors; gates.py --only vitest,architecture,i18n,b18 on cd1b49a6: all PASS (vitest 177 s). No
      product code changed in pass 2, so a6-reference and the apps/fly typecheck were not run again (passed in pass 1).
Stage X2 is done; nothing is left of it.

Stage X3-start-near-spawn (closed ring starts at the gate nearest the spawn)
- [x] measure first (gate-one-audit.ts now writes x3: which side of a gate the spawn is on and the straight fly-in to it):
      on 32 of 33 closed rings the nearest gate is not gate 1; flying in to the nearest gate along its axis is shorter than
      to gate 1 on 27 of 32 (straight line, walls not counted). My guess that the nearest gate is mostly the last one with
      the spawn on its exit side was wrong: exit side on 20 of 32. Rows U:/Temp/gsfpv-train3/fix3a/gate-one-audit-x3.json.
- [x] packages/tracks/src/generate.ts startNearSpawn: a closed course (laps > 1) is turned to start at the gate nearest
      opts.spawn (new CourseOptions.spawn, the session's spawn sent by apps/fly/src/course/worker.ts; without it the start
      cell's centre); kept only when the turned ring passes the whole-course proof (checkTrack), else the generator's order.
      Open courses, saved, served and edited courses and the key-N course are not touched (only generateCourse calls it).
- [x] unit test packages/tracks/test/start-near-spawn.test.ts (4): pure turn keeps the set, the successors (direction) and
      renumbers g1..; no proof or gate 1 already nearest keeps the order; three-room world seeds 1-6: on every ring gate 1
      is nearest and proven; a spawn beside gate k turns the ring (at least one) with the same set and direction.
      The 'another spawn' test uses three-room seeds 1, 2, 3, 15, 18: on seeds 1-6 no turn passes the proof; a search over
      seeds 1-40 (scratch script, removed) found proven turns on seeds 15 and 18 only.
      Negative control (origin/main generate.ts): NEG OK, pure tests by TypeError (no function), the 'another spawn' test
      by AssertionError (expected 0 to be greater than 0).
- [x] course3's 20-seed audit again (its f3/run.sh audit6 at 5a62e855, the last packages/tracks change on main; runner
      U:/Temp/gsfpv-train3/fix3a/run-cq.sh, rows U:/Temp/gsfpv-train3/fix3a/cq/): Wroclaw, Tunis, eb5f51dc, 0230d903, 20
      rows each, 0 rows differ in seed, gates, farM, reachM, visited, inBand and the heights as a set; summaries the same
      (gates mean/sd 24/0, 23.5/2.2, 23.5/1.8, 24/0; visited 0.113, 0.329, 0.28, 0.084; reach 111, 97, 76, 103 m; K1.1
      failing 0 of 20 at 3 and 12 m/s on all four). meanMs higher (3205 against 1877 on Wroclaw) and freeMs too, which my
      change does not touch: the machine was loaded (tests ran at the same time).
- [x] tsc packages/tracks, apps/fly, tools/bench: 0 errors; tracks tests 112 + 4 passed; a6-reference 1 passed (the
      generator is not flight code; run anyway). apps/api: no fixture regenerated, no test asked for it (packages/tracks
      fixtures.test passed with the new generator).
- [x] gates.py --only vitest,architecture,i18n,b18 on 274f7139: all PASS (vitest 110 s)
- [x] browser proof (pass 2): release build of 43068c50 (1930 files, sha256 43ebbe94...), dist/walls = the nine published
      walls of U:/Temp/gsfpv-train3/walls/release (as integration A ran it), server 5782, runner
      U:/Temp/gsfpv-train3/fix3a/x3/run.sh (one GPU hold per course-path run; sonic-int-review and tracks-page take the lock
      themselves), summary U:/Temp/gsfpv-train3/fix3a/x3/summary.txt:
      course-path-probe Wroclaw 70b50d42 (Shift+G): exit 0, course in 5.6 s, 24 gates, 'Lap 1 of 3' (a ring), maxSilentS 2.1,
      no long task; Tunis 887f27aa: exit 0, course in 8.0 s, 24 gates, 'Lap 1 of 1' (open), maxSilentS 2.6, no long task
      (evidence/2026-11-15/fix3a/x3-course-path-70b50d42.json, -887f27aa.json; the seeds are random per run).
      sonic-int-review r9: exit 0, 11 of 11 in 188 s (evidence/2026-11-15/fix3a/x3-sonic-int-review-r9.json).
      tracks-page: exit 0, 46 of 46 (evidence/2026-11-15/fix3a/x3-tracks-page.json); integration A had 44 of 46 (A look and
      E camera failed), X2 made A look pass; E camera passed in this run too. No check that passed before fails.
      The runner waited about 38 minutes for the GPU lock (other lanes). Server stopped, lock released.

Table (b), straight distance spawn -> gate 1 in m, before / after, seeds 1-5 (gate-one-audit x3 and x3-after): the same
on every row except 0230d903 seed 2: 18.2 / 5.6. All other rows are as in '## Gate 1 from the spawn' below.

What the owner does: nothing new to press. On a generated course that is a closed loop, when the loop can start at the
gate next to where he appears and still be flown through every gate the right way, gate 1 is that gate; otherwise gate 1
stays where it was and the arrow at the screen's edge (stage X2) shows him the way to it with its distance.

Not verified: the turned ring of 0230d903 seed 2 was not flown in a page (the browser runs above took random seeds on
Wroclaw and Tunis; Tunis gave an open course, and whether the Wroclaw run's random-seed ring was turned is not recorded). Gates were run on
274f7139; after it only docs/wip/fix3a.md changed, so they were not run again.
Stage X3 is done.
Decision for the lead: with the gates' places AND their facing kept, the turn is provable on 1 of 33 rings of the 10
scans (cause above). Turning more rings needs the new gate 1 and the old gate 1 re-aimed along their new legs in (yaw
only, places kept): that changes the gates, which the stage forbids, so it is not done.
- [x] after-run of gate-one-audit (U:/Temp/gsfpv-train3/fix3a/gate-one-audit-x3-after.json): 50 courses, gates, nearest
      and ring/open the same on all 50; turned 1 of 33 rings (0230d903 seed 2: gate 1 18.2 -> 5.6 m). Cause measured
      (three-room world, every turn of seeds 1-6 tried with checkTrack): each gate's axis is laid within 35 deg of ITS leg in;
      turning the ring gives the new gate 1 a leg in from the start and the old gate 1 a leg in from the old last gate, so
      both fail 'axis off the leg in' (40-110 deg measured) on almost every turn. Ring generation time 18.0 s -> 17.2 s
      summed over 33 rings (no measurable cost).

Stage fixes (review FX-1 to FX-5)
- [x] FX-1 stands (read walls.ts: startKeep only reached `await cacheP`, queue() swapped synchronously, so the write
      began after in-use as on origin/main; my X1 'cause' described no change). Fix: wallcache.ts keepThenUse; runBase and
      runRefine wait for the store write before queue() (note line bake.keeping meanwhile), at most KEEP_WAIT_MS 5000 (a
      design choice, not a measurement; measured writes 0.34 and 0.65 s), then the walls go in anyway (92b4394f).
- [x] FX-2 stands (WallCache.open falls back to MemKv; keepBuilt said ok). Fix: put reports memory, keepBuilt returns
      ok false error 'memory', the line says bake.notKept (92b4394f).
- [x] FX-3 stands (showKeep returned when another line held the box). Fix: wallcache.ts keptLine: not kept is said on
      the done line, after any other line, or alone in an empty box, and always spoken (92b4394f).
- [x] FX-4 stands by reading (measureAvoid had no .bake-box; .bake-box is a child of #ui like the guide). Fix: course/hud.ts
      adds the box to the avoid list and watches it in the MutationObserver (92b4394f). No unit test (needs a DOM).
- [x] FX-5 stands, but the suggested fix would not work: bestKey reads tr.version (always 1), not generator.version, and
      the server refuses unknown params keys (apps/api/tracks.py PARAM_KEYS), so params.startShift cannot be saved. Fix:
      generate.ts generatorVersion writes '<v>.s<shift>' for a turned ring (server: free string up to 40); link.ts bestKey
      adds 's<shift>' before the drone only then, so unturned courses keep their best keys (92b4394f).
- [x] tests: walls.test.ts 4 new, tracks-review TR-10 extended, start-near-spawn version checks: 66 + 4 passed;
      negative controls (neg_control.py, ref 92b4394f~1): walls NEG OK (AssertionError), link.ts NEG OK (1 failed,
      AssertionError), generate.ts NEG OK (1 failed, AssertionError). tsc apps/fly and packages/tracks: no errors.
- [x] release build of 92b4394f (1930 files, no dist/walls); runner U:/Temp/gsfpv-train3/fix3a/fx/run.sh, server 5784.
      gates.py --only vitest,architecture,i18n,b18 on 92b4394f: all PASS (vitest 110 s).
- [x] walls-store-probe Wroclaw 70b50d42, button, reload at in-use (the integrator's way), under the GPU lock, gates
      running beside it (load): exit 0 in 302 s; kept true, cached true; reload ready 2.7 s, fresh page ready 2.6 s
      (U:/Temp/gsfpv-train3/fix3a/fx/ev/walls-store-70b50d42-inuse.json; the build took about 4.5 min, step 2 'longer
      than usual'). Read out of the JSON (pass 2): runs[0].atInUse.lastStore = ok true, ms 225.1, bytes 58294590,
      storing false at the in-use look: the write had ended before the walls went in use (FX-1 order, as built).
- [~] walls-store-probe Tunis 887f27aa: the pass-1 run (fx/store-tunis.log) waited 480 s at state none, source shipped,
      then 'Target crashed': Tunis has shipped walls, nothing is built or stored. Pass 2: the probe records r.shipped and
      passes such a scan when all three opens keep source shipped with no bakes and no store write (no 480 s wait).
      Runner U:/Temp/gsfpv-train3/fix3a/fx2/run.sh, server 5785, release of 92b4394f (no product change since). Run: exit 0,
      209 s held; build, reload and fresh page all source shipped, bakes 0, no lastStore (shipped true, shippedOk true;
      U:/Temp/gsfpv-train3/fix3a/fx2/ev/walls-store-887f27aa.json). This scan does not exercise the store path.
- [~] FX-4 in a browser: gate-guide-probe --above (camera pitched down 80 deg at the start yaw, gate 1 above the view, guide
      at the top edge) on Wroclaw without dist/walls, Shift+G (walls-first start); the rects check now includes the walls
      box (#ui > .bake-box). Run 1 (fx2/guide-wroclaw.log): no course within 400 s (the vitest gate ran beside it; the
      probe logged nothing while it waited). The probe now says the walls and course state every 30 s (--wait-s); runs 2-4
      by fx2/run-guide.sh, server 5786, release of 92b4394f, one GPU hold each. Run 2 (156 s held): 9 of 9, but gate 1 was
      at -87 deg so the guide stood at the left edge (guide-wroclaw2-left.log): top centre not exercised. Run 3 (330 s,
      walls built in 298 s): turned to the gate, pitched -80: the gate (4 m above the camera) fell behind the camera plane,
      guide on the behind side, 9 of 10 (guide-wroclaw2-p80.log). Run 4 (201 s, walls 164 s; probe now turns to gate 1, then
      pitches -45): 'above' checks pass: walls box up with its done line "Walls built in 164 s ... Now the course is being
      built" (box 320-960 x 86-144 px), guide at the top centre (584-697 x 10-38), they do not meet. Its 3 failures are the
      start look: gate 1 of that seed was 6.4 m away and in view, so the guide hid by design (GUIDE_NEAR_M 12); the probe's
      start check assumes a far gate 1. Evidence U:/Temp/gsfpv-train3/fix3a/fx2/ev/gate-guide-wroclaw-walls-first.json.
      Not proven: at 1280x800 the top-edge guide (bottom 38 px) is above the walls box (top 86 px) without any avoiding, so
      this layout does not exercise the FX-4 code; a negative control (old hud.ts) was not run.
- [x] tracks-page after FX-4 and FX-5 (release of 92b4394f, its own servers and lock): exit 0, 46 of 46 passed in 493 s;
      'A look (link seed 1)': painted false, guide shown for gate 1, side right, behind, bearing 91.7 deg
      (evidence/2026-11-15/fix3a-fx/tracks-page.json).
- [x] gates.py --only vitest,architecture,i18n,b18 on 57244213: all PASS (vitest 147 s).

## Gate 1 from the spawn

Measured by tools/bench/src/gate-one-audit.ts (Node, log U:/Temp/gsfpv-train3/fix3a/gate-one-audit.log, rows
U:/Temp/gsfpv-train3/fix3a/gate-one-audit.json): spawn from the scan's settings camera (findSpawn), course by fitCourse
as the worker asks it, seeds 1-5; in view = gate 1 inside the frustum of the spawn camera (115 deg horizontal, 20 deg
uptilt, 1280x800, the prefs fallbacks; a preset may differ). Distances in m. ab5efa0e (walls and settings v2) and
eb5f51dc were measured in pass 2 (log gate-one-audit-2.log, rows gate-one-audit-2.json in the same folder).

| scan | seed: gates, to gate 1 m, nearest m (gate), gate 1 in spawn view, ring/open |
|---|---|
| 0230d903 | 1: 24, 18.2, 7.6 (g24), not in view, ring; 2: 24, 18.2, 5.6 (g24), not in view, ring; 3: 24, 22.3, 7.6 (g24), not in view, ring; 4: 24, 8.5, 8.5 (g1), in view, open; 5: 24, 20.5, 11.9 (g24), not in view, ring |
| 1994c65c | 1: 24, 13.2, 3.4 (g24), not in view, ring; 2: 24, 18.8, 3.4 (g24), not in view, ring; 3: 24, 20.4, 4.3 (g24), not in view, ring; 4: 24, 18.6, 3.7 (g24), in view, ring; 5: 24, 17.1, 6.1 (g24), in view, ring |
| 2f1ddf5f | 1: 16, 43.3, 41.1 (g9), not in view, ring; 2: 14, 44.2, 41.4 (g11), not in view, ring; 3: 16, 44.2, 41.3 (g10), not in view, ring; 4: 16, 44.4, 41.9 (g3), not in view, ring; 5: 16, 43.3, 41.7 (g3), not in view, ring |
| 70b50d42 | 1: 24, 9.5, 3.5 (g24), not in view, ring; 2: 24, 10.3, 7.7 (g12), not in view, ring; 3: 24, 11, 3.5 (g24), not in view, ring; 4: 24, 18.8, 7 (g13), not in view, ring; 5: 24, 17.5, 10.2 (g10), in view, ring |
| 9baef54b | 1: 24, 16, 4.1 (g22), in view, ring; 2: 24, 18.3, 6.6 (g23), in view, ring; 3: 24, 11.8, 11.8 (g1), not in view, open; 4: 24, 21, 20.3 (g2), in view, open; 5: 24, 17.2, 6.6 (g23), in view, ring |
| ab5efa0e | 1: 10, 5.6, 4.1 (g8), in view, ring; 2: 10, 5.6, 4.8 (g7), in view, ring; 3: 10, 5.8, 4.1 (g8), in view, ring; 4: 10, 6, 4.9 (g7), in view, ring; 5: 10, 5.4, 4.1 (g8), in view, ring |
| ba7aa29d | 1: 5, 11.1, 11.1 (g1), in view, ring; 2: 17, 22.6, 22.6 (g1), in view, open; 3: 19, 24.2, 11.1 (g19), in view, open; 4: 24, 13, 13 (g1), in view, open; 5: 18, 13, 13 (g1), in view, open |
| d10c5638 | 1: 4, 13.4, 13.4 (g1), in view, open; 2: 5, 13.4, 13.4 (g1), in view, open; 3: 4, 13.4, 13.4 (g1), in view, open; 4: 4, 13.4, 13.4 (g1), in view, open; 5: 4, 13.4, 13.4 (g1), in view, open |
| eb5f51dc | 1: 24, 15.6, 6.3 (g24), not in view, ring; 2: 24, 20, 8.2 (g24), in view, ring; 3: 24, 15.1, 4.6 (g8), in view, ring; 4: 24, 20.6, 7 (g23), in view, ring; 5: 24, 20, 4.6 (g23), in view, ring |
| 887f27aa | 1: 24, 17.2, 17.2 (g1), not in view, open; 2: 14, 14.7, 14.7 (g1), not in view, open; 3: 24, 20.1, 17.2 (g24), not in view, open; 4: 24, 12.9, 12.9 (g1), not in view, open; 5: 24, 15.4, 15.4 (g1), not in view, open |

Totals: 50 courses on 10 scans; gate 1 in the spawn view 27; closed rings 33; the nearest gate is not gate 1 in 35.

Reading: on the closed rings gate 1 is mostly out of the spawn view and the nearest gate is the last one (g24): the
ring closes near the spawn and gate 1 leads away from it. Tunis seed 1: gate 1 17.2 m away, behind the spawn (bearing
92 deg measured in the page).

## Measured

Server: node tools/bench/scripts/serve-csp.mjs dist 5780, release of ca5760fd, no dist/walls folder at all.
- Tunis 887f27aa has shipped walls: the page opens with walls state 'none', source 'shipped' and stays so (probe
  log m1-tunis-button.log, 330 s). No base build is offered there, so built walls cannot be stored on Tunis; the
  store holds only refined walls there, and the plan on this PC offers no refine. The proof is Wroclaw only.
- Wroclaw 70b50d42, the walls box button (evidence/2026-11-15/fix3a/walls-store-70b50d42-button.json): ready 6.0 s,
  first state offer, cacheMiss absent, key input set (scan meta etag "509be231..."), cacheKind idb, quota 10296 MB;
  in use at 172.9 s (line "Walls built in 156 s"); the store row (58294590 bytes stored) was there at the first look
  after in-use; reload: source cache, bakes 0, in use 5.1 s after open; fresh tab: source cache, bakes 0, 7.5 s.
  Probe exit 0.
- Wroclaw, Shift+G, reload at in-use (walls-store-70b50d42-shiftg-reload-at-in-use.json): in use at 118.9 s, the
  store had NO row at the in-use look; the reload that followed still found it: reload cache 5.7 s, fresh tab cache
  6.5 s, bakes 0. Probe exit 0. The etag and the key were the same in all opens.

## Cause

- Review FX-1 (stage fixes): the X1 fix did not change this order (the write still began one microtask after
  in-use); since 92b4394f the walls go in use only after the write ended. That the integrator's loss came from a reload
  inside the write is still a GUESS: no run reproduced the loss (both quiet-PC runs and the in-use reloads kept the walls).
- Measured (first pass): the walls go in use before the store write starts. apps/fly/src/walls.ts:416 queue() sets state
  'in-use' (onSwap, walls.ts:336), the line says built (walls.ts:423), and only then walls.ts:425 starts
  `void remember(...)`, a fire-and-forget IndexedDB write of 58.3 MB (wallcache.ts:222-224: data row, meta row,
  evict). Nothing waits for it and nothing shows it; a reload or a closed tab inside that window loses the walls.
- Guess, not reproduced: the integrator's reload came on the first 500 ms poll after in-use while the gates loaded
  the CPU (train3-lead.md: "Probes ran while the gates ran"), so the write had not finished. My two runs on a quiet PC
  did not lose it.
- Ruled out by measurement on the pilot's path: cacheKind memory (it is idb), an etag change (same in all opens), a
  null key input (set before the build).
- Not hit on the pilot's path but real (lead's reading): mode 'off' (walls.ts:588, only ?simradio / ?lat=1) and a
  failed size request (walls.ts:591-595) leave w.keyInput null, and remember() returns at once (walls.ts:367): such
  a build is never stored and nothing says so.

## Fix plan (left)

1. walls.ts runBase and runRefine: start the store write the moment the bake result exists (before queue and
   endProgress); hook fields w.storing (boolean) and w.lastStore {ok, key, ms, bytes, error} (test data, like
   lastBake) so the probe measures the write time.
2. Key missing at the end of a build: try sceneSize once more and make the key; still none, or put() threw: the
   walls line adds a new key bake.notKept in en, es, pl, ru ("The walls fly now, but this browser could not keep
   them: the next visit builds them again." and real translations).
3. If the measured write time is over 2 s: while it runs the line adds a short "keeping them in this browser" part
   (new key, four languages); the done line comes back when it ends.
4. Unit test of the order and the not-kept line (logic in a small pure helper if mountWalls is too heavy to test),
   negative control against origin/main, typecheck of apps/fly, a6-reference not needed (no flight code).
5. Probe: add a check that the store row exists within N s of in-use (N measured), rerun Wroclaw button and
   shiftg --reload-at in-use; evidence JSON; gates.py --only vitest,architecture,i18n,b18.

## Cost notes
- Stage fixes: about 30 replies; code and tests took 15, four 600 s waits for the GPU lock (held by other lanes 28 min)
  took the rest. Running the cheap proofs first and the tracks-page probe in a separate detached run would have left
  results instead of a killed runner.
- X1 first pass: most turns went to the first Tunis runs (no progress output, 560 s timeout each; Tunis has shipped
  walls, so nothing to build). A one-line check of walls.source before a long run would have saved two runs.
- X1 pass 2: a negative control by git checkout HEAD wiped an uncommitted edit (one turn lost) and a new walls line hit
  the plain-lines test (no "could not"); commit before any file swap, and grep tools/bench/test for rules on bake.* keys first.
- X2: most turns went to the probe turning the craft (three Wroclaw runs); one page.evaluate that prints cameraOverride,
  cameraAim and the camera's forward after a yaw write would have shown the cause in one run.
- X2 pass 2: about 20 replies; reading the session's camera branch (cameraOverride, cameraAim) and grepping their setters
  found the cause without a browser run; the two GPU runs passed first time. Reading code before the next run was cheaper.
- X3: about 30 replies; most went to the unit test (two runs found no provable turn on seeds 1-6 of the test world).
  A first Node pass that tries every turn with checkTrack over the test worlds would have shown at once that the gate
  axes refuse almost every turn, and which seeds to use.
- fix3b Y1 pass 1: about 30 replies; most went to the page probe of the Tunis course links (three runs that hung to the
  timeout) and to an audit whose measured report (free radii every 0.25 m) ran 20 min for one course. A first run with a
  30 s per-step watchdog and measure only on failure would have shown both in two replies.
- fix3b Y1 pass 3: about 20 replies; most went to rebuilding the picture of what pass 2 had done (three commits and two
  runs not in the Status list); a Status line written with each commit would have saved five replies.

# Lane fix3b (train 3): a generated course passes the Save check untouched

Same worktree, branch fix3a. Runs and logs: U:/Temp/gsfpv-train3/fix3b/. Release build of 4e44a5bd: 1934 files,
sha256 9e509e47..., server port 5782.

## Status

Stage Y1-save-check
- [x] git fetch, merge --no-ff origin/main (10d9f249) into fix3a: d4ec7061; submodule packages/sonic-fpv updated to
      b05aedaa (the merge's pin); tsc apps/fly and packages/tracks: no errors; packages/tracks vitest 13 files 116 passed;
      tools/bench course and tracks tests (15 files) 79 passed; release build of 4e44a5bd done.
- [x] read-only hook window.__gsfpv.course.saveCheck() in apps/fly/src/app/builtin/course.ts: the Save check the way
      the edit mode runs it (editor3 builtin/course.ts and editor/check-core.ts: wallsCheck(ctx.session.collision,
      flownTransform(), marginOf(track))(upgradeTrack(track)), raw session walls, same as the generator's worker) plus
      transform, walls res, spawn, start, gate 1, the generator's proof flag, failing legs and gates (4e44a5bd).
- [x] probe tools/bench/scripts/save-check-probe.mjs (ways: shiftg, g1.<seed36>; one browser per way, a row written
      after each way; no GPU lock of its own)
- [x] Node audit tools/bench/src/save-check-audit.ts (course as the worker makes it, then the Save check; measured
      report only when the check finds a problem)
- [x] (a) page on Tunis, Shift+G and links g1.1, g1.2: 0 problems each (page-before-tunis-3.json, release 2d0fac0c; the
      hang was the hook's measured report, removed in 2d0fac0c)
- [x] (b) cause of the editor lane's refusal: an edited course (gates deleted, so the start leg runs to a gate the generator
      never joined to the start), not the untouched one; numbers in Measured
- [x] (c) Node table, ten scenes (nine catalogue scans and Tunis), seeds 1-5: 50 rows, 0 problems (audit-before.json)
- [x] repair (the rule, although no row failed): fitCourse refuses a course whose final proof failed (4f8f8db5) and ends with
      the Save check itself, wallsCheck on upgradeTrack of the course as given (ec147226); tests in fit.test.ts, both NEG OK
      (neg_control.py, ref origin/main and ref 6584e5cf, fit.ts)
- [x] after ec147226: table (c) 50 rows 0 problems (audit-final.json); page on Tunis three seeds 0 problems
      (page-after-tunis.json, release ec147226); tsc packages/tracks and apps/fly clean; packages/tracks 13 files 118 passed;
      gates.py --only vitest,architecture,i18n,b18 all PASS (vitest 139 s); a6-reference 1 passed

## Measured (Y1)

- (a) Page, Tunis 887f27aa, shipped walls (walls state 'none', source 'shipped'), Shift+G, page seed 176966006: 24 gates,
  Save check problems 0, start [0.1, 2.1, 0.3] (flown = scan, transform [1, 0, 0, 0]), gate 1 [-0.5, 3.3, 15.3], walls
  res 0.05 m (log page-before-tunis.log; its JSON was lost to the timeout kill, fixed since).
- (a) Page, Tunis, links g1.1 and g1.2: three runs, each stuck after the first poll at 5 s: page.evaluate did not return
  until the 200-280 s timeout ended the run ("Target crashed" is the kill). Logs page-before-tunis-g1.1-2.log and
  -g1.2.log. Not measured why; a guess: something on the page's thread blocks while a link course loads (fix3a's
  gate-guide-probe ran the same link on a58510dd, before the merge of integration B). Suspect files:
  apps/fly/src/app/builtin/course.ts link path (linkSeed, lines 82-131) or a merged feature.
- (b) Node, Tunis shipped walls (scenes.ts), spawn [0, 2, 0], worker's fitCourse: seed 1: 24 gates, fit 2.7 s, problems
  0, start [0.1, 2.1, 0.3], start free radius 1.44 m, nearest wall 1.55 m (margin 0.5 m), gate 1 [-0.5, 3.3, 17.1],
  generator proof ok; seed 2: 14 gates, 4.9 s, problems 0, same start; seed 3: 24 gates, 2.9 s, problems 0, same start
  (log audit-before-tunis.log). The start is 1.44 m clear against the 0.5 m rule, so the spawn rule is not the cause on
  Tunis. The editor lane's refusal (docs/wip/editor3.md on branch editor3, its item c) came with 4 problems on a course
  its probe had already changed (a floor add and gate moves before Save; problems at open were not recorded), so it is
  not shown to be a refusal of an untouched course.
- fitCourse time: 2.7-4.9 s per Tunis seed here, not the 804 s the editor lane saw; the measured checkTrack (free radii,
  measure true) of one 300 m course took about 20 min on these 5 cm walls (seed 3 row), a likely source of that number.

- (a) after, release ec147226 (port 5783, lock 12:16:33-12:17:11, page-after-tunis.json): Shift+G seed 1328990362 24 gates,
  gate 1 [-0.5, 2.1, 19.5]; g1.1 24 gates, gate 1 [-0.5, 3.3, 17.1]; g1.2 14 gates, gate 1 [-0.5, 2.1, 14.7]; each start
  [0.1, 2.1, 0.3] yaw 180, transform [1, 0, 0, 0], walls res 0.05 m shipped, nearest wall to the start 1.55 m, problems 0.
- (b) cause, with numbers: the start is 1.55 m from the nearest wall cell against the check's 0.5 m margin; the transform is
  [1, 0, 0, 0] in the page and in Node; the page's walls are the shipped 5 cm walls, the same set as the Node audit; so
  neither the spawn rule nor the transform nor the walls set refuses the untouched course. The editor lane's refusal came
  after its probe deleted the red gates (editor3.md, H3.3 c): the start leg then runs to a gate the generator never joined
  to the start, and that leg crosses the wooden wall. Its 6 to 8 problems before Save were after moves, a duplicate and a
  floor add. The spawn rule was not changed: no row of 50 has a start-wall or start-leg problem (nearest wall to the start
  1.2 to 4.8 m over the ten scenes, audit-final.json).
- (c) after ec147226 (audit-final.json): every scene 5 of 5 seeds with 0 problems; gates 24 on 0230d903, 1994c65c,
  70b50d42, 9baef54b, eb5f51dc; 887f27aa 14-24; 2f1ddf5f 14-16; ab5efa0e 10 (4 tries, smaller scale); ba7aa29d 5-24;
  d10c5638 3-5 (30-97 s a seed, below FIT_BUDGET_MS 120 s). Node fit time on Tunis 3-7 s a seed, not 804 s.

## Left (Y1)

- d10c5638 gives 3 to 5 gates in 30 to 97 s a seed (fit time near the 120 s budget); not part of this stage.
- The editor lane's Save refusal after deleting gate 1 is the editor's case (the start leg to a new first gate): one line to
  the lead; the generator's start is not moved by the editor (lane editor3 owns that).
- X3 pass 2: 20 replies, most of them blocking waits (38 minutes for the GPU lock, then 16 minutes of probes); one
  runner script with all four probes and one wait per milestone was the cheap part; a lock queue with fairness would save the wait.
- Stage fixes pass 2: 28 replies; three Wroclaw guide runs (walls built each time, 2.5-5.5 min) because the 'above' look first
  stood at the left edge, then fell behind the camera; computing the pose from the gate's height before the first run would
  have saved two runs.
- fix3b Y2 pass 1: about 30 replies; most went to reading the generator's walk (generate.ts 290-560) and to a second edit
  after the new test failed (cells of 1.4 m free radius never sit under 2.2 m); reading freespace clearanceM before the
  first edit would have saved two replies.

- fix3b Y2 pass 2: 30 replies; most went to the page probe (a new one, gate-place-probe.mjs) and the two audit waits; the
  top map came out 346 px wide and useless for poor ends; a quality-share layer drawn in Node beside the audit would be cheaper.

- fix3b Y3: about 35 replies; most went to blocking waits on the runner and to two probe faults found only in the run
  (walls-store and published walls); a dry run of each repaired probe on one scan before the long runner would have saved three.

Left for pass 3 (Y2): (1) Opole page run (crashed at 590 s: run it alone, REGEN=0) and fix3b-opole-pilot.png;
(2) fix3b-wroclaw-top.png and -tunis-top.png are too small and show no quality: draw the tile share (quality.ts near / best)
in the top map, step about 0.15 m/px; look at -tunis-top.png; (3) Wroclaw page third course had a gate at 5.0 m and one with
no ground under it, and Node seed 2 kept only 5 gates (the poor-leg drop thins it): find which drop path; (4) Wroclaw seed 3
leg 5 at 0.08 and Tunis leg 23 at 0.14 survive the final leg check: not explained; (5) R3 no gate in leaves (Wroclaw pilot-2
shows gate 6 beside a conifer); (6) Lublin: move the start into the well-scanned part when the spawn's free space has no
good tile (freespace.ts / generate.ts); (7) gates.py subset, a6-reference, unit test with NEG for the final leg check.

## Status Y2-gate-places

- [x] merge origin/main (b5b62d47, lead note) into fix3a: a1c0446e
- [x] Node table tools/bench/src/gate-place-audit.ts ((a) gate centre and lower edge above the tile ground and above the
      first wall voxel below, (b) wall voxels per block layer above the tile ground along the course, (c) quality share of
      each gate and the lowest along each leg against the best quarter). Before: place-before.json/.log (25 rows).
- [x] R1 and R2 in packages/tracks/src/generate.ts (GENERATOR_VERSION_QUALITY 3) and quality.ts (near, best,
      groundBelow, qualityShare): over a quality map the gate centre stands 1.2 to 2.0 m above the first wall voxel below
      it (moved to 1.6 m inside its cell as far as the free radius allows), lower edge at least 0.3 m, tile quality at
      least POOR_SHARE 0.15 (estimate) of the best quarter, legs sampled every 2 m at the same share; the band's top rises
      0.4 m at a time only when too few cells (WalkInfo.eyeHi); eye cells need 1.0 m free radius (EYE_FREE_M, estimate)
- [x] test packages/tracks/test/eye-level.test.ts, NEG OK against HEAD (neg_control.py, generate.ts and quality.ts);
      tsc packages/tracks clean; packages/tracks vitest 14 files 119 passed (tracks-y2.log)
- [x] after table, EYE_FREE_M 1.0 (place-after.json), then every leg of the finished course read every 1 m (LEG_STEP_M)
      and a poor leg drops its far gate (c5d92269); table place-after2.json, numbers in Measured
- [x] Lublin cause measured (audit --diag): the free space joined to the spawn is 900 cells of 0.8 m (span 12-13 m), none
      of them over a good tile (spawn share 0, 19160 good tiles elsewhere): the spawn sits in a closed pocket away from the
      well-scanned part, so the eye band gets 0 cells and the old dense-band path lays the course
- [~] page run on release of c5d92269's code (build sha label 6281ec68 + working tree, port 5784): Wroclaw and Tunis done,
      Opole crashed (Target crashed, timeout 590 s); pictures looked at: wroclaw-pilot, wroclaw-pilot-2, wroclaw-top, tunis-gate1
- [ ] R3 (no gate in leaves): nothing built (walls hold no leaves; needs splat positions in the worker or the Node table)
- [x] tsc apps/fly and packages/tracks clean; packages/tracks vitest 14 files 119 passed (after the leg change)
- [ ] gates.py --only vitest,architecture,i18n,b18; a6-reference (generator only, flight code untouched)

## Measured (Y2)

- Before (place-before.json, release walls of U:/Temp/gsfpv-train3/walls/release, Tunis shipped): gate centres above the
  first voxel below in 1.2-2.0 m: Wroclaw 0-2 of 24 (tile ground: median 3.2-4.8 m, max 6.0), Tunis 0-5 of 14-24 (median
  2.9-4.1), Opole 0-3 of 24 (median 3.0), Lublin 0-1 of 14-16 (median 6.8-7.6, max 10), Forest Floor 0-5 of 10 (scale 0.5).
  Dense band (quality.ts): Wroclaw 1.6-6.0 m, Tunis 1.6-4.6, Opole 1.6-3.6, Lublin 1.6-8.0. The voxel profile along the
  course peaks in the lowest layer above the tile ground on every scene (0-0.4 m at 10 cm walls, 0-0.2 m at 5 cm).
  Gate quality share of the best quarter: Wroclaw 0.20, Tunis 0.27-0.28, Opole 0.18-0.19, Lublin 0, Forest 1.
  Course span: Wroclaw 180-215 m, Tunis 97-114 m.
- After pass 1 with free radius 1.4 m, POOR_SHARE 0.25 (place-after1.json): Wroclaw 15-24 gates, all at 1.2-2.0 m above
  the voxel below, span 110-119 m, fit 2.4-12.3 s; Tunis 24 of 24 at eye level, span 121-134 m, 2.3-4.5 s; Opole 0 gates
  (all its tiles under 0.25), so the share went to 0.15: Opole 17-18 gates at scale 0.5, all at eye level, 2.8-2.9 s;
  Wroclaw seeds 1-2 24 gates at eye level, span 138-141 m, 7.5 s. Save check problems 0 in every row with gates.
  The audit's leg samples every 1 m still find 0.12-0.13 on Wroclaw legs (the generator samples every 2 m): open.
- place-after.json (EYE_FREE_M 1.0, legs every 2 m): Wroclaw 24 gates, eye by ray 24 of 24, centre 1.4-5.6 m (median
  1.7-2.0), poor legs 2-4 a course (lowest share 0.04-0.11), span 46-126 m, fit 2.6-4.5 s; Opole scale 1 (not 0.5) all seeds.
- place-after2.json (c5d92269): Wroclaw seeds 1-5 gates 24/5/20/24/24, eye by ray all, lowest gate share 0.20-0.26,
  poor legs 0 except seed 3 leg 5 (0.08), span 35-132 m, fit 3.9-9.5 s; Tunis 24 gates all eye, poor legs 0 except seeds 2
  and 4 leg 23 (0.14), span 103-139 m, 2.8-4.6 s; Opole 12-22 gates all eye, poor legs 0, 1.3-1.6 s; Forest Floor 8-10
  gates scale 0.5, all eye by ray, 0.9-1.2 s; Lublin unchanged (eye 0-1, share 0.06, see Status). Save check 0 in all 25.
- Page (place-page-wroclaw.json, place-page-tunis-opole.json): Wroclaw Shift+G to drawn course 11.3 / 13.3 / 25.1 s, gates
  24 / 18 / 14, eye 22 / 18 / 12 (highest 3.35 / 2.0 / 5.0 m, one gate with no ground under it); Tunis 4.6 / 5.3 / 3.9 s,
  24 gates each, eye 24 / 22 / 23 (highest 2.55 m). Pilot views 8 m before the gate at 1.6 m: Wroclaw gate 1 and gate 6
  and Tunis gate 1 at 1.6-1.65 m above the ground, elevation -3.9 to 0.7 deg from the view's centre: in front of the eyes.

## Status Y3-prove

Runner U:/Temp/gsfpv-train3/fix3b/y3/run.sh (release build, gates.py subset and a6-reference before any browser, then one
GPU hold per probe, each under 590 s; accept-fly and tracks-page take the lock themselves), server 5787, dist/walls = the
nine published walls of U:/Temp/gsfpv-train3/walls/release (Wroclaw on its walls), Tunis on its shipped walls.
- [x] save-check hook takes one moved gate (a copy is checked, the course in use is not changed); save-check-probe --push
      (gate 1 pushed 0.3 m into the nearest wall must be refused, the untouched course again 0 problems) and the time from
      Shift+G to the course; gate-guide-probe start look: gate 1 nearer than 12 m and within 20 deg of the view's centre
      with the guide hidden counts as correct; course-path-probe colours and counts the eye band 1.2-2.0 m and exits 1 when
      a gate of the first course is out of it by more than one 10 cm voxel or has no wall below; tsc apps/fly clean
- [x] gates.py subset in the runner: FAIL architecture ('tracks generator uses non-deterministic Math', the Math.hypot of
      c5d92269 in generate.ts legWell); replaced by Math.sqrt of the sum of squares; check-architecture ok, packages/tracks
      vitest 14 files 119 passed. The browser runs below are on the build with hypot (same n except within 1 ulp of a metre).
- [x] runner U:/Temp/gsfpv-train3/fix3b/y3/run.sh on the release of cd381338 (build 86 s), summary y3/summary.txt, evidence
      y3/ev, pictures U:/Temp/gsfpv-train3/shots/fix3b-y3; numbers in Measured (Y3)
- [x] gates.py --only vitest,architecture,i18n,b18 after f44e0971: all PASS (vitest 286 s); a6-reference exit 0
- [x] pictures looked at: fix3b-wroclaw-pilot.png (gate 1 at eye level in the cobbled street, dense scan),
      fix3b-tunis-pilot.png (gate 1 in the town gate at eye level, under the palm crowns, not in them),
      fix3b-wroclaw-pilot-2.png (gates at eye level beside the cathedral; this view faces a shop window, not gate 6: the
      probe's turn, not the course)

## Measured (Y3)

- Save check (save-check-probe --push, Shift+G): Wroclaw 70b50d42 published walls 10 cm: Shift+G to drawn course 8.1 s,
  24 gates, problems 0; gate 1 pushed 0.3 m into the wall 1.7 m from it: 3 problems (leg-wall start-g1, leg-wall g1-g2,
  gate-wall g1), the course in use again 0. Tunis 887f27aa shipped 5 cm: 4 s, 24 gates, problems 0; pushed into the wall 3 m
  away: 3 problems; in use again 0. The check is not loosened.
- Heights in the page (ray down from each gate centre to the first wall): course-path Wroclaw first course (7.1 s) 24 of 24 in
  1.2-2.0 (+-0.1), 1.6-2.1 m; regen three courses eye 24/23/24 (one gate at 3.1 m), 6.6-10.7 s.
  course-path Tunis first course (7.6 s) 23 of 24 (gate 15 at 3.4 m): probe exit 1; regen 24/24/.. at 1.6-2.0 m, 6.3-8 s.
  gate-place Wroclaw regen 24/24/21 eye (one course 1.6-3.3 m), 4.2-7.3 s; Tunis 23/24/24 (highest 2.05 m), 3.4-4.7 s.
- course-path both: 3 gates passed, crash gives a rewind (Tunis back 8.7 m), R resets to gate 1, errors 0.
- gate-guide --shiftg: Wroclaw exit 0 (20 s), Tunis exit 0 (13 s); at both starts gate 1 was behind (Wroclaw -118 deg 10.6 m,
  Tunis 93 deg 19 m) and the guide showed side and metres (11 m, 19 m); the new hidden-guide branch did not run.
- walls-store: Tunis exit 0 (153 s); Wroclaw exit 124 (waited 590 s, source published, state none: the probe waited for a
  build); probe fixed to treat published like shipped, rerun exit 1 (shippedOk wanted source 'shipped'); fixed again,
  not rerun.
- accept-fly SITE=http://localhost:5787 B6 B7 B9-B16: all PASS (364 s).
- tracks-page: 45 of 46 (evidence/2026-11-15/fix3b-y3/tracks-page.json); FAIL 'E camera: after Tab the camera looks at the
  newly selected gate, in view': gate 2 at y 0.95, camera free 0.70 m, 0 px of the gate drawn. Editor camera with
  eye-level gates near the ground (apps/fly/src/course/editor, lane editor3i): a guess, not measured.

## What the owner does (fix3b)

Open Wroclaw or Tunis, press Shift+G: in 4 to 11 s a course of 24 gates stands in the street at a person's eye height
(gate centre about 1.6 m above the ground), and Save accepts it as it is. If gate 1 is behind him, the side arrow says
where and how far it is.

## Not proven (Y3)

- Not every gate is at eye level: one of 24 in 3 of 8 page courses stood at 3.1-3.4 m (Tunis first course gate 15).
  Suspect: the band top rising 0.4 m when too few cells (generate.ts WalkInfo.eyeHi) or the ray meeting a hole in the
  walls; not measured.
- Poor ends of streets: no page measure of quality under the gates (the Node audit did it in Y2); pictures show dense parts.
- The guide's hidden case for a near gate in view did not occur in these starts.
- Wroclaw walls-store after the last probe fix: not rerun. tracks-page E camera: see Measured. Y2's left items (Opole,
  quality top map, R3 leaves, Lublin) remain as written under 'Left for pass 3 (Y2)'.
