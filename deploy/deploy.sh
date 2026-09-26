#!/usr/bin/env bash
# Ship one CI-built release to the hub and switch to it atomically. Run from the repo root (Git Bash).
#   bash deploy/deploy.sh <dist.tgz> <SHA256SUMS> [--no-switch]
# Nothing is built on the server. The tarball is checked against SHA256SUMS on both ends,
# unpacked into releases/<sha12>/ and "current" is flipped with rename(2) (mv -T), so a request
# sees either the old release or the new one, never a half-unpacked directory.
# Before anything is uploaded (switching deploys): the hub's nginx.conf, and the copy gsfpv-web
# actually sees, must be byte-identical to deploy/nginx.conf, or the deploy is refused (the order
# for a changed nginx.conf is in deploy/README.md).
# Before the switch: free-disk guard and a backup of the gsfpv directory (config, the current
# release pointer, data) in GSFPV_BACKUPS; no backup = no switch. After the switch nginx is
# reloaded, because the enforced CSP reads each page's script hashes from the release at load
# time (see nginx.conf); if `nginx -t` fails, or /en/ is then not served with EVERY inline-script
# hash of the new release, "current" goes back to the previous release (reloaded again).
# Roll back: bash deploy/rollback.sh <sha12>   (any directory still in releases/)
set -euo pipefail
TGZ="${1:?dist.tgz}"
SUMS="${2:?SHA256SUMS}"
SWITCH=1
[ "${3:-}" = "--no-switch" ] && SWITCH=0
# hub address, port, key and paths come from deploy/hub.env (gitignored; see hub.env.example)
[ -f "$(dirname "$0")/hub.env" ] && set -a && . "$(dirname "$0")/hub.env" && set +a
: "${GSFPV_HOST:?set GSFPV_HOST in deploy/hub.env}" "${GSFPV_PORT:?}" "${GSFPV_BASE:?}" "${GSFPV_BACKUPS:?}"
HOST="$GSFPV_HOST"
PORT="$GSFPV_PORT"
KEY="${GSFPV_KEY:-$HOME/.ssh/id_ed25519}"
KEY="${KEY/#\~/$HOME}"
SSH=(ssh -p "$PORT" -i "$KEY" -o BatchMode=yes "$HOST")
SCP=(scp -P "$PORT" -i "$KEY" -o BatchMode=yes)
BASE="$GSFPV_BASE"

want=$(grep ' dist.tgz$' "$SUMS" | awk '{print $1}')
have=$(sha256sum "$TGZ" | awk '{print $1}')
[ -n "$want" ] && [ "$want" = "$have" ] || { echo "local sha256 mismatch: $have vs $want"; exit 1; }
id="${have:0:12}"
bytes=$(wc -c < "$TGZ" | tr -d ' ')

if [ "$SWITCH" = 1 ]; then
  # The enforced CSP only exists in the repo's nginx.conf. With an older one live, the switch would
  # go through and the hash check after it would fail, so compare first: the file on the hub
  # (compose mounts $BASE/nginx.conf) and what the running container sees (a replaced file keeps the
  # old inode inside the container until `docker restart gsfpv-web`).
  conf_repo=$(sha256sum "$(dirname "$0")/nginx.conf" | awk '{print $1}')
  conf=$("${SSH[@]}" bash -s -- "$BASE" <<'REMOTE'
h=$(sha256sum "$1/nginx.conf" 2>/dev/null | cut -c1-64)
w=$(docker exec gsfpv-web sha256sum /etc/nginx/conf.d/default.conf 2>/dev/null | cut -c1-64)
r=$(docker inspect -f '{{.State.Running}}' gsfpv-web 2>/dev/null || echo false)
echo "${h:-missing} ${w:-missing} ${r:-false}"
REMOTE
) || { echo "REFUSED: could not read nginx.conf on the hub over ssh. Nothing was uploaded or switched."; exit 1; }
  read -r conf_hub conf_web web_running <<< "$conf"
  if [ "$conf_hub" != "$conf_repo" ]; then
    echo "REFUSED: $BASE/nginx.conf on the hub (sha256 $conf_hub) is not this repo's deploy/nginx.conf ($conf_repo)."
    echo "Put the repo's nginx.conf live first, in the order given in deploy/README.md (\"Changing nginx.conf\"), then run this again."
    echo "Nothing was uploaded or switched."
    exit 1
  fi
  if [ "$web_running" != true ]; then
    echo "REFUSED: gsfpv-web is not running on the hub. Start it (docker compose up -d gsfpv-web in $BASE), check the site answers, then run this again."
    echo "Nothing was uploaded or switched."
    exit 1
  fi
  if [ "$conf_web" != "$conf_repo" ]; then
    echo "REFUSED: the hub file is right, but gsfpv-web still sees an older nginx.conf (sha256 $conf_web)."
    echo "Test the new file and restart the container as in deploy/README.md (\"Changing nginx.conf\", step 4), then run this again."
    echo "Nothing was uploaded or switched."
    exit 1
  fi
  echo "nginx.conf on the hub and inside gsfpv-web = deploy/nginx.conf (sha256 $conf_repo)"
fi

