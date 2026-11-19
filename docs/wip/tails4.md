# Lane tails4 (train 4): the leftovers of train 2 that need no server and no person

Sources: docs/wip/train2-lead.md 'Held back' and 'Not verified' (the helper's two downloads as saved bytes),
docs/wip/train2b-lead.md 'Not verified', docs/wip/train3-lead.md 'Not verified' (the 13 localStorage keys; b11e45d1 gates
14.5-15.1 m over the wall), docs/wip/course3.md K1.2 (2f1ddf5f and d10c5638 spawns 62 m and 22 m high).

## Status

- [x] T1 downloads (ebbf066a probe; this commit evidence): tools/bench/scripts/tails4-helper-download.mjs presses both
      helper links on the Controls screen (1536x730, scale 1.25, render=off; fake USB device in the page, no helper
      program, the helper address sent to closed port 6139) and compares the SAVED bytes with tools/rc-bridge.
      Release build of ebbf066a served on 6120: PASS 12 of 12 (cmd 3461 of 3461 bytes, CRLF; py 31973 of 31973).
      Negative control --neg (the page's Blob one byte short, the download event still fires): FAIL on exactly the two
      'bytes' checks, every event/name/saved check still true, which is why the event alone proves nothing.
      Evidence evidence/2026-11-19/tails4/t1-helper-download.json and -neg.json. dist of ebbf066a kept for T2/T3.
- [x] T2 start heights (this commit). Measured (tools/bench/src/tails4-spawn-heights.ts, all 13 scans with walls):
      b11e45d1's start is right (2.59 m over the floor; its 14.5-15.1 m are the GATES of the course audit, not the
      start: left for the lead). The wrong starts are 2f1ddf5f, d10c5638 and also ab5efa0e: the scan's CDN camera is an
      overview OUTSIDE the walls' box (2f1ddf5f y 62 over a box that ends at 26.4; d10c5638 x 20.5, box ends at 15.4;
      ab5efa0e x -6.45, box starts at -3), so nothing at all is under the craft. Repair in the spawn code:
      packages/collision/src/start.ts placeStart (camera kept when ground is within 6 m under it; else the first point
      on the camera-target line with ground under it, 1.5 m over that ground; the line over holes only, as on
      2f1ddf5f: the nearest ground in rings around the target, 60 m; nothing: the camera as before), used by
      Session.findSpawn. Real scans: PASS 13/13 (2f1ddf5f 'around' 1.5 m, d10c5638 'line' 1.5 m, ab5efa0e 'line'
      1.5 m, the other 10 unchanged 'camera'); --old FAIL 3/13. Unit test packages/collision/test/start.test.ts 6
      passed, NEG OK (neg_control.py, the 3 files). Typecheck collision, fly, bench 0; vitest --changed 104 files 941
      passed; a6-reference holds its hash. Evidence t2-spawn-heights.json and t2-spawn-heights-old.json.
      T3 list: docs/wip/train3-lead.md line 147 (keys and their files); packages/prefs/test/migrate.test.ts.
- [x] T3 storage keys (this commit). The source scan of packages/prefs/test/migrate.test.ts now reads every source
      with dotted parts (it read one part before, so it could not see them). It found the 13 of train3-lead.md and 3
      more (gsfpv.library.merged.v1, gsfpv.superspl.failed.v1, gsfpv.superspl.filters.v1). Removed: gsfpv.tour.probe
      (app/tour.ts read a key nobody wrote, only to touch session storage; it touches s.length now). The other 15
      keys and the prefix gsfpv.rooms.host.* are per-browser facts, records, tokens or secrets by their own sources,
      so none moves into the settings document: each is now listed in packages/prefs/src/migrate.ts
      MACHINE_LOCAL_KEYS / the new MACHINE_LOCAL_PREFIXES with its reason, and readLegacy (isMachineLocal) never
      reads them. Test: migrate.test.ts 27 passed (2 new: each key found, classified, never read, its secrets not in
      the document; control: the old one-part scan misses all 15 and without the entries they are loose). NEG OK
      (neg_control.py, migrate.ts + tour.ts). Typecheck prefs, fly 0; vitest related 91 files 1283 passed.

