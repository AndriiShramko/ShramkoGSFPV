# v0.11 plan — the owner's message 24 (2026-10-21)

Primary source (verbatim, Russian): the vault's verbatim-brief note of the FPV simulator project, section for message 24.
English rendering: "Make a good stochastic with frame accumulation, like SuperSplat. Isn't there something ready and working
in their repository that can be taken, so we do not build everything from scratch?"

Context: v0.10 lane R (docs/wip/v10-r.md, decisions D75-D80) measured why our stochastic drawing is bad: PlayCanvas 2.23.2's
gsplat stochastic takes one noisy sample per pixel with no temporal accumulation, and its dither is biased
(pow(noise, 2.2)), 17-22 dB from the sorted picture, worst in interiors. SuperSplat's hosted viewer draws stochastic with its
own renderer and a TAA history (256 frames at rest, 16 moving), 35-37 dB from its sorted picture. v0.10 made sorted the
default everywhere; stochastic stays a choice (pilot setting, link, scene entry, device preset in the admin Drawing tab).

The lead's finding (2026-10-21): `playcanvas/supersplat-viewer` is MIT, depends on `playcanvas ^2.23.0` (ours 2.23.2), and
holds the renderer: `src/render/stochastic-splat-renderer.ts` (120 KB), `src/render/shaders/{taa,compose,interleave}.ts`,
`src/render/splat-source*.ts`, `src/render/resident-set.ts`, `src/render/xr-rate-map.ts`.

Base: `a1838e1` (`main`, live release 575920947b9c). One lane `v11-s` in `C:/dev/gsfpv-v11-s`, note `docs/wip/v11-s.md`.

## Lane S — the SuperSplat stochastic renderer with TAA in our simulator

Owns: `packages/render-pc` (a vendored copy under `packages/render-pc/src/vendor/supersplat-viewer/` with its MIT licence text
and the exact upstream commit, plus our adapter), the drawing choice where the new mode plugs in (`apps/fly/src/app/drawing*.ts`),
`THIRD_PARTY_NOTICES` (or the repo's existing notices file), benches and evidence. Decisions appended to `docs/decisions.md`.

## After release (owner message 25, 2026-10-21)
When v0.11 is live and checked, the lead hands the announcement to the Facebook-group agents: reels on what stochastic
drawing is and why the simulator has it (beta on SuperSplat, adapted for FPV flight and published here), posted in every
fitting group (vault skill fb-campaign-gsfpv, "Objavleniya obnovleniy" item 6). Only measured numbers from docs/wip/v11-s.md.
