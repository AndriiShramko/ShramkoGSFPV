# Lane menu4: the menu for new pilots (train 4)

Design file: docs/wip/menu-plan.md (train 2, older than releases 8f04b2da8e21 to 3dab24b9068c). Owner's words: brief line 373 ("several kinds of newcomer: one who never flew a simulator, one who flew other simulators a lot but is new here; different first menus; for the first one everything simple; later a more complex menu can open").

## Status

- [x] S1 levels (441343ba; checks: menu4-levels + prefs levels + defs + fly-parity 41 of 41, NEG OK 10 failing on origin/main, `vitest run --changed origin/main` 98 files 1341 pass, typecheck prefs and apps/fly 0 errors, gen-catalog 78 settings): prefs contract (`level` on every def, `defs/levels.ts` LEVEL_TABLE, `ui.menuLevel` shipped, first row of Display), locales in en/es/pl/ru, the question in "Before you fly" (three buttons), catalogue regenerated; unit tests with negative control.
- [x] S2 menus (9d04e08f; checks: tools/bench/test/menu4-menus.test.ts 5 of 5, NEG OK (fails on origin/main), `vitest run --changed origin/main` 99 files 1346 pass, typecheck apps/fly 0 errors): `app/menu-levels.ts` PAUSE_LEVELS (an absent id is expert; 9 / 19 / 27 items today) and MenuLevelSource read from `ui.menuLevel` (prefsLevels, given to PauseMenu in app/flight.ts); the pause menu draws the items above the level inside a collapsed `details` "More (n)" (data-action `menu-more`) with "Always show everything" (`menu-show-all`, sets the level to expert and redraws, focus on the first item that was hidden); their keys still run them; Up / Down skip a closed "More". Settings: `rowShow` in ui/settings/model.ts; rows of the level, a button "Show all settings (n more)" (`settings-show-all`, lasts until reload), a search finds every row (mark "In the full menu"), a changed value above the level shows with the mark "Changed", `?focus=` of a hidden row opens the full list; a group with no row at the level leaves the rail.
  - Code differs from the plan: MenuItem has no `level` field; the level lives in one table (PAUSE_LEVELS) beside defs/levels.ts, so no builtin file changes. "Fewer" was not built: the level row (Settings, Display, Menu) is the way back.
  - S3 probe hooks: `[data-testid=pause-more]`, `[data-action=menu-more]`, `[data-action=menu-show-all]`, `[data-action=settings-show-all]`, `[data-testid=setting-mark]`, rows `[data-testid=setting-<id>]`.
- [x] S3 accept (d94815a4 probe, this commit: evidence and status): release build (sha d94815a4), `tools/bench/scripts/menu4-first-minute-probe.mjs` at 1536x730 scale 1.25 with the mouse, headless, `?render=off`, no `?nowarn` (a real first visit): local 14 of 14 PASS; live https://gsfpv.flyreelstudio.eu/en FAILS the 9 repaired steps and PASSES the 5 it should keep (capture, close, the two no-page-error steps, expert = today's menus). Evidence: evidence/2026-11-19/menu4/first-minute-local.json, first-minute-live.json. Gates once (see Claims 4).
  - Pictures (U:/Temp/gsfpv-train4/shots): menu4-ask.png: the notice "Before you fly" with the question and three large answers, the first one green; the cookie question stands below it, not over it (the notice looks dim in the shot, likely its fade-in caught by the screenshot). menu4-settings-first.png: Settings at level first: search, "Show all settings (67 more)", six groups in the rail, one row (Crashes) in the first group; nothing overlaps, the cross is in the corner. menu4-pause-first.png (taken in the first run, before the probe answered the cookie question): the pause panel with the drone card, scene size, save video and graphics rows above the item list, so at 730 px only Continue and Restart are above the fold, and the cookie question lay over the list (see For the lead).

Plan items checked against today's code (2026-11-19):
- Live already: nothing of the plan (no menu level anywhere; uiaudit gave every panel a header and a 44 px cross; pause shows Continue first on short views). Kept as is.
- Changed from the plan: `ui.menuLevel` defaults to `expert`, not `first`: returning pilots and the bench pages (`?nowarn`, 144 files) keep today's menus without a migration; a new pilot answers the question, which sets the level. The data-action `warning-ok` stays on "Show me everything" because 7 probes press it and then use full menus.
- Two settings are newer than the plan: `display.stillDetail` (expert, rendering) and `course.lapSplash` (sim, course display).
- Dropped (out of 3 stages; release 2 of the plan): the two offers (radio, more flights), Controls "More", the sound start-screen list, search synonyms.

## What the owner does

