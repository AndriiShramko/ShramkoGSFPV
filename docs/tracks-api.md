# Tracks API (courses saved per scene)

Train 1 and train 2, lane tracks. Code: `apps/api/tracks.py` (store, validator, limits), `apps/api/tracks_admin.py` (the
admin's routes), wired in `apps/api/server.py`; nginx `location ^~ /api/tracks` in `deploy/nginx.conf`; client
`apps/fly/src/course/store.ts`. Tests: `apps/api/tests/test_tracks.py`, `apps/api/tests/test_tracks_edit.py`,
`apps/api/tests/test_nginx_tracks.py`, `packages/tracks/test/fixtures.test.ts`. Design: `docs/wip/tracks-plan.md` 2.6-2.10.

## Routes

Refusals are `{"ok":false,"error":code}`. Every POST needs `Content-Type: application/json` (415 `content-type`) and is
refused from another site (`Sec-Fetch-Site: cross-site`, 403 `cross-site`); 400 `bad-length`, 413 (over 64 KB), 429
(rate), 507 `disk-full`, 500 `io` on all of them.

| Route | Answer |
|---|---|
| `GET /api/tracks?scene=<hex 6-32>&sort=top\|new&page=n` | 200 `{"v":1,"sort","page","pages","tracks":[row]}`, 20 rows a page, `ETag`, 304 on `If-None-Match`, `Cache-Control: public, max-age=30`. `sort=top` (the default): Wilson lower bound of up/(up+down) at 95 %, ties by newer, courses with broken reports from 3 clients on the same walls left out; `sort=new`: by created. Hidden courses are left out. 400 `bad-scene`, `bad-sort`, `bad-page`. |
| `GET /api/tracks/<id>/v<n>` | 200 the file of version n (`shramko-sonic-track/1`), `Cache-Control: public, max-age=31536000, immutable`, `ETag`. 404 for an unknown or deleted version and for a hidden course. |
| `POST /api/tracks` | body: a track file (contract below). A new course, or a fork when `parent` names a version of a visible course of the same scene. 201 `{id, version: 1, editToken}`: the token is answered once, only its sha256 is kept. 400 `invalid` (with `issues`, at most 8) or `bad-parent`. |
| `POST /api/tracks/<id>/versions` | header `X-Track-Token` (the course's edit token), body: a track file of the same scene. 201 `{id, version}`. 403 `token` (missing or wrong; a train-1 course has none), 400 `invalid` or `scene-mismatch`, 404 hidden or unknown, 409 `too-many-versions` (50). |
| `POST /api/tracks/<id>/vote` | `{"v": 1\|-1\|0, "voter": "<32 hex>"}` (the browser's random id). 200 `{id, v, up, down, rating}`. One vote per voter a course (a new one replaces it, 0 takes it back); one voter per client address a course a day, else 429 `address-voted`. 400 `bad-vote`, `bad-json`; 413 over 1 KB. |
| `POST /api/tracks/<id>/broken` | `{"gate": 0-59, "wallsDigest": "<16-64 hex>"}`: a client's own check of the course failed on these walls. 200 `{id, broken}` (the largest count of distinct clients on one walls digest). 400 `bad-report`. |

A list row: `{id, version, title, gates, lengthM, created, edited, creator, editor, parent, origin, up, down, rating,
broken}`. `version`, `title`, `gates`, `lengthM` are the latest version's. `creator` and `editor` are `{kind, name}` with
kind `generator` (name null), `pilot` (the name the pilot typed) or `admin` (name null). created by = the origin's creator
for a fork (also through forks of forks), else the first version's author; `editor` and `edited` are set when the course
is a fork or has a later version. `parent {id, version}` is the source of a fork; `origin {id, version}` the first course
of the chain.

The server issues the id, `<sceneId>-<8 hex>`, and sets `id`, `version`, `parent` (the source of a fork, or the version
before for a new version; a version number is never given twice) and `created` (UTC, seconds); the body's values are
replaced. `lengthM` is gate to gate in order (and back to the first gate when `laps > 1`) times the scale `transform[0]`,
rounded to 0.1 m.

## Admin routes (`apps/api/tracks_admin.py`)

Behind the admin's session and `X-CSRF` on every POST (`AdminApi.add_route`); every action is written to
`admin-audit.jsonl` as `tracks.<action>` with the course id.

| Route | What |
|---|---|
| `GET /api/admin/tracks` | `{ok, scenes: [{scene, tracks, hidden}]}` |
| `GET /api/admin/tracks?scene=<hex>` | every row incl. hidden ones, with `versions`, `hidden`, `editable` |
| `GET /api/admin/tracks/<id>/v<n>` | the file, also of a hidden course (`no-store`) |
| `POST /api/admin/tracks/<id>/hide` | `{hidden: true\|false}` |
| `POST /api/admin/tracks/<id>/delete` | `{confirm: true}`: the whole course |
| `POST /api/admin/tracks/<id>/v<n>/delete` | `{confirm: true}`: one version; the last one takes the course |
| `POST /api/admin/tracks/<id>/versions` | a track file: a new version edited by kind `admin`, the creator kept, the same validation |
| `POST /api/admin/tracks/<id>/votes/reset`, `.../broken/reset` | `{confirm: true}` |

## Contract of a server track

The sound package's `validateTrack` (`packages/sonic-fpv/src/track/validate.ts`, ported key for key in `tracks.py`,
succession included: version n > 1 names version n - 1 of the same id) and on top: `scene.kind` `scan`, `scene.id`
`^[0-9a-f]{6,32}$`, 1-60 gates, a gate at most 20 m across, unknown keys refused, NaN and Infinity refused (as
`JSON.parse` does), and by `author.kind`:
- `generator`: `author.name` (when given) and `generator.name` `gsfpv-course` (not null), `title` `^Course [0-9a-z-]{1,24}$`,
  version 1 without a parent.
- `person` (a pilot's edit or fork): `author.name` 2-32 characters, `title` 3-60, both NFC, Unicode letters, marks, digits,
  space and the signs `-_.'` (the title also `,!?#()+:&`), no double or edge spaces, no web address (`://`, `www.`), not
  on the short blocklist; `generator` null or the generator it came from.
- any other kind is refused (the admin's mark is kept by the server, not in the file).
Bounds against hostile files (lane review): every coordinate of a gate or the start within 10000 scan units, every leg
(and the leg back when `laps > 1`) at most 60 flown m, `generator.params` only the generator's own keys with flat values
(number, boolean, null, text up to 40) and `proof` null or `{ok, marginM, pathM}`. The TS twin is `validateServerTrack`
(`packages/tracks/src/server.ts`); the shared fixtures `apps/api/tests/fixtures/tracks/valid-*.json` and `invalid-*.json`
hold the two together.

The server cannot see the walls: a stored course is only "a valid file". Every client runs `checkTrack` on its own walls
before it shows a course and refuses one that fails; it may report that with `POST .../broken`.

## Storage

`DATA_DIR/tracks/<sceneId>/<trackId>/v<n>.json` (sorted keys, compact, never larger than 64 KB, no NaN or Infinity),
`.../<trackId>/meta.json` (authorship marks, the sha256 of the edit token, hidden, votes and broken reports as keyed hashes
of the voter id and the client address, never the raw values), `DATA_DIR/tracks/<sceneId>/index.json` (`{"v":2,...}`, the
rows incl. hidden ones) and `DATA_DIR/tracks/salt.bin` (the key of those hashes). Each file: a temporary file, fsync,
`os.replace`, fsync of the directory, all before the answer. An index that is lost, unreadable or of train 1 (`"v":1`) is
rebuilt from the files on the next list; a train-1 course (only `v1.json`) is read as a generated course without an edit
token.

## Limits (estimates, `tracks.LIMITS`)

| Limit | Value |
|---|---|
| body | 64 KB (also nginx `client_max_body_size 64k`); vote and broken 1 KB |
| creates per client address | 10 an hour (in RAM, `server._rate`) |
| creates of all clients together | 300 an hour (`_all_hits`, as report and share) |
| versions, votes, broken reports per client address | 30, 60, 30 an hour (`server._trvhits`) |
| visible courses per scene | 300 (the oldest unrated is hidden first, then the lowest rated) |
| versions per course | 50 |
| broken reports that leave a course out of `sort=top` | 3 distinct clients on one walls digest |
| list cache | `max-age=30` |
| disk guard | below `MIN_FREE_GB` free (or the server's guard tripped): 507 |

None of these is measured; they are first guesses to be revised with the live numbers.