## What the owner does

Nothing to press for this lane: the three repairs show without a step of his.
- T1: on the Controls screen, the helper's two download links save files that run (the same bytes as the repository).
- T2: opening scans 2f1ddf5f, d10c5638 or ab5efa0e, the drone stands 1.5 m over ground instead of hanging high
  in empty air outside the scan.
- T3: nothing he sees; an exported settings file still never carries course tokens, room secrets or the recording
  profile.

## Claims

1. The helper's two links save the repository's exact bytes (start-dji-helper.cmd with CRLF, dji-helper.py =
   tools/rc-bridge/rc_bridge.py). Proof: `node tools/bench/scripts/tails4-helper-download.mjs http://localhost:6120/en
   <out.json>` on a release build (and `--neg` must fail). Last result: PASS 12/12; --neg FAIL on the 2 bytes checks.

2. The craft no longer starts in empty air on 2f1ddf5f, d10c5638 and ab5efa0e: every one of the 13 scans with walls
   starts at most 6 m over ground. Proof: `cd tools/bench && npx tsx src/tails4-spawn-heights.ts` (and `--old` must
   fail). Last result: PASS 13/13, --old FAIL 3/13; `npx vitest run packages/collision/test/start.test.ts` 6 passed.

3. Every localStorage/sessionStorage key the page writes is classified: a legacy key that migrates, or a machine-local
   key with its reason that is never read into the settings document; the dead gsfpv.tour.probe is gone. Proof:
   `npx vitest run packages/prefs/test/migrate.test.ts`. Last result: 27 passed; neg_control.py NEG OK.

## Not verified

- No person, phone or real controller took part in this lane.
- T2: the new starts were not looked at in a picture: on 2f1ddf5f the ground found 13 m from the camera's target
  (y 12.2) may be a roof or a floater, and on ab5efa0e (a 6 m object scan at Scene size x1) the start is 1.5 m over
  the object's edge. Not flown in the page; only measured in Node on the walls the page loads.

## For the lead

- b11e45d1: its start is right; the course audit's gates 14.5-15.1 m over the first wall below (fix3a.md item 3 of
  'Left (C3-every-scan)') are a course question, not a start one: not done here.
- Files outside tools/bench: packages/collision/src/start.ts (new), packages/collision/src/index.ts (export),
  apps/fly/src/session/index.ts (findSpawn calls placeStart). Deploy: page only.
- T3 files: packages/prefs/src/migrate.ts (MACHINE_LOCAL_KEYS +14, MACHINE_LOCAL_PREFIXES, isMachineLocal),
  packages/prefs/test/migrate.test.ts, apps/fly/src/app/tour.ts. Deploy: page only. No live check needed (no key
  changes its value or place).
- Product questions left open (T3): gsfpv.superspl.filters.v1 (the SuperSplat tab's sort and filters) and
  gsfpv.rooms.nick are pilot choices kept per browser because the settings schema has no setting for them (no text
  setting, no SuperSplat tab group); gsfpv.course.best (best laps) is a per-browser record. Making any of them travel
  in an exported file needs a schema setting and a migration: a decision for the lead.
- Gates once on 003d52c1: typecheck, vitest, architecture, i18n, catalog, b18, leaks all PASS. dist of ebbf066a deleted.

## Cost notes

- T1: about 17 replies; most went to finding the three leftover lists (they sit in train2-lead, train3-lead and fix3a,
  not where the prompt points). A lane prompt that quotes the leftover lines with their file:line would save 6 replies.
- T2: about 25 replies; most went to measuring before guessing (one probe over all 13 scans answered which scans are
  wrong and why in one run) and to 2f1ddf5f's holes. A walls-bounds/ground helper in tools/bench would save 4.
- T3: about 20 replies; most went to the 3 keys the wider scan found beyond the 13 (my first grep skipped '.v1' keys)
  and to neg_control.py needing npx.cmd on Windows. Grepping with the test's own regex first would save 3.
