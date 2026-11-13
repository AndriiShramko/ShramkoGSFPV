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
- [x] 4a. Tests (commit: this one, "rooms-public: menu and keys public, keys 9 and 0, room link without a scene"):
      tools/bench rooms-public (10), rooms-review (5) = 15 passed; prefs keymap, catalogue-site, catalogue-site-drift 38
      passed; bench app-play, public-ranges, app-keys, train1-contract, sonic-start-screen, rooms-a6, rooms-around 84
      passed; i18n 22 passed; `tsc --noEmit` apps/fly, tools/bench, packages/prefs: 0 errors.
      Negative controls (neg_control.py --ref origin/main): rooms-public whole file NEG OK (keymap.ts, rooms.ts, boot.ts,
      link.ts); "no key is taken" NEG OK (keymap.ts); "boot.ts opens" NEG OK (boot.ts); "spoken lines" NEG OK (rooms.ts +
      4 locales); rooms-review RV-1 NEG OK (keymap.ts); prefs keymap.test NEG OK (keymap.ts).
- [ ] 4b. Probe rooms-two-page on a local release build of this branch, without ?rooms=1, keys 9 and 0.

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
- (filled at the end of the stage)

## Cost notes
