# v0.12 v12-optin: independent review

Branch `v12-optin` at 91216ff (base 8ce53fb), worktree `C:/dev/gsfpv-v12-optin`, 2026-11-08. The reviewer changed no code; this file is the only commit. Lane plan and Status: `docs/wip/v12-optin.md`.

## Verdict

No blocker. Two majors to fix before this goes live (R1: the link is lost when the browser refuses the clipboard; R2: a shared link's sound comes back on every reload of its address). The rest is minor. The owner's intent is met where it matters most: an ordinary pilot meets nothing of Fly by Sound but one menu item (no key, no text, no chunk, not counted on the site); a sighted pilot has one quiet way in; a blind pilot's L copies a link that opens the same lesson (and scan, at its size) in the mode, with nothing personal in it.

## What was run

- The lane's own unit tests (keymap, catalog, i18n parity, app-keys, app-switches, sonic-optin, sonic-audio, sonic-int-lazy, sonic-int-status, sonicrec-feature, -local, -send, packages/scenes): 27 files, 437 tests pass. The whole suite: 206 files, 3300 pass, 8 skipped (64 s). `pnpm -r typecheck` passes. `gen-catalog --check`: up to date (74 settings, 24 shortcut keys + 12 flying keys).
- Negative control of the lazy-text checks: `LAZY_ROOT` on a `git archive` of 8ce53fb: the two v12-optin checks fail (2 of 7 fail), as the Status says.
- A fresh `node scripts/build-release.mjs` of 91216ff (1 min 9 s; release.json sha 91216ff, sonic 1eea4d5). `main-closure.mjs dist/fly/assets`: 2,932,947 B, gzip-9 847,676, gzip-6 850,201, brotli 684,712: +1.07 % over 838,687, 3,591 B under the limit 851,267, equal to the Status to the byte. In the built chunks "Learn to fly a drone by ear", "Fly by Sound: start or stop recording" and "This link sets the sound" are only in `lazy-start-*.js`; `main-*.js` holds "audio-only training" and "The lesson did not open".
- The page proof `tools/bench/src/sonic-optin-page.ts` on that build (`serve-csp.mjs dist 5431`, the GPU lock taken by the script): 29 of 29. The committed control run on v0.12 as released (`sonic-optin-page-base.json`) fails 6 of 11 exactly where that release showed the mode.
- The reviewer's own probes on the same build, GPU lock held: L with a refused clipboard in three sound setups, and a link reloaded after Keep (R1, R2); the ordinary pause menu at 1280x720 (en) and 375x812 (ru). Scripts, results and the proof's evidence are kept out of the repo in `U:/Temp/vl-research/review-optin/` (`probe/probe-optin.ts`, `probe-result.json`, `probe/probe-menu.ts`, `menu-*.png`, `sonic-optin-page-review.json`).
- A scan of the diff outside locales and evidence for Cyrillic and Polish letters: none. Not run: `gates.py` (its B18 calls the live site and GitHub), the site's `verify.mjs`, `accept-fly`.

## Confirmed, no finding

- T U I Z G on an ordinary page: not routed (either state, even with a handler registered), no caps, not listed; on a `?sonic=` page listed in table order and routed in both states; the page is asked at each press. `keymapProblems` makes a `sonic` key clash with any other binding on its letter.
- Catalogue, `docs/settings.md`, the README block, both `llms.txt` and the landing tile: 24 shortcut keys, 34 keyboard keys; the Polish and Russian tile words for 34 follow CLDR (generator).
- The menu item: one, no key, tools section, `<a href="/{lang}/sound/" target="_blank" rel="noopener">` from `<html lang>` read when the menu opens; the flight stays paused under the menu; the arrows walk it. Its id no longer collides with `pause.sound`.
- The link: strict reading (each parameter on its own, an unusable one ignored, no `sonic` no link); written parameters only `sonic scene sz st sc sh sf`: no voice, speed, screen reader, captions, motor sound, volumes, pitch or path. nginx `location = /fly/` keeps the query (`$is_args$args`) and `serve-csp.mjs` mirrors its language map (cookie, then the first Accept-Language, uk and be as ru).
- The visit layer: played at once, never saved until kept or changed; an unknown theme or a bad value dropped on its own; the receiver's own saved sound untouched (proof C).
- L and K do the mode's thing in flight because the mode's handlers are registered after share.ts and how-to-fly.ts; with the pause menu up its own handlers win (L the picture share, K the card). Only the page proof pins this order.

## Findings

### R1 major: with a refused clipboard, L does not give the link to a pilot alone, and with captions off gives it to no one

- Where: `apps/fly/src/sonic/feature.ts:341-342`, `apps/fly/src/sonic/captions.ts:63`, `packages/i18n/locales/fly/sonic/en.json:29` (and es, pl, ru).
- What: on refusal the handler does `captions.add(url)` and says `sonic.say.linkFailed` ("... ask your helper to copy it from the captions"). Probe (writeText rejects, execCommand returns false): with the defaults (the app speaks, captions on) the URL is one caption line among the lesson's, gone after 12 s (`CAPTION_MS`), never spoken, nothing selected, focus on the body; with the app speaking and captions off, `Captions.add` returns on the hidden region, so the link is nowhere while the voice still sends the pilot to the captions; only with "my screen reader speaks" does a reader get the URL from the live captions. No test covers it: the unit tests check `linkLine(false, ...)` only, the page proof grants the clipboard.
- Why: the requirement for this lane is that a refused clipboard must still give the link, spoken. The owner's case is a blind pilot sharing with a blind pilot, often without a helper; a voice that points to captions that are off is a dead end.
- Fix: on refusal put the link in a focused, selected read-only field outside the captions (the summary panel already does this: `apps/fly/src/ui/summary.ts:100-115`), labelled for readers, and say what is true ("The link is selected. Press Control and C to copy it."), naming captions only when they are on; let the line name the lesson so it can at least be told. Test the handler with a copier that returns false in the three setups, and add a page check with an init script that makes `writeText` reject and `execCommand` return false.

### R2 major: a shared link's sound comes back on every reload, after the pilot kept it or made a setting his own

- Where: `apps/fly/src/sonic/start.ts:69`, `apps/fly/src/sonic/start-screen.ts:171-176`, `apps/fly/src/sonic/entry.ts:92-108`, `apps/fly/src/sonic/lessons.ts:228-232`.
- What: the visit is read from the query at each page load and the query is never cleaned: not on Keep, not when the pilot changes a setting of the visit, and `lessons.ts url()` carries `st sc sh sf` (and `scene sz`) into the next lesson's address. Probe: open `/en/fly/?sonic=hover-height&st=clear&sc=1`, Keep, switch Calm mode off (saved `calm: false`), reload: the note is back ("Calm mode: on"), calm is in force again, the address still ends in `st=clear&sc=1`. `setVisit` also keeps a value equal to the saved one, so after Keep every reload shows a note that changes nothing. There is no "use my own settings" beside Keep.
- Why: it breaks the lane's own contract ("a setting the pilot changes below becomes his own"; "like a shared scene's settings": the shared-scene chip takes its parameters out of the address on Keep and Reset, `apps/fly/src/app/builtin/shared-settings.ts` `cleanAddress`). For a blind pilot a reversed height tone (`sh=up-lower`) coming back after a reload or a restored tab silently inverts what up and down sound like; the note exists only on the start screen.
- Fix: take `st sc sh sf` (and `scene sz` on a `?sonic=` page) out of the address on Keep, on a change that empties the visit, and in `lessons.ts url()`; drop visit values equal to the saved ones in `setVisit`; add "Use my own settings" next to Keep (the chip's Reset). Page check: link, Keep, change, reload: no note, the saved value in force.

### R3 minor: in the mode the visible Share still makes a link that does not open the lesson; a phone cannot share a lesson

- Where: `apps/fly/src/app/builtin/share.ts:92-98`, `apps/fly/src/sonic/feature.ts:326-330`.
- What: L is the only way to a lesson link. The top bar's Share and the pause menu's Share open the picture panel, whose link for a built-in lesson world (scene `lesson-<id>`) is not a working fly link (the lane's own "Left open"); touch has no L.
- Why: blind pilots often share through a sighted helper, who presses the visible Share; that link fails.
- Fix: in the mode give share.ts the lesson link (`sonicLinkPath(lessonLink(...))`) and skip the picture upload for a lesson world, or make the mode's Share run L's action.

### R4 minor: K in the mode talks over a running lesson and no longer closes the How to fly card; the mode's key list keeps the ordinary labels of L and K

- Where: `apps/fly/src/sonic/feature.ts:347-350`, `apps/fly/src/app/builtin/how-to-fly.ts:114-118`, `apps/fly/src/app/builtin/summary.ts:47`.
- What: K queues ten lines (about 25 s at speed 1) into the lesson's queue without pausing: a timed step runs on and the lesson's own lines wait behind them. The mode's K handler runs instead of the card's, so a card opened from the pause menu is closed only by Esc. On a `?sonic=` page the key list says "Share this scene" and "How to fly (the keys card)" for L and K, true only while the menu is up.
- Fix: pause the flight while the help is spoken (or speak it only when paused) and let any key cut it; close an open card first; give the mode's key list its own labels for `share.open` and `help.keys`. The Status says the ten lines were never listened to: listen before release.

### R5 minor: screen readers in browse mode may take L and K (as they take T U I Z G R N and the digits); not verified

- Where: `apps/fly/src/sonic/feature.ts:333`, `:347`; nothing in the mode has `role="application"`.
- What: NVDA and JAWS use single letters for quick navigation in browse mode (L list, K link, T table, G graphic, R radio button). Nothing in the flight switches a reader to focus mode, so these keys may never reach the page. No real reader was tried.
- Fix: test with NVDA and JAWS; if needed, focus a container with `role="application"` and an aria-label when a lesson starts, and tell on `/sound/` how to leave browse mode.

### R6 minor: the link's note puts Keep before Start

- Where: `apps/fly/src/sonic/start-screen.ts:157`, `:171`.
- What: in tab order the start section's first control is "Keep these settings", before "Start: <lesson>"; Enter there saves the link's sound as the pilot's own.
- Fix: put Keep after the Start buttons, and tie the note to the primary Start button with `aria-describedby`.

### R7 minor: the link carries only non-default sound, so a receiver with his own saved sound does not hear what the sender hears

- Where: `packages/scenes/src/sonic-link.ts:82-89` (`linkSound`).
- What: a sender on the default theme writes no `st`; a receiver whose saved theme is `race` hears `race`. The Status says the link carries "the sound settings that make the lesson sound the same".
- Fix: either always write the four (`st sc sh sf`, about 40 characters) or say "the sound settings you changed" in the Status and in the site's L item.

### R8 minor: wording

- Where: `packages/i18n/locales/fly/sonicentry/*.json:2`; `packages/i18n/locales/fly/sonic/en.json:18`, `pl.json:18`, `ru.json:18`; `packages/i18n/locales/site/*.json` `sound.keys.items` (L).
- What: (a) the menu item names only blind pilots, while the site says blind and low-vision in every language (the Russian item even uses another word than the site's): a low-vision pilot may pass it by. It is the only two-line item of the menu (screens at 1280x720 and 375x812), in the middle of the tools section between "Import rates from Betaflight" and "Cinema mode"; a one-line label at the end of the section would be quieter. It opens a new tab without saying so (like the contact link). (b) The Polish and Russian visit notes say "for this visit" with a calque of "visit" (quoted without their letters: pl "na te wizyte", ru "na etot vizit"); "na czas tej wizyty" and "tolko na etot raz" read naturally. (c) The English note has two colons in one sentence ("... for this visit: Sound theme: Clear; ..."). (d) The site's L item says "with your sound settings"; only theme, calm, height tone and turning travel. (e) es, pl and ru were not read by a native speaker.
- Fix: as above; a native read before release.

### R9 minor: tests: the two majors are untested, two controls are weak, one acceptance script now reads the wrong link

- Where: `tools/bench/test/sonic-optin.test.ts:167-168`, `tools/bench/test/sonic-int-lazy.test.ts:126`, `tools/bench/src/accept-v03-summary.ts:106`, `tools/bench/src/sonic-optin-page.ts` (the sender's context grants the clipboard).
- What: (a) nothing drives L with a refused clipboard (R1) or reloads after Keep (R2). (b) The "no personal data" control only asserts that `JSON.stringify(prefs)` contains `selfVoice`; it cannot fail when the writer leaks. A real control is a writer that serialises the whole prefs, shown to be caught. (c) The main-chunk text check deletes every asked key that is neither `.say.` nor `sonic.menu.`, so a main-chunk `t('sonic.close')` would pass while an ordinary page shows the raw key; intersect the asked strings with the keys of `locales/fly/sonic` and `sonickeys` instead. (d) accept-v03-summary S5 takes the menu's first `<a>` as the contact link; with the new item it reads `/en/sound/` (its MENU list was already stale).
- Fix: as said in each point.

### R10 minor: the flight regression evidence was made without the GPU lock

- Where: `docs/wip/v12-optin.md:74`.
- What: accept-fly B6-B16 (10 of 10) ran without `C:/dev/.gpu-lock` (disclosed); `accept-fly.ts` does not take it.
- Why: a GPU run at the same time changes the frame and timing numbers that evidence records, and can disturb another agent's run.
- Fix: let `accept-fly.ts` take the lock as `sonic-optin-page.ts` does, and re-run B6-B16 before that evidence is cited.

### R11 minor: merge conflict with origin/main

- Where: `docs/wip/v12-lead.md:52`.
- What: origin/main c11417c fixed the same Cyrillic name another way; `git merge-tree HEAD origin/main` reports a conflict. The Status says "keep it when merging".
- Fix: take main's line and drop this branch's edit.

### R12 minor, outside this diff: README still calls Fly by Sound unreleased

- Where: `README.md:265` ("Not released yet").
- Fix: say it shipped in v0.12 and how a pilot reaches it (the pause menu's item, `/{lang}/sound/`, a lesson link from L).

## Not checked

A real screen reader (NVDA, JAWS, VoiceOver) on the note, Keep and L; the clipboard in Firefox, Safari and on a real desktop; a phone; the live site; the sound of the ten help lines.
