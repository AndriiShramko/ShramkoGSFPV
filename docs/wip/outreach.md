# Outreach tab of the admin (branch `outreach-tab`, lane admin, 2026-10-16)

The owner's request: see, in one place, how the simulator's posts in Facebook groups are doing and which groups and
which kinds of post are worth more work. The brief and the data contract live in the owner's vault
(the vault's notes `FBG-SPEC-admin.md` in the ShramkoGSFPV FB-groups project and `FBG-SPEC.md` in the FB-groups area).
**Not deployed. Not pushed.** The lead decides.

## What it is

A read-only window on the vault's records. The truth is in the vault (campaign files, git). `fbgroups.py push` builds
ONE snapshot and sends it to `docker exec -i gsfpv-api python /app/outreach_cli.py push -`; that checks it and replaces
the single file `DATA_DIR/outreach.json`. The admin tab reads that file. Nothing is created on the server, there is no
write route over HTTP, so a lost server is restored by the next push, and the data cannot grow: one file, hard
ceilings, no history.

```
vault (git) --fbgroups.py push--> ssh -> docker exec ... outreach_cli.py push -  --> DATA_DIR/outreach.json (<= 256 KB)
                                                                                      |
admin /admin/ (Outreach tab) <-- GET /api/admin/outreach, export.csv (session + CSRF as the other tabs) <-- apps/api/outreach.py
```

## Files

| Path | What |
|---|---|
| `apps/api/outreach.py` | the store (validation, ceilings, atomic replace), everything worked out at read time (score, totals, funnel, medians, ranking, due list), the CSV, the two admin routes |
| `apps/api/outreach_cli.py` | `push -` (stdin) / `show [--json]` / `clear`, for `docker exec` |
| `apps/api/server.py` | 3 lines: `OUTREACH = OutreachStore(...)`, `OutreachAdmin(OUTREACH).register(ADMIN)` |
| `apps/fly/src/admin/outreach/` | `api.ts` (types, parser), `model.ts` (sort/filter/search/checkpoints, no DOM), `fmt.ts`, `tables.ts` (groups and posts), `sections.ts` (cards, funnel, next, ranking, slices, visits, empty), `tab.ts` |
| `apps/fly/src/admin/main.ts`, `admin.css` | the third tab; the Outreach block of the stylesheet |
| `packages/i18n/locales/admin/outreach/{en,es,pl,ru}.json` | every word (164 keys); `admin-parity.test.ts` now lists the `outreach` namespace |
| `apps/api/tests/test_outreach.py`, `fixtures/outreach-snapshot.sample.json`, `fixtures/outreach-view.sample.json` | 33 tests; the sample snapshot (the contract) and the golden view of it |
| `tools/bench/test/admin-outreach.test.ts` | 25 tests of the page's model against the SAME golden view |
| `tools/bench/src/probe-outreach-copy.ts`, `scripts/admin-dist.mjs` | the browser acceptance on a local copy of production; the admin bundle laid out as a release |

## The snapshot (v1) and its ceilings

The sample both sides test against is `apps/api/tests/fixtures/outreach-snapshot.sample.json` (a byte-for-byte copy of
the vault's `fixtures/outreach-snapshot.sample.json`; a test compares them when the vault is on the machine).
Refused, never cut: more than 250 groups, 600 posts, 6 checks per post, text over 200 characters, a file over 256 KB,
`v != 1`, a duplicate group or post id, a post of an unknown group, a key off the contract (missing OR unknown),
a number out of range, a time that is not ISO with `Z`, a link that is not `https://`, NaN. A refused snapshot is
refused before the atomic write, so the previous one stays byte for byte (tested). Text is cleaned (control and format
characters out, white space collapsed), not shortened.

## What the server works out (so that the vault's report and the tab never differ)

- **score** = `50*pub_rate + 30*min(1, eng/50) + 20*(1-removed_rate)`; `pub_rate`, `removed_rate` from the group's
  counters; `eng` = the mean of `reactions + 3*comments + 5*shares` over the posts whose LATEST check is at
  `age_h >= 24`; none for a group without posts, 0 when banned. The pushed score is kept as `score_pushed` only.
  `test_the_vault_formula_and_due_logic_are_the_same` imports the vault's `fbgroups.py` and compares `score_of`,
  `covered`, the checkpoints, the ceilings and the key lists on a grid of inputs (skipped when the vault is absent).
- **worth more work**: score >= 75, nothing removed, not banned (`WORTH_MIN` in `outreach.py`, sent to the page).
- totals, the funnel (groups -> posted to -> a post is up -> a post was removed), medians (reactions, comments,
  engagement over posts with a mature check) per format, language, topic, kind and format x language x topic, the
  ranking (top 8), and the due list: the checkpoint to measure now (+1 h, +24 h, +72 h, +7 d, +30 d; an older gap
  cannot be measured afterwards), posts sent/pending and not confirmed, and wave-1 groups with no post yet.

## Decisions and differences the lead should know

1. **The score in the sample is not the formula's.** The sample group has 34 reactions, 9 comments, 2 shares at 24 h
   (engagement 71) and 1 post, published: the formula gives **100.0**, the sample says 70.8 (the data lane found the
   same). The tab shows the formula's number. The sample is an illustration; fix the number there if you like (the
   golden view and two tests then need `UPDATE_GOLDEN=1`).
2. **Visits (item 5): not built.** `/api/e` does not take an event that carries `utm_content`: the whitelist has
   `page_view` with a `locale` only, and nothing sends it. Inventing one is a decision for the lead. A proposal: a new
   event `arrival` with one property `utm_content` (`^[a-z0-9._-]{1,40}$`), counted per day into one small file with
   at most 200 keys and 35 days, no cookie and no address, the landing sending it once per visit when the URL has the
   UTM. Until then the tab shows whatever `visits` the snapshot carries (the vault's optional `visits.json`), else a line
   saying arrivals are not counted yet.
3. **Light theme.** The admin has only a dark palette (`color-scheme: dark`, one `:root`). The tab uses the same
   variables and two new ones (`--worth-bg`, `--bad-bg`), so it follows whatever theme the admin gets; in a
   light-scheme browser it looks exactly as the other tabs do (dark), checked and screenshotted.
4. **One campaign per file**, as the brief says; a push of another campaign replaces it and says so
   (`replaced_campaign`).
5. **Unknown keys are refused** (a field the page would not show is a contract change, not noise). The data lane's
   own validator is as strict, so `push` fails loudly on the vault side first.
6. Bar widths are set through CSSOM (`style.setProperty('--w', ...)`): the admin's CSP is `style-src 'self'`, a
   `style=""` attribute would be blocked. A test forbids `style:` / `setAttribute('style')` in the tab's sources.
7. The tab never writes: no POST, no PUT, no DELETE (a test greps the sources; the server answers 404 to all of them
   and a test shows the file unchanged).

## Checks (all green on 2026-10-16)

- `cd apps/api && python -m unittest tests.test_outreach` 33 tests; `python -m unittest discover -s tests` the whole API suite.
- `npx vitest run tools/bench/test/admin-outreach.test.ts packages/i18n/test/admin-parity.test.ts`; `npx vitest run` everything.
- `cd apps/fly && npx tsc --noEmit -p .`; `node scripts/check-architecture.mjs`; `node scripts/check-licenses.mjs`.
- Browser acceptance on a local copy of production (85 checks, `evidence/2026-10-16/outreach-copy.json` + 10 screenshots
  1440x900 and 390x844, one with a light-scheme browser): the API of this branch, the admin bundle under `nginx.conf`'s
  admin CSP (`serve-csp.mjs`), a fresh data folder, a SYNTHETIC snapshot of 140 groups and 59 posts pushed through
  the real CLI over stdin. Every number on the page is compared with an oracle written in the probe (the formula again,
  medians again, designed posts for each checkpoint case); sorted columns are checked as monotone values with the unset
  ones last; filters, search, the CSV downloads (attachment, BOM, one line per row), the empty state, a stale
  snapshot, a damaged file, a refused push (`v:2`, 280 groups: the stored file unchanged), phone geometry (no sideways
  page scroll, tables in their own scroll boxes), a console with no error but the signed-out session probe's 401, and
  the requests (only the logins and GETs). **Control:** the previous build (the live admin's public static files,
  release 49c1b75eb365, no login) has no Outreach tab and fails the first check
  (`outreach-copy-old-build.json`: 2 passed, 1 failed).
  Run: `node tools/bench/scripts/admin-dist.mjs` then `cd tools/bench && npx tsx src/probe-outreach-copy.ts`
  (Node 22: `C:/Users/andri/node-v22`).

## How to deploy (the lead; nothing here was done)

Order: **API first, then the release.** The API change is additive (two GET routes and a CLI); a new admin bundle
before the API would make the tab show an error.

1. Keep a copy of the live `server.py` (rollback). Upload `apps/api/outreach.py`, `outreach_cli.py` and the changed
   `server.py` to `$GSFPV_BASE/api/` (the same `scp` line as in "Ideas (v0.7)", `admin.py` is unchanged), then
   `docker compose up -d --force-recreate gsfpv-api`.
2. Check without a login: `curl -s -o /dev/null -w '%{http_code}\n' https://gsfpv.flyreelstudio.eu/api/admin/outreach`
   -> **401**; the same for `/api/admin/outreach/export.csv?table=groups` -> **401**.
   `docker exec gsfpv-api python /app/outreach_cli.py show` -> `nothing stored`.
3. Ship the release as usual (`deploy/deploy.sh`; the admin bundle is `apps/fly` built by CI; `nginx.conf` is unchanged).
4. First data: `python .claude/skills/fb-groups/scripts/fbgroups.py push` (it runs
   `docker exec -i gsfpv-api python /app/outreach_cli.py push -` over SSH). Then the owner opens the tab.

Rollback: `deploy/rollback.sh <sha12>` takes the tab away; the API additions are harmless and can stay. To go back
fully, restore the saved `server.py`, remove the two new files and recreate `gsfpv-api`. `outreach_cli.py clear`
deletes the one data file (the vault keeps the truth; a push brings it back). The deploy backups already take `data/`.

## Not done

- Visits by `utm_content` (see 2 above): needs the lead's decision on a new event.
- Nothing was pushed to `origin` and nothing was deployed; the live admin was never logged in to (only its public
  static files were read, once, for the control build).

## Commits (branch `outreach-tab`, from `origin/main` 814efc9)

`ded2f8e` API store, routes, CLI, 32 tests - `1b2931d` the tab, words, model tests, golden view - `2c021d3` acceptance
probe, `admin-dist.mjs`, column order - `3358999` the Removed card's words, this note (the last code change) -
`d525654` acceptance evidence at `3358999`. The commit that adds this list follows them and changes only this file.