"${SSH[@]}" "mkdir -p $BASE/incoming $BASE/releases $BASE/data"
# STOP rule (spec-ops): at least 2 GB free and 3x the artifact, or nothing is uploaded
avail=$("${SSH[@]}" "df -Pk $BASE | awk 'NR==2 {print \$4}'")
need_kb=$(( bytes * 3 / 1024 ))
[ "$need_kb" -lt 2097152 ] && need_kb=2097152
[ -n "$avail" ] && [ "$avail" -ge "$need_kb" ] || { echo "not enough free disk on the hub: ${avail:-?} KiB free, need $need_kb KiB"; exit 1; }
echo "free disk on the hub: $avail KiB (need $need_kb KiB)"
"${SCP[@]}" "$TGZ" "$HOST:$BASE/incoming/dist-$id.tgz"
"${SSH[@]}" bash -s -- "$BASE" "$id" "$want" "$SWITCH" "$GSFPV_BACKUPS" <<'REMOTE'
set -euo pipefail
BASE="$1"; ID="$2"; WANT="$3"; SWITCH="$4"; BACKUPS="$5"
cd "$BASE"
got=$(sha256sum "incoming/dist-$ID.tgz" | awk '{print $1}')
[ "$got" = "$WANT" ] || { echo "remote sha256 mismatch: $got"; exit 1; }
if [ ! -d "releases/$ID" ]; then
  mkdir "releases/.tmp-$ID"
  tar xzf "incoming/dist-$ID.tgz" -C "releases/.tmp-$ID"
  [ -f "releases/.tmp-$ID/en/index.html" ] || { echo "release has no en/index.html"; rm -rf "releases/.tmp-$ID"; exit 1; }
  chmod -R a+rX "releases/.tmp-$ID"
  mv "releases/.tmp-$ID" "releases/$ID"
fi
prev=$(readlink releases/current 2>/dev/null || echo none)
web_running() { [ "$(docker inspect -f '{{.State.Running}}' gsfpv-web 2>/dev/null || echo false)" = true ]; }
point() { ln -sfn "$1" "releases/.current-new"; mv -T "releases/.current-new" "releases/current"; }
# put the previous release back after a failed check, and reload so its own hashes are served again
revert() {
  if [ "$prev" != none ]; then point "$prev"; else rm -f releases/current; fi
  if web_running && docker exec gsfpv-web nginx -t >/dev/null 2>&1; then docker exec gsfpv-web nginx -s reload; fi
  echo "$1: current -> $(readlink releases/current 2>/dev/null || echo none) (previous release put back)"
  exit 1
}
if [ "$SWITCH" = 1 ]; then
  # backup BEFORE the switch: everything in the gsfpv directory except the unpacked releases and
  # uploads (they are rebuilt from CI artifacts), plus the "current" symlink itself. config.env is
  # inside, hence umask 077. tar exit 1 = a file changed while read (live counters in data/): kept.
  mkdir -p "$BACKUPS"
  bk="$BACKUPS/gsfpv-predeploy-$(date -u +%Y%m%dT%H%M%SZ)-$ID.tgz"
  mapfile -t items < <(ls -A | grep -vxE 'releases|incoming')
  [ -L releases/current ] && items+=(releases/current)
  rc=0
  (umask 077 && tar czf "$bk" -- "${items[@]}") || rc=$?
  [ "$rc" -le 1 ] || { echo "backup failed (tar exit $rc): no switch"; rm -f "$bk"; exit 1; }
  n=$(tar tzf "$bk" | wc -l) || { echo "backup does not list: no switch"; exit 1; }
  [ "$n" -gt 0 ] || { echo "backup is empty: no switch"; exit 1; }
  echo "backup $bk: $(stat -c %s "$bk") bytes, $n entries"

  point "$ID"
  # the CSP hash map is read at config load: test and reload, or put the previous release back
  if web_running; then
    if docker exec gsfpv-web nginx -t 2>&1; then
      docker exec gsfpv-web nginx -s reload
      echo "nginx reloaded"
    else
      revert "nginx -t failed with release $ID, not reloaded"
    fi
  else
    echo "gsfpv-web is not running: nothing to reload (it reads the map when it starts)"
  fi
fi
echo "release $ID (previous: $prev) current -> $(readlink releases/current 2>/dev/null || echo none)"
# The reload reaches new workers within moments. /en/ must then carry EVERY inline-script hash of the
# new release: most hashes stay the same between releases, so one matching hash proves nothing.
if [ "$SWITCH" = 1 ] && web_running; then
  if [ -f "releases/$ID/csp-hashes.conf" ]; then
    hashes=$(grep '^"/en/" ' "releases/$ID/csp-hashes.conf" | grep -o "sha256-[A-Za-z0-9+/=]*" || true)
    total=$(printf '%s\n' "$hashes" | grep -c . || true)
    [ "$total" -gt 0 ] || revert "releases/$ID/csp-hashes.conf lists no hash for /en/, so the reload cannot be proven"
    missing=$total
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      csp=$(docker exec gsfpv-web wget -q -S -O /dev/null --header 'Host: gsfpv.flyreelstudio.eu' http://127.0.0.1/en/ 2>&1 | grep -i '^ *content-security-policy:' || true)
      missing=0
      for h in $hashes; do case "$csp" in *"'$h'"*) ;; *) missing=$((missing + 1)) ;; esac; done
      [ "$missing" = 0 ] && break
      sleep 0.5
    done
    [ "$missing" = 0 ] || revert "the enforced CSP on /en/ lacks $missing of the new release's $total hashes after the reload"
    echo "enforced CSP on /en/ carries all $total of the new release's hashes"
  else
    echo "release $ID has no csp-hashes.conf (built before the enforced CSP): only the Report-Only header applies"
  fi
fi
# keep the last 5 releases, never the current one
ls -1t releases | grep -Ev '^(current|\.)' | tail -n +6 | while read -r old; do
  [ "$old" != "$(readlink releases/current)" ] && rm -rf "releases/$old" && echo "pruned $old"
done
REMOTE
