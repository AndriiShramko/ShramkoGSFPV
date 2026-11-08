# v0.13 plan: Fly by Sound lessons that a pilot understands the first time (owner's message 41)

Lead's plan, 2026-11-08, written on v03-lead c11417c with the sound package at 1eea4d5 (sound repo `main` 7d4b4b9).
Source: the owner flew the live v0.12 as a sighted pilot in headphones and listed what stops him (message 41 in the
vault brief). Every item below is his; the ids (M41-n) are used in lane docs, commits and evidence. The owner wants
the product fixed and checked by machine before any person tests it again (message 40), so every item carries a
check that a machine runs, with a control that must fail.

Budget: weekly use 56 % at the start; no new lane above 70 %, ceiling 80 %; at most 3 agents at once.

## What he asked, and what we do

### Way in and lesson menu (simulator)
- M41-1 An ordinary pilot opens the mode from the menu, no address codes. Pause menu item (v12-optin's
  `pause.flyBySound`) opens the mode's start screen `/{lang}/fly/?sonic=start` in a new tab (not the info page), and
  says so. The info page stays linked from the start screen.
- M41-2 Start the course from zero, see where the lessons are. Start screen: "Start the course from the beginning",
  "Continue: <lesson>", the 21+ lessons by module with state (passed, skipped, in progress, new), and "Reset my
  progress" (with a confirm). Lesson N of M shown and spoken.
- M41-3 In a lesson the pilot can always get back to the menu. Escape pauses and opens a spoken lesson menu:
  Resume, Repeat the task, Next step, Previous step, Next lesson, Lesson list, Sound settings, Leave the mode.
  Arrow keys move, Enter chooses, each item is spoken by the mode's own voice on focus (not only by a screen
  reader). At every lesson start one short line: "Escape: menu. Z: repeat the task. N: next."
- M41-4 Keyboard menu for blind pilots across the settings: the start screen and the mode's settings are a spoken
  list (arrows, Enter, Escape back), each value spoken when it changes. The full simulator settings screen follows
  in stage 3 (R29); here only the mode's.

### Lesson flow (sound package runner, lesson files)
- M41-5 Every sound that a step names is played three times, about 1 s apart, with no speech over it, then the
  step goes on; Z repeats the whole task of the step (its intro lines and the sound three times), not only the last
  line. The glossary does the same.
- M41-6 Skip and go back: N = next step (in a flying lesson: the next lesson, marked skipped), B = previous step or
  previous lesson. Both spoken.
- M41-7 Progress always known: after every attempt "Attempt k. Counted m of r." and on I "Lesson 6 of 21, step 2
  of 3, attempt 4, counted 2 of 3". The simulator shows the same in a large high-contrast panel.
- M41-8 No endless trials. A lesson passes after r successes in total (failures in between do not reset), r = 3
  for flying lessons unless a lesson says less; after 3 failed attempts in a row the pilot hears what went wrong
  (above the band 40 % of the time, touched the wall twice, ran out of time) and "N: go on to the next lesson".
  Explain and fix why hover-turn ran 15 attempts without passing.
- M41-9 The "press 1, press 2, but there is no sound" bug in the ears lessons: find the cause, fix it, and add a
  validator rule plus a render check: every question and every scene has an audible sound of its cue after the
  speech ends.
- M41-10 Never silence in a flying lesson: the height tone does not fall silent inside the band, a quiet bed and the
  motor stay on, so silence always means something is wrong.
- M41-11 Praise and stages: a short varied praise on each counted attempt, a fanfare and "Lesson passed, the next
  one is harder: <what>" on a pass, "Stage k passed" in the long tunnel; "better than last time" when it is true.

