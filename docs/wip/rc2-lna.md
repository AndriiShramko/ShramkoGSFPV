---
type: wip
status: active
summary: Lane rc2-lna - the RC bridge from the live https page and Chrome's Local Network Access (loopback) permission
created: 2026-11-13
---
# Lane rc2-lna

## Status
- [x] 1. Cause measured (tools/bench/scripts/rc2-lna-diag.mjs, evidence/2026-11-13/train1c/rc2-lna-diag.json)
- [x] 2. rc2-probe.mjs: grant variant and not-granted variant for https bases (0c68eea4, 46d0fd66)
- [x] 3. Live runs with the replay bridge, port free after (evidence/2026-11-13/train1c/rc2-lna-live.json: 13 of 13 checks pass; port 47310: 0 sockets after)
- [x] 4. Page: permission state before connecting (prompt / granted / denied), new line in en/es/pl/ru, unit tests, neg control, local release
  - [x] code + usb.rc2.bridgeAsk (4 languages) + tools/bench/test/app-dji-rc2-lna.test.ts; tsc fly 0 / bench 0; vitest 4 files 37 of 37; neg control NEG OK (origin/main files: exit 1); gates i18n, b18 PASS
  - [x] local release in a browser: rc2-probe bridge-lna, 6 of 6 checks (evidence/2026-11-13/train1c/rc2-lna-local.json)
- [x] 6a. rc_bridge.py --record; 6b. analyze_record.py; tests 17 OK, neg control NEG OK
- [ ] 6c. Similar controllers: findings below; the page text change is left for a later lane (budget)
- [x] 6d. The owner's window (below)
- [x] 7. This doc

Note: a PC reboot left four of the predecessor's uncommitted files as NUL bytes (dji-rc2-bridge.ts, dji-rc2-source.ts,
usb-look-block.ts, en.json). They were restored from git and step 4 was written again; es/pl/ru, the key list in
app-usb-look.test.ts and app-dji-rc2-lna.test.ts had survived and were kept.

## Facts (measured)
Run 2026-11-13, replay bridge (`rc_bridge.py --replay frames-rest.json --wiggle`, no --dev) on 127.0.0.1:47310, page
https://gsfpv.flyreelstudio.eu/en/fly/?rcbridge=1 (release 73beb77e), bench browser = system Chrome **156.0.8078.80**,
headless. One fresh context per variant; the WebSocket is made in the page by script (the same call the button makes).

| variant | permissions.query local-network-access / local-network / loopback-network | WebSocket |
|---|---|---|
| no grant | prompt / prompt / prompt | error + close 1006 after 3 ms |
| Playwright grantPermissions(['local-network-access']) | granted / granted / granted | open, hello, `{"state":"reading"}` |
| Playwright 'local-network', 'loopback-network' | - | grantPermissions throws "Unknown permission" |
| CDP Browser.grantPermissions ['localNetworkAccess'] | granted / denied / denied | error + close 1006 |
| CDP Browser.grantPermissions ['localNetwork'] | denied / granted / denied | error + close 1006 |
| CDP Browser.grantPermissions ['loopbackNetwork'] | denied / denied / granted | open, frames |
| CDP Browser.setPermission {name:'local-network-access'} | granted / prompt / prompt | error + close 1006 |
| CDP Browser.setPermission {name:'local-network'} | prompt / granted / prompt | error + close 1006 |
| CDP Browser.setPermission {name:'loopback-network'} | prompt / prompt / granted | open, frames |

Without a grant Chrome reports `net::ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS`. **Cause confirmed:** Local Network
Access; in Chrome 156 the permission that decides ws://127.0.0.1 is `loopback-network`. The CSP was not the problem.

Live run on release 73beb77e (rc2-probe usb,bridge,bridge-nogrant, 2026-11-13 15:39 UTC, the probe of 46d0fd66):
pass, 13 of 13 checks. usb 5 of 5; bridge with the grant (CDP setPermission loopback-network) 6 of 6: no socket on
load, connected, check screen at once (`hid:2ca3:1021:DJI RC 2:12:d`), 186 reports in 2 s, 0 bad, CSP quiet; not
granted 2 of 2: the old page said `nobridge` after 208 ms ("does not answer ... allow it in the site settings").

Local release of this branch (build-release + serve-csp on :5621, replay bridge --dev, rc2-probe bridge-lna = Chrome's
question simulated in the page; headless Chrome): 6 of 6 checks. prompt: one press, line `asking` with the bridgeAsk
text, still `asking` after 3 s (1 socket tried), fake Allow -> wizard `stir/ready` after 198 ms, no second press.
denied: line `denied` with the site-settings text, 0 sockets. Ports 5621 and 47310: no listener after (TIME_WAIT only).

