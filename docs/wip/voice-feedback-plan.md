---
type: plan
status: draft
summary: "Voice feedback of Fly by Sound pilots: what a recording package holds today (paths and lines), the design of an analyze-recording tool (local transcription, events on one clock, difficult spots, one-page Markdown plus JSON), what the package lacks, two stages with tests on synthetic recordings, privacy."
created: 2026-11-13
tags: [plan, feedback, sonic-fpv, gsfpv, privacy]
---

# Voice feedback: analyzing a pilot's recording (plan, 2026-11-13)

Goal (the owner, 2026-11-10/11, paraphrased): pilots comment on their flights by voice; every recording is to be
listened to in detail and turned into changes. Wanted: from ONE recording package, with no manual work, an agent gets a
one-page summary: what the pilot said and when, what happened at that moment (lesson and step, touches, retries,
skips, accepted and refused answers), and which places of a lesson were hard.

No code was changed for this plan. Paths are from the root of `gsfpv-v03`; the sound package is read through its
submodule copy `packages/sonic-fpv` (its source repository is `C:\dev\ShramkoSonicFPV`; per `AGENTS.md` it is changed
there and the pin is moved). Line numbers are of the working copies on 2026-11-13.

**Main finding:** most of the pipeline exists. The package carries flight, events and voice on one clock, and the sound
package's report tool (`packages/sonic-fpv/tools/report.ts`) already joins a transcript to the event timeline. What is
missing: the transcription step itself (Whisper is installed for another purpose and outputs no timestamps), lesson-by-
lesson handling in the report (it treats a package as one lesson), the difficulty detection, and the one-page format.

---

## 1. The recording package today

### 1.1 How it is made and sent

| Step | Where | What |
|---|---|---|
| Record (key T) | `apps/fly/src/sonic-session/recorder.ts:1-16` (header), `:154` (`T_KEY = 'KeyT'`) | First press asks by voice, second press (after the question was read out) agrees and calls getUserMedia, third press stops. |
| Only in Fly by Sound | `recorder.ts:342-348` | No sound-mode runtime: refused with `mode-off`. An ordinary (sighted) flight cannot be recorded. |
| Frames | `recorder.ts:420-432`, `packages/sonic-fpv/src/contract.ts:493-504` | 30 Hz `FlightFrame` {t, tick, p, v, q, s = [roll, pitch, throttle, yaw], c = ids of the cues sounding}. |
| Events | `recorder.ts:435-440`, `contract.ts:506-519` | Every `sonicEvent` of the mode, mapped onto the recording clock. While recording: all events; after the pilot's stop (survey running): speech only (`apps/fly/src/sonic-session/frames.ts:119-128`). |
| Voice | `apps/fly/src/sonic-session/voice.ts:1-3`, `:37` (`audio/webm;codecs=opus`), `:40` (`SLICE_MS = 1000`), `:180` | MediaRecorder, Opus in WebM, 1 s slices appended to `voice.webm`. Keeps recording through the survey after the stop (open answers are spoken). |
| Voice offset | `recorder.ts:390-397`; `packages/sonic-fpv/src/session/writer.ts:231-248` | `manifest.clock.voiceOffsetMs` = the moment `MediaRecorder.start()` was called, on the recording clock. |
| Sync marks | `recorder.ts:486-505` | `voice-sync.jsonl` (start called/event times, one mark per slice) is written next to the session in browser storage, **not into the package**. |
| Storage | `recorder.ts:13` | OPFS folder per session, flushed every second; recoverable after a crash (`writer.ts:346` ff.). |
| Pack | `apps/fly/src/sonic-session/registry.ts:149-158` -> `packages/sonic-fpv/src/session/package.ts:69-89` | `packSession` zips `manifest.json` plus the files the manifest lists (`src/session/manifest.ts:20`, `LISTED_FILES`), each checked by size and SHA-256. |
| Save locally | `apps/fly/src/sonic-session/save.ts:11-17`, `:52-70` | `fly-by-sound-YYYYMMDD-HHMMSS-<id8>.zip` via the save picker or a download. |
| Send (key U) | `apps/fly/src/sonic-session/send-control.ts:1-13`, `:76` (`U_KEY = 'KeyU'`) | First press asks ("send the recording, with your voice, to the author?"), second press after the question is the separate consent. Also the helper's Send button and a voice command when allowed. Minor without guardian: never sent. |
| Upload | `apps/fly/src/sonic-session/upload.ts`; server `apps/api/server.py:46-56`, `:1384`, `:1596` | NOT `/api/report`. `POST /api/session/start`, `POST /api/session/<id>/<n>` (1 MiB chunks), `POST /api/session/<id>/finish`, `GET /api/session/<id>`; token in `X-Session-Token`. |
| Server store | `apps/api/sessions.py:1-40` | `DATA_DIR/sessions/<S-YYYYMMDD-hex>/package.zip`, `meta.json`, `index.jsonl`; SHA-256 checked, fsynced before "stored"; server re-checks the minor rule (`:14-16`). Retention `SESSION_RETENTION_DAYS`, default 1826 days (`:65`). |
| Delivery | `apps/api/session_delivery.py:66-67`, `:211-212`, `:338-346` | The whole .zip as a Telegram document (up to 49 MiB) and as a Gmail attachment (up to 15 MiB); bigger: a message with a link to the admin. "Delivered" only when both channels confirm. |

