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
- [ ] 4. Page: permission state before connecting (prompt / granted / denied), new line in en/es/pl/ru, unit tests, neg control, local release
  - [x] code + usb.rc2.bridgeAsk (4 languages) + tools/bench/test/app-dji-rc2-lna.test.ts; tsc fly 0 / bench 0; vitest 4 files 37 of 37; neg control NEG OK (origin/main files: exit 1); gates i18n, b18 PASS
  - [ ] local release in a browser
- [ ] 5. Final doc

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

Without a grant Chrome reports (CDP Network.webSocketFrameError and the console):
`Error in connection establishment: net::ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS`. All three names are known to
this Chrome (no TypeError). The bridge's "refused a connection from origin ''" lines are TCP connections Chrome opened
and closed without a request; with a grant the bridge logs "page connected: https://gsfpv.flyreelstudio.eu".

**Cause confirmed:** Local Network Access. In Chrome 156 the permission that decides ws://127.0.0.1 is
`loopback-network`; `local-network-access` alone (CDP) does not open it, `local-network` does not either. Playwright's
'local-network-access' grants all three. The CSP was not the problem (no CSP message).
