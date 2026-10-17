# v0.9 plan — the owner's message 22 (2026-10-17)

Primary source (verbatim, Russian): vault `01 - Projects/FPV-симулятор в 3DGS-сценах/Бриф Андрія — дословно.md`,
section "сообщение 22". Below is a faithful English rendering; when in doubt the vault text wins.

Base: `8c90f53` (`main`, live release 1e1be0e005ef). Lanes work in `C:/dev/gsfpv-v09-<lane>` on branch `v09-<lane>`,
each with `docs/wip/v09-<lane>.md` (design note + `## Status`). The lead merges, deploys and checks the live site.

## The owner's items

1. (Answer to the v0.8 report) He never set expo or rates on his EdgeTX radio. **Keyboard: ordinary PC gamers still
   cannot fly a scene on the keyboard. "Nothing like the way games control flying characters."**
3a. **Beautiful 3D models of the drones, rendered in the browser**, so users see which drone they fly, what equipment is
   on it, which cameras — e.g. does the cinelifter carry a RED or Blackmagic camera or not. Visual, not only a name.
3b. **Recording stuck**: "Klatka 0 z 4929 · czekamy, aż skan wczyta się dla tego widoku" (frame 0 of 4929, waiting for
   the scan to load for this view) for 10 minutes on scene 1994c65c, no progress; then "Wideo nie zostało zapisane:
   Codec reclaimed due to inactivity". Fix, and find out whether it hangs or renders.
4. Replies the owner sends through Telegram must reach the pilot **in the pilot's language** (the language they wrote
   in), English at worst.
5. Check that the e-mails he sent through Telegram went out. (Lead: done 2026-10-17 — M-1..M-5 state sent, all five in
   Gmail SENT, no bounce.)
6. A pilot asked for **a key that turns on full screen** (idea R-20261017-0002, Polish: "in the browser one gets
   distracted"). Do it properly; check that the skills and the admin kanban handle such requests correctly.
7. **SuperSplat stochastic links** (`https://superspl.at/scene/2f1ddf5f?budget=8&stochastic`, beta, desktop only) do not
   work in our simulator now. He must be able to add such addresses, and desktop users must get stochastic now; when
   SuperSplat makes it the default the URL will change — be ready.
8. https://gsfpv.flyreelstudio.eu/en/fly/?scene=d8ba72a6 **does not load**.
9. **N cycles only 3–4 scenes.** N must go through all of the owner's scenes (his curated list, his order), then go on
   through SuperSplat scenes.
10./16. **Scan loading — the most important bug.** Scans stop at "Preparing the view" / "Preparing the view is taking
   longer than usual (25 s)" (scan 15a202e6 of scene b11e45d1, 148.3 MB; scan 224aba38 of scene a8cfc66e, 61.5 MB) —
   the scan is already visible behind the dialog. Many scans do load, only slowly, and the user thinks it hung: a clear
   element that shows it is still loading and how much is left. The scene with oranges and lemons never loads.
11. After a new user's first few crashes, show a button/message: press N for the next scene (curated list first, then
   SuperSplat).
12. **~300 ms input delay** with a Radiomaster GX12 over Bluetooth: the green stick on screen moves late. Does
   Bluetooth add that much, can we fix it?
13. **Stochastic LOD on by default** for computer players (it works only on desktop).
14. **Admin: a default scene scale per scene** (SuperSplat's is 1); used whenever the scene opens on our site or from a
   SuperSplat link, if the owner configured that scene.
15. **Sharing carries the sharer's scene settings** (scale and the rest): people who open the link fly with the same
   settings.
17. Macro scans (flying among small plants, around a fly) are a unique advantage: scale a macro world up ×3–×10 and fly
   it like a big building, or shrink a city to a model and fly it with a micro drone. Users must be told to scale such
   scenes up. Into the text skills (lead/vault) and into the product (default scale + a hint).
19. Save tokens without losing quality; spread the work across Haiku 5.5 and Sonnet 5.5.
20./21. Reels and group posts (vault skills, not this repo).

## Lanes and ownership

| Lane | Items | Owns (others do not edit) |
|---|---|---|
| A load | 3b, 8, 10, 16, lemons | `apps/fly/src/session/loader.ts`, `apps/fly/src/ui/loading.ts`, recording (`apps/fly/src/app/builtin/recording.ts`, `video-export.ts`, `apps/fly/src/videoexport.ts`, `cinema.ts`), readiness in `packages/render-pc` (frame:ready use, lod readiness), `apps/fly/src/app/lod.ts`, `.github/workflows/canary.yml` |
| R render | 7, 13 | render mode/budget choice (`packages/render-pc` mode + budget, `apps/fly/src/app/quality.ts`, prefs `render.*`), the superspl.at URL parsing of render params in `packages/scenes/src/link.ts` |
| B keys | 1, 6 | `apps/fly/src/play/**`, `apps/fly/src/devices/keyboard.ts`, `apps/fly/src/app/builtin/play.ts`, `packages/prefs/src/keymap.ts`, pointer lock, fullscreen (a button in `app/builtin/top.ts`) |
| C scene settings | 14, 15, 17 (product) | catalog `scale` (`packages/scenes/src/catalog.ts`, `apps/api/admin.py` scene fields, the admin scene editor), `apps/fly/src/app/builtin/scale.ts`, `scene-default.ts`, `apps/fly/src/share/**`, `app/builtin/share.ts`, `/s/<id>` param pass-through (`apps/api/server.py` share route), landing scale text |
| N next scene | 9, 11 | scene order for N / auto-switch (`apps/fly/src/app/builtin/rotation.ts` and its helpers), the crash hint (`app/builtin/crash.ts` hint part only) |
| E latency | 12 | `packages/input` sampling/timestamps, `apps/fly/src/devices/**` except keyboard.ts, `apps/fly/src/latency.ts`, the radio check screen's report-rate line |
| D drones | 3a | new `apps/fly/src/drones3d/**`, the drone picker card (`app/builtin/drone.ts`), `docs/research/drone-models.md` |
| F mail | 4 | `apps/api/ownerbot.py`, `apps/api/mailer.py`, `apps/api/outbox.py`, a new `apps/api/translate.py`, `packages/i18n/locales/{bot,mail}` |

Shared files every lane may touch with additive edits only: `packages/i18n/locales/**` (new keys), `packages/prefs/src/defs`
(new settings; update the count in `packages/prefs/test/defs.test.ts`), `docs/decisions.md` (append), generated catalogue
outputs (re-run `gen-catalog`). The lead resolves these at merge.

## Decisions the lead made before branching

- **Fullscreen key: F.** "Next favourite" moves to Shift+F (key card, docs, features). A top-bar button too.
- **Keyboard game scheme** (lane B) as described in its brief: mouse look with pointer lock, WASD move, Space up,
  Shift down, hover when keys are released, motors start by themselves. Ctrl is never used (Ctrl+W closes the tab).
- **Translation engine** (lane F): Gemini over REST (`GEMINI_API_KEY` in the hub's `config.env`, set by the lead; model
  from `GEMINI_MODEL`, default `gemini-2.5-flash`; checked 2026-10-17: the key answers, a Polish test translation came
  back correct). No key or an error: never send a non-English text the pilot cannot read.
- **The SuperSplat S3 path** `s3-eu-west-1.amazonaws.com/splats.playcanvas.com/<id>/v1/*` answers 403 since 2026-10-16;
  CloudFront `d28zzqy0iyovbz.cloudfront.net/<id>/v1/*` answers 206 with CORS `*` (the simulator already uses
  CloudFront). The daily `cdn-canary` checks the dead S3 path: lane A moves it to CloudFront.
