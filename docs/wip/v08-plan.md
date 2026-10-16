# v0.8 plan — the owner's message 21 (2026-10-16)

Source: the owner's verbatim brief, message 21 (vault, the FPV simulator project). Four lanes, each in its own
worktree and branch, built with the limit-safe rules (RESUME-FIRST, a commit per finished step, a `## Status`
checklist in `docs/wip/v08-<lane>.md`). The lead merges, runs the gates and ships; the lead also writes the project
skill (item 10).

## What the owner asked (his numbering)

1. Flying with a keyboard is unrealistic: pilots will not; gamers might, but they find the key layout and the
   rest incomprehensible ("impossible to control"). Think it through and change it.
2. Touch sticks on a tablet (no radio) felt like a different reaction. Re-check.
3. The motor sound must not be loud by default: quiet, the user can raise it or switch it off.
4. DJI controller out of the box: its common switches (Angle / Horizon / Acro...) work as they do on the
   controller, nothing to reassign — plug in and fly. Recognise controllers if possible; else the user assigns.
   And make DJI's 3-position switches (two button bits) real 3-position switches.
6. Phones/tablets: probably no arm/disarm; players are not pilots: make it fun and easy, feel like an FPV pilot,
   and in theory train them for real sticks.
7. With the DJI controller the delay feels much higher, and the sensitivity much higher than his previous radio.
   Re-check both.
8. His new big city scan (Opole Cathedral, ba7aa29d, SuperSplat format ssog, ~1.2 GB) on a computer does not use
   the LOD (level of detail) technology; on a computer it must be on by default; SuperSplat will probably make it
   default soon — account for it so nothing breaks.
9. Add a cinelifter (the heavy one most often flown with a big camera) with its physics, and two 5" drones (racing,
   freestyle): the most popular models, their specs. Tell pilots that if they see flaws they can send data
   (blackbox, Betaflight rates, `diff all`...) to refine a drone, or ask to add a new drone, through the owner.
10. Skills and rules so every agent knows how to work on this and continue (the lead).

## Lanes

| Lane | Branch / worktree | Items |
|---|---|---|
| A play | `v08-a` `C:/dev/gsfpv-v08-a` | 1 keyboard, 2 touch check, 3 quieter sound, 6 casual touch/keyboard play |
| B controllers | `v08-b` `C:/dev/gsfpv-v08-b` | 4 known controllers + DJI out of the box + 3-position switches from bit pairs, 7 latency/sensitivity |
| C LOD | `v08-c` `C:/dev/gsfpv-v08-c` | 8 LOD streaming by default on desktop |
| D drones | `v08-d` `C:/dev/gsfpv-v08-d` | 9 cinelifter + 5" racing + 5" freestyle, "help us tune this drone" |

## Contracts and boundaries

- Input sources: lane A owns keyboard and touch (apps/fly/src/devices keyboard/touch, casual play), lane B owns
  HID/gamepad/radio recognition (packages/input known devices, switches, calibration). Arming: lane A may drop
  arming only for touch and keyboard play; a radio/gamepad/HID keeps its arm switch.
- Prefs: new settings in packages/prefs/src/defs/* (no schema bump); gen-catalog outputs committed; the lead
  regenerates on merge conflicts. Drone presets (lane D) only add ids; the default drone stays unless the owner says.
- The sim stays deterministic: A6 hash `1d01ca5b...` unchanged with default settings (new presets do not touch it).
- No live site, hub or SSH from lanes; benches target localhost with SITE= (accept-fly reads SITE, never BASE).
- Rules of v07-plan.md (English in code, locales in en/es/pl/ru, B18, gates, GPU lock, checkpoints) apply.