`/api/report` (`server.py:9-21`) is the separate bug/idea/drone report form; it does not carry recordings.

### 1.2 Files inside the .zip (`contract.ts:547-555`)

| File | Present | Content |
|---|---|---|
| `manifest.json` | always | `contract.ts:557-580`: id, created/ended, complete, `app` {name, release = simulator commit from `/release.json`, sonic = sound package commit} (`apps/fly/src/sonic-session/session.ts:94-108`, `manifest-input.ts:69`), scene, track, lesson **at the start**, theme, `settings` (SonicPrefs: the sound settings), assists, device {userAgent, locale, audio rates and latencies, input, headphones as said, gpu}, consent {recording, voice, send, speechRecognition, minor, guardianConfirmed}, pilot {random id, optional nickname}, clock {startIso, frameHz, voiceOffsetMs}, files with SHA-256. |
| `flight.jsonl.gz` | always | Frames, gzip members of 90 frames (`writer.ts:89`). |
| `events.jsonl` | always | `SessionEvent` lines, canonical JSON. |
| `voice.webm` | with microphone | The pilot's voice, Opus/WebM. |
| `survey.json` | when answered | `contract.ts:599-606`: item, value, via (key/voice/skip), t. Open items are spoken into `voice.webm`. |
| `sim-log.json` | never today | The slot exists (`writer.ts:261`), but nothing in `apps/fly` calls `writer.simLog(...)`. |

What the events give for the analysis (`contract.ts:507-519`, `runner.ts:300`, `replay.ts:41-44`):

- lesson and attempt: `lesson` {lessonId, version, what: open, intro, attempt-start, attempt-pass, attempt-fail, block-pass, passed, leave, attempt};
- progress: `goal` {index, met/missed}, `gate` {gateId, index, missM}, `checkpoint`;
- collisions: `touch` {material, speed, pos};
- retries: `reset` {to checkpoint/start}; `key` with actions `reset.checkpoint`, `reset.start`, `repeat` (the pilot asked to hear a line again), `next`, `previous`, `next-lesson`, `previous-lesson`;
- answers: `answer` {item, value, via key/voice} = accepted; `answer` via `skip` = timed out (`runner.ts:652`); `key` with action `answer.refused` = a digit the runner refused (`runner.ts:300`, used by `replay.ts:104-107`);
- what the pilot heard: `speech` {key, text} (and `speech.end` markers), cue ids per frame;
- pauses: `session` pause/resume; `recording` start/stop/mic-denied; `send` status.

There is no explicit "lesson step" event: the step is known only through the last lesson `speech` key and the `goal` index.

## 2. Timestamps: one clock, already

- Recording clock (`apps/fly/src/sonic-session/clock.ts:1-10`): t = 0 when the recording starts, ms of `performance.now`,
  running through pauses. Frames and events are mapped onto it (`clock.ts:60-90`); a host clock that jumps (each lesson
  restarts the host clock) is re-anchored on `lesson open` and on samples more than 500 ms off, so time never goes back.
