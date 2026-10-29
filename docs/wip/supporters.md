# Supporters: the wall and a page for every person (lane `supporters`)

Owner's message 32 (2026-10-29): invite FPV, drone and 3DGS bloggers to try the simulator. The project cannot pay,
so every person gets a place on the site: a card on a wall of people who helped, and a page of their own with
their photo, who they are, what they make and an empty frame where their review goes. The page is made before
the first message, so the person sees what is already there and what is missing. Changes on request.

## Design

- **Data:** `packages/i18n/locales/supporters/people.json` (under `locales/`: names and titles keep their own
  letters, B18 looks for them only outside `locales/`). One entry per person: `slug`, `name`, `status`
  (`invited` | `joined`), `since`, `lang` (the language the person reads; the letter links to that version),
  `photo` (`/media/supporters/<slug>.webp`, 320 px), `links` (platform labels are brand names, no translation),
  `works` (their own titles, as they wrote them), `scene` (optional: a scene picked for them, opened by the fly
  button), `review` (`null` until they publish; then kind, href, title, date, platform, optional `thumb`),
  `text.{en,es,pl,ru}` = `role`, `about`, `why`, `offer[]`.
- **Pages:** `/{lang}/supporters/` (the wall) and `/{lang}/supporters/<slug>/` (the person).
  - `invited`: a draft. A banner on top says it is not public, goes live only with their OK and changes on
    request. `robots: noindex, nofollow`, absent from the sitemap, not shown on the wall, nothing links to it.
  - `joined`: indexed, in the sitemap, the card is on the wall; the README lists the name.
- **The wall** shows joined people only; with none yet it says the first cards are on their way, then how to
  get on it (fly, say what you think anywhere, send the link) and what the project gives back (own page and
  card, README line, the owner shares the review in his groups and profiles, their quad as a preset from
  `diff all`, their spot as a flyable scene from a 3DGS scan). Footer link "Supporters" on every page.
- **The person page:** photo, name, role, links; who they are; what they make (their works); the review frame
  (empty: "your review goes here"; filled: the thumbnail and a link out, no iframe: the CSP has no frame-src);
  why the owner writes to them; what he can do for them; a preview of their card on the wall; the fly button
  (their scene when one is picked); the owner's signature with his photo and contacts.
- **Rights:** names, photos and reviews of supporters belong to them, are not under the MIT license and are
  removed on request: NOTICE and the licenses page say so.
- **Checks:** `i18n-check.mjs` also checks `people.json` (four languages per person, same number of offer lines,
  unique slugs, a photo file that exists); `verify.mjs` builds the wall like the other pages and checks that a
  draft carries `noindex`, stays out of the sitemap and off the wall, and a joined page is in both.

## Status
- [~] dictionaries, data loader, wall page, person page, card, signature, footer link, sitemap
- [ ] checks: i18n-check (people.json), verify.mjs (wall + drafts), gates
- [ ] people from the research (vault: `01 - Projects/ShramkoGSFPV — блогеры и стена благодарности/research/`)
- [ ] build, local look at 375 px and 1280 px, merge into main, ship, live checks
