# Lane page: the Fly by Sound page gets its picture (/{lang}/sound/)

Branch sound-page (from origin/main 2a5ac433), worktree C:/dev/gsfpv-site-sound. Files: apps/site/**, packages/i18n/locales/site/**.
Owner's word (2026-11-13): the page is dry, no interesting videos in the background; put his real FPV flights behind it and the animated
infographics with explanations; people ask how one flies by sound at all; it has to be visual and clear.

## Status

Stage P1-video-layout:
- [x] 1. (2c481232) Video slots and layout. config/videos.ts: slot soundHero (garden) and FLIGHTS soundHow (pond), soundStart (acro); BgVideo takes both kinds of slot; media.mjs knows pond and acro. Page: first screen with the Winter Garden loop, h1, one-line lead (sound.hero.lead), the start button, the note; h2 order how, hear, need, start, now, test, who, open, help (10 h2 became 9; keys and record are h3 with their old anchors #sound-keys, #sound-record). The first four h2 are the newcomer's questions. Real-flight strips open "how" and "start". Locales en, ru, pl, es: how/need/start titles as questions, new sound.hero.lead, sound.hear.title, sound.media.{garden,pond,acro}. verify.mjs: new h2 order, 11 h3, the three loops with posters and captions. Site typecheck PASS, i18n-check OK (1172 strings x 4).
- [x] 2. Release build (scripts/build-release.mjs, exit 0, sha 2c481232), verify.mjs static part 175 PASS 0 FAIL before its browser part (that part needs a server on 8138, outside this lane's ports: not run). Probe U:/Temp/gsfpv-train2/page/shots.mjs (headless system Chrome 157, under C:/dev/.gpu-lock) on serve-csp :5740: en and ru at 1440x900 and 360x800 scrollWidth = viewport, h2 order how..help, all three loops attached (1920 AV1 at 1440, 1280 AV1 at 360), garden playing on the first screen; reduced motion at 360: no video attached (state none), poster shown; no JavaScript at 360: h1 and all 9 h2 present. Shots looked at; one fix: the eyebrow was 13 px (site class .eyebrow), now text-sm, smallest text in main 14 px on every run. Shots: U:/Temp/gsfpv-train2/shots/sound-page-p1-{en,ru}-{1440,360}.png plus -top, -how, -start crops, -reduced.
Stage P2-figures:
- [x] 1. (21699f51) apps/site/src/components/SoundFigure.tsx: five inline SVG figures (height, wall, hum, gates, keys), no words inside the drawings, aria-hidden, CSS animation from globals.css (sf-* classes, only under prefers-reduced-motion: no-preference; every element's own place is the still frame). Page: "What do I hear?" has sound.fig.intro, four figures each with an h3 and 3 sentences, then the h3 sound.fig.moreTitle over the old list; the keys card under #sound-keys. Locales en, ru, pl, es: sound.fig.*. verify.mjs: h3 count 11 -> 16 and a new check of the five figures. Site typecheck PASS, i18n-check OK (1192 strings x 4).
- [x] 2. (this commit) Release build (exit 0), verify.mjs static part 179 PASS 0 FAIL; negative control of the new figure check: aria-hidden removed from the wall SVG in out/en/sound/index.html -> that check FAILs, file restored -> 0 FAIL. Probe U:/Temp/gsfpv-train2/page/figs.mjs on serve-csp :5742 under C:/dev/.gpu-lock (system Chrome 157): en 1440, en 360, ru 320, pl 360, es 360: scrollWidth = viewport, 0 CSP messages, five figures, SVG aria-hidden, SVG markup 2358 to 6398 bytes each, text 16 px; running animations per figure 2, 2, 3, 7, 9; reduced motion: 0 animations in all five; no JavaScript: figures and texts present. Header fix for 320 px (see For the lead). Shots looked at: U:/Temp/gsfpv-train2/shots/sound-fig-p2b-*.png; one fix after the first look (the two "wrong way" panels of the gates figure: the bubble overlapped the drone).
Stage P3-acceptance:
- [x] 1. Before numbers: origin/main's apps/site and locales/site built with scripts/build-release.mjs (files restored right after), probe U:/Temp/gsfpv-train2/page/p3.mjs weight on serve-csp :5741: en/sound HTML 108172 bytes (gz file 21938), 1 CSS 55.8 KB, before load 13 requests 765.0 KB, 0 videos.
- [x] 2. First pass on 0db75b95 (p3.mjs full on :5742, shots sound-page-p3b-*): every sheet looked at; defect: the header button "Volar ya" broke into two lines at 1440 in es. Fix 4cfbeb4e (whitespace-nowrap). Chrome repeats content in one full-page capture over 16384 px, so p3.mjs shoots clips and stitches them.
- [x] 3. Second pass on 4cfbeb4e (:5743): ru header 1186 px in a 1152 px bar, page scrolled 34 px sideways at 1152 (nav links px-3). Fix 77c8d2f9: nav links px-2 and nowrap.
- [x] 4. Final pass on 77c8d2f9 (release build exit 0, p3.mjs full on :5744, log U:/Temp/gsfpv-train2/page/p3/final.log), 16 runs: scrollWidth = viewport in all (en/es/pl/ru at 1440, 1152, 360; es 320 and 768; header bar = its width everywhere, fly button 44 px high); smallest text 14 px; 0 CSP messages, 0 failed requests; 0 video requests before the load event in every run; reduced motion: 0 video requests, 0 figure animations, posters shown; no JavaScript: h1, all headings, five figures and 14746 characters of main text present, no text hidden. Headings: one h1, order 1 2 2 3 3 3 3 3 2 2 3 3 2 3 3 2 3 2 3 3 3 4 3 3 4 3 2 2 2, no level skipped. Figures: 5 of 5 with aria-hidden SVG and 182 to 566 characters of text next to them. Links: 47 per page, 20 same-origin ones fetched from the local server per language: 0 bad, 0 missing anchors; 10 external ones not fetched (local-only rule). i18n-check OK (1192 strings x 4), site typecheck exit 0.
  Weight, en (before = origin/main, after = 77c8d2f9; serve-csp sends HTML uncompressed): HTML 108172 -> 173768 bytes (gz file 21938 -> 33068); es 178925, pl 177959, ru 206452. CSS 1 file 55.8 -> 60.2 KB. Before load: 1440 13 req 765.0 KB -> 14 req 928.3 KB; 360 13 req 765.0 KB -> 15 req 944.1 KB. First screen (load + 3 s, no scroll): 1440 18 req 4735.7 KB of which garden-1920.av1 3586.8 KB starting 541 ms after load; 360 18 req 2778.7 KB of which garden-1280.av1 1833.7 KB at 368 ms after load; reduced motion 17 req 945.0 KB. Pond and acro start only when scrolled to (3.5 to 7.2 s in the probe's scroll).
  Looked at (sheets = the full page cut into columns; -top = the first viewport): en-1440 clean; es-1440 clean after 4cfbeb4e (was: "Volar ya" on two lines); pl-1440 clean; ru-1440 clean after 77c8d2f9 (header now fits); en-360 clean; es-360 clean; pl-360 clean; ru-360 clean; es-320 clean (the cookie banner covers the start button in the first 700 px until answered, site-wide); en-360-reduced clean (posters, still figures); en-360-nojs clean (all text, posters, no cookie banner).

## Decisions

- P2 figures, facts: read from the recorded submodule packages/sonic-fpv (378cc50), default theme Soft (prefs.ts theme 'soft', themes/soft.json): height 0.5 m per scale step (metresPerStep), target note every 1250 ms (targetPeriodMs), buzz outside the lesson band; wall pulse period 1400 ms at 4 s to contact down to 110 ms at contact, logarithmic (rules.ts pulsePeriodMs, ttcFarS 4), nearness under 2 m quickens it (pulseDistM), other layers duck under 1.5 s (URGENT_TTC_S); hum 1.2 Hz at 40 m, 8 Hz at 2 m, an octave higher within 8 degrees of the nose (beacon.ts ON_COURSE_DEG), rough when off the gate axis; gate note climbing, wrong side three falling notes and its line, stage line, wrong way two falling pairs and "You are flying back. Turn around." after more than 1 s faster than 0.5 m/s (runner.ts). Voice lines quoted from packages/sonic-fpv/locales/<lang>.json.
- The wall figure's tick strip is computed from those numbers in SoundFigure.tsx (wallKnocks, the same formula as pulsePeriodMs); its cursor runs the 4 s in 4 s of real time. Nothing blinks: ticks are marks in space, opacity changes at most about once a second.
- No words inside the SVGs, so one drawing serves four languages; every number is in the text next to it.
- No sound samples: the package's offline renderer was not wired into the site; not cheap in this stage.
- Lecture infographics (sim-scan, sim-hours) not embedded: none explains flying by sound, and the page has no section where scan-to-browser or sim hours answer a reader's question.
- 320 px: the shared header was 356 px wide on every page at 320 px (wordmark plus four 44 px language buttons); the wordmark text is hidden under 360 px (Header.tsx), the logo and the link label stay.

- Real flights: the owner's FPV lecture deck already has his own flights cut as seamless 12 s loops (U:/ImmersiveWarsaw2026/talks/fpv/deck_public/media, cuts described in talks/fpv/scripts/spec.py). Taken: s04_fpv_view (low over a pond, Bydgoszcz park, source 71-83 s, no people) as "pond" and s10_acro_flip (up a spruce, a roll, a dive into the trees, Bydgoszcz, 30-42 s) as "acro".
- Encoding: apps/site/scripts/encode-flight-videos.sh, ffmpeg of Shutter Encoder ("C:/Program Files/Shutter Encoder/Library/ffmpeg.exe"). Exact commands run from the repository root:
  bash apps/site/scripts/encode-flight-videos.sh pond "U:/ImmersiveWarsaw2026/talks/fpv/deck_public/media/s04_fpv_view.mp4"
  bash apps/site/scripts/encode-flight-videos.sh acro "U:/ImmersiveWarsaw2026/talks/fpv/deck_public/media/s10_acro_flip.mp4"
  Crop 1920x1080 to 1920x960 (y 60), 30 fps, 12.000 s, H.264 and AV1 at 1280 and 1920, WebP posters 800 and 1600 (the loop's first frame).
- Sizes (ls -l): pond 1280 H.264 2378203, 1280 AV1 1829516, 1920 H.264 4741098, 1920 AV1 3976278, posters 73288 and 224626; acro 1280 H.264 2390893, 1280 AV1 1756324, 1920 H.264 4723279, 1920 AV1 3465635, posters 60000 and 144454. All under the landing's L5 caps (1280 under 2.5 MB, 1920 under 5 MB). ffprobe: 1280x640 and 1920x960, 30 fps, 12.000000 s.
- Both widths were encoded (not only 1280) because scripts/media.mjs marks a clip as video only when all four files and both posters exist, and BgVideos picks 1920 from 1100 px CSS width.
- The acro poster (the loop's first frame) is a blurred spruce in a climb; kept, so the video starts without a jump.
- Text over video: the h1 and the strip h2 sit on a gradient scrim from the page colour plus a text shadow; all other text is on the plain page.
- Facts kept: the old lead moved into "How can one fly by sound at all?" with how.text, now.tested and the status (no longer in the first screen); how.items under "What do I hear?"; start text, steps and keys under "How do I start?"; record under "Join the testing".
- Animated infographics: none of the 28 lecture infographics explains flying by sound (scout-B B3); they belong to a later stage, not P1.

## For the lead

- P2: the gates figure's text says "backing up or sliding aside is never called the wrong way" (sound.fig.gates.text, third line, all four languages). That nose-first rule is in ShramkoSonicFPV 4c2ac75, NOT in the submodule commit this branch records (378cc50: wrong way by velocity alone). Ship the page with the submodule bump that carries 4c2ac75, or drop that last sentence.
- P2: apps/site/src/components/Header.tsx changed for every page: under 360 px the wordmark text is hidden (it made the header 356 px wide at 320 px; measured by U:/Temp/gsfpv-train2/page/wide.mjs, after the fix 320/320 in en and ru).

- In this worktree packages/sonic-fpv was checked out at 09535b7 instead of the recorded 378cc50, and the fly build failed (lessonSegments not exported). I ran git submodule update packages/sonic-fpv (this worktree's own module dir) and the release built; nothing committed in the submodule.
- Animated infographics on flying by sound do not exist yet (none of the 28 lecture ones covers it); the next stage makes them. Reusable as is: shramko-fpv-sim-scan.
- The acro poster is a blurred frame; a sharper first frame needs a different cut point in the owner's deck clip (spec.py s10, 30-42 s), not a different poster.

- tools/bench/scripts/sound-page-shots.mjs (not in this lane) reads #sound-how and prints the h2 order; it does not assert the old order in code read so far, but its log line will show the new order how,hear,need,start,now,test,who,open,help.

- P3: Header.tsx changed again for every page (4cfbeb4e fly button nowrap; 77c8d2f9 nav links px-3 -> px-2 and nowrap). Measured by U:/Temp/gsfpv-train2/page/p3.mjs: at 1152 the ru header was 1186 px and the page scrolled sideways; after the fix the bar is 1152/1152 in en, es, pl, ru at 1152 and 1440. Whether origin/main already had the ru overflow was not measured.
- P3: the sound page HTML grew from 108172 to 173768 bytes in en (gz 21938 -> 33068), ru 206452. Most of it is the five inline figures; that Next repeats their markup in the inline RSC payload is an estimate, not measured.
- P3: en and es keep the brand "Fly by Sound" in the eyebrow and the start button ("Iniciar Fly by Sound"), pl and ru translate it ("Lot na s\u0142uch", "\u041f\u043e\u043b\u0451\u0442 \u043f\u043e \u0437\u0432\u0443\u043a\u0443"). Left as it was; one rule for all four is the owner's call.
- P3: full-page captures over 16384 px repeat content in Chrome (the 360 px pages are 17452 to 20165 px tall); p3.mjs shoots clips and stitches them. Any other full-page probe of this page at 360 px will show a doubled hero at the bottom: that is the capture, not the page.

## Not verified

- The negative control of the new verify.mjs check (three loops) was not run on an old build; the live page has 0 video tags (scout-B B3), so the check cannot pass on the old page, but no command showed it fail.
- verify.mjs browser part, sound-page-shots.mjs, accept-v06-landing L5 not run (lead, integration).
- Video playback in H.264 fallback (headless Chrome chose AV1 everywhere); Safari and phones not tried.
- es and pl texts of the new keys are written by the agent, not by native speakers.
- The flashes rule: the acro loop has one roll in 12 s and the pond loop none; judged by watching the source description and posters, not measured by a flash analyser.

- P2: the figures were not seen by a visual critics panel or a person; looked at by this agent only (shots p2b). The flashes rule is met by design (no element changes opacity faster than about once a second), not measured by a flash analyser.
- P2: es, pl, ru texts of sound.fig.* are the agent's, not a native speaker's.
- P2: Safari, Firefox and real phones not tried; headless Chrome 157 only. The 320 px check covered en and ru, pl and es at 360 only.
- P2: the figures' story was checked against the package source, not against a recording of a real flight.

- P3: external links (10: GitHub, calendar, share links) not opened; only same-origin links fetched from the local server. Videos and screenshots in headless Chrome 157 only; no real phone, Safari or Firefox. The page was not checked with a screen reader (NVDA, JAWS); heading order, aria-hidden figures and text next to each figure were checked by script only. The flash rule not measured by an analyser.

## Cost notes

- P3: most turns went to the two header fixes, each needing a release build and a full probe (about 6 minutes each), and to finding that one full-page capture over 16384 px repeats content; a header width check at 1152 in all four languages in the P2 probe would have saved one build and probe round.

- P2: most turns went to reading the cue rules across planner.ts, rules.ts, beacon.ts, runner.ts and the theme files (about 9 turns) and to one 320 px overflow hunt in the shared header; a fact sheet of the default theme's cue numbers with file:line in scout-B would have saved about 6 turns.

- P1: most turns went to finding the real flight clips (vault note, Publish folder, then the deck media and spec.py for their content) and to one failed release build from a stale submodule; a line in scout-B naming talks/fpv/deck_public/media and spec.py, and a clean submodule in the worktree, would have saved about 6 turns.
