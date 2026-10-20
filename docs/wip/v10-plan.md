# v0.10 plan — the owner's message 23 (2026-10-20)

Primary source (verbatim, Russian): the vault's verbatim-brief note of the FPV simulator project, section for message 23.
Faithful English rendering below; when in doubt the vault text wins. Base: `5e4b11e` (`main`, live release 1ebbff46bbbc).
Lanes in `C:/dev/gsfpv-v10-<lane>` on branch `v10-<lane>`, notes `docs/wip/v10-<lane>.md` (design + `## Status`).

## The owner's items

1. "There is NO information that Shift flies down and Space flies up, for gamers who play on the keyboard. When the game
   opens it must remind and show this, so people do not search for how to control the game. With a 'do not show again'
   checkbox."
2. (Answers to the v0.9 questions) REC records "clean" (sorted drawing while REC / auto-record runs). N goes in order
   (keep the v0.9 default `sequential`; check it).
3. The stochastic budget (4 M or 8 M): the user must be able to adjust it to the power of his computer, tablet or phone.
   The site must recognise the device and start OUR default presets for that kind of device. Add these default presets
   to the admin.
4. The line "How this scene is drawn (the pilot's own Render setting takes precedence)" — move it into the admin so the
   owner can change these default values. "Stochastic shows interiors very badly now, it kills the quality. Why is the
   quality so bad in an interior, in a small room, with stochastic? We need good quality."

## Lanes and ownership

| Lane | Items | Owns |
|---|---|---|
| K controls card | 1 | the start-of-game controls card (`apps/fly/src/play/**`, `apps/fly/src/ui/hud.ts` key card part, `app/builtin/play.ts`, a new `ui/controls-card*`), its pref (`packages/prefs/src/defs`), locales `fly/play` |
| R render quality and presets | 2, 3, 4 | drawing choice (`apps/fly/src/app/drawing*.ts`, `quality.ts`, `packages/render-pc`), REC/auto-record drawing (`app/builtin/recording.ts` drawing switch only), device classes and presets, the admin "Drawing defaults" (`apps/api/admin.py`, `apps/api/server.py` catalogue payload, `apps/fly/src/admin/**` editor), locales `fly/drawing` and admin |

Shared, additive only: `packages/i18n/locales/**`, `packages/prefs/src/defs` (+ count in `defs.test.ts`), `docs/decisions.md`
(append; the lead renumbers), generated catalogue outputs. The lead merges, deploys (API first), checks live.
