# Lane sonic3: Fly by Sound in any scene, at any speed (train 3)

Stage Z1 (in place, built 98ef20d8) is the first part. Stage Z2 (design of speed and space, no code) is the second part.
Source references are to the sound package C:/dev/ShramkoSonicFPV, branch train3 (2ec8653), unless a path starts with apps/ or
packages/ (the simulator).

# Part 1 (Z1): switched on in place

The owner (message 51): "I already said that this flying by sound must be switched on for any scene." Today the way in is a
link to a new tab with a start screen (walk below). The design: one key and the pause item switch the mode ON IN PLACE, in the
same tab, scene and position; the same key switches it off. The `?sonic=` pages stay for the lessons.

## What stops a pilot today (live walk of 2026-11-14, release 4e9148cd1005)

Probe `tools/bench/scripts/sonic-walk-probe.mjs`, results `U:/Temp/gsfpv-train3/sonic3/walk-live-<scene>.json`, shots
`U:/Temp/gsfpv-train3/shots/sonic-walk-<scene>-<n>-<step>.png`. Same seven steps on Tunis 887f27aa and Wroclaw 70b50d42:

1. `/en/fly/?scene=<id>`: "Before you fly" warning, press Understood (fresh profile only).
2. Scan download (Tunis 19.1 MB with walls 6.1 MB; Wroclaw scan only, walls 0.0 MB).
3. "The scan is ready. How will you fly?" controls question; press Keyboard.
4. Flight. Wroclaw's top bar: "No walls yet: C builds them." Walls (collisions) off.
5. Escape: pause menu; the last tools item "Fly by Sound: blind and low-vision pilots (opens in a new tab)",
   href `/en/fly/?sonic=scan&scene=<id>&sz=1`, target _blank.
6. The press opens a NEW TAB (the flown tab stays paused behind it). The new tab shows the mode's start screen: "Start the course
   from the beginning (Lesson 1 of 28)" first and highlighted, "I already fly by sound: fly this scan" second, the path choice,
   the headphone check. Nothing sounds; status stays `loading` (4.5 minutes, nothing pressed).
7. Only a second press ("fly this scan") starts the free flight, which loads the scan again from the network and places the craft
   at the scan's own spawn (lessons.ts open: `mode.place(start)`), not where the pilot was.

What stops him: (a) a new tab (a blind pilot loses the flown tab; a screen reader announces a new document); (b) a start screen
whose first and highlighted button is the course from lesson 1, not this scene; (c) a second press; (d) a second download and a
new position; (e) silence until (c). On Wroclaw additionally the walls are built only after (c).

## The direct road (design, built in 98ef20d8)

- Key Backslash (KEYMAP action `flyBySound.toggle`, `when: 'always'`) and the pause item "Fly by Sound here" switch the mode
  on over the running flight (apps/fly/src/sonic/in-place-model.ts, in-place.ts); the same key and item switch it off.
- Free flight = the scan-free template on the scene flown now at its size; the craft's pose is the lesson's start
  (feature.ts scanLesson `here`, lessons.ts openFree(lesson, { here })).
- A scan without walls: lessons.ts `wallsForFree` builds them through wallsThen (called, not changed) and says so.
- First-timer line `sonic.say.inPlaceIntro` once; second pause item "Fly by Sound lessons" keeps the new-tab link.
- Browser proof is its own stage (release build first), on Tunis and Wroclaw with the walls stand-in.

# Part 2 (Z2): speed and space

The owner (message 51): "At the speed of a normal FPV flight it becomes a mess of sounds. There is no clear sense of the
direction to fly. Maybe show the direction as the line we fly along on drones, the light one. But the obstacles must be shown
too. [...] At a slow speed the sound shows obstacles at some distances; at another speed it must sound at other distances [...]
Think how to make checks so that it is a working way for fast flights too."

The consultant (Bartlomiej Mroz, vault note of 2026-11-14): front and back confusion is the limit of a generic HRTF in
headphones; movement resolves it (teach the pilot to turn slightly and listen); never put important information on the HRTF
alone (another timbre for what is behind); approach by loudness, pulse tempo and brightness; time to impact is a good choice;
pick an HRTF from a set by a short listening test; a gentle reverb moves sounds out of the head.

