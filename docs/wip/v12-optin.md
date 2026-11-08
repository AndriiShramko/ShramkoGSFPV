# v0.12 v12-optin: Fly by Sound only for those who choose it

Lead: `docs/wip/v12-lead.md` ("Next for the lead" 2a). Plan: `docs/wip/v12-plan.md`; the joined mode: `docs/wip/v12-int.md`.

Worktree `C:/dev/gsfpv-v12-optin`, branch `v12-optin`, cut from `main` 8ce53fb (v0.12 as released). The sound package is the submodule `packages/sonic-fpv` at 1eea4d5: never edited here; what this lane needs from it goes under "Needs from sonic-core".

The owner's words (message 40, 2026-11-08), the task of this lane: ordinary pilots, who are not blind, must not meet the sound mode unless they choose it ("не навязывать, что бы не отпугивать их чем то новым и сложным"); a special link to scenes set up for blind pilots, carrying the settings inside the link, so blind pilots can share with blind pilots; a sighted pilot who wants to try it can switch it on.

## Rules

- Commit locally after every finished step with its Status line ticked in the same commit; never push, deploy, SSH, or send a request to the live site or API. Never `git add -A`: add own paths.
- Node: `export PATH=$HOME/node-v22:$PATH`. Browser runs only headless through `tools/bench/src/chrome.mjs`, on a local build served by `tools/bench/scripts/serve-csp.mjs` on a free port; a run that draws holds `C:/dev/.gpu-lock` (mkdir in a loop, rmdir after, also on error).
- Texts for people only in `packages/i18n/locales/**` (en, es, pl, ru); no Cyrillic or Polish letters outside locales (tests build them from code points), or B18 fails.
- The start-up script (main and its static imports, `node tools/bench/scripts/main-closure.mjs <assets>`) stays within +1.5 % gzip level 9 of the base 838,687 (limit 851,267 bytes); v12-int left it at 850,944.
- Every check has a negative control that must fail.

## Status

- [ ] 1 Facts: what an ordinary pilot (no `?sonic=`) sees, hears or downloads of Fly by Sound today; what `?sonic=` accepts and whether the address keeps it; what `/{lang}/sound/` links to
- [ ] 2 The sound keys exist only in the mode: a key condition `when: 'sonic'`, listed and routed only on a page entered through `?sonic=`; the main key lists, the catalogue, the stats panel and the site's keys tile neither show nor count them; the mode's own help and `/sound/` list them; generated files regenerated
- [ ] 3 A quiet way in for a curious sighted pilot: one pause-menu item, plainly worded in en, es, pl and ru, that opens `/{lang}/sound/`; no tour step, popup, badge or automatic hint
- [ ] 4 A link that carries the mode: in the mode L copies a link that opens the same lesson and scene with the mode's settings that matter, says and captions that it was copied (aria-live); the start links of `/{lang}/sound/` are such links; no personal data; opening one starts that lesson behind the keyboard-only start screen
- [ ] 5 Tests: unit (key condition filtering, link builder and parser round trip, the menu item) and a headless proof in `tools/bench` on a local build, each check with a negative control
- [ ] 6 Texts only in locales; the start-up script within its budget, measured
- [ ] 7 All gates (`gates.py`, exit 0, `B18 PASS`); the Status says what is done and what is not

## Needs from sonic-core

(none yet)
