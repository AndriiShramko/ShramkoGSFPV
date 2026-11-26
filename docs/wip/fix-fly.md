# fix-fly (train 5): accept-fly B10 navigation timeout on the live site

## Status

- [x] S1 reproduce and decide: answer (b) the probe (c8741ab6)
- [x] S2 repair and prove: the wizard step waits for the pilot's readiness, not the browser's `load`; the whole
      accept-fly list twice on the live site (read only) and once on a local release build of the head
  - [x] repair (5e5c2934): tools/bench/src/fly-open.ts (openFlyPage: goto waitUntil 'commit', then the caller's
        readiness), `wizard` in accept-fly.ts uses it and B10 evidence records `opens` (commit and ready ms); test
        tools/bench/test/fly-open.test.ts 4/4, bench typecheck clean, neg_control NEG OK against origin/main
  - [x] live run 1, live run 2, local release run of the head: B6 B7 B9 B10 B11 B12 B13 B14 B15 B16 all PASS, 3/3
  - [x] gates once, For the lead (commit "fix-fly S2 done")

## What the owner does

Nothing. This lane changed only the acceptance probe (tools/bench), not the page: the fly page a pilot opens is the
same build as before (live sha 3cc6b51b). A pilot with a radio opens `/en/fly/?scene=...`, sees the scan's loading
card, the scene is ready in 2 to 4 s and the radio wizard runs, exactly as the owner found on 2026-11-25.

### S1 answer: (b) the probe

The question: a pilot opens `/en/fly/?scene=39e63ce9&simradio=raw&...` with a radio: does the page finish loading
and can the pilot calibrate and fly? On the live site today (the same build as run 2: release.json sha 3cc6b51b,
built 2026-11-21T20:36:40Z, read from the live site and from U:/Temp/gsfpv-train4/ship-car5/live-r2/release.json):
yes, and nothing in the page holds `load` late.

Evidence (logs under U:/Temp/gsfpv-train4/fix-fly/):
1. Live run 1 (2026-11-21) never reached the page: it died in `browserType.launch` (accept-fly.ts:120, Chrome
   closed at start). Only live run 2 (2026-11-26, after five waits for the GPU lock, i.e. other lanes running at the
   same time) timed out, once, on the first `wizard` navigation.
2. Isolated repro on the live site (repro.mts: B9's three opens and its measured TWR, key P, the drone picker, then
   the B10 address; live1.json): the navigation committed after 0.53 s, DOMContentLoaded and `load` 0.19 s later;
   no dialog, no page error. The page was still `loading` its scan then, as expected (scene requests run in the
   background; none of them gates `load`).
3. The whole sequence B6 B7 B9 B10 on the live site with an instrumented copy of accept-fly (accept-fly-instr.mts,
   evidence written to a temp folder; live-seq1.log): B6 B7 B9 B10 all PASS; the three wizard navigations reached
   `load` in 532, 157 and 137 ms; no dialog; nothing open at `load` but the scene fetches and the /api/e ping.
4. The same sequence on a local release build of origin/main (page code identical to the head; port 7300;
   local-seq1.log): all PASS; the three wizard navigations reached `load` in 2393, 191 and 240 ms.
5. The live fly HTML loads one module script, six modulepreloads and two stylesheets; apps/fly/src has no
   top-level await; the only beforeunload in the flight page (app/builtin/cinema.ts) prevents leaving only while a
   recording runs. So `load` depends on static files only.

What the step before leaves: the first wizard navigation follows B9, which leaves the pause menu with the drone
picker open. That navigation needs 0.47 to 2.27 s just to commit (the old page must be torn down), against 0.04 to
0.10 s for the next wizard navigations. Playwright's default `goto` puts that teardown and the new page's `load`
under one 30 s budget. On a machine shared with other lanes' GPU runs this is the most likely place for run 2's
timeout; the exact 30 s event was not caught again in three tries (not reproduced), so this is a likely mechanism,
not a proven one.

Repair for S2: `wizard` navigates with `waitUntil: 'commit'` and then waits for what a pilot waits for, the page's
own readiness (`waitLogic`, the same `__gsfpv.status` wait that B6 uses, 180 s), and records the navigation and
ready times; every judge of B10/B11 stays as it is.

Picture: U:/Temp/gsfpv-train4/shots/fix-fly-live-timeout.png was taken by the isolated repro when the navigation
had finished (there was no timeout to picture): a person sees the scan's loading card ("Modlinek Villa", "Opening
the scan", 0 s) with its preview photo, i.e. the page is up and opening the scene.

## Claims