## 1. Why it is a mess at speed today (read from the code)

Every number below is a constant of the code (file named); the seconds are that constant divided by the speed (arithmetic, not
a measurement). The shipped speed caps: lessons/*.json maxSpeedMps 0 to 5 (12 lessons at 3), scan-free.json 5.

| Cue (code) | Reach today | Unit | at 3 m/s | at 8 m/s | at 15 m/s |
|---|---|---|---|---|---|
| Hazard onset, closing (sampler.ts ONSET_TTC_S) | 2.5 | s | 2.5 s | 2.5 s | 2.5 s |
| Hazard onset, near (sampler.ts ALWAYS_HEARD_M) | 0.8 | m | 0.27 s | 0.10 s | 0.05 s |
| Ray reach (sampler.ts DEFAULT_SAMPLER_CONFIG.rangeM) | 40 | m | 13 s | 5 s | 2.7 s |
| Pulse tempo (theme safety.ttcFarS; race 3) | 4 | s | 4 s | 4 s | 4 s |
| Pulse floor by distance (theme safety.pulseDistM) | 2 | m | 0.67 s | 0.25 s | 0.13 s |
| Urgent, ducks the rest 9 dB (rules.ts URGENT_TTC_S, URGENT_DISTANCE_M, URGENT_DUCK_DB) | 1.5 s or 0.4 m | s, m | 1.5 s | 1.5 s | 1.5 s |
| Hazard level and brightness (rules.ts LEVEL_REF_MPS, urgency distance = ttc x 1 m/s) | ttc based | s | ok | ok | ok |
| Hazard low-pass and reverb by true distance (theme safety.distFarM; race 10) | 12 | m | 4 s | 1.5 s | 0.8 s |
| Open-way chime (freeway.ts FREE_TTC_S) | 3 | s | 3 s | 3 s | 3 s |
| Open-way passage depth past the obstacle (freeway.ts FREE_DEPTH_M) | 1.5 | m | 0.5 s | 0.19 s | 0.10 s |
| Target hum rate, near to far (theme target.nearM, farM) | 2 to 40 | m | 0.67 to 13 s | 0.25 to 5 s | 0.13 to 2.7 s |
| Target miss roughness (theme target.missFullM, or 15 % of distance) | 3 | m | geometry | geometry | geometry |
| Beacon point ahead (beacon.ts BEACON_AHEAD_M) | 6 | m | 2 s | 0.75 s | 0.4 s |
| Shape trace (planner.ts SHAPE_RANGE_M) | 12 | m | 4 s | 1.5 s | 0.8 s |
| Speed ticks (theme speed: 1 to 9 Hz up to 15 m/s; race 14 Hz) | rate | Hz | 2.6 Hz | 5.3 Hz | 9 Hz |
| Height tone (theme height.metresPerStep) | 0.5 | m per step | geometry | geometry | geometry |

What this means at 15 m/s: the beacon's point is 0.4 s ahead, so it jumps from point to point several times a second (the way
has no steady sound); the target hum is at its nearest rate for most of every leg; the shape trace and the hazard brightness
are about the last 0.8 s; a side wall within 0.8 m pulses whether it threatens or not. And everything sounds at once: up to 3
hazard voices (sampler.ts MAX_HAZARD_VOICES), the open-way chime, the hum, the shape trace, the height tone, the speed ticks,
the room bed and the gate notes, 9 layers. Pulse density at the near end (soft theme): 3 hazards at periodNearMs 110 (about 9
pulses per second each) plus ticks at 9 Hz plus the hum at up to 8 Hz is about 44 onsets per second (race theme: 70 ms pulses, 14 Hz ticks, 12 Hz hum, about 69). The
only thinning today is the urgent duck (9 dB, every layer but safety) and the voice allocator's slot stealing (voices.ts:
8 moving, 24 static slots), which is a CPU budget, not an attention budget.

## 2. (a) Speed

### 2.1 Reach in seconds

Rule: every cue that looks ahead has a reach T in seconds; its reach in metres is `T x max(v, vFloor)` held to `[minM, maxM]`.
vFloor 1 m/s (as rules.ts LEVEL_REF_MPS) keeps a hover's reach as today's metres. Geometry that is about the craft's own size
(hull room, a gate's opening, height steps) stays in metres. New pure module `src/cues/reach.ts`: `reachM(cue, speedMps)` and the
table below as data, so the ear pilot (section 4) can sweep it. All T values are estimates chosen so that at 1 to 3 m/s the
reach equals today's metres; the ear pilot sets the final ones.

| Cue | Today | New | minM | maxM |
|---|---|---|---|---|
| Hazard onset, closing | 2.5 s | 2.5 s (unchanged) | | |
| Hazard onset, near and not closing | 0.8 m | 0.8 m below 3 m/s; above it only sectors the path rays meet (path-rays) or closing ones | 0.4 | 0.8 |
| Ray reach | 40 m | 3 s | 12 | 60 (scan ray cost grows with distance: tools/bench/src/sonic-rays.ts measures it before maxM is raised) |
| Hazard low-pass and reverb distance | 12 m | 4 s | 6 | 40 |
| Open-way passage depth | 1.5 m | 0.3 s | 1.5 | 6 |
| Target hum rate, near and far | 2 m and 40 m | 0.5 s and 4 s to reach the target | 2 | 60 |
| Beacon point ahead | 6 m | replaced by the racing line's look-ahead (2.3), 1.0 s | 3 | 20 |
| Shape trace | 12 m | 1.5 s; off at speed tier 2 and up (2.2) | 4 | 12 |
| Speed ticks | rate to 15 m/s | rate to the lesson's cap (the cap is the top tick), off at tier 2 and up | | |

### 2.2 At speed only one or two cues sound

Speed tiers (estimates; hysteresis: up at the edge, down at 85 % of it, held at least 0.5 s):

| Tier | Speed | Continuous streams at once | What is on |
|---|---|---|---|
| 0 | under 3 m/s | all (today) | every layer the lesson has on |
| 1 | 3 to 8 m/s | 3 | line, 2 hazards, free-way chime; height tone only out of band; shape off; ticks off |
| 2 | 8 to 15 m/s | 2 | line and the 1 most urgent hazard (the free-way chime replaces it when there is one) |
| 3 | over 15 m/s | 2 | as tier 2; hazards only on the path (path-rays), no side sectors |

Short events (gate passed, touch, lap) are not streams: they play on top at every tier.

Priority and ducking (new `src/cues/budget.ts`, a pure function of the frame's requests and the tier; voices.ts PRIORITY
values are kept for the CPU slots):

| Rank | Cue | Today's PRIORITY | When it is cut |
|---|---|---|---|
| 1 | Urgent hazard (ttc under 1.5 s or under 0.4 m) | hazard 100 | never; ducks the rest 9 dB (today's rule) |
| 2 | Racing line (new, 2.3) | target 80 | never in a course; ducked 9 dB under rank 1 |
| 3 | Open-way chime | free 90 | tier 2 and up: replaces the rank 4 hazard it belongs to |
| 4 | Second hazard, not urgent | hazard 99 to 98 | beyond the tier's stream count |
| 5 | Height tone | (layer bus) | tier 1: only out of the band; tier 2 and up: off (the line says up and down) |
| 6 | Shape trace | shape 60 | tier 1 and up |
| 7 | Speed ticks | (layer bus) | tier 2 and up |
| 8 | Room bed | (layer bus) | never cut; it is quiet (theme room.gainDb -22 to -26) |
| on top | Gate notes, touch, lap, praise | gateNote 75, touch 95 | never (one-off) |

A cut stream fades out in 80 ms and in again in 150 ms (estimates); a cut is not ducking: the stream stops, so the ear has
fewer things to follow, which is the owner's point. Pulse density is then held: at tier 2 at most one pulse train plus the line.

### 2.3 The racing line

One continuous guide along the course, as the light line of a drone race:
- The line: the course path (scan-world.ts checkpoints: coursePath of packages/tracks, points at most 6 m apart, one 1.5 m before
  each gate; in a package lesson the track points, lesson/track.ts), smoothed (centripetal Catmull-Rom). The craft's place on it:
  the nearest point at or ahead of the last one (arc length s, never backwards more than 2 m, so a loop does not jump).
- Look-ahead point: s + T_look x v along the line, T_look 1.0 s (estimate), at least 3 m. The guide sounds the direction from the
  craft's velocity to that point, so a turn ahead is heard before it comes.
- Left and right of the line: NOT by the HRTF alone. A level difference between the ears by the side angle (as beacon.ts
  BEACON_SIDE_DB, but up to 10 dB at 30 degrees, estimate) plus the HRTF direction folded to the front (foldToFront). On the
  line (within 8 and 11 degrees, beacon.ts ON_COURSE_DEG and ON_COURSE_OUT_DEG): centred, an octave up, steady.
- Up and down: the guide's pitch glides with the elevation of the look-ahead point (rules.ts elevationSteps, by the pilot's
  heightPolarity), in whole scale steps, plus the breath of air for a way above or below (planner.ts ELEVATION_AIR_DB).
- Off the line by distance: beating (rules.ts targetBeat), full at 1.5 m off the line (estimate); the pilot hears rough = far.
- Timbre: a sustained tone (pad or sine), never a pulse train, so the hazards (pulses) stay separable from it.
- Obstacles on top: short events. At tier 2 and up a hazard is a parking-sensor pulse by time to contact (rules.ts
  pulsePeriodMs, unchanged) only while it is on the path; when a free way exists the open-way chime from its side replaces it.
- Free flight (no course): no line; the hum of the nearest open way ahead (freeway.ts) at tier 1 and up.

## 3. (b) Space without relying on the HRTF

- Behind has another timbre. Today the hum is folded to the front (beacon.ts foldToFront), hazards keep their HRTF direction and
  the back sector has the lowest weight (sampler.ts weight back 0.6). New: every source whose listener direction has z > 0
  (behind the ear axis) plays in a rear timbre: the theme's 'thud' or 'wood' with a low-pass at 1.2 kHz (estimate) and one scale
  step lower, so "behind" is a sound, not an HRTF guess. Above (elevation over 45 degrees): the breath of air (exists for the
  open-way chime: planner.ts ELEVATION_AIR_DB -10 dB) for every spatial cue.
- Approach: the three codes the consultant names exist and stay: pulse tempo by time to contact (rules.ts pulsePeriodMs),
  loudness and brightness by the urgency distance (rules.ts hazardDistanceCode: 4 dB per doubling, low-pass 16 kHz near to
  2.5 kHz far in the soft theme). New: the line gets brightness by the time to the next gate (low-pass 1.5 kHz at 4 s to 8 kHz at
  0.5 s, estimate), so a gate coming is heard without its direction.
- Side by level difference: today the ILD boost works only under 2 m (rules.ts ILD_RANGE_M, theme ildBoostDb 6). At tier 1 and
  up the boost applies to the line and the one hazard at every distance, so left and right never rest on the HRTF alone.
- Gentle reverb: today the per-voice send is 0.04 to 0.05 near (planner.ts lines 625, 679, 737) and the room return 0.1 to 0.45
  (theme room). New: every spatial voice gets at least 0.10 send (estimate), the room return at least 0.15; the listening
  check is the HRTF pick test of section 5.2 run once with and once without (the consultant: it "sometimes slightly reduces
  errors"; it is kept only if it does not raise the quadrant errors).
- Lesson "turn and listen" (new package lesson, after the ears game): a hum is placed ahead or behind at random; the narrator
  says "turn a little to the left and listen where it goes"; the rule taught: when you turn left, a sound ahead slides to the
  right, a sound behind slides to the left, with you. Ten trials, the answer by a key (the runner's Question), pass at 8 of 10
  (estimate). The same check runs in flight later: the hum behind, the pilot must turn the right way within 2 s.

## 4. (c) The check: the ear pilot

A program that flies ONLY from what the cues say. It never gets the world, the target, the track or the craft's distance to
anything: it gets the frame's sound and its own stick state.

- Package files (DOM-free, not imported by the engine): `src/pilot/perceive.ts` (cue stream to percepts), `src/pilot/ear-pilot.ts`
  (percepts to sticks), `src/pilot/craft.ts` (a kinematic craft within the lesson's assists, as test/helpers/pilot.ts flies:
  speed, climb and turn caps; acceleration 8 m/s2 and yaw rate 180 deg/s are estimates), `src/pilot/ladder.ts` (the speed ladder).
- What it hears (perceive.ts), from FramePlan.cues and the planner's notes after budget and ducking: left or right from the level
  difference and the side of `dir` (x sign, with a just-noticeable 2 dB / 10 degrees, estimate); front or back only from the rear
  timbre, else wrong in 29 % of trials (the consultant's figure for a generic HRTF, quoted from his note, seeded random);
  elevation only from the pitch code (scale steps); urgency from pulse rate and level with a 10 % just-noticeable difference
  (estimate); reaction delay 250 ms (estimate); at most 2 streams followed at once (the loudest after ducking). It never reads
  ActiveCue.distance: a test zeroes that field and asserts the same flight hash.
- How it flies: yaw toward the line's side, climb by the line's pitch offset, hold the speed set point; an urgent hazard: brake
  and turn toward the open-way chime's side, else away from the hazard's side.
- The measure: for a course, the highest speed set point of the ladder 1, 2, 3, 4, 6, 8, 10, 12, 15, 18, 22 m/s at which it
  passes every gate in order with 0 touches within 3 x the course length / speed; 3 seeds, the median. Courses: (1) the corridor
  (lessons/corridor.json world), (2) a rings course (the package's gate lesson with the most gates), (3) real scans: Tunis
  887f27aa (shipped walls) and Wroclaw 70b50d42 (stand-in walls U:/Temp/gsfpv-train2/walls/release/70b50d42), course by
  packages/tracks generateCourse with a fixed seed, run in the simulator repo (`tools/bench/src/ear-pilot-scan.ts`: voxels from
  scene.voxel.bin, apps/fly/src/sonic/scan-world.ts ScanSonicWorld, the package's ear pilot).
- Output: `evidence/ear-pilot/<date>-<ref>.json` (package) and `U:/Temp/gsfpv-train3/sonic3/ear-pilot-scan-<scene>.json`
  (simulator): per course and seed the top speed, touches, time, and a hash of the flight. The baseline is today's package
  (train3 2ec8653) with the beacon on; every later change reports before and after in its status file; a change that lowers any
  course's top speed by more than one rung is not handed over.
- Negative controls (in test/ear-pilot.test.ts): the cue stream with left and right swapped must fail at the lowest rung; a deaf
  pilot (empty cue stream) must fail; the imports of src/pilot/ear-pilot.ts must not include src/world, src/sense or the contract's
  SonicWorld (an architecture assertion on the file's text).
- Speed lessons ladder: six lessons "speed 1" to "speed 6" on the corridor and the rings course with caps 2, 4, 6, 9, 12, 15 m/s
  (estimates). A cap ships only where the ear pilot's median top speed on that lesson's course is at least 1.25 x the cap. A
  pilot passes a rung when he finishes with 0 touches in at most course length / (0.6 x cap) seconds (the 0.6 is an estimate the
  ear pilot's times replace: it becomes its time at the cap x 1.5). The lessons say the speed tier change aloud the first time
  ("fast: now only the line and the nearest danger").

## 5. (d) Later: design only, not built in this train

### 5.1 Head tracking with a web camera

- The page needs: camera permission (getUserMedia video, asked at the press of one item "Turn my head to listen", never at load),
  a secure origin (the site is HTTPS), the face tracker's model and wasm files served from the site (CSP: same-origin script,
  wasm-unsafe-eval if the tracker needs it, a worker), and a privacy line in the four locales: frames stay on the device.
- The tracker: a face landmark model running in the browser (WASM or WebGPU) giving head yaw, pitch and roll at 30 frames per
  second or more, smoothed by a one-euro filter, recentred by a key.
- How the turn feeds the panner: the listener frame becomes the craft's heading plus the head's yaw and pitch: every source
  direction is rotated by the inverse head rotation before rules.ts pannerDirection (the engine keeps one AudioListener). With
  head tracking on, foldToFront and the rear timbre stay (the turn helps; it does not replace the unambiguous codes).
- The lead must read from the Cat3DA repository (https://git.iem.at/lukas_goelles/cat3da): its licence; which face tracker it
  uses and that tracker's licence and model size; the frame rate and the motion-to-sound delay it reaches; how it rotates the
  scene (per-source or ambisonics rotation); its calibration and recentre; browsers it supports.

### 5.2 Picking an HRTF by a short listening test

- Chrome's PannerNode HRTF is one built-in set; another set needs our own binaural renderer (an AudioWorklet or a ConvolverNode
  pair per voice with the chosen set's impulse responses, 8 moving voices: voices.ts MAX_MOVING_VOICES). Its cost must be
  measured before it is chosen.
- The test (about 3 minutes, estimate): 6 to 8 candidate sets chosen in advance; per set a sound from 8 directions in random order,
  the pilot answers by the arrow keys (ahead, behind, left, right, and up or down); the set with the fewest quadrant errors wins;
  the result is a pref; the reverb on and off is compared in the same test (section 3).
- The lead must read the licences of SADIE II and HUTUBS (whether the data may be shipped on a public site and in a phone app,
  attribution) before any file of them enters a repository.

### 5.3 A phone application for blind walkers

The owner asked where an application could live that turns the phone camera's picture into a sound map and uses motion-sensor
headphones. Its place is a separate product and repository (name with Shramko, for example "Shramko SonicWalk"), a phone app
that reuses the sound package's DOM-free core (src/cues, src/sense, src/theme, the lessons runner) unchanged: the phone's depth
(camera depth estimation or a depth sensor) implements the contract's SonicWorld castRay, the headphones' head tracking (the
phone platform's headphone-motion interface, to be checked by the lead per platform) feeds the listener frame as in 5.1, and the
walking speed takes the place of the craft's speed in the reach-in-seconds rule of 2.1. The simulator stays the training ground:
the same sounds learned at a desk then work on the street.

## 6. Build stages (train 3 and after)

| Stage | Repo and files | Tests (each new test with a negative control on the old code) |
|---|---|---|
| Z3 ear pilot and baseline | package: src/pilot/perceive.ts, ear-pilot.ts, craft.ts, ladder.ts; tools/ear-pilot.ts; evidence/ear-pilot/; simulator: tools/bench/src/ear-pilot-scan.ts | package test/ear-pilot.test.ts (swapped and deaf controls, no-geometry imports, distance zeroed gives the same hash); baseline numbers in docs/wip/sonic3.md |
| Z4 reach in seconds and the stream budget | package: src/cues/reach.ts, budget.ts, planner.ts, rules.ts (target rate by time), sense/sampler.ts (rangeS), freeway.ts (depth by time), theme/schema.ts | test/reach.test.ts, test/budget.test.ts (tier table, hysteresis, at most 2 streams at tier 2); ear pilot before and after; pin move |
| Z5 racing line | package: src/cues/line.ts, planner.ts (cue 'target.line'), theme params in schema.ts and themes/*.json, locales (cue name, glossary) en es pl ru; simulator: nothing beyond the pin (scan-world.ts already gives the course path) | test/line.test.ts (look-ahead, side level, octave on the line, beating off it, no backward jump on a loop); ear pilot top speeds on corridor, rings and both scans |
| Z6 space codes and the turn lesson | package: planner.ts (rear timbre, air above, ILD at speed, reverb floor), lessons/turn-listen.json, lesson/library.ts, locales en es pl ru | test/rear-timbre.test.ts, test/turn-listen.test.ts (runner, scripted answers); ear pilot with the 29 % confusion on and off |
| Z7 speed lessons | package: lessons/speed-1..6.json, library.ts; simulator: lesson list texts if any in packages/i18n/locales/fly/sonic | test/speed-ladder.test.ts (each cap at most ear pilot median / 1.25, read from the evidence file) |
| Z8 browser proof | simulator: release build, tools/bench/scripts/sonic-walk-probe.mjs extended | Tunis 887f27aa and Wroclaw 70b50d42 (walls stand-in): Backslash, N for a course, fly at rising speed; the page's cue stream recorded and run through perceive.ts: tier changes heard, at most 2 streams at tier 2 |
| Later | head tracking (5.1), HRTF pick (5.2), phone app (5.3) | design only until the lead has read Cat3DA and the licences |
