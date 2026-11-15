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
# train 3 (integration A, docs/wip/train3-lead.md): the frame-priority view rule (D91) on two streamed scans, and the
# engine's own rule with &viewlod=0. lod-view-probe.mjs only reads (header: "nothing in the engine, it only reads"),
# takes the GPU lock itself and writes evidence/<UTC date>/lod-view/<label>.json; the check reads page.lod.view and
# product.engine from it. On: active, not failed, nothing missing, calls counted over the turns. Off: not active, penalty
# 5, angle 90, multiplier 3.
lodcheck() {
  local f="$REPO/evidence/$(date -u +%F)/lod-view/$1.json"
  node -e '
const j = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const v = (j.page && j.page.lod && j.page.lod.view) || {};
const e = (j.product && j.product.engine) || {};
console.log(JSON.stringify({ active: v.active, failed: v.failed, missing: v.missing, calls: v.calls, engine: e }));
const ok = process.argv[2] === "on"
  ? v.active === true && !v.failed && (v.missing || []).length === 0 && v.calls > 0
  : v.active === false && e.lodBehindPenalty === 5 && e.lodUpdateAngle === 90 && e.lodMultiplier === 3;
process.exit(ok ? 0 : 1);' "$f" "$2"
}
# lodrun <scene> on|off: the probe (turns on, so calls are counted while the view turns), then the check of its file
lodrun() {
  local q=() ; [ "$2" = off ] && q=(--no-turns --query '&viewlod=0')
  MSYS2_ARG_CONV_EXCL='*' node scripts/lod-view-probe.mjs --site "$SITE" --scene "$1" --budget 1 --product --heights 0 "${q[@]}" --label "live3-$1-$2" &&
    lodcheck "live3-$1-$2" "$2"
}
for sc in 2f1ddf5f 70b50d42; do
  run "lod-view-on-$sc" lodrun "$sc" on
  run "lod-view-off-$sc" lodrun "$sc" off
