# Lane fix3a (train 3): two findings of integration A

Worktree C:/dev/gsfpv-rooms, branch fix3a from origin/main ca5760fd. Submodule packages/sonic-fpv at 598a98f9.
Logs and JSON of the runs: U:/Temp/gsfpv-train3/fix3a/. Evidence for git: evidence/2026-11-15/fix3a/.

## Status

Stage X1-walls-store
- [x] release build of ca5760fd (dist without any dist/walls folder), server 5780
- [x] probe tools/bench/scripts/walls-store-probe.mjs (build by the page's own action, reload, fresh tab)
- [~] measure: Tunis 887f27aa, Wroclaw 70b50d42 (button), Wroclaw with Shift+G (the integrator's switch)
- [ ] cause with file and line
- [ ] fix (product or probe), unit test, negative control
- [ ] proof runs, evidence JSON, typecheck, gates.py --only vitest,architecture,i18n,b18

Stage 2 (gate 1 not in sight on Tunis seed 1): not started.

## Measured

- Tunis 887f27aa has shipped walls: the page opens with walls state 'none', source 'shipped' (probe log
  m1-tunis-button.log, 330 s without a change).
- Wroclaw 70b50d42, the walls box button (m2-wroclaw-button.json): ready 6.0 s, first state offer, cacheMiss absent,
  key input set (etag of the scan's meta "509be231..."), cacheKind idb, quota 10296 MB; build in use at 172.9 s (line
  "Walls built in 156 s"), the store row with the same key was there at the first look after in-use (172.9 s);
  reload: source cache, bakes 0, in use 5.1 s after open; fresh tab: source cache, bakes 0, in use 7.5 s. Probe exit 0. No base build is offered there, so the store of built walls cannot
  be exercised on Tunis; it holds only refined walls, and the plan for Tunis on this PC offers no refine.

## Cost notes
