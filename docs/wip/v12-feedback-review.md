# v0.12 review of lane v12-feedback (independent review)

Reviewer: one agent, one pass over `v03-lead..v12-feedback` (112 files, about 20 000 lines), worktree `C:/dev/gsfpv-v12-feedback`. Lane head when the review started: `cf412d0`. Rules as in `docs/wip/v12-feedback.md`: commit locally, never push, deploy, SSH or touch the live admin; one commit per defect with a test that fails before the fix. What a sound feels like is not judged here.

## Status

- [x] 0 Read: plan sections 8 and 9, the lane's Status, the spec, `AGENTS.md`, `contract.ts` (session types), the whole API side (`sessions.py`, `session_delivery.py`, `sessions_admin.py`, the `server.py` and `admin.py` diffs, `nginx.conf`, `compose.yml`), and on the page side `recorder.ts`, `consent.ts`, `voice.ts`, `voice-command.ts`, `send-control.ts`, `upload.ts`, `transfer-view.ts`, `panel.ts`, `session.ts`, `survey*.ts`, `store.ts`, `registry.ts`, `platform.ts`, `resume.ts`, `save.ts`, `frames.ts`, `clock.ts`, `manifest-input.ts`, `replay-control.ts`, `replay-view.ts`, `replay-host.ts`, the admin tab and the site's sound page.
- [x] F1 privacy: a hurried second press of T gave consent before the question was heard
- [ ] more findings below (each: probe first, a test that fails before the fix, the fix, one commit)

## Findings

### F1 (privacy, fixed) A second press of T agreed to recording before the question had been read out

`Recorder.pressRecord()` took the second press as the pilot's yes at once: `confirm()` called `getUserMedia` in that press. The first press only speaks `rec.ask` ("May I record this flight and your voice? ...", and `rec.minor` before it for a minor) and does not wait for it. Step 8 had the right rule for U ("a key struck twice in a hurry agrees to nothing": the question must have been read out) and the lane's own words for its U bug say a hurried press must not consent; T, which opens the microphone, did not have it. With the microphone permission already granted for the site (Chrome keeps it), a double tap of T started a voice recording with no prompt and no explanation heard, and for a minor skipped the guardian line.

Probe: four tests written first against the unchanged recorder (a say that settles only when the line ends, as the page's `sayVia` does): all four failed (the second press had asked for the microphone, `mic.asked` was 1 instead of 0; the time to answer ran out while the question was still being read). Fix, `apps/fly/src/sonic-session/recorder.ts` and `session.ts`: the recorder takes the promise `say` returns and counts a press as the answer only after every line of the question has been said or `readMs` (20 s, as for U) has passed, so a hidden tab cannot lock the pilot out; the time to answer (`askMs`, 30 s) starts when the question has been heard. A `say` that returns nothing (the Node fakes) means nothing to wait for, so every older test is unchanged. The helper's Start button is unchanged (its tick is the consent and nothing is read). Tests: `sonicrec-recorder.test.ts` 4 new (hurried press ignored, minor's two lines, the reading limit, the timer's start), `sonicrec-feature.test.ts` updated to wait for the question as a person must. Not judged: how long a pilot needs to hear the question.

## Refuted

(a claim I suspected and a probe showed to be wrong)

## Not read

`replay-player.ts`, `replay-voice.ts`, `replay-open.ts`, `replay-check.ts`, `format.ts`, `admin/sessions/model.ts`, the browser harnesses under `tools/bench/src/sonicrec-*.ts` (beyond `sonicrec-local.ts`'s structure), `serve-csp.mjs`, `smoke-release.mjs`, the site's `verify.mjs` and `a11y.mjs` changes, `deploy/README.md`, the four-language texts other than English (read only where a fix touches them), and the evidence files.