- Voice: `voice.webm` time 0 = `manifest.clock.voiceOffsetMs` on the recording clock. A transcript segment at `s` ms of
  the audio is at `s + voiceOffsetMs` in session time. `report.ts:398-424` already does exactly this.
- Wall time: `manifest.clock.startIso` + t.
- The replay app plays voice and frames on one AudioContext clock from the same offset
  (`apps/fly/src/sonic-session/replay-voice.ts:1-7`).

Limits of the alignment:

1. The offset is the time `start()` was CALLED; the browser's start event time is in `voice-sync.jsonl` only, outside
   the package. Expected error: tens of ms (not measured on real packages).
2. Rate drift of the voice against the flight was measured only over 6 s (`docs/wip/v12-feedback.md:98`: 0 ms
   spread). Ten-minute recordings are unmeasured; the per-slice marks that would show it are not in the package.
3. Events that arrive before the first frame of a recording get their arrival time (`clock.ts:50-52`).

For "what the pilot said near an event" a window of +-5 s is used, so 1 and 2 matter only if drift turns out to be
seconds; stage 1 measures it on the synthetic package, stage 2 ships the marks.

## 3. Speech recognition that exists

- `packages/sonic-fpv/tools/listen/words.py` (also `C:\dev\ShramkoSonicFPV\tools\listen\words.py`): faster-whisper
  1.2.1 on CTranslate2 4.8.5, model `Systran/faster-whisper-large-v3` pinned by revision, CUDA float16, beam 5,
  temperature 0, no VAD. Run through `pnpm listen:words` (`tools/listen-words.ts`), Python from `SHRAMKO_LISTEN_PY`,
  model under `SHRAMKO_LISTEN_CACHE` (`requirements.txt:8-11`), GPU lock `GPU_LOCK`.
- It is a check of the app's own spoken lines (WAV clips of local Windows voices), not of pilots. It reads WAV only
  (`soundfile`, `words.py:41-48`) and writes one joined `hyp` string per clip with **no timestamps** (`words.py:83-85`).
  It downloads the model when absent (`words.py:70-72`).
- Reusable: the environment, the pinned model, the GPU lock, the WER code of `listen-words.ts` (for the echo filter,
  section 4.2). Needed new: decode WebM/Opus (PyAV `av==18.1.0` is already a dependency of faster-whisper), segment
  and word timestamps, VAD on (long recordings, mostly silence and simulator sound), offline mode.
- The browser's speech recognition (`apps/fly/src/sonic-session/voice-command.ts`, consent `speechRecognition`) only
  listens for "send it"/"yes" and sends audio to the browser vendor; not usable and not wanted for analysis.

## 4. Replay today

- In the app (`apps/fly/src/sonic-session/replay-*.ts`): open a .zip or a stored session (`replay-open.ts:1-5`, strict
  then lenient read), cut it at `lesson open` events (`replay-segments.ts:1-12`, `lessonSegments` at `:63`), check each
  lesson with the replay core (`replay-check.ts:1-11`: re-derives the events and cues from the frames and compares; a
  verdict pass / older lesson build / fail), play frames, cues and the pilot's voice on one clock with a slider
  (`replay-player.ts:1-28`). Output is for a helper's eyes and ears; nothing is written out.
- In the sound package: `tools/report.ts` (`pnpm report -- <package.zip> [--transcript f] [--json f] [--md f]`,
  `:12-17`, format `shramko-sonic-report/1`) gives outcome, attempts with time/touches/gates/resets/path deviation,
  gates with legs and miss, totals, survey, replay check, warnings, and a timeline of events with
  `pilot said: ...` lines woven in from a Whisper-like JSON, SRT or VTT transcript (`:51-108`, `:398-424`). Never
  touches the network (`:3-4`).
- Gaps of `report.ts` for this goal: it uses `manifest.lesson` (the lesson at the start) for the title, the course and
  the replay check of the whole package (`:257-283`, `:374-396`), while a recording usually spans several lessons
  (`replay-segments.ts:1-2`); attempt numbers of different lessons mix; no step, no difficulty, no echo filter;
  the timeline is every event, not one page.

## 5. Design: `analyze-recording`

### 5.1 Command

```
analyze-recording <package.zip | folder of packages> --out <dir> [--lang auto|en|es|pl|ru]
                  [--no-transcribe] [--transcript <file>] [--share-safe] [--window-s 5]
analyze-recording aggregate <dir with analysis.json files> --out <dir>        (stage 2)
```

