# Deploying ShramkoGSFPV to the hub

The live site is a static release built in CI (`dist.tgz` + `SHA256SUMS`). The hub only unpacks it
and switches a symlink (decision D29 in [`docs/decisions.md`](../docs/decisions.md)). Nothing is built
on the server.

Everything about the hub (address, SSH port, user, key, paths) lives in `deploy/hub.env`, which is
gitignored. Copy [`hub.env.example`](hub.env.example) and fill it in. The commands below read it:

```bash
set -a; . deploy/hub.env; set +a
SSH="ssh -p $GSFPV_PORT -i $GSFPV_KEY -o BatchMode=yes $GSFPV_HOST"
```

## What is where on the hub

| Path | What it is |
|---|---|
| `$GSFPV_BASE/compose.yml` | the two containers, `gsfpv-web` (nginx) and `gsfpv-api` (python) |
| `$GSFPV_BASE/nginx.conf` | copy of [`deploy/nginx.conf`](nginx.conf); mounted read-only into `gsfpv-web` as `/etc/nginx/conf.d/default.conf` (a single-file bind mount) |
| `$GSFPV_BASE/config.env` | secrets of the API; never in git |
| `$GSFPV_BASE/api/`, `data/` | API code, counters, leads, bug reports (`reports.jsonl`, `reports/`) and share pictures (`share/`) |
| `$GSFPV_BASE/releases/<sha12>/` | unpacked releases (the last 5 are kept) |
| `$GSFPV_BASE/releases/current` | symlink to the live release; nginx serves `/srv/releases/current` |
| `$GSFPV_BASE/incoming/` | uploaded tarballs |
| `$GSFPV_BACKUPS/` | `gsfpv-predeploy-<UTC>-<sha12>.tgz`, written before every switch |

## Why the order matters: the enforced CSP

The enforced `Content-Security-Policy` lists the sha256 of every inline script, per page. The hashes
come from `csp-hashes.conf` **inside each release** (written by `scripts/build-release.mjs`). The
policy that uses them exists only in the repo's `nginx.conf`. nginx reads the hash map only when it
loads its config.

That gives three rules:

- **Upload `nginx.conf` first, then deploy.** With the old `nginx.conf` live, a new release gets
  no enforced header, and `deploy.sh`'s check after the switch fails. The new `nginx.conf` with an
  old release (no `csp-hashes.conf`) sends only the Report-Only header, as before. That is safe.
- **Reload after every switch.** `deploy.sh` and `rollback.sh` both run `nginx -t`, then
  `nginx -s reload` inside `gsfpv-web`. Without the reload, the pages of one release would go out
  with the hashes of another, and their inline scripts would be blocked.
- **`deploy.sh` refuses to switch** if `$GSFPV_BASE/nginx.conf`, or the copy `gsfpv-web` actually
  sees, is not byte-identical (sha256) to `deploy/nginx.conf` in your checkout. It also refuses if
  `gsfpv-web` is not running. It stops before uploading anything. `--no-switch` skips this check,
  because it only unpacks.

## Changing nginx.conf (this includes the first deploy with the enforced CSP)

Do these steps in this order, before the next `deploy.sh`.

1. **Keep the live copy**, so it can be put back:
   ```bash
   $SSH "cp $GSFPV_BASE/nginx.conf $GSFPV_BASE/nginx.conf.prev"
   ```
2. **Upload** from the same checkout you will deploy from:
   ```bash
   scp -P $GSFPV_PORT -i $GSFPV_KEY deploy/nginx.conf $GSFPV_HOST:$GSFPV_BASE/nginx.conf
   sha256sum deploy/nginx.conf; $SSH "sha256sum $GSFPV_BASE/nginx.conf"      # must be equal
   ```
3. **See which file the container reads:**
   ```bash
   $SSH "docker exec gsfpv-web sha256sum /etc/nginx/conf.d/default.conf"
   ```
4. **Test, then load it:**
   - **The container shows the new sha256** (the upload wrote the file in place): test it where it
     will run, then reload.
     ```bash
     $SSH "docker exec gsfpv-web nginx -t" && $SSH "docker exec gsfpv-web nginx -s reload"
     ```
   - **The container still shows the old sha256** (the upload replaced the file, so the container
     keeps the old one until a restart): `nginx -t` inside the container would test the old file.
     Test the new file in a throwaway container with the same image and mounts. Restart only if
     that passes:
     ```bash
     $SSH "cd $GSFPV_BASE && docker run --rm -v \$PWD/nginx.conf:/etc/nginx/conf.d/default.conf:ro -v \$PWD/releases:/srv/releases:ro nginx:1.29-alpine nginx -t" \
       && $SSH "docker restart gsfpv-web"
     ```
     A config that fails `nginx -t` makes the restarted container crash-loop, and the site goes
     down. That is why the test comes first.
   - **If the test fails:** put the old file back (`$SSH "cp $GSFPV_BASE/nginx.conf.prev $GSFPV_BASE/nginx.conf"`)
     and do not reload or restart. The running nginx keeps the config it loaded, so the site is
     untouched.
