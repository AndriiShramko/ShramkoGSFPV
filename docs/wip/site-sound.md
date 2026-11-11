# Lane site-sound: the Fly by Sound section on the site

Owner's word (2026-11-11): no approval of the site text is needed, agents decide and publish.
Source text: the vault note on the site's Fly by Sound section in the project folder of the sound-navigation drone (ru, en; es and pl written in this lane).
Decisions: the supporters wall only with the person's consent (no card promised); no new roles in the contact form (the text leads to e-mail and the existing form); "one person with Claude Code AI agents" may be published.
Site rules kept: only what exists; racing is a goal under test; no promise of hearing "behind" (left and right are reliable, height is a tone); "3DGS" or "Gaussian splat"; no phone number; no sums of money.
Scope: static site release only (apps/site, packages/i18n/locales/site, apps/site/scripts/verify.mjs). No simulator, sound or flight code.

## Status

- [x] 1. Locales en, ru, pl, es: sound.* changed and new keys, soundBand.*; /{lang}/sound/ page sections, nav "On this page", ol steps, h3; home band after the first screen; verify.mjs checks. Gates typecheck, i18n, catalog, B18 PASS.
- [x] 2. Build bc8c342, verify.mjs 247/247; all gates on 65a1730: typecheck, api-unittest, architecture, i18n, catalog PASS, vitest 4108/4110 with 2 findings fixed (ru description lacked the stem the R8 test wants; the shots script must spread pick.launch) and their files re-run 33/33, B18 PASS after the lane doc went ASCII; tools/bench/scripts/sound-page-shots.mjs 16/16 (4 langs x sound and home x 375 px and 1440 px: no horizontal scroll, 16 px gap at 375, one h1, h2 order, band before #locations, start button); screenshots looked at (ru, en).
- [x] 3. Merged into main cd16196, pushed, deploy/ship.sh cd16196: CI 43008837693 green, release 7afb559faa27, neighbours equal, 302 checks passed.
- [x] 4. Live: release.json cd16196a; /{ru,en,pl,es}/sound/ carry the new sections and the start link; home band on ru and en; sound-page-shots.mjs 16/16 on live; accept-fly B6 B7 B9-B16 pass on live.
- [x] 5. STATE.md; vault note status done with the live links (vault 6933548).

## Second release (site-sound-2): the owner's correction, 2026-11-11

- [x] 6. Text: sighted FPV pilots (the author and his friends) already flew with eyes closed through corridors and obstacles by sound alone; pilots blind from birth have not tried it yet; two goals (international FPV competitions for blind pilots; a phone app turning the camera's view into a sound map), both tested in the simulator first. Keys sound.now.tested, sound.now.goal (new), sound.status, sound.press.story; the 'no blind pilot has tested' item removed. en, ru, pl, es. Commit 8306a6e.
- [x] 7. Gates on 8306a6e: typecheck, api-unittest, architecture, i18n, catalog, B18 PASS; vitest 4109/4110, the one miss sonicrec-recorder (voice sync marks) ran under a concurrent build and passes alone 39/39 twice (no recorder code touched); verify.mjs 247/247 on build 8306a6e.
- [x] 8. Merged 036b27f, ship.sh: CI 43014037641 green, release 2ce9faeaa99f, neighbours equal, 302 checks; live release.json 036b27f3, four pages carry the new text, sound-page-shots 16/16 on live; STATE.md.

## Third release (site-sound-3): 'Who it is for' section

- [x] 9. sound.who.* (title, intro, six audiences, toStart, toTest, toOpen, otherTitle) in en, ru, pl, es; h2 'Who it is for and why' with h3 ids blind, pilots, teachers, press, support, developers; the teachers, press and support h2 folded in (helpers.title, press.title, press.story, press.contact, support.title and the development item removed); On this page sub-list; home band text and link to /{lang}/sound/#sound-who. Commit 2fe2d8c. All gates PASS on 2fe2d8c (vitest included); verify.mjs 251/251; sound-page-shots 16/16 locally; the phone screenshot looked at.
- [ ] 10. Merge, ship, live anchors, STATE.

### The brief (kept for reference)

The owner asked for an h2 'Who it is for and why' on /{lang}/sound/ with h3 blocks and anchors #blind, #pilots, #teachers, #press, #support, #developers, so a letter or post can link one audience directly. The existing sections for teachers, journalists and 'How to help' are not duplicated: their content moves into these blocks or the blocks link to them. The Russian source text is in the vault note on the site's Fly by Sound section ('Next stage' part); en, pl, es to be written naturally. The consent template and the test protocol exist in the sound repository (the page already says so), so the developers block may name them. The home band gets one or two lines in the same sense (pilots flew with eyes closed; we look for blind pilots; two goals) and a link to the section. verify.mjs: the six anchors, h3 under the new h2, h2 order updated.
