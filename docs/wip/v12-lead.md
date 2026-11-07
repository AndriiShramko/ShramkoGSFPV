# v0.12 lead: Fly by Sound, stage 1

Handoff of the lead. Plan: `docs/wip/v12-plan.md` (sections 8 and 9 override earlier text).

## Done

- sonic-core: `shramko-fly-by-sound-fpv` main 3959930 (stage1-rc1 41aa53e plus publication docs), 577 Node tests, 9 audio proofs, independent review with 8 fixes. Published on GitHub as public after a full-history secrets scan.

## Running

- Workflow: step 0 (one agent on v03-lead, local commits only), then v12-flight and v12-feedback side by side in `C:/dev/gsfpv-v12-flight` and `C:/dev/gsfpv-v12-feedback`, one review each. Nothing is pushed until the lead merges and releases.

## Next for the lead

1. Read the lanes' Status and review files; handle "Needs from sonic-core".
2. Merge v12-flight, then v12-feedback (`git merge --no-ff`), all gates once, push.
3. Release per the gsfpv skill `references/release.md`: API, nginx, compose (192 MB) and config, release, live checks.
4. Live acceptance (spec done-means), STATE.md, vault status note.

## Status

- [x] sonic-core published (3959930)
- [ ] step 0
- [ ] v12-flight merged
- [ ] v12-feedback merged
- [ ] released and checked live
