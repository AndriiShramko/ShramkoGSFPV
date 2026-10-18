# v0.9 lead - merge, gates, benches (the lead's hands)

Base: `a3dd3eb` (v03-lead; origin/main `8c90f53` is an ancestor, nothing newer on origin at 2026-10-18).
Plan: `docs/wip/v09-plan.md`. Lane notes: `docs/wip/v09-<lane>.md`.

## Status

RESUME-FIRST: `git log --oneline -30` shows which `Merge v09-*` commits exist; continue from the first missing step.

- [x] merge v09-f (clean)
- [x] merge v09-a (conflict: docs/decisions.md only; kept both sections)
- [x] merge v09-r (conflicts: video-export.ts = A's setDetail('auto') + R's setStochastic(false) and its restore; play/easy.ts = one guard, A's placement after lastT; decisions.md)
- [x] merge v09-e (conflicts: ui/hud.ts = union of statsDrawing (R) and statsInput/statsLink (E); decisions.md)
- [x] merge v09-b (conflicts: controls.ts ArmView = link (E) + game (B); defs.test.ts count 78; decisions.md; generated files README/llms.txt/settings.md/features.json taken ours, regenerate at the end; 25 add/add evidence files (lane A and lane B both wrote accept-fly output to evidence/<date>/b-fly*): A's stay at the default path, B's moved to evidence/<date>/v09-b/ and v09-b.md references fixed)
- [x] merge v09-n (conflicts: fly/rotation locale x4 = help text with Shift+F (B) and opt.curated "... then SuperSplat" (N); decisions.md; STATE.md reset to the base (the lead writes STATE after deploy; lane STATE lines left out); generated files taken ours; 31 add/add accept-fly evidence files: N's moved to evidence/<date>/v09-n/)
