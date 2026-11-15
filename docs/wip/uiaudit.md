# Lane uiaudit: every panel can be closed and understood, also on a small screen

Branch uiaudit in C:/dev/gsfpv-ui, ports 5840-5859. Owner's message 60 (2026-11-15): the voxel panel at the bottom left could not be collapsed on the laptop, and its small caption does not say that it closes the panel. Decisions U1 to U4 of the lead are in the stage prompts.

## Status

- [x] A1-inventory (commit: the one that adds this table; probe first committed in b12909a9). Branch fast-forwarded to origin/main d503b1cb, release build exit 0, Wroclaw walls stand-in copied to dist/walls/70b50d42/v1, serve-csp on 5840. Probe tools/bench/scripts/ui-audit-probe.mjs at five sizes on 39e63ce9 with ?render=off (no GPU lock), two sizes on Wroclaw 70b50d42 with ?render=off, and drawn under the GPU lock: Wroclaw 1366x768 and 844x390, Tunis 887f27aa 1280x720. Table tool tools/bench/scripts/ui-audit-table.mjs. Raw JSON and pictures: U:/Temp/gsfpv-train3/uiaudit/ (a-*, w-*, r-*), fault pictures U:/Temp/gsfpv-train3/shots/uiaudit-*.png.
- [ ] A2-repair.

## Ranked faults (A1)

Rank 1: a pilot cannot close or use something.
1. Walls and voxel menu (the owner's case). Opened by a click on the caption "Walls 5 cm" with a small triangle on the scene credit line (bottom left; top left on a phone on its side). It is a details element with no header and no close button; the only way to close it is a second click on that caption, which is 12 px text in a 40 px high line with no border and no background. Esc does not close it, a click outside does not close it. At 844x390 it is 250x463 px starting at y 105 (Wroclaw, drawn) or y 123 (39e63ce9): about 180 px of it is below the view, it does not scroll, so Export walls, Import walls and Clear stored walls cannot be reached, and the throttle line of the telemetry lies over its lower part. On desktop sizes it fits, but it pushes the credit line up and still has no cross. Smallest text 11 px. Files: apps/fly/src/walls.ts (mountWalls, the details "walls-more" and its div.walls-menu with an inline style), apps/fly/src/ui/voxels.ts (wallsVoxelsControls), apps/fly/src/fly.css (.walls-menu, .wv-*). Lane voxview. Pictures: uiaudit-walls-menu-844x390.png, uiaudit-walls-menu-wroclaw-844x390.png, uiaudit-walls-menu-1366x768.png.

Rank 2: a pilot cannot understand how to close it.
2. Voxel legend (V, top right): no close control; Esc and a click outside do nothing; three more presses of V did not hide it (V cycles the grid modes). Text 11 px. apps/fly/src/ui/voxels.ts voxelLegend, fly.css .voxel-legend. Lane voxview. Picture uiaudit-voxel-legend-1366x768.png.
3. "Fly by Sound here" (pause menu item): opens the attitude panel (desktop, 391x248 at the right) or the captions line (phone) with no header and no close; Esc and a click outside do nothing. apps/fly/src/sonic/look-panels.ts. Sound lanes.
4. The course's clock block (course-hud, Shift+G) and its progress note: no close control; Shift+T did not hide them in the probe; Esc only opens the pause menu over them. apps/fly/src/course/. Lane course5.
5. Overlays closed only by their own key: the REC dot (F9), the frame statistics (F3), the cinema note. Esc does not close them, nothing on screen says how. apps/fly/src/app/builtin/recording.ts, ui/osd-stats.ts, app/builtin/cinema.ts. Free (lane uiaudit).

Rank 3: the rest.
6. Pause menu at 844x390: the panel scrolls (812x288) and its cross (44x44) and Esc work, but the Continue button starts below the view. apps/fly/src/ui/pause.ts. Free. Picture uiaudit-pause-wroclaw-844x390.png.
7. Text under 12 px: credit line 11 px (fly.css credit), walls menu 11, voxel legend 11, Settings 11 (ui/settings/), Drone screen 11 (ui/drone*.ts, drone-tune.css). Credit, Settings, Drone: free. Picture uiaudit-settings-1366x768.png.
8. A second press of the opening key does not close the window: report form (B) and Share (L); Esc and the cross do. app/builtin/feedback.ts, app/builtin/share.ts. Free.
9. Controls with a symbol as the only visible word (they have an accessible name): Settings help "?", pause scale "-" and "+", Drone "1" "2" "3", Scenes star. Settings has one input with no accessible name (ui/settings/editors.ts). Free.
10. A click outside closes only the pause menu; every other window stays (U1 does not ask for it; noted for one rule).

What passes U1 today: every window built with ui/dom.ts panel() or the screens (pause, keys K, Settings O, report form B, Share L, Change scan, Drone, Controls, How to fly, Replays, Fly with others, Measurements, Import rates) has a header with its name, a cross of 44x44 px at the top right with the accessible name Close, Esc closes it, and it is whole inside the view at all five sizes, scrolling inside itself where it is taller.

## Not measured in A1

- The controller helper's messages (needs the fake USB device of mouse-free-probe.mjs; the probe's step found no button and is recorded as an error).
- The course editor window and its bars: Shift+B during the course build showed only the progress note (render off: "No course fitted"; drawn: the build was still at step 2 of 2 after 25 s).
- The Fly by Sound lesson list and sound panel; only the start screen (a full page, scrolls, no close, Esc does nothing) was measured.
- The cookie banner did not show on the local release (consent card absent); the rooms panel by key 9 opens nothing without the rooms service (the menu item opens it and is measured).
- Tunis 1280x720 drawn: the page crashed (Target crashed) at the last step, "Fly by Sound here", after the course; three drawn pages ran at once, so a guess is GPU memory. Left for A2 to re-run alone.