## What a pilot sees (Windows Chrome, this branch)
1. Starts start-rc-bridge.cmd, opens /en/fly/?rcbridge=1, Controls, "My controller is not in the list".
2. Presses "Fly through the RC bridge". The page reads the permission (loopback-network, else local-network-access):
   - not answered yet: the line "Chrome is asking whether this site may reach apps on this device ... Press Allow";
     the page tries the socket (that is what makes Chrome ask), and while the question is open it waits;
   - Allow: the page connects at once and the wizard opens; no second press;
   - Block (now or earlier): "The RC bridge does not answer ... allow it in the site settings", no socket;
   - allowed before, or a browser without this permission: connects as before.
3. Closed the question unanswered: pressing the button again starts over.
Not seen with a real Chrome prompt (headless never shows it): see Not verified.

## The owner's window with the real controller (at most 5 minutes)
Before calling the owner (lead, nothing needs him):
1. Release with this branch on the live site (or test on a local release with `--dev`).
2. Start the real bridge with a record and a log:
   `py -3 -X utf8 tools/rc-bridge/rc_bridge.py --record U:/gsfpv/rc2-rec-<date>.jsonl > U:/gsfpv/rc2-bridge-<date>.log 2>&1`
   (no --replay; DJI Assistant 2 closed; check the first log line names libusb0_dji.dll).
3. Have Chrome on his PC with no answer saved for the site (or already allowed) and this doc open.
The owner (one call, the controller with the cable in):
1. Switch the RC 2 on.
2. In Chrome open https://gsfpv.flyreelstudio.eu/en/fly/?rcbridge=1, Controls, "My controller is not in the list",
   "Fly through the RC bridge".
3. Press Allow in Chrome's question (top left, under the address bar).
4. Move the sticks as the wizard asks, to the check screen.
5. Then once each, with a pause: left stick up, left stick left, right stick up, right stick left.
6. Fly for a minute. Switch off whenever the controller beeps; nothing more is needed.
Afterwards (lead): `python -X utf8 tools/rc-bridge/analyze_record.py U:/gsfpv/rc2-rec-<date>.jsonl` (per channel min,
max, rest; the first four moves named by gesture), and the bridge log (page connected, controller reading / lost,
"no answer" when it switched off).

## Similar controllers (6c, findings; change left for a later lane)
- Page over WebUSB: not tied to product id. `hasStickChannel` (dji-rc2-source.ts) = vendor 2CA3 + an interface
  FF.43.01 with bulk endpoints; usb-look.ts verdict 'rc2' = vendor 2CA3 + part 'sticks'. So any DJI controller with that
  channel already gets "Fly with this controller" and is read only through `stickValues` (result 0, channels 1..6,
  values in range). Tied to the RC 2: `productName = RC2_NAME` ('DJI RC 2') for every product id, so the profile key
  and the lost message say "DJI RC 2" for another controller. To do: name an untested DJI controller in the helper
  when productId != 0x1021 (new key in four languages, unit test of the rule with a neg control).
- Bridge: `rc_bridge.py` opens only (VID, PID) == (2CA3, 1021) and claims interface 0, config 1, endpoints 0x01/0x81
  fixed. Loosening needs reading interface descriptors from libusb0_dji.dll's memory at offsets not measured: not done
  (no guessing). dji-rc2-bridge.ts reports product 0x1021 always.
- packages/input/src/dji-duml.ts: no product id; the frame layout check is the protection.

## Decisions
- The permission rule lives in one place: Rc2BridgeDevice.open (dji-rc2-bridge.ts, LNA_NAMES, lnaStatus). With no
  navigator.permissions the socket is made in the same task as before.
- 'denied' shows the existing usb.rc2.noBridge line (it already says how to allow it in the site settings).
- The probe's bridge-lna variant simulates the question in the page (fake PermissionStatus, sockets to a closed port
  until 'granted'), because a headless Chrome never shows the real prompt.

## For the lead
- A release needs the static build only (apps/fly + locales). No nginx change (the CSP already allows
  ws://127.0.0.1:47310 on /(en|es|pl|ru)/fly/), no API change. The bridge change (tools/rc-bridge) is for the owner's
  PC and the public repo, not the server.

## Not verified
- A real Chrome prompt answered by a person (Allow / Block) and that its answer fires the PermissionStatus change event
  on 'loopback-network' in Chrome 156: headless shows no prompt; only simulated in the page and in unit tests.
- The real RC 2 with --record (needs the owner's window).
- Other DJI controllers: none at hand.
- The whole suite and other gates (lead's job per milestone).

## Cost notes
- Most turns: finding that four predecessor files were NUL bytes after the reboot (the diff looked like binary) and
  rewriting step 4. Cheaper: commit work in progress before long runs, and check `tr -d '\000' | wc -c` first on resume.