1. accept-fly's `wizard` opens the fly page on a committed navigation and then waits for the page's own readiness
   (waitLogic, 180 s), never for the browser's `load`; every judge of B10/B11 is unchanged.
   Proof: `npx vitest run tools/bench/test/fly-open.test.ts` -> 4 passed; `neg_control.py --ref origin/main --files
   tools/bench/src/accept-fly.ts tools/bench/src/fly-open.ts -- npx.cmd vitest run tools/bench/test/fly-open.test.ts`
   -> NEG OK.
2. The whole accept-fly list passes twice on the live site (read only) with the repaired probe.
   Proof: `cd tools/bench && GSFPV_REPO=U:/Temp/gsfpv-train4/fix-fly/s2-live<N> SITE=https://gsfpv.flyreelstudio.eu
   npx tsx src/accept-fly.ts B6 B7 B9 B10 B11 B12 B13 B14 B15 B16` -> run 1 and run 2 (2026-11-26): 10/10 PASS,
   exit 0 (logs U:/Temp/gsfpv-train4/fix-fly/s2-live1.log, s2-live2.log). B10 opens (commit / ready ms):
   run 1 good 2097/3997, other 110/2149, broken 86/2780; run 2 good 1516/3382, other 74/1924, broken 59/2370.
3. The same list passes on a local release build of the head (dist built at 78aca789; `git diff 78aca789..HEAD --
   apps packages scripts` is empty, so the page code is the head's), served by serve-csp.mjs on port 7300:
   10/10 PASS, exit 0 (s2-local1.log); B10 opens good 101/2256, other 24/2323, broken 16/2097.

## Not verified

- The 30 s timeout of live run 2 was not reproduced (three live navigations of the address after B9, two of them
  in the full sequence); its cause is inferred, not observed.
- No person, phone or real controller took part; the radio is SimRadio (simulated raw HID reports).
- Run 2's failure cannot be shown to FAIL again with the old probe (it was not reproduced in S1), so the lane's
  negative control is the unit test's fake page that holds `load`, not a live run.
- The other `page.goto` calls of accept-fly (B6, B9, B12 to B16, the reload in B10) still wait for `load`; none
  failed in five live runs; left as they are to keep the change to the step that failed.
- The local run used the S1 dist (sha 78aca789, page code identical to the head), not a fresh build.

## For the lead

- Probe, not page. A pilot on the live site is not worse off than the check said: the page reaches `load` in
  0.1 to 0.7 s and is ready in 2 to 4 s; the scan and the radio wizard work (S1 and the three runs here).
- Files: tools/bench/src/fly-open.ts (new), tools/bench/src/accept-fly.ts (`wizard`, the B10 `opens` record),
  tools/bench/test/fly-open.test.ts (new), docs/wip/fix-fly.md. Nothing outside tools/bench and the status file.
- Live runs with the repaired probe: 2 of 2 PASS on all ten items (B6 B7 B9 B10 B11 B12 B13 B14 B15 B16);
  local release build of the head: PASS on all ten.
- Gates (once, U:/Temp/gsfpv-gates-20261126-191740): typecheck, vitest, architecture, i18n, leaks PASS; b18 FAIL
  only for docs/wip/train5-lead.md (the lead's note on origin/main, Cyrillic text), not a file of this lane.
- Release: none needed (no page, API, nginx or sound file changed). Live check to run after merging: accept-fly
  (deploy/live-checks.sh line 63), as it stands.

## Cost notes

- S1: the most replies went to making a scratch copy of accept-fly run from the temp folder (CJS top-level await,
  file:// imports, GSFPV_REPO for evidence); cheaper: a `--trace-nav` switch in accept-fly itself.
- S2: cheap (about 20 replies); the three full runs were the time; reusing the S1 dist saved a build. neg_control
  needs `npx.cmd` on Windows (plain `npx` is not found by CreateProcess).
- Review: about 20 replies, most of the time was the three browser runs queued on the GPU lock; cheaper: one
  script for live + build + local run (done here), and a scratch probe copy inside tools/bench/src (imports resolve).

## Review

Verdict: SHIP (independent check, 2026-11-26; full file U:/Temp/gsfpv-train4/reviews/fix-fly.md).
- Diff: tools/bench only plus this file; the B10 judge is unchanged; `wizard` waits for `commit` then waitLogic.
- Own runs: live site B6 B7 B9 B10 B11 B12 B13 B14 B15 B16 all PASS (exit 0); local release build of 0ec000e3 on
  port 7320 all PASS (exit 0); negative control (wizard opens a page that never becomes ready) exit 1 with "page did
  not become ready"; neg_control.py on the unit test NEG OK.
- DOUBT, not holding: live run 2's 30 s timeout stays unexplained; its call log does not show whether the
  navigation had committed, so the new 60 s commit budget may only widen the margin. No pilot impact found.
- Repaired: nothing.
