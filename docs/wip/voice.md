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

Stage V2 transcription, echo filter and the pin: DONE

- [x] `tools/listen/transcribe.py` (PyAV decode to 16 kHz mono, faster-whisper large-v3 at words.py's revision edaa852,
      CUDA float16, beam 5, temperature 0, no carry-over, word timestamps, HF_HUB_OFFLINE=1, exit 3 when model.bin is
      absent, never downloads; language from manifest.device.locale, `auto` fallback, detected language wins at
      probability 0.9 or more (estimate); drops Whisper's own no-speech rule 0.6 / -1.0 and the per-language list
      `tools/feedback/hallucinations.json`; one remark per sentence (cut after `.?!` followed by a pause of 0.5 s,
      estimate); `--filter` mode runs only the drop rules for tests). Package commits 93cbb4a, b06fa6c, 1bafe47.
- [x] `tools/analyze.ts`: transcribes voice.webm when no `--transcript` is given (`--no-transcribe` skips; the
      transcriber takes GPU_LOCK, default C:/dev/.gpu-lock, itself; voice written as `<out>/<id>/.voice.webm` for the
      run and removed; transcript.json kept next to summary.md); the echo filter (RULES.echoWindowMs 3000,
      RULES.echoWer 0.4, both estimates; WER of tools/listen-words.ts); echo remarks stay in analysis.json, out of
      summary.md, the share-safe page and the spot scores; `transcript.dropped/echo/language/modelRevision` and
      `alignment.driftMs` (last echo lag minus first echo lag) filled. Commit 93cbb4a.
- [x] Unit tests `test/transcribe.test.ts` (9: echo on, echo off control, drift from echoes, fake transcriber called /
      skipped / failing, transcribe.py exit 3 with an empty model dir and nothing written, drop rules and sentence
      split). NEG OK against a58053a (8 of 8 failing on the old code). `test/analyze.test.ts` folder case now passes
      `--no-transcribe` (its clean package has voice and no transcript).
- [x] End-to-end on this GPU, synthetic voices only (`test/transcribe-e2e.test.ts`, opt-in SHRAMKO_VOICE_E2E=1;
      builder `test/fixtures/make-voice-e2e.py` + `voice-e2e-tts.ps1` (ASCII) + `voice-e2e-sentences.json`):
      4 passed. Max WER 0 in en, es, pl, ru; max |start - truth| on the session clock: en 42, es 64, pl 42, ru 36 ms
      (bound 300); the lesson line tagged echo in all four (WER 0, 112-140 ms after its speech event). Controls fired:
      offset moved by 2 s gives 2042 / 2064 / 2042 / 2036 ms (over 300); echo filter off leaves the line among the
      remarks in all four. 10-minute track (20 sentences, en): 20 found, mean +35 ms, max |delta| 90 ms, slope
      -0.43 ms/min, drift -4 ms over 10 min. Evidence: package `evidence/listen/VF-1-transcribe.json`.
      The first run (faster-whisper's built-in VAD) FAILED: starts 270-510 ms early in en/es, up to 6.5 s off in pl/ru,
      the pl line merged with a sentence (not echo), long track max 27.95 s; fixed by one Whisper window per stretch of
      speech with the first word set to the VAD onset (measured on en/pl/ru before the fix: first word = window start).
- [x] Package checks: vitest transcribe, analyze, segments, session, replay, report (+ e2e skipped): 108 passed,
      4 skipped; `pnpm typecheck` exit 0.
- [x] Simulator: `git submodule update --init`, `pnpm install --frozen-lockfile` (exit 0), `packages/sonic-fpv` pinned
      to 1bafe47 (fetched from local C:/dev/ShramkoSonicFPV branch voice-feedback; in no remote);
      `apps/fly/src/sonic-session/replay-segments.ts` re-exports `lessonSegments`, `LessonSegment`,
      `SegmentedPackage` from `@shramko/sonic-fpv`. `tools/bench/test/sonic-int-replay.test.ts` +
      `sonicrec-replay.test.ts` (unchanged): 39 of 39 on b06fa6c and again on 1bafe47 (src, lessons, locales identical);
      typecheck apps/fly 0, tools/bench 0. No new simulator test, so no negative control there.

Package branch head after V2: 1bafe47 (voice-feedback).

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
- V2: the voice-activity filter runs in transcribe.py (Silero via faster_whisper.vad, no padding for onsets, windows
  padded 0.4 s), not as `vad_filter=True` inside transcribe(): measured, the built-in filter put starts seconds off.
- V2: the GPU lock is taken by analyze.ts for each transcription (as listen-words.ts does), so the e2e run is not
  wrapped in an outer lock (it would deadlock); the one manual experiment held C:/dev/.gpu-lock by one blocking command.
- V2: the echo filter applies whatever `device.headphones` says (a pilot repeating the app's line word for word within
  3 s is rare; the line stays in analysis.json).
- V2: a failed transcription is an error of that package (exit 1), not a summary without remarks.

## For the lead before the merge

- Merge package branch voice-feedback (head 1bafe47, local only in C:/dev/ShramkoSonicFPV) into the package main and
  push it first; then re-pin the simulator's `packages/sonic-fpv` to the pushed commit (this lane pinned 1bafe47 in a
  local commit, as lane sonic-beacon did; the pin is in no remote until then).
