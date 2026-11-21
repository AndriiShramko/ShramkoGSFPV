# fix-gizmo13 (train 4): the live check edit4a-gizmo fails only at step 13.laptop

## Status

- [x] S1 reproduce and decide: one live run of edit4a-probe (read only), one picture of the 844x390 window, answer (a) page or (b) probe (commits 72724310, this one)
- [ ] S2 repair and prove as the answer says; gates once; 'For the lead' filled

## S1 answer: (b) the probe

Evidence (files under U:/Temp/gsfpv-train4/fix-gizmo13 and U:/Temp/gsfpv-train4/ship-car2):

1. The course is generated anew on every load: live run r2 (failed) had 37 gates, my live run live1.json (same live build, sha 267923c3) had 30. The probe's step 13 starts from whatever gate step 12 left selected.
2. My live run PASSED every step, 13.laptop too: before 28, 6 candidates, the click on gate 15 at [340,318] selected gate 15. Same page, same window, only the random course and the selected gate differ.
3. In r2 `tried` is [] and `candidates` 0: the page was never asked to select anything. The probe's rule (`onScreen(a, 844, 390, [], 125)`) keeps only gates more than 125 px from the selected gate's gizmo centre and with 90 < y < 330. After key Home (frame all) the 844x390 window draws the whole course in a small cluster: in live1 every gate centre lies in x 340..493, y 151..318 (gates13 in live1.json). In r2 the selected gate was gate 1 (index 0) at [418,206], in the middle of such a cluster, so every other gate was within 125 px of it and the rule dropped all 36.
4. The picture (shot13-live1.png, 844x390 at scale 2 after key Home): the course is drawn as a cluster under the gizmo, each gate carries its lime number label (gate-numbers.ts; the labels have pointer-events none, so they do not hide a gate's point from a click), gates 13, 14, 16, 20, 21, 23, 26, 27 are plainly visible and clear of the bars; a person would click any of them, most lie inside the probe's 125 px circle but off the gizmo's thin arrows and rings.

So the step fails because of how the probe picks a gate, not because the page refuses a click. What S2 must still prove on the page: that a click on a gate close to the gizmo but not on one of its handles (the view's own hit test `__gsfpvEditHit` names no part there) selects that gate; S2's new candidate rule clicks exactly such gates first, so if the page were at fault the repaired step would fail and the answer would turn to (a).

S2 plan (probe only, tools/bench/scripts/edit4a-probe.mjs step 13): candidates are gates in front, inside the window, the canvas under the point (no bar), no gizmo handle under the point (the view's hit test, as step 11 does), and no other gate's centre within 24 px (a click there may rightly take the nearer gate); when none is found, do what a pilot does: turn the view (an orbit drag on empty canvas) or back it (wheel), up to a few times, then click. The judge line stays as it is.

## What the owner does

Nothing: this lane changes a check, the pilot's page is not touched (answer (b)).

## Claims

None yet (S2).

## Not verified

No person, phone or real controller took part. Whether a gate inside 125 px of the gizmo takes a click is proven only in S2.

## For the lead

Filled in S2.

## Cost notes

- S1: one live drawn run (about 4 minutes) did it; it passed by chance of the random course, the saved gates' screen points explained the failure of r2. Cheaper: the probe should always keep its candidates' inputs in the JSON.
