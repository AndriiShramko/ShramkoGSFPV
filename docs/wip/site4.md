# Lane site4: every main button leads where its page promises

Owner's words: brief lines 533-536 (the Fly by Sound page's top menu says "Fly now" and opens the ordinary scene picker; "think where else such mistakes are and repair them all").

## Status

- [x] Stage 1: the audit (probe on the live site) and the design (this file): 51f7dac4
- [x] Stage 2: the repairs, each with a check in apps/site/scripts/verify.mjs or a unit test that fails on origin/main
  - [x] 2a: MainCta in config/site.ts, header + bottom bar per page, home band button, lang anchor, consent dock; unit test apps/site/test/main-cta.test.ts (7 pass, NEG OK): 3c0c2caf
  - [x] 2b: verify.mjs checks (static + browser): 296/296 on the local build; negative control (neg_control.py swapped the 8 page/component files to origin/main, rebuilt): 269/296, the 27 failing are exactly the new checks (band x4, sound header/bar/keep-clear x12, scene template x4, clicks 1536x730 and 375x667 x4, language anchor, banner 320x568 and 320x640). Logs U:/Temp/gsfpv-train4/site4/verify.log, neg-verify.log
  - Note: no joined person has a scene today, so the person-page check loops over nobody; the code passes `fly` to both buttons (row 4). apps/site/out now holds the origin/main build of the negative control: stage 3 rebuilds first.
  - Note: the privacy hook refuses Bash commands that name verify.mjs (the file holds the public contact address): edit it with Edit, run it through `pnpm verify` or `node scripts/verify.mjs` from apps/site.
- [x] Stage 3: the acceptance (tools/bench/scripts/site4-links.mjs on a local build: 13 of 13 PASS; the same probe on the live site: 12 of 12 FAIL), the gates, the status parts: the commit "site4 stage 3"
  - Local run: the static build (apps/site/out, rebuilt) on 127.0.0.1:6080 for the steps sound, soundall, band, person, lang, banner; the scene step on a local apps/api/server.py (port 6081, SCENE_TEMPLATES = the rebuilt out/scene-templates, DATA_DIR in the temp folder), because a scene page is rendered by the API. Evidence: evidence/2026-11-19/site4/local-static.json, local-scene.json, live.json.

## Audit (stage 1)

Probe: `node tools/bench/scripts/site4-links.mjs https://gsfpv.flyreelstudio.eu U:/Temp/gsfpv-train4/site4/live.json` on 2026-11-19: 12 of 12 steps FAIL on the live site (the negative control of the lane).

