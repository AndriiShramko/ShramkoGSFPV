---
type: review
lane: sonic-keys
reviewed: 2026-11-11
branch: sonic-keys 07f219d (from origin/main 31b1453); package packages/sonic-fpv 09535b7 -> ced1110
---

# Review of the sonic-keys branch (independent, by the code and separate tests)

The reviewer wrote it in Russian; translated to English by the lead on 2026-11-12 for the repo's rule (B18: no Cyrillic outside locales). Package paths are relative to `C:\dev\ShramkoSonicFPV` (ced1110), simulator paths to `gsfpv-v03`.

## Verdict

**Do not merge until B1 and B2 are fixed.** The keys work as claimed (claims 1, 3, 4, 5 confirmed; 2 and 6 confirmed with caveats). Claim 7 refuted: old recordings of the `ears-game` lesson replay as `fail` after the change, not as `older-build`.

## Seven claims

### 1. A digit 1-3 during the prompt's sound counts: **confirmed**
- `src/lesson/runner.ts:1570`: when the current step is `sound`, its sound has started (`playT0 !== null`), the next step `ask` is marked `early` and the digit is in range, the sound step is dropped, the question becomes current and the answer is written (`answer`, `via: 'key'`). The sound's repeats and the question's line are skipped.
- `early: true` is set only on the headphone check's questions (`headphoneBlocks`, runner.ts:1435 on).
- Simulator: `apps/fly/src/sonic/digit-key.ts:45` now lets a digit through on `host.active`, not `host.asking`. `apps/fly/src/sonic/lessons.ts:524` hands it to the runner in any running lesson.
- Confirmed by: the package's `test/sonic-keys.test.ts` (a); the page probe R6 (evidence r6: trial 1 answered before its question, `answer.got` said).
- Edge: a digit pressed while the line "Sound n of 3" is still being said (the trial's sound not started) is not taken and gets "Not taken. Nothing to answer now". Intended; test (a) "a digit before the sound plays is not taken".

### 2. Every press gets a sound and a word at once in en, es, pl, ru: **confirmed with a caveat**
- A taken digit: the `answer`/`yes` sound at once (runner.ts:1594). "Taken: n" is the first step of what follows and cuts the current speech (`interruptNext`).
- A refused digit: the `answer`/`no` sound at once, the word through `refuse` (runner.ts:1615-1618).
- All four locales have the 6 `answer.*` keys. `listen:words` PASS per the status.
- **Caveat 1.** The refusal's word is queued (`sayLines(..., false, t)`) behind everything already handed to the voice, it does not cut it. Pressed during the intro, "Not taken" is said only after the whole intro; only the sound comes at once. Repeated presses pile up the queue, see I1.
- **Caveat 2.** When the lesson is paused (`pausedAt`) or not begun (`!began`), `refuse` is silent (runner.ts:1616), yet `LessonHost.answer` still returns `true`, so the key is swallowed. In the simulator with the flight held the handler returns earlier (digit-key.ts:45, `paused()`), so in practice this concerns only a pause through the lesson's menu. Not checked whether the lesson's menu holds the flight.

### 3. No long silence and no silent skip: **confirmed**
- While a question waits, every 7 s (`ASK_REMIND_S`) the waiting sound and "Waiting for your answer..." (runner.ts:745-753), never over speech.
- After 20 s the skip comes and is said, "No answer. Skipping.", before the next step (runner.ts:634).
- A skip with key 0 is said, "Skipped.".
- In the v0.12 mode (`speechWait: 'v012'`, a test hook only) everything is as before.

### 4. After a failure only the failed question again, without the intro; Z also without the intro: **confirmed**
- `endEarsAttempt` keeps the sides answered wrong or not at all (runner.ts:1538-1539).
- `headphoneBlocks` builds the next attempt from them without the intro step: the intro is added only when `earsRetry === null`.
- Z calls `startBlock(..., again = true)`, which drops `say` steps with `once` (runner.ts:600).
- The package's test (d) checks it.
- Harmless note: after a failure "headphones.unclear/swapped" and the `retry` line are still said. That is not the intro.

### 5. "Behind or in front" removed, lessons not broken: **confirmed**
- `headphoneBlocks` keeps only `side` (left, right, left), question ids `...:side`.
- The `ears-game` game asks its own "where" with four options; not touched.
- Tests `review.test.ts` D3 rewritten for three `side` questions.
- My check: recordings of `ears-game` and `ears-shapes` made with the new runner run to the end and replay as `pass`.
- The key `headphones.q-front-back` stays in `src/i18n/catalog.ts:120` and the locales, unused. Harmless.

### 6. Flight code, goals and recording not touched beyond what is described: **confirmed with caveats**
- In `apps/fly` changes only in `sonic/digit-key.ts`, `sonic/lessons.ts`, `sonic/feature.ts` (a comment), `sonic/sound-panel.ts` (the sound's kind) and `sonic-session/replay-control.ts` (the diagnostic field `cueMismatches`). Physics, goals and frame recording untouched.
- "A digit in a flying lesson answers 'Not taken'": low risk. The handler calls `preventDefault` and `stopPropagation` for any digit in a running lesson. No other digit bindings found in `apps/fly/src` (grep `Digit`/`Numpad`/`key === 'n'` found only the survey in `survey-keys.ts`, which works with the flight held, when this handler is silent), so nothing useful is swallowed. But every extra digit in flight queues a line that pushes back the lesson's flight hints (I1).
- Beyond the status: the package change also alters flying lessons with a question (`name-shape` in `shapes-cube` and others, `pushShapeQuestion`): now "Taken: n" before right/wrong, and a reminder every 7 s while flying. Intended, but the status describes it only for the headphone check.
- R5's one-frame difference under load is **noise, not a risk**:
  - events 40 of 40 equal;
  - one frame of about 3016 differs: the fanfare recorded 2 frames later than derived;
  - the panel's verdict needs `minCueShare` 0.95 (`src/replay/compare.ts:28`), here 0.9997;
  - the same mechanism as any sound tied to the end of speech: the speech-end mark and the recording's frame drift apart when frames drop; the branch's logic is not involved;
  - only the probe's strict `cueShare === 1` fails;
  - not checked: whether the same happened on origin/main under load.

### 7. Old recordings do not break on replay: **refuted**
- Versions were raised only for `ears-headphones` and `ears-glossary` (to 3). Their old recordings replay as `older-build`: described and safe.
- But the runner's new behaviour (the "Taken" word, the answer sound, reminders, the skip word) acts in **all** lessons with questions, whose versions stayed 2: `lessons/ears-game.json:84`, also `shapes-cube` (question `name-shape`) and others.
- Check: a temporary package worktree on 09535b7; recorded `ears-game`, `ears-shapes` and `ears-headphones` with the old runner through `test/helpers/record.ts` (speech-end marks), then `checkSession` with the old and the new code. Worktree and files removed.

| recording (old runner) | replay 09535b7 | replay ced1110 |
|---|---|---|
| ears-game (42 answers) | pass, 239/239, sounds 0.9998 | **fail**, 226 differences, sounds 0.6458 (first: `answer.got at 39350 ms is derived by the replay but not recorded`) |
| ears-shapes (no questions) | pass | pass |
| ears-headphones | pass | older-build (note lesson-version), as described |

A `fail` verdict per `compare.ts:88-95` means "the recording does not match its own build", i.e. a defective recording. Pilots' `ears-game` recordings (and those of lessons with `name-shape`) made before the change would be shown as broken after the release.

## Findings

### Blocks the merge

**B1. The submodule is pinned to a commit the server lacks.** `packages/sonic-fpv` -> `ced1110`. Per `git ls-remote origin` the package's GitHub has only `main` = 09535b7; ced1110 and the package's whole `sonic-keys` branch exist only locally. Scenario: merged into main, any fresh clone or CI fails `git submodule update` with "reference is not a tree". The status admits it. Push the package branch (or merge it into the package's `main`) first and move the pin if needed.

**B2. Old recordings of lessons with questions replay as `fail` (claim 7).** `lessons/ears-game.json:84` and `lessons/shapes-cube.json:86` (and every lesson where the runner asks) stayed version 2, though the runner now derives other speech and sounds for them. Scenario: a pilot recorded "the Game" on v0.13; after the release Replay says "the replay does not match" instead of "recorded with an older build". Cheap fix in the same package that must be pushed anyway for B1: raise those lessons' versions. Check: the same old recording must give `older-build`.

### Fix before the release

**I1. Refusals pile up in the speech queue and hold the lesson.** `runner.ts:1618`: each refusal is a new line with `interrupt: false`, never merged with the previous one. Measured on `RecordingHost` (`ears-headphones`):
- 1 extra digit in the intro moves its end from 14.8 s to 17.0 s;
- 3 digits in 0.6 s move it to 21.4 s: three "Not taken. Nothing to answer now." in a row;
- a press every 1.3 s holds the lesson in the intro for ever: after 400 s the phase was still `intro`.

The owner's complaint as a scenario: a blind pilot does not understand that this is the intro and presses 1, 2, 3, hears three equal lines, and the intro drifts away. Proposal: a refusal cuts only the previous refusal, or is not queued when one is already queued. Keep the "no" sound on every press.

**I2. One extra digit while a question waits makes a new recording uncheckable.** A refusal leaves no event (`runner.ts:1615`, by design), but its line takes the speech, and the reminder waits for `!this.speaking(t)` (runner.ts:750). In the replay there is no refusal and the reminder comes at another time. Measured:
- a question waits 9 s, a 9 pressed in the 6th second: replay `fail`, `answer.waiting: recorded at 48267 ms, re-derived at 47400 ms (867 ms apart)`;
- without the press: `pass`;
- the same press in the 2nd second (before the reminder): `pass`.

Scenario: a pilot is unsure, presses 4, a second later 1; the recording was made with the new build and the Replay panel says "does not match". Options: record the refusal as an event the replay derives, or do not tie the reminder's time to speech caused by a refusal.

**I3. A wrong digit during a trial's sound gets a wrong line.** `runner.ts:1570` -> 1577: with a digit out of range (4-9) during the sound the early answer does not fire, the current step stays `sound`, and `refuse(null)` is called: "Not taken. **Nothing to answer now.**". That is false, since 1-3 are taken at that moment. Should be `refuse(next.question.options)` -> "Press a key from 1 to 3". R6 misses it: it accepts both `answer.not-now` and `answer.range` (`tools/bench/src/sonic-int-review.ts`, R6's last check), and the status's evidence said exactly `answer.not-now`.

### Later

- R5's strict check `cueShare === 1` (`sonic-int-review.ts`, R5) sometimes fails falsely under load. Better compare with `minCueShare` or allow a 2-frame shift explicitly.
- If a retry after a failure gets one or two trials right, the check passes: the score counts only the current attempt's answers (`endEarsAttempt`, share of `count('side')`). Allowed by the plan, but with three options it can be passed by guessing.
- In the control test `sonic-int-digits.test.ts` (case "a handler that does not look at the pause") the check `expect(seen.stopped).toBe(true)` was removed with no reason in the diff. A control case; no effect on behaviour.
- Dead key `headphones.q-front-back` (catalog and 4 locales) and the type `'front-back'` in `EarsAnswer`.

## Not checked

- Did not listen to the `target.answer` sound and did not run browser runs or the full gates (per the task).
- Did not record a flying lesson with `name-shape` (`shapes-cube`) with the old runner: its `fail` is inferred from the code (the same `answer` -> `answer.got` path as `ears-game`).
- Did not check whether the lesson's menu (the runner's pause) holds the flight and what digits do then.
- Did not compare R5 under load on origin/main.
- Did not check the es and pl texts for meaning, only that the keys exist (pronunciation checked by `listen:words` per the status).
