# Lane menu4: the menu for new pilots (train 4)

Design file: docs/wip/menu-plan.md (train 2, older than releases 8f04b2da8e21 to 3dab24b9068c). Owner's words: brief line 373 ("several kinds of newcomer: one who never flew a simulator, one who flew other simulators a lot but is new here; different first menus; for the first one everything simple; later a more complex menu can open").

## Status

- [x] S1 levels (441343ba; checks: menu4-levels + prefs levels + defs + fly-parity 41 of 41, NEG OK 10 failing on origin/main, `vitest run --changed origin/main` 98 files 1341 pass, typecheck prefs and apps/fly 0 errors, gen-catalog 78 settings): prefs contract (`level` on every def, `defs/levels.ts` LEVEL_TABLE, `ui.menuLevel` shipped, first row of Display), locales in en/es/pl/ru, the question in "Before you fly" (three buttons), catalogue regenerated; unit tests with negative control.
- [ ] S2 menus (next run; entry points: app/menu.ts PauseMenu.open builds entries, ui/pause.ts pauseMenu draws them, MenuItem in app/context.ts, PauseMenu made in app/flight.ts; ui/settings/model.ts matches and focusTarget, ui/settings/screen.ts; a pause item level table like defs/levels.ts, absent id = expert): pause menu shows the items of the level, the rest in a collapsed "More (n)" with "Show everything always"; Settings shows the rows of the level plus "Show all settings (n more)", search finds every row, `?focus=` opens a hidden row, a hidden changed value shows with the mark "Changed"; unit tests with negative control.
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
