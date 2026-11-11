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
