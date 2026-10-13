# v0.7 lead handoff (read this first after any interruption)

Plan and contracts: `docs/wip/v07-plan.md`. Each lane's own status: `docs/wip/v07-<lane>.md` in its worktree.

## State (2026-10-13)

- Base `cbc41e8` on `main` (catalogue contract + plan). Live release still f92d98b73ecf (`main` 0a169fa + docs).
- Seven lanes in `C:/dev/gsfpv-v07-{a,b,c,d1,d2,r,e}` (branches `v07-*`). Wave 1 (workflow wf_11aa06b9-99a) was
  cut off by the usage limit near the end of every lane: 7-10 commits each, some uncommitted work in progress.
- Wave 2 (workflow wf_8ea5f912-7bb, script `gsfpv-v07-continue.js` in the session scratchpad): each lane continues from
  where it stopped (resume_digest of wave 1), then one review and one fix pass; at most 4 lanes at a time.
- Merged into v03-lead (not pushed): v07-r (ec50efa), v07-e (ecdeaf7), v07-d2 (eb26dcb), v07-d1 (c03159f + share-link
  fix 19119c6: one link parser/writer = lane R's packages/scenes; + e2876bc recordAction moved to builtin/recording.ts).
  Gates on the merged tree: typecheck 12/12, vitest 1157, API 55, architecture, i18n, gen-catalog, B18 PASS.
  Waiting: A (catalogue/SEO, the plan's first), B (ideas server), C (ideas UI; its continuation finished, under review).
  Not run on the merged tree yet: browser benches, site verify, build-release.
- v07-b merged (deploy/README report row from B, share row from R; unknown POST now drains its body before the 404
  — the roadmap test aborted 1 run in ~3 on Windows). Gates after B: typecheck ok, vitest 1161, API 112 (the flaky one
  fixed), architecture, i18n 875x4, gen-catalog ok. NEXT: A's fix (wf_8ea5f912-7bb, review found 9) then merge A;
  C's fix (review found 9) must adopt B's send-done contract {id, mail} (409 stale-draft) — then merge C; then
  privacy texts, build-release, site verify, accept-fly, deploy per steps below. Owner: Gmail app password pending;
  check TG_CHAT_ID sign on the hub (negative = group -> TG_OWNER_USER_ID needed).
- v07-c merged (99bf62e; conflicts kept both sides: site prebuild runs catalog-snapshot and roadmap, verify mocks
  /api/catalog and /api/roadmap, admin parity reads every namespace and ideas/ sources, accept-v06-admin keeps R's
  render check). Then: B's store finds `apps/api/locales/roadmap-seed.json` and TITLE_MAX 240 (cab6bd2); one
  contract file `apps/api/tests/ideas-admin-contract.json` replayed against the real handler and the kanban's mock
  (72113f2); kanban: 503 ideas-store message + Try again, 409 re-read, stale-draft dialog (762693d); privacy names
  message + contact in Telegram (2928f48). Checks on 2928f48: accept-v06-admin (real API) 37/37, accept-v07-ideas
  65/65, site verify 153/154 (only the local Accept-Language redirect), scene-template tests run (not skipped),
  typecheck exit 0, vitest 1229, API 167 (0 skipped), architecture, i18n 943x4, gen-catalog, B18 PASS.
  NEXT: accept-fly B6 B7 B9-B16 on the local release, then deploy per the steps below.
- If wave 2 is cut off too: `/limit-resume` again — digest of wf_8ea5f912-7bb, new continuation prompts; never rerun.

## Owner decisions since the plan

- 2026-10-13, message 19: no new Telegram bot — the two-way flow runs on the existing shared bot (its updates are
  read by nobody else); gsfpv-api obeys only the owner's chat and only acts on GSFPV notes. Lane B was told in wave 2.
- Gmail: the owner creates an app password (myaccount.google.com/apppasswords, name ShramkoGSFPV) and sends it; it
  goes only into the vault's private file and the hub's config.env (GMAIL_USER=zmei116@gmail.com, GMAIL_APP_PASSWORD).
  Until then mail stays "waiting for mail setup".

## Merge and ship (lead, after wave 2)

1. Merge order: a (catalogue contract users) -> r -> e -> d2 -> d1 -> b -> c (c depends on b's API). JSON locale and
   generated-file conflicts: merge the JSON objects key by key; regenerate gen-catalog outputs, never hand-merge them.
2. Gates on the merged tree + B18 + site verify + build-release + accept-fly B6 B7 B9-B16 on the local release
   (+ the lanes' acceptance benches only where merging touched their area).
3. Hub: upload apps/api (server.py + new modules + locales + seeds), nginx.conf (cp .prev, nginx -t, reload),
   config.env keys (webhook secret; Gmail when it arrives) -> `docker compose up -d --force-recreate gsfpv-api`;
   push main, CI green, `.cache/ship.sh <sha>` (it resolves short shas now); register the Telegram webhook.
4. Live checks: picker shows every catalogue scene; /{lang}/scenes/ pages + sitemap; a stochastic link on desktop;
   share button in flight; recording on a pasted scan; roadmap API + landing board; bot reply path with a test note.
5. Ideas: mark R-20261006-0001..0003 and the LinkedIn pilot's ideas (wind, ceiling) done with public titles; the
   thank-you e-mails stay drafts until the owner presses Send.

6. Privacy (site locales, 4 languages) after lane B: reports and ideas reach the owner's Telegram with the pilot's
   text and contact; the owner's replies and thank-you e-mails go from his Gmail (Google) — say both plainly.
