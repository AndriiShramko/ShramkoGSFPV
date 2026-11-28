# w1-dialog: the generate dialog asks WHERE (train 5, R2 of w1-diag)

Branch w1-dialog (from w1-anchor), work copy C:/dev/gsfpv-t7-n-share. Design: C:/dev/.gsfpv-lanes/designs/w1-diag.md,
Design proposal, point R2. The owner's brief line 667 (ideas b, c, d). Temp folder U:/Temp/gsfpv-train4/w1-dialog.

## Status

- [x] S1 Here and Whole scan in the dialog, the hint line (idea d), four locales, tests in generate-dialog.test.ts
  - [x] generate-dialog.ts: `CourseWhere` ('here' | 'scan'), `DEFAULT_WHERE` = 'here', the where row replaces the spread row, `hint`
  - [x] course.ts: the dialog opens on Here every time; the level is still remembered; the sound mode's direct press keeps course.spread
  - [x] locales fly/course en, es, pl, ru: course.gen.spread* replaced by course.gen.where*; whereHint
  - [x] gap-gen-accept.mjs presses gen-where-here/scan (gen-spread-* on an older build)
  - [x] NEG OK on w1-anchor (`-t "w1-dialog"`: missing course.gen.whereTitle, DEFAULT_WHERE undefined)
- [ ] S2 Add here: the old gates kept as occupied places, the new part from the drone, the ring closed; tests with NEG; the link after Add here
- [ ] S3 acceptance by mouse at 1536x730@1.25 on a local release build (en, pl; keys alone); gen4-generate-dialog live check and probe; gates.py

## Design vs code

- The design calls Here 'the level's compact or whole spread from the anchor'; the code already had a spread row (Compact,
  Whole scene). Two rows asking the same would be a crutch: the spread row became the where row (Here = compact, Whole
  scan = wide), so the request contract (`CourseAsk.spread`) and the link (`g2.<seed>.<level><c|w|v>`) are unchanged.
- The dialog no longer writes the stored spread (course.spread): Here is the default every time it opens, as the lead asked.

## What the owner does

(S3)

## Claims

1. The dialog offers Here (pressed when it opens) and Whole scan; Here asks a compact course, Whole scan the wide one; one
   line says the course is laid where the drone is and how to have it elsewhere; the texts exist in en, es, pl, ru.
   `npx vitest run tools/bench/test/generate-dialog.test.ts` -> 9 passed. NEG on w1-anchor (`-t "w1-dialog"`) -> NEG OK.

## Not verified

- apps/fly typecheck: 27 errors, all in apps/fly/src/sonic/, from the stale packages/sonic-fpv work tree (checked out at
  53a5675, the pin is 9ac7876; not touched here, as in w1-anchor). No error in a file of this lane.
- No person, phone or real controller took part.

## For the lead

(S3)

## Cost notes

- S1: about 15 replies; most went to reading course.ts slices and the probes that press the dialog's buttons.
