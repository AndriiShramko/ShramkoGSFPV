# Lane rooms-public (train 1B): 'Fly with others' for every pilot

Worktree: C:/dev/gsfpv-rooms (reused from lane rooms, clean), branch rooms-public from origin/main 41372830.

## Status

### Stage P1-public-menu-keys-link
- [x] 1. ROOMS_MENU_PUBLIC = true (apps/fly/src/app/builtin/rooms.ts); keymap lines rooms.* shipped; SHIPPED_BY_ROOMS in
      packages/prefs/test/keymap.test.ts = both; keys through `ctx.keys.on` (rooms/keys.ts, the capture-phase listener,
      deleted); catalogue regenerated (`gen-catalog.ts`: 29 shortcut keys, docs/settings.md "39 keyboard keys").
- [x] 2. Rooms keys 9 (panel) and 0 (who is around); Shift+O stays settings and Shift+L share (for a pilot descending with
      Shift). Spoken lines name the keys: rooms.say.welcome `{who}`, rooms.say.noRoom `{panel}`, en es pl ru.
- [x] 3. /fly/?room=<id> without ?scene= asks GET /api/rooms/<id> for the scan (apps/fly/src/rooms/link.ts
      `roomSceneLink`, called from boot.ts before the picker); ?scene= links unchanged; no room / gone / offline: the picker.
- [x] 4a. Tests (commit 6ee9c9bf, points 1 to 3 and these tests; status and evidence 2a0d7b33):
      tools/bench rooms-public (10), rooms-review (5) = 15 passed; prefs keymap, catalogue-site, catalogue-site-drift 38
      passed; bench app-play, public-ranges, app-keys, train1-contract, sonic-start-screen, rooms-a6, rooms-around 84
      passed; i18n 22 passed; `tsc --noEmit` apps/fly, tools/bench, packages/prefs: 0 errors.
      Negative controls (neg_control.py --ref origin/main): rooms-public whole file NEG OK (keymap.ts, rooms.ts, boot.ts,
      link.ts); "no key is taken" NEG OK (keymap.ts); "boot.ts opens" NEG OK (boot.ts); "spoken lines" NEG OK (rooms.ts +
      4 locales); rooms-review RV-1 NEG OK (keymap.ts); prefs keymap.test NEG OK (keymap.ts).
- [x] 4b. Probe rooms-two-page (commit d3228c8d: no ?rooms=1, keys 9 and 0, new check roomOnlyLinkFliesTheRoomScan:
      page D opens /en/fly/?room=<id> with no ?scene=, joins, its address becomes scene=39e63ce9&room=<id>) on a local
      release build of d3228c8d (`build-release.mjs` exit 0, 1903 files), GPU lock taken by the probe itself: pass, 14 of
      14 checks, rms 0.0456 m (bound 0.15), controls 1-3 fired. Evidence evidence/2026-11-13/rooms-public-two-page.json
      (train 1's rooms-two-page.json left as it was). Console: 8 + 8 resource 404/403 lines, the same count as train 1's run.

## Decisions
- Keys 9 and 0, not Shift+L / Shift+O: the router reads a Shift chord no binding has as the key alone while Shift flies
  (app/keys.ts route()), so a shipped Shift+O / Shift+L would take settings / share from every keyboard pilot who holds
  Shift to descend. All 26 letters are taken (W A S D Q E flying; P R Y N M V C H O B L K F J the table; T U I Z G X the
  sound mode). Digit9 / Digit0: no binding, no flying key, no screen of the page reads Digit codes (grep of apps/fly/src
  and the sound package), far from W A S D and the arrows (no press by accident in flight), same place on every layout,
  and sonic/key-names.ts says a digit by name (a comma or full stop would be said as nothing by many voices).
  Shift+9 / Shift+0 while Shift flies fall back to 9 / 0 (rooms), which nobody had.
- Key 0 with no room says "You are not in a room. Press 9 to fly with others." (interrupting, as before); 9 is refused
  while a screen or panel is up (router `when`), as the capture listener did.
- The room link: a bare scene id plus its drawing parameters goes into boot.ts's go() as the page's own link, so the
  address becomes /fly/?scene=<id>&...&room=<id> (writeSceneQuery keeps ?room=); the room's shared settings are applied
  by the feature at the welcome, as for a Join from the list. A room the server does not have opens the picker without
  an error line (the picker's error codes are not this lane's).
- With a room link without ?scene= the scene opens after one fetch, so gtag may read the address before the rewrite (the
  comment in boot.ts about one task holds for ?scene= links only).

## For the lead before the merge
- tools/bench/test/train1-contract.test.ts (not a lane path): its two rooms lines now pin '9' and '0', and the Shift
  check is `!!shift === cap.startsWith('Shift+')` (course keys still Shift+T / Shift+G). Without it the contract test
  fails on the merged tree.
- docs/wip/train1-lead.md deploy steps 4 and 5 and the live check line name `?rooms=1` and Shift+L / Shift+O: after this
  lane the menu is public, the keys are 9 and 0, ?rooms=1 is harmless (still read by roomsShown).
- Review RV-1's router fallback proposal for keys.ts is no longer needed (no rooms chord on a Shift letter).

## Not verified
- Level 2 review of this lane: not done here (one per lane, run by another agent).
- Live site: nothing deployed; the room-only link and keys 9 / 0 run only on the local rig (rooms-serve.ts).
- A room link to a room the server does not have, in a browser: unit test only (fake fetch: 404, offline, bad id).
- Shift held to descend plus O / L in a real browser: KeyRouter unit tests only (rooms-review RV-1, rooms-public 2).
- Fly by Sound (?sonic=) page with keys 9 and 0 and a screen reader: not run. The two lines name the key by its cap
  ('9', '0'), not by sonic/key-names.ts spokenKey (layout map): on AZERTY the key at Digit9 is printed 9 and types a
  cedilla, the line says 9.
- Whether up to 12 room lines a minute disturb a running sound lesson (rooms review RV-6): still not run.

## Cost notes
- Most turns: finding why the first negative controls printed NEG OK while `bash -c` resolved to WSL bash (every run
  failed for that reason); pass Git Bash by its full path (C:/Program Files/Git/usr/bin/bash.exe) to neg_control.py from
  the start. The probe edits were cheap because rooms.md and the agent map named every file.
