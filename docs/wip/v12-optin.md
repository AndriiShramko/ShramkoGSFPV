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

## Facts before this lane (step 1, read on 8ce53fb)

What an ordinary pilot (a page opened without `?sonic=`) met of Fly by Sound:

- Sees, in the simulator:
  - the pause menu, which is the summary panel (`app/builtin/summary.ts` `shortcuts()`, `ui/summary.ts` `keysBlock`): its "Keyboard shortcuts" list shows every shipped binding of `packages/prefs/src/keymap.ts`, so 25 routed rows of which five are the sound keys, in every language: T "Fly by Sound: start or stop recording", U "Fly by Sound: send the flight to the author", I "Fly by Sound: hear the lesson and recording status", Z "Fly by Sound: hear the last line again", G "Fly by Sound: open the sound glossary" (`when: 'always'`, labels `keys.sonic.*` in `locales/fly/sonickeys/`);
  - nothing else: the K card ("How to fly", `ui/controls-card-logic.ts`) shows only scene.next, help.keys, fullscreen, pause, respawn, arm and mode; the HUD's ground hints (`ui/hud.ts`) and the stats card after a disarm (`ui/osd-stats.ts`, its "More" opens the summary panel above) show no sound key; the settings screen shows keys only for settings' own actions (none of the five); the pause menu has no Fly by Sound item (the mode adds `pause.sonic` "Fly by Sound: lessons and settings" only on a `?sonic=` page, `sonic/feature.ts`); no tour step (the scene tour of N is not an onboarding tour), no first-visit note, no badge; the GPU hint (Intel integrated graphics, `app/builtin/gpu-hint.ts`) names no sound mode (it only speaks its line inside the mode).
- Hears: nothing of the mode. T U I Z G are routed to their actions on every page, but no handler is registered outside the mode (the handlers are in `sonic/feature.ts` and `sonic-session/session.ts`), so a press does nothing; the motor sound is the ordinary one (`app/builtin/sound.ts` asks `sonicEntry()`, null there).
- Downloads: no chunk of the mode (`lazy-start`, `feature`, `session`; v12-int step 4, page check A). The start-up script (`main-closure.mjs` on a `vite build` of 8ce53fb: 6 files, 2,944,016 bytes, gzip level 9 850,945) carries the whole `sonic` dictionary namespace in four languages (11,369 bytes of JSON: the start screen's texts, the mode's notes, the host's spoken lines) and the `sonickeys` namespace (1,532 bytes; the five labels), besides the small shims (`app/builtin/sonic-flight.ts`, `sonic-session.ts`, `sonic/entry-state.ts`, `sonic/unavailable.ts`, `sonic/gpu-hint.ts`, `app/sonic-status.ts`).
- On the site and in the docs: the catalogue (`scripts/gen-catalog.ts` -> `apps/site/src/generated/features.json`) lists the five keys with their labels in the landing's "tune" section in four languages and counts them: 29 shortcut keys, 39 keyboard keys (`allKeys`), so the landing's keys tile says 39; `docs/settings.md` has rows T U I Z G and "39 keyboard keys", as do the README block and both `llms.txt`. Every page of the site has "Fly by Sound" in its footer (-> `/{lang}/sound/`); the sitemap lists `/sound/`; the privacy page has a "Fly by Sound recordings" section. The landing itself says nothing else of it.

What `?sonic=` accepts (`app/boot.ts`, `sonic/start-model.ts` `parseSonicParam`, `sonic/lazy-start.ts`, `sonic/start.ts`):

- `?sonic=` empty, `start` or `menu`: the accessible start screen (no scene picker, no first-visit modal); a shipped lesson id (21 of them; 20 fly a built-in world, `free-garden` flies the scan 7a475d38 at x5 with its track): the same screen with "Start: <lesson>" as the first, primary button; anything else: the screen with "There is no lesson called {id}" (its first 64 characters). Nothing starts by itself: a lesson starts on a key press or a click (the AudioContext and the speech need the user activation). `boot.ts` reads only `q.get('sonic')` and returns before the scene path, so `?scene=` and the shared settings (`sz`, `wl`, ...) are ignored on such a page; settings parameters (`?drone=`, `?set.<id>=`) are read before, by `openPagePrefs`.
- The address keeps it: `boot.ts` never removes `?sonic=`; when a lesson opens, `sonic/lessons.ts` `url()` writes `sonic=<lesson id>` (history.replaceState), so the address bar names the running lesson and a reload reopens the start screen offering it; a scene switch (`app/scene-host.ts`) writes `?scene=` and keeps `?sonic=`.
- The mode's own key help: the summary panel lists every shipped key (the five among them); nothing speaks the keys (the sound package's spoken `help.*` lines exist and are not used); K opens the visual "How to fly" card.

What `/{lang}/sound/` links to (`apps/site/src/app/[locale]/sound/page.tsx`): "Start Fly by Sound" -> `/{lang}/fly/?sonic=start` (written by hand, `data-track="fly_click"`), `/{lang}/privacy/#fly-by-sound`, the two GitHub repositories, a mail link to the author; it lists the keys T U I Z G R N with a sentence each (`sound.keys.items`).

## Status

- [x] 1 Facts: what an ordinary pilot (no `?sonic=`) sees, hears or downloads of Fly by Sound today; what `?sonic=` accepts and whether the address keeps it; what `/{lang}/sound/` links to (section above)
- [ ] 2 The sound keys exist only in the mode: a key condition `when: 'sonic'`, listed and routed only on a page entered through `?sonic=`; the main key lists, the catalogue, the stats panel and the site's keys tile neither show nor count them; the mode's own help and `/sound/` list them; generated files regenerated
- [ ] 3 A quiet way in for a curious sighted pilot: one pause-menu item, plainly worded in en, es, pl and ru, that opens `/{lang}/sound/`; no tour step, popup, badge or automatic hint
- [ ] 4 A link that carries the mode: in the mode L copies a link that opens the same lesson and scene with the mode's settings that matter, says and captions that it was copied (aria-live); the start links of `/{lang}/sound/` are such links; no personal data; opening one starts that lesson behind the keyboard-only start screen
- [ ] 5 Tests: unit (key condition filtering, link builder and parser round trip, the menu item) and a headless proof in `tools/bench` on a local build, each check with a negative control
- [ ] 6 Texts only in locales; the start-up script within its budget, measured
- [ ] 7 All gates (`gates.py`, exit 0, `B18 PASS`); the Status says what is done and what is not

## Needs from sonic-core

(none yet)
