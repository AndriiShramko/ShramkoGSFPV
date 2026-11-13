---
type: wip
status: active
summary: Lane connect - any controller plugged in goes through the setup and flies; stage C1 turns the owner's real DJI RC 2 session into evidence and a regression test
created: 2026-11-13
---
# Lane connect

Branch `connect` from `rc2-lna` b05df5e6 (origin/main 2a5ac433 was already in it: 0 commits to merge), worktree
`C:/dev/gsfpv-train1-base`. Ports 5780-5799.

## Status
- [x] C1.1 rc_bridge.py `--replay` takes a `--record` file at its recorded pace, `--start`/`--end` seconds; tests; fixture `packages/input/test/fixtures/dji-rc2/owner-session-2026-11-13.jsonl` (session 2, seconds 0-205)
- [x] C1.2 replay of session 2 on a local release of b05df5e6 (the live logic): `tools/bench/scripts/rc2-session-probe.mjs` (62905033, f890d090), timeline below; screenshots `U:/Temp/gsfpv-train2/shots/connect-session-a-*.png`
- [x] C1.3 (f890d090) verdict below; the bottom path fixed in the wizard (`packages/input/src/spring.ts`, `calib.ts`); `packages/input/test/owner-rc2-session.test.ts` 12 passed; neg control NEG OK (old calib.ts: 'bottom'); packages/input 262 of 262; a6-reference with app-centre-throttle, -ui, app-hid-source, app-known-controller, app-dji-rc2-lna 68 of 68; typecheck input and fly 0
  - [x] page proof of the fix: the "obey" record (`U:/Temp/gsfpv-train2/connect/obey.jsonl`, the owner's record with the throttle at 364 from 9.0 to 14.5 s) on the old build, run `obey-old` (`U:/Temp/gsfpv-train2/connect/session-obey-old.json`): Let go measured with the throttle at the bottom, check at 54.3 s, throttleRest 'bottom', after Fly 'zero' why 'wizard' to 80 s (the bug on a page, 0 page errors). Same record on a release of adf12c25 (source of f890d090), run `obey-new` (`U:/Temp/gsfpv-train2/connect/session-obey-new.json`, fly 70, end 140): Let go done 12.0 s with the throttle at 364, check 54.3 s, throttleRest 'centre', check screen "Chosen automatically: your throttle stick rests in the centre", at Fly 70.1 'centred' why 'wizard', 70.7 why 'seen'; armed 85.2 (throttle 1282), 4.67 m at 90; 0 page errors, 8980 answers. Shots `U:/Temp/gsfpv-train2/shots/connect-session-obey-new-{check,flight-100}.png`
  - [x] centre-throttle-probe.mjs on the same release, :5780, under the GPU lock (`U:/Temp/gsfpv-train2/connect/centre-new.json`): pass, dji-centred 4 of 4, dji-flip 5 of 5, dji-bottom 3 of 3 checks, 0 page errors
- [x] C1.4 (c3bca3d3 adds `logB` to the session probe) rates in Facts; the page logs one 36-byte record per physics tick that received any answer, identical or not; measured growth 1616 B/s; verdict in For the lead

## Facts (measured)
Record `U:/Temp/gsfpv-train2/rc2/rc2-rec-20261113.jsonl` (67134 lines), split at the first gap over 3 s
(`U:/Temp/gsfpv-train2/connect/persec.py`):
- session 1: lines 0-2954, 46.4 s; stir at 3-14 s, then every value 1024 to the end (the wizard did not get further).
- session 2: lines 2955-67133, 1004.4 s (about 17 minutes, not 9), 64179 answers, 63.9 answers/s, median gap 15 ms,
  longest gap 157 ms, 11037 gaps of 0 ms (two answers with the same ms), 60106 of 64178 answers equal to the one
  before. Throttle: 91.8 % of answers exactly 1024, 7.2 % below 1004, 0.85 % above 1044.
- session 2 by second (throttle T, yaw Y, pitch P, roll R, left dial L): 1-8 all sticks stirred; 9-12 rest; 13-14 T at
  the bottom; 16-17 T at the top; 19-21 T at the bottom; 23-24 Y high; 27-28 P high; 30-31 R high; 50-54 L up, down,
  up; 59 T bottom; 65-66 L up then down; 84-86 T up (to 1684); 87-89 L up; 90-93 T at the bottom; 94-99 T 447-1110;
  111-135 T mostly 364-1024; 143-154 T bottom and back; 155-198 flight with R, P, Y corrections and T between 485 and
  1099 (medians 506-935, below the centre); 228-243 sticks to the ends again.
- Fixture: the first 205 s of session 2, 13105 lines, t rebased to 0.
- Spring snaps in session 2 (from the last sample beyond half the travel to the first within 0.15 of the middle):
  16 to 95 ms over 59 returns of the four sticks (throttle 39, yaw 6, pitch 7, roll 7); every rest is exactly 1024.

Replay of session 2 (run `a`, `U:/Temp/gsfpv-train2/connect/session-a.json`): local release of b05df5e6 on :5780, the
bridge `--replay <fixture> --dev --port 5781`, headless Chrome 157.0.8103.52 (bypassCSP; the page's socket to 47310
sent to 5781, because the owner's real bridge holds 47310), scene 887f27aa, Fly pressed at record 70.1 s. 12812
answers reached the page in 200 s (64.1 per second), 0 page errors.
- Wizard (record seconds): stir 0.7-9.5; Let go active 11.0, measured 11.7 with every stick at 1024; throttle screen
  12.6, its push began at 14.1 with the throttle at 364 (he lowered it first, then up: done 16.7 at 1684; the screen
  then wants it down: 19-20, yaw screen 20.0); yaw push 23.8, pitch 28.3, roll 31.3; arm screen 33.4-53.4 (the left
  dial: on = dial down, -1); check screen 54.3. On the check screen he lowered the throttle (59, the check's
  "throttle low") and flipped the dial down and up (65-66).
- Stored: throttle ch 3 not inverted, min -1 max 1 (center = bottom); yaw ch 4, pitch ch 2, roll ch 1; arm = axis
  ch 5 threshold -0.75 on below; throttleRest 'centre'; no mode switch, no known entry.
- Style: 'zero' (why none) while on the Controls screen (no profile); at Fly 70.1 'centred' why 'wizard'; at 70.7
  'centred' why 'seen' (RestWatch: centre). It stayed centred to the end.
- Motors and height: armed 85.2 (throttle up, the centred start), 4.67 m by 88; throttle to the bottom at 90 ->
  crashed at about 92 (full descent into the ground); respawn 4.11 m; armed 117.5, held 4.11 m with the stick at the
  centre to 160; from 160 the stick below the centre: down to the ground by 164, then the motors start and stop
  about every 0.5 to 3 s (armed/disarmed 13 times 166-197) while the stick stays 0.2-0.7 below the centre.

C1.4, the page's handling of 64 answers per second (run `obey-new`, record pace, release adf12c25):
- Controller 63.9 answers/s (record); page 64.1 answers/s handled (8980 in 140 s; run `a` 12812 in 200 s); longest
  gap in session 2 157 ms; gaps over 100 ms: 3 in 1004 s (193.4 s: 140 ms; 472.1 s: 155 and 157 ms), over 50 ms: 13.
- Path of one answer (read in code): `controls.ts` push -> arm gate update -> `session.input` -> `simclock.ts` push
  (ring buffer, no allocation) -> `runner.enqueue` (one `Float32Array.from` per answer) -> `Runner.stepOnce`
  (`packages/sim-core/src/runner.ts:741-756`) writes one 36-byte record per 1 ms tick that received any answer,
  identical to the one before or not.
- Flight log the runner keeps (`bytesKept()`, sampled every 100 ms): 65520 B at 70.1 s, 178308 B at 139.9 s:
  1616 B/s (44.9 records/s of 36 B; answers that land in the same tick share one record). Cap `DEFAULT_MAX_BYTES`
  32 MiB: reached after about 5.8 h of flight at this rate (arithmetic on the measured 1616 B/s).
- A held gamepad already sends a keep-alive every 20 ms (`apps/fly/src/devices/gamepad.ts` KEEPALIVE_MS), 50/s;
  the identical answers are also the bridge's keep-alive for the 100 ms stale gate (`controls.ts` tick).

## The flow
Owner's session 2 against the page, as replayed: Controls -> "Fly through the RC bridge" -> the wizard walks on the
sticks (no presses) -> check screen at 54 s -> Fly. The screens line up with every move in his record (each move
comes right after its screen), so the replay's timeline is taken as his.

## Decisions
- C1.1: a record replay starts at the page's connection (the bridge opens its source when a page connects), as the
  real bridge's record starts when the first answer is passed on. At the record's end the source returns nothing, so
  the bridge says "no answer" as for a controller switched off. The read loop skips its 10 ms poll pause for a paced
  source (`paced = True`), else answers with the same ms would drift.

- C1.3: the fix sits in the wizard, where the rest is stored: a throttle seen to snap back to the same middle from
  above and from below (SpringWatch: past half the travel, inside 0.15 within RETURN_MS 200 ms, then still 500 ms
  within 0.04; all landings within SAME_TOL 0.03) is stored as rest 'centre' whatever the Let go step sampled.
  resolveStyle is unchanged, so review M4 stays: a centre seen now never beats a wizard bottom; a radio throttle
  with no spring never shows the snap (40 simulated pilots of sim/human.ts, 0 radios read as a spring, every
  gamepad-like pilot read as one). RETURN_MS and SAME_TOL are estimates (RETURN_MS = twice the owner's longest
  measured snap, 95 ms).
- The wizard's Let go text ("Thumbs off, throttle all the way down") was not changed: with the fix it no longer
  decides the style of a spring stick.

## For the lead
- Verdict on the lead's reading: NOT reproduced. The replay of his record through the page (logic of release
  73beb77e plus the LNA page change) measured Let go at 11.7 s with the throttle at 1024 (he lowered it at 13.0, on
  the throttle screen), stored rest 'centre' and flew 'centred' (why: wizard, then seen). What his hands did in
  flight (throttle held 0.2-0.7 below the centre for 45 s, arming moves) looks like an FPV pilot, and the page under
  the centred style keeps the drone on the ground there with the motors starting and stopping; whether his live page
  flew 'zero' cannot be read from the record (no clicks, no style in it). Two ways his live page could have been
  'zero' that the record cannot show: a saved choice 'zero' on that profile from an earlier session (Recalibrate and
  Set again keep it), or a press of "Change to From zero" on the check screen.
- The path the lead described is real one second away: a pilot who obeys "throttle all the way down" at Let go at
  once gets rest 'bottom' and 'zero' (old calib.ts on the "obey" variant of his record: 'bottom'). Fixed at the cause
  (f890d090); proven on a page: the obey record on the new release stores 'centre' and flies 'centred' (Status), and
  centre-throttle-probe passes 3 of 3 variants (the FPV from-zero variants included).
- C1.4 verdict: nothing in the page's handling of 64 answers/s is wasteful enough to change. The cost per answer is
  a few small calls and one 32-byte allocation; the log grows 1.6 KB/s, comparable to a held gamepad's 50/s
  keep-alive. Dropping repeats would save at most the record bytes (the log), not the gate's keep-alive; that change
  sits in `packages/sim-core/src/runner.ts` (stepOnce: skip a record equal to lastApplied), outside this lane, and is
  not recommended now (log readers and the replay hash were not checked for it).
- Not in this lane: session 2 has 3 answer gaps over 100 ms (140 ms at 193.4 s, during his level flight); the stale
  gate in `controls.ts` tick disarms after 100 ms of silence, so such a gap may disarm an armed drone. Whether one of
  the 13 disarms at 166-197 s in the replay came from it was not separated.
- Seen on the check screen at 1600x900 (shot `connect-session-obey-new-check.png`): the throttle-style row is half
  under the sticky Fly bar (its text shows through behind the buttons).
- Not in this lane's files, found by the replay: in the centred style a stick held below the centre on the ground
  makes the motors start and stop every 0.5-3 s (13 times in 31 s), and full down from 4.7 m crashed (about 92 s);
  both are `apps/fly/src/play/centre-pilot.ts` / AutoArm behaviour.
- The owner's real bridge (python rc_bridge.py --record U:\Temp\gsfpv-train2\rc2\rc2-rec-20261113.jsonl, PID 38364)
  was still listening on 47310 during this stage; it was not touched. The probe uses its own port.

## Not verified
- The live page's state during his session (style, saved choice, presses): only his stick record exists.
- CPU time per answer in the page (not profiled; the C1.4 verdict rests on the code path and the log growth).
- Whether the check screen's throttle-style row comes out from under the Fly bar by scrolling (one screenshot only).
- Which of the replay's disarms at 166-197 s came from the stale gate and which from the centred pilot.

## Cost notes
- C1 first worker: most turns went to reading the wizard's centre and throttle steps and the throttle-style
  builtin before the replay could say what happened; the replay itself answered the question in one run.
  Cheaper: run the replay first and read code only where the timeline points.
- C1 pass 2: about 20 turns; the most went to waiting on the 6-minute build and the two page runs. Cheaper: the
  rebuild in the background as the first command (done), and the probe sampling `bytesKept()` from the start so the
  log size needed no extra run.
