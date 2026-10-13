# v0.7 plan — the owner's message 18 (2026-10-13)

Source: the owner's brief, message 18 (the vault's verbatim brief of the FPV simulator project, recorded word for
word). Seven lanes, each in its own git worktree and branch; the lead merges, runs the
gates and ships. The catalogue contract (`packages/scenes/src/catalog.ts` + `apps/api/admin.py
_place_fields`, commit "catalogue contract v0.7") is already on the base: every lane reads those fields,
lane A writes them from the admin.

## What the owner asked (numbered as in his message)

1. SuperSplat's new Stochastic beta (`https://superspl.at/scene/2f1ddf5f?budget=8&stochastic`) must work
   in the simulator now, on desktop browsers: links with these parameters can be added, and the scene is
   drawn that way. When SuperSplat makes it the default, it will be in the plain link.
2. Recording works on every scan, not only the showcase: the pilot who records is responsible for what
   they do with the video. Recording must always work.
3. Pilots send ideas. The owner answers from Telegram: his reply to the report message becomes an e-mail
   from his Gmail (zmei116@gmail.com) to the pilot (the pilot's message + his answer), delivered to the
   inbox, not spam. From Telegram he also sends an idea "to work" with his comments, accepts or rejects it,
   sets its urgency. The admin has every idea and a kanban of their implementation, in sync with the
   landing, which shows what is done and what is planned.
4. A scene the owner added in the admin is neither on the landing nor in the list of scenes to fly.
5. Adding a scene pulls SuperSplat's facts (licence, author, title). Scenes must be found by search and
   answer engines (SEO + GEO); think what to quote from SuperSplat and what to write ourselves so the
   pages are not a copy of SuperSplat's titles and descriptions.
6. The share button is not hidden in a menu: a pilot can share the scene they fly or flew at any moment.
   Design the whole sharing flow from every place.
7. When a pilot's idea is done, they get an e-mail from the owner's Gmail: what was done, how, and thanks
   for helping to improve the simulator.
8. In Telegram the owner writes down an idea a pilot told him outside the form; it goes to the work queue
   when he sends it with an urgency.
9. Everything in Telegram about the simulator is to be done too (the three ideas below).
10. A pilot's ideas (LinkedIn): the wind of the place (geodata), editable by hand since most scans have no
    location ("if the wind always blows from the north, the scan could have it too"); collisions off above
    a height for outdoor scans (he crashed into floating sky splats).

Telegram ideas (R-20261006-0001..0003, a Polish pilot): rates types Betaflight / Raceflight / KISS / Actual /
Quick with manual editing in the options; a crosshair in the centre; an option for the drone's motor sound;
assigning functions to radio channels (mode on CH5, arm on CH6 as on his radio).

## Found while scouting (2026-10-13)

- Item 4 root cause: the picker's default filter "walls only" (`packages/scenes/src/library.ts`
  `DEFAULT_FILTER.collisionOnly: true`) hides every catalogue scene with `collision: false` — the two
  scenes the owner added (70b50d42 Wroclaw, 0230d903 Muster Truck Show) have no SuperSplat collision file.
  The landing's scene list is built statically from `apps/fly/public/showcase.json`, so it never sees the
  admin's catalogue.
- Item 1: playcanvas 2.22.4 (ours) has no stochastic drawing; 2.23.x has `app.scene.gsplat.stochastic`
  (sort-free, dithered; `GSPLAT_STOCHASTIC`) and `splatBudget`. 2.23.2 is the latest stable (2026-10-09).
- The report bot (`TG_BOT_TOKEN`) is the shared lead bot of every site on the hub
  (@leadformfromallsitesbot); nothing reads its updates. Two-way work needs a dedicated GSFPV bot
  (`TG_OWNER_BOT_TOKEN`), so the shared bot's other sites are never affected.
- Outbound SMTP from the API container to smtp.gmail.com:587 works (EHLO 250, STARTTLS 220).
- `tools/reports/pull.py list` crashes on a Windows console (cp1252) with Polish letters.

## Lanes

