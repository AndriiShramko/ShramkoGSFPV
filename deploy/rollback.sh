#!/usr/bin/env bash
# Point "current" back at an earlier release that is still on the hub (atomic rename, no restart).
#   bash deploy/rollback.sh            # list releases
#   bash deploy/rollback.sh <sha12>    # switch
set -euo pipefail
HOST="${GSFPV_HOST:-fpv@65.109.11.177}"
PORT="${GSFPV_PORT:-2222}"
KEY="${GSFPV_KEY:-$HOME/.ssh/fpv_hetzner_key}"
SSH=(ssh -p "$PORT" -i "$KEY" -o BatchMode=yes "$HOST")
if [ -z "${1:-}" ]; then
  "${SSH[@]}" 'cd /home/fpv/gsfpv/releases && ls -1t | grep -Ev "^(current|\.)"; echo "current -> $(readlink current)"'
  exit 0
fi
"${SSH[@]}" bash -s -- "$1" <<'REMOTE'
set -euo pipefail
cd /home/fpv/gsfpv/releases
[ -d "$1" ] || { echo "no release $1"; exit 1; }
ln -sfn "$1" .current-new
mv -T .current-new current
echo "current -> $(readlink current)"
REMOTE
