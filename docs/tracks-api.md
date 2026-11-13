# Tracks API (courses saved per scene)

Train 1, lane tracks. Code: `apps/api/tracks.py` (store, validator, limits), wired in `apps/api/server.py`; nginx
`location ^~ /api/tracks` in `deploy/nginx.conf`; client `apps/fly/src/course/store.ts`. Tests:
`apps/api/tests/test_tracks.py`, `apps/api/tests/test_nginx_tracks.py`, `packages/tracks/test/fixtures.test.ts`.

## Routes

| Route | Answer |
|---|---|
| `GET /api/tracks?scene=<hex 6-32>` | 200 `{"v":1,"tracks":[{id, version, title, gates, lengthM, created}]}` newest first; `ETag`, 304 on `If-None-Match`, `Cache-Control: public, max-age=30`. 400 `bad-scene` for any other scene id. A scene without courses gives `tracks: []`. |
| `GET /api/tracks/<id>/v<n>` | 200 the track file (`shramko-sonic-track/1`), `Cache-Control: public, max-age=31536000, immutable`, `ETag`. 404 otherwise (only `v1` exists in train 1). |
| `POST /api/tracks` | body: a track file of the contract below (at most 64 KB). 201 `{id, version}`. Refusals `{"ok":false,"error":code}`: 400 `invalid` (with `issues`, at most 8) or `bad-length`, 409 `scene-full`, 413 (over 64 KB), 429 (rate), 507 `disk-full`, 500 `io`. |

The server issues the id, `<sceneId>-<8 hex>`, and sets `created` (UTC, seconds), `version: 1`, `parent: null`; the body's
values of these are replaced. `lengthM` is gate to gate in order (and back to the first gate when `laps > 1`) times the
scale `transform[0]`, rounded to 0.1 m.

## Contract of a server track

The sound package's `validateTrack` (`packages/sonic-fpv/src/track/validate.ts`, ported key for key in `tracks.py`) and on
top: `author.kind` `generator`, `generator.name` `gsfpv-course` (not null), `title` `^Course [0-9a-z-]{1,24}$`,
`scene.kind` `scan`, `scene.id` `^[0-9a-f]{6,32}$`, `version` 1, `parent` null, 1-200 gates, unknown keys refused, NaN and
Infinity refused (as `JSON.parse` does). The TS twin is `validateServerTrack` (`packages/tracks/src/server.ts`); the shared
fixtures `apps/api/tests/fixtures/tracks/valid-*.json` and `invalid-*.json` hold the two together.

The server cannot see the walls: a stored course is only "a valid file". Every client runs `checkTrack` on its own walls
before it shows a course and refuses one that fails.

## Storage

`DATA_DIR/tracks/<sceneId>/<trackId>/v1.json` (sorted keys, two-space indent; numbers as Python writes them, so `2` may read
`2.0`: the JSON value is the same) and `DATA_DIR/tracks/<sceneId>/index.json` (the list rows). Each file: a temporary file,
fsync, `os.replace`, fsync of the directory, all before the 201. An index that is lost or unreadable is rebuilt from the
`v1.json` files on the next list.

## Limits (estimates, `tracks.LIMITS`)

| Limit | Value |
|---|---|
| body | 64 KB (also nginx `client_max_body_size 64k`) |
| creates per client address | 10 an hour (in RAM, `server._rate`, every POST counts) |
| courses per scene | 20 (the 21st: 409) |
| list cache | `max-age=30` |
| disk guard | below `MIN_FREE_GB` free (or the server's guard tripped): 507 |

None of these is measured; they are first guesses to be revised with the live numbers.
