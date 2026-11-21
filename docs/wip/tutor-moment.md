# Lane tutor-moment (train 4)

The pilot's feedback, point 2, inside the sound package: a sound is taught at the action it belongs to (a "moment":
the flight freezes, the sound is named and played alone, the pilot is told what to do, the flight goes on), and the
first set of moments in the fast lessons. Plan: C:/dev/.gsfpv-lanes/designs/t8-plan.md (Part A2-A6, B 2, C 1, 4-7);
brief: C:/dev/.gsfpv-lanes/designs/t8-tutor-brief.md.

Base (host): 03624451b8deb79d179cc9a5d07adf22f1383773. Base (package): 719aaf5454ddb15677ad4dc090ac6faeab853e77.
Package branch: tutor-moment in packages/sonic-fpv of this copy (on no remote).

## Status

- [x] S1 contract: types in src/contract.ts, src/lesson/moments.ts stub, CuePlanner.setAudible, the loader accepts
  `moments`; package typecheck and tests pass (79 files, 1440 tests); package commit 12acc110d491d99fd5e65c305c0ee443f171ddcb;
  pin moved in the host; apps/fly and tools/bench typecheck pass; marker U:/Temp/gsfpv-train4/tutor-moment-contract.txt.
  NEG OK on 719aaf5 (test/moments-contract.test.ts).
- [ ] S2 the machine: freeze, what, the forms alone, do, resume, task, done; hint once; keys again / on / know; guide
  levels; test/moments.test.ts + NEG on the S1 stub.
- [ ] S3 the first set: the moments of the table in the fast lessons; their intro cue lines go; headphones.good once;
  cue.<id>.what and cue.<id>.do for all 28 sounds in four languages; test/named-sounds.test.ts; lesson versions bumped;
  host count tests updated.
- [ ] S4 the scripted pilot: test/first-set.test.ts in en, es, pl, ru (moving within 60 s, under 60 words before it, no
  prompt over two sentences, one new sound a moment, the set within 420 s, guide 'new' says only names); NEG on 719aaf5;
  host gates once; done marker; "What the owner should try".

### Where the code differs from the plan (one line each)

- The contract's `task: GoalDef | null`: the package's goal type is `Goal` (src/contract.ts), used as is.
- A new SessionEvent kind needs src/session/codec.ts (EVENT_KINDS, EVENT_KEYS, the reader) and tools/report.ts (its
  exhaustive switch): both changed, outside the owned list, the smallest change that compiles.
- The host reaches the planner only through SonicEngine: `setAudible?(cues)` added to SonicEngine (optional, so older
  engines and the host's fakes compile) and to src/audio/engine.ts (one line to the planner).
- test/named-sounds.test.ts exists already on the base (the rule "a sound with no words is named in the first lesson of
  its path"); S3 extends it rather than creating it.

## What the owner does

Nothing yet: S1 is the contract only; no pilot hears a change.

## Claims

1. A lesson may carry `moments`; the loader checks them (forms 2-3 s, far first, one sound once, the line keys), a
   moment event is written and read back, and `CuePlanner.setAudible` plans only the listed cues (null: as before).
   Proof: `cd packages/sonic-fpv && npx vitest run test/moments-contract.test.ts` - 6 passed; NEG OK on 719aaf5.

## Not verified

- No person, phone or real controller took part. Nothing is heard yet: S1 changes no lesson.

## For the lead

- Files changed outside the owned list (package): src/session/codec.ts, tools/report.ts, src/audio/engine.ts (see above).
- The package head of branch tutor-moment is on no remote; it must reach the package's main before the page ships.

## Cost notes

- S1: most replies went to finding the planner's output path and the codec's exhaustive lists; a map of "where a new
  SessionEvent kind must be added" in the package's AGENTS.md would save four reads.
