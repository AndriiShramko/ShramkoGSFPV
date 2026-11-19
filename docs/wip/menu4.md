# Lane menu4: the menu for new pilots (train 4)

Design file: docs/wip/menu-plan.md (train 2, older than releases 8f04b2da8e21 to 3dab24b9068c). Owner's words: brief line 373 ("several kinds of newcomer: one who never flew a simulator, one who flew other simulators a lot but is new here; different first menus; for the first one everything simple; later a more complex menu can open").

## Status

- [x] S1 levels (441343ba; checks: menu4-levels + prefs levels + defs + fly-parity 41 of 41, NEG OK 10 failing on origin/main, `vitest run --changed origin/main` 98 files 1341 pass, typecheck prefs and apps/fly 0 errors, gen-catalog 78 settings): prefs contract (`level` on every def, `defs/levels.ts` LEVEL_TABLE, `ui.menuLevel` shipped, first row of Display), locales in en/es/pl/ru, the question in "Before you fly" (three buttons), catalogue regenerated; unit tests with negative control.
- [x] S2 menus (9d04e08f; checks: tools/bench/test/menu4-menus.test.ts 5 of 5, NEG OK (fails on origin/main), `vitest run --changed origin/main` 99 files 1346 pass, typecheck apps/fly 0 errors): `app/menu-levels.ts` PAUSE_LEVELS (an absent id is expert; 9 / 19 / 27 items today) and MenuLevelSource read from `ui.menuLevel` (prefsLevels, given to PauseMenu in app/flight.ts); the pause menu draws the items above the level inside a collapsed `details` "More (n)" (data-action `menu-more`) with "Always show everything" (`menu-show-all`, sets the level to expert and redraws, focus on the first item that was hidden); their keys still run them; Up / Down skip a closed "More". Settings: `rowShow` in ui/settings/model.ts; rows of the level, a button "Show all settings (n more)" (`settings-show-all`, lasts until reload), a search finds every row (mark "In the full menu"), a changed value above the level shows with the mark "Changed", `?focus=` of a hidden row opens the full list; a group with no row at the level leaves the rail.
  - Code differs from the plan: MenuItem has no `level` field; the level lives in one table (PAUSE_LEVELS) beside defs/levels.ts, so no builtin file changes. "Fewer" was not built: the level row (Settings, Display, Menu) is the way back.
  - S3 probe hooks: `[data-testid=pause-more]`, `[data-action=menu-more]`, `[data-action=menu-show-all]`, `[data-action=settings-show-all]`, `[data-testid=setting-mark]`, rows `[data-testid=setting-<id>]`.
- [ ] S3 accept: release build, mouse probe of a new pilot's first minute at 1536x730 scale 1.25, the same probe against the live site must fail the repaired steps, gates once, status parts complete.

Plan items checked against today's code (2026-11-19):
- Live already: nothing of the plan (no menu level anywhere; uiaudit gave every panel a header and a 44 px cross; pause shows Continue first on short views). Kept as is.
- Changed from the plan: `ui.menuLevel` defaults to `expert`, not `first`: returning pilots and the bench pages (`?nowarn`, 144 files) keep today's menus without a migration; a new pilot answers the question, which sets the level. The data-action `warning-ok` stays on "Show me everything" because 7 probes press it and then use full menus.
- Two settings are newer than the plan: `display.stillDetail` (expert, rendering) and `course.lapSplash` (sim, course display).
- Dropped (out of 3 stages; release 2 of the plan): the two offers (radio, more flights), Controls "More", the sound start-screen list, search synonyms.

## What the owner does

(stage S3)

## Claims

(stage S3)

## Not verified

(stage S3)

## For the lead

(stage S3)

## Cost notes

- S1: most replies went to finding why the plan and today differ (setting count, probes that press warning-ok, the ?nowarn pages) and to a neg_control retry (on Windows it needs npx.cmd, not npx); a design note listing the probes per data-action would have saved four replies.
- S2: about 25 replies, most of them reading screen.ts and menu.ts by slices and choosing one table over a field on 28 menu adds; the mock of ui/pause from app-switches.test.ts made the PauseMenu test cheap. Cheaper: a design entry point that names the test pattern (mocked ui/pause) up front.