## Gates at handover (A1)

gates.py --only vitest,architecture,i18n,b18,leaks: architecture, i18n, b18 PASS; vitest FAIL and leaks FAIL because this run has no `python` on PATH (rooms-socket.test.ts: spawn python ENOENT; leaks: no python program). A1 changed no product file and no test.

## Table (A1)

Per size: the panel's width x height @ x,y; IN whole in view or OUT; S scrolls inside; CLIP does not fit and does not scroll; x: the first close control's size, out (off the view), cov (covered). Ways: did Esc / the same key or chip / a click outside / the close control close it (y, n, '-' not tried). Scene 39e63ce9, ?render=off.

| panel | opens with | 1920x1080 | 1366x768 | 1280x720 | 844x390 | 390x844 | Esc / again / outside / control | min font | no name or symbol only |
|---|---|---|---|---|---|---|---|---|---|
| controls-first | first visit | 1920x1080@0,0 IN x:44x44 | 1366x768@0,0 IN S x:44x44 | 1280x720@0,0 IN S x:44x44 | 844x390@0,0 IN S x:44x44 | 390x844@0,0 IN S x:44x44 | - / - / - / - | 13 | button[radio-close]"(cross)" |
| credit | always | 583x57@16,983 IN x:583x40 | 583x57@16,671 IN x:583x40 | 583x57@16,623 IN x:583x40 | 396x75@16,44 IN x:396x40 | 234x92@16,712 IN x:234x40 | - | 11 | - |
| hud | always | 1920x1080@0,0 IN x:none | 1366x768@0,0 IN x:none | 1280x720@0,0 IN x:none | 844x390@0,0 IN x:none | 390x844@0,0 IN x:none | - | 12 | - |
| mode-chip | always | 99x28@193,9 IN x:none | 99x28@193,9 IN x:none | 99x28@193,9 IN x:none | 103x36@193,5 IN x:none | 103x36@16,196 IN x:none | - | 14 | - |
| howto | always | none | none | none | none | none | - | - | - |
| walls-box | always | 259x60@830,44 IN x:none | 259x60@553,44 IN x:none | 259x60@510,86 IN x:none | 259x60@292,86 IN x:none | 195x82@98,110 IN x:none | - | 15 | - |
| consent-now | always | none | none | none | none | none | - | - | - |
| walls-menu | click the walls line (bottom left credit) | 250x463@16,569 IN x:583x40 | 250x463@16,257 IN x:583x40 | 250x463@16,209 IN x:583x40 | 250x463@16,123 OUT CLIP x:396x40 | 234x463@16,333 IN x:234x40 | n / y / n / n (Walls 5 cm (triangle)) | 11 | - |
| voxel-legend | V | 360x77@1544,94 IN x:none | 360x77@990,94 IN x:none | 360x77@904,94 IN x:none | 360x77@468,94 IN x:none | 358x77@16,94 IN x:none | n / n / n / - | 11 | - |
| pause | P or Esc | 1200x978@360,90 IN S x:44x44 | 1200x666@83,90 IN S x:44x44 | 1200x618@40,90 IN S x:44x44 | 812x288@16,90 IN S x:44x44 | 358x742@16,90 IN S x:44x44 | y / y / y / y (Close) | 12 | button"(cross)"; button[scale-down]"-"; button[scale-up]"+" |
| keys | K | 720x512@600,284 IN x:44x44 | 720x512@323,128 IN x:44x44 | 720x512@280,104 IN x:44x44 | 720x366@62,12 IN S x:44x44 | 366x820@12,12 IN S x:44x44 | y / y / n / y (Close) | 12 | button[htf-close]"(cross)" |
| settings | O | 940x780@490,150 IN x:44x44 | 940x736@213,16 IN x:44x44 | 940x688@170,16 IN S x:44x44 | 812x358@16,16 IN S x:44x44 | 390x844@0,0 IN S x:44x44 | y / y / n / y (Close) | 11 | noname input; button[settings-close]"(cross)"; button[help]"?" |
| feedback | B | 600x879@660,100 IN x:44x44 | 600x736@383,16 IN S x:44x44 | 600x688@340,16 IN S x:44x44 | 600x358@122,16 IN S x:44x44 | 358x812@16,16 IN S x:44x44 | y / n / n / y (Close) | 13 | button"(cross)" |
| share | L | 640x646@640,217 IN x:44x44 | 640x646@363,61 IN x:44x44 | 640x646@320,37 IN x:44x44 | 640x358@102,16 IN S x:44x44 | 358x643@16,101 IN x:44x44 | y / n / n / y (Close) | 13 | button"(cross)"; a"X" |
| rooms | 9 | 70x18@44,14 IN x:none | 70x18@44,14 IN x:none | 70x18@44,14 IN x:none | 70x18@44,14 IN x:none | 70x18@44,14 IN x:none | reopen-failed / y / y / - | 15 | - |
| frame-stats | F3 | 422x64@44,44 IN x:none | 422x64@44,44 IN x:none | 422x64@44,44 IN x:none | 422x64@44,44 IN x:none | 346x79@44,44 IN x:none | n / y / n / - | 12 | - |
| recording | F9 | 77x40@1369,38 IN x:none | 77x40@815,38 IN x:none | 70x18@44,14 IN x:none | 77x40@343,38 IN x:none | 106x25@268,681 IN x:none | n / y / n / - | 13 | - |
| course | Shift+G | 419x31@750,112 IN x:none | 419x31@473,112 IN x:none | 419x31@430,154 IN x:none | 419x31@212,154 IN x:none | 195x69@98,44 IN x:none | y / n / n / - | 13 | - |
| course-editor | Shift+B | 419x31@750,112 IN x:none | 419x31@473,112 IN x:none | 419x31@430,154 IN x:none | 419x31@212,154 IN x:none | 195x69@98,44 IN x:none | n / n / y / - | 13 | - |
| menu:pause.scene | P, Change scan | 1920x1080@0,0 IN x:44x44 | 1366x768@0,0 IN x:44x44 | 1280x720@0,0 IN x:44x44 | 844x390@0,0 IN S x:44x44 | 390x844@0,0 IN S x:44x44 | y / - / n / y (Close) | 12 | button[scenes-close]"(cross)"; button"(star)" |
| menu:pause.share | P, Share this scene | 640x646@640,217 IN x:44x44 | 640x646@363,61 IN x:44x44 | 640x646@320,37 IN x:44x44 | 640x358@102,16 IN S x:44x44 | 358x643@16,101 IN x:44x44 | y / - / n / y (Close) | 13 | button"(cross)"; a"X" |
| menu:pause.drone | P, Drone | 1920x994@0,86 IN S x:44x44 | 1366x682@0,86 IN S x:44x44 | 1280x634@0,86 IN S x:44x44 | 844x304@0,86 IN S x:44x44 | 390x758@0,86 IN S x:44x44 | y / - / n / y (Close) | 11 | button[drone-close]"(cross)"; button"1"; button"2"; button"3" |
| menu:pause.radio | P, Controls | 1920x1080@0,0 IN x:44x44 | 1366x768@0,0 IN S x:44x44 | 1280x720@0,0 IN S x:44x44 | 844x390@0,0 IN S x:44x44 | 390x844@0,0 IN S x:44x44 | y / - / n / y (Close) | 13 | button[radio-close]"(cross)" |
| menu:pause.howtofly | P, How to fly | 720x512@600,284 IN x:44x44 | 720x512@323,128 IN x:44x44 | 720x512@280,104 IN x:44x44 | 720x366@62,12 IN S x:44x44 | 366x820@12,12 IN S x:44x44 | y / - / n / y (Close) | 12 | button[htf-close]"(cross)" |
| menu:pause.settings | P, Settings | 940x780@490,150 IN x:44x44 | 940x736@213,16 IN x:44x44 | 940x688@170,16 IN S x:44x44 | 812x358@16,16 IN S x:44x44 | 390x844@0,0 IN S x:44x44 | y / - / n / y (Close) | 11 | noname input; button[settings-close]"(cross)"; button[help]"?" |
| menu:pause.replays | P, Replays | 560x130@680,475 IN x:44x44 | 560x130@403,319 IN x:44x44 | 560x130@360,295 IN x:44x44 | 560x130@142,130 IN x:44x44 | 358x130@16,357 IN x:44x44 | y / - / n / y (Close) | 15 | button"(cross)" |
| menu:pause.rooms | P, Fly with others | 560x386@680,347 IN x:44x44 | 560x386@403,191 IN x:44x44 | 560x386@360,167 IN x:44x44 | 560x358@142,16 IN S x:44x44 | 358x408@16,218 IN x:44x44 | y / - / n / y (Close) | 13 | button"(cross)" |
| menu:pause.course | P, Course: a new random course | 419x31@750,112 IN x:none | 419x31@473,112 IN x:none | 419x31@430,154 IN x:none | 419x31@212,154 IN x:none | 195x69@98,44 IN x:none | n / - / n / - | 13 | - |
| menu:pause.measure | P, Measurements | 560x487@680,296 IN x:44x44 | 560x487@403,140 IN x:44x44 | 560x487@360,116 IN x:44x44 | 560x358@142,16 IN S x:44x44 | 358x723@16,60 IN x:44x44 | y / - / n / y (Close) | 13 | button"(cross)" |
| menu:pause.import | P, Import rates from Betaflight | 560x427@680,327 IN x:44x44 | 560x427@403,171 IN x:44x44 | 560x427@360,147 IN x:44x44 | 560x358@142,16 IN S x:44x44 | 358x449@16,198 IN x:44x44 | y / - / n / y (Close) | 15 | button"(cross)" |
| menu:pause.cinema | P, Cinema mode (on / off) | 527x25@697,1039 IN x:none | 527x25@420,727 IN x:none | 527x25@377,679 IN x:none | 422x44@211,330 IN x:none | 195x81@98,747 IN x:none | n / - / n / - | 13 | - |
| menu:pause.sound | P, Motor sound: on - turn off | 70x18@44,14 IN x:none | 70x18@44,14 IN x:none | 70x18@44,14 IN x:none | 70x18@44,14 IN x:none | 70x18@44,14 IN x:none | y / - / - / - | 15 | - |
| menu:pause.feedback | P, Report a bug or an idea | 600x879@660,100 IN x:44x44 | 600x736@383,16 IN S x:44x44 | 600x688@340,16 IN S x:44x44 | 600x358@122,16 IN S x:44x44 | 358x812@16,16 IN S x:44x44 | y / - / n / y (Close) | 13 | button"(cross)" |
| menu:pause.flyBySound | P, Fly by Sound here | 439x278@1469,710 IN x:none | 391x248@963,428 IN x:none | 368x234@900,394 IN x:none | 776x47@34,100 IN x:none | 359x60@16,150 IN x:none | n / - / n / - | 15 | - |
| helper | P, Controls, My controller is not in the list | error | error | error | error | error | - | - | - |
| sonic-start | ?sonic=start | 1920x1080@0,0 IN S x:none | 1366x768@0,0 IN S x:none | 1280x720@0,0 IN S x:none | 844x390@0,0 IN S x:none | 390x844@0,0 IN S x:none | n / - / - / - | 13.6 | - |

