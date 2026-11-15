# Lane loadq (train 3): a scan loads to the detail the pilot set, and the page says what it is doing

Worktree `C:/dev/gsfpv-loadq`, branch `loadq` from origin/main f286dd49. Ports 5820-5839. Runs and logs under
U:/Temp/gsfpv-train3/loadq, pictures under U:/Temp/gsfpv-train3/shots.

## Status

Stage L1-measure (no product change)
- [~] 0. Typecheck and one release build; server serve-csp on 5820 with the Wroclaw walls stand-in in dist/walls
- [ ] 1. Probe tools/bench/scripts/loadq-probe.mjs (every second: drawn, budget, who set it, levels, files, bytes)
- [ ] 2. (a) Wroclaw 70b50d42 spawn, 120 s: desktop-strong, desktop-weak, 16 M by hand; scores against 16 M
- [ ] 3. (b) what lowers a hand-set 16 M; five loads as is, five with every tenth file failing
- [ ] 4. (c) what the page tells the pilot today
- [ ] 5. (d) G5 scores at 1366x768 and 1920x1080; G6 at rest, measured with a test switch
- [ ] 6. Design from the numbers

Stage L2-build
- [ ] (after L1)