5. **Check the site still answers:**
   ```bash
   curl -sI https://gsfpv.flyreelstudio.eu/en/ | grep -i -E '^HTTP|content-security-policy'
   ```
   Expect `200`. The live release decides the header. A release built before the enforced CSP
   gets only `Content-Security-Policy-Report-Only`. A release with `csp-hashes.conf` gets the
   enforced `Content-Security-Policy` with its hashes.
6. **Deploy** as below. The first line `deploy.sh` prints is now
   `nginx.conf on the hub and inside gsfpv-web = deploy/nginx.conf`.

## Changing the API (apps/api/server.py)

The API is not part of `dist.tgz`: `gsfpv-api` runs `$GSFPV_BASE/api/server.py` (mounted read-only
at `/app`) and reads it only when it starts. The first release with the SuperSplat catalogue (D35)
needs both the new API and the new `nginx.conf` (location `^~ /api/superspl/`); either order is
safe (without the API change the location answers `404 {"ok": false}`, without the nginx change
the path falls through to the static site's 404 page; the client reports either as an error).

1. Keep the live copy: `$SSH "cp $GSFPV_BASE/api/server.py $GSFPV_BASE/api/server.py.prev"`.
2. Upload and compare:
   ```bash
   scp -P $GSFPV_PORT -i $GSFPV_KEY apps/api/server.py $GSFPV_HOST:$GSFPV_BASE/api/server.py
   sha256sum apps/api/server.py; $SSH "sha256sum $GSFPV_BASE/api/server.py"      # must be equal
   ```
3. Restart only the API and check it: `$SSH "docker restart gsfpv-api"`, then
   `curl -s https://gsfpv.flyreelstudio.eu/api/health` (200) and, once nginx has the location,
   `curl -sD- -o /dev/null 'https://gsfpv.flyreelstudio.eu/api/superspl/explore?sort=starred&features=walkable&limit=3'`
   twice: `X-Cache: miss`, then `X-Cache: hit`; `...?sort=likes` must answer 400.
4. If it does not come up: put `server.py.prev` back and restart `gsfpv-api` again.

### Bug reports, ideas and share links (W5)

The release with the Feedback dialog and "Share this scene" needs the new API and the new
`nginx.conf` (upload `nginx.conf` first, as above, then the API). Nothing in `compose.yml` changes.

| Route | nginx | API |
|---|---|---|
| `POST /api/report` | `location = /api/report`, POST only, `client_max_body_size 512k`, no cookies | a bug or an idea: stored first in `data/reports.jsonl` (fsync, id `R-YYYYMMDD-NNNN`), then a short Telegram note to the lead bot (kind, id, page, scene, release, whether diagnostics came, the contact the visitor typed, the first 600 characters; never the diagnostics). A bug's diagnostics only with the visitor's consent, in `data/reports/<id>.json`. 8 KB of words, 512 KB on the wire, gzip accepted (unpacked at most 2 MB); honeypot and time-to-submit as for a lead (a suspect is stored, not sent, keeps no diagnostics); 10 an hour per visitor, 300 in all; the disk guard and `REPORTS_CAP_BYTES` (default 1 GB) skip diagnostics, never the record |
| `POST /api/share` | `location = /api/share`, POST only, 512k | a whole JPEG of exactly 1200x630 (at most 400 KB) and its words: `data/share/<id>.jpg` + `.json`, id 11 random URL-safe characters; 12 an hour per visitor, 300 in all; 503 under the disk guard, 507 over `SHARE_CAP_BYTES` (default 1 GB) |
| `GET /s/<id>`, `GET /s/<id>.jpg` | `location ~ "^/s/[A-Za-z0-9_-]{11}(\.jpg)?$"`, GET/HEAD only; any other `/s/...` is the static 404 | the share page: Open Graph and Twitter card tags (og:image is the picture), its own CSP (one hashed script sends a person on to `/<locale>/fly/?scene=<id>`; crawlers do not run it); the picture with `Cache-Control: immutable` |

New environment (in `compose.yml`'s `environment` or `config.env`, all optional, no secrets):
`PUBLIC_ORIGIN` (default `https://gsfpv.flyreelstudio.eu`, the origin the share pages name; set it
for staging), `REPORTS_CAP_BYTES`, `SHARE_CAP_BYTES`. Telegram uses the existing `TG_BOT_TOKEN` and
`TG_CHAT_ID`.

Check after the restart (the second line must answer 404 from the API, not the site's 404 page):
```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'Content-Type: application/json' -d '{"kind":"idea"}' https://gsfpv.flyreelstudio.eu/api/report   # 400 (no message)
curl -s https://gsfpv.flyreelstudio.eu/s/AAAAAAAAAAA | head -c 120                                                                                       # <title>Not found
```

**Reading reports.** There is no public route that lists them. The owner's tool reads them from the
hub over SSH (this file's `hub.env`) into `tools/reports/inbox/` (gitignored: visitors' words and
contacts never go into git):

```bash
python tools/reports/pull.py pull                  # reports.jsonl + every diagnostics file
python tools/reports/pull.py list --kind bug       # the open bugs, newest first
python tools/reports/pull.py show R-20261002-0007 --log   # one report; --log writes its flight log to replay
python tools/reports/pull.py close R-20261002-0007 --note "fixed in <sha>"
```

Open or closed is kept on that machine (`inbox/status.json`) until the admin panel shows reports.

## Deploying a release

1. Take `dist.tgz` and `SHA256SUMS` from the CI run of the commit you ship.
2. Take a neighbours snapshot before the deploy: `python deploy/neighbours.py snap <dir>`.
3. Deploy:
   ```bash
   bash deploy/deploy.sh dist.tgz SHA256SUMS
   ```
   It checks, in order:
   - the sha256 of the tarball, locally and on the hub;
   - the `nginx.conf` guard above;
   - free disk on the hub (at least 2 GB and 3x the tarball);
   - a backup of `$GSFPV_BASE` without the releases (no backup, no switch).

   Then it switches `current`, runs `nginx -t` and reloads. It then waits up to 5 s for `/en/` to
   be served with **every** `/en/` hash from the release's `csp-hashes.conf`. If `nginx -t` fails,
   a hash is missing, or the release lists no hash for `/en/`, it puts the previous release back,
   reloads, and exits 1.
4. Take a neighbours snapshot after the deploy, then diff the two:
   `python deploy/neighbours.py diff <before> <after> --allow gsfpv-web,gsfpv-api`. Anything other
   than our own additions means STOP and roll back.
5. Run the smoke test on the live site: `node scripts/smoke-release.mjs https://gsfpv.flyreelstudio.eu`.

**Before the first deploy with backups:** the SSH user must be able to write `$GSFPV_BACKUPS` and
read everything in `$GSFPV_BASE` except `releases/` and `incoming/`. Otherwise every deploy stops
with "no switch". That fails safe, but it blocks deploys. To check, run the command below. It
should print `backups writable` and nothing else:

```bash
$SSH "test -w $GSFPV_BACKUPS && echo backups writable; find $GSFPV_BASE \( -path $GSFPV_BASE/releases -o -path $GSFPV_BASE/incoming \) -prune -o ! -readable -print"
```

## Rolling back

```bash
bash deploy/rollback.sh            # list the releases still on the hub, and "current"
bash deploy/rollback.sh <sha12>    # switch to one of them
```

The switch is the same atomic `mv -T`. Then `rollback.sh` runs `nginx -t` and reloads. If the test
fails, it points `current` back where it was and exits 1. After the reload it checks `/en/`:

- **A release with `csp-hashes.conf`:** every `/en/` hash must be in the enforced header.
- **An older release without `csp-hashes.conf`:** there must be no enforced header, only
  Report-Only.

Run the smoke test after every rollback.

## Tested so far, and what is not

Both scripts were run end to end on this PC against a fake hub: fake `ssh`, `scp` and `docker`, and
real symlinks. That covered 16 cases: the three refusals, a normal deploy, a stale reload (one hash
out of six missing, so the previous release was put back), a release without an `/en/` line, a failed
`nginx -t`, rollbacks both ways, and a release built before the enforced CSP. On the real hub they
have not been run yet. Neither has `nginx -t` on this `nginx.conf`: Docker does not run on the build
PC. The CI step "Serve the release behind the real nginx config" runs it on every push.
