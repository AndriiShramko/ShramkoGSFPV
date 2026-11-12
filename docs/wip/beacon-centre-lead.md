# Release lead: sonic-beacon + center-throttle

Two lanes go out in one release. Stage 1: merge, gates, local probes, push (no deploy). Stage 2: deploy.

## Status

- [x] S1.1 fetch: simulator origin/main 6f33594 (not moved), package origin/main b102ce6 (not moved); lead copy on `main`, plain push convention
- [x] S1.2 lanes closed: every review finding and stage line [x] (beacon's open R14 is the lead's push + re-pin, done here); worktrees clean (center-throttle: 4 untracked PNGs, left)
- [x] S1.3 package: `git merge --no-ff sonic-beacon` on main = P 83ce612a765a1bf4c4a384c15acade92fc7dfce0; typecheck 0; `pnpm test` 58 files, 1268 of 1268 passed; `pnpm proof:audio` 3 files, 9 of 9 passed; pushed (b102ce6..83ce612)
- [x] S1.4 simulator: merged sonic-beacon, then center-throttle, no conflicts; pin packages/sonic-fpv -> 83ce612; lockfile unchanged (no install)
- [ ] S1.5 seams (a) key J, (b) setLesson(null) + sonic tests, (c) sound start screen settings count, (d) gen-catalog --check
- [ ] S1.6 all gates
- [ ] S1.7 local release probes (accept-fly, R9, centre-throttle-probe, wizard + hid, v13 page)
- [ ] S1.8 lead note complete
- [ ] S1.9 push simulator main

## Cost notes