done
# train 3: a course generated in the page on Wroclaw (course-path-probe.mjs header: presses only Shift+G and R, nothing
# is sent or saved; the course lives in the page, "Save for everyone" is never pressed): Shift+G with the published
# walls, the gates along the street, regenerations, a crash with respawn keeps the next gate.
# Train 3 integration C (lane fix3b): the probe also measures each gate centre's height over the first wall below it; the
# check names the band of the first course and wants every centre in 1.2 to 2.0 m (+-0.1 m, one 10 cm voxel).
cpband() {
  node scripts/course-path-probe.mjs "$SITE/en" "$OUT/course-path-$1.json" "$OUT" "$1"
  local rc=$?
  node -e '
const rows = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
let ok = true;
for (const r of [].concat(rows)) {
  const h = ((r.top && r.top.heights) || []).filter((v) => v !== null);
  const off = h.filter((v) => v < 1.1 || v > 2.1).length;
  console.log(r.id, "first course gates", h.length, "band", h.length ? [Math.min(...h).toFixed(2), Math.max(...h).toFixed(2)] : null, "out of 1.2-2.0 (+-0.1)", off);
  ok = ok && h.length > 0 && off === 0;
}
process.exit(ok ? 0 : 1);' "$OUT/course-path-$1.json" && [ $rc -eq 0 ]
}
run course-path-wroclaw locked cpband 70b50d42
# Train 3 integration C (lane fix3a): the guide to gate 1 after Shift+G on Wroclaw (gate-guide-probe.mjs header: presses
# Shift+G and Escape only, the course lives in the page, nothing is saved).
# Train 3 integration E: the same run also checks that gate 1 carries the START role (the read-only hook course.look).
run gate-guide-wroclaw locked node scripts/gate-guide-probe.mjs "$SITE/en" 70b50d42 "$OUT/gate-guide-wroclaw.json" "$OUT" wroclaw --shiftg --wait-s=500
# Train 3 integration C (lane onecourse): one course in the scene. onecourse-probe.mjs presses only flight keys (Shift+G,
# Backslash, N; its scripted pilot passes two gates); the course lives in the page and nothing is sent or saved
# (its Save check read is the page's own check of a copy). Render off, no GPU lock. The check: after Backslash and after
# Shift+G in Fly by Sound there is one set of gates (the course feature's, with gates, and none drawn by the sound mode).
onecourse() {
  NOCOURSE=0 node scripts/onecourse-probe.mjs "$SITE/en" "$OUT/onecourse.json" "$OUT" 70b50d42 live || return 1
  node -e '
const j = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const sets = (s) => (s && s.course && s.course.gates > 0 ? 1 : 0) + (s && s.sonic && s.sonic.prims > 0 ? 1 : 0);
let ok = !j.fail;
for (const n of ["backslash-on", "shiftG-sound"]) {
  const st = (j.steps || []).find((x) => x.name === n);
  const k = st ? sets(st.after) : -1;
  console.log(n, "gate sets", k);
  ok = ok && k === 1;
}
process.exit(ok ? 0 : 1);' "$OUT/onecourse.json"
}
run one-course onecourse
# train 3 (integration B, lane sonic3): Fly by Sound switched on in place with Backslash, rendering off (no GPU lock).
# sonic-int-review.ts r11 presses only the keyboard of a flight (Enter on the Controls screen's keyboard choice, W, Q or E,
# Backslash, N, Space, the arrows of the ear pilot); the sound mode fetches only static track and walls files; the course
# made by N lives in the page; nothing is sent or saved. The check reads the named checks from the probe's evidence file,
# so a course that is not flown to its end does not fail it. Tunis: the switch starts no life (Z5_QUICK: no course; the
# scan has no 12 m free way near its spawn, so the probe does not judge the speed there and says so in its record).
# Wroclaw: the switch keeps the speed and starts no life (a street: the speed is judged), N makes a course and gate 1
# is the hum's target (a short flight, then off).
# Train 3 integration C (lane onecourse): Shift+G makes the course in every mode and N is a silent second key in Fly by
# Sound, so the checks press Shift+G (Z5_COURSE_KEY) and one Wroclaw check keeps N.
soniccheck() {
  local tag=$1 scene=$2 quick=$3 flight=$4 key=$5; shift 5
  env Z5_TAG="$tag" Z5_SCENE="$scene" Z5_SPEEDS=5 Z5_QUICK="$quick" Z5_FLIGHT_S="$flight" Z5_COURSE_KEY="$key" Z5_SHOTS="$OUT/sonic-live" \
    npx tsx src/sonic-int-review.ts r11
  local f
  f=$(ls -t "$REPO"/evidence/*/sonic-int-review-r11-live-"$tag".json 2>/dev/null | head -1)
  [ -n "$f" ] || { echo "no evidence file for $tag"; return 1; }
  node -e '
const j = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
let ok = true;
for (const re of process.argv.slice(2)) {
  const c = (j.checks || []).find((x) => new RegExp(re).test(x.name));
  console.log(re, c ? c.pass : "missing");
  ok = ok && !!c && c.pass === true;
}
process.exit(ok ? 0 : 1);' "$f" "$@"
}
run sonic-in-place-tunis soniccheck tunis 887f27aa 1 60 Shift+KeyG 'gives the free flight by sound' 'starts no new life and keeps the speed'
run sonic-course-wroclaw soniccheck wroclaw 70b50d42 0 60 Shift+KeyG 'gives the free flight by sound' 'starts no new life and keeps the speed' 'makes a course'
run sonic-course-wroclaw-n soniccheck wroclaw-n 70b50d42 0 60 KeyN 'gives the free flight by sound' 'makes a course'
# Train 3 integration D (lanes quiet, quiet2, quiet3): the narrator off. quiet-probe.mjs sets the Narrator setting off in the
# prefs document of the probe's own browser (localStorage, nothing on the server), presses only flight keys (Backslash, W,
# Shift+G; the course lives in the page) and sends or saves nothing. Render off, no GPU lock. The check: from the Backslash
# press to 10 s later no line with words to the voice and none to a live region, and the craft moves (over 0.5 m/s) within
# the 2 s that W is held from the press (the probe's own window).
narratoroff() {
  NARRATOR=off FLY_S=15 node scripts/quiet-probe.mjs "$SITE/en" "$OUT/narrator-off.json" 70b50d42 || return 1
  node -e '
const j = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const m4 = j.m4 || null;
const voiced = m4 ? (j.voiced || []).filter((v) => v.t >= m4.press && v.t <= m4.press + 10 && String(v.text || "").trim() !== "").length : -1;
const live = m4 ? m4.lines10 : -1;
const moved = (j.samples || []).some((s) => s.tag === "w" && (s.speed > 0.5 || Math.abs(s.vy || 0) > 0.5));
console.log("fail", j.fail || "-", "narrator", j.narrator, "voiced 0..10 s", voiced, "live 0..10 s", live, "moved with W", moved);
process.exit(!j.fail && voiced === 0 && live === 0 && moved ? 0 : 1);' "$OUT/narrator-off.json"
}
run narrator-off narratoroff
# Train 3 integration E (lanes fix3a and editor3). The edit mode on Wroclaw: editor3-smoke.ts (header: a course made in this
# tab by Shift+G, never saved; Shift+B, a click selects a gate, drags on the centre box, an arrow and a ring, Ctrl+Z, Esc
# leaves; it never presses a save, send or create control; its pictures go to U:/Temp/gsfpv-train3/shots). The check: the
# mode opened with a gate selected, an arrow moved it, Esc closed the mode. The click on another gate is printed only: on
# the local copy (dist of e38ce9c9) the probe found no other gate on screen on Wroclaw even after backing the view off
# four times (click target -1); editor3-prove.ts proves the click there but presses Save, so it stays out of this file.
editlive() {
  SCENES=70b50d42 OUT="$OUT" TAG=live-edit npx tsx src/editor3-smoke.ts || return 1
  node -e '
const j = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const s = (j.scenes || {})["70b50d42"] || {};
const open = !!(s.open && (s.open.ok || s.open.open || s.open === true));
const sel = !!(s.click && s.click.ok);
const moved = (s.move || []).some((m) => m.moved > 0.05);
const closed = !!(s.exit && s.exit.closed);
console.log("open", open, "selected by a click (information)", sel, "moved by an arrow", moved, "closed by Esc", closed, s.error || "");
process.exit(open && moved && closed ? 0 : 1);' "$OUT/live-edit.json"
}
run edit-mode-wroclaw locked editlive
# Fly by Sound over a course made in the ordinary flight (lane mix, sonic-int-review.ts r11 with Z5_COURSE_FIRST=1: Shift+G
# in the ordinary flight, then Backslash; the same keys as soniccheck above, nothing sent or saved; rendering off, no lock).
# The check: the sound mode takes that course (one set of gates) and the hum has a target.
sonicfirst() { Z5_COURSE_FIRST=1 soniccheck "$@"; }
run sonic-eye-course-wroclaw sonicfirst eye-wroclaw 70b50d42 0 60 Shift+KeyG 'takes the course made by eye' 'makes a course'

if [ "$FAILED" = 0 ]; then echo "LIVE CHECKS: PASS"; exit 0; fi
echo "LIVE CHECKS: FAIL"
exit 1
