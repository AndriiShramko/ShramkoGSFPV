# Lane ux4a (train 4): one message service for the flight page

Design: C:/dev/.gsfpv-lanes/designs/voxux4.md, part ux4a. Owner's words: brief lines 555-556 (complaint U1: the
messages are tiny and gone before he reads them; a problem must say what it is and whom to tell).

## Status

- [x] A-1 logic + service + delegate (messages-logic.ts, ui/messages.ts, Hud.flash -> tell, fly.css, app/builtin/hud.ts reporter, locales fly/messages) - commit "ux4a A-1"
- [ ] A-2 kinds + history + key (course.ts call sites, Messages panel, top-row.ts button, keymap.ts Shift+H, keys locales)
- [ ] A-3 acceptance tools/bench/scripts/ux4a-messages-probe.mjs (render off, Wroclaw 70b50d42, mouse, 1536x730 dsf 1.25 and 844x390)

Notes on the design vs the code:
- The design's old-note test (course-hud-note.test.ts) is pure arithmetic and stays green untouched.
- Node tests mount the Hud in a fake DOM without `window`: MessageCenter.mount and render skip the window parts there.
- Hud.flash keeps its name and second argument (now unused, `_ms`); the same text twice while shown is one line.
- Probes that read `.hud-note` textContent now read every line of the stack joined (problems first, then newest).

Follow-up (after the merge, other lanes' files): scene-host rotation.failed, walls.ts bake.failed and the voxels
failure lines should call tell({ kind: 'problem', from, text, fix }) instead of hud.flash.

## What the owner does

(written at A-3)

## Claims

1. A message stays between 4 and 15 s by its length, a problem until closed, progress lines replace in place, the
   log keeps 50, at most 3 lines on screen with problems first. Proof: `npx vitest run tools/bench/test/messages-logic.test.ts`
   - 13 passed; negative control on origin/main: NEG OK.

## Not verified

(written at A-3)

## For the lead

(written at A-3)

## Cost notes

- A-1: most replies went to finding the consumers of `.hud-note` and the fake-DOM tests that mount the Hud without a window; a list of the Node tests that mount ui/hud.ts in the design would save two runs.