1. Open the flight page in a fresh browser profile (or after clearing the site's data): "Before you fly" shows the motion text and "Have you flown FPV before?" with three buttons: "Never. Keep it simple", "Yes, in other simulators or for real", "Show me everything". Below: "You can change this any time: Settings, Display, Menu."
2. Click "Never. Keep it simple". Answer the cookie question (Decline or Accept), click Keyboard on the Controls screen, click Start flying on the How to fly card, click into the scene: the mouse is captured.
3. Key P: the pause menu shows 9 items (Continue, Restart, Change scan, Controls, How to fly, Settings, Feedback, Fly by Sound, Fly by Sound lessons) and a line "More (18)". Click it: the other 18 items open below, with "Always show everything" at the end. Their keys (for example key F9) work while the menu is up, whether "More" is open or not.
4. Click Settings: 11 rows, a button "Show all settings (67 more)". Type "uptilt" in the search: the camera uptilt row shows, marked "In the full menu", and can be changed at once. Clear the search, click "Show all settings": all 78 rows (until the page reloads).
5. Close Settings with its cross (top right), click Continue, click into the scene: the mouse is captured again.
6. To change the level later: Settings, Display, first row "Menu": Simple / Sim pilot / Everything. A pilot who answered "Yes, in other simulators" sees 17 pause items and 35 settings rows; "Show me everything" is today's full menus (27 items, 78 rows).
7. A pilot who visited before this release is never asked and keeps the full menus (the default level is Everything).

## Claims

1. Every setting has a menu level and `ui.menuLevel` exists (default expert); the three answers of the question set it. Proof: `npx vitest run packages/prefs/test/levels.test.ts packages/prefs/test/defs.test.ts tools/bench/test/menu4-levels.test.ts` (S1: pass; NEG OK on origin/main).
2. The pause menu draws the items above the level inside "More (n)", their keys still run them, Up / Down skip a closed "More"; Settings hides rows above the level behind "Show all settings (n more)", search finds every row with the mark "In the full menu", a hidden changed value shows with "Changed". Proof: `npx vitest run tools/bench/test/menu4-menus.test.ts` (S2: 5 of 5; NEG OK on origin/main).
3. A new pilot's first minute with the mouse at 1536x730, scale 1.25, works step by step. Proof: `node tools/bench/scripts/menu4-first-minute-probe.mjs http://localhost:6101/en <out.json>` on the release build served by serve-csp (14 of 14 PASS, evidence/2026-11-19/menu4/first-minute-local.json); the same probe against https://gsfpv.flyreelstudio.eu/en fails ask, answer, pause, fits, more, settings, search, showAll, levels (9 FAIL, 5 PASS, first-minute-live.json): the negative control of the lane.
4. The repository gates hold. Proof: `python -X utf8 C:/Users/andri/.claude/skills/gsfpv/scripts/gates.py --repo C:/dev/gsfpv-t4-menu --only typecheck,vitest,architecture,i18n,b18,leaks,catalog` (result in the line below, filled after the run).

## Not verified

- No person, phone or real controller took part: every step ran in headless Chrome with a synthetic mouse and keyboard, `?render=off` (no scan drawn, so the picture of the scene behind the menus was not judged).
- Phone size 844x390 was not walked by the probe (the plan's acceptance names the mouse at 1536x730); the menus use the existing panel layout, which lane uiaudit checked at that size.
- Fly by Sound's start-screen list, the two offers (radio, "Show more of the menu?"), Controls "More" and search synonyms were not built (release 2 of the plan); nothing of them is claimed.
- The other three languages were checked for key parity only (fly-parity test), not read on the page.

## For the lead

- Files outside the plan's part B list: `packages/prefs/src/*` and `packages/prefs/test/*` (part A, built by this lane too), `apps/fly/src/app/menu-levels.ts` (new), `apps/fly/src/app/flight.ts` (gives the level source to PauseMenu), `apps/fly/src/fly.css`, `ui/summary.css`, `ui/settings/settings.css`, `packages/i18n/locales/fly/{en,es,pl,ru}.json` (the unused `warning.ok` removed) and `fly/set/*.json`, and the generated catalogue: `docs/settings.md`, `llms.txt`, `apps/site/public/llms.txt`, `apps/site/src/generated/features.json` (regenerate after merging other lanes that add a setting: `npx tsx scripts/gen-catalog.ts`).
- Deploy order: page only (apps/fly and the site's generated catalogue). No API, rooms, nginx or sound package files.
- Live checks after deploy: `node tools/bench/scripts/menu4-first-minute-probe.mjs https://gsfpv.flyreelstudio.eu/en <out.json>` must print pass true (read-only: fresh browser profiles, the cookie question declined, nothing saved or sent); the existing probes that press `warning-ok` keep today's full menus.
- Found, not repaired (not this lane's files): at 1536x730 the pause panel puts the drone card, scene size, save video and graphics rows above the item list, so even the 9 items of level first start near the bottom of the view (Continue and Restart above the fold, the rest after a scroll); and on a first visit the cookie question lies over the lower middle of the page (over the pause list when P is pressed before answering it). A smaller summary at level first would be the next step.

## Cost notes

- S1: most replies went to finding why the plan and today differ (setting count, probes that press warning-ok, the ?nowarn pages) and to a neg_control retry (on Windows it needs npx.cmd, not npx); a design note listing the probes per data-action would have saved four replies.
- S2: about 25 replies, most of them reading screen.ts and menu.ts by slices and choosing one table over a field on 28 menu adds; the mock of ui/pause from app-switches.test.ts made the PauseMenu test cheap. Cheaper: a design entry point that names the test pattern (mocked ui/pause) up front.
