# v0.10 lead - merge, gates, benches (the lead's hands)

Base `198b659` (branch `v03-lead`; `origin/main` 5e4b11e is its ancestor, nothing newer on origin on 2026-10-20).
Plan `docs/wip/v10-plan.md`; lane notes `docs/wip/v10-<lane>.md`. Nothing was pushed or deployed; no SSH.

## Status

RESUME-FIRST: `git log --oneline -20` shows which `Merge v10-*` commits exist; tick the first unchecked box.
Evidence of this note: `evidence/2026-10-20/v10-lead/`.

- [x] 0. fetch: origin/main has nothing that HEAD lacks (checked 2026-10-20)
- [x] 1. merge `v10-r` (head 68c7d43, 13 commits): merge commit 1d43eaa, clean
- [x] 2. merge `v10-k` (head 4ebe4b9, 17 commits): merge commit 805a5b5, 2 conflicts
- [x] 3. decisions renumbered (K: D81-D83), STATE.md one NOT YET LIVE entry, defs count 81, gen-catalog regenerated (in 805a5b5)
- [ ] 4. gates once on the merged tree
- [ ] 5. landing smoke as CI runs it
- [ ] 6. merged local release built and benches run once
- [ ] 7. deploy list, not-verified list, owner questions (below, filled at the end)
