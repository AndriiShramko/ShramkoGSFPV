#!/usr/bin/env bash
# One command for a whole release in the release order (deploy/README.md): neighbours before, API, rooms, nginx,
# static (ship.sh), neighbours after, then the live checks. The lead reads ONE summary instead of driving each step.
#   bash deploy/release-train.sh [--api "a.py b.py"] [--api-flags "--locales"] [--rooms] [--rooms-compose]
#                                [--nginx] [--live "tracks rooms"] [--no-live] <sha>
# --api            files of apps/api for release-api.sh (names without the folder); --api-flags are passed through
# --rooms          release-rooms.sh; --rooms-compose adds --compose (first release, or a change of the limits)
# --nginx          release-nginx.sh
# --live "..."     arguments for tools/bench/src/train1-live.ts (tracks: stores one course on the server; rooms)
# --no-live        deploy only
# Every step's whole output goes to .cache/train-<sha>/<step>.log; the terminal gets one line per step and the
# summary. It stops at the first failing deploy step (that step's own script prints how to undo it); live checks
# all run, a failing one is listed. Prints no value from deploy/hub.env.
set -uo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/node-v22:$PATH"
API="" APIFLAGS="" ROOMS=0 ROOMSC=0 NGINX=0 LIVE="" NOLIVE=0 SHA=""
while [ $# -gt 0 ]; do
  case "$1" in
    --api) API="$2"; shift ;;
    --api-flags) APIFLAGS="$2"; shift ;;
    --rooms) ROOMS=1 ;;
    --rooms-compose) ROOMS=1; ROOMSC=1 ;;
    --nginx) NGINX=1 ;;
    --live) LIVE="$2"; shift ;;
    --no-live) NOLIVE=1 ;;
    -*) sed -n 2,13p "$0"; exit 2 ;;
    *) SHA="$1" ;;
  esac
  shift
done
[ -n "$SHA" ] || { sed -n 2,13p "$0"; exit 2; }
L=".cache/train-$SHA"
mkdir -p "$L"
SITE_URL="https://gsfpv.flyreelstudio.eu"
SUM="$L/summary.txt"
: > "$SUM"
say() { echo "$1" | tee -a "$SUM"; }

step() { # name, command...
  local name="$1"; shift
  "$@" > "$L/$name.log" 2>&1
  local code=$?
  say "$name exit $code: $(grep -v '^\s*$' "$L/$name.log" | tail -1 | cut -c1-160)"
  return $code
}

step neighbours-before python deploy/neighbours.py snap "$L/nb-before" || exit 1
if [ -n "$API" ]; then step api bash deploy/release-api.sh $APIFLAGS $API || { say "STOPPED at api"; exit 1; }; fi
if [ "$ROOMS" = 1 ]; then
  if [ "$ROOMSC" = 1 ]; then step rooms bash deploy/release-rooms.sh --compose; else step rooms bash deploy/release-rooms.sh; fi || { say "STOPPED at rooms"; exit 1; }
fi
if [ "$NGINX" = 1 ]; then step nginx bash deploy/release-nginx.sh || { say "STOPPED at nginx"; exit 1; }; fi
step ship bash deploy/ship.sh "$SHA" || { say "STOPPED at ship"; exit 1; }
say "ship: $(grep -E 'checks passed|neighbours equal' "$L/ship.log" | tr '\n' ' ' | cut -c1-200)"
python deploy/neighbours.py snap "$L/nb-after" > /dev/null 2>&1
say "neighbours (whole release): $(python deploy/neighbours.py diff "$L/nb-before" "$L/nb-after" --allow gsfpv-web,gsfpv-api,gsfpv-rooms | python -c "import sys,json; d=json.load(sys.stdin); print('equal', d.get('equal'), 'problems', d.get('problems'))" 2>&1 | cut -c1-200)"
say "live release.json: $(curl -s "$SITE_URL/release.json" | cut -c1-120)"
[ "$NOLIVE" = 1 ] && { say "live checks skipped"; exit 0; }

cd tools/bench || exit 9
LL="../../$L"
bad=0
# train1-live, accept-fly and sonic-int-review take the GPU lock themselves
if [ -n "$LIVE" ]; then
  SITE="$SITE_URL" SHOTS="$LL" npx tsx src/train1-live.ts $LIVE > "$LL/train1-live.log" 2>&1 || bad=1
  say "train1-live: $(grep '^{"pass"' "$LL/train1-live.log" | cut -c1-600)"
fi
SITE="$SITE_URL" npx tsx src/accept-fly.ts B6 B7 B9 B10 B11 B12 B13 B14 B15 B16 > "$LL/accept-fly.log" 2>&1; c=$?; [ $c = 0 ] || bad=1
say "accept-fly exit $c: $(grep -v '^\s*$' "$LL/accept-fly.log" | tail -1 | cut -c1-200)"
SITE="$SITE_URL" npx tsx src/sonic-int-review.ts r9 > "$LL/r9.log" 2>&1; c=$?; [ $c = 0 ] || bad=1
say "r9 exit $c: $(grep -v '^\s*$' "$LL/r9.log" | tail -1 | cut -c1-200)"
# the centre-throttle probe does not take the lock
until mkdir C:/dev/.gpu-lock 2>/dev/null; do sleep 20; done
node scripts/centre-throttle-probe.mjs "$SITE_URL/en" "$LL/centre-throttle-live.json" all 887f27aa > "$LL/centre.log" 2>&1; c=$?; [ $c = 0 ] || bad=1
rmdir C:/dev/.gpu-lock
say "centre-throttle exit $c: $(grep -v '^\s*$' "$LL/centre.log" | tail -1 | cut -c1-200)"
say "LIVE CHECKS: $([ $bad = 0 ] && echo PASS || echo FAIL)"
exit $bad
