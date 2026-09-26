#!/usr/bin/env bash
# Point "current" back at an earlier release that is still on the hub (atomic rename), then test and
# reload nginx in gsfpv-web: the enforced CSP takes each page's script hashes from the release at
# config load (deploy/nginx.conf), so without a reload the older pages would go out with the newer
# release's hashes and their inline scripts would be blocked.
#   bash deploy/rollback.sh            # list releases
#   bash deploy/rollback.sh <sha12>    # switch
set -euo pipefail
# hub address, port, key and paths come from deploy/hub.env (gitignored; see hub.env.example)
[ -f "$(dirname "$0")/hub.env" ] && set -a && . "$(dirname "$0")/hub.env" && set +a
: "${GSFPV_HOST:?set GSFPV_HOST in deploy/hub.env}" "${GSFPV_PORT:?}" "${GSFPV_BASE:?}"
HOST="$GSFPV_HOST"
PORT="$GSFPV_PORT"
KEY="${GSFPV_KEY:-$HOME/.ssh/id_ed25519}"
KEY="${KEY/#\~/$HOME}"
SSH=(ssh -p "$PORT" -i "$KEY" -o BatchMode=yes "$HOST")
if [ -z "${1:-}" ]; then
  "${SSH[@]}" "cd '$GSFPV_BASE/releases' && ls -1t | grep -Ev '^(current|[.])'; echo \"current -> \$(readlink current)\""
  exit 0
fi
"${SSH[@]}" bash -s -- "$1" "$GSFPV_BASE" <<'REMOTE'
set -euo pipefail
ID="$1"
cd "$2/releases"
[ -d "$ID" ] || { echo "no release $ID"; exit 1; }
prev=$(readlink current 2>/dev/null || echo none)
point() { ln -sfn "$1" .current-new; mv -T .current-new current; }
point "$ID"
echo "current -> $(readlink current) (was $prev)"
if [ "$(docker inspect -f '{{.State.Running}}' gsfpv-web 2>/dev/null || echo false)" != true ]; then
  echo "gsfpv-web is not running: nothing to reload (it reads the map when it starts)"
  exit 0
fi
# same test-then-reload as deploy.sh; a failed test leaves nginx as it was and puts "current" back
if docker exec gsfpv-web nginx -t 2>&1; then
  docker exec gsfpv-web nginx -s reload
  echo "nginx reloaded"
else
  [ "$prev" != none ] && point "$prev"
  echo "nginx -t failed with release $ID, not reloaded: current -> $(readlink current 2>/dev/null || echo none)"
  exit 1
fi
# what /en/ must be served with now: EVERY inline-script hash of this release, or, for a release built
# before the enforced CSP (no csp-hashes.conf), no enforced header at all (Report-Only only)
csp_of_en() { docker exec gsfpv-web wget -q -S -O /dev/null --header 'Host: gsfpv.flyreelstudio.eu' http://127.0.0.1/en/ 2>&1 | grep -i '^ *content-security-policy:' || true; }
if [ -f "$ID/csp-hashes.conf" ]; then
  hashes=$(grep '^"/en/" ' "$ID/csp-hashes.conf" | grep -o "sha256-[A-Za-z0-9+/=]*" || true)
  total=$(printf '%s\n' "$hashes" | grep -c . || true)
  [ "$total" -gt 0 ] || { echo "$ID/csp-hashes.conf lists no hash for /en/: the served policy cannot be checked, look at the site now"; exit 1; }
  missing=$total
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    csp=$(csp_of_en)
    missing=0
    for h in $hashes; do case "$csp" in *"'$h'"*) ;; *) missing=$((missing + 1)) ;; esac; done
    [ "$missing" = 0 ] && break
    sleep 0.5
  done
  [ "$missing" = 0 ] || { echo "the enforced CSP on /en/ lacks $missing of release $ID's $total hashes after the reload: look at the site now"; exit 1; }
  echo "enforced CSP on /en/ carries all $total of release $ID's hashes"
else
  enforced=yes
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    [ -z "$(csp_of_en)" ] && { enforced=no; break; }
    sleep 0.5
  done
  [ "$enforced" = no ] || { echo "release $ID has no csp-hashes.conf but /en/ still gets an enforced CSP after the reload: look at the site now"; exit 1; }
  echo "release $ID has no csp-hashes.conf: /en/ gets only the Report-Only header, as it should"
fi
REMOTE
