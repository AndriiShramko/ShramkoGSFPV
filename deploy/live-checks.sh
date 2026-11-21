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
# LIVE_ONLY=name1,name2: only the named checks run (a repaired check is run again without the other twenty)
run() {
  local name=$1; shift
  if [ -n "${LIVE_ONLY:-}" ]; then case ",$LIVE_ONLY," in *",$name,"*) ;; *) return 0;; esac; fi
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
# Release b2e7a73b (2026-11-16): the first course held a flat square at 4.1 m and this check called it out of the band;
# a flat square stands up to 2.5 m over the gate before it (packages/tracks/src/elements.ts FLAT_RISE_M; the probe's own
# line counts it so), so its band here is 1.2 to 4.5 m (+-0.1 m).
cpband() {
  node scripts/course-path-probe.mjs "$SITE/en" "$OUT/course-path-$1.json" "$OUT" "$1"
  local rc=$?
  node -e '
const rows = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
let ok = true;
for (const r of [].concat(rows)) {
  const all = (r.top && r.top.heights) || [];
  const flat = (r.top && r.top.flat) || [];
  const h = all.filter((v) => v !== null);
  const off = all.filter((v, k) => v !== null && (v < 1.1 || v > (flat[k] ? 4.6 : 2.1))).length;
  console.log(r.id, "first course gates", h.length, "flat squares", flat.filter(Boolean).length, "band", h.length ? [Math.min(...h).toFixed(2), Math.max(...h).toFixed(2)] : null, "out of 1.2-2.0 (+-0.1; a flat square up to 4.5)", off);
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
# Lane editfix (docs/wip/editfix.md): the owner's path into the edit mode with the mouse, on a laptop-like screen (1536x730,
# device scale 1.25): Controls closed by a click, a click into the scene takes the pointer lock, take-off, Shift+G, Shift+B;
# then the view moved by keys, a right drag and the wheel, a click selects a gate, Add gate and a click on the scene (the
# gate lives in the page), the top bar's other buttons, Exit. edit-mouse-probe.mjs on an address that is not localhost
# skips Save and every window row whose words save, send, vote, report, publish, create or go to the admin (source lines
# 275-289); nothing is stored on the server. The check: the probe's exit 0 (every step had its effect).
# ONESPACE=1 (lane editfix E4.6): after Shift+B in the air one Space starts the test flight in the mode, a short Space
# brings the edit view back (Space saves and sends nothing).
editmouse() { ONESPACE=1 node scripts/edit-mouse-probe.mjs "$SITE/en" 70b50d42 1536x730 1.25 0 en live-mouse "$OUT/edit-mouse-wroclaw.json"; }
run edit-mouse-wroclaw locked editmouse
# Fly by Sound over a course made in the ordinary flight (lane mix, sonic-int-review.ts r11 with Z5_COURSE_FIRST=1: Shift+G
# in the ordinary flight, then Backslash; the same keys as soniccheck above, nothing sent or saved; rendering off, no lock).
# The check: the sound mode takes that course (one set of gates) and the hum has a target.
sonicfirst() { Z5_COURSE_FIRST=1 soniccheck "$@"; }
run sonic-eye-course-wroclaw sonicfirst eye-wroclaw 70b50d42 0 60 Shift+KeyG 'takes the course made by eye' 'makes a course'
# Train 3 integration F (lanes uiaudit, voxview with voxview2, loadq with loadq2). Seam b: the setting display.stillDetail
# raises the detail only while the flight is paused; no check above pauses and then reads a count, a frame time or a
# picture, so none of them needs set.display.stillDetail=0.
# Voxels alone on Wroclaw. voxview2-probe.mjs (header: Shift+G, V, Shift+B, Esc, P; the course lives in the page, the edit
# mode is left by Esc, nothing is saved or sent; no Save, Send or Create control in its source) and voxview-depth-probe.mjs
# --panel (rendering off: opens the walls and voxels panel by its caption at four sizes, closes it by its cross and by Esc).
# The check: the voxel walls reach the whole scene (share of chunks drawn 100), no frame misses a depth copy, Esc with the
# panel open closes only the panel in a flight, a pause and the edit mode; at every size the cross and Esc close the panel.
voxalone() {
  node scripts/voxview2-probe.mjs "$SITE/en" 70b50d42 "$OUT/voxels-alone-wroclaw.json" "$OUT/voxels-alone" live-vox || return 1
  node -e '
const j = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const st = (j.start && j.start.stats) || {};
const miss = (j.start && j.start.miss) || {};
const esc = (j.esc || []).map((e) => [e.label, e.ok]);
console.log("chunks", st.chunks, "share", st.share, "miss frames", miss.missFrames, "esc", JSON.stringify(esc));
process.exit(st.share === 100 && miss.missFrames === 0 && esc.length === 3 && esc.every((e) => e[1] === true) ? 0 : 1);' "$OUT/voxels-alone-wroclaw.json"
}
voxpanel() {
  node scripts/voxview-depth-probe.mjs "$SITE/en" 70b50d42 "$OUT/voxel-panel.json" "$OUT/voxel-panel" live-panel --panel || return 1
  node -e '
const j = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
let ok = true;
for (const [size, p] of Object.entries(j.panel || {})) {
  const a = p.after || {};
  console.log(size, "in view", p.menuInView, "cross on top", p.closeOnTop, "closed by cross", a.closeBtn, "closed by Esc", a.esc);
  ok = ok && p.menuInView === true && p.closeOnTop === true && a.closeBtn === true && a.esc === true;
}
process.exit(ok && Object.keys(j.panel || {}).length === 4 ? 0 : 1);' "$OUT/voxel-panel.json"
}
run voxels-alone-wroclaw locked voxalone
run voxel-panel-wroclaw voxpanel
# The Detail line and the pause's rise: loadq-probe.mjs (header: one page load, nothing pressed but the pause key P and,
# for the move, the stick of the probe's own flight; PILOT writes the Splat budget setting into the probe browser's own
# prefs, nothing on the server). Detail: on Wroclaw with the budget set by hand to 16 M the page shows a line
# 'Detail: ...'. Pause: on Lublin from 140 m up on the weak class the count of splats drawn in a pause rises above the
# flight's (more than 1.5 times the highest of the last three samples before the pause); after Continue the budget in force is the flight's within
# 2 s and the count drawn falls (it reaches the budget later: 4.0 M of 2.5 M at 1.8 s on the local copy).
# SECS of these two runs counts from the reveal (REVEALMAX: up to 300 s of download before it): on the live site Lublin
# revealed after 26 s and Wroclaw not within 30 s, so the first run on release 7af2aad5 ended before the pause's end and
# before any sample (the checks' fault, not the page's).
detailline() {
  env OUT="$OUT/loadq" SCENE=70b50d42 VW=1366 VH=768 PILOT=16 SECS=30 REVEALMAX=300 node scripts/loadq-probe.mjs "$SITE/en" live-detail-wroclaw || return 1
  node -e '
const j = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const lines = (j.samples || []).map((s) => s.detail || {}).filter((d) => d.shown && /^Detail: /.test(d.text || ""));
console.log("samples with the Detail line", lines.length, "last", lines.length ? lines[lines.length - 1].text : "-");
process.exit(lines.length > 0 ? 0 : 1);' "$OUT/loadq/live-detail-wroclaw.json"
}
# pause-rise-lublin holds an absolute place (AT, YAW; loadq-hold.mjs): the pose of the passing run of 2026-11-16, 140 m over
# the start of that time. Since car 1 (placeStart) "140 m over the start" is another place, low in detail, where the pause never
# needs more than the flight budget (docs/wip/fix-lod.md). The pass rule is unchanged; the line names the best 5 s download rate
# of the scan (MB/s) and, on a failure under 3 MB/s, that the line was too slow to judge (the passing run had 14 MB/s; this
# PC had 0.6 on 2026-11-21 while train 4 ran: Lublin then cannot load the pause's detail within its 20 s).
pauserise() {
  env OUT="$OUT/loadq" SCENE=2f1ddf5f CLASS=desktop-weak AT=146.5,202,-97 YAW=-86.6 PAUSEAT=25 MOVEAT=45 SECS=55 REVEALMAX=300 node scripts/loadq-probe.mjs "$SITE/en" live-pause-lublin || return 1
  node -e '
const j = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const s = j.samples || [];
const p = j.pausedAt, m = j.move || {};
const r0 = j.revealS || 0, t = (x) => x.s - r0;   // samples count from the page start; the pause and the move from the reveal
const flight = Math.max(0, ...s.filter((x) => t(x) > 0 && t(x) < p && x.drawn).slice(-3).map((x) => x.drawn));
const paused = Math.max(0, ...s.filter((x) => t(x) > p && t(x) < m.at && x.drawn).map((x) => x.drawn));
const pf = m.perFrame || [];
const back = pf.find((f) => f[3] <= m.base + 1e-6);
const da = (m.drawnAfter || []).filter((v) => v !== null);
const falls = da.length > 1 && da[da.length - 1] < da[0];
const mbps = Math.max(0, ...s.map((x, i) => { const y = s[i - 5]; return y && x.MB !== undefined && x.s > y.s ? (x.MB - y.MB) / (x.s - y.s) : 0; }));
const ok = p > 0 && m.at > p && flight > 0 && paused > 1.5 * flight && back && back[0] <= 2000 && falls;
console.log("reveal at s", r0, "paused at", p, "move at", m.at, "flight drawn", flight, "pause drawn", paused, "budget back at ms", back ? back[0] : null, "drawn after", JSON.stringify(da), "scan MB/s best 5 s", Math.round(mbps * 100) / 100);
if (!ok && mbps < 3) console.log("FAIL, not judged: the line was too slow to load the scan (under 3 MB/s); run again on a faster line");
process.exit(ok ? 0 : 1);' "$OUT/loadq/live-pause-lublin.json"
}
run detail-line-wroclaw locked detailline
run pause-rise-lublin locked pauserise
# Train 4, car 1 (docs/wip/train4-int.md "Live checks"; lanes site4, edit4b, menu4, tails4, head4). Each probe prints one
# JSON verdict and exits non-zero on a failed step; before the train 4 release the live site fails the steps each lane
# repairs (the lanes' negative controls).
# site4-links.mjs (header: read-only, the simulator's address is answered by a stub page, /api/** by 204): the main button
# of the sound, home, scene and supporter pages leads where the page promises; the language switch keeps the anchor; the
# cookie box leaves the start button free at 320 px.
run site4-links node scripts/site4-links.mjs "$SITE" "$OUT/site4-links.json"
# edit4b-probe.mjs (header: never presses Save, send, vote or create; on an address that is not localhost nothing is
# stored, the steps only change the course in the page; render off): the course's life in the editor with the mouse
# (Delete all gates and New empty course ask first, Undo, Fly the course and Back to editing, a sentence naming a gate
# selects it). It takes no GPU lock itself.
edit4blife() { QUERY='&render=off' SHOT=0 node scripts/edit4b-probe.mjs "$SITE/en" 70b50d42 1536x730 1.25 live-after "$OUT/edit4b-course-life.json"; }
run edit4b-course-life locked edit4blife
# menu4-first-minute-probe.mjs (header: fresh browser profiles, the cookie question declined, render off; nothing saved
# or sent): the first visit asks "Have you flown FPV before?", the simple pause menu with its "More" line, the short
# settings list with search and "Show all settings".
run menu4-first-minute locked node scripts/menu4-first-minute-probe.mjs "$SITE/en" "$OUT/menu4-first-minute.json"
# tails4-review-start.mjs (header: opens three scans in the page, one click into the scene, sticks still, render off; it
# reads the start the page placed): on 2f1ddf5f, d10c5638 and ab5efa0e the drone starts near the ground, free of the walls.
run tails4-start-moved locked node scripts/tails4-review-start.mjs "$SITE/en" "$OUT/tails4-start-moved.json"
# hot-sog3 (docs/wip/hot-sog3.md): SuperSplat scans in SOG version 3 open and are DRAWN (engine 2.24.2). Reads only
# (hot-sog3-scans.mjs header: opens /fly/?scene=<id>, presses nothing): each id passes when the page is ready, the engine
# draws splats and over 5 % of the picture differs from the clear colour, with no console error and no CSP report.
# Streamed v3 f924b0f5, 593f8c06; single v3 a39abad1 (the owner's), 28ad27ed, 98f74d54; v2 controls 143e76b0, 70b50d42.
# On the engine 2.23.2 the v3 ids fail (streamed: ready over a black scene; single: endless loader).
run scans-open locked env MAXS=120 SHOTS="$OUT/scans-open" PREFIX=live node scripts/hot-sog3-scans.mjs "$SITE/en" "$OUT/scans-open.json" f924b0f5,593f8c06,a39abad1,28ad27ed,98f74d54,143e76b0,70b50d42
# head4 (deploy/nginx.conf, after the nginx reload): only the simulator page may ask for the camera; every other page keeps
# camera=() (two HEAD requests).
head4headers() {
  local fly priv
  fly=$(curl -sI -m 30 "$SITE/en/fly/" | tr -d '\r' | grep -i '^permissions-policy:')
  priv=$(curl -sI -m 30 "$SITE/en/privacy/" | tr -d '\r' | grep -i '^permissions-policy:')
  echo "fly: $fly"; echo "privacy: $priv"
  case "$fly" in *"camera=(self)"*) ;; *) return 1;; esac
  case "$priv" in *"camera=()"*) ;; *) return 1;; esac
}
run head4-camera-headers head4headers
# head4-accept.mjs (header: Chrome's fake camera plays a Motion-JPEG clip of a still portrait and auto-answers the camera
# question; the setting lives in the probe browser's own profile; its step picturesStayHere fails on any request other
# than a GET or to another origin; nothing is saved or sent): "Turn my head to listen" in the sound settings, off loads
# nothing, on opens the camera, Shift+H centres, the listener turns, off closes the camera, a refused camera is said.
# HEAD4_CLIP names the clip (head4-tracker.mjs makes it from a face photo; it stays outside the repository); without the
# clip the probe stops with an error and the check FAILs.
head4accept() { node scripts/head4-accept.mjs "$SITE" "$OUT/head4-accept.json" "${HEAD4_CLIP:-U:/Temp/gsfpv-train4/head4/head4-clip.mjpeg}"; }
run head4-accept locked head4accept
# Train 4, car 2 (docs/wip/train4-int.md "Live checks"; lanes ux4a, ux4b, vox4, edit4a, edit4s, edit4c, sound6). Each
# probe prints one JSON verdict and exits non-zero on a failed step; each passed on the release build of car 2 (S2).
# ux4a-messages-probe.mjs (header: render off, no GPU lock; a course is only generated in the page, the report form is
# opened and closed by its cross, never sent; the probe refuses the course worker's script in its own browser): a problem
# line that stays with its fix and 'Send to the author', the progress lines in place, the Messages list by its button and
# Shift+J, no message over a top-row button, at 1536x730 and 844x390.
run ux4a-messages node scripts/ux4a-messages-probe.mjs "$SITE/en" "$OUT/ux4a-messages.json"
# ux4b-cancel-probe.mjs (header: drawn, so in the GPU lock; a pick, Cancel, the cross and key N only, nothing saved, sent
# or created): a scan's download cancelled from the pause's scan list leaves no asset, no bake, the old scan flying; the
# card at 844x390.
run ux4b-cancel locked node scripts/ux4b-cancel-probe.mjs "$SITE/en" "$OUT/ux4b-cancel.json"
# vox4-probe.mjs (lane vox4 'For the lead': read-only, the voxel mode is a setting of the probe browser's own profile;
# drawn): "Voxels only" stops the scan's drawing (no frozen frame), Lublin's thin walls said, the shading, the fog's
# cost, the panel's cross at two sizes.
run vox4-voxels-only locked env BENCH_UNCAPPED=1 node scripts/vox4-probe.mjs "$SITE/en" "$OUT/vox4-voxels-only.json"
# edit4a-probe.mjs (header: never presses Save, Send, Vote or Create; the course lives in the page; drawn, never with
# render=off): Home frames all, a click selects without moving the view, orbit, pan, the wheel towards the cursor, the
# one gizmo's arrow, ring and size box, Esc cancels a drag, the window at 844x390.
run edit4a-gizmo locked node scripts/edit4a-probe.mjs "$SITE/en" 70b50d42 1536x730 1.25 live "$OUT/edit4a-gizmo.json"
# edit4c-probe.mjs (header: never presses Save, Send or any control that stores; on a non-localhost address the course
# stays in the page; render off): the Add list, the live warnings while a gate is dragged, the warning bar, the list at
# 844x390.
edit4cwarn() { COURSE=g1.1 QUERY='&render=off' node scripts/edit4c-probe.mjs "$SITE/en" "$OUT/edit4c-warnings.json"; }
run edit4c-warnings locked edit4cwarn
# edit4s-probe.mjs with the https address (header: every request but GET to /api/ is aborted by the probe, s7 and s8 are
# not run; nothing reaches the server). Judged here: open, s1 a gate moved, s2 a draft within 3 s, s3 the draft back after
# a reload, s4 Versions with its time, s5 the corrections offer, s9 a new course drops the changes. s6 is left out: it
# needs the stored version's 201, which the probe itself refuses to send on this address.
edit4sdrafts() {
  node scripts/edit4s-probe.mjs "$SITE/en" 70b50d42 1 "$OUT/edit4s-drafts.json"
  node -e '
const j = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const want = ["open", "s1.moveGate2", "s2.draftIn3s", "s3.restored", "s4.versions", "s5.offer", "s9.generateDropsForReal"];
const st = j.steps || {};
const bad = want.filter((k) => !(st[k] && st[k].ok === true));
console.log("judged", want.length, "failed", JSON.stringify(bad), "posts", (j.posts || []).length, j.error || "");
process.exit(j.live === true && !j.error && bad.length === 0 ? 0 : 1);' "$OUT/edit4s-drafts.json"
}
run edit4s-drafts locked edit4sdrafts
# sonic-quick-walk.ts (header: render off, no GPU lock; the page keeps its prefs in the browser, nothing is saved, sent or
# created on the site): Fly by Sound's start screen with Quick start first, sound within 2 s of the click, the first wall
# cue within 12 s, no front or behind in ears-walls, the order of Continue, Quick start and Full course; Chromium, then
# steps 1 to 4 in Firefox.
run sound6-quick-walk env SITE="$SITE" npx tsx src/sonic-quick-walk.ts "$OUT/sound6-quick-walk.json"

if [ "$FAILED" = 0 ]; then echo "LIVE CHECKS: PASS"; exit 0; fi
echo "LIVE CHECKS: FAIL"
exit 1