| Lane | Branch / worktree | Owner's items |
|---|---|---|
| A catalogue | `v07-a` `C:/dev/gsfpv-v07-a` | 4, 5, admin editor of the v0.7 fields, `/api/wind` |
| B ideas server | `v07-b` `C:/dev/gsfpv-v07-b` | 3, 7, 8 (store, Telegram, Gmail, APIs, agent queue) |
| C ideas UI | `v07-c` `C:/dev/gsfpv-v07-c` | 3 (admin kanban, landing roadmap from the store) |
| D1 flight UX | `v07-d1` `C:/dev/gsfpv-v07-d1` | 6, 2, crosshair, motor sound |
| D2 radio | `v07-d2` `C:/dev/gsfpv-v07-d2` | rates types + editor (Quick), channel functions |
| R renderer | `v07-r` `C:/dev/gsfpv-v07-r` | 1 (engine 2.23.2, stochastic, budget) |
| E wind and ceiling | `v07-e` `C:/dev/gsfpv-v07-e` | 10 (wind, collision ceiling) |

## Contracts between lanes

- Catalogue fields (base commit): `geo {lat, lon, place?}`, `compassDeg` (compass heading of the scene's
  forward axis = HUD heading 0), `wind {fromDeg, speed, gust, source}`, `ceilingM` (scan coordinates, up
  axis, scale 1), `render {budgetM?, stochastic?}`, `about` (LocalText, our words), `origin {url,
  description?, tags?, created?}`. Lane E refines the comments of `compassDeg` and `ceilingM` to the sim's
  exact frame if needed, without changing names or ranges.
- `GET /api/wind/<sceneId>?mode=now` (lane A): `{"ok": true, "fromDeg", "speed", "gust", "at": ISO, "source": "now"}`
  for a published scene with `geo`, cached 15 min; 404 without geo. Lane E consumes it.
- Scene links (lane R): `parseSceneInput` keeps SuperSplat's `budget` and `stochastic` parameters; the fly
  deep link is `/fly/?scene=<id>&budget=<M>&stochastic`; the catalogue's `render` is the default.
- Scene pages (lane A): `/{lang}/scenes/` and `/{lang}/scenes/<id>/` (lang en/es/pl/ru). Lane D1 links a
  shared scene there when no fresh pilot picture exists (else `/s/<id>`).
- Ideas (lane B): `GET /api/roadmap` (public, ETag): `{"v":1,"items":[{"id","kind":"feature|idea|bug",
  "status":"planned|in_progress|done","title":{"en",...},"text"?:{...},"fromPilot":bool,"done"?:ISO,
  "release"?:sha}]}` — no contacts, no private text. Admin endpoints under `/api/admin/ideas...` (session +
  CSRF as the existing admin). Store statuses: `new | accepted | in_progress | done | rejected`; urgency
  `low | normal | high | urgent`; `planned` on the roadmap = accepted.
- Roadmap seed (lane C writes, lane B loads once into an empty store): `apps/api/roadmap-seed.json`
  `{"v":1,"items":[{"id":"F-<slug>","kind":"feature","status":"done|in_progress|accepted",
  "title":{"en","es","pl","ru"},"order":n}]}` from the landing's current status list.

## Rules for every lane

- No crutches: change the structure when it does not fit; code an AI agent understands from the module
  layout and the comments; `node scripts/check-architecture.mjs` passes.
- English in code and docs; every user-facing string in `packages/i18n/locales/**` in en/es/pl/ru; no
  Cyrillic or Polish letters outside `locales/` (B18, `tools/bench/src/accept-repo.ts`).
- Settings: new entries in `packages/prefs/src/defs/*` (no schema version bump); then
  `node --import tsx scripts/gen-catalog.ts` and commit its outputs.
- The simulation stays deterministic: with default settings the A6 hash `1d01ca5b...` does not change.
- Every check has a negative control. Gates: `pnpm -r typecheck`, `npx vitest run`,
  `python -m unittest discover -s apps/api/tests`, `node scripts/check-architecture.mjs`,
  `pnpm --filter @gsfpv/site i18n:check`, `node --import tsx scripts/gen-catalog.ts --check`.
- Own worktree, own `pnpm install --frozen-lockfile`; never link another worktree's node_modules; never
  `git worktree remove`. Browser runs that draw take `C:/dev/.gpu-lock` (mkdir; rmdir after).
- Commit to your branch only; no push, no deploy, no SSH to the hub, no secrets anywhere in git.