### Sound encoding (sound package cues, theme, sense, audio)
- M41-12 Height glides continuously, never in steps (today `heightNoteIndex` rounds to a pentatonic step). The
  height tone is a continuous glide; the target height (the band centre, or the next gate's centre) is a second,
  steady tone on the scale. In tune (unison) means at the right height; the beat between them slows to zero as the
  pilot reaches it; the drone tone below the target tone means "climb". This one design answers both "where am I
  between steps" and "at what height do I enter this ring" (two references: own height and the gate's).
- M41-13 Walls by time to contact, not by distance: a hazard is announced when the time to contact drops under
  about 2.5 s (fast flight hears far walls early), and stays quiet for far walls when slow; within about 0.8 m it is
  always heard. The sampler's range covers the fastest lesson for 3 s.
- M41-14 Free space around an obstacle ahead: when an obstacle is closer than about 3 s, an "open way" chime comes
  from the free side: left and right by HRTF, above and below by pitch (high = above), because HRTF elevation does
  not work for most heads (virtual listener probe: 29-37 % quadrant errors).
- M41-15 Direction along the track: flying backwards along a corridor or a course for more than 1 s gives a "wrong
  way" sound and the line "You are flying back. Turn around."; a ring passed from its back side gives "That ring was
  passed from the wrong side. Go back and fly it from the front." and is not counted.
- M41-16 Motor sound on by default in the mode, mixed under the cues (low-passed, about 10 dB under, ducked under
  speech), so the pilot hears throttle and climb as in real flight; its setting stays.
- M41-17 Voice not 11-14 LU over the flight (virtual listener probe): speech 3-6 LU over the mix, true peak of the mix
  at most -1 dBTP.

### Worlds (sound package generators; simulator drawing and collision)
- M41-18 Rooms at micro-drone scale: at full stick a wall comes in 2-3 s and the ceiling in about 2 s; the first room
  without obstacles is the smallest. Every lesson's distances follow its speed limits.
- M41-19 No sticking to a pillar: the bump pushes out along the normal with a little bounce and lets the craft slide;
  after a hit at any angle the craft is out of contact within 0.3 s with the stick away.
- M41-20 Respawn near the crash: checkpoints every few metres along corridors and courses; a crash or a short R goes
  back to the last checkpoint passed (a little before it, facing along the track), never to the far start.
- M41-21 Tunnels, more and harder: wide, narrow, narrower, with bends, with obstacles that leave one way free (above,
  below, left, right), and one very long tunnel in stages, each stage harder and announced with praise.
- M41-22 Rings at different heights (floor, middle, ceiling) after the first ring lessons, to learn to find a gate's
  height by M41-12.
- M41-23 The lesson rooms look like a game, cheaply: a voxel look (block textures, checker floor), hemisphere
  ambient plus one sun, soft fog, coloured pillars and rings; no shadows; frame cost measured.
- M41-24 Low-vision picture: a large high-contrast attitude display (thick horizon line, ground and sky that differ
  in lightness, pitch marks), an altitude tape with the target band and the drone's mark, a climb arrow.
- M41-25 See the sound: a panel that shows each sound as it plays: a top-down radar with each cue at its direction
  and a height bar with the drone tone and the target tone; when a step plays a sound three times the panel shows
  its icon and name.
- M41-26 Disk: the hub volume stays 10 GB (owner's word); nothing moves there in this stage.

## Lanes

Wave 1 runs in the sound repository (`C:/dev/ShramkoSonicFPV`, public: no personal data, English outside `locales/`).
Each lane: `git -C C:/dev/ShramkoSonicFPV worktree add -b <lane> C:/dev/sonic-<lane> main`, `pnpm install
--frozen-lockfile`, its own `docs/wip/<lane>.md` with `## Status`, one commit per step, no push.

| Lane | Items | Owns |
|---|---|---|
| s13-lessons | M41-5..11, M41-15 detection, M41-20 runner side, the package API the host needs for M41-3/6/7 (next, previous, repeat task, progress view) | `src/lesson/*`, lesson files' `pass`, `intro`, `speech`, `checkpoints`, `paths.json` order, lesson strings |
| s13-sound | M41-12..17, the virtual listener's first measuring rig for them | `src/cues/*`, `src/sense/*`, `src/theme/*`, `src/audio/*`, `themes/*`, `src/prefs/*`, lesson files' `layers` |
| s13-worlds | M41-18, 21, 22 and M41-20's checkpoint lists | `src/world/*`, lesson files' `world`, `start`, `assists`, new lesson files, generator goldens |

`src/contract.ts` is shared: each lane adds only its own types and keeps the rest; the lead merges by union. The
simulator side of a contract change is wave 2's. Event kinds shared by two lanes are fixed here: the runner emits cue
events `wrong-way`, `wrong-side`, `praise`, `stage`, `repeat-cue` (with the cue id); the planner owns how each sounds.

Wave 2 runs in the simulator after the lead merges wave 1 and moves the gitlink:

| Lane | Items | Owns |
|---|---|---|
| v13-host | M41-1..4, M41-7 panel, M41-24, M41-25, the keys N, B, Z, I, Escape menu, the v12-optin menu item | `apps/fly/src/sonic/*` except drawing, `app/builtin/sonic-flight.ts`, locales `fly/sonic*` |
| v13-look | M41-19, M41-23, drawing of the new world parts, frame cost | `apps/fly/src/sonic/lesson-world.ts`, `primitives.ts`, collision response for lesson worlds |

## Checks (each with a control that must fail)

- Runner, Node: every shipped lesson can be passed by the truth bot in at most 2x r attempts; no lesson can run more
  than 3 failed attempts without the "go on" offer (control: the v0.12 block rule fails hover-turn); N and B move
  exactly one step; Z replays the intro and three sounds; every question and scene step schedules its cue after the
  speech end (control: the v0.12 ears-game schedule).
- Planner, Node: height frequency is a continuous function of height (max jump between 1 cm steps under 15 cents;
  control: `heightNoteIndex` rounding fails); unison exactly at the target height; hazard onset at time to contact
  of at least 2 s at 1, 3 and 5 m/s (control: the distance-only rule fails at 5 m/s); open-way chime on the free side
  for gaps above, below, left, right (control: a closed tunnel gives none).
- Render, headless Chrome (virtual listener, first rig): pitch track of the height stem continuous; hazard stem
  onset before impact; the cue stem has three onsets in a repeat step; mix true peak at most -1 dBTP, motor under the
  cues by at least 6 dB in their bands; all with stems summing to the mix.
- Worlds, Node: wall reached in 2-3 s at full stick for every room lesson; checkpoints at most 6 m apart on every
  corridor and course; tunnel gaps passable by the truth bot.
- Simulator: page proof in headless Chrome for the menu item, the start screen buttons, the Escape menu, the spoken
  focus lines, the panels; collision probe for M41-19; frame cost of the new look within the v0.12 budget; flight
  regression B6-B16; all gates.

## Order

1. Lead: this plan, the vault note, wave 1 (two lanes now, s13-worlds when the v12-optin fix ends).
2. Each wave 1 lane: one review, then its fixes.
3. Lead: merge wave 1 in the sound repo, gh_precheck, push, move the gitlink, merge v12-optin, start wave 2.
4. Wave 2 lanes, one review each, fixes.
5. Lead: merge, all gates, release with `deploy/ship.sh`, live checks, report to the owner.
