# Release lead: sonic-beacon + center-throttle

Two lanes go out in one release. Stage 1: merge, gates, local probes, push (no deploy). Stage 2: deploy.

## Status

- [x] S1.1 fetch: simulator origin/main 6f33594 (not moved), package origin/main b102ce6 (not moved); lead copy on `main`, plain push convention
- [x] S1.2 lanes closed: every review finding and stage line [x] (beacon's open R14 is the lead's push + re-pin, done here); worktrees clean (center-throttle: 4 untracked PNGs, left)
- [x] S1.3 package: `git merge --no-ff sonic-beacon` on main = P 83ce612a765a1bf4c4a384c15acade92fc7dfce0; typecheck 0; `pnpm test` 58 files, 1268 of 1268 passed; `pnpm proof:audio` 3 files, 9 of 9 passed; pushed (b102ce6..83ce612)
- [x] S1.4 simulator: merged sonic-beacon, then center-throttle, no conflicts; pin packages/sonic-fpv -> 83ce612; lockfile unchanged (no install)
- [x] S1.5 seams: (a) J is bound only to `throttle.style` (keymap.ts:101; sound mode letters B N R Z and T U I G X, none J); (b) `InputHost.setLesson(null)` resets and reinstalls the style and restarts the gate when motors are off; the beacon lane did not touch input.ts or the lesson end; (c) start screen count 16 in sonic-start-screen.test.ts, center-throttle added no sound setting, sonic-v13-page.ts reads N from the page; (d) catalog gate PASS. Named run on the merged tree (sonic-mode, sonic-lessons, sonic-audio, sonic-review-input, sonicrec-*, app-centre-throttle*, keymap, app-keys, sonic-start-screen): 20 files, 447 of 447 passed
- [x] S1.6 gates run 1 (on 9c8f1c09): FAIL vitest (sonicrec-headers: fly policy differs from site by usb too), api-unittest (test_nginx_routes: same), b18 (pl/ru letters in docs/wip/center-throttle.md). Fixed in one commit (tests learn usb=(self) on the fly page only, new python test + control; note text ASCII). Gates run 2: all PASS, exit 0; vitest 264 files, 4265 passed, 10 skipped; api-unittest 422 OK; B18 PASS
- [ ] S1.7 local release probes (accept-fly, R9, centre-throttle-probe, wizard + hid, v13 page)
- [ ] S1.8 lead note complete
- [ ] S1.9 push simulator main

## Cost notes