Wroclaw 70b50d42 with the walls stand-in, ?render=off:

| panel | opens with | 1366x768 | 844x390 | Esc / again / outside / control | min font | no name or symbol only |
|---|---|---|---|---|---|---|
| controls-first | first visit | 1366x768@0,0 IN S x:44x44 | 844x390@0,0 IN S x:44x44 | - / - / - / - | 13 | button[radio-close]"(cross)" |
| credit | always | 378x57@16,671 IN x:378x40 | 378x57@16,44 IN x:378x40 | - | 11 | - |
| hud | always | 1366x768@0,0 IN x:none | 844x390@0,0 IN x:none | - | 12 | - |
| mode-chip | always | 99x28@193,9 IN x:none | 103x36@193,5 IN x:none | - | 14 | - |
| howto | always | none | none | - | - | - |
| walls-box | always | 0x8@683,44 IN x:none | 0x8@422,44 IN x:none | - | - | - |
| consent-now | always | none | none | - | - | - |
| walls-menu | click the walls line (bottom left credit) | 250x463@16,257 IN x:378x40 | 250x463@16,105 OUT CLIP x:378x40 | n / y / n / n (Walls 5 cm (triangle)) | 11 | - |
| voxel-legend | V | 246x47@1104,94 IN x:none | 246x47@582,94 IN x:none | n / n / n / - | 11 | - |
| pause | P or Esc | 1200x666@83,90 IN S x:44x44 | 812x288@16,90 IN S x:44x44 | y / y / y / y (Close) | 12 | button"(cross)"; button[scale-down]"-"; button[scale-up]"+" |
| keys | K | 720x512@323,128 IN x:44x44 | 720x366@62,12 IN S x:44x44 | y / y / n / y (Close) | 12 | button[htf-close]"(cross)" |
| settings | O | 940x736@213,16 IN x:44x44 | 812x358@16,16 IN S x:44x44 | y / y / n / y (Close) | 11 | noname input; button[settings-close]"(cross)"; button[help]"?" |
| feedback | B | 600x736@383,16 IN S x:44x44 | 600x358@122,16 IN S x:44x44 | y / n / n / y (Close) | 13 | button"(cross)" |
| share | L | 640x646@363,61 IN x:44x44 | 640x358@102,16 IN S x:44x44 | y / n / n / y (Close) | 13 | button"(cross)"; a"X" |
| rooms | 9 | 560x386@403,191 IN x:44x44 | 560x358@142,16 IN S x:44x44 | y / n / n / y (Close) | 13 | button"(cross)" |
| frame-stats | F3 | 422x64@44,44 IN x:none | 422x64@44,44 IN x:none | n / y / n / - | 12 | - |
| recording | F9 | 760x56@303,94 IN x:122x36 | 70x18@44,14 IN x:none | n / y / n / n (Don't show again) | 13 | button[rec-notice-close]"(cross)" |
| course | Shift+G | 420x50@473,86 IN x:none | 420x50@212,86 IN x:none | n / n / n / - | 13 | - |
| course-editor | Shift+B | 420x50@473,86 IN x:none | 420x50@212,86 IN x:none | n / n / n / - | 13 | - |
| menu:pause.scene | P, Change scan | 1366x768@0,0 IN x:44x44 | 844x390@0,0 IN S x:44x44 | y / - / n / y (Close) | 12 | button[scenes-close]"(cross)"; button"(star)" |
| menu:pause.share | P, Share this scene | 640x646@363,61 IN x:44x44 | 640x358@102,16 IN S x:44x44 | y / - / n / y (Close) | 13 | button"(cross)"; a"X" |
| menu:pause.drone | P, Drone | 1366x682@0,86 IN S x:44x44 | 844x304@0,86 IN S x:44x44 | y / - / n / y (Close) | 11 | button[drone-close]"(cross)"; button"1"; button"2"; button"3" |
| menu:pause.radio | P, Controls | 1366x768@0,0 IN S x:44x44 | 844x390@0,0 IN S x:44x44 | y / - / n / y (Close) | 13 | button[radio-close]"(cross)" |
| menu:pause.howtofly | P, How to fly | 720x512@323,128 IN x:44x44 | 720x366@62,12 IN S x:44x44 | y / - / n / y (Close) | 12 | button[htf-close]"(cross)" |
| menu:pause.settings | P, Settings | error | error | - | - | - |
| menu:pause.replays | P, Replays | error | error | - | - | - |
| menu:pause.rooms | P, Fly with others | error | error | - | - | - |
| menu:pause.course | P, Course: a new random course | error | error | - | - | - |
| menu:pause.measure | P, Measurements | error | error | - | - | - |
| menu:pause.import | P, Import rates from Betaflight | error | error | - | - | - |
| menu:pause.cinema | P, Cinema mode (on / off) | error | error | - | - | - |
| menu:pause.sound | P, Motor sound: on - turn off | error | error | - | - | - |
| menu:pause.feedback | P, Report a bug or an idea | error | error | - | - | - |
| menu:pause.flyBySound | P, Fly by Sound here | error | error | - | - | - |
| helper | P, Controls, My controller is not in the list | error | error | - | - | - |
| sonic-start | ?sonic=start | 1366x768@0,0 IN S x:none | 844x390@0,0 IN S x:none | n / - / - / - | 14.4 | - |

Drawn under the GPU lock (Wroclaw 1366x768 and 844x390):

| panel | opens with | 1366x768 | 844x390 | Esc / again / outside / control | min font | no name or symbol only |
|---|---|---|---|---|---|---|
| controls-first | first visit | 1366x768@0,0 IN S x:44x44 | 844x390@0,0 IN S x:44x44 | - / - / - / - | 13 | button[radio-close]"(cross)" |
| credit | always | 378x57@16,671 IN x:378x40 | 378x57@16,44 IN x:378x40 | - | 11 | - |
| walls-menu | click the walls line (bottom left credit) | 250x463@16,257 IN x:378x40 | 250x463@16,105 OUT CLIP x:378x40 | n / y / n / n (Walls 5 cm (triangle)) | 11 | - |
| voxel-legend | V | 246x47@1104,94 IN x:none | 246x47@582,94 IN x:none | n / n / n / - | 11 | - |
| pause | P or Esc | 1200x666@83,90 IN S x:44x44 | 812x288@16,90 IN S x:44x44 | y / y / y / y (Close) | 12 | button"(cross)"; button[scale-down]"-"; button[scale-up]"+" |
| course | Shift+G | 420x50@473,86 IN x:none | 78x97@383,142 IN x:none | n / n / n / - | 12.75 | - |
| course-editor | Shift+B | 420x50@473,86 IN x:none | 420x50@212,86 IN x:none | n / n / n / - | 13 | - |
| menu:pause.flyBySound | P, Fly by Sound here | 391x248@963,428 IN x:none | 776x47@34,100 IN x:none | n / - / n / - | 15 | - |
