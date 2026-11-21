# fix-gizmo13 (train 4): the live check edit4a-gizmo fails only at step 13.laptop

## Status

- [x] S1 reproduce and decide: one live run of edit4a-probe (read only), one picture of the 844x390 window, answer (a) page or (b) probe (commits 72724310, febb1b3a)
- [x] S2 repair and prove as the answer says (probe only): commits 75a5f282 (first rule), c51c3a19 (wheel in over the cluster), this one (status, evidence); two live runs and one local release run of c51c3a19 pass step 13; gates once (`gates.py --only architecture,b18,leaks`: all PASS; no TypeScript, test or locale file touched); 'For the lead' filled

## S1 answer: (b) the probe

Evidence (files under U:/Temp/gsfpv-train4/fix-gizmo13 and U:/Temp/gsfpv-train4/ship-car2):

1. The course is generated anew on every load: live run r2 (failed) had 37 gates, my live run live1.json (same live build, sha 267923c3) had 30. The probe's step 13 starts from whatever gate step 12 left selected.
2. My live run PASSED every step, 13.laptop too: before 28, 6 candidates, the click on gate 15 at [340,318] selected gate 15. Same page, same window, only the random course and the selected gate differ.
3. In r2 `tried` is [] and `candidates` 0: the page was never asked to select anything. The probe's rule (`onScreen(a, 844, 390, [], 125)`) keeps only gates more than 125 px from the selected gate's gizmo centre and with 90 < y < 330. After key Home (frame all) the 844x390 window draws the whole course in a small cluster: in live1 every gate centre lies in x 340..493, y 151..318 (gates13 in live1.json). In r2 the selected gate was gate 1 (index 0) at [418,206], in the middle of such a cluster, so every other gate was within 125 px of it and the rule dropped all 36.
4. The picture (shot13-live1.png, 844x390 at scale 2 after key Home): the course is drawn as a cluster under the gizmo, each gate carries its lime number label (gate-numbers.ts; the labels have pointer-events none, so they do not hide a gate's point from a click), gates 13, 14, 16, 20, 21, 23, 26, 27 are plainly visible and clear of the bars; a person would click any of them, most lie inside the probe's 125 px circle but off the gizmo's thin arrows and rings.

## S2: the repair (tools/bench/scripts/edit4a-probe.mjs, step 13 only)

The step now does what a pilot does. A gate a pilot can click: its centre in front and in the window, the scene (the canvas) under it, no handle of the selected gate's gizmo there (the view's own hit test `__gsfpvEditHit`, as step 11 does) and no other gate's centre within 24 px (a click there may rightly take the nearer gate). When there is none, the pilot moves the view, up to 8 times: with another gate visible, three wheel notches in over the visible gate farthest from the gizmo (the wheel goes nearer the point under the cursor, step 6), else the wheel back or an orbit drag on empty scene. The moves are kept in `moves13` of the JSON, the gates' screen points in `gates13`. The judge line is unchanged: a clicked gate is the selected one, a gizmo part to hover, one top bar, one gate bar, the hover tag, `over` and `outside` empty.

The first version (75a5f282, without the wheel in) failed step 13 on both live runs (live-v1-run1/2.json): Home drew all 38-40 gates within about 100 px, each gate 0 to 20 px from the next, and an orbit or the wheel at an empty place did not part them (moves13: 0 candidates after each). Picture shot13-s2live1.png (U:/Temp/gsfpv-train4/fix-gizmo13): a person sees the whole course as one small chain of lime numbers 5, 6, 7, 11, 15 under the gizmo, the other gates hidden under the top bar and each other; to pick one they would wheel in, which c51c3a19 does.

## What the owner does

Nothing: this lane changes a check, the pilot's page is not touched (answer (b)).

## Claims

