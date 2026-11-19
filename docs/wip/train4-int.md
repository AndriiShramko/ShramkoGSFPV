# Train 4 integration

## Status

Car 1 (job int4-car1, work copy C:/dev/gsfpv-v13-int, branch train4 from e3201fec).

- [x] S1 the merges (car 1: the lanes whose review said SHIP when S1 reached them): 71e9f0d0 site4, 37d6c672 edit4b,
      8eaa97c5 menu4, b174107b tails4, 3e7a7c6e head4; the car 1 list is closed (a second look at the review files after
      the last merge found no new SHIP); every merged lane head is an ancestor of HEAD; pnpm install --frozen-lockfile,
      gen-catalog (everything up to date, no change) and pnpm -r typecheck (rc 0) on 3e7a7c6e
- [x] S2 the seams between car 1 lanes, the one full check, on 4707f7d2 (no source change was needed: see Seams):
      gates typecheck, api-unittest, architecture, i18n, catalog, b18, leaks PASS; vitest 5383 tests passed, 4 files
      failed only at server start (rooms-open-vote, rooms-race, rooms-socket: "rooms.py did not start"; scene-default:
      beforeAll 30 s timeout), all four start a Python server and ran beside the release build; the same four files
      alone afterwards: 4 files, 26 tests PASS; no car 1 lane touched them or apps/api/rooms. a6-reference.test.ts holds
      its hash (PASS). One release build (sha 4707f7d2, 1948 files) with the nine walls, served on :6180. Probes on it,
      evidence/2026-11-19/int4-car1/: site4-links 11/11 PASS (steps sound, soundall, band, person, lang, banner; the
      scene step needs a local API, not run), edit4b-probe 12/12 PASS (render off), menu4-first-minute 15/15 PASS,
      tails4-review-start 9/9 PASS, tails4-helper-download 12/12 PASS, head4-accept 12/12 PASS (fake camera clip, render
      off). accept-fly on http://localhost:6180: B6 B7 B9 B10 B11 B12 B13 B14 B15 B16 all PASS (evidence b-fly-*.json).
      No picture taken: no step judged a picture.
- [ ] S3 the hand-over (U:/Temp/gsfpv-train4/int4-car1.json)

## Progress

Car 1 (one line a lane, in the merge order)

- site4: merged 71e9f0d0 (review SHIP), no conflict
- ux4a: car 2 (review Verdict: HOLD when S1 reached it, and again after the last merge)
- ux4b: car 2 (review Verdict: HOLD, both looks)
- vox4: car 2 (no review file, both looks)
- gen4a: car 2 (no review file, both looks)
- gen4b: car 2, needs gen4a (review SHIP, but on a tree without gen4a planCourse is the S0 stub that uses only the seed: the level and spread buttons of the Generate dialog would change nothing)
- edit4a: car 2 (no review file, both looks)
- edit4b: merged 37d6c672 (review SHIP); one conflict, evidence/2026-11-19/b-repo-b18.json (add/add, a gate's output): edit4b's file taken whole, S2's gates write it again; no source conflict
- edit4s: car 2 (review Verdict: HOLD, both looks)
- edit4c: car 2 (no review file, both looks)
- menu4: merged 8eaa97c5 (review SHIP); the same b-repo-b18.json add/add conflict only, menu4's file taken whole
- tails4: merged b174107b (review SHIP), no conflict
- head4: merged 3e7a7c6e (review SHIP), no conflict (adds @mediapipe/tasks-vision 1.2.3 to apps/fly and the lock)
- sound6: car 2 (no review file, both looks)

## Seams

Car 1

The seams the integration prompt names (gen4b's Generate dialog in edit4b's editor, gen4b to gen4a, ux4a's message
service, edit4a's drag event to edit4c, the head4 and sound6 rows in the sound start screen) each have one side in car 2,
so they are car 2's to make real. Where car 1 lanes meet:
- menu4, tails4 and head4 all change packages/prefs (menu4: levels in defs; tails4: migrate.ts MACHINE_LOCAL_KEYS; head4:
  doc.ts SonicState.headTrack, keymap.ts Shift+H): merged without conflict. head4's headTrack is a field of the sonic
  collection, not a schema setting, so menu4's level table (levels.test.ts: every def has a level) needs no entry; head4
  adds no storage key, so tails4's every-key classification test holds. Proof: vitest on the merged tree.
- edit4b (KeyG removed), head4 (Shift+H) and menu4 (the generated catalogue): gen-catalog --check PASS on the merged
  tree, so docs/settings.md, llms.txt and features.json already agree with all three.
- edit4b, menu4 and head4 do not share a pause menu item: only menu4 changed pause.ts / menu.ts (menu-levels.ts
  PAUSE_LEVELS lists today's items; an unknown id falls to expert).
- For car 2: edit4b's seam.ts is the design's contract plus flashGate; parts/life-ask.ts askFirst is to be swapped for
  gen4's app/ask.ts at that merge; head4's start-screen row `sonic-head` and sound6's rows in start-screen.ts merge by
  keeping both (sonic-start-screen.test.ts counts 18 settings today); the spoken key help (sound6's mode-keys.ts) does
  not list Shift+H yet.

## Deploy order

Car 1

## Live checks

Car 1

## What the owner should try

Car 1

## Not verified

Car 1

## Cost notes

- S1 (car 1): about 20 replies; the most went to deciding whether gen4b stands without gen4a (its status file and the
  plan.ts stub). Cheaper: a one-line 'needs: <lane>' field in each lane's status head, and gate B18 writing its evidence
  under the lane's own folder so that every merge does not meet the same add/add conflict in b-repo-b18.json.
- S2 (car 1): about 25 replies; the most went to the vitest gate failing on four server-start tests because the release
  build ran beside it. Cheaper: run the build after the gates, never at the same time; and give each probe a common
  JSON verdict shape (pass, steps[]) so one line reads them all.

