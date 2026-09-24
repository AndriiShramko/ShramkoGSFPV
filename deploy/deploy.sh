#!/usr/bin/env bash
# Ship one CI-built release to the hub and switch to it atomically. Run from the repo root (Git Bash).
#   bash deploy/deploy.sh <dist.tgz> <SHA256SUMS> [--no-switch]
# Nothing is built on the server. The tarball is checked against SHA256SUMS on both ends,
# unpacked into releases/<sha12>/ and "current" is flipped with rename(2) (mv -T), so a request
# sees either the old release or the new one, never a half-unpacked directory.
# Roll back: bash deploy/rollback.sh <sha12>   (any directory still in releases/)
set -euo pipefail
TGZ="${1:?dist.tgz}"
SUMS="${2:?SHA256SUMS}"
SWITCH=1
[ "${3:-}" = "--no-switch" ] && SWITCH=0
# hub address, port, key and paths come from deploy/hub.env (gitignored; see hub.env.example)
[ -f "$(dirname "$0")/hub.env" ] && set -a && . "$(dirname "$0")/hub.env" && set +a
: "${GSFPV_HOST:?set GSFPV_HOST in deploy/hub.env}" "${GSFPV_PORT:?}" "${GSFPV_BASE:?}"
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

"${SSH[@]}" "mkdir -p $BASE/incoming $BASE/releases $BASE/data"
"${SCP[@]}" "$TGZ" "$HOST:$BASE/incoming/dist-$id.tgz"
"${SSH[@]}" bash -s -- "$BASE" "$id" "$want" "$SWITCH" <<'REMOTE'
set -euo pipefail
BASE="$1"; ID="$2"; WANT="$3"; SWITCH="$4"
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
if [ "$SWITCH" = 1 ]; then
  ln -sfn "$ID" "releases/.current-new"
  mv -T "releases/.current-new" "releases/current"
fi
echo "release $ID (previous: $prev) current -> $(readlink releases/current 2>/dev/null || echo none)"
# keep the last 5 releases, never the current one
ls -1t releases | grep -Ev '^(current|\.)' | tail -n +6 | while read -r old; do
  [ "$old" != "$(readlink releases/current)" ] && rm -rf "releases/$old" && echo "pruned $old"
done
REMOTE
