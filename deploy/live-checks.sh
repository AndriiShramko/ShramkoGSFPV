#!/usr/bin/env bash
# Checks of the DEPLOYED site after a release (train 1c, docs/wip/train1c-lead.md "Live checks"). Nothing here presses a
# send or save control and nothing is stored on the server's disk. One check, train1-live rooms, presses the rooms
# panel's create button twice: such a room lives only in the memory of gsfpv-rooms and goes when its pilots leave.
#   bash deploy/live-checks.sh <outdir>
# SITE (default https://gsfpv.flyreelstudio.eu) is the site under test. The whole output of each check goes to
# <outdir>/<name>.log; the terminal gets the live release.json, one line per check and, as the last line,
# 'LIVE CHECKS: PASS' or 'LIVE CHECKS: FAIL'. Exit 0 only on PASS.
# Left out on purpose: train1-live tracks and tracks-page.ts (both store a course; tracks-page also runs only on its own
# local servers), rc2-probe's bridge run (it needs the local RC bridge on ws://127.0.0.1:47310).
# Train 2, wave 1 (docs/wip/train2-lead.md "Live checks"): one read-only check more, the five figures of /en/sound/.
# Left out on purpose as well: pause-over-course-probe.mjs (it presses Shift+G; not confirmed that a generated course
# stores nothing), the course editor, the votes and the admin's Courses tab (they store data; the admin needs a login),
# sonic-int-review r10 (a course by sound, about 9 minutes; not confirmed that it stores nothing), connect-probe.mjs
# (it starts a local helper and sends the page's helper address to its own port past the page's CSP), rc2-probe's
# bridge-lna run (it needs the local helper too), sonic-optin-page part A (one known failing check, see the lead note).
# The browser checks are headless (tools/bench/src/chrome.mjs) and run one after another under the GPU lock
# C:/dev/.gpu-lock: the TypeScript probes take it themselves, the .mjs probes are wrapped here.
set -u
[ $# -eq 1 ] || { echo "usage: bash deploy/live-checks.sh <outdir>"; exit 2; }
cd "$(dirname "$0")/.." || exit 2
REPO=$(pwd)
export PATH="$HOME/node-v22:$PATH"
SITE="${SITE:-https://gsfpv.flyreelstudio.eu}"
SITE="${SITE%/}"
mkdir -p "$1" || exit 2
OUT=$(cd "$1" && { pwd -W 2>/dev/null || pwd; })  # the Windows form of the path where there is one: node reads it
LOCK="${GPU_LOCK:-C:/dev/.gpu-lock}"
HELD=0
trap '[ "$HELD" = 1 ] && rmdir "$LOCK" 2>/dev/null' EXIT
FAILED=0

# run <name> <command...>: the whole output into <outdir>/<name>.log, one line on the terminal
run() {
  local name=$1; shift
  "$@" > "$OUT/$name.log" 2>&1
  local rc=$?
  if [ $rc -eq 0 ]; then echo "$name PASS"; else echo "$name FAIL (exit $rc, see $OUT/$name.log)"; FAILED=1; fi
}
# locked <command...>: the same command with the GPU lock held (for the probes that do not take it themselves)
locked() {
  until mkdir "$LOCK" 2>/dev/null; do sleep 20; done
  HELD=1
  "$@"
  local rc=$?
  rmdir "$LOCK" 2>/dev/null
  HELD=0
  return $rc
}

echo "live checks of $SITE, logs in $OUT"
if curl -s -m 30 "$SITE/release.json" -o "$OUT/release.json" && [ -s "$OUT/release.json" ]; then
  echo "release.json: $(tr -d '\r\n' < "$OUT/release.json")"
else
  echo "release.json FAIL (no answer from $SITE/release.json)"; FAILED=1
fi

cd "$REPO/tools/bench" || exit 2
export SITE
run train1-live-rooms env SHOTS="$OUT/train1-live" npx tsx src/train1-live.ts rooms
run accept-fly npx tsx src/accept-fly.ts B6 B7 B9 B10 B11 B12 B13 B14 B15 B16
run sonic-int-review-r9 npx tsx src/sonic-int-review.ts r9
run centre-throttle-probe locked node scripts/centre-throttle-probe.mjs "$SITE/en" "$OUT/centre-throttle-probe.json" all
run fast-radio-probe locked env FAST_RADIO_SHOTS="$OUT/fast-radio" node scripts/fast-radio-probe.mjs "$SITE/en" "$OUT/fast-radio-probe.json"
run mouse-free-probe locked node scripts/mouse-free-probe.mjs "$SITE/en" "$OUT/mouse-free-probe.json"
run rc2-probe-usb-refused locked node scripts/rc2-probe.mjs "$SITE/en" "$OUT/rc2-probe.json" usb,refused
# train 2 wave 2: published walls, only after deploy/release-walls.sh. Reads only (walls-published-probe.mjs header):
# the walls files answer 200, each scan opens with source 'published' and builds nothing; nothing is sent or saved.
run walls-published-probe locked node scripts/walls-published-probe.mjs "$SITE/en" "$OUT/walls-published-probe.json" 70b50d42,ab5efa0e,9baef54b
# train 2: the sound page carries its five figures (a GET, nothing pressed)
run sound-page-figures bash -c 'n=$(curl -s -m 30 "$SITE/en/sound/" | grep -o "class=\"sound-fig" | wc -l); echo "figures: $n"; [ "$n" -ge 5 ]'

if [ "$FAILED" = 0 ]; then echo "LIVE CHECKS: PASS"; exit 0; fi
echo "LIVE CHECKS: FAIL"
exit 1