1. On the live site (sha 267923c3, read only) step 13.laptop of the repaired probe passes: `cd tools/bench && node scripts/edit4a-probe.mjs https://gsfpv.flyreelstudio.eu/en 70b50d42 1536x730 1.25 live <out.json>`, run twice drawn: run 1 13.laptop PASS (gate 4 selected, gate 7 clicked and selected, no view move, over [] outside []), run 2 13.laptop PASS and the whole run PASS (gate 0 selected, one wheel in, gate 7 clicked and selected). Evidence evidence/2026-11-19/fix-gizmo13/live-run1.json, live-run2.json.
2. On a local release build of c51c3a19 (node scripts/build-release.mjs, serve-csp on port 7240) the same probe passes all 15 steps: `node scripts/edit4a-probe.mjs http://localhost:7240/en 70b50d42 1536x730 1.25 local <out.json>`; step 13: gate 36 selected, one wheel in gave 3 candidates, gate 17 clicked and selected. Evidence evidence/2026-11-19/fix-gizmo13/local-c51c3a19.json.
3. The page selects a gate clicked close to the selected gate's gizmo (inside the old 125 px circle) when no handle lies under the point: in live run 1 (no view move) the clicked gate 7 at [419,213] was 63 px from the gizmo centre [377,166] and became the selected one (gates13 and tried in live-run1.json); so the answer stays (b).

## Not verified

- No person, phone or real controller took part; all runs are headless Chrome with the mouse emulated.
- Live run 1 FAILED step 12.double (not touched by this lane): the double click on gate 5 at [768,365] selected gate 4 and framed it. It is likely the same cause as step 13 (step 12 picks by the old 170 px rule with no check for a nearer gate at the point), but the run kept no screen points for step 12, so this is not proven. Live runs r1, r2, live1 and live-v1-run1/2 passed step 12.
- No unit test and no neg_control: the change is in a probe script (answer (b)); its proof is the live and local runs above, and the old probe's live failure (r2, live-v1-run1/2) is its negative control.

## For the lead

- Page or probe: probe only. Files: tools/bench/scripts/edit4a-probe.mjs (step 13 and its header comment), evidence/2026-11-19/fix-gizmo13/*.json, this file. No page file, no API file, nothing to deploy; the live check edit4a-gizmo (deploy/live-checks.sh, unchanged command) picks up the new probe from the repository.
- Is a pilot on the live site worse off than the check says: no. The check failed because its own way of choosing a gate found none; the page itself selected every gate the probe clicked (live1, live-run1, live-run2, local; one click each). What a pilot does meet on 844x390: key Home draws a course of 30 to 40 gates as a small cluster (gate centres 0 to 20 px apart, many under the top bar), so they must wheel in before a gate can be picked out. That is a design question for the edit mode (Home could frame the course, not the whole scan, on a small window), not a fault this lane was asked to repair.
- The two live runs of the repaired probe: run 1 13.laptop PASS (12.double FAIL, see Not verified), run 2 all 15 steps PASS. The local release run of c51c3a19: all 15 steps PASS.
- Suggested: step 12 should take the same 'no other gate within 24 px, no gizmo handle' rule as step 13 if edit4a-gizmo turns flaky at 12.double on live.
- Live check to run after merge: edit4a-gizmo.

## Cost notes

- S1: one live drawn run (about 4 minutes) did it; it passed by chance of the random course, the saved gates' screen points explained the failure of r2. Cheaper: the probe should always keep its candidates' inputs in the JSON.
- S2: the most replies went to the first repair failing on live (a rule written from one passing course); reading the saved gate points of that failure gave the second at once. Cheaper: before writing a candidate rule, compute it offline on the saved `gates13` of every earlier run.
- Review: the most turns went to a release build started twice at once (one with a shell `&`), which left dist empty and a queued probe to stop. Cheaper: one build with run_in_background only, and chain the server, the local run and the negative control in one locked command.

## Review

Verdict: SHIP (independent check, head 411ebfbe; full notes U:/Temp/gsfpv-train4/reviews/fix-gizmo13.md).

- The answer (b) the probe follows from the evidence: in every run where the probe clicked a gate the page selected it with one click; the failed runs never clicked (tried [], candidates 0).
- The judge line of 13.laptop is unchanged from the base; the gate search uses only the mouse, the wheel and an orbit drag.
- Own runs: live (deploy/live-checks.sh arguments, read only, drawn) all 15 steps PASS; local release of 411ebfbe all 15 PASS; negative control (a scratch copy in the temp folder with the step-13 click 200 px off the gate) 13.laptop FAIL only, no click selected its gate.
- DOUBT, not held: step 12.double keeps the old 170 px rule and failed once on live (lane live-run1), so edit4a-gizmo may still be flaky at step 12.
- Nothing repaired; no code changed by the review. No person, phone or real controller took part.