| # | Page | Control | Leads now (live) | Should lead |
|---|---|---|---|---|
| 1 | /{lang}/sound/ (4 languages), 1536 px | header main button "Fly now" | /{lang}/fly/ (scene picker) | "Fly by Sound", /{lang}/fly/?sonic=start (the page's own start button) |
| 2 | /{lang}/sound/, under 768 px | the phone's main button (the bottom bar the other pages have) | nothing: no bottom bar, the header button is hidden under md | the bottom bar "Fly by Sound", /{lang}/fly/?sonic=start |
| 3 | /{lang}/scenes/<id>/ (API template) | header main button "Fly now" | /{lang}/fly/ (picker) | that scene: the same flyHref as the page's own "Fly" button |
| 4 | /{lang}/supporters/<slug>/ with a scene | header "Fly now" (desktop) and bottom bar (phone) | /{lang}/fly/ (picker) | the person's scene, the same `fly` as the page's own buttons |
| 5 | / (home), the Fly by Sound band | its only control "Who it is for and how to join" | /{lang}/sound/#sound-who (correct for its words) | add the band's main button "Start Fly by Sound" to /{lang}/fly/?sonic=start; the link stays |
| 6 | every page, header and footer language switch | en/es/pl/ru links | /{other}/<page> without the anchor (/en/sound/#sound-keys -> /pl/sound/) | /{other}/<page>#<anchor> |
| 7 | /es/sound/ at 320x568 and 320x640, banner unanswered | the start button | under the cookie banner (banner y 298..488, button y 405..453; the point under the button's centre is the banner) | the banner never covers the page's main button |
| 8 | /{lang}/ home, privacy, licences, supporters list | header "Fly now", bottom bar | /{lang}/fly/ | the same (these pages promise the simulator in general): OK, no change |
| 9 | /{lang}/scenes/ index | header "Fly now"; cards | /{lang}/fly/; each card its scene | OK, no change |
| 10 | /s/<id> share page (apps/api/locales/share.json "cta") | "Fly it now" | fly_link(scene, render, shared): the shared scene with its settings | OK, no change |

## Design (stage 1)

- One named type `MainCta = { href: string; label: string; p: string }` and `mainCta(locale, kind)` in apps/site/src/config/site.ts, kind `"fly" | "sound" | {scene}`; the sound start address moves there (`soundStartPath(locale)`, today a private helper of the sound page). Header and StickyCTA take a `cta: MainCta` instead of building `flyPath(locale)` themselves; every page passes its own (sound pages: sound, person with a scene: that scene, scene template: `slot("flyHref")`).
- Sound page gets the StickyCTA bottom bar (the phone's main button, as on the other pages) with the sound start. Header at 375 px has no room for a button beside the four language buttons (train 2 measured it): under md the bottom bar is the menu's main button, and the probe clicks that.
- New keys `nav.flySound` ("Fly by Sound") and `sticky.soundNote` in en/es/pl/ru; the band's button reuses `sound.start.button`.
- Language switch: ClickTracker (the one delegated listener that already handles `data-lang`) adds `location.hash` to the link before the navigation. The scene pages (API templates, no script) keep the plain link; noted in Not verified.
- Cookie banner: a pure function `consentDock(viewportH, bannerH, keepClear[], headerBottom): "bottom" | "top"` (apps/site/src/lib/consent-dock.ts, unit test in apps/site/test): the banner stays at the bottom unless it would cover an element marked `data-keep-clear` (the page's main start button) on the screen; then it docks under the header. Recomputed on open, resize and scroll.
- Checks: verify.mjs static checks (header href on sound pages, scene template header href is `{{flyHref}}`, person page header href has the scene, band button) and browser checks (lang hash, banner at 320x568 Spanish when GA is on); apps/api test that the rendered scene page's header button is the scene's flyHref.

## What the owner does

1. Open https://gsfpv.flyreelstudio.eu/en/sound/ on the computer. The top menu's main button now says "Fly by Sound" (not "Fly now"). Click it: the simulator opens in the Fly by Sound start (the address ends with `?sonic=start`), the same place as the big start button on the page.
2. Do the same on /pl/sound/ (and /es/, /ru/): the same button in each language, the same result.
3. On the phone open /en/sound/: at the bottom of the screen there is now a bar with the button "Fly by Sound"; press it: the Fly by Sound start opens.
4. Open the home page /en/ and scroll to the Fly by Sound band: it now has a button "Start Fly by Sound" beside the link "Who it is for and how to join"; press it: the Fly by Sound start opens.
5. Open a scene page, for example /en/scenes/39e63ce9/: the top menu's button opens that scene in the simulator (the address has `scene=39e63ce9`), not the scene picker. The same on a supporter's page with a scene: the menu button flies that person's scene.
6. Open /en/sound/#sound-keys and press "pl" in the top menu: the Polish page opens at the same place (/pl/sound/#sound-keys).
7. On a narrow phone (320 px wide) open /es/sound/ before answering the cookie question: the cookie box now stands under the menu at the top and the start button is free to press; after Accept or Decline the box is gone.

## Claims

1. On every sound page (en, es, pl, ru) the menu's main button is "Fly by Sound" and leads to /{lang}/fly/?sonic=start, the address of the page's own start button; clicked with the mouse at 1536x730 (scale 1.25) and by touch at 375x812 on en and pl. Proof: `node tools/bench/scripts/site4-links.mjs http://127.0.0.1:6080 out.json sound,soundall` on the local build. Last result: 6 of 6 PASS; on the live site 6 of 6 FAIL.
2. The home page's Fly by Sound band has a button that starts the sound mode. Proof: the same probe, step band. Last: PASS local, FAIL live.
3. A scene page's menu button opens that scene. Proof: the probe step scene against a local API (port 6081). Last: PASS local (/en/fly/?scene=39e63ce9), FAIL live (the picker).
4. A supporter's page with a scene: the menu button opens that scene. Proof: probe step person. Last: PASS local, FAIL live.
5. The language switch keeps the page and its anchor. Proof: probe step lang. Last: PASS local (/pl/sound/#sound-keys), FAIL live (no anchor).
6. The cookie banner never covers the start button of /es/sound/ at 320x568 and 320x640. Proof: probe step banner. Last: PASS local (banner docked at y 72..262, button at y 405), FAIL live.
7. The same rules are checked on every build by the site smoke. Proof: `pnpm --filter @gsfpv/site verify`. Last (stage 2): 296 of 296; with the old page files 269 of 296, the 27 failing are the new checks.
8. `mainCta` and `consentDock` are unit-tested. Proof: `npx vitest run apps/site/test/main-cta.test.ts`. Last: 7 pass, NEG OK against origin/main.
9. The gates typecheck, vitest, architecture, i18n, catalog, b18, leaks pass on this tree. Proof: `gates.py --only typecheck,vitest,architecture,i18n,catalog,b18,leaks`. Last result: all PASS except vitest, 1 of 5340 failed: tools/bench/test/chrome.test.ts caught the probe's launch call not spreading `pick.launch`; the probe was repaired, then `npx vitest run tools/bench/test/chrome.test.ts`: 14 of 14 pass (the gates were not run a second time; the probe's lang step was re-run on the live site and still fails there, as it should).

## Not verified

- No person, phone or real controller took part: the clicks are headless Chrome with the mouse and with emulated touch.
- The simulator itself is not loaded by the probe: the /{lang}/fly/ address is answered by a stub page, so the probe proves the address opened, not that the sound lesson then plays (that is the sound lanes' acceptance).
- The pointer-lock step of the common acceptance does not apply: no step of this lane is inside the flight.
- The scene page was checked on a local API with the rebuilt templates, not on the live API: the live result needs the page and the templates deployed together.
- The language switch on the API's scene pages (no script on those pages) keeps the page but not the anchor; those pages have no anchors people link to.
- The person page check uses kanal-fpv from the local supporters data; whether live supporters have a scene today was not checked.
- No picture was taken: the probe measures the banner and button rectangles instead.

## For the lead

- Files outside apps/site/src, the site locales and verify.mjs: apps/site/test/main-cta.test.ts (new unit test), tools/bench/scripts/site4-links.mjs (the lane probe), evidence/2026-11-19/site4/*.json. Nothing in apps/api, rooms, nginx or packages/sonic-fpv.
- Deploy order: the page only (the site build). The scene templates (out/scene-templates) change with it: the API reads them from the release folder, so the API itself needs no new code, but the scene pages show the fix only after the new release folder is current.
- Live checks after the deploy: `node tools/bench/scripts/site4-links.mjs https://gsfpv.flyreelstudio.eu out.json` must print pass true (13 steps); and `pnpm --filter @gsfpv/site verify` on the build.
- New locale keys: nav.flySound and sticky.soundNote (en, es, pl, ru).

## Review

Verdict: SHIP (independent check, 2026-11-19; full text U:/Temp/gsfpv-train4/reviews/site4.md).

- No proven finding. The diff stays in apps/site, the site locales and the lane probe: no flight, keys, pause, touch, Fly by Sound package, course or edit-mode file is touched. Every simulator link on the built sound pages goes to /{lang}/fly/?sonic=start.
- Re-run on a fresh build of the head (127.0.0.1:6082): steps sound 4/4, band 1/1, banner 2/2 PASS (evidence/2026-11-19/site4/review-local.json). Negative controls: main-cta.test.ts with config/site.ts from origin/main, NEG OK; with lib/consent-dock.ts and lib/lang-href.ts absent, NEG OK.
- Review step added to the probe (opt-in `fit`): /{en,es,pl,ru}/sound/ at 844x390, 1366x768 and 768x1024 with the cookie question unanswered. The header's "Fly by Sound" fits and is free, and the start button scrolled to is free and opens the sound start. Local 12/12 PASS; live 12/12 PASS too, so it is a regression check, not proof of a repair (review-live-fit.json).
- Doubts, not proven: (1) langHref leaves an earlier hash on the link when the current hash is empty; a back/forward-cache path could carry a stale anchor, which is harmless. (2) The banner re-docks on every scroll, which may look jumpy on a 320 px phone.
- Not re-run: the scene and person steps (they need a local API), the language step, the site smoke.

## Cost notes

- Stage 1: most replies went to finding where each page's main button is built (Header, StickyCTA, the API scene templates); one probe on the live site gave the whole audit table in one run.
- Stage 2: the most replies went to the smoke's first runs (serve.mjs needs python on PATH; a navigation request carries no #anchor; a missing bottom bar made a click throw on the old build). Cheaper: start the server with the PATH export from the start, and make every click in a check catch its own timeout.
- Review: the most replies went to serving the build (serve-csp needs the release's csp-hashes.conf, serve.mjs died in a subshell); cheaper: serve apps/site/out with python http.server as a background command from the start.
- Stage 3: the most replies went to the run setup (two servers, because a scene page comes from the API); the probe itself gave the whole verdict in one run each side. Cheaper: a probe flag for a second base for the API steps.