`--out` is required and must not be inside a git working tree (the tool checks for a `.git` above it and refuses).
No network: the transcriber runs with `HF_HUB_OFFLINE=1` and fails when the model is not in the cache.

Placement: the pure parts in the sound package (it owns the format, the reader, the replay core and `report.ts`):
`ShramkoSonicFPV/src/replay/segments.ts` (moved from `apps/fly/src/sonic-session/replay-segments.ts`, which already
imports only `@shramko/sonic-fpv`), `tools/analyze.ts` next to `tools/report.ts` (reusing `buildReport` per lesson),
`tools/listen/transcribe.py` next to `words.py`. The simulator gets the move by a pin bump and imports
`lessonSegments` from the package. The owner's wrapper (`gsfpv-v03/tools/feedback/analyze-recording.ts`) runs
the two steps on a folder of downloaded packages.

### 5.2 Steps

1. **Read.** `readPackage` strict, then lenient (as `replay-open.ts`); package problems become warnings in the output.
2. **Transcribe** (if `voice.webm` is present and no `--transcript` was given). `transcribe.py`: decode WebM with
   PyAV to 16 kHz mono; faster-whisper large-v3 (same pinned revision), language = `manifest.device.locale` with
   `--lang auto` as a fallback when the detected language differs with high probability; `vad_filter=True`,
   `word_timestamps=True`, `condition_on_previous_text=False`, temperature 0. Output `transcript.json`:
   `{"segments": [{"start", "end", "text", "noSpeechProb", "avgLogprob", "words": [...]}]}` in seconds of the audio:
   the shape `parseTranscript` already reads (`report.ts:62-75`). Drop segments with high `noSpeechProb` and known
   silence hallucinations (a short list per language, in a data file).
3. **Put on the session clock.** `t = start * 1000 + voiceOffsetMs`. Segments past the last event fall into the survey
   tail and are tagged `survey` with the open item whose prompt (`speech` event) came last.
4. **Remove the app's own voice (echo).** With speakers (`device.headphones = speakers` or unknown) the microphone
   hears the app's lines. A segment whose text matches a `speech` event text within +-3 s (word error rate under 0.4,
   the WER of `listen-words.ts`) is tagged `echo` and left out of the pilot's remarks (kept in the JSON).
5. **Cut by lesson.** `lessonSegments` (section 4); per lesson: `buildReport` metrics, title in the pilot's locale,
   replay verdict.
6. **Anchor every moment to a step.** Step anchor = the last lesson `speech` key before t (not `speech.end`, not host
   lines `rec.*`, `send.*`, `survey.*`) plus the current goal index. Key of a place: `lessonId@version#speechKey`.
   This is stable across recordings of the same lesson version, which makes comparison possible.
7. **Detect difficult spots** (rules with numbers in one config, each with a reason text):

   | Signal | Rule (initial thresholds, tuned in stage 2) |
   |---|---|
   | failed attempts | attempt-fail; a lesson with 3+ attempts before pass or leave |
   | retries | resets (key or event); 2+ resets within 30 s |
   | skip | `next-lesson` without a preceding `passed`; answers `via: skip` |
   | refused answers | `key` action `answer.refused`; 2+ in one question |
   | repeats asked | `key` action `repeat`: the pilot did not get the line |
   | collisions | `touch` events; 3+ within 10 s; speed over 2 m/s |
   | idle / lost | in flying phase, sticks near centre and speed under 0.2 m/s for 8+ s; or 15+ s from a lesson line to the next pilot action |
   | gate miss | `missM` over half the gate size |
   | session pause | `session` pause longer than 20 s |
   | remark near trouble | a pilot remark within +-5 s of any signal above (weight x2) |
   | remark words | per-locale phrase lists of confusion, sound complaints, praise (data files, English keys) |

   Spots closer than 10 s merge; each gets a score (sum of weights), the top five go on the page.
8. **Write.** `summary.md` (one page) and `analysis.json`; with `--share-safe` also `summary.share-safe.md` (section 7).

### 5.3 Output

