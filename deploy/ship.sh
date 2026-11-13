#!/usr/bin/env bash
# Ship the CI artifact of a main commit (release order step 3, deploy/README.md): wait for CI, download dist,
# neighbours before/after, deploy.sh, smoke. The hub deploy lock (/tmp/hub-deploy.lock) is held for the run.
#   bash deploy/ship.sh <sha>
# The API and nginx.conf must already be on the hub when they changed (deploy/release-api.sh, deploy/release-nginx.sh).
# HUB_LOCK_HELD=1: the caller already holds the hub lock (a longer job around this release) and releases it itself.
# If the CI artifact downloads too slowly: build the same commit locally (scripts/build-release.mjs, its sha = HEAD)
# and run the steps from "neighbours" on by hand.
set -u
cd "$(dirname "$0")/.."
export MSYS_NO_PATHCONV=1
export PATH="$HOME/node-v22:$PATH"
SHA=$(git rev-parse --verify "$1^{commit}") || { echo "STOP: unknown commit $1"; exit 1; }  # the runs API needs the full SHA
set -a; . deploy/hub.env; set +a
KEY="${GSFPV_KEY/#\~/$HOME}"
SSH=(ssh -p "$GSFPV_PORT" -i "$KEY" -o BatchMode=yes "$GSFPV_HOST")
if [ "${HUB_LOCK_HELD:-0}" != 1 ]; then
  "${SSH[@]}" "mkdir /tmp/hub-deploy.lock && echo 'gsfpv ship $SHA $(date -u +%FT%TZ)' > /tmp/hub-deploy.lock/owner" \
    || { echo "STOP: the hub deploy lock is held: $("${SSH[@]}" cat /tmp/hub-deploy.lock/owner 2>/dev/null)"; exit 1; }
  trap '"${SSH[@]}" "rm -rf /tmp/hub-deploy.lock"' EXIT
fi
TOK=$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill 2>/dev/null | sed -n 's/^password=//p')
[ -n "$TOK" ] || { echo "STOP: no GitHub token from git credential"; exit 1; }
api() { curl -s -H "Authorization: Bearer $TOK" "https://api.github.com/repos/AndriiShramko/ShramkoGSFPV/$1"; }
RUN=""
for i in $(seq 1 120); do
  st=$(api "actions/runs?branch=main&head_sha=$SHA&per_page=3" | python -c "import sys,json; r=[x for x in json.load(sys.stdin)['workflow_runs'] if x['name']=='ci']; print(f\"{r[0]['status']} {r[0]['conclusion']} {r[0]['id']}\" if r else 'none')")
  case "$st" in completed*) break;; *) sleep 20;; esac
done
echo "ci: $st"
case "$st" in "completed success "*) RUN=${st##* };; *) echo "STOP: CI not green"; exit 1;; esac
D=.cache/release-$SHA; rm -rf "$D"; mkdir -p "$D"
ID=$(api "actions/runs/$RUN/artifacts" | python -c "import sys,json; print([x for x in json.load(sys.stdin)['artifacts'] if x['name']=='dist'][0]['id'])")
# a dropped connection leaves a short zip (2026-10-18: 44 of 58 MB): download again until the archive tests whole
for t in 1 2 3 4; do
  curl -sL -H "Authorization: Bearer $TOK" -o "$D/dist.zip" "https://api.github.com/repos/AndriiShramko/ShramkoGSFPV/actions/artifacts/$ID/zip"
  unzip -tq "$D/dist.zip" >/dev/null 2>&1 && break
  echo "artifact download $t incomplete ($(stat -c %s "$D/dist.zip") bytes), again"; sleep 5
done
(cd "$D" && unzip -oq dist.zip && sha256sum -c SHA256SUMS) || { echo "STOP: artifact checksum"; exit 1; }
python deploy/neighbours.py snap ".cache/nb-before-$SHA" | tail -1
bash deploy/deploy.sh "$D/dist.tgz" "$D/SHA256SUMS" > "$D/deploy.log" 2>&1; rc=$?
tail -6 "$D/deploy.log"
[ "$rc" = 0 ] || { echo "STOP: deploy.sh exit $rc (whole log: $D/deploy.log)"; exit 1; }
python deploy/neighbours.py snap ".cache/nb-after-$SHA" | tail -1
python deploy/neighbours.py diff ".cache/nb-before-$SHA" ".cache/nb-after-$SHA" --allow gsfpv-web,gsfpv-api,gsfpv-rooms | python -c "import sys,json; d=json.load(sys.stdin); print('neighbours equal', d.get('equal'), 'problems', d.get('problems'))"
node scripts/smoke-release.mjs https://gsfpv.flyreelstudio.eu 2>&1 | tail -2
