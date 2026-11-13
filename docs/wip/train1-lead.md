# Train 1: lead note (planning, then integration at level 3)

Plan: `docs/wip/train1-plan.md`. Base branch `train1-base`, worktree `C:/dev/gsfpv-train1-base`. Lanes merged into main in the
plan's order: voice, tracks, rooms. Held back: none.

## Status

- [x] Planning: base worktree from origin/main 8549533e, designs committed, contract as code (`train1-contract.test.ts`), plan written.
- [x] Lanes tracks, rooms, voice (status files `docs/wip/tracks.md`, `rooms.md`, `voice.md`), each with one review.
- [x] I1. main clean at origin/main 8549533e; the untracked designs rooms-plan.md, tracks-plan.md, voice-feedback-plan.md were
      byte-identical to train1-base and were deleted before the merge (the other untracked docs are not train 1's).
- [x] I2. Sound package: branch voice-feedback (d28d9c2) merged --no-ff into package main = 378cc50 (typecheck exit 0; tests
      62 files passed 1 skipped, 1300 passed 4 skipped), pushed to the public remote.
- [x] I3. On main: merge train1-base 0d63c361, voice cade079d, tracks 0b6a0e4d, rooms 1d62eb0a (no conflicts); pin packages/sonic-fpv -> 378cc50
      (fbed1010); pnpm install --frozen-lockfile exit 0.
- [x] I4/I5a. First gates run on the merge: FAIL vitest (4 of 4410 tests) and catalog (stale); fixed below, catalogue regenerated.
- [x] I5b. All gates on fb028968: exit 0 (typecheck, vitest 284 files passed 1 skipped / 4396 tests passed 14 skipped, api-unittest
      453 OK, architecture, i18n, catalog, B18 PASS). Also `python -m unittest discover -s apps/rooms/tests`: 53 tests OK.
- [ ] I6. Local release (build of fb028968, sha256 18c32f08...; serve-csp dist 5471):
  - [x] accept-fly B6 B7 B9 B10 B11 B12 B13 B14 B15 B16 against http://localhost:5471: 10 of 10 PASS (evidence/2026-11-13/train1/b-fly-*.json).
  - [x] Plan probe 3, tracks-page.ts run 2 on the same dist: 18/18 (evidence train1/tracks-page-run2.json), C1 C2 C3 fire.
        C2 cause: the probe predates lane review TR-3 (5836fa89), which makes the page skip a refused newest row and load the
        next saved one; the page loaded A's 887f27aa-cc02d13d, never the moved 887f27aa-96a928cc (skipped true). The probe now
        accepts 'refused' or 'skipped to A's row', never the moved id (823e7997). C3: the route patches any /fly/assets/*.js.
  - [x] Plan probe 5 (voice): analysis.json and summary.md identical in the pin 378cc50 and the lane d28d9c2 (sha256
        f93ccfc5a94c / 46ca50a9a64f; evidence train1/voice-probe5.json).
  - Run 1 history: tracks-page.ts run 1 on the merge: 16/18 (evidence train1/tracks-page-run1.json). FAILS:
        C3 'patched false': the probe patched only main-*.js, and the integration moved the feature into its own chunk; the route now
        patches any /fly/assets/*.js (tools/bench/src/tracks-page.ts, uncommitted before this commit, NOT re-run yet).
        C2 'the moved course is refused in the page': the page refused nothing visible: source 'server', loaded A's saved id
        887f27aa-9e7a42f2 instead of the moved 887f27aa-bf38a155, problem null. Likely cause (not proven): loadServer in
        builtin/course.ts falls back to the next row (index + 1) when a row fails, so a refused newest row ends as the older good
        course; or the page accepted the moved course's check and the fallback is elsewhere. The lane's run 5 had 18/18 with a
        different course (gate 3 near [4, 3.2, 2.6]; this run gate 8 near [24, 14.8, -10.6]). NEXT: read the 'check' result path
        for checkFor.kind 'server' in builtin/course.ts, decide whether the probe or the page is wrong, fix with a test, re-run
        tracks-page.ts (rebuild dist first: node scripts/build-release.mjs).
  - [x] Plan probe 1, rooms-two-page.ts on the merged dist: pass, 13 of 13 checks (evidence train1/rooms-two-page.json):
        A flew 82.75 m in 20 s, B saw A in 599 of 599 frames, RMS 0.0926 m (p90 0.141, bound 0.15) at playout delay 190 ms
        over 443 samples clear of A's 6 respawns; members, tag, join / welcome / who / leave / nobody lines. Controls fired:
        another room 0 of 599 frames with a remote; relay off 0 of 240, remote moved 0 m; swapped axes RMS 6.40 m.
  - [x] Plan probe 4: on the merged scan page A (887f27aa) CourseHook.beaconPoints 31 > 0 with a generated course (run 2;
        63 in run 1); sonic-v13-page.ts 68 of 68 (evidence train1/sonic-v13-page.json). A ?sonic= page with a course is
        not possible in train 1 (the sound mode never reads the course: tracks' train-2 item), so this is the part that exists.
  - [ ] Plan probe 2 (tracks and rooms in one room): NOT RUN, no script exists and the two rigs are separate
        (rooms-serve.ts has no tracks API, tracks-serve.ts no rooms relay). Under "Not verified".
  - [x] Regression on the same dist (serve-csp 5471, one GPU lock for the three scripts without their own):
        sonic-int-review.ts r9 11 of 11 (184 s); centre-throttle-probe.mjs all 3 runs pass (dji-centred, dji-flip,
        dji-bottom); wizard-auto-check.mjs /en: nobuttons, human and dji all reach 'check' with a profile, 0 errors;
        hid-source-probe.mjs /en: pass, 8 of 8 runs. Evidence train1/{sonic-int-review-r9,centre-throttle-probe,
        wizard-auto-check,hid-source-probe}.json.
- [x] I7. Deploy order, live checks, owner tries, not verified (this note).
- [ ] I8. Push main.

## Deploy order for the lead (nothing of it was run by the integration stage)

Every step with the neighbour snapshots and the hub lock, as in plan section 8. Sound package main 378cc50 is already
pushed (public), so the pin resolves.

1. API: `bash deploy/release-api.sh apps/api/tracks.py apps/api/server.py` (no --compose: compose.yml changed only by the
   new gsfpv-rooms service, which step 2 creates; no --locales: no bot or mail strings changed; no config.env change).
   The API writes DATA_DIR/tracks/ itself (create nothing by hand). /api/tracks is unreachable until step 3.
2. Rooms: `bash deploy/release-rooms.sh --compose` (first release: `docker compose up -d gsfpv-rooms` creates only that
   container; health /api/rooms/health from inside the network within 40 s). Memory: mem_limit 64m, cpus 0.25,
   pids_limit 8, read-only, rooms in RAM, no volume (the hub's free memory before it: check with the neighbour snapshot).
3. nginx: `bash deploy/release-nginx.sh` (deploy/nginx.conf: `location ^~ /api/tracks` after `/api/roadmap`, two rooms
   zones after `gsfpv_tg`, `/api/rooms` and `/api/rooms/ws` after `/api/health`; `nginx -t`, reload).
4. Static: `bash deploy/ship.sh` (allow list in the neighbour diff now `gsfpv-web,gsfpv-api,gsfpv-rooms`). The rooms menu
   stays behind `?rooms=1` (`ROOMS_MENU_PUBLIC = false` in apps/fly/src/app/builtin/rooms.ts).
5. After the live checks below pass: a second static release with `ROOMS_MENU_PUBLIC = true` plus lane rooms' RV-1 list
   (keymap lines `rooms.*` shipped, SHIPPED_BY_ROOMS in keymap.test.ts, `ctx.keys.on`, gen-catalog). Rollback in reverse.
Voice deploys nothing (an offline owner tool in the package).

## Live checks after the deploy

- `GET /api/tracks?scene=887f27aa` 200 JSON list; a POST from another origin refused; `GET /api/rooms/health` 200.
- Rooms RV-3: `/api/rooms%20HTTP/1.1%0d%0aX-Forwarded-For:%201.2.3.4%0d%0a...` answers 400 or 404 and makes no room.
- `cd tools/bench && SITE=https://gsfpv.flyreelstudio.eu npx tsx src/sonic-int-review.ts r9`; accept-fly B6..B16 with SITE.
- Two browsers with `?rooms=1` on the live site: A creates a room, B opens the link, B sees A move (the hub's nginx-proxy
  passing `Upgrade` was never verified: the first thing to watch).
- Tracks: Shift+G on 887f27aa, pause menu "Save for everyone", a fresh profile Shift+T loads it.

## What the owner should try by hand

- Fly 887f27aa (or any big scan), press Shift+G: a course of gates appears; fly the laps, see the lap time; Esc, "Save
  for everyone"; open the same scan in another browser, Shift+T loads it.
- Open the site with `?rooms=1`, "Fly with others" (Shift+L), send the link to a second device, fly together; Shift+O
  says who is around.
- Voice: nothing to try in the browser; the offline analysis of a recording package is the owner's command in the
  package (`pnpm analyze -- <package.zip> --out <dir>`), only after the consent decision below.

## Integration fixes (seams no lane could see alone)

- `packages/prefs/test/keymap.test.ts:160`: the courses' Shift+T / Shift+G are shipped `always`, so on a ?sonic= page they route
  `course.*`; the test now allows exactly SHIPPED_BY_TRACKS there (lane tracks' measured one-line fix; the feature itself ignores
  the keys while ctx.sonic is set, tracks review R2). Option (a) of TR-7 (a KeyWhen 'not sonic') is left for train 2.
- main-audit (app/env.ts is the only query-string reader): `builtin/course.ts` read `location.search` itself (its `course=` link, read
  back after its own replaceState). `env.ts` got `liveSearch()`; course.ts reads through it.
- sonic-int-lazy (the main chunk holds nothing of Fly by Sound): (a) the courses' feature reached the sound package
  (`course/run.ts` trackToObjects) and the mode's shapes (`course/view.ts` shapePrims): `features.ts` now installs
  `builtin/course-lazy.ts`, a stub that loads `builtin/course.ts` as its own chunk and installs it into the same flight (nothing
  if that flight ended first); (b) the rooms' announcer imported sayVia from `sonic-session/platform.ts`: sayVia moved to
  `app/say-via.ts` (type-only imports), platform.ts re-exports it; (c) `sonic.say.text` (handed to the engine only while Fly by
  Sound runs) joins ONLY_IN_MODE of the test.
- `train1-contract.test.ts`: the feature list's import may be `./builtin/<ns>-lazy`.
- Tests: keymap, main-audit, sonic-int-lazy, train1-contract 4 files 55 passed; with the course/tracks/rooms tests 14 files.
  Negative control: sonic-int-lazy + main-audit against the merge's features.ts, announce.ts, course.ts: NEG OK.

## Open items of the lanes, for the lead (not done at the merge)

- Tracks: TR-13/TR-8 (export the page's walls on 887f27aa and prove the run-4 course in Node: page and Node may prove
  against different walls; the page gives fewer gates than Node); TR-14 d (Shift held in flight for Shift+T/Shift+G; key
  help or other keys in train 2); TR-11 (course block vs a two-line flash, 76 px an estimate); TR-7 option (a) a KeyWhen
  'not sonic' (train 2); TR-6 (scene id not checked against the catalogue; no owner-only removal); TR-4 (probe: T off, T on,
  paint again); TR-5 (whether ctx.session.collision is a stable object: run 2 showed no 'moved' loop on 887f27aa).
- Tracks, Fly by Sound (train 2): sonic/feature.ts must pass the course to ScanSonicWorld.setCourse and drop it on a new
  scene; a lesson template for flying a course.
- Rooms: RV-1 at the second static release (above, deploy step 5); RV-3 live check; RV-6 (up to 12 room lines a minute
  over a running Fly by Sound lesson, not run on a ?sonic= page); the base's other `proxy_pass $api_upstream$uri`
  locations deserve `$request_uri`; a gate or CI line for `python -m unittest discover -s apps/rooms/tests` (53 tests OK
  here); boot.ts: a bare `/fly/?room=<id>` shows the scene picker (links carry `?scene=` until fixed); respawn slide of
  about 0.4 s on B (a 'respawned' pose flag, train 2); `rooms.nick` is a storage key, not a setting; motor sound of
  other drones for Fly by Sound needs the package change of rooms-plan.md 2.7 (train 2).
- Voice: the consent panel and privacy page do not yet say that a recording may be transcribed offline on the author's
  computer (the lane's sentence is in docs/wip/voice.md); decide before the first run on real recordings. V-R2 (a pattern
  for the `speech` event key in the package codec), `pnpm report -- <zip>` under pnpm 11 (skip a literal `--`), the
  opt-in end-to-end check SHRAMKO_VOICE_E2E=1: package items for a later package release.

## Not verified

- Plan probe 2 (tracks and rooms in the same room on one page): not run, no rig serves both (see Status).
- Probe C2 of tracks-page took the 'skipped to the next saved row' branch; the 'refused with no other row' branch of
  the page (course.ts line 172) was not driven in a browser on the merge.
- A ?sonic= page with a course (does not exist in train 1).
- Everything on the live site: no deploy in this stage; the hub's nginx-proxy passing `Upgrade` for /api/rooms/ws.
- The memory of gsfpv-rooms under real load on the hub (the lane's load run was on a PC).

## Not verified (planning stage, kept)

- Where the real walls of the bench tests come from (no `.cache/scenes` folder in the base or in `gsfpv-v03`).

## Cost notes

- Integration run 2 (about 30 replies, I6 to I8): the probes were cheap once chained in one background script with one
  log each; most turns went into reading each probe's own output format (wizard and hid write no single verdict). A
  common `{pass, checks}` line printed by every probe would have saved about 4 turns.

- Integration run 1 (about 40 replies, stopped in I6): most turns went into the four seam failures the lanes could not see
  (main chunk closure, query-string audit, keymap test) and reading probe internals; a lane-side run of sonic-int-lazy.test.ts
  and main-audit.test.ts on a trial merge of all three lanes would have caught them before level 3.

- Planning: most turns went into finding the shared lists one grep at a time; a ready `docs/agent-map.md` would have saved about
  4 turns. `neg_control.py` needs `pnpm.cmd` (or `node node_modules/vitest/vitest.mjs`) after `--` on Windows.
