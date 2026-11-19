# Lane site4: every main button leads where its page promises

Owner's words: brief lines 533-536 (the Fly by Sound page's top menu says "Fly now" and opens the ordinary scene picker; "think where else such mistakes are and repair them all").

## Status

- [x] Stage 1: the audit (probe on the live site) and the design (this file)
- [ ] Stage 2: the repairs, each with a check in apps/site/scripts/verify.mjs or a unit test that fails on origin/main
- [ ] Stage 3: the acceptance (tools/bench/scripts/site4-links.mjs on a local build, the same probe on the live site must fail), the gates, the status parts

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

(stage 3)

## Claims

(stage 3)

## Not verified

(stage 3)

## For the lead

(stage 3)

## Cost notes

- Stage 1: most replies went to finding where each page's main button is built (Header, StickyCTA, the API scene templates); one probe on the live site gave the whole audit table in one run.
