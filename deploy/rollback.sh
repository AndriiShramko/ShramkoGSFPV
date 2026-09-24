#!/usr/bin/env bash
# Point "current" back at an earlier release that is still on the hub (atomic rename, no restart).
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
cd "$2/releases"
[ -d "$1" ] || { echo "no release $1"; exit 1; }
ln -sfn "$1" .current-new
mv -T .current-new current
echo "current -> $(readlink current)"
REMOTE
