# Lane site-sound: the Fly by Sound section on the site

Owner's word (2026-11-11): no approval of the site text is needed, agents decide and publish.
Source text: vault note "Сайт — раздел о полёте по звуку (текст на согласование)" (ru, en; es and pl written in this lane).
Decisions: the supporters wall only with the person's consent (no card promised); no new roles in the contact form (the text leads to e-mail and the existing form); "one person with Claude Code AI agents" may be published.
Site rules kept: only what exists; racing is a goal under test; no promise of hearing "behind" (left and right are reliable, height is a tone); "3DGS" or "Gaussian splat"; no phone number; no sums of money.
Scope: static site release only (apps/site, packages/i18n/locales/site, apps/site/scripts/verify.mjs). No simulator, sound or flight code.

## Status

- [x] 1. Locales en, ru, pl, es: sound.* changed and new keys, soundBand.*; /{lang}/sound/ page sections, nav "On this page", ol steps, h3; home band after the first screen; verify.mjs checks. Gates typecheck, i18n, catalog, B18 PASS.
- [ ] 2. Build, verify.mjs, all gates, screenshots 375 px and desktop (ru, en sound, home), no horizontal scroll.
- [ ] 3. Merge into main, push, deploy/ship.sh.
- [ ] 4. Live checks: release.json sha, four /sound/ pages, home band, start button, no horizontal scroll at 375 px.
- [ ] 5. STATE.md, vault note status done.
