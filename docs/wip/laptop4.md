# Lane laptop4 (train 3): weak computers

Worktree `C:/dev/gsfpv-site-sound`, branch `laptop4` from origin/main a7f39528 (holds laptop3: 66aa1609 and the governor's
start step). Ports 5740-5759. Read first: docs/wip/laptop3.md (its P3 facts: the freeze below multiplier 2).

## Status

Stage Q1-why
- [x] 0. Release build of a7f39528 (dist sha256 fc603285...), serve-csp port 5740; submodule packages/sonic-fpv updated to
  the pinned b05aeda first (the reused worktree had 598a98f)
- [~] 1. Why a multiplier below 2 froze the page: probe tools/bench/scripts/freeze-probe.mjs (this commit), runs under
  U:/Temp/gsfpv-train3/laptop4 (runner run.sh, logs and JSON per label)
- [ ] 2. Why every run on this PC is capped at 30 frames per second, and a launch flag behind an environment switch

## Facts (measured)

## Decisions

## For the lead

## Not verified

## Cost notes