`summary.md` (one page, in English, quotes verbatim in the pilot's language):

1. Header: session id, date, build (`app.release`, `app.sonic`), locale, input, headphones, length, voice yes/no,
   consent flags, minor yes/no, replay verdicts, data warnings (one line).
2. Lessons table: lesson (title, id@version), time, attempts, passed / not passed / skipped, touches, resets,
   repeats asked, refused answers.
3. Hardest places (top 5): time, lesson and step (the line the pilot last heard, shortened), what happened, what the
   pilot said within the window.
4. Pilot remarks: time, lesson/step, tag, quote, events within +-5 s (at most 15 rows; the rest in the JSON).
5. Survey answers (values, and the open answers' transcript).

`analysis.json` (format `shramko-voice-feedback/1`, for comparing recordings): session meta without nickname
(pilot random id only), build, per-lesson metrics, `spots[]` {key, t, lessonId, version, anchor, signals, score},
`remarks[]` {t, key, tag, text, echo, nearby}, transcript stats (segments, dropped, echo, language, model revision),
alignment (voiceOffsetMs, drift estimate when available), warnings. The aggregate command (stage 2) groups spots by
key across recordings and builds: "lesson X v2, line Y: hard in 4 of 7 recordings, 3 of them before build Z".

## 6. What the package needs (data gaps)

| # | Gap | Effect | Proposal | Contract change |
|---|---|---|---|---|
| G1 | `voice-sync.jsonl` not in the package (`recorder.ts:486-505`, not in `LISTED_FILES`) | Drift and start latency of the voice cannot be checked on a received package | List it as an optional file (or `clock.voiceStartEventMs` plus a drift sample in the manifest) | Yes: `SESSION_FILES`, `LISTED_FILES`, manifest validator, both repos |
| G2 | `report.ts` is one-lesson | Wrong title, replay check, attempts for multi-lesson recordings | Move `lessonSegments` into the package; report per lesson | No (code move) |
| G3 | No step event | Step only inferred from speech keys | Stage 1: infer. Stage 2 if inference is poor: `lesson` event `what: 'step'` with an index | Yes, and the replay comparer |
| G4 | No "comment here" marker | A remark cannot be pinned to a moment the pilot meant | A key (helper to choose) that writes a `key` event with action `comment.mark` and a short tone; the replay must ignore it | No new kind (key action is a free string); replay behaviour to check |
| G5 | Recording only in Fly by Sound (`recorder.ts:342-348`) | Sighted pilots cannot leave voice feedback this way | Product decision for the owner | Large: a recorder outside the sound mode |
| G6 | No simulator flight settings (drone preset, rates) in the manifest; `sim-log.json` never written | "Settings" means only the sound settings today | Optional `sim` block or fill `sim-log.json` | Yes |
| G7 | Lesson progress at the start is not in the package (`replay.ts:51`) | "Attempt 1" may be a returning pilot's fifth | Add progress of the lessons flown to the manifest | Yes |
| G8 | Echo of the app's speech in `voice.webm` with speakers | Remarks polluted by lesson lines | Stage 1: filter (5.2 step 4); the `speech` events already carry the text and time it needs | No |

## 7. Personal data

- A package holds a person's **voice**, free speech (may name people, places, health), a nickname, a user agent, and
  for Fly by Sound pilots it implies **vision status: health data** (GDPR Art. 9 special category). Minors may be in it
  (with a guardian's confirmation).
- The analysis runs **only on the owner's machine**: local Whisper (offline, model pre-fetched), no cloud speech
  service, no cloud LLM on the raw transcript, no upload of `summary.md` or `analysis.json` anywhere. Output in a
  folder outside every git tree (checked); never committed (`packages/sonic-fpv/AGENTS.md` already forbids committing
  real recordings).
- **Conflict to decide (owner):** an agent that reads the summary through a cloud API (Claude included) moves its
  content off the machine. Proposal: the full `summary.md` is for the owner's own reading; an online agent gets only
  `summary.share-safe.md`: no quotes, no nickname, no free text; tags, times, lesson/step keys and counts. Whether even
  that may go to an online agent is the owner's call, and must match what the pilot agreed to.
- Consent: the spoken question says "send the recording, with your voice, to the author"
  (`packages/sonic-fpv/locales/en.json:402`). Whether the panel's consent text and the privacy page cover automated
  transcription and analysis was not found in this pass: check before stage 1 ships; adjust the text if not.
- Retention and deletion: the outputs follow the package (`SESSION_RETENTION_DAYS`, five years by the privacy text);
  a deletion request removes the package on the server, in Telegram and mail, and the local `out/<session id>/`
  folder. `analysis.json` keys everything by the random session and pilot ids so this is findable.
- Already today the whole .zip (voice included) goes through Telegram and Gmail (`session_delivery.py`); this plan
  adds nothing there, but the owner should know the voice already sits in those two services.

## 8. Stages and tests

All tests use **synthetic** packages only (AGENTS.md rule). Each check has a negative control that must fail.

### Stage 1: works on today's packages, no format change

1. Move `lessonSegments` into `ShramkoSonicFPV/src/replay/segments.ts` with its tests; the simulator imports it
   (pin bump). Gate: existing `tools/bench` sonicrec replay tests unchanged and green.
2. Fixture: extend `packages/sonic-fpv/test/fixtures/make-session-fixture.py` (today one lesson, no voice) into a
   scripted two-lesson package: lesson A with three failed attempts, two resets in 20 s, a `repeat` key, a refused
   digit, a skipped answer, a touch cluster; lesson B left by `next-lesson`; a survey with an open item.
3. `tools/analyze.ts` with a hand-written transcript JSON (no audio): unit tests assert the lessons table, the spots
   (each scripted difficulty found, at the right time and key), remarks attached to the right step, survey tail.
   Negative controls: the fixture without its failures gives no spots; a transcript shifted by 10 s attaches remarks to
   other steps (the test asserts the difference).
4. `transcribe.py` local end-to-end (owner's GPU, not CI): local Windows voices (as `test/fixtures/measure-tts.ps1`)
   say five known sentences per language into WAV at known times, plus one lesson line at its `speech` time; encoded
   to Opus/WebM; packed with a known `voiceOffsetMs`. Pass: every sentence found (WER under the words check's bound),
   segment starts within 300 ms of the truth on the session clock, the lesson line tagged `echo`. Negative controls:
   manifest offset changed by 2 s must fail the 300 ms check; echo filter off must leave the line among remarks.
   Measures the drift on a 10-minute synthetic track as well.
5. Privacy checks: `--out` inside a git tree refused; transcriber with the model cache empty fails instead of
   downloading; `summary.share-safe.md` contains no transcript word (test greps it against the transcript).
6. Run on the owner's real packages locally; the owner reads two summaries against the replay in the app.

### Stage 2: package additions and comparison

1. G1 (sync marks into the package), G4 (comment marker), then G3/G6/G7 as the owner decides; each a contract change in
   both repositories with replay-check tests (old packages still read; new fields optional).
2. `analyze-recording aggregate`: group spots by key across recordings and builds; fixture: three synthetic packages
   of two builds; negative control: a spot key changed by lesson version must not merge.
3. Tune thresholds on real recordings with the owner (each change listed with the recordings it was tuned on).
4. Optional: a way to pull stored packages from the server over SSH into the local folder (like
   `tools/ideas/ideas.py` reads reports), instead of saving them from Telegram by hand.

## 9. Not verified

- Nothing was run: no test, no `pnpm report`, no Whisper. All statements are from reading code.
- Whether `report.ts` on a real multi-lesson package actually fails its replay check or only mislabels: read, not run.
- Whether PyAV decodes MediaRecorder WebM slices (no duration header) without errors; whether faster-whisper word
  timestamps are good enough on Russian and Polish pilot speech with simulator sound in the background.
- The real offset error (start called vs started) and drift on long recordings.
- The exact format of lesson `speech` keys (assumed stable per lesson line, which step anchoring relies on).
- Whether the replay comparer ignores a `key` event with an unknown action (needed for G4).
- Whether `manifest-input.ts` writes any simulator flight setting besides the sound settings (G6 read from the
  contract, not checked in full).
- The consent text of the recording panel (`sonicrec.consent.text`) and the privacy page: not located in this pass.
- That the submodule copy of `tools/report.ts` equals the current `C:\dev\ShramkoSonicFPV\tools\report.ts`.
- GPU time of large-v3 per recorded minute on the owner's machine.