- Simulator diff of the lane: `packages/sonic-fpv` and `apps/fly/src/sonic-session/replay-segments.ts` (a re-export)
  plus this file. Probe 5 of the plan: run `pnpm analyze -- test/fixtures/session-voice-two-lessons.zip --out <dir>
  --transcript test/fixtures/voice-two-lessons.transcript.json` in the pinned package and compare the analysis.json
  digest with the lane branch.
- Consent / privacy sentence to add (English, for the lead to place in the consent panel text and the privacy page if
  they do not say it; not checked in this lane, the texts are outside its paths): "With your permission, the author
  may have a program on his own computer write down what you said in the recording and match it with your flight; this
  stays on that computer and is not sent to any online service."
- The first run on real recordings is the owner's decision and must stay on this machine (local Whisper, offline;
  output outside every git tree; an online agent gets at most summary.share-safe.md, and only if the owner allows).
- Owner's command: `pnpm analyze -- <package.zip> --out <dir>` in the package with SHRAMKO_LISTEN_PY
  (U:/venvs/shramko-listen/Scripts/python.exe on this machine) and SHRAMKO_LISTEN_CACHE (U:/cache/shramko-listen).
- The package's `test/` is globbed by the simulator's vitest: `test/transcribe-e2e.test.ts` is skipped there unless
  SHRAMKO_VOICE_E2E=1; `test/transcribe.test.ts` runs a system `python` (exit-3 and filter cases, no model, no GPU) and
  is skipped when no python is found.
- `tools/report.ts` of the package: skip a literal `--` argument as analyze.ts does, or `pnpm report -- <zip>` fails
  under pnpm 11 (owner-facing command in the plan).
- Fly by Sound: nothing changes for a pilot in V1 (offline owner tool); no sound-mode need.
- Consent text: whether the panel's consent and the privacy page cover automated transcription and analysis was not
  checked (voice-feedback-plan.md section 7); decide before the first run on real recordings.

## Not verified

- Anything on real recordings (by rule: synthetic packages only; the first real run waits for the owner).
- Rate drift of a real browser's MediaRecorder against performance.now(): the synthetic 10-minute track measures the
  transcriber's timing only (-4 ms over 10 min); a real device's clock drift shows in `alignment.driftMs` (from echoes)
  on real packages.
- Thresholds of transcribe.py (no speech 0.6 / -1.0, language switch 0.9, sentence pause 0.5 s), the hallucination
  list, and the echo numbers 3 s / 0.4 on real microphones and rooms: estimates; on synthetic voices the echo line came
  in at WER 0 and 112-140 ms after its event.
- Timing on real speech with noise, music or the simulator's sound under it (synthetic track: voice plus -60 dBFS noise).
- Whether the consent panel and the privacy page already cover automated transcription (texts outside this lane).
- The thresholds of tools/feedback/rules.ts: estimates, never measured.

## Cost notes

- V1: about 25 replies. Most turns went to reading report.ts and the plan slices to learn the shapes; a short
  "how to read a package and run a tool" entry in the package's AGENTS.md (readPackage strict/lenient, run-tool, the
  pnpm `--` trap) would have saved two or three. Writing the fixture and the tool in one go each kept it cheap.
- V2: about 50 replies (over the 30 aim). Most went to the end-to-end path: finding the Python env and model cache (no
  env vars set; U:/venvs, U:/cache), a session id under 16 characters, the Write tool turning \u escapes into letters
  (two fixes), and a failed first GPU run (built-in VAD timing). A note in the package's AGENTS.md naming
  SHRAMKO_LISTEN_PY / SHRAMKO_LISTEN_CACHE on this machine and the id rule, and a tiny timing probe on one language
  before the full e2e, would have saved about ten.
