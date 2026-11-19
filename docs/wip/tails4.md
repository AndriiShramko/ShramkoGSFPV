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
- [ ] T2 start heights: why the craft starts at a wrong height on b11e45d1 and on the second scan; repair in the scene's
      data or the spawn code, with a unit test that fails on the old code. Leads: docs/wip/fix3a.md lines 885 and 898
      (b11e45d1 gates 14.5-15.1 m over the first wall below; 'look at gate-place-map.ts top map'), docs/wip/course3.md
      line 514 (K1.2: 2f1ddf5f and d10c5638 spawns from the CDN camera 62.0 m and 22.1 m high), findSpawn in the session.
      The STATE.md bullet of 4e9148cd1005 names no start height.
      T3 list: docs/wip/train3-lead.md line 147 (keys and their files); packages/prefs/test/migrate.test.ts.
- [ ] T3 storage keys: the 13 keys nobody reads or migrates, each migrated or removed, with a test.

## What the owner does

## Claims

1. The helper's two links save the repository's exact bytes (start-dji-helper.cmd with CRLF, dji-helper.py =
   tools/rc-bridge/rc_bridge.py). Proof: `node tools/bench/scripts/tails4-helper-download.mjs http://localhost:6120/en
   <out.json>` on a release build (and `--neg` must fail). Last result: PASS 12/12; --neg FAIL on the 2 bytes checks.

## Not verified

- No person, phone or real controller took part in this lane.

## For the lead

## Cost notes

- T1: about 17 replies; most went to finding the three leftover lists (they sit in train2-lead, train3-lead and fix3a,
  not where the prompt points). A lane prompt that quotes the leftover lines with their file:line would save 6 replies.
