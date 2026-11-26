# fix-fly (train 5): accept-fly B10 navigation timeout on the live site

## Status

- [x] S1 reproduce and decide: answer (b) the probe (commit of this file, see git log "fix-fly S1 done")
- [ ] S2 repair and prove: the wizard step waits for the pilot's readiness, not the browser's `load`; the whole
      accept-fly list twice on the live site (read only) and once on a local release build of the head

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

## Not verified

- The 30 s timeout of live run 2 was not reproduced (three live navigations of the address after B9, two of them
  in the full sequence); its cause is inferred, not observed.
- No person, phone or real controller took part; the radio is SimRadio (simulated raw HID reports).

## For the lead

## Cost notes

- S1: the most replies went to making a scratch copy of accept-fly run from the temp folder (CJS top-level await,
  file:// imports, GSFPV_REPO for evidence); cheaper: a `--trace-nav` switch in accept-fly itself.
