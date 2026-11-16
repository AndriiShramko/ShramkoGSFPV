---
type: status
status: in-work
summary: Lane editfix - why the course edit mode (Shift+B) does nothing for the owner on his laptop
created: 2026-11-16
---

# Lane editfix (train 3)

The owner's report of 2026-11-16 (translated): he entered the editing and cannot move around the scene, cannot select a
gate, Add gate shows nothing, Exit does nothing; the top menu bar hangs and that is all; Escape works, menus switch.
His laptop: Windows, RTX, 144 Hz, Chrome, keyboard and mouse, layouts ru/pl/en.

## Status

- [x] E1.1 branch editfix from origin/main 88ee98c3; release build of it (exit 0); walls stand-ins in dist/walls.
- [~] E1.2 probe tools/bench/scripts/edit-mouse-probe.mjs written (the owner's path with the mouse); cases running.
- [ ] E1.3 case x step table, causes, what E2 changes.

## Reading of the code before measuring (guesses, not measured)

- The edit mode does not leave the pointer lock by itself: openEdit (apps/fly/src/app/builtin/course.ts 878-969) never
  calls an unlock; the lock is let go only by play.ts's 250 ms frame tick through MouseLook.sync() when a cursor window is
  in the page (play/mouse-look.ts CURSOR_WINDOWS has '.course-editor').
- An armed drone keeps the mode in 'fly' (course/editor/fly-mode.ts modeStep): the view is suspended (view-mouse.ts
  suspend), clicks and the view keys go to the flight. A pilot who presses Shift+B in the air gets that.
- The edit keys go by event.code (course/editor/keys.ts, view-mouse.ts onKey), so a layout alone should not matter.
