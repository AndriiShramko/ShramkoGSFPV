# Lane voice (train 1): analysis of a Fly by Sound recording

Plan: docs/wip/train1-plan.md section 5; design: docs/wip/voice-feedback-plan.md (R15-R16, smallest).
Package worktree: C:/dev/sonic-voice, branch voice-feedback of C:/dev/ShramkoSonicFPV (from package main 83ce612).
Simulator worktree: C:/dev/gsfpv-voice, branch voice (from train1-base); in V1 only this file.

## Status

Stage V1 analysis (Node only, no GPU, no simulator change): DONE

- [x] Package worktree and install (pnpm install --frozen-lockfile in C:/dev/sonic-voice).
- [x] `src/replay/segments.ts`: `lessonSegments` moved from apps/fly/src/sonic-session/replay-segments.ts (imports
      only the package), exported from `src/replay/index.ts`; tests `test/segments.test.ts` (the three cases of
      tools/bench/test/sonic-int-replay.test.ts). Package commit 3abc8da.
- [x] Fixture: `test/fixtures/make-session-fixture.py` writes `session-voice-two-lessons.zip` (lesson A rings-first:
      three failed attempts, repeat key, touch cluster with a fast touch, two resets 15 s apart, a refused digit, a
      skipped answer, pass on attempt 4; lesson B rings-line: 9.5 s idle, left by next-lesson; first-flight survey with
      the open item `helped`) and `session-voice-clean.zip` (the same flight without the failures); voice.webm is a
      WebM magic number and zeros; transcript `voice-two-lessons.transcript.json` hand-written. The two older fixtures
      come out byte-identical (git status clean for them after the run).
- [x] `tools/analyze.ts` (`pnpm analyze -- <package.zip | folder> --out <dir> [--transcript f] [--share-safe]
      [--window-s 5] [--no-replay]`), rules `tools/feedback/rules.ts` (every number an estimate), phrase lists
      `tools/feedback/phrases.json` (en, es, pl, ru, \u escapes); `package.json` one script line. Tests
      `test/analyze.test.ts`. Package commit a58053a.
- [x] Checks: `pnpm vitest run test/analyze.test.ts test/segments.test.ts test/session.test.ts test/replay.test.ts
      test/report.test.ts`: 5 files, 99 tests passed; `pnpm typecheck` exit 0. Negative controls (neg_control.py
      against package main): segments NEG OK, analyze NEG OK. In-test controls: the clean fixture gives no spot; a
      transcript shifted by 10 s moves the first three remarks to other steps (asserted); the owner's summary holds
      every transcript word of 4+ letters while the share-safe page holds none.
- [x] `pnpm analyze -- test/fixtures/session-voice-two-lessons.zip --out <temp> --transcript ... --share-safe`
      through tools/run-tool.mjs: 2 lessons, 9 spots, 4 remarks; summary.md 42 lines; `--out ./x` inside the package
      tree refused (exit 2).

Package branch head after V1: a58053a (voice-feedback).

Stage V2 transcription and the pin: NOT STARTED. What V2 gets:
- `tools/analyze.ts` takes a transcript in the shape of `parseTranscript` (Whisper JSON, seconds on the voice clock);
  `transcribe.py` must write that shape (`{"segments": [{"start", "end", "text", "noSpeechProb", "avgLogprob",
  "words"}]}`); `analysis.json` already has `transcript.dropped`, `.echo`, `.language`, `.modelRevision` and
  `alignment.driftMs` set to 0 / null for V2 to fill, and `Remark.echo` (always false now) for the echo filter.
- The simulator side: pin `packages/sonic-fpv` to the package branch head, make
  `apps/fly/src/sonic-session/replay-segments.ts` re-export `lessonSegments` and its types from `@shramko/sonic-fpv`,
  run the sonicrec replay tests of tools/bench (`tools/bench/test/sonic-int-replay.test.ts`, which imports
  `lessonSegments` from replay-segments.ts and keeps its own copy of the three cases).

## Findings

- pnpm 11 passes a literal `--` to the script (`pnpm report -- x` prints "report: unknown option --", measured
  2026-11-13). `tools/analyze.ts` skips it; `tools/report.ts` (not this lane's) has the bug.
- The step anchor follows the last lesson line, so a key pressed in a new attempt before the goal line is said again
  belongs to the `retry` line (the fixture's repeat at 25 s is on `lesson.rings-first.retry`). That is the rule of
  plan 5.2 step 6; whether it reads well on real recordings is a stage-2 question (gap G3).
- The replay verdict of each lesson of the synthetic package is `older-build` (the frames are not a real flight).

## Decisions

- Rules left out of V1 (not in the fixture's scripted list): gate miss over half the gate size (needs the gate size
  per lesson), "15+ s from a lesson line to the next pilot action", the echo filter (V2). Idle is implemented on the
  frames (speed and sticks inside an attempt) and scripted in lesson B.
- "A remark near trouble (weight x2)" = the spot's score is multiplied by `remarkFactor` 2 when a non-survey remark
  lies within the window of the spot.
- The survey tail starts at the first `survey.*` speech event; a remark there is tagged `survey` with the item of the
  last `survey.item.<id>` prompt before it (null if none yet), and has no step key.
- Output goes to `<out>/<session id>/`, for one package and for a folder alike; in a folder each package's transcript
  is `<name>.transcript.json` next to it, and `--transcript` is refused.
- Remark tags come from word stems matched at a word start, the pilot's locale first, then English.

## For the lead before the merge

- Merge package branch voice-feedback (a58053a) into package main and push it first; V2 then pins the simulator to it.
- `tools/report.ts` of the package: skip a literal `--` argument as analyze.ts does, or `pnpm report -- <zip>` fails
  under pnpm 11 (owner-facing command in the plan).
- Fly by Sound: nothing changes for a pilot in V1 (offline owner tool); no sound-mode need.
- Consent text: whether the panel's consent and the privacy page cover automated transcription and analysis was not
  checked (voice-feedback-plan.md section 7); decide before the first run on real recordings.

## Not verified

- Anything on real recordings (by rule: synthetic packages only; the first real run waits for the owner).
- Rate drift of the voice against the flight (V2, synthetic 10-minute track).
- The thresholds of tools/feedback/rules.ts: estimates, never measured.

## Cost notes

- V1: about 25 replies. Most turns went to reading report.ts and the plan slices to learn the shapes; a short
  "how to read a package and run a tool" entry in the package's AGENTS.md (readPackage strict/lenient, run-tool, the
  pnpm `--` trap) would have saved two or three. Writing the fixture and the tool in one go each kept it cheap.
